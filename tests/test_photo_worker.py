"""The photo worker split (Azure): the API keeps the small files, a worker runs the model; tokens, model identity, errors."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from services.vision import backbone as bb_mod
from services.vision import worker
from services.vision.backbone import PhotoModelUnavailable, RemoteBackbone


class FakeLocal:
    model, sha256, labels = "leaf@1", "a" * 64, ["healthy", "blast"]

    def warm(self):
        pass

    def features(self, image: bytes):
        if image == b"garbage":
            raise OSError("not an image")
        return np.array([1.0, 2.0, 3.0])


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("PHOTO_WORKER_TOKEN", "s3cret")
    monkeypatch.setattr(worker, "_backbone", FakeLocal())
    return TestClient(worker.app)


def _small_files(d, sha="a" * 64):
    (d / "meta.json").write_text(json.dumps({"name": "leaf", "version": "1", "size": 224, "mean": [0, 0, 0], "std": [1, 1, 1]}))
    np.savez(d / "text.npz", labels=np.array(["healthy", "blast"]), T=np.eye(2, 3))
    (d / "export_report.json").write_text(json.dumps({"vision_onnx_sha256": sha}))


def test_worker_needs_the_token(client):
    assert client.post("/features", content=b"leaf").status_code == 403
    assert client.post("/features", content=b"leaf", headers={"X-Photo-Token": "wrong"}).status_code == 403
    r = client.post("/features", content=b"leaf", headers={"X-Photo-Token": "s3cret"})
    assert r.status_code == 200 and r.json()["features"] == [1.0, 2.0, 3.0]
    assert client.post("/features", content=b"garbage", headers={"X-Photo-Token": "s3cret"}).status_code == 422
    assert client.get("/meta", headers={"X-Photo-Token": "s3cret"}).json() == {"model": "leaf@1", "sha256": "a" * 64,
                                                                                  "labels": ["healthy", "blast"]}


def _wired(tmp_path, client, sha="a" * 64):
    _small_files(tmp_path, sha)
    remote = RemoteBackbone(tmp_path, "http://worker", "s3cret")

    def call(path, body=None, timeout=120):   # route the HTTP call to the in-process worker
        r = client.post(path, content=body, headers={"X-Photo-Token": "s3cret"}) if body is not None else \
            client.get(path, headers={"X-Photo-Token": "s3cret"})
        if r.status_code == 422:
            raise ValueError("not a readable image")
        if r.status_code != 200:
            raise PhotoModelUnavailable(str(r.status_code))
        return r.json()
    remote._call = call
    return remote


def test_the_api_side_reads_small_files_and_gets_features_from_the_worker(tmp_path, client):
    remote = _wired(tmp_path, client)
    assert remote.model == "leaf@1" and remote.labels == ["healthy", "blast"] and remote.sha256 == "a" * 64
    assert remote.features(b"leaf").tolist() == [1.0, 2.0, 3.0]
    with pytest.raises(ValueError):
        remote.features(b"garbage")


def test_a_worker_with_another_model_file_is_refused(tmp_path, client):
    remote = _wired(tmp_path, client, sha="b" * 64)
    with pytest.raises(PhotoModelUnavailable):
        remote.features(b"leaf")


def test_an_unreachable_worker_is_reported_as_unavailable(tmp_path):
    _small_files(tmp_path)
    remote = RemoteBackbone(tmp_path, "http://127.0.0.1:9", "s3cret")   # nothing listens on the discard port
    with pytest.raises(PhotoModelUnavailable):
        remote.features(b"leaf")


def test_providers_default_to_all_available_and_follow_the_env_list(monkeypatch):
    avail = ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
    monkeypatch.delenv(bb_mod.PROVIDERS_ENV, raising=False)
    assert bb_mod.session_providers(avail) == avail                       # unset: the behaviour before the variable
    monkeypatch.setenv(bb_mod.PROVIDERS_ENV, " CUDAExecutionProvider , CPUExecutionProvider ")
    assert bb_mod.session_providers(avail) == ["CUDAExecutionProvider", "CPUExecutionProvider"]
    monkeypatch.setenv(bb_mod.PROVIDERS_ENV, "CUDAExecutionProvider")
    with pytest.raises(PhotoModelUnavailable):                            # never a silent fall-back to another device
        bb_mod.session_providers(["CPUExecutionProvider"])


def test_load_picks_local_remote_or_none(tmp_path, monkeypatch):
    monkeypatch.setattr(bb_mod, "_loaded", {})
    monkeypatch.delenv("KRISHILENS_REMOTE_URL", raising=False)
    monkeypatch.setenv("KRISHILENS_DIR", str(tmp_path))
    assert bb_mod.load() is None                      # no model, no worker: the photo endpoints answer 503
    _small_files(tmp_path)
    monkeypatch.setenv("KRISHILENS_REMOTE_URL", "http://worker")
    assert isinstance(bb_mod.load(), RemoteBackbone)
