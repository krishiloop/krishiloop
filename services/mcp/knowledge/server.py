"""KrishiLoop receipts and knowledge MCP server: verify credentials, read rule packs and their sources, and read an
area's earned photo trust. Read-only.

- verify_credential: the public verifier's answer (authentic | recalled | invalid) through TrustStore.verify, for
  advice receipts and AreaTrustCredentials, from the official store or a live demo sandbox (as GET /api/verify/<id>);
- list_packs, get_rule: rule packs as data, each rule with its sources, page and verbatim quote;
- area_photo_trust: an area's ledger (officer verdicts on suggestions frozen beforehand) and its trust credential.

Recall is NOT a tool here: it stays behind the API's admin token (POST /api/admin/recall).
Stores are reopened on every call, so a recall made through the API shows at once, and only stores that already
exist are opened, so no call creates a file. Verification needs the issuer seed (KRISHILOOP_ISSUER_SEED, from the
environment only, never logged) because TrustStore rebuilds and signs the status list from its local state; no tool
issues, signs or revokes a credential.

Run:  python -m services.mcp.knowledge [--transport stdio|http] [--port 8103]
Environment: PUBLIC_BASE_URL and ISSUER_DID (as for the API), KRISHILOOP_ISSUER_SEED, and KRISHILOOP_DATA_DIR
(default <repo>/data, the folder the API writes).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from collections import Counter
from pathlib import Path

if __package__ in (None, ""):  # run as a script (python services/mcp/knowledge/server.py): make `services` importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from typing import Annotated, Any

import yaml
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from services.engine.rules import REGISTRY, load_pack, manifest, run_pack_tests
from services.mcp.common import READ_LOCAL, serve
from services.trust.store import CRED_ID, ROOT, TrustStore, did_from_base_url
from services.vision.ledger import POLICY_FILE, AreaLedger, Policy

DATA_DIR = Path(os.environ.get("KRISHILOOP_DATA_DIR") or ROOT / "data")   # the folder the API writes to
SANDBOX_TTL_S = 24 * 3600   # as services/api/main.py (tests/test_mcp.py keeps the two equal)
SESSION_ID = re.compile(r"^[0-9a-f]{16}$")
AREA = re.compile(r"^[a-z0-9_]+@[A-Za-z0-9_-]+$")   # crop@area, as the API's area route
RULE_ID = re.compile(r"^R-[A-Z]{2,8}-[0-9]{3}$")
SEED_MISSING = "verification is off on this server: KRISHILOOP_ISSUER_SEED is not set in its environment"
STATUS_MEANING = {"authentic": "issued by KrishiLoop and unaltered; not a guarantee that the advice is correct",
                  "recalled": "withdrawn: a rule (or the area photo trust) it relied on was recalled",
                  "invalid": "altered, unknown here, expired demo session, or could not be verified"}
RULE_NOTE = ("A rule is knowledge, not advice for a field: it applies only when its condition holds, as decided by "
             "KrishiLoop's deterministic planner, which signs a receipt for every action it serves.")
QUOTE_INTEGRITY = ("tools/check_quotes.py (run in CI) checks every quote's sha256 and that the quote occurs verbatim "
                   "on the declared page whenever the document's text is available; quotes from documents whose text "
                   "is not committed are reported as UNVERIFIED-IN-CI and checked locally.")

server = MCPServer(
    "krishiloop-knowledge", title="KrishiLoop receipts and knowledge", version="0.1.0",
    instructions="Read-only. Verify a KrishiLoop credential (advice receipt or area photo-trust credential): "
                 "authentic, recalled or invalid. Read the rule packs, each rule with its source document, page and "
                 "verbatim quote. Read an area's earned photo trust. Recall is not available here: it needs the "
                 "admin token on the KrishiLoop API.")


# ---------------------------------------------------------------- stores (opened per call, never created)
def _identity() -> tuple[str, str]:
    base = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return base, os.environ.get("ISSUER_DID", did_from_base_url(base))


def _official_dir() -> Path:
    return DATA_DIR / "trust" / re.sub(r"[^A-Za-z0-9._-]+", "_", _identity()[1])   # TrustStore's default folder


def _sandbox_dir(session_id: str) -> Path | None:
    """A live demo session's folder; expired sessions are unknown, as in the API."""
    d = DATA_DIR / "demo" / session_id
    if not SESSION_ID.fullmatch(session_id) or not (d / "trust" / "state.json").exists():
        return None
    return d if time.time() - d.stat().st_ctime <= SANDBOX_TTL_S else None


def _open(trust_dir: Path, status_id: str) -> TrustStore | None:
    seed = os.environ.get("KRISHILOOP_ISSUER_SEED")
    if not seed:
        raise ToolError(SEED_MISSING)
    if not (trust_dir / "state.json").exists():
        return None
    base, did = _identity()
    try:
        return TrustStore(base, did, seed, data_dir=trust_dir, status_id=status_id)
    except RuntimeError:   # the folder belongs to another issuer identity
        return None
    except Exception:      # a malformed seed; say nothing about its value
        raise ToolError("KRISHILOOP_ISSUER_SEED is malformed (expected 64 hex characters)") from None


def _store_for(cred_id: str) -> TrustStore | None:
    """The official store or the live demo sandbox that holds a credential (as the API's verifier finds it)."""
    m = CRED_ID.match(cred_id)
    official = _open(_official_dir(), "1")
    if official and official.has(cred_id):
        return official
    for path in sorted((DATA_DIR / "demo").glob(f"*/trust/creds/{uuid.UUID(m.group(1))}.json")):
        sdir = _sandbox_dir(path.parents[2].name)
        st = _open(sdir / "trust", f"demo-{sdir.name}") if sdir else None
        if st and st.has(cred_id):
            return st
    return None


def _official_recalls() -> dict:
    """Rule versions recalled in the official store (plain state, readable without the seed)."""
    p = _official_dir() / "state.json"
    return json.loads(p.read_text(encoding="utf-8")).get("recalls", {}) if p.exists() else {}


def _packs() -> list[str]:
    return sorted(p.name for p in REGISTRY.iterdir() if p.is_dir())


# ---------------------------------------------------------------- tools
@server.tool(annotations=READ_LOCAL, structured_output=True)
def verify_credential(
    credential_id: Annotated[str, Field(max_length=100, description="Credential id: urn:uuid:<uuid> or a bare uuid, "
                                                                    "from a receipt QR code or link")],
) -> dict[str, Any]:
    """Verify a KrishiLoop advice receipt or AreaTrustCredential, exactly as the public verifier does: authentic
    (issued by KrishiLoop and unaltered), recalled (a rule it used, or the area's photo trust, was withdrawn) or
    invalid. Returns the verified credential, so only signed content is shown."""
    if not CRED_ID.match(credential_id):
        return {"status": "invalid", "reason": "unknown credential", "meaning": STATUS_MEANING["invalid"]}
    st = _store_for(credential_id)
    if st is None:
        return {"status": "invalid", "reason": "unknown credential", "meaning": STATUS_MEANING["invalid"]}
    result = st.verify(credential_id)
    return {**result, "meaning": STATUS_MEANING.get(result["status"], ""), "sandbox": st.status_id != "1",
            "status_list": st.status.url, "verifier_page": f"{st.base_url}/verify/{credential_id}"}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def list_packs() -> dict[str, Any]:
    """The rule packs (crop, rules, review levels, source documents and their licence status) and whether each
    pack's own tests pass. Packs are data: a new crop or country is a new pack, not new engine code."""
    docs, recalls, out = manifest(), _official_recalls(), []
    for pack_id in _packs():
        rules = load_pack(pack_id)
        failures = run_pack_tests(pack_id)
        doc_ids = sorted({s["doc_id"] for r in rules for s in r["sources"]})
        out.append({
            "pack_id": pack_id, "crops": sorted({r.get("crop", "") for r in rules}), "rule_count": len(rules),
            "review_levels": dict(sorted(Counter(r.get("review", {}).get("level", "pending") for r in rules).items())),
            "rules": [{"rule_id": r["rule_id"], "version": r["version"], "status": r.get("status", "active"),
                       "kind": r["action"]["kind"], "traffic_light": r["action"].get("traffic_light"),
                       "review_level": r.get("review", {}).get("level", "pending"),
                       "recalled_in_official_store": f"{r['rule_id']}@{r['version']}" in recalls} for r in rules],
            "source_documents": [{"doc_id": d, "title": docs[d]["title"], "publisher": docs[d]["publisher"],
                                  "licence_status": docs[d]["licence_status"]} for d in doc_ids],
            "pack_tests": {"passed": not failures, "failures": failures},
        })
    return {"packs": out, "signatures": "planned: pack signatures come from the Knowledge Compiler (not built yet)"}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def get_rule(
    rule_id: Annotated[str, Field(description="Rule id as listed by list_packs, e.g. R-PLB-008")],
    version: Annotated[int | None, Field(ge=1, description="Rule version; the latest if omitted")] = None,
) -> dict[str, Any]:
    """One rule with its condition, action, reviewer-set parameters, review status and every source: document,
    publisher, link, page, verbatim quote, quote hash, licence status and acknowledgement."""
    if not RULE_ID.fullmatch(rule_id):
        raise ToolError("rule_id must look like R-PLB-008")
    matches = [r for pack in _packs() for r in load_pack(pack) if r["rule_id"] == rule_id]
    if not matches:
        raise ToolError(f"unknown rule {rule_id}")
    if version is None:
        rule = max(matches, key=lambda r: r["version"])
    else:
        rule = next((r for r in matches if r["version"] == version), None)
        if rule is None:
            raise ToolError(f"{rule_id} has no version {version}; it has {sorted(r['version'] for r in matches)}")
    docs = manifest()
    sources = []
    for s in rule["sources"]:
        d = docs[s["doc_id"]]
        sources.append({"doc_id": s["doc_id"], "title": d["title"], "publisher": d["publisher"], "url": d["url"],
                        "page": s["page"], "quote": s["quote"], "quote_sha256": s["quote_sha256"],
                        "language": d.get("language", "en"), "licence_status": d["licence_status"],
                        "licence_note": d.get("licence_note", ""), "acknowledgement": d.get("acknowledgement", "")})
    return {"note": RULE_NOTE, "rule_id": rule["rule_id"], "version": rule["version"], "pack_id": rule["pack_id"],
            "status": rule.get("status", "active"), "crop": rule.get("crop"), "condition": rule.get("when"),
            "action": rule["action"], "sources": sources, "quote_integrity": QUOTE_INTEGRITY,
            "reviewer_parameters": rule.get("reviewer_parameters", []), "review": rule.get("review", {}),
            "basis_note": rule.get("basis_note"), "rule_sha256": rule["rule_sha256"],
            "pack_tests": len(rule.get("tests", [])),
            "recall_in_official_store": _official_recalls().get(f"{rule['rule_id']}@{rule['version']}")}


@server.tool(annotations=READ_LOCAL, structured_output=True)
def area_photo_trust(
    area: Annotated[str, Field(max_length=80, description="crop@area: the crop, then the field's area or country "
                                                          "code (e.g. potato@KE)")],
    session_id: Annotated[str | None, Field(description="Demo session id (16 hex characters) to read that sandbox; "
                                                        "omit for the official store")] = None,
) -> dict[str, Any]:
    """Whether a photo model has earned trust in an area: the area's ledger (officer verdicts on suggestions frozen
    before the verdict, Wilson lower bound, gate open or closed, gate events) and the status of its
    AreaTrustCredential. Without live trust, every photo goes to the officer."""
    if not AREA.fullmatch(area):
        raise ToolError("area must look like crop@AREA, e.g. potato@KE")
    if session_id is None:
        trust_dir, photo_dir, status_id = _official_dir(), None, "1"
    else:
        sdir = _sandbox_dir(session_id)
        if sdir is None:
            raise ToolError("unknown or expired demo session")
        trust_dir, photo_dir, status_id = sdir / "trust", sdir / "photo", f"demo-{session_id}"
    state_path = trust_dir / "state.json"
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    live = {}
    for key, cred_id in state.get("area_trust", {}).items():
        model, _, key_area = key.rpartition("|")
        if key_area == area:
            live[model] = cred_id
    ledgers = {}
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", area)   # services/vision/service.py names area folders this way
    for path in sorted((photo_dir / "areas").glob(f"{slug}__*/ledger.json")) if photo_dir else []:
        d = json.loads(path.read_text(encoding="utf-8"))
        if d.get("area") == area:
            policy = Policy(**d["policy"]) if "policy" in d else Policy.load()
            ledgers[d["model"]] = AreaLedger(area, d["model"], policy, path).stats()
    store = None
    models = []
    for model in sorted(set(ledgers) | set(live)):
        ledger = {k: v for k, v in ledgers.get(model, {}).items() if k not in ("area", "model")}
        entry = {"model": model, "ledger": ledger or None, "trust_credential_id": live.get(model)}
        if model in live:
            if not os.environ.get("KRISHILOOP_ISSUER_SEED"):
                entry["trust_credential"] = {"status": "unchecked", "reason": SEED_MISSING}
            else:
                store = store or _open(trust_dir, status_id)
                result = store.verify(live[model]) if store else {"status": "invalid", "reason": "unknown credential"}
                entry["trust_credential"] = {k: v for k, v in result.items() if k != "credential"}
        models.append(entry)
    trusted = [m["model"] for m in models if (m.get("trust_credential") or {}).get("status") == "authentic"]
    policy = yaml.safe_load(POLICY_FILE.read_text(encoding="utf-8"))
    out = {"area": area, "scope": "official store" if session_id is None else f"demo session {session_id}",
           "trusted_models": trusted, "models": models,
           "summary": (f"photo trust stands in {area} for {', '.join(trusted)}: sure readings may answer low-risk "
                       "practices automatically (a share is still audited by the officer)") if trusted else
                      f"no live photo trust in {area}: every photo goes to the officer",
           "policy": {k: policy.get(k) for k in ("policy_id", "version", "status", "sure_threshold", "window",
                                                 "min_sure_answers", "open_lower_bound", "close_lower_bound",
                                                 "audit_rate", "tiers")},
           "policy_note": "The thresholds are team-set, not from a source, and not yet reviewed by an agronomist or a "
                          "statistician (rules/policy/photo-trust.yaml)."}
    if session_id is None and not models:
        out["note"] = "Photo cases run in demo sessions only for now; pass session_id to read a demo sandbox."
    return out


def main(argv: list[str] | None = None) -> None:
    serve(server, 8103, argv)


if __name__ == "__main__":
    main()
