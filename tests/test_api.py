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


def test_a_client_report_never_passes_even_where_trust_was_earned(client, monkeypatch, tmp_path):
    plan, items = _photo_plan(client, monkeypatch, tmp_path, SURE_PHOTO, trust_area="potato@KE")
    assert plan["diagnosis_used"] is False             # only the server's own photo cases can use that trust
    assert any(i.get("diagnosis_id") == "d-2" for i in items)


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


class FakeBackbone:
    """Stands in for services/vision/backbone.py: b'blast:7' is a photo of blast, number 7."""
    model, sha256 = "leaf@1", "a" * 64
    labels = ["healthy", "blast", "brown_spot", "tungro", "sheath_blight"]

    def __init__(self):
        import numpy as np
        rng = np.random.RandomState(0)
        self.dirs = rng.randn(5, 16)
        self.T = self.dirs + 0.6 * rng.randn(5, 16)

    def features(self, image: bytes):
        import numpy as np
        try:
            label, n = image.decode().split(":")
        except (UnicodeDecodeError, ValueError):
            raise ValueError("not an image")
        return self.dirs[self.labels.index(label)] + 0.15 * np.random.RandomState(int(n)).randn(16)


def _b64(s: str) -> str:
    import base64
    return base64.b64encode(s.encode()).decode()


def _photo_session(client, monkeypatch, tmp_path, backbone=True):
    import services.api.main as m
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(m.vision_backbone, "load", (lambda: FakeBackbone()) if backbone else (lambda: None))
    return client.post("/api/demo/session").json()["session_id"]


def test_photos_are_refused_without_an_installed_model(client, monkeypatch, tmp_path):
    sid = _photo_session(client, monkeypatch, tmp_path, backbone=False)
    r = client.post(f"/api/demo/{sid}/photo", json={"field_id": "BD-SAMPLE-01", "image_b64": _b64("blast:1")})
    assert r.status_code == 503


def test_photo_case_flow_over_http(client, monkeypatch, tmp_path):
    sid = _photo_session(client, monkeypatch, tmp_path)
    r = client.post(f"/api/demo/{sid}/photo", json={"field_id": "BD-SAMPLE-01", "image_b64": _b64("blast:1"), "consent": True})
    assert r.status_code == 200
    case = r.json()
    assert case["route"] == "officer" and case["area"] == "rice@BD" and len(case["suggestion"]) == 2
    assert "x" not in case and "logits" not in case
    assert [c["case_id"] for c in client.get(f"/api/demo/{sid}/photo/cases").json()["cases"]] == [case["case_id"]]
    v = client.post(f"/api/demo/{sid}/photo/{case['case_id']}/verdict", json={"label": "blast"})
    assert v.status_code == 200 and v.json()["area"]["verdicts"] == 1
    assert client.post(f"/api/demo/{sid}/photo/{case['case_id']}/verdict", json={"label": "blast"}).status_code == 409
    assert client.post(f"/api/demo/{sid}/photo", json={"field_id": "BD-SAMPLE-01", "image_b64": "%%%"}).status_code == 422
    assert client.post(f"/api/demo/{sid}/photo", json={"field_id": "BD-SAMPLE-01", "image_b64": _b64("garbage")}).status_code == 422
    plan = client.post(f"/api/demo/{sid}/plan", json={"field_id": "BD-SAMPLE-01", "profile_id": "demo-farmer-d",
                                                      "photo_case_id": case["case_id"]})
    assert plan.status_code == 409          # that case went to the officer: there is no automatic reading to use
    assert client.get(f"/api/demo/{sid}/areas/rice@BD").json()["gate_open"] is False
    assert client.get(f"/api/demo/{sid}/areas/..%2F..").status_code == 404


def test_trust_earned_in_one_demo_session_stays_there(client, monkeypatch, tmp_path):
    import services.api.main as m
    sid = _photo_session(client, monkeypatch, tmp_path)
    monkeypatch.setattr(m, "_rate_limited", lambda who: False)    # 90 photos in a test minute; the real limit is 20
    for i in range(90):
        lab = FakeBackbone.labels[i % 5]
        c = client.post(f"/api/demo/{sid}/photo", json={"field_id": "BD-SAMPLE-01", "image_b64": _b64(f"{lab}:{i}")}).json()
        if c["route"] == "officer":
            client.post(f"/api/demo/{sid}/photo/{c['case_id']}/verdict", json={"label": lab})
    area = client.get(f"/api/demo/{sid}/areas/rice@BD").json()
    assert area["gate_open"] and area["trust_credential_id"]
    assert client.get(f"/api/verify/{area['trust_credential_id']}").json()["status"] == "invalid"   # not an advice receipt
    other = client.post("/api/demo/session").json()["session_id"]
    assert client.get(f"/api/demo/{other}/areas/rice@BD").json()["gate_open"] is False
