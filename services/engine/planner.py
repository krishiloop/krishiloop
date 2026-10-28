"""Deterministic planner: field snapshot + farmer profile + rule pack -> receipted weekly plan (or abstention).

The LLM never writes agronomy here (Constitution Art. 2). Text comes from rule YAML; an optional phrasing
step (later) may only rephrase validated text. Each action gets a signed AdviceReceiptCredential.

Safety rules (each covered by tests):
- each receipt signs the advice itself (text, decision, traffic light, plan window), so edited advice fails;
- a recalled rule version is never served; if the decision depended on it, the plan abstains (rule_recalled);
- unknown is never "no risk": if any decision rule depends on a missing fact, the plan abstains;
- a stale cached forecast is never used for "this week" (data_stale);
- exactly one input decision per plan;
- the farmer sees a fixed message on abstention; details go to the officer inbox record;
- a photo diagnosis informs rules only past the gate (the server holds earned-trust evidence for that model in that
  area, and the reading is in-distribution and confident); a client's own "calibrated" claim never counts. Otherwise
  it becomes a photo case for the officer, and the weather-based plan still stands.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

from services.engine import inbox
from services.engine import snapshot as snap_mod
from services.engine.rules import evaluate, load_pack, manifest, pack_parameter_defs, pack_parameters
from services.engine.validator import validate_action
from services.trust.store import RuleRecalled

ROOT = Path(__file__).resolve().parents[2]
PLANNER_VERSION = "0.3.0"
VALIDATOR_VERSION = "0.3.0"
LIGHT_RANK = {"red": 0, "amber": 1, "green": 2}
MAX_SNAPSHOT_AGE_H = 36
PLACEHOLDER_CRED = "urn:uuid:00000000-0000-0000-0000-000000000000"
# derived facts -> the pack parameters that shape them (copied into every receipt that depends on them)
FACT_PARAMS = {"forecast_humid_mild_days": ("humid_rh_pct_min", "mild_temp_c_range"),
               "forecast_heavy_rain_days": ("heavy_rain_mm",)}
FACT_VARIABLES = {"forecast_humid_mild_days": ("rh_mean_pct", "tmin_c", "tmax_c"),
                  "forecast_heavy_rain_days": ("precip_mm",)}
UNITS = {"rh_mean_pct": "%", "tmin_c": "C", "tmax_c": "C", "precip_mm": "mm"}
# Provisional gate for photo diagnoses (MODEL_CARD "Product gate"); thresholds are team-set, not from a source.
DIAGNOSIS_GATE = {"min_top1": 0.85, "max_ood": 0.5}
# Photo trust is SERVER-side evidence: the trust store's live AreaTrustCredentials (store.trusted_photo_model), issued
# only when an area's ledger opens its gate (plan/EARNED_TRUST_DESIGN.md). A client's own "calibrated" flag never
# counts: anyone can send it.
PHOTO_FACTS = ("diagnosis_label", "diagnosis_prob", "_diagnosis", "_area_trust")
REASONS = {  # fixed farmer-facing texts; never echo what the validator blocked
    "data_unavailable": "We don't have enough weather data for a sourced decision this week. Sent to your officer's inbox.",
    "data_stale": "Our weather data is out of date, so we won't guess. Sent to your officer's inbox.",
    "no_matching_rule": "No sourced rule covers your situation yet. Sent to your officer's inbox.",
    "conflicting_rules": "Our rules disagree for your situation. Sent to your officer's inbox.",
    "rule_recalled": "The rule for your situation was withdrawn for review. Sent to your officer's inbox.",
    "validator_blocked": "A safety check stopped this advice. Sent to your officer's inbox.",
}

def _load_demo() -> tuple[dict, dict]:
    """Demo fields and profiles live in rules/demo/demo.yaml (data), so a new pack needs no engine change."""
    d = yaml.safe_load((ROOT / "rules" / "demo" / "demo.yaml").read_text(encoding="utf-8"))
    return ({f["field_id"]: f for f in d.get("fields", [])}, {p["farmer_profile_id"]: p for p in d.get("profiles", [])})


DEMO_FIELDS, DEMO_PROFILES = _load_demo()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def trust_area(field: dict) -> str:
    """Photo trust is earned per crop and place, never globally."""
    return f"{field['crop']}@{field.get('area_code') or field['country']}"


def diagnosis_gate(d: dict | None, area: str | None = None, store=None) -> tuple[bool, str]:
    if not d:
        return False, "none"
    if d.get("status") == "abstained":
        return False, "model_abstained"
    model = f"{d['model']['name']}@{d['model']['version']}"
    if store is None or not store.trusted_photo_model(model, area):   # server evidence decides; the client flag is ignored
        return False, "uncalibrated"
    if d.get("ood_score") is not None and d["ood_score"] > DIAGNOSIS_GATE["max_ood"]:
        return False, "out_of_distribution"
    if d["labels"][0]["prob"] < DIAGNOSIS_GATE["min_top1"]:
        return False, "low_confidence"
    return True, "ok"


def _facts_used(cond: dict):
    if "all" in cond or "any" in cond:
        for c in cond.get("all", []) + cond.get("any", []):
            yield from _facts_used(c)
    elif cond:
        yield cond["fact"]


def _receipt(rule: dict, snap: dict, facts: dict, advice: dict, plan_ctx: dict, today: date) -> dict:
    docs = manifest()
    sources = []
    for s in rule["sources"]:
        d = docs[s["doc_id"]]
        sources.append({"doc_id": s["doc_id"], "title": d["title"], "publisher": d["publisher"], "url": d["url"],
                        "page": s["page"], "quote": s["quote"], "quote_sha256": s["quote_sha256"],
                        "licence_status": d["licence_status"], "acknowledgement": d.get("acknowledgement", ""),
                        "language": d.get("language", "en")})
    used = set(_facts_used(rule.get("when", {})))
    derived = [f for f in FACT_PARAMS if f in used]
    data = []
    fc = snap.get("forecast") or {}
    prec = (snap.get("location") or {}).get("precision", "fuzzed_1km")
    days = [d for d in fc.get("days") or [] if d.get("date", "") >= today.isoformat()][:snap_mod.WINDOW_DAYS]
    for f in derived:
        for d in days:
            for var in FACT_VARIABLES[f]:
                if d.get(var) is not None:
                    data.append({"source": fc["source"], "variable": f"{var}[{d['date']}]", "value": d[var], "unit": UNITS[var],
                                 "observed_at": fc["issued_at"], "forecast_for": d["date"], "retrieved_at": fc["issued_at"],
                                 "location_precision": prec})
        if facts.get(f) is not None:  # a rule can fire through another branch while this fact is unknown
            issued = fc.get("issued_at") or snap["created_at"]
            data.append({"source": "krishiloop:derived", "variable": f, "value": facts[f], "unit": "days",
                         "observed_at": issued, "retrieved_at": issued, "location_precision": prec})
    diag = facts.get("_diagnosis")
    if diag and used & {"diagnosis_label", "diagnosis_prob"}:
        model = diag["model"]
        for var, value, unit in (("leaf_diagnosis", diag["labels"][0]["label"], "label"), ("leaf_diagnosis_prob", diag["labels"][0]["prob"], "probability")):
            data.append({"source": f"on-device-model:{model['name']}@{model['version']}", "variable": var, "value": value,
                         "unit": unit, "observed_at": diag["created_at"], "retrieved_at": diag["created_at"], "location_precision": prec})
    params = {p["name"]: p for p in rule.get("reviewer_parameters", [])}
    defs = pack_parameter_defs(rule["pack_id"])
    for f in derived:
        for name in FACT_PARAMS[f]:
            if name in defs:
                params.setdefault(name, defs[name])
    basis = rule.get("basis_note") or ("Forecast-dependent decision using reviewer-set thresholds (shown below); forecasts can be wrong."
                                       if derived else "Direct practice statement from the cited source.")
    photo = {"area_trust_ref": facts["_area_trust"]} if diag and used & {"diagnosis_label", "diagnosis_prob"} else {}
    return {"receipt_id": str(uuid.uuid4()), "claim": advice["action_id"], "advice": advice, "plan": plan_ctx,
            "sources": sources, "data": data, **photo,
            "rule_refs": [{"rule_id": rule["rule_id"], "version": rule["version"], "credential_id": PLACEHOLDER_CRED,
                           "review_level": rule.get("review", {}).get("level", "pending")}],
            "reviewer_parameters": list(params.values()),
            "confidence": {"level": "medium" if derived else "high", "basis": basis},
            "generated_by": {"planner_version": PLANNER_VERSION, "validator_version": VALIDATOR_VERSION, "phrasing_model": None},
            "created_at": _now()}


def make_plan(field: dict, profile: dict, store, snap: dict | None = None, today: date | None = None,
              inbox_dir=None, diagnosis: dict | None = None) -> dict:
    today = today or date.today()
    pack_id = field["pack_id"]
    rules = load_pack(pack_id)
    snap = snap or snap_mod.build(field)
    facts = {"stage": field["stage"], **snap_mod.weather_facts(snap, pack_parameters(pack_id), today),
             **{k: v for k, v in profile.items() if k != "farmer_profile_id"}}
    valid_to = today + timedelta(days=6)
    base = {"plan_id": str(uuid.uuid4()), "pack_id": pack_id, "field_id": field["field_id"],
            "farmer_profile_id": profile["farmer_profile_id"], "crop": field["crop"], "stage": field["stage"],
            "valid_from": today.isoformat(), "valid_to": valid_to.isoformat(), "generated_at": _now(),
            "snapshot_id": snap["snapshot_id"], "data_mode": snap.get("mode", "live"), "data_as_of": snap["created_at"]}

    def abstain(code: str, details: dict) -> dict:
        reason = {"en": REASONS[code]}
        item_id = inbox.create(field["field_id"], profile["farmer_profile_id"], code, reason,
                               {**details, "pack_id": pack_id, "snapshot_id": snap["snapshot_id"]}, inbox_dir)
        return {**base, "status": "abstained", "abstention": {"reason_code": code, "reason": reason, "inbox_item_id": item_id}}

    if diagnosis is not None:
        passed, note = diagnosis_gate(diagnosis, trust_area(field), store)
        base["diagnosis_used"], base["diagnosis_note"] = passed, note
        if passed:
            model, area = f"{diagnosis['model']['name']}@{diagnosis['model']['version']}", trust_area(field)
            facts.update(diagnosis_label=diagnosis["labels"][0]["label"], diagnosis_prob=diagnosis["labels"][0]["prob"],
                         _diagnosis=diagnosis,
                         _area_trust={"credential_id": store.trusted_photo_model(model, area), "area": area, "model": model})
        else:  # the photo becomes an officer case; the weather-based plan below still stands
            inbox.create(field["field_id"], profile["farmer_profile_id"],
                         "out_of_distribution" if note == "out_of_distribution" else "low_confidence",
                         {"en": "Photo check was not sure. Sent to your officer's inbox."},
                         {"gate": note, "model": diagnosis.get("model"), "severity": diagnosis.get("severity"),
                          "symptoms": diagnosis.get("symptoms")}, inbox_dir,
                         extra={"diagnosis_id": diagnosis["diagnosis_id"], "top_labels": diagnosis["labels"][:3]})

    if snap.get("mode") != "live" and snap_mod.age_hours(snap) > MAX_SNAPSHOT_AGE_H:
        return abstain("data_stale", {"data_as_of": snap["created_at"]})

    fired, unknown_decisions, recalled_decisions = [], [], []
    # photo-trust policy v1 (rules/policy/photo-trust.yaml): tier 2 is off, so a photo reading may shape practices
    # but never an input decision; decision rules do not see it at all
    decision_facts = {k: v for k, v in facts.items() if k not in PHOTO_FACTS}
    for r in rules:
        is_decision = r["action"]["kind"] == "input_decision"
        result, missing = evaluate(r, decision_facts if is_decision else facts)
        if result is None and is_decision:
            unknown_decisions.append((r["rule_id"], sorted(missing)))
        elif result:
            if store.is_recalled(r["rule_id"], r["version"]):
                if is_decision:
                    recalled_decisions.append(f"{r['rule_id']} v{r['version']}")
                continue
            fired.append(r)
    if unknown_decisions:
        return abstain("data_unavailable", {"unknown_rules": unknown_decisions})
    decisions = [r for r in fired if r["action"]["kind"] == "input_decision"]
    if not decisions:
        if recalled_decisions:
            return abstain("rule_recalled", {"recalled": recalled_decisions})
        return abstain("no_matching_rule", {})
    if len({r["action"]["decision"] for r in decisions}) > 1:
        return abstain("conflicting_rules", {"rules": [r["rule_id"] for r in decisions]})

    def rank(r):
        boost = 0
        if r.get("boost_when"):  # personalisation declared in the rule, e.g. poor drainage promotes drainage advice
            hit, _ = evaluate(r, facts, r["boost_when"])
            boost = -1 if hit else 0
        return (boost, LIGHT_RANK.get(r["action"].get("traffic_light"), 3), r["rule_id"])
    chosen = [sorted(decisions, key=rank)[0]] + sorted([r for r in fired if r["action"]["kind"] != "input_decision"], key=rank)[:2]

    field_ref = hashlib.sha256(f"krishiloop-field:{field['field_id']}".encode()).hexdigest()[:16]
    plan_ctx = {"plan_id": base["plan_id"], "pack_id": pack_id, "crop": field["crop"], "stage": field["stage"],
                "valid_from": base["valid_from"], "valid_to": base["valid_to"], "field_ref": field_ref,
                "data_mode": base["data_mode"], "data_as_of": base["data_as_of"]}
    actions = []
    for r in chosen:  # validate everything before minting any credential (no orphans)
        aid = f"A-{r['rule_id'].lower()}-{uuid.uuid4().hex[:6]}"
        act = {"action_id": aid, "kind": r["action"]["kind"], "title": dict(r["action"]["title"])}
        for k in ("decision", "traffic_light"):
            if r["action"].get(k):
                act[k] = r["action"][k]
        advice = {**act, "phrasing_model": None}
        act["receipt"] = _receipt(r, snap, facts, advice, plan_ctx, today)
        problems = validate_action(act)
        if problems:
            return abstain("validator_blocked", {"rule_id": r["rule_id"], "problems": problems})
        actions.append((r, act))
    valid_until = f"{(valid_to + timedelta(days=1)).isoformat()}T23:59:59Z"
    try:
        for r, act in actions:
            act["receipt"]["rule_refs"][0]["credential_id"] = store.rule_credential(r)["id"]
            act["receipt_credential_id"] = store.receipt_credential(act["receipt"], valid_until)["id"]
    except RuleRecalled as e:  # recalled between evaluation and issuance
        return abstain("rule_recalled", {"recalled": [str(e)]})
    factors = [{"name": "soil_drainage", "value": profile.get("soil_drainage", "unknown"),
                "effect": {"en": "Drainage advice ranked higher." if profile.get("soil_drainage") == "poor" else "No drainage boost."}}]
    if "crop_protected" in profile:
        factors.append({"name": "crop_protected", "value": str(profile["crop_protected"]).lower(),
                        "effect": {"en": "Protection status changes the spray decision."}})
    return {**base, "status": "ok", "actions": [a for _, a in actions], "personalization": {"factors": factors}}
