"""Server-side image features for photo cases (sovereign mode: the RTX 5090; staging: CPU).

Install: put an exported vision tower in $KRISHILENS_DIR:
  vision.onnx  image [1,3,S,S] float32 -> features [1,d]
  text.npz     labels (class ids) + T (L2-normalised text embeddings of the class descriptions, same model)
  meta.json    {"name", "version", "size", "mean", "std"}
ml/vision/export_backbone.py writes all three. Without them the photo endpoints answer 503: a photo is never guessed at.
onnxruntime and Pillow are imported only here, so the rest of the API runs without them.

Loading is in two parts: the small files at once (model name, labels, text embeddings), the 1.2 GB session and the file
hash lazily, or ahead of time with warm(), so area statistics never wait for the model.

Remote mode (Azure: a small API container plus a photo worker container, services/vision/worker.py): $KRISHILENS_DIR
holds only meta.json, text.npz and export_report.json, and $KRISHILENS_REMOTE_URL names the worker. The worker must
serve the exact model file named in export_report.json (its sha256 is checked before the first photo).

GPU (sovereign mode): $KRISHILENS_PROVIDERS lists onnxruntime execution providers in order of preference, e.g.
"CUDAExecutionProvider,CPUExecutionProvider" with onnxruntime-gpu. Unset, every provider the installed onnxruntime
offers is passed (the behaviour before this variable existed). If the first listed provider does not start (a missing
CUDA or cuDNN library, say), the model is reported unavailable instead of running silently on another device.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

PROVIDERS_ENV = "KRISHILENS_PROVIDERS"


def session_providers(available: list[str]) -> list[str]:
    """The execution providers to ask onnxruntime for: $KRISHILENS_PROVIDERS if set, else all available ones."""
    wanted = [p.strip() for p in os.environ.get(PROVIDERS_ENV, "").split(",") if p.strip()]
    if not wanted:
        return list(available)
    missing = [p for p in wanted if p not in available]
    if missing:
        raise PhotoModelUnavailable(f"{PROVIDERS_ENV} asks for {missing}; this onnxruntime offers {available}")
    return wanted


class Backbone:
    def __init__(self, d: Path):
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        self.model = f"{meta['name']}@{meta['version']}"
        self.size, self.mean, self.std = int(meta["size"]), np.array(meta["mean"]), np.array(meta["std"])
        self.onnx_path = d / "vision.onnx"
        text = np.load(d / "text.npz")
        self.labels, self.T = [str(x) for x in text["labels"]], text["T"].astype(np.float64)
        self._session, self._sha256, self._lock = None, None, threading.Lock()

    def _load(self):
        with self._lock:
            if self._session is None:
                import onnxruntime as ort
                digest = hashlib.sha256()
                with open(self.onnx_path, "rb") as f:
                    for block in iter(lambda: f.read(1 << 24), b""):
                        digest.update(block)
                self._sha256 = digest.hexdigest()
                providers = session_providers(ort.get_available_providers())
                session = ort.InferenceSession(str(self.onnx_path), providers=providers)
                if os.environ.get(PROVIDERS_ENV):   # the device must really run the model (e.g. cuDNN found), not just load
                    if session.get_providers()[0] != providers[0]:
                        raise PhotoModelUnavailable(f"{providers[0]} did not start; active: {session.get_providers()}")
                    try:
                        session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, self.size, self.size), np.float32)})
                    except Exception as e:
                        raise PhotoModelUnavailable(f"{providers[0]} failed a test run: {str(e)[:300]}") from e
                self._session = session
            return self._session

    @property
    def sha256(self) -> str:
        self._load()
        return self._sha256

    def warm(self) -> None:
        """Load the session in the background, so the first photo does not wait for it."""
        threading.Thread(target=self._load, daemon=True).start()

    def features(self, image: bytes) -> np.ndarray:
        from PIL import Image, ImageOps
        with Image.open(io.BytesIO(image)) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size   # same arithmetic as torchvision Resize(size) + CenterCrop(size), which the model was measured with
        nw, nh = (self.size, int(self.size * h / w)) if w <= h else (int(self.size * w / h), self.size)
        im = im.resize((nw, nh), Image.BICUBIC)
        left, top = int(round((nw - self.size) / 2.0)), int(round((nh - self.size) / 2.0))
        a = np.asarray(im.crop((left, top, left + self.size, top + self.size)), dtype=np.float32) / 255.0
        a = ((a - self.mean) / self.std).astype(np.float32).transpose(2, 0, 1)[None]
        session = self._load()
        out = session.run(None, {session.get_inputs()[0].name: a})[0][0]
        return out.astype(np.float64)


class PhotoModelUnavailable(RuntimeError):
    """The photo model cannot be reached right now (a remote worker is down, starting, or serves another model)."""


class RemoteBackbone:
    """The API's side of a photo worker on another machine: the small files are local, the 1.2 GB model runs there."""

    def __init__(self, d: Path, url: str, token: str):
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        self.model = f"{meta['name']}@{meta['version']}"
        text = np.load(d / "text.npz")
        self.labels, self.T = [str(x) for x in text["labels"]], text["T"].astype(np.float64)
        self._expected_sha = json.loads((d / "export_report.json").read_text(encoding="utf-8"))["vision_onnx_sha256"]
        self.url, self._token = url.rstrip("/"), token
        self._checked, self._lock = False, threading.Lock()

    def _call(self, path: str, body: bytes | None = None, timeout: float = 120) -> dict:
        req = urllib.request.Request(self.url + path, data=body, method="POST" if body is not None else "GET",
                                     headers={"X-Photo-Token": self._token, "Content-Type": "application/octet-stream"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 422:
                raise ValueError("not a readable image") from e
            raise PhotoModelUnavailable(f"the photo worker answered {e.code}") from e
        except OSError as e:   # URLError, timeouts, refused connections
            raise PhotoModelUnavailable("the photo worker cannot be reached") from e

    def _check(self) -> None:
        with self._lock:
            if not self._checked:
                meta = self._call("/meta")
                if meta.get("model") != self.model or meta.get("sha256") != self._expected_sha:
                    raise PhotoModelUnavailable("the photo worker serves a different model file")
                self._checked = True

    @property
    def sha256(self) -> str:
        return self._expected_sha

    def warm(self) -> None:
        """Wake the worker (it may scale to zero) without failing the API if it is not up yet."""
        def wake():
            try:
                self._check()
            except PhotoModelUnavailable:
                pass
        threading.Thread(target=wake, daemon=True).start()

    def features(self, image: bytes) -> np.ndarray:
        self._check()
        return np.asarray(self._call("/features", image)["features"], dtype=np.float64)


_lock = threading.Lock()
_loaded: dict[tuple[str, str], "Backbone | RemoteBackbone | None"] = {}


def load() -> "Backbone | RemoteBackbone | None":
    d, remote = os.environ.get("KRISHILENS_DIR", ""), os.environ.get("KRISHILENS_REMOTE_URL", "")
    with _lock:
        if (d, remote) not in _loaded:
            p = Path(d) if d else None
            if p and (p / "vision.onnx").exists():
                bb = Backbone(p)
            elif p and remote and (p / "meta.json").exists():
                bb = RemoteBackbone(p, remote, os.environ.get("PHOTO_WORKER_TOKEN", ""))
            else:
                bb = None
            _loaded[(d, remote)] = bb
        return _loaded[(d, remote)]
