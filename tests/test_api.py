"""API-level safety: path traversal, admin checks, unknown rules, security headers."""
import pytest
from fastapi.testclient import TestClient

from services.api import main
from services.trust.store import TrustStore


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "_store", TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32,
                                                   data_dir=tmp_path / "trust"))
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    return TestClient(main.app)


@pytest.mark.parametrize("path", ["..%5C..%5Csecret", "C:%5CWindows%5Cwin.ini", "a%3Cb", "not-a-uuid"])
def test_credential_paths_cannot_escape(client, path):
    assert client.get(f"/api/credentials/{path}").status_code == 404
    assert client.get(f"/api/verify/{path}").json()["status"] == "invalid"


def test_recall_needs_the_admin_token_and_a_known_rule(client):
    body = {"rule_id": "R-PLB-008", "version": 1}
    assert client.post("/api/admin/recall", json=body).status_code == 403
    assert client.post("/api/admin/recall", json=body, headers={"X-Admin-Token": "wrong"}).status_code == 403
    assert client.post("/api/admin/recall", json={"rule_id": "R-PLB-098", "version": 1},
                       headers={"X-Admin-Token": "test-token"}).status_code == 404
    assert client.post("/api/admin/recall", json={"rule_id": "x"}, headers={"X-Admin-Token": "test-token"}).status_code == 422
    assert client.post("/api/admin/recall", json=body, headers={"X-Admin-Token": "test-token"}).status_code == 200


def test_security_headers(client):
    r = client.get("/health")
    assert r.headers["X-Frame-Options"] == "DENY" and "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]


def test_demo_sandboxes_are_isolated(client, monkeypatch, tmp_path):
    from datetime import date, timedelta
    import services.api.main as m
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 95, "tmin_c": 12, "tmax_c": 20, "precip_mm": 1.0}
            for i in range(7)]
    snap = {"snapshot_id": "snap-x", "field_id": "KE-SAMPLE-01", "mode": "live", "location": {"precision": "sample_location"},
            "created_at": m.snap_mod.datetime.now(m.snap_mod.timezone.utc).isoformat().replace("+00:00", "Z"),
            "forecast": {"source": "open-meteo:forecast", "issued_at": "2026-10-28T00:00:00Z", "days": days}}
    monkeypatch.setattr(m.snap_mod, "build", lambda field: snap)
    a, b = client.post("/api/demo/session").json()["session_id"], client.post("/api/demo/session").json()["session_id"]
    body = {"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a"}
    pa, pb = client.post(f"/api/demo/{a}/plan", json=body).json(), client.post(f"/api/demo/{b}/plan", json=body).json()
    ca, cb = pa["actions"][0]["receipt_credential_id"], pb["actions"][0]["receipt_credential_id"]
    assert client.get(f"/api/verify/{ca}").json()["status"] == "authentic"
    assert client.post(f"/api/demo/{a}/recall", json={"rule_id": "R-PLB-008", "version": 1}).status_code == 200
    va, vb = client.get(f"/api/verify/{ca}").json(), client.get(f"/api/verify/{cb}").json()
    assert va["status"] == "recalled" and va["sandbox"] is True
    assert vb["status"] == "authentic"          # another visitor's demo is untouched
    assert client.get("/api/stats").json()["rule_versions_recalled"] == 0   # and so is the official list


def test_uncalibrated_photo_becomes_an_officer_case(client, monkeypatch, tmp_path):
    import services.api.main as m
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    sid = client.post("/api/demo/session").json()["session_id"]
    diag = {"diagnosis_id": "d-1", "crop": "potato", "model": {"name": "rice-leaf-mnv4s", "version": "union-v0", "sha256": "a" * 64},
            "on_device": True, "labels": [{"label": "late_blight", "prob": 0.91}], "calibrated": False, "status": "ok",
            "inference_ms": 48, "created_at": "2026-10-28T08:00:00Z"}
    r = client.post(f"/api/demo/{sid}/plan", json={"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a", "diagnosis": diag})
    assert r.status_code == 200 and r.json()["diagnosis_used"] is False and r.json()["diagnosis_note"] == "uncalibrated"
    items = client.get(f"/api/demo/{sid}/inbox").json()["items"]
    assert any(i.get("diagnosis_id") == "d-1" for i in items)
    bad = dict(diag, labels=[{"label": "Late Blight!", "prob": 2}])
    assert client.post(f"/api/demo/{sid}/plan", json={"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a",
                                                      "diagnosis": bad}).status_code == 422


def _photo_plan(client, monkeypatch, tmp_path, diag, trust_area=None):
    from datetime import date, timedelta
    import services.api.main as m
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 60, "tmin_c": 12, "tmax_c": 20, "precip_mm": 0.0}
            for i in range(7)]
    snap = {"snapshot_id": "snap-p", "field_id": "KE-SAMPLE-01", "mode": "live", "location": {"precision": "sample_location"},
            "created_at": m.snap_mod.datetime.now(m.snap_mod.timezone.utc).isoformat().replace("+00:00", "Z"),
            "forecast": {"source": "open-meteo:forecast", "issued_at": "2026-10-28T00:00:00Z", "days": days}}
    monkeypatch.setattr(m.snap_mod, "build", lambda field: snap)
    sid = client.post("/api/demo/session").json()["session_id"]
    if trust_area:   # server-side evidence, as the area ledger issues it when its gate opens
        m._sandbox(sid)["store"].area_trust_credential(
            {"area": trust_area, "model": "rice-leaf-mnv4s@union-v0", "policy_id": "photo-trust", "policy_version": 1,
             "verdicts": 90, "sure_in_window": 50, "sure_right_in_window": 49, "precision": 0.98, "lower_bound": 0.895,
             "opened_at": "2026-10-28T08:00:00Z"})
    r = client.post(f"/api/demo/{sid}/plan", json={"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a", "diagnosis": diag})
    assert r.status_code == 200
    return r.json(), client.get(f"/api/demo/{sid}/inbox").json()["items"]


SURE_PHOTO = {"diagnosis_id": "d-2", "crop": "potato", "model": {"name": "rice-leaf-mnv4s", "version": "union-v0", "sha256": "a" * 64},
              "on_device": True, "labels": [{"label": "late_blight", "prob": 0.99}], "calibrated": True, "ood_score": 0.01,
              "status": "ok", "inference_ms": 48, "created_at": "2026-10-28T08:00:00Z"}


def test_a_client_cannot_vouch_for_its_own_photo_model(client, monkeypatch, tmp_path):
    plan, items = _photo_plan(client, monkeypatch, tmp_path, SURE_PHOTO)   # claims calibrated, 99% sure, in-distribution
    assert plan["diagnosis_used"] is False and plan["diagnosis_note"] == "uncalibrated"
    assert any(i.get("diagnosis_id") == "d-2" for i in items)               # it went to the officer instead


def test_only_server_evidence_opens_the_photo_gate(client, monkeypatch, tmp_path):
    plan, _ = _photo_plan(client, monkeypatch, tmp_path, dict(SURE_PHOTO, calibrated=False), trust_area="potato@KE")
    assert plan["diagnosis_used"] is True and plan["diagnosis_note"] == "ok"   # the client's flag is ignored either way
    plan, _ = _photo_plan(client, monkeypatch, tmp_path, SURE_PHOTO, trust_area="potato@UG")   # earned in another country
    assert plan["diagnosis_used"] is False
    plan, _ = _photo_plan(client, monkeypatch, tmp_path, SURE_PHOTO)          # another visitor's sandbox: no evidence
    assert plan["diagnosis_used"] is False


def test_demo_receipts_survive_a_server_restart(client, monkeypatch, tmp_path):
    import services.api.main as m
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    sid = client.post("/api/demo/session").json()["session_id"]
    plan = client.post(f"/api/demo/{sid}/plan", json={"field_id": "KE-SAMPLE-01", "profile_id": "demo-farmer-a"}).json()
    cid = plan["actions"][0]["receipt_credential_id"] if plan["status"] == "ok" else None
    m._sandboxes.clear(); m._plan_cache.clear()              # simulate a restart: memory is gone, disk stays
    assert client.get(f"/status/demo-{sid}").status_code == 200
    assert client.get(f"/api/demo/{sid}/stats").status_code == 200
    if cid:
        assert client.get(f"/api/verify/{cid}").json()["status"] == "authentic"
    for bad in ("not-a-hex-id", "..%2F..%2Ftrust", "0123456789abcdef"):   # malformed, traversal, never created
        assert client.get(f"/api/demo/{bad}/stats").status_code == 404
