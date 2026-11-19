"""Village outbreak radar (services/engine/radar.py, radar_geo.py) and the KrishiGuard API block of services/api/main.py.

k-anonymity: a cell (area, problem) is shown only with at least 3 distinct reporters (devices), and a hidden cell says
nothing about where or what. The SIMULATED scenario is seeded, labelled, and can never be aggregated with real reports.
"Warn neighbours" reaches only this session's holders in that area, through the Reach sandbox outbox.
"""
import json
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from services.engine import inbox, radar, radar_geo
from services.engine.planner import DEMO_FIELDS
from services.trust.store import TrustStore

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)
BASE = "https://krishiloop.example"


def ago(days, hours=0):
    return (NOW - timedelta(days=days, hours=hours)).isoformat().replace("+00:00", "Z")


def rec(reporter, area="BD-mymensingh", problem="bacterial_leaf_blight", days=1, kind="photo", sim=False):
    return radar.record(area, problem, kind, reporter, ago(days), simulated=sim)


# ---------------------------------------------------------------------------------------------- areas
def test_the_sample_points_fall_in_the_right_district_and_county():
    assert radar_geo.area_of(24.75, 90.4)["code"] == "BD-mymensingh"           # BD-SAMPLE-01/02
    assert radar_geo.area_of(-0.75, 36.6)["code"] == "KE-nyandarua"            # KE-SAMPLE-01
    assert radar_geo.area_of(23.81, 90.41)["name"] == "Dhaka"
    assert radar_geo.area_of(0.0, 0.0) is None                                 # the sea is no area


def test_server_and_map_outlines_have_the_same_areas_and_credit_their_source():
    server = json.loads(radar_geo.AREAS_JSON.read_text(encoding="utf-8"))["countries"]
    for c, n in (("BD", 64), ("KE", 47)):
        web = json.loads((radar_geo.WEB_GEO / f"{c.lower()}.json").read_text(encoding="utf-8"))
        assert len(web["areas"]) == n == len(server[c]["areas"])
        assert {a["code"] for a in web["areas"]} == {a["code"] for a in server[c]["areas"]}
        assert web["licence"] in ("CC BY 3.0 IGO", "Public Domain") and "geoBoundaries" in web["source"]
        assert len(json.dumps(web)) < 40_000                                    # small enough to load lazily


# ---------------------------------------------------------------------------------------------- k-anonymity
def test_a_cell_needs_three_distinct_reporters():
    two = [rec("a"), rec("a", days=2), rec("b"), rec("b", days=3)]        # 4 reports, 2 reporters
    agg = radar.aggregate(two, NOW)
    assert agg["cells"] == [] and agg["hidden"] == {"reports": 4, "cells": 1}
    three = two + [rec("c")]
    agg = radar.aggregate(three, NOW)
    assert len(agg["cells"]) == 1
    c = agg["cells"][0]
    assert (c["area"], c["problem"], c["reports"], c["reporters"]) == ("BD-mymensingh", "bacterial_leaf_blight", 5, 3)
    assert c["area_name"] == "Mymensingh" and c["level"] == "district" and agg["hidden"]["reports"] == 0


def test_a_hidden_cell_never_says_where_or_what():
    agg = radar.aggregate([rec("a", area="BD-sylhet", problem="tungro")], NOW)
    text = json.dumps(agg)
    assert "sylhet" not in text and "tungro" not in text and agg["hidden"]["reports"] == 1


def test_one_farmer_reporting_many_times_is_still_one_reporter():
    agg = radar.aggregate([rec("same", days=d) for d in range(10)], NOW)
    assert agg["cells"] == [] and agg["hidden"]["reports"] == 10


def test_only_the_last_14_days_count_and_healthy_readings_are_not_reports():
    old = [rec(x, days=15) for x in "abc"]
    healthy = [rec(x, problem="Rice healthy") for x in "abc"]
    assert radar.aggregate(old + healthy, NOW)["cells"] == []
    assert len(radar.aggregate([rec(x, days=13) for x in "abc"], NOW)["cells"]) == 1


def test_cells_are_per_area_and_problem():
    recs = [rec(x) for x in "abc"] + [rec(x, problem="blast") for x in "ab"] + [rec(x, area="BD-tangail") for x in "abc"]
    agg = radar.aggregate(recs, NOW)
    assert {(c["area"], c["problem"]) for c in agg["cells"]} == {("BD-mymensingh", "bacterial_leaf_blight"),
                                                                 ("BD-tangail", "bacterial_leaf_blight")}
    assert agg["hidden"] == {"reports": 2, "cells": 1}


# ---------------------------------------------------------------------------------------------- the simulation
def test_the_simulation_is_seeded_labelled_and_never_mixed_with_real_reports():
    a, b = radar.simulate(NOW), radar.simulate(NOW)
    assert a == b and all(r["simulated"] for r in a)
    sim = radar.simulated(NOW)
    assert sim["simulated"] is True and sim["label"].startswith("SIMULATED")
    with pytest.raises(ValueError, match="never aggregated together"):
        radar.aggregate(a + [rec("real")], NOW)
    real = radar.aggregate([rec(x) for x in "abc"], NOW)
    assert real["simulated"] is False and real["cells"][0]["reports"] == 3       # untouched by the simulation


def test_the_simulation_shows_hiding_too():
    sim = radar.simulated(NOW)
    shown = {(c["area"], c["problem"]) for c in sim["cells"]}
    assert ("BD-mymensingh", "bacterial_leaf_blight") in shown and ("KE-nyandarua", "late_blight") in shown
    assert ("BD-kishoreganj", "blast") not in shown and sim["hidden"]["cells"] == 2
    assert all(c["reporters"] >= radar.K_MIN for c in sim["cells"])


def test_the_recorded_simulation_the_web_app_shows_is_exactly_this_code():
    assert json.loads(radar.SIMULATED_OUT.read_text(encoding="utf-8")) == json.loads(json.dumps(radar.recorded_simulation())), \
        "run: python -m services.engine.radar --record"


# ---------------------------------------------------------------------------------------------- real reports
def test_reports_come_from_photo_cases_abstentions_and_questions_but_not_visit_requests():
    items = [
        {"field_id": "BD-SAMPLE-02", "reason_code": "no_rule_for_problem", "question": "blast on my rice?",
         "details": {"problems_named": ["blast"]}, "created_at": ago(1)},
        {"field_id": "BD-SAMPLE-01", "reason_code": "low_confidence", "top_labels": [{"label": "Brown spot", "prob": 0.4}],
         "diagnosis_id": "d1", "created_at": ago(2)},
        {"field_id": "BD-SAMPLE-01", "reason_code": "data_unavailable", "created_at": ago(2)},
        {"field_id": "BD-SAMPLE-01", "reason_code": "visit_request", "question": "please come", "created_at": ago(1)},
        {"field_id": "NOWHERE", "reason_code": "data_unavailable", "created_at": ago(1)},
    ]
    cases = [{"field_id": "KE-SAMPLE-01", "created_at": ago(3), "verdict": None, "suggestion": [{"label": "late_blight"}]}]
    out = radar.reports_from(items, cases, DEMO_FIELDS, "session:abc")
    got = sorted((r["area"], r["problem"], r["kind"]) for r in out)
    assert got == [("BD-mymensingh", "blast", "ask"), ("BD-mymensingh", "brown_spot", "photo"),
                   ("BD-mymensingh", "unidentified", "abstention"), ("KE-nyandarua", "late_blight", "photo")]
    assert len({r["reporter"] for r in out}) == 1 and "abc" not in out[0]["reporter"]    # one device, id hashed


def test_collect_counts_each_demo_session_as_one_device(tmp_path):
    for sid in ("s1", "s2", "s3"):
        inbox.create("BD-SAMPLE-02", "demo-farmer-d", "no_rule_for_problem", {"en": "x"},
                     {"problems_named": ["blast"]}, tmp_path / "demo" / sid / "inbox", extra={"question": "blast?"})
    # one session sends two more, from two farmers: still one device
    for p in ("demo-farmer-c", "demo-farmer-d"):
        inbox.create("BD-SAMPLE-01", p, "no_rule_for_problem", {"en": "x"}, {"problems_named": ["tungro"]},
                     tmp_path / "demo" / "s1" / "inbox", extra={"question": "tungro?"})
    now = datetime.now(timezone.utc)
    agg = radar.aggregate(radar.collect(tmp_path / "demo", tmp_path / "official", DEMO_FIELDS, now), now)
    assert [(c["problem"], c["reporters"]) for c in agg["cells"]] == [("blast", 3)]
    assert agg["hidden"] == {"reports": 2, "cells": 1}


# ---------------------------------------------------------------------------------------------- the API, end to end
def _snap(field_id: str) -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 60, "tmin_c": 20, "tmax_c": 30,
             "precip_mm": 45.0 if i == 2 else 0.0} for i in range(7)]
    return {"snapshot_id": f"snap-{field_id}-t", "field_id": field_id, "mode": "live",
            "location": {"precision": "sample_location", "country": field_id[:2]}, "created_at": now,
            "forecast": {"source": "open-meteo:forecast", "issued_at": now, "days": days}, "flood": None}


@pytest.fixture()
def api(tmp_path, monkeypatch):
    import services.api.main as m
    monkeypatch.setattr(m, "_store", TrustStore(BASE, "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust"))
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.delenv("KRISHILOOP_REACH_DB", raising=False)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(inbox, "INBOX_DIR", tmp_path / "inbox")
    monkeypatch.setattr(m, "_hits", defaultdict(deque))
    monkeypatch.setattr(m, "_plan_cache", {})
    snaps = tmp_path / "snapshots"
    snaps.mkdir()
    monkeypatch.setattr(m.snap_mod, "SNAP_DIR", snaps)

    def build(field):
        s = _snap(field["field_id"])
        (snaps / f"{field['field_id']}.json").write_text(json.dumps(s), encoding="utf-8")
        return s
    monkeypatch.setattr(m.snap_mod, "build", build)
    monkeypatch.setattr(m.reach, "_dbs", {})
    monkeypatch.setattr(m.reach, "telegram_transport", lambda: None)
    return m, TestClient(m.app)


def test_the_climate_endpoint_returns_the_shield_for_the_plans_own_snapshot(api):
    m, client = api
    sid = client.post("/api/demo/session").json()["session_id"]
    plan = client.post(f"/api/demo/{sid}/plan", json={"field_id": "BD-SAMPLE-02", "profile_id": "demo-farmer-d"}).json()
    r = client.get("/api/climate", params={"field_id": "BD-SAMPLE-02", "profile_id": "demo-farmer-d",
                                           "snapshot_id": plan["snapshot_id"], "sid": sid})
    assert r.status_code == 200, r.text
    rain = {c["kind"]: c for c in r.json()["checks"]}["heavy_rain"]
    assert rain["level"] == "warn" and rain["rule"]["rule_id"] == "R-BDR-009"
    # a recall of R-BDR-009 in this session: the shield stops citing it at once
    assert client.post(f"/api/demo/{sid}/recall", json={"rule_id": "R-BDR-009", "version": 1}).status_code == 200
    rain = {c["kind"]: c for c in client.get("/api/climate", params={"field_id": "BD-SAMPLE-02", "snapshot_id": plan["snapshot_id"],
                                                                      "sid": sid}).json()["checks"]}["heavy_rain"]
    assert rain["rule"] is None and rain["rule_withdrawn"] == "R-BDR-009 v1"
    assert client.get("/api/climate", params={"field_id": "BD-SAMPLE-01", "snapshot_id": plan["snapshot_id"]}).status_code == 404
    assert client.get("/api/climate", params={"field_id": "XX", "snapshot_id": "s"}).status_code == 404


def test_the_radar_endpoint_keeps_real_and_simulated_apart(api):
    m, client = api
    sid = client.post("/api/demo/session").json()["session_id"]
    client.post(f"/api/demo/{sid}/plan", json={"field_id": "BD-SAMPLE-02", "profile_id": "demo-farmer-d"})
    inbox.create("BD-SAMPLE-02", "demo-farmer-d", "no_rule_for_problem", {"en": "x"}, {"problems_named": ["blast"]},
                 m.ROOT / "data" / "demo" / sid / "inbox", extra={"question": "blast?"})
    r = client.get("/api/radar").json()
    assert r["real"]["simulated"] is False and r["real"]["cells"] == [] and r["real"]["hidden"]["reports"] >= 1
    assert r["simulated"]["simulated"] is True and r["simulated"]["cells"]
    assert r["field_areas"]["BD-SAMPLE-02"]["code"] == "BD-mymensingh"


def test_warn_neighbours_reaches_this_sessions_holders_in_the_area_once(api):
    m, client = api
    sid = client.post("/api/demo/session").json()["session_id"]
    bd = client.post(f"/api/demo/{sid}/plan", json={"field_id": "BD-SAMPLE-02", "profile_id": "demo-farmer-d"}).json()
    ke = client.post(f"/api/demo/{sid}/plan", json={"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a"}).json()
    bd_cid = next(a["receipt_credential_id"] for a in bd["actions"])
    ke_cid = next(a["receipt_credential_id"] for a in ke["actions"])
    client.post(f"/api/demo/{sid}/reach/sms", json={"credential_id": bd_cid, "phone": "+8801712345678", "lang": "bn"})
    client.post(f"/api/demo/{sid}/reach/sms", json={"credential_id": ke_cid, "phone": "+254712345678", "lang": "en"})
    body = {"area": "BD-mymensingh", "problem": "bacterial_leaf_blight", "layer": "simulated"}
    r = client.post(f"/api/demo/{sid}/radar/warn", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["total"] == 1 and out["sms_sandbox"] == 1 and out["simulated"] is True
    assert out["recipients"][0]["to"].startswith("+880") and "1712345678" not in json.dumps(out)
    assert out["text"]["en"].startswith("SIMULATED") and "ask your officer before you spray" in out["text"]["en"]
    notice = [row for row in m.reach.outbox().read() if row.get("kind") == "radar_notice"]
    assert len(notice) == 1 and notice[0]["text"].startswith("সিমুলেশন") and notice[0]["status"] == "sandbox"
    # once per holder, area, problem and day
    assert client.post(f"/api/demo/{sid}/radar/warn", json=body).json()["total"] == 0
    # a cell that is not shown (real layer, fewer than 3 devices) cannot be warned about
    r = client.post(f"/api/demo/{sid}/radar/warn", json={**body, "layer": "real"})
    assert r.status_code == 409
    assert client.post(f"/api/demo/{sid}/radar/warn", json={**body, "area": "../etc"}).status_code == 422


def test_the_visit_endpoint_puts_a_masked_request_in_the_sessions_officer_inbox(api):
    m, client = api
    sid = client.post("/api/demo/session").json()["session_id"]
    when = (date.today() + timedelta(days=3)).isoformat()
    r = client.post(f"/api/demo/{sid}/visit", json={"field_id": "BD-SAMPLE-02", "profile_id": "demo-farmer-d", "date": when,
                                                    "slot": "evening", "mode": "visit", "phone": "01712345678",
                                                    "note": "Brown patches", "lang": "bn"})
    assert r.status_code == 200, r.text
    items = client.get(f"/api/demo/{sid}/inbox").json()["items"]
    it = next(i for i in items if i["item_id"] == r.json()["item_id"])
    assert it["reason_code"] == "visit_request" and it["question"] == "Brown patches"
    assert it["details"]["phone_masked"] == r.json()["phone_masked"] and "1712345678" not in json.dumps(items)
    late = (date.today() + timedelta(days=20)).isoformat()
    bad = client.post(f"/api/demo/{sid}/visit", json={"field_id": "BD-SAMPLE-02", "profile_id": "demo-farmer-d", "date": late,
                                                      "slot": "evening"})
    assert bad.status_code == 422 and "14 days" in bad.json()["detail"]
