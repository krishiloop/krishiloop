"""AgriTriage-Lite on the server (services/vision/agritriage.py): the gate's math, the server's own reading, the class
map, consent, and the model credential: a receipt that used a photo reading cites it, and recalling the model recalls
the receipt. The ONNX file is the one the farmer's phone runs (apps/web/public/models/agritriage/)."""
import hashlib
import io
import json
import math
from pathlib import Path

import numpy as np
import pytest
import yaml

from services.engine.planner import DEMO_PROFILES, make_plan
from services.engine.rules import load_pack
from services.trust.store import TrustStore
from services.vision import agritriage as at
from services.vision.ledger import LedgerError

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((at.MODEL_DIR / "config.json").read_text(encoding="utf-8"))
CI = {c: i for i, c in enumerate(CFG["classes"])}
FIELD = {"field_id": "BD-T", "crop": "rice", "country": "BD", "stage": "tillering", "pack_id": "pack-bd-rice"}
LATE = {"field_id": "BD-G", "crop": "rice", "country": "BD", "stage": "grain_fill", "pack_id": "pack-bd-rice"}
POTATO = {"field_id": "KE-T", "crop": "potato", "country": "KE", "stage": "vegetative", "pack_id": "pack-potato-late-blight"}


# ---------------------------------------------------------------- the gate's math
TOY = {"classes": ["a1", "a2", "b1", "b2"], "crops": ["a", "a", "b", "b"], "temperature": 1.0, "energy_threshold": -2.0,
       "q_any_crop": 0.7, "q_crop_known": 0.6, "shortlist_max": 3, "alpha": 0.1}


def test_gate_known_vectors():
    z = [math.log(6), math.log(2), math.log(1), math.log(1)]          # softmax = 0.6, 0.2, 0.1, 0.1; logsumexp = log 10
    g = at.gate(z, TOY)
    assert np.allclose(g["p"], [0.6, 0.2, 0.1, 0.1]) and g["energy"] == pytest.approx(-math.log(10))
    # deterministic APS: a class joins while the mass BEFORE it is <= q (0 -> a1, .6 -> a2); stop once it passes q (.8)
    assert g["set"] == [0, 1] and g["action"] == "shortlist"
    g = at.gate(z, TOY, crop="a")                                      # a1, a2 renormalised: .75, .25; q = .6
    assert np.allclose(g["p"], [0.75, 0.25, 0, 0]) and g["set"] == [0] and g["action"] == "act"
    g = at.gate(z, dict(TOY, energy_threshold=-3.0))                   # energy -2.30 > -3: an unknown photo
    assert g["action"] == "refer" and g["reason"] == "unknown"
    g = at.gate([0.0, 0.0, 0.0, 0.0], dict(TOY, q_any_crop=0.9, shortlist_max=2, energy_threshold=0))
    assert g["set"] == [0, 1, 2, 3] and g["action"] == "refer" and g["reason"] == "many"
    g = at.gate([2.0, 0.0, 0.0, 0.0], dict(TOY, temperature=2.0))       # temperature scales the logits, not the energy
    assert g["p"][0] == pytest.approx(math.e / (math.e + 3))
    assert g["energy"] == pytest.approx(-math.log(math.exp(2) + 3))
    with pytest.raises(ValueError):
        at.gate(z, TOY, crop="cassava")


def test_gate_example_from_the_docstring_set():
    # mass before a1 = 0 <= .8 (in); before a2 = .6 <= .8 (in); before b1 = .8 <= .8 (in); then .9 > .8: stop
    g = at.gate([math.log(6), math.log(2), math.log(1), math.log(1)], dict(TOY, q_any_crop=0.8000001))
    assert g["set"] == [0, 1, 2] and g["action"] == "shortlist"


def test_the_gate_reproduces_the_shared_fixture():
    """The same file gate.test.ts checks the browser's port against."""
    fx = json.loads((ROOT / "apps/web/src/lib/agritriage/gate.fixture.json").read_text(encoding="utf-8"))
    assert len(fx["cases"]) >= 15
    for c in fx["cases"]:
        g = at.gate(np.asarray(c["logits"], dtype=np.float32), CFG, c["crop"])
        assert g["set"] == c["expect"]["set"] and g["action"] == c["expect"]["action"], c["name"]
        assert g["energy"] == pytest.approx(c["expect"]["energy"], abs=1e-5)
        for i, p in c["expect"]["top"]:
            assert g["p"][i] == pytest.approx(p, abs=1e-6)


def test_conformal_quantile_and_aps_score():
    p = np.array([0.5, 0.3, 0.2])
    assert at.aps_score(p, 0) == 0 and at.aps_score(p, 2) == pytest.approx(0.8)
    assert at.conformal_quantile([0.1 * i for i in range(10)], 0.1) == pytest.approx(0.9)   # ceil(11 * .9)/10 = 1.0
    assert at.conformal_quantile([0.1] * 5, 0.1) == math.inf                               # too few to promise 90%


def test_occlusion_grid_and_heat():
    x = np.ones((1, 3, 224, 224), np.float32)
    xs = at.occlusion_inputs(x)
    assert xs.shape == (49, 3, 224, 224)
    for k in (0, 24, 48):                                              # one 32 px patch grey per copy, row-major
        r, c = divmod(k, 7)
        assert (xs[k, :, r * 32:(r + 1) * 32, c * 32:(c + 1) * 32] == 0.5).all()
        assert (xs[k] == 0.5).sum() == 3 * 32 * 32
    assert at.occlusion_heat(0.9, [0.9, 0.5, 0.8, 1.0]) == [0.0, 1.0, 0.25, 0.0]
    assert at.occlusion_heat(0.2, [0.3, 0.2]) == [0.0, 0.0]


# ---------------------------------------------------------------- the server's own reading (the real ONNX file)
def leaf_jpeg(seed: int = 0, size=(480, 360)) -> bytes:
    """A drawn leaf (generated here, no licence question): green ellipse, a midrib and brown lesions."""
    from PIL import Image, ImageDraw
    rng = np.random.RandomState(seed)
    im = Image.new("RGB", size, (214, 204, 170))
    d = ImageDraw.Draw(im)
    w, h = size
    d.ellipse((w * 0.08, h * 0.2, w * 0.92, h * 0.8), fill=(58, 128, 52))
    d.line((w * 0.1, h * 0.5, w * 0.9, h * 0.5), fill=(120, 170, 90), width=4)
    for _ in range(14):
        x, y, r = rng.uniform(w * 0.2, w * 0.8), rng.uniform(h * 0.3, h * 0.7), rng.uniform(6, 16)
        d.ellipse((x - r * 1.6, y - r, x + r * 1.6, y + r), fill=(130, 92, 50), outline=(70, 50, 30))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture(scope="module")
def model():
    return at.load_model()


def test_the_server_reads_the_same_file_the_phone_runs(model):
    raw = (at.MODEL_DIR / CFG["model"]).read_bytes()                  # model_xai.onnx (tools/xai_export.py)
    assert model.sha256 == hashlib.sha256(raw).hexdigest() and len(raw) > 10_000_000
    r, p = model.read(leaf_jpeg(), "rice")
    assert r["model"] == "agritriage-tinyvit@1" and r["mode"] == "crop_known" and r["coverage_target"] == 0.9
    assert r["outcome"] in ("diagnose", "shortlist", "refer") and r["weights"].startswith("Research weights")
    assert {lab["label"] for lab in r["labels"]} <= {"rice blast", "rice healthy", "rice sheath blight"}
    assert sum(p) == pytest.approx(1) and r["q"] == pytest.approx(CFG["q_crop_known"])
    any_r, _ = model.read(leaf_jpeg(), None)
    assert any_r["mode"] == "any_crop" and len(any_r["labels"]) == 5
    assert CFG["samples"] == []                                      # the demo's unchecked sample photos are not shipped


def test_server_heat_map(model):
    h = model.heat(leaf_jpeg(1), "rice", "rice blast")
    assert h["method"] == "occlusion" and h["grid"] == 7 and len(h["heat"]) == 49
    assert all(0 <= v <= 1 for v in h["heat"])


# ---------------------------------------------------------------- the service, with a model whose logits we choose
class FakeModel(at.AgriTriageModel):
    """The real config and gate; logits chosen by the photo's colour, so every route is reachable on purpose."""

    def __init__(self):
        self.cfg, self.classes, self.crops = CFG, list(CFG["classes"]), list(CFG["crops"])
        self.sha256, self.config_sha256 = "b" * 64, "c" * 64

    def logits(self, x):
        out = []
        for img in x:
            z = np.full(len(self.classes), -4.0, np.float32)
            r, g, b = (float(img[k].mean()) for k in range(3))
            if r > 0.7 and g < 0.3:
                z[CI["rice blast"]] = 9                                    # red: a clear rice blast
            elif g > 0.7 and r < 0.3:
                z[CI["rice blast"]] = z[CI["rice sheath blight"]] = 8      # green: two rice diseases
            elif b > 0.7 and r < 0.3:
                z[:] = 0                                                   # blue: unlike anything (unknown)
            elif r > 0.7 and g > 0.7 and b < 0.3:
                z[CI["potato late blight"]] = 9                            # yellow: a clear late blight
            else:
                z[CI["rice sheath blight"]] = 9                            # grey: a clear sheath blight
            out.append(z)
        return np.stack(out)


def solid(rgb) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (300, 260), rgb).save(buf, "PNG")
    return buf.getvalue()


RED, GREEN, BLUE, YELLOW, GREY = solid((230, 20, 20)), solid((20, 230, 20)), solid((20, 20, 230)), solid((230, 230, 20)), \
    solid((128, 128, 128))


@pytest.fixture()
def svc(tmp_path):
    store = TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32, data_dir=tmp_path / "trust")
    return at.AgriTriageService(store, tmp_path / "triage", model=FakeModel())


def _quiet_snapshot():
    from datetime import date, datetime, timedelta, timezone
    made = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    days = [{"date": (date.today() + timedelta(days=i)).isoformat(), "rh_mean_pct": 60, "tmin_c": 22, "tmax_c": 31,
             "precip_mm": 0.0} for i in range(7)]
    return {"snapshot_id": "snap-triage", "field_id": "BD-T", "mode": "live", "location": {"precision": "sample_location"},
            "created_at": made, "forecast": {"source": "open-meteo:forecast", "issued_at": made, "days": days}}


def _receipted_plan(svc, tmp_path, monkeypatch):
    from services.engine import snapshot as snap_mod
    monkeypatch.setattr(snap_mod, "build", lambda f: _quiet_snapshot())
    case = next(c for c in (svc.submit(FIELD, RED, consent=True) for _ in range(10)) if c["route"] == "receipt")
    diag = svc.diagnosis_for(case["case_id"], FIELD)
    plan = make_plan(FIELD, DEMO_PROFILES["demo-farmer-d"], svc.store, inbox_dir=tmp_path / "inbox", diagnosis=diag,
                     diagnosis_from_server=True)
    photo = [a for a in plan.get("actions", []) if "photo_reading" in a["receipt"]]
    return case, plan, photo


def test_a_diagnose_on_a_mapped_class_gets_a_receipt_citing_the_model(svc, tmp_path, monkeypatch):
    case, plan, photo = _receipted_plan(svc, tmp_path, monkeypatch)
    assert case["reading"]["outcome"] == "diagnose" and case["reading"]["set"] == ["rice blast"]
    assert case["photo_available"] is False                            # a receipted photo is never kept, even with consent
    assert plan["status"] == "ok" and plan["diagnosis_used"] is True
    assert photo and photo[0]["action_id"].upper().startswith("A-R-BDR-012")
    pr = photo[0]["receipt"]["photo_reading"]
    assert pr["model_ref"]["model"] == "agritriage-tinyvit@1" and pr["model_ref"]["sha256"] == "b" * 64
    assert pr["outcome"] == "diagnose" and pr["set"] == ["rice blast"] and pr["coverage_target"] == 0.9
    assert pr["mode"] == "crop_known" and pr["weights"] == at.WEIGHTS and "area_trust_ref" not in photo[0]["receipt"]
    model_cred = svc.store.get(pr["model_ref"]["credential_id"])
    assert "ModelCredential" in model_cred["type"] and model_cred["credentialSubject"]["weights"] == at.WEIGHTS
    assert any(d["source"] == "server-model:agritriage-tinyvit@1" for d in photo[0]["receipt"]["data"])
    v = svc.store.verify(photo[0]["receipt_credential_id"])
    assert v["status"] == "authentic"
    # the receipt validates against the contract
    from services.api.main import _schema_validator
    assert not list(_schema_validator("receipt.schema.json").iter_errors(photo[0]["receipt"]))


def test_recalling_the_model_recalls_its_receipts(svc, tmp_path, monkeypatch):
    case, plan, photo = _receipted_plan(svc, tmp_path, monkeypatch)
    rid = photo[0]["receipt_credential_id"]
    other = [a["receipt_credential_id"] for a in plan["actions"] if "photo_reading" not in a["receipt"]]
    hits = at.recall_model(svc.store, "test: the weights were found wrong", actor="test")
    assert len(hits) == 1
    v = svc.store.verify(rid)
    assert v["status"] == "recalled" and "photo model agritriage-tinyvit@1" in v["reason"]
    assert all(svc.store.verify(o)["status"] == "authentic" for o in other)      # weather advice is untouched
    assert svc.store.verify(hits[0])["status"] == "recalled"
    again = svc.submit(FIELD, RED, consent=False)
    assert again["route"] == "officer" and again["reason"] == "model_recalled"
    with pytest.raises(LedgerError):
        svc.diagnosis_for(case["case_id"], FIELD)                       # no new receipt can cite a recalled model
    assert svc.model_info()["recalled"] is True


def test_a_client_reading_is_never_trusted(svc, tmp_path, monkeypatch):
    claim = {"outcome": "diagnose", "set": ["rice blast"], "top": [{"label": "rice blast", "prob": 0.99}], "ms": 400}
    c = svc.submit(FIELD, BLUE, consent=False, client=claim)
    assert c["route"] == "officer" and c["reason"] == "unknown"           # the server's own reading decides
    assert c["agreement"]["same_outcome"] is False and c["agreement"]["client_outcome"] == "diagnose"
    with pytest.raises(LedgerError):
        svc.diagnosis_for(c["case_id"], FIELD)
    plan = make_plan(FIELD, DEMO_PROFILES["demo-farmer-d"], svc.store, snap=_quiet_snapshot(), inbox_dir=tmp_path / "i",
                     diagnosis={"diagnosis_id": "x", "crop": "rice", "model": {"name": "agritriage-tinyvit", "version": "1",
                                "sha256": "b" * 64}, "on_device": True, "labels": [{"label": "blast", "prob": 0.99}],
                                "calibrated": True, "status": "ok", "inference_ms": 1, "created_at": "2026-11-19T00:00:00Z"})
    assert plan["diagnosis_used"] is False                              # a phone's report cannot pass the planner's gate


# ---------------------------------------------------------------- the class map and the routes
def test_class_map_is_checked_against_the_packs():
    m = yaml.safe_load(at.CLASS_MAP_FILE.read_text(encoding="utf-8"))
    for name, e in m["classes"].items():
        assert name in CFG["classes"]
        rules = {r["rule_id"]: r for r in load_pack(e["pack_id"])}
        for rid in e["rules"]:
            assert rid in rules and "diagnosis_label" in json.dumps(rules[rid]["when"])
            assert e["diagnosis_label"] in json.dumps(rules[rid]["when"])
            assert rules[rid]["action"]["kind"] != "input_decision"      # tier 1: a photo never feeds an input decision
    assert m["classes"]["rice blast"]["rules"] == ["R-BDR-012"]
    potato = load_pack("pack-potato-late-blight")
    assert not any("diagnosis" in json.dumps(r["when"]) for r in potato) and m["classes"]["potato late blight"]["rules"] == []
    for crop in m["crops"].values():
        assert crop in CFG["crops"]
    pol = yaml.safe_load((ROOT / "rules/policy/photo-trust.yaml").read_text(encoding="utf-8"))
    assert pol["version"] == 2 and pol["agritriage"]["coverage_target"] == 0.9


@pytest.mark.parametrize("field,image,any_crop,route,reason", [
    (FIELD, GREEN, False, "retake", "shortlist"),                      # two rice diseases: take a clearer photo
    (FIELD, BLUE, False, "officer", "unknown"),                       # unlike anything it was trained on
    (FIELD, GREY, False, "officer", "no_rule"),                       # sheath blight: shown, no sourced action
    (LATE, RED, False, "officer", "no_rule"),                         # blast at grain fill: R-BDR-012 does not fire
    (FIELD, RED, True, "officer", "crop_unknown"),                    # any-crop readings never get a receipt
    (POTATO, YELLOW, False, "officer", "no_rule"),                    # late blight: the potato pack has no photo rule
])
def test_routes(svc, field, image, any_crop, route, reason):
    c = svc.submit(field, image, consent=False, any_crop=any_crop)
    assert (c["route"], c["reason"]) == (route, reason)


def test_shortlist_then_officer(svc):
    c = svc.submit(FIELD, GREEN, consent=True)
    assert c["route"] == "retake" and c["photo_available"]
    assert svc.escalate(c["case_id"])["route"] == "officer"
    assert svc.escalate(c["case_id"])["route"] == "officer"
    r = svc.judge(c["case_id"], "rice blast", "officer-1")
    assert r["case"]["verdict"] == "rice blast" and r["area"]["coverage"]["checks"] == 1


def test_photos_are_kept_only_with_consent_and_only_until_the_verdict(svc, tmp_path):
    kept, not_kept = svc.submit(FIELD, BLUE, consent=True), svc.submit(FIELD, BLUE, consent=False)
    photos = tmp_path / "triage" / "photos"
    assert (photos / f"{kept['case_id']}.jpg").exists() and not (photos / f"{not_kept['case_id']}.jpg").exists()
    with pytest.raises(LedgerError):
        svc.photo(not_kept["case_id"])
    with pytest.raises(LedgerError):
        svc.heat(not_kept["case_id"])                                   # no photo, no server heat map
    svc.judge(kept["case_id"], "rice healthy", "officer-1")
    assert not (photos / f"{kept['case_id']}.jpg").exists()
    assert "p_crop" not in kept and "photo" not in kept


def test_officer_verdicts_recalibrate_the_area(svc):
    """The poster's local recalibration: after enough officer-confirmed photos, the area's own threshold replaces PlantWild's."""
    area = "rice@BD"
    assert svc.area(area)["q_source"] == "plantwild_cal"
    for _ in range(20):                                                 # blast or sheath blight? the officer says sheath blight
        c = svc.submit(FIELD, GREEN, consent=False)
        svc.judge(c["case_id"], "rice sheath blight", "officer-1")
    a = svc.area(area)
    assert a["coverage"]["checks"] == 20 and a["coverage"]["rate"] == 1.0 and a["q_source"] == "area_recalibrated"
    assert a["q"] != pytest.approx(CFG["q_crop_known"])
    c = svc.submit(FIELD, RED, consent=False)
    assert c["reading"]["q_source"] == "area_recalibrated" and c["reading"]["q"] == pytest.approx(a["q"])


def test_a_failed_coverage_check_stops_receipts(svc):
    svc.tp = dict(svc.tp, recalibrate_min_checks=10 ** 6)               # no recalibration: only the check
    for _ in range(25):                                                 # clear "sheath blight" readings of healthy leaves
        c = svc.submit(FIELD, GREY, consent=False)
        svc.judge(c["case_id"], "rice healthy", "officer-1")
    a = svc.area("rice@BD")
    assert a["coverage"]["checks"] == 25 and a["coverage"]["upper_bound"] < 0.9
    c = svc.submit(FIELD, RED, consent=False)
    assert c["route"] == "officer" and c["reason"] == "coverage_failed"  # the 90% promise failed here: receipts stop
    assert c["case_id"] in {x["case_id"] for x in svc.list_cases()}


def test_bad_inputs_are_refused(svc):
    c = svc.submit(FIELD, BLUE, consent=False)
    with pytest.raises(LedgerError):
        svc.judge(c["case_id"], "not-a-class", "officer-1")
    with pytest.raises(LedgerError):
        svc.judge("../../etc/passwd", "rice blast", "officer-1")
    with pytest.raises(LedgerError):
        svc.submit(dict(FIELD, crop="cassava"), RED, consent=False)
    with pytest.raises((OSError, ValueError)):
        svc.submit(FIELD, b"not an image", consent=False)


# ---------------------------------------------------------------- the API block (services/api/main.py, AgriTriage block)
def test_api_reads_the_uploaded_photo_and_keeps_it_only_with_consent(tmp_path, monkeypatch):
    import base64
    from fastapi.testclient import TestClient
    import services.api.main as m
    monkeypatch.setattr(m, "_store", TrustStore("https://krishiloop.example", "did:web:krishiloop.example", "11" * 32,
                                                data_dir=tmp_path / "trust"))
    monkeypatch.setenv("KRISHILOOP_ISSUER_SEED", "11" * 32)
    monkeypatch.setattr(m, "ROOT", tmp_path)
    client = TestClient(m.app)
    sid = client.post("/api/demo/session").json()["session_id"]
    b64 = base64.b64encode(leaf_jpeg(3)).decode()
    claim = {"outcome": "diagnose", "set": ["rice blast"], "top": [{"label": "rice blast", "prob": 0.99}], "ms": 5}
    r = client.post(f"/api/demo/{sid}/agritriage", json={"field_id": "BD-SAMPLE-02", "image_b64": b64, "consent": True,
                                                          "client": claim})
    assert r.status_code == 200
    body = r.json()
    c = body["case"]
    assert c["reading"]["model"] == "agritriage-tinyvit@1" and c["reading"]["mode"] == "crop_known"
    assert c["route"] in ("receipt", "officer", "retake") and c["agreement"]["client_outcome"] == "diagnose"
    assert body["model"]["credential_id"].startswith("urn:uuid:") and body["model"]["recalled"] is False
    assert c["photo_available"] == (c["route"] != "receipt")
    x = c["xai"]                                                       # the views from the same run as the reading
    assert x["target"] == c["reading"]["labels"][0]["label"] and len(x["cam"]) == 49 and len(x["attention"]) == 49
    assert x["cam_error"] < 1e-4 and x["lesion"]["leaf_found"] is True
    assert client.post(f"/api/demo/{sid}/agritriage", json={"field_id": "BD-SAMPLE-02", "image_b64": "%%%"}).status_code == 422
    assert client.post(f"/api/demo/{sid}/agritriage", json={"field_id": "XX", "image_b64": b64}).status_code == 404
    assert client.get(f"/api/demo/{sid}/agritriage/cases").json()["cases"][0]["case_id"] == c["case_id"]
    photos_before = sorted((tmp_path / "data").rglob("*.jpg"))
    h = client.post(f"/api/demo/{sid}/agritriage/heat", json={"field_id": "BD-SAMPLE-02", "image_b64": b64,
                                                               "target": "rice blast"})
    assert h.status_code == 200 and h.json()["where"] == "server" and h.json()["kept"] is False
    assert len(h.json()["heat"]) == 49 and h.json()["method"] == "occlusion"
    assert sorted((tmp_path / "data").rglob("*.jpg")) == photos_before        # used once, never written
    assert client.post(f"/api/demo/{sid}/agritriage/heat", json={"field_id": "BD-SAMPLE-02", "image_b64": b64,
                                                                 "target": "no such class"}).status_code == 422
    model_id = body["model"]["credential_id"]
    assert client.get(f"/api/verify/{model_id}").json()["status"] == "authentic"
    assert client.post(f"/api/demo/{sid}/agritriage/recall-model", json={"reason": "test"}).status_code == 200
    assert client.get(f"/api/verify/{model_id}").json()["status"] == "recalled"
