"""pack-bd-rice runs on the UNCHANGED engine: rules from YAML, demo data from YAML, no pack-specific code anywhere in services/."""
import itertools
import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES, make_plan
from services.engine.rules import evaluate, load_pack, pack_parameters, run_pack_tests
from services.engine.validator import BN_SCRIPT, doses, validate_action
from services.trust.store import TrustStore

ROOT = Path(__file__).resolve().parents[1]
PACK = "pack-bd-rice"
FIELD = DEMO_FIELDS["BD-SAMPLE-01"]
TODAY = date.today()
FEM, NYM, HUM, RAIN = "bph_females_per_hill", "bph_nymphs_per_hill", "forecast_humid_mild_days", "forecast_heavy_rain_days"
STAGES = ["tillering", "booting", "heading", "flowering", "grain_fill", "maturity"]


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _snap(days: int = 7, age_h: float = 0, humid: bool = False, **drop):
    """A cached snapshot for the BD field (same pattern as tests/test_engine.py). drop={'tmin_c': 0} removes that variable from day 0."""
    rh, tmin, tmax = (92, 24, 31) if humid else (55, 24, 31)
    made = datetime.now(timezone.utc) - timedelta(hours=age_h)
    out = []
    for i in range(days):
        d = {"date": (TODAY + timedelta(days=i)).isoformat(), "rh_mean_pct": rh, "tmin_c": tmin, "tmax_c": tmax, "precip_mm": 1.0}
        for var, day in drop.items():
            if day == i:
                d.pop(var)
        out.append(d)
    return {"snapshot_id": "snap-test-bd", "field_id": FIELD["field_id"], "mode": "snapshot",
            "location": {"lat": FIELD["lat"], "lon": FIELD["lon"], "precision": "sample_location", "country": "BD"},
            "crop": "rice", "stage": FIELD["stage"], "s2": None, "flood": None, "created_at": _iso(made),
            "forecast": {"source": "open-meteo:forecast", "issued_at": _iso(made), "days": out}}


@pytest.fixture()
def store(tmp_path):
    return TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust")


def plan_for(store, tmp_path, profile="demo-farmer-d", stage=None, snap=None):
    field = {**FIELD, "stage": stage} if stage else FIELD
    prof = DEMO_PROFILES[profile] if isinstance(profile, str) else profile
    return make_plan(field, prof, store, snap=snap or _snap(), inbox_dir=tmp_path / "inbox")


def _plan_validator():
    reg, schemas = Registry(), {}
    for p in (ROOT / "contracts/schemas").glob("*.schema.json"):
        s = json.loads(p.read_text(encoding="utf-8")); schemas[p.name] = s
        reg = reg.with_resource(s["$id"], Resource.from_contents(s))
    return Draft202012Validator(schemas["plan.schema.json"], registry=reg, format_checker=FormatChecker())


def _decisions(plan):
    return [a for a in plan["actions"] if a["kind"] == "input_decision"]


# ---- the pack itself -------------------------------------------------------------------------------

def test_pack_rule_tests_pass():
    assert run_pack_tests(PACK) == []


def test_pack_has_8_to_12_rules_and_every_rule_has_tests():
    rules = load_pack(PACK)
    assert 8 <= len(rules) <= 12
    for r in rules:
        assert r["tests"], r["rule_id"]
        assert any(t["expect"].startswith("missing fact") for t in r["tests"]), r["rule_id"]  # a missing-fact case on every rule


def test_pack_parameters_are_consistent():
    params = pack_parameters(PACK)  # raises on conflicting values
    assert {"humid_rh_pct_min", "mild_temp_c_range", "heavy_rain_mm"} <= set(params)


def test_every_rule_has_bn_and_en_titles_quotes_and_no_doses():
    for r in load_pack(PACK):
        title = r["action"]["title"]
        assert set(title) == {"bn", "en"}, r["rule_id"]
        assert BN_SCRIPT.search(title["bn"]) and unicodedata.normalize("NFC", title["bn"]) == title["bn"]
        assert r["sources"], r["rule_id"]
        for s in r["sources"]:
            assert s["doc_id"].startswith("DOC-BRRIKB-") and s["page"] and len(s["quote"].split()) <= 25
            assert BN_SCRIPT.search(s["quote"])
        # titles pass the same validator the planner uses (no doses, no brand names), with the rule's own quotes as grounding
        act = {"title": title, "receipt": {"sources": [{"quote": s["quote"]} for s in r["sources"]], "rule_refs": [{}]}}
        assert validate_action(act) == [], r["rule_id"]
        assert not any(doses(t) for t in title.values()), r["rule_id"]


def test_every_decision_rule_has_a_stage_guard_and_the_stage_vocabulary():
    for r in load_pack(PACK):
        if r["action"]["kind"] != "input_decision":
            continue
        guards = [c for c in r["when"]["all"] if c.get("fact") == "stage"]
        assert len(guards) == 1, r["rule_id"]
        assert set(guards[0]["value"]) <= set(STAGES)
    used = {s for r in load_pack(PACK) for c in r["when"]["all"] if c.get("fact") == "stage" for s in (c["value"] if isinstance(c["value"], list) else [c["value"]])}
    assert used <= set(STAGES)


def test_at_most_one_decision_value_fires_for_every_fact_combination():
    """Exhaustive over the facts the rules use; also proves the decision space is covered (exactly one value) for all known facts."""
    rules = [r for r in load_pack(PACK) if r["action"]["kind"] == "input_decision"]
    combos = itertools.product(STAGES, [0, 1, 2, 3, 5], [0, 7, 8, 20], [0, 1, 3, 4, 7], [0, 1, 4])
    n = 0
    for stage, fem, nym, hum, rain in combos:
        facts = {"stage": stage, FEM: fem, NYM: nym, HUM: hum, RAIN: rain}
        fired = {r["action"]["decision"] for r in rules if evaluate(r, facts)[0] is True}
        assert len(fired) == 1, (facts, fired)
        n += 1
    assert n == 6 * 5 * 4 * 5 * 3


def test_unknown_weather_or_counts_never_yield_two_decisions():
    """With a fact missing, a decision rule may be unknown (the planner abstains) but two different decisions must never be True together."""
    rules = [r for r in load_pack(PACK) if r["action"]["kind"] == "input_decision"]
    base = {"stage": "heading", FEM: 1, NYM: 3, HUM: 2, RAIN: 0}
    for drop in itertools.chain([()], ((k,) for k in (FEM, NYM, HUM, RAIN)), itertools.combinations((FEM, NYM, HUM, RAIN), 2)):
        facts = {k: v for k, v in base.items() if k not in drop}
        for stage in STAGES:
            facts["stage"] = stage
            fired = {r["action"]["decision"] for r in rules if evaluate(r, facts)[0] is True}
            assert len(fired) <= 1, (facts, fired)


# ---- end to end on the unchanged engine ------------------------------------------------------------

@pytest.mark.parametrize("profile,decision,light,rule_id", [("demo-farmer-c", "recheck", "red", "R-BDR-001"),
                                                          ("demo-farmer-d", "dont_spray", "green", "R-BDR-002")])
def test_demo_farmers_get_one_receipted_decision(store, tmp_path, profile, decision, light, rule_id):
    plan = plan_for(store, tmp_path, profile)
    assert plan["status"] == "ok", plan
    assert plan["pack_id"] == PACK and plan["crop"] == "rice" and plan["stage"] == "grain_fill"
    decisions = _decisions(plan)
    assert len(decisions) == 1
    d = decisions[0]
    assert d["decision"] == decision and d["traffic_light"] == light
    assert d["receipt"]["rule_refs"][0]["rule_id"] == rule_id
    assert not list(_plan_validator().iter_errors(plan))
    for a in plan["actions"]:  # receipts carry Bangla titles and Bangla sources
        assert BN_SCRIPT.search(a["title"]["bn"]) and BN_SCRIPT.search(a["receipt"]["advice"]["title"]["bn"])
        assert a["receipt"]["sources"] and all(s["language"] == "bn" and s["licence_status"] == "cited_permission_requested" for s in a["receipt"]["sources"])
        assert store.verify(a["receipt_credential_id"])["status"] == "authentic"


def test_decision_texts_match_the_brief(store, tmp_path):
    high = _decisions(plan_for(store, tmp_path, "demo-farmer-c"))[0]["title"]["en"]
    low = _decisions(plan_for(store, tmp_path, "demo-farmer-d"))[0]["title"]["en"]
    assert high.startswith("Above the threshold") and "contact your officer" in high
    assert low.startswith("No spray needed now") and "count again" in low


def test_no_weather_needed_at_grain_fill(store, tmp_path):
    s = _snap(); s["forecast"] = None
    plan = plan_for(store, tmp_path, "demo-farmer-d", snap=s)
    assert plan["status"] == "ok" and _decisions(plan)[0]["decision"] == "dont_spray"


@pytest.mark.parametrize("snap_kw", [{"forecast_none": True}, {"days": 2}, {"tmin_c": 0}, {"rh_mean_pct": 2}])
def test_missing_or_partial_weather_abstains_when_the_decision_depends_on_it(store, tmp_path, snap_kw):
    if snap_kw.get("forecast_none"):
        s = _snap(); s["forecast"] = None
    else:
        s = _snap(**snap_kw)
    plan = plan_for(store, tmp_path, "demo-farmer-d", stage="heading", snap=s)
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "data_unavailable"
    item = json.loads((tmp_path / "inbox" / f"{plan['abstention']['inbox_item_id']}.json").read_text(encoding="utf-8"))
    assert any(rid == "R-BDR-003" for rid, _ in item["details"]["unknown_rules"])


def test_missing_rain_data_alone_also_abstains(store, tmp_path):
    plan = plan_for(store, tmp_path, "demo-farmer-d", stage="heading", snap=_snap(precip_mm=3))
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "data_unavailable"


def test_weather_gap_does_not_block_when_counts_are_high(store, tmp_path):
    s = _snap(); s["forecast"] = None
    plan = plan_for(store, tmp_path, "demo-farmer-c", stage="heading", snap=s)
    assert plan["status"] == "ok" and _decisions(plan)[0]["receipt"]["rule_refs"][0]["rule_id"] == "R-BDR-001"


def test_favourable_weather_at_heading_routes_to_the_officer(store, tmp_path):
    plan = plan_for(store, tmp_path, "demo-farmer-d", stage="heading", snap=_snap(humid=True))
    d = _decisions(plan)[0]
    assert plan["status"] == "ok" and d["decision"] == "recheck" and d["receipt"]["rule_refs"][0]["rule_id"] == "R-BDR-004"
    assert d["receipt"]["reviewer_parameters"] and {p["name"] for p in d["receipt"]["reviewer_parameters"]} >= {"humid_rh_pct_min", "mild_temp_c_range"}
    assert all(p["set_by"] == "team" and "pathologist" in p["note"].lower() for p in d["receipt"]["reviewer_parameters"])
    assert not list(_plan_validator().iter_errors(plan))


def test_calm_weather_at_heading_gives_dont_spray(store, tmp_path):
    plan = plan_for(store, tmp_path, "demo-farmer-d", stage="heading", snap=_snap(humid=False))
    assert plan["status"] == "ok" and _decisions(plan)[0]["decision"] == "dont_spray"


def test_missing_planthopper_count_abstains(store, tmp_path):
    plan = plan_for(store, tmp_path, {"farmer_profile_id": "demo-farmer-x", "soil_drainage": "good"})
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "data_unavailable"


@pytest.mark.parametrize("stage", STAGES)
def test_every_stage_in_the_vocabulary_gets_exactly_one_decision(store, tmp_path, stage):
    for profile in ("demo-farmer-c", "demo-farmer-d"):
        plan = plan_for(store, tmp_path, profile, stage=stage)
        assert plan["status"] == "ok", (stage, profile, plan)
        assert len(_decisions(plan)) == 1 and not list(_plan_validator().iter_errors(plan))


def test_stage_outside_the_vocabulary_has_no_matching_rule(store, tmp_path):
    plan = plan_for(store, tmp_path, "demo-farmer-d", stage="pre_planting")
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "no_matching_rule"


def test_the_engine_has_no_rice_specific_code():
    """Zero engine diff between packs: nothing under services/ mentions the rice pack, its facts, or its rule ids."""
    pattern = re.compile(r"pack-bd-rice|bph_|BD-SAMPLE|R-BDR|brown planthopper|DOC-BRRIKB", re.I)
    hits = [str(p.relative_to(ROOT)) for p in (ROOT / "services").rglob("*.py") if pattern.search(p.read_text(encoding="utf-8"))]
    assert hits == []


def test_manifest_entries_for_the_brri_documents():
    docs = {d["doc_id"]: d for d in yaml.safe_load((ROOT / "corpus" / "manifest.yaml").read_text(encoding="utf-8"))["documents"]}
    used = {s["doc_id"] for r in load_pack(PACK) for s in r["sources"]}
    assert used and all(i in docs for i in used)
    for i in used:
        d = docs[i]
        assert d["licence_status"] == "cited_permission_requested" and d["language"] == "bn" and not d.get("text")
        assert d["publisher"] == "Bangladesh Rice Research Institute (BRRI) — Rice Knowledge Bank" and d["url"].startswith("http")


def test_poor_drainage_promotes_the_standing_water_advice(store, tmp_path):
    """boost_when is declared in the rule YAML; the planner's note 'Drainage advice ranked higher' is true only because of it."""
    first = lambda plan: [a for a in plan["actions"] if a["kind"] != "input_decision"][0]["receipt"]["rule_refs"][0]["rule_id"]
    assert first(plan_for(store, tmp_path, "demo-farmer-c")) == "R-BDR-006"   # poor drainage: standing-water advice first
    assert first(plan_for(store, tmp_path, "demo-farmer-d")) == "R-BDR-005"   # good drainage: normal ranking (amber before green)
    assert any(r.get("boost_when") for r in load_pack(PACK))
