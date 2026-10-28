"""Photo worker: runs the 1.2 GB photo model on its own machine and returns image features to the API.

Run: KRISHILENS_DIR=<model dir> PHOTO_WORKER_TOKEN=<secret> uvicorn services.vision.worker:app --port 8001
Only the API may call it: a shared secret in X-Photo-Token (and, on Azure, internal ingress only). It keeps nothing: an
image comes in, a feature vector goes out. The API checks /meta before the first photo, so a different model file is
refused rather than mixed into an area's evidence.
"""
from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request

from services.vision.backbone import Backbone

MAX_BYTES = 4_000_000
app = FastAPI(title="KrishiLoop photo worker", version="0.1.0")
_backbone: Backbone | None = None


def backbone() -> Backbone:
    global _backbone
    if _backbone is None:
        d = Path(os.environ.get("KRISHILENS_DIR", ""))
        if not (d / "vision.onnx").exists():
            raise HTTPException(503, "no photo model in KRISHILENS_DIR")
        _backbone = Backbone(d)
    return _backbone


def _auth(token: str) -> None:
    expected = os.environ.get("PHOTO_WORKER_TOKEN", "")
    if not expected or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(403, "worker token required")


@app.on_event("startup")
def _warm() -> None:
    try:
        backbone().warm()
    except HTTPException:
        pass


@app.get("/health")
def health():
    try:
        return {"ok": True, "model": backbone().model}
    except HTTPException:
        return {"ok": False, "model": None}


@app.get("/meta")
def meta(x_photo_token: str = Header(default="")):
    _auth(x_photo_token)
    bb = backbone()
    return {"model": bb.model, "sha256": bb.sha256, "labels": bb.labels}


@app.post("/features")
async def features(request: Request, x_photo_token: str = Header(default="")):
    _auth(x_photo_token)
    image = await request.body()
    if not image or len(image) > MAX_BYTES:
        raise HTTPException(413 if image else 422, "image missing or too large")
    try:
        return {"features": backbone().features(image).tolist()}
    except (OSError, ValueError):
        raise HTTPException(422, "not a readable image")
