"""Village outbreak radar: what farmers reported, by area and problem, over the last 14 days, k-anonymous.

Reports are photo cases (any model), the officer-inbox cases the app opened when it could not answer (abstentions)
and the questions farmers asked that went to the officer. A cell is (area, problem). It is shown only when at least
K_MIN distinct reporters contributed; otherwise only the total of hidden reports is said, never where or what. A
reporter is a device: one demo session (one browser tab's sandbox) counts once, however many fields or farmers it used.

The SIMULATED village scenario (simulate()) shows how the radar behaves with many farmers. It is seeded and
deterministic, every record carries simulated=True, and it is aggregated on its own: aggregate() refuses a mix, so a
simulated report can never reach a real count.

"Warn neighbours" (warn()) sends one fixed notice through services/reach to the holders, in this session, of a receipt
for a field in that area: SMS to the sandbox outbox (never sent), Telegram only when the bot token is set. The notice
gives no advice beyond "check your field, ask your officer before you spray": no product, no dose.

Run `python -m services.engine.radar --record` to rebuild the simulated scenario the web app shows without an API
(apps/web/src/features/officer/radar/simulated.json); tests/test_radar.py fails if that file drifts from this code.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import yaml

from services.engine import inbox as inbox_mod
from services.engine.radar_geo import area_names, area_of

ROOT = Path(__file__).resolve().parents[2]
RADAR_VERSION = "0.1.0"
K_MIN = 3
WINDOW_DAYS = 14
SIM_SEED = 2026
SIMULATED_OUT = ROOT / "apps" / "web" / "src" / "features" / "officer" / "radar" / "simulated.json"
KINDS = ("photo", "abstention", "ask")
SKIP_REASONS = {"visit_request"}           # a farmer asking for a visit reports no problem
SIM_LABEL = ("SIMULATED village scenario: made-up reports from made-up farmers, seeded and deterministic, to show how "
             "the radar behaves. Not real data; never added to real counts.")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _norm_problem(label: str | None) -> str:
    if not label:
        return "unidentified"
    p = "_".join(str(label).strip().lower().replace("-", " ").split())
    return p or "unidentified"


def is_healthy(problem: str) -> bool:
    return "healthy" in problem


def record(area: str, problem: str, kind: str, reporter: str, at: str, simulated: bool = False) -> dict:
    return {"area": area, "problem": _norm_problem(problem), "kind": kind, "reporter": reporter, "at": at,
            "simulated": simulated}


# ------------------------------------------------------------------ aggregate (pure)
def aggregate(records: Iterable[dict], now: datetime, k: int = K_MIN, window_days: int = WINDOW_DAYS) -> dict:
    """Cells (area, problem) with at least k distinct reporters in the window; the rest only as a hidden total."""
    recs = list(records)
    flags = {bool(r.get("simulated")) for r in recs}
    if len(flags) > 1:
        raise ValueError("real and simulated reports are never aggregated together")
    simulated = flags == {True}
    since = now - timedelta(days=window_days)
    names = area_names()
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in recs:
        at = _parse(r["at"])
        if at < since or at > now + timedelta(minutes=5) or is_healthy(r["problem"]):
            continue
        groups.setdefault((r["area"], r["problem"]), []).append({**r, "_at": at})
    cells, hidden_reports, hidden_cells = [], 0, 0
    for (area, problem), rs in groups.items():
        reporters = {r["reporter"] for r in rs}
        if len(reporters) < k:
            hidden_reports += len(rs)
            hidden_cells += 1
            continue
        meta = names.get(area, {})
        last = max(r["_at"] for r in rs)
        cells.append({"area": area, "area_name": meta.get("name", area), "country": meta.get("country"),
                      "level": meta.get("level"), "problem": problem, "reports": len(rs), "reporters": len(reporters),
                      "kinds": {kd: sum(r["kind"] == kd for r in rs) for kd in KINDS},
                      "last_days_ago": max(0, (now - last).days)})
    cells.sort(key=lambda c: (-c["reporters"], -c["reports"], c["area"], c["problem"]))
    return {"version": RADAR_VERSION, "simulated": simulated, "k": k, "window_days": window_days,
            "as_of": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "reports_in_window": sum(len(v) for v in groups.values()),
            "cells": cells, "hidden": {"reports": hidden_reports, "cells": hidden_cells}}


def cell(agg: dict, area: str, problem: str) -> dict | None:
    return next((c for c in agg["cells"] if c["area"] == area and c["problem"] == problem), None)


# ------------------------------------------------------------------ the simulated scenario (seeded, deterministic)
# The scenario and the notice's problem words are data: rules/climate/radar.yaml.
RADAR_YAML = ROOT / "rules" / "climate" / "radar.yaml"
_DATA = yaml.safe_load(RADAR_YAML.read_text(encoding="utf-8"))
SCENARIO = [tuple(row) for row in _DATA["scenario"]]


def simulate(now: datetime, seed: int = SIM_SEED) -> list[dict]:
    rng = random.Random(seed)
    out = []
    for i, (area, problem, n_rep, n_rec, first, last) in enumerate(SCENARIO):
        reporters = [f"sim-{area}-{j:02d}" for j in range(n_rep)]
        for j in range(n_rec):
            who = reporters[j] if j < n_rep else rng.choice(reporters)
            days_ago = last if j == 0 else rng.randint(last, first)
            at = now - timedelta(days=days_ago, hours=rng.randint(0, 9), minutes=rng.randint(0, 59))
            kind = KINDS[(i + j) % 3] if problem != "unidentified" else rng.choice(("abstention", "ask"))
            out.append(record(area, problem, kind, who, at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                              simulated=True))
    return out


def simulated(now: datetime) -> dict:
    return {**aggregate(simulate(now), now), "label": SIM_LABEL, "seed": SIM_SEED}


# ------------------------------------------------------------------ real reports (photo cases, inbox cases)
def field_area(field: dict) -> dict | None:
    if field.get("lat") is None or field.get("lon") is None:
        return None
    return area_of(float(field["lat"]), float(field["lon"]), field.get("country"))


def _reporter(scope: str) -> str:
    return "dev-" + hashlib.sha256(f"krishiloop-radar:{scope}".encode()).hexdigest()[:12]


def reports_from(inbox_items: Iterable[dict], photo_cases: Iterable[dict], fields: dict, reporter_scope: str) -> list[dict]:
    """Real reports from one reporter (one device: a demo session, or the official channel)."""
    areas = {fid: field_area(f) for fid, f in fields.items()}
    who = _reporter(reporter_scope)
    out = []
    for it in inbox_items:
        if it.get("reason_code") in SKIP_REASONS:
            continue
        area = areas.get(it.get("field_id"))
        if not area:
            continue
        named = ((it.get("details") or {}).get("problems_named") or [])
        top = (it.get("top_labels") or [{}])[0].get("label") if it.get("top_labels") else None
        kind = "ask" if it.get("question") else "photo" if (top or it.get("diagnosis_id")) else "abstention"
        for p in (named or [top]):
            out.append(record(area["code"], p, kind, who, it["created_at"]))
    for c in photo_cases:
        area = areas.get(c.get("field_id"))
        if not area:
            continue
        label = c.get("verdict") or ((c.get("suggestion") or [{}])[0].get("label"))
        out.append(record(area["code"], label, "photo", who, c["created_at"]))
    return out


def _photo_cases(photo_dir: Path) -> list[dict]:
    """Cases of any photo model: the earned-trust service (`suggestion`) and AgriTriage (`reading.labels`)."""
    d = photo_dir / "cases"
    if not d.exists():
        return []
    out = []
    for p in d.glob("*.json"):
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(c, dict) or not c.get("field_id") or not c.get("created_at"):
            continue
        sugg = c.get("suggestion") or ((c.get("reading") or {}).get("labels")) or []
        out.append({"field_id": c["field_id"], "created_at": c["created_at"], "verdict": c.get("verdict"),
                    "suggestion": sugg[:1]})
    return out


def collect(demo_root: Path, official_inbox: Path, fields: dict, now: datetime, max_sessions: int = 2000) -> list[dict]:
    """Every real report on this server in the window: each demo session's inbox and photo cases (one device each),
    and the official inbox (the Telegram bot and the official plan; one reporter per farmer profile)."""
    since = (now - timedelta(days=WINDOW_DAYS)).timestamp()
    out: list[dict] = []
    if demo_root.exists():
        sessions = [p for p in demo_root.iterdir() if p.is_dir() and p.stat().st_mtime >= since - 86400]
        for sdir in sorted(sessions, key=lambda p: p.stat().st_mtime, reverse=True)[:max_sessions]:
            cases = _photo_cases(sdir / "photo") + _photo_cases(sdir / "agritriage")
            out += reports_from(inbox_mod.list_items(sdir / "inbox"), cases, fields, f"session:{sdir.name}")
    for it in inbox_mod.list_items(official_inbox):
        out += reports_from([it], [], fields, f"official:{it.get('farmer_display_name', '')}")
    return out


# ------------------------------------------------------------------ warn neighbours (through services/reach)
NOTICE = {
    "en": "KrishiLoop area notice: {n} farmers near {area} reported {problem} in the last {days} days. Check your "
          "field, and ask your officer before you spray.",
    "bn": "কৃষিলুপ এলাকা সতর্কতা: গত {days} দিনে {area} এলাকার {n} জন কৃষক {problem} জানিয়েছেন। আপনার জমি দেখুন, "
          "আর স্প্রে করার আগে আপনার কর্মকর্তাকে জিজ্ঞেস করুন।",
}
SIM_PREFIX = {"en": "SIMULATED (demo, not real reports). ", "bn": "সিমুলেশন (ডেমো, আসল রিপোর্ট নয়)। "}
PROBLEM_WORDS: dict = _DATA.get("problems") or {}   # Bangla machine-written; pending native-speaker review


def notice_text(c: dict, lang: str, simulated_cell: bool, window_days: int = WINDOW_DAYS) -> str:
    lang = lang if lang in NOTICE else "en"
    words = PROBLEM_WORDS.get(c["problem"], {"en": c["problem"].replace("_", " "), "bn": c["problem"].replace("_", " ")})
    text = NOTICE[lang].format(n=c["reporters"], area=c["area_name"], problem=words[lang], days=window_days)
    return (SIM_PREFIX[lang] if simulated_cell else "") + text


def field_ref(field_id: str) -> str:
    """The planner's field_ref (services/engine/planner.py) for a field id."""
    return hashlib.sha256(f"krishiloop-field:{field_id}".encode()).hexdigest()[:16]


def warn(db, store, c: dict, simulated_cell: bool, fields: dict, senders: dict, today: str) -> dict:
    """Send the fixed notice to every holder in `store` (a session's TrustStore) of a receipt for a field in the cell's
    area; at most once per holder, area, problem and day. Returns the officer's summary."""
    from services.reach.senders import SANDBOX_NOTE, Delivery, mask
    refs = {field_ref(fid): fid for fid, f in fields.items() if (field_area(f) or {}).get("code") == c["area"]}
    key = f"radar:{c['area']}:{c['problem']}:{today}" + (":sim" if simulated_cell else "")
    rows, creds = [], {}
    for h in db.holders(store.status_id):
        cid = h["credential_id"]
        if cid not in creds:
            try:
                subj = store.get(cid).get("credentialSubject") or {}
                creds[cid] = (subj.get("plan") or {}).get("field_ref")
            except (FileNotFoundError, ValueError):
                creds[cid] = None
        if creds[cid] not in refs:
            continue
        if any(r["holder_id"] == h["id"] for r in rows) or db.notified(store.status_id, cid, key, h["id"]):
            continue
        text = notice_text(c, h["lang"], simulated_cell)
        sender = senders.get(h["channel"])
        try:
            d = sender.send(h["address"], text, {"kind": "radar_notice", "area": c["area"], "problem": c["problem"],
                                                 "simulated": simulated_cell}) if sender else \
                Delivery("failed", f"no sender for channel {h['channel']}")
        except Exception as e:      # a sender must never break the officer's action
            d = Delivery("failed", type(e).__name__)
        db.record_notification(store.status_id, cid, key, h["channel"], h["id"], d.status, d.detail)
        rows.append({"holder_id": h["id"], "channel": h["channel"], "to": mask(h["address"]) if h["channel"] == "sms"
                     else "telegram chat", "status": d.status})
    return {"area": c["area"], "problem": c["problem"], "simulated": simulated_cell, "total": len(rows),
            "sms_sandbox": sum(r["status"] == "sandbox" for r in rows),
            "telegram": sum(r["channel"] == "telegram" and r["status"] == "sent" for r in rows),
            "failed": sum(r["status"] == "failed" for r in rows),
            "recipients": [{k: r[k] for k in ("channel", "to", "status")} for r in rows],
            "text": {lang: notice_text(c, lang, simulated_cell) for lang in ("en", "bn")},
            "note": f"SMS is {SANDBOX_NOTE} (written to an outbox). Telegram notices are sent only when the bot token is set."}


# ------------------------------------------------------------------ the recorded scenario for the web app (no API)
def recorded_simulation(now: datetime | None = None) -> dict:
    """The simulated scenario as the web app shows it without an API. Dates are relative (days ago), so it does not age."""
    from services.engine.planner import DEMO_FIELDS
    now = now or datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)
    sim = simulated(now)
    sim.pop("as_of")
    fields = {fid: field_area(f) for fid, f in DEMO_FIELDS.items()}
    return {"note": "Generated by services/engine/radar.py (recorded_simulation). " + SIM_LABEL,
            "simulated": sim, "field_areas": fields,
            "notice": {"en": NOTICE["en"], "bn": NOTICE["bn"], "sim_prefix": SIM_PREFIX, "problems": PROBLEM_WORDS}}


def write_recorded() -> None:
    SIMULATED_OUT.parent.mkdir(parents=True, exist_ok=True)
    SIMULATED_OUT.write_text(json.dumps(recorded_simulation(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if "--record" in sys.argv:
        write_recorded()
        print(f"wrote {SIMULATED_OUT.relative_to(ROOT)}")
