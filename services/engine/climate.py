"""Climate-Smart Shield: next-7-day warnings from the field snapshot the planner already fetched. A pure function.

Four checks, each "warn", "clear" or "unknown" (unknown is never "no risk", as in the planner):
- heavy_rain  days with rain at or above the pack's `heavy_rain_mm` (reviewer parameter, team-set);
- heat        days with a maximum at or above HEAT_TMAX_C (team-set here; we hold no sourced heat threshold);
- flood       the GloFAS river-discharge trend in the snapshot ("rising" is the snapshot's own team-set 10% rule);
- disease     days that are humid and mild by the pack's thresholds, at least `humid_mild_days_min` of them (the
              planner's own fact, `forecast_humid_mild_days`, with the same team-set parameters).

A warning tied to a sourced rule cites it (rule id and version, its own text when its condition holds for this field,
and the verbatim source quote with page). A recalled rule version is never cited. Every threshold says who set it:
all of them are "team" today, shown as "threshold set by our team (not from a source; review pending)".
No doses and no new facts: a check's "why it matters" line is a VERIFIED row of research/fact_register.md.

Run `python -m services.engine.climate --record` to rebuild the recorded answers the web app shows without an API
(apps/web/src/features/farmer/climate/recorded.json); tests/test_climate.py fails if that file drifts from this code.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Callable

import yaml

from services.engine import snapshot as snap_mod
from services.engine.rules import evaluate, load_pack, manifest, pack_parameter_defs, pack_parameters

ROOT = Path(__file__).resolve().parents[2]
CLIMATE_VERSION = "0.1.0"
RECORDED_OUT = ROOT / "apps" / "web" / "src" / "features" / "farmer" / "climate" / "recorded.json"
RECORDED_SNAPSHOTS = ROOT / "apps" / "web" / "src" / "data" / "recorded" / "snapshots.json"
KINDS = ("heavy_rain", "heat", "flood", "disease")

# Pack-specific data (which rule each warning cites, the team-set thresholds this module adds, the "why it matters"
# facts) lives in rules/climate/shield.yaml, so a new pack needs no engine change.
SHIELD_YAML = ROOT / "rules" / "climate" / "shield.yaml"
_DATA = yaml.safe_load(SHIELD_YAML.read_text(encoding="utf-8"))
TEAM_PARAMS: dict = _DATA["team_params"]
LINKS: dict = {(kind, pack): (v["rule_id"], v["quote"], v["show_action"])
               for pack, kinds in (_DATA.get("links") or {}).items() for kind, v in kinds.items()}
CONTEXT: dict = {(kind, country): v for country, kinds in (_DATA.get("context") or {}).items() for kind, v in kinds.items()}


def _rule(pack_id: str, rule_id: str) -> dict | None:
    return next((r for r in load_pack(pack_id) if r["rule_id"] == rule_id), None)


def _link(kind: str, pack_id: str, facts: dict, is_recalled: Callable[[str, int], bool]) -> tuple[dict | None, str | None]:
    """(rule citation or None, "R-X v1" if the rule we would cite is recalled)."""
    hit = LINKS.get((kind, pack_id))
    if not hit:
        return None, None
    rule = _rule(pack_id, hit[0])
    if not rule or rule.get("status", "active") != "active":
        return None, None
    if is_recalled(rule["rule_id"], rule["version"]):
        return None, f"{rule['rule_id']} v{rule['version']}"
    holds = evaluate(rule, facts)[0] if hit[2] else None
    if holds is False:          # e.g. the rule is for another stage: it says nothing about this field
        return None, None
    src = rule["sources"][hit[1]]
    doc = manifest()[src["doc_id"]]
    return {"rule_id": rule["rule_id"], "version": rule["version"],
            # the rule's own action only when its whole condition holds here; otherwise the quote alone
            "applies": holds is True, "title": dict(rule["action"]["title"]) if holds is True else None,
            "review_level": rule.get("review", {}).get("level", "pending"),
            "source": {"doc_id": src["doc_id"], "title": doc["title"], "publisher": doc["publisher"], "url": doc["url"],
                       "page": src["page"], "quote": src["quote"], "language": doc.get("language", "en")}}, None


def _check(kind: str, level: str, **kw) -> dict:
    return {"kind": kind, "level": level, "days": kw.get("days", []), "peak": kw.get("peak"),
            "thresholds": kw.get("thresholds", []), "basis": "team", "reason": kw.get("reason"),
            "rule": kw.get("rule"), "rule_withdrawn": kw.get("withdrawn"), "context": kw.get("context")}


def shield(snap: dict, field: dict, profile: dict | None = None, today: date | None = None,
           is_recalled: Callable[[str, int], bool] | None = None, max_age_h: float | None = None) -> dict:
    """The Climate-Smart Shield for one field: four checks over the next 7 days of `snap` (planner snapshot shape).

    field: {field_id, crop, stage, pack_id, country}; profile: optional farmer facts (crop_protected, ...) so a rule
    that depends on them can say whether it holds. `today` defaults to the real date; days before it are ignored.
    `max_age_h`: a saved (non-live) snapshot older than this makes every forecast check unknown (data_stale).
    """
    today = today or date.today()
    is_recalled = is_recalled or (lambda _r, _v: False)
    pack_id = field["pack_id"]
    params, defs = pack_parameters(pack_id), pack_parameter_defs(pack_id)
    fc = snap.get("forecast") or {}
    days = [d for d in (fc.get("days") or []) if d.get("date", "") >= today.isoformat()][:snap_mod.WINDOW_DAYS]
    stale = (max_age_h is not None and snap.get("mode") != "live" and snap.get("created_at")
             and snap_mod.age_hours(snap) > max_age_h)
    no_fc = "data_stale" if stale else "no_forecast" if not fc.get("days") else \
        "too_few_days" if len(days) < snap_mod.MIN_DAYS else None
    wf = snap_mod.weather_facts(snap, params, today) if not no_fc else \
        {"forecast_humid_mild_days": None, "forecast_heavy_rain_days": None}
    facts = {"stage": field["stage"], **wf, **{k: v for k, v in (profile or {}).items() if k != "farmer_profile_id"}}
    country = field.get("country") or (snap.get("location") or {}).get("country")
    ctx = lambda kind: CONTEXT.get((kind, country))  # noqa: E731
    checks = []

    # heavy rain ------------------------------------------------------------
    th = [defs["heavy_rain_mm"]] if "heavy_rain_mm" in defs else []
    if no_fc or not th:
        checks.append(_check("heavy_rain", "unknown", reason=no_fc or "no_threshold", thresholds=th))
    elif any(d.get("precip_mm") is None for d in days):
        checks.append(_check("heavy_rain", "unknown", reason="missing_variable", thresholds=th))
    else:
        mm = float(params["heavy_rain_mm"])
        wet = [d for d in days if d["precip_mm"] >= mm]
        peak = max(days, key=lambda d: d["precip_mm"])
        rule, withdrawn = _link("heavy_rain", pack_id, facts, is_recalled) if wet else (None, None)
        checks.append(_check("heavy_rain", "warn" if wet else "clear", days=[d["date"] for d in wet], thresholds=th,
                             peak={"date": peak["date"], "value": peak["precip_mm"], "unit": "mm"},
                             rule=rule, withdrawn=withdrawn))

    # heat ------------------------------------------------------------------
    th = [TEAM_PARAMS["heat_tmax_c"]]
    if no_fc:
        checks.append(_check("heat", "unknown", reason=no_fc, thresholds=th))
    elif any(d.get("tmax_c") is None for d in days):
        checks.append(_check("heat", "unknown", reason="missing_variable", thresholds=th))
    else:
        hot = [d for d in days if d["tmax_c"] >= TEAM_PARAMS["heat_tmax_c"]["value"]]
        peak = max(days, key=lambda d: d["tmax_c"])
        checks.append(_check("heat", "warn" if hot else "clear", days=[d["date"] for d in hot], thresholds=th,
                             peak={"date": peak["date"], "value": peak["tmax_c"], "unit": "C"},
                             context=ctx("heat") if hot else None))

    # flood (GloFAS river discharge, only when the snapshot asked for it) ---------------------------
    th = [TEAM_PARAMS["flood_rise_pct"]]
    flood = snap.get("flood")
    if stale:
        checks.append(_check("flood", "unknown", reason="data_stale", thresholds=th))
    elif not flood or not flood.get("discharge"):
        checks.append(_check("flood", "unknown", reason="no_river_forecast", thresholds=th))
    else:
        q = flood["discharge"]
        peak = max(q, key=lambda x: x["m3s"])
        rising = flood.get("trend") == "rising"
        checks.append(_check("flood", "warn" if rising else "clear", thresholds=th,
                             days=[q[-1]["date"]] if rising else [],
                             peak={"date": peak["date"], "value": peak["m3s"], "unit": "m3/s", "trend": flood.get("trend")},
                             context=ctx("flood") if rising else None))

    # disease-favourable weather (the planner's humid-and-mild count) ---------------------------------
    th = [defs[n] for n in ("humid_rh_pct_min", "mild_temp_c_range", "humid_mild_days_min") if n in defs]
    n_days = wf.get("forecast_humid_mild_days")
    if no_fc or n_days is None or "humid_mild_days_min" not in params:
        checks.append(_check("disease", "unknown", reason=no_fc or ("missing_variable" if n_days is None else "no_threshold"),
                             thresholds=th))
    else:
        rh_min = float(params["humid_rh_pct_min"])
        lo, hi = snap_mod._range(params["mild_temp_c_range"])
        favour = [d["date"] for d in days if d["rh_mean_pct"] >= rh_min and lo <= d["tmin_c"] and d["tmax_c"] <= hi]
        warn = n_days >= params["humid_mild_days_min"]
        rule, withdrawn = _link("disease", pack_id, facts, is_recalled) if warn else (None, None)
        checks.append(_check("disease", "warn" if warn else "clear", days=favour, thresholds=th,
                             peak={"date": None, "value": n_days, "unit": "days", "of": len(days),
                                   "min": params["humid_mild_days_min"]},
                             rule=rule, withdrawn=withdrawn))

    return {"version": CLIMATE_VERSION, "field_id": field["field_id"], "crop": field["crop"], "stage": field["stage"],
            "pack_id": pack_id, "country": country, "snapshot_id": snap.get("snapshot_id"),
            "data_mode": snap.get("mode", "live"), "data_as_of": snap.get("created_at"),
            "forecast_source": fc.get("source"), "as_of": today.isoformat(),
            "window": {"from": days[0]["date"], "to": days[-1]["date"], "days": len(days)} if days else None,
            "warnings": sum(c["level"] == "warn" for c in checks), "checks": checks,
            "threshold_label": "threshold set by our team (not from a source; review pending)"}


# ------------------------------------------------------------------ the recorded answers for the web app (no API)
def _simulated_week(snap: dict) -> dict:
    """A made-up stormy week on top of a recorded snapshot, to show how the shield reacts. NOT a forecast: the web app
    labels it SIMULATED wherever it is shown. Deterministic (fixed numbers below)."""
    s = json.loads(json.dumps(snap))
    days = s["forecast"]["days"]
    if (s.get("location") or {}).get("country") == "BD":
        for i, (p, tx, tn, rh) in enumerate([(2.0, 33.5, 26.0, 82), (48.0, 31.0, 25.5, 92), (31.0, 30.5, 25.0, 90),
                                             (6.0, 35.8, 27.0, 80), (0.4, 36.4, 27.5, 74), (0.0, 34.9, 26.0, 76),
                                             (1.2, 33.0, 25.5, 79)]):
            days[i].update(precip_mm=p, tmax_c=tx, tmin_c=tn, rh_mean_pct=rh)
        base = [410.0, 455.0, 520.0, 610.0, 690.0, 760.0, 820.0]
    else:
        for i, (p, tx, tn, rh) in enumerate([(3.0, 19.0, 11.0, 91), (14.0, 18.0, 11.5, 93), (9.0, 18.5, 12.0, 92),
                                             (4.0, 19.5, 11.0, 91), (2.0, 21.0, 10.5, 86), (0.5, 22.0, 9.0, 80),
                                             (0.0, 22.5, 8.5, 78)]):
            days[i].update(precip_mm=p, tmax_c=tx, tmin_c=tn, rh_mean_pct=rh)
        base = [12.0, 13.5, 15.0, 16.2, 17.0, 17.4, 17.6]
    s["flood"] = {"source": "simulated", "issued_at": s["created_at"], "trend": "rising",
                  "discharge": [{"date": d["date"], "m3s": q} for d, q in zip(days, base)]}
    s["snapshot_id"] = s["snapshot_id"] + "-SIMULATED"
    s["mode"] = "simulated"
    return s


def recorded() -> dict:
    """The shield for every recorded snapshot and demo farmer, as of the day each snapshot was saved, plus the
    simulated stormy week. Written to apps/web/src/features/farmer/climate/recorded.json."""
    from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES   # here, so the pure function needs no demo data
    snaps = json.loads(RECORDED_SNAPSHOTS.read_text(encoding="utf-8"))
    out: dict = {"note": "Recorded: the shield computed by services/engine/climate.py on the recorded snapshots "
                         "(2 Nov 2026), as of the day each was saved. 'simulated' is a made-up stormy week, not a forecast.",
                 "version": CLIMATE_VERSION, "recorded": {}, "simulated": {}}
    for snap in sorted(snaps.values(), key=lambda s: s["snapshot_id"]):
        field = DEMO_FIELDS[snap["field_id"]]
        today = date.fromisoformat(snap["forecast"]["days"][0]["date"])
        for pid in sorted(DEMO_PROFILES):
            key = f"{field['field_id']}|{pid}"
            out["recorded"][key] = shield(snap, field, DEMO_PROFILES[pid], today)
            out["simulated"][key] = shield(_simulated_week(snap), field, DEMO_PROFILES[pid], today)
    return out


def write_recorded() -> None:
    RECORDED_OUT.parent.mkdir(parents=True, exist_ok=True)
    RECORDED_OUT.write_text(json.dumps(recorded(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if "--record" in sys.argv:
        write_recorded()
        print(f"wrote {RECORDED_OUT.relative_to(ROOT)}")
