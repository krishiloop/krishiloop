"""KrishiLoop photo-trust MCP server: where a photo model has earned trust, area by area, and the public-data replay
of how that trust is earned. Read-only; needs no secret.

- list_areas: the areas with a ledger or a trust credential, in the official store or a demo session;
- area_photo_trust: one area's ledger (officer verdicts on suggestions frozen beforehand, Wilson lower bound, gate
  events), whether its trust stands, and the photo-trust policy (plan/EARNED_TRUST_DESIGN.md, outside the repo);
- trust_replay: the replay on public CC BY rice datasets (ml/vision/artifacts/area_trust_replay.json), where the
  datasets' labels stand in for officers' verdicts.

Ledgers are read with services.vision.ledger (imported, never changed). "Trust stands" uses the planner's own check:
the store's live AreaTrustCredential index (store.trusted_photo_model). To check that credential's signature and
status, call verify_credential on the receipts server.

Run:  python -m services.mcp.photo_trust [--transport stdio|http] [--port 8105]
Environment: see services/mcp/stores.py.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a script (python services/mcp/photo_trust/server.py): make `services` importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from typing import Annotated, Any

import yaml
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from services.mcp import stores
from services.mcp.common import READ_LOCAL, serve
from services.trust.store import ROOT
from services.vision.ledger import POLICY_FILE, AreaLedger, Policy

REPLAY = ROOT / "ml" / "vision" / "artifacts" / "area_trust_replay.json"
AREA = re.compile(r"^[a-z0-9_]+@[A-Za-z0-9_-]+$")   # crop@area, as the API's area route
REPLAY_MEANING = {
    "photos": "photos streamed to the area (one per near-duplicate group)",
    "confirmations_until_open": "officer verdicts before the gate first opened (null if it never opened)",
    "officer_confirmations": "photos answered by the officer stand-in, audits included",
    "auto_answers": "sure photos that arrived while the gate was open, answered automatically (a share also audited)",
    "auto_precision": "share of automatic answers that matched the dataset's label",
    "auto_share_of_all_photos": "automatic answers / photos",
    "gate_closings": "times the gate closed again after opening",
    "open_at_end": "gate open after the last photo",
    "suggestion_by_stage": "by photos seen: [photos, share with the top-1 suggestion right, share with the right "
                           "label in the top 2] (the triage value for the officer while the gate is closed)",
}
SessionId = Annotated[str | None, Field(description="Demo session id (16 hex characters) to read that sandbox; omit "
                                                    "for the official store")]

server = MCPServer(
    "krishiloop-photo-trust", title="KrishiLoop photo trust", version="0.2.0",
    instructions="Read-only. Where a KrishiLoop photo model has earned trust, area by area: the officer-verdict "
                 "ledger, the gate (Wilson lower bound) and the photo-trust policy, plus a replay on public datasets "
                 "whose labels stand in for officers. Without earned trust in an area, every photo goes to the officer.")


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s)   # as services/vision/service.py names area folders


def _ledgers(photo_dir: Path | None, area: str | None = None) -> dict[tuple[str, str], dict]:
    """(area, model) -> ledger stats, read from the area folders a photo service writes."""
    out = {}
    if photo_dir is None:
        return out
    for path in sorted((photo_dir / "areas").glob(f"{_slug(area) + '__' if area else ''}*/ledger.json")):
        d = json.loads(path.read_text(encoding="utf-8"))
        if area is None or d.get("area") == area:
            policy = Policy(**d["policy"]) if "policy" in d else Policy.load()
            out[(d["area"], d["model"])] = AreaLedger(d["area"], d["model"], policy, path).stats()
    return out


def _live(trust_dir: Path) -> dict[tuple[str, str], str]:
    """(area, model) -> live AreaTrustCredential id: the index the planner's gate reads."""
    out = {}
    for key, cred_id in stores.read_state(trust_dir).get("area_trust", {}).items():
        model, _, area = key.rpartition("|")
        out[(area, model)] = cred_id
    return out


def _policy() -> dict:
    p = yaml.safe_load(POLICY_FILE.read_text(encoding="utf-8"))
    return {k: p.get(k) for k in ("policy_id", "version", "status", "sure_threshold", "window", "min_sure_answers",
                                  "open_lower_bound", "close_lower_bound", "audit_rate", "tiers")}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def list_areas(session_id: SessionId = None) -> dict[str, Any]:
    """The areas (crop@area) where a photo model has a ledger or a live trust credential, with the gate state and
    the number of officer verdicts so far."""
    trust_dir, _, photo_dir = stores.scope(session_id)
    ledgers, live = _ledgers(photo_dir), _live(trust_dir)
    areas = [{"area": a, "model": m, "verdicts": ledgers.get((a, m), {}).get("verdicts", 0),
              "gate_open": ledgers.get((a, m), {}).get("gate_open", False), "trust_stands": (a, m) in live}
             for a, m in sorted(set(ledgers) | set(live))]
    out = {"scope": "official store" if session_id is None else f"demo session {session_id}", "areas": areas}
    if session_id is None and not areas:
        out["note"] = "Photo cases run in demo sessions only for now; pass session_id to read a demo sandbox."
    return out


@server.tool(annotations=READ_LOCAL, structured_output=True)
def area_photo_trust(
    area: Annotated[str, Field(max_length=80, description="crop@area: the crop, then the field's area or country "
                                                          "code (e.g. potato@KE)")],
    session_id: SessionId = None,
) -> dict[str, Any]:
    """Whether a photo model has earned trust in an area: the area's ledger (officer verdicts on suggestions frozen
    before the verdict, Wilson lower bound, gate open or closed, gate events), whether its trust stands, and the
    photo-trust policy. Without trust that stands, every photo goes to the officer."""
    if not AREA.fullmatch(area):
        raise ToolError("area must look like crop@AREA, e.g. potato@KE")
    trust_dir, _, photo_dir = stores.scope(session_id)
    ledgers = {m: s for (_, m), s in _ledgers(photo_dir, area).items()}
    live = {m: c for (a, m), c in _live(trust_dir).items() if a == area}
    models = []
    for model in sorted(set(ledgers) | set(live)):
        ledger = {k: v for k, v in ledgers.get(model, {}).items() if k not in ("area", "model")}
        models.append({"model": model, "ledger": ledger or None, "trust_stands": model in live,
                       "trust_credential_id": live.get(model)})
    trusted = [m["model"] for m in models if m["trust_stands"]]
    out = {"area": area, "scope": "official store" if session_id is None else f"demo session {session_id}",
           "trusted_models": trusted, "models": models,
           "summary": (f"photo trust stands in {area} for {', '.join(trusted)}: sure readings may answer low-risk "
                       "practices automatically (a share is still audited by the officer)") if trusted else
                      f"no photo trust stands in {area}: every photo goes to the officer",
           "verify": "call verify_credential on the receipts server to check a trust credential's signature and status",
           "policy": _policy(),
           "policy_note": "The thresholds are team-set, not from a source, and not yet reviewed by an agronomist or a "
                          "statistician (rules/policy/photo-trust.yaml)."}
    if session_id is None and not models:
        out["note"] = "Photo cases run in demo sessions only for now; pass session_id to read a demo sandbox."
    return out


@server.tool(annotations=READ_LOCAL, structured_output=True)
def trust_replay(
    area: Annotated[str | None, Field(max_length=40, description="One replay area (a held-out dataset, e.g. BD-C) "
                                                                 "to also return its curve; omit for summaries")] = None,
    backbone: Annotated[str | None, Field(max_length=40, description="Feature backbone; the first if omitted")] = None,
) -> dict[str, Any]:
    """How photo trust is earned, replayed on public CC BY rice datasets whose labels stand in for officers' verdicts
    (not real officers, not real farms): per area, verdicts until the gate opened, automatic answers and their
    precision, gate closings, and the suggestion's value while the gate is closed. With an area, also the curve."""
    if not REPLAY.exists():
        raise ToolError("no replay has been generated in this checkout")
    d = json.loads(REPLAY.read_text(encoding="utf-8"))
    backbones = sorted(d.get("areas", {}))
    backbone = backbone or (backbones[0] if backbones else None)
    if backbone not in backbones:
        raise ToolError(f"unknown backbone {backbone!r}; the replay has {', '.join(backbones)}")
    areas = d["areas"][backbone]
    if area is not None and area not in areas:
        raise ToolError(f"unknown replay area {area!r}; the replay has {', '.join(sorted(areas))}")
    out = {"note": d.get("note"), "backbone": backbone, "backbones": backbones, "settings": d.get("settings"),
           "source": "ml/vision/analysis/earned_trust_sim_v2.py --curves (protocol 2, first random order only); "
                     "each area is one held-out public dataset (ml/vision/MODEL_CARD.md)",
           "summary_fields": REPLAY_MEANING,
           "areas": {name: a["summary"] for name, a in sorted(areas.items())}}
    if area is not None:
        out["curve"] = {"area": area, "fields": areas[area]["fields"], "points": areas[area]["points"],
                        "note": "a point after officer verdicts, thinned evenly (every k-th verdict, plus the last)"}
    return out


def main(argv: list[str] | None = None) -> None:
    serve(server, 8105, argv)


if __name__ == "__main__":
    main()
