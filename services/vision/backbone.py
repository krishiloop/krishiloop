"""Server-side image features for photo cases (sovereign mode: the RTX 5090; staging: CPU).

Install: put an exported vision tower in $KRISHILENS_DIR:
  vision.onnx  image [1,3,S,S] float32 -> features [1,d]
  text.npz     labels (class ids) + T (L2-normalised text embeddings of the class descriptions, same model)
  meta.json    {"name", "version", "size", "mean", "std"}
ml/vision/export_backbone.py writes all three. Without them the photo endpoints answer 503: a photo is never guessed at.
onnxruntime and Pillow are imported only here, so the rest of the API runs without them.

Loading is in two parts: the small files at once (model name, labels, text embeddings), the 1.2 GB session and the file
hash lazily, or ahead of time with warm(), so area statistics never wait for the model.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import threading
from pathlib import Path

import numpy as np


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
                self._session = ort.InferenceSession(str(self.onnx_path), providers=ort.get_available_providers())
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


_lock = threading.Lock()
_loaded: dict[str, Backbone | None] = {}


def load() -> Backbone | None:
    d = os.environ.get("KRISHILENS_DIR", "")
    with _lock:
        if d not in _loaded:
            _loaded[d] = Backbone(Path(d)) if d and (Path(d) / "vision.onnx").exists() else None
        return _loaded[d]
