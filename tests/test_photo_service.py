"""Photo cases end to end (services/vision/service.py) with a fake feature extractor: trust is earned from officer
verdicts, used only for the server's own readings, and withdrawn on drift; photos are kept only as long as needed."""
import numpy as np
import pytest

from services.engine.planner import DEMO_PROFILES, make_plan
from services.trust.store import TrustStore
from services.vision.ledger import LedgerError
from services.vision.service import PhotoService

LABELS = ["healthy", "blast", "brown_spot"]
RNG = np.random.RandomState(0)
CLASS_DIRS = RNG.randn(3, 16)
TEXT = CLASS_DIRS + 0.6 * RNG.randn(3, 16)            # the text prior is roughly right
FIELD = {"field_id": "BD-T", "crop": "rice", "country": "BD", "stage": "tillering", "pack_id": "pack-bd-rice"}


def fake_features(image: bytes) -> np.ndarray:
    """'blast:7' -> a photo of blast (number 7). Real photos go through services/vision/backbone.py."""
    label, n = image.decode().split(":")
    return CLASS_DIRS[LABELS.index(label)] + 0.15 * np.random.RandomState(int(n)).randn(16)


@pytest.fixture()
def svc(tmp_path):
    store = TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust")
    return PhotoService(store, tmp_path / "photo", "leaf@1", "a" * 64, LABELS, TEXT, fake_features)


def _earn(svc, start=0, n=80):
    for i in range(start, start + n):
        lab = LABELS[i % 3]
        c = svc.submit(FIELD, f"{lab}:{i}".encode(), consent=False)
        if c["route"] == "officer":
            r = svc.judge(c["case_id"], lab, "officer-1")
            if r["event"] and r["event"]["event"] == "opened":
                return r
    return None


def test_officer_verdicts_earn_area_trust(svc):
    assert svc.store.trusted_photo_model("leaf@1", "rice@BD") is None
    opened = _earn(svc)
    assert opened and opened["area"]["gate_open"] and opened["area"]["lower_bound"] >= 0.85
    cred_id = svc.store.trusted_photo_model("leaf@1", "rice@BD")
    subject = svc.store.get(cred_id)["credentialSubject"]
    assert subject["area"] == "rice@BD" and subject["model"] == "leaf@1" and subject["sure_in_window"] >= 30
    routes = [svc.submit(FIELD, f"blast:{1000 + i}".encode(), False)["route"] for i in range(60)]
    assert routes.count("auto") > 40                    # sure answers are now automatic, a few still audited


def test_only_the_servers_own_reading_feeds_the_plan(svc, tmp_path, monkeypatch):
    _earn(svc)
    case = next(c for c in (svc.submit(FIELD, f"blast:{2000 + i}".encode(), False) for i in range(30)) if c["route"] == "auto")
    diag = svc.diagnosis_for(case["case_id"], FIELD)
    assert diag["labels"][0]["label"] == "blast" and diag["model"]["sha256"] == "a" * 64
    from services.engine import snapshot as snap_mod
    monkeypatch.setattr(snap_mod, "build", lambda f: _quiet_snapshot())
    used = make_plan(FIELD, DEMO_PROFILES["demo-farmer-d"], svc.store, inbox_dir=tmp_path / "inbox", diagnosis=diag,
                     diagnosis_from_server=True)
    assert used["diagnosis_used"] is True
    photo = [a for a in used.get("actions", []) if "area_trust_ref" in a["receipt"]]
    assert photo and "R-BDR-012" in photo[0]["action_id"].upper()      # the blast practice, receipted with the area trust
    reported = make_plan(FIELD, DEMO_PROFILES["demo-farmer-d"], svc.store, inbox_dir=tmp_path / "inbox", diagnosis=diag)
    assert reported["diagnosis_used"] is False                        # the same reading, sent by a client, does not pass
    with pytest.raises(LedgerError):
        svc.diagnosis_for(case["case_id"], dict(FIELD, country="KE"))  # trust earned in one area only


def test_drift_withdraws_the_area_trust(svc):
    _earn(svc)
    cred_id = svc.store.trusted_photo_model("leaf@1", "rice@BD")
    closed = None
    for i in range(200):                                 # the officer starts overruling: the photos changed
        c = svc.submit(FIELD, f"blast:{3000 + i}".encode(), False)
        r = svc.judge(c["case_id"], "brown_spot", "officer-1")
        if r["event"] and r["event"]["event"] == "closed":
            closed = r
            break
    assert closed and svc.store.trusted_photo_model("leaf@1", "rice@BD") is None
    assert svc.store.verify(cred_id)["status"] == "invalid"          # not a receipt; its status entry is revoked:
    from services.trust.vc import is_revoked
    assert is_revoked(svc.store.get(cred_id), svc.store.get, svc.store.resolve_key)


def test_photos_are_kept_only_with_consent_and_only_until_the_verdict(svc, tmp_path):
    kept = svc.submit(FIELD, b"blast:1", consent=True)
    not_kept = svc.submit(FIELD, b"blast:2", consent=False)
    photos = tmp_path / "photo" / "photos"
    assert (photos / f"{kept['case_id']}.jpg").exists() and not (photos / f"{not_kept['case_id']}.jpg").exists()
    svc.judge(kept["case_id"], "blast", "officer-1")
    assert not (photos / f"{kept['case_id']}.jpg").exists()
    assert "x" not in kept and "photo" not in kept and "logits" not in kept


def test_bad_inputs_are_refused(svc):
    c = svc.submit(FIELD, b"blast:1", consent=False)
    with pytest.raises(LedgerError):
        svc.judge(c["case_id"], "not-a-label", "officer-1")
    with pytest.raises(LedgerError):
        svc.judge("../../etc/passwd", "blast", "officer-1")
    with pytest.raises(LedgerError):
        svc.diagnosis_for(c["case_id"], FIELD)          # routed to the officer, so there is no automatic reading


def _quiet_snapshot():
    from datetime import date, datetime, timedelta, timezone
    made = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 60, "tmin_c": 22, "tmax_c": 31,
             "precip_mm": 0.0} for i in range(7)]
    return {"snapshot_id": "snap-photo", "field_id": "BD-T", "mode": "live", "location": {"precision": "sample_location"},
            "created_at": made, "forecast": {"source": "open-meteo:forecast", "issued_at": made, "days": days}}
