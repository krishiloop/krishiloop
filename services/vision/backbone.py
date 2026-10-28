"""Server-side image features for photo cases (sovereign mode: the RTX 5090; staging: CPU).

Install: put an exported vision tower in $KRISHILENS_DIR:
  vision.onnx  image [1,3,S,S] float32 -> features [1,d]
  text.npz     labels (class ids) + T (L2-normalised text embeddings of the class descriptions, same model)
  meta.json    {"name", "version", "size", "mean", "std"}
ml/vision/export_backbone.py writes all three. Without them the photo endpoints answer 503: a photo is never guessed at.
onnxruntime and Pillow are imported only here, so the rest of the API runs without them.
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
        import onnxruntime as ort
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        self.model = f"{meta['name']}@{meta['version']}"
        self.size, self.mean, self.std = int(meta["size"]), np.array(meta["mean"]), np.array(meta["std"])
        onnx_path = d / "vision.onnx"
        self.sha256 = hashlib.sha256(onnx_path.read_bytes()).hexdigest()
        self.session = ort.InferenceSession(str(onnx_path), providers=ort.get_available_providers())
        text = np.load(d / "text.npz")
        self.labels, self.T = [str(x) for x in text["labels"]], text["T"].astype(np.float64)

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
        out = self.session.run(None, {self.session.get_inputs()[0].name: a})[0][0]
        return out.astype(np.float64)


_lock = threading.Lock()
_loaded: dict[str, Backbone | None] = {}


def load() -> Backbone | None:
    d = os.environ.get("KRISHILENS_DIR", "")
    with _lock:
        if d not in _loaded:
            _loaded[d] = Backbone(Path(d)) if d and (Path(d) / "vision.onnx").exists() else None
        return _loaded[d]
