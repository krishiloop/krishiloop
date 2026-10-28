"""End-to-end (offline): rules -> plan -> signed receipts -> verify -> recall. Plus pack tests and safety checks."""
import copy
import json
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from services.engine import planner as planner_mod
from services.engine.planner import DEMO_FIELDS, DEMO_PROFILES, make_plan
from services.engine.rules import load_pack, run_pack_tests
from services.engine.validator import doses, validate_action
from services.trust.store import TrustStore
from services.trust.vc import verify_receipt

ROOT = Path(__file__).resolve().parents[1]
FIELD = DEMO_FIELDS["KE-SAMPLE-01"]
TODAY = date.today()


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _snap(humid: bool, days: int = 7, age_h: float = 0, **drop):
    """A cached snapshot. drop={'rh_mean_pct': 2} removes that variable from day 2."""
    rh, tmin, tmax = (95, 12, 20) if humid else (60, 12, 24)
    made = datetime.now(timezone.utc) - timedelta(hours=age_h)
    out = []
    for i in range(days):
        d = {"date": (TODAY + timedelta(days=i)).isoformat(), "rh_mean_pct": rh, "tmin_c": tmin, "tmax_c": tmax, "precip_mm": 1.0}
        for var, day in drop.items():
            if day == i:
                d.pop(var)
        out.append(d)
    return {"snapshot_id": "snap-test", "field_id": FIELD["field_id"], "mode": "snapshot",
            "location": {"lat": FIELD["lat"], "lon": FIELD["lon"], "precision": "sample_location", "country": "KE"},
            "crop": "potato", "stage": "vegetative", "s2": None, "flood": None, "created_at": _iso(made),
            "forecast": {"source": "open-meteo:forecast", "issued_at": _iso(made), "days": out}}


@pytest.fixture()
def store(tmp_path):
    return TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust")


def plan_for(store, tmp_path, profile="demo-farmer-a", **kw):
    snap = kw.pop("snap", None) or _snap(kw.pop("humid", True))
    return make_plan(FIELD, DEMO_PROFILES[profile] if isinstance(profile, str) else profile, store, snap=snap,
                     inbox_dir=tmp_path / "inbox")


def _plan_validator():
    reg, schemas = Registry(), {}
    for p in (ROOT / "contracts/schemas").glob("*.schema.json"):
        s = json.loads(p.read_text(encoding="utf-8")); schemas[p.name] = s
        reg = reg.with_resource(s["$id"], Resource.from_contents(s))
    return Draft202012Validator(schemas["plan.schema.json"], registry=reg, format_checker=FormatChecker())


def _decision(plan):
    return [a for a in plan["actions"] if a["kind"] == "input_decision"]


def test_pack_rule_tests_pass():
    assert run_pack_tests("pack-potato-late-blight") == []


def test_humid_unprotected_gives_red_contact_officer(store, tmp_path):
    plan = plan_for(store, tmp_path)
    assert plan["status"] == "ok", plan
    decision = _decision(plan)[0]
    assert decision["traffic_light"] == "red" and decision["receipt"]["rule_refs"][0]["rule_id"] == "R-PLB-008"
    assert not list(_plan_validator().iter_errors(plan))


def test_dry_or_protected_gives_green_dont_spray(store, tmp_path):
    for humid, profile in ((False, "demo-farmer-a"), (True, "demo-farmer-b")):
        plan = plan_for(store, tmp_path, profile, humid=humid)
        decision = _decision(plan)[0]
        assert decision["decision"] == "dont_spray" and decision["traffic_light"] == "green"
        assert not list(_plan_validator().iter_errors(plan))


def test_two_farmers_get_different_plans(store, tmp_path):
    a, b = plan_for(store, tmp_path, "demo-farmer-a"), plan_for(store, tmp_path, "demo-farmer-b")
    assert [x["receipt"]["rule_refs"][0]["rule_id"] for x in a["actions"]] != [x["receipt"]["rule_refs"][0]["rule_id"] for x in b["actions"]]


def test_receipt_signs_the_advice_and_its_window(store, tmp_path):
    plan = plan_for(store, tmp_path)
    cred = store.get(_decision(plan)[0]["receipt_credential_id"])
    subject = cred["credentialSubject"]
    assert subject["advice"]["decision"] == "recheck" and subject["advice"]["traffic_light"] == "red"
    assert subject["plan"]["valid_to"] == plan["valid_to"] and "validUntil" in cred
    forged = copy.deepcopy(cred)
    forged["credentialSubject"]["advice"]["title"]["en"] = "No spray needed."
    assert verify_receipt(forged, store.get, store.resolve_key)["status"] == "invalid"


def test_missing_weather_abstains(store, tmp_path):
    s = _snap(True); s["forecast"] = None
    plan = plan_for(store, tmp_path, snap=s)
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "data_unavailable"


@pytest.mark.parametrize("profile,humid,drop", [("demo-farmer-a", False, {"rh_mean_pct": 2}),
                                                ("demo-farmer-a", False, {"tmin_c": 0}),
                                                ("demo-farmer-b", True, {"precip_mm": 3})])
def test_partial_weather_gap_never_means_no_risk(store, tmp_path, profile, humid, drop):
    plan = plan_for(store, tmp_path, profile, snap=_snap(humid, **drop))
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "data_unavailable"


def test_gap_in_an_irrelevant_variable_does_not_block(store, tmp_path):
    # dry week: the decision does not depend on rain, so a missing rain value must not block it
    plan = plan_for(store, tmp_path, "demo-farmer-b", snap=_snap(False, precip_mm=3))
    assert plan["status"] == "ok" and _decision(plan)[0]["decision"] == "dont_spray"


def test_short_forecast_abstains(store, tmp_path):
    plan = plan_for(store, tmp_path, snap=_snap(False, days=2))
    assert plan["status"] == "abstained"


def test_stale_snapshot_abstains(store, tmp_path):
    plan = plan_for(store, tmp_path, snap=_snap(True, age_h=72))
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "data_stale"


def test_abstention_message_is_fixed_and_details_go_to_the_inbox(store, tmp_path):
    s = _snap(True); s["forecast"] = None
    plan = plan_for(store, tmp_path, snap=s)
    item = json.loads((tmp_path / "inbox" / f"{plan['abstention']['inbox_item_id']}.json").read_text(encoding="utf-8"))
    assert item["reason_code"] == "data_unavailable" and "unknown_rules" in item["details"]
    assert "forecast" not in plan["abstention"]["reason"]["en"].lower()


def test_receipt_verifies_then_recall(store, tmp_path):
    plan = plan_for(store, tmp_path)
    cid = plan["actions"][0]["receipt_credential_id"]
    assert store.verify(cid)["status"] == "authentic"
    store.recall_rule("R-PLB-008", 1)
    assert store.verify(cid)["status"] == "recalled"


def test_recall_stops_the_planner(store, tmp_path):
    assert _decision(plan_for(store, tmp_path))[0]["receipt"]["rule_refs"][0]["rule_id"] == "R-PLB-008"
    store.recall_rule("R-PLB-008", 1)
    plan = plan_for(store, tmp_path)
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "rule_recalled"


def test_recall_before_first_issue_is_kept(store, tmp_path):
    assert store.recall_rule("R-PLB-011", 2) == []
    plan = plan_for(store, tmp_path, humid=False)
    assert plan["status"] == "abstained" and plan["abstention"]["reason_code"] == "rule_recalled"


def test_concurrent_plans_share_one_rule_credential(store, tmp_path):
    plans = []
    threads = [threading.Thread(target=lambda: plans.append(plan_for(store, tmp_path))) for _ in range(12)]
    for t in threads: t.start()
    for t in threads: t.join()
    store.recall_rule("R-PLB-008", 1)
    ids = [_decision(p)[0]["receipt_credential_id"] for p in plans]
    assert len(ids) == 12 and all(store.verify(i)["status"] == "recalled" for i in ids)


def test_exactly_one_input_decision(store, tmp_path, monkeypatch):
    rules = list(load_pack("pack-potato-late-blight"))
    twin = copy.deepcopy(next(r for r in rules if r["rule_id"] == "R-PLB-011"))
    twin["rule_id"], twin["rule_sha256"] = "R-PLB-099", "9" * 64
    monkeypatch.setattr(planner_mod, "load_pack", lambda pack_id: tuple(rules + [twin]))
    plan = plan_for(store, tmp_path, humid=False)
    assert plan["status"] == "ok" and len(_decision(plan)) == 1


def test_identity_switch_never_reuses_state(tmp_path):
    TrustStore("https://a.example", "did:web:a.example", "11" * 32, data_dir=tmp_path / "t")
    with pytest.raises(RuntimeError):
        TrustStore("https://b.example", "did:web:b.example", "22" * 32, data_dir=tmp_path / "t")


@pytest.mark.parametrize("bad", ["..\\..\\secret", "C:\\Windows\\win.ini", "../x", "a<b", "", "urn:uuid:not-a-uuid"])
def test_credential_ids_cannot_escape_the_store(store, bad):
    with pytest.raises(FileNotFoundError):
        store.get(bad)
    assert store.verify(bad)["status"] == "invalid"


def test_validator_blocks_doses_and_brands():
    act = {"title": {"en": "Spray Trooper at 1 g/L now"}, "receipt": {"sources": [{"quote": "Use healthy seed."}], "rule_refs": [{}]}}
    problems = validate_action(act)
    assert any("dose" in p for p in problems) and any("brand" in p for p in problems)


@pytest.mark.parametrize("text", ["Use a 5% solution now", "Mix 2 kgs per acre", "Apply 1 lb per acre", "Add 2 tbsp per tank",
                                  "Add two grams per litre", "প্রতি লিটার পানিতে ২ গ্রাম দিন", "১০ লিটার পানিতে ২০ মিলি",
                                  "২ মিলি/লিটার", "দুই গ্রাম ওষুধ দিন"])
def test_validator_catches_doses_in_english_and_bangla(text):
    act = {"title": {"x": text}, "receipt": {"sources": [{"quote": "Use healthy seed."}], "rule_refs": [{}]}}
    assert any("dose" in p for p in validate_action(act)), text


def test_dose_grounding_is_numeric_not_substring():
    quote = [{"quote": "Use 25 g per 10 l of water."}]
    ok = {"title": {"en": "Use 25 g per 10 l of water."}, "receipt": {"sources": quote, "rule_refs": [{}]}}
    bad = {"title": {"en": "Use 5 g per 10 l of water."}, "receipt": {"sources": quote, "rule_refs": [{}]}}
    assert not any("dose" in p for p in validate_action(ok))
    assert any("dose" in p for p in validate_action(bad))
    assert doses("২০ মিলি") == {(20.0, "ml")}


def test_bangla_brand_is_blocked():
    act = {"title": {"bn": "ট্রুপার স্প্রে করুন"}, "receipt": {"sources": [{"quote": "x"}], "rule_refs": [{}]}}
    assert any("brand" in p for p in validate_action(act))


def test_rule_firing_without_forecast_still_gets_a_receipt(store, tmp_path, monkeypatch):
    # a decision that holds through a non-weather branch must not crash on a missing forecast
    rules = list(load_pack("pack-potato-late-blight"))
    rule = copy.deepcopy(next(r for r in rules if r["rule_id"] == "R-PLB-011"))
    rule["when"] = {"any": [{"fact": "crop_protected", "op": "eq", "value": True},
                            {"fact": "forecast_humid_mild_days", "op": "lt", "value": 2}]}
    others = [r for r in rules if r["rule_id"] != "R-PLB-011" and r["action"]["kind"] != "input_decision"]
    monkeypatch.setattr(planner_mod, "load_pack", lambda pack_id: tuple(others + [rule]))
    s = _snap(True); s["forecast"] = None
    plan = plan_for(store, tmp_path, "demo-farmer-b", snap=s)
    assert plan["status"] == "ok" and _decision(plan)[0]["decision"] == "dont_spray"


def _photo_practice_pack(monkeypatch):
    """The Kenya pack plus one practice that reads a photo diagnosis (test-only; no shipped rule reads photos yet)."""
    rules = load_pack("pack-potato-late-blight")
    practice = copy.deepcopy(next(r for r in rules if r["rule_id"] == "R-PLB-001"))
    practice.update(rule_id="R-PLB-901", when={"all": [{"fact": "diagnosis_label", "op": "eq", "value": "late_blight"}]})
    practice["action"]["traffic_light"] = "red"     # outranks the other practices, so it is always shown
    monkeypatch.setattr(planner_mod, "load_pack", lambda pack_id: list(rules) + [practice])


PHOTO = {"diagnosis_id": "d-9", "crop": "potato", "model": {"name": "leaf", "version": "1", "sha256": "a" * 64},
         "on_device": False, "labels": [{"label": "late_blight", "prob": 0.97}], "calibrated": True, "ood_score": 0.0,
         "status": "ok", "inference_ms": 40, "created_at": "2026-10-28T08:00:00Z"}


def _area_trust(store):
    return store.area_trust_credential({"area": "potato@KE", "model": "leaf@1", "policy_id": "photo-trust", "policy_version": 1,
                                        "verdicts": 120, "sure_in_window": 50, "sure_right_in_window": 49, "precision": 0.98,
                                        "lower_bound": 0.895, "opened_at": "2026-10-28T08:00:00Z"})


def test_photo_advice_carries_the_area_trust_and_falls_with_it(store, tmp_path, monkeypatch):
    _photo_practice_pack(monkeypatch)
    trust = _area_trust(store)
    plan = make_plan(FIELD, DEMO_PROFILES["demo-farmer-a"], store, snap=_snap(True), inbox_dir=tmp_path / "inbox", diagnosis=PHOTO)
    assert plan["diagnosis_used"] is True
    photo_act = next(a for a in plan["actions"] if "R-PLB-901" in a["action_id"].upper())
    assert photo_act["receipt"]["area_trust_ref"] == {"credential_id": trust["id"], "area": "potato@KE", "model": "leaf@1"}
    others = [a for a in plan["actions"] if a is not photo_act]
    assert all("area_trust_ref" not in a["receipt"] for a in others)          # advice that never read the photo
    assert store.verify(photo_act["receipt_credential_id"])["status"] == "authentic"
    store.revoke(trust["id"])                                                 # the area's gate closed: drift
    assert store.trusted_photo_model("leaf@1", "potato@KE") is None          # new photos go to the officer again
    v = store.verify(photo_act["receipt_credential_id"])
    assert v["status"] == "recalled" and "photo trust" in v["reason"]
    assert all(store.verify(a["receipt_credential_id"])["status"] == "authentic" for a in others)


def test_a_photo_never_changes_an_input_decision(store, tmp_path, monkeypatch):
    _photo_practice_pack(monkeypatch)
    _area_trust(store)
    without = plan_for(store, tmp_path)
    with_photo = make_plan(FIELD, DEMO_PROFILES["demo-farmer-a"], store, snap=_snap(True), inbox_dir=tmp_path / "inbox",
                           diagnosis=dict(PHOTO, labels=[{"label": "healthy", "prob": 0.99}]))
    decision = lambda p: next(a for a in p["actions"] if a["kind"] == "input_decision")
    assert decision(with_photo)["decision"] == decision(without)["decision"]
    assert "area_trust_ref" not in decision(with_photo)["receipt"]
