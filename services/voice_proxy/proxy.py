"""Sovereign speech input: the farmer app's audio goes to OUR voice service on this machine, never to a third party.

  GET  /api/voice/health  -> {"available": bool, "reason": str | None, "model": str | None, "where": "..."}
  POST /api/voice/asr     the recording as the raw request body (Content-Type audio/*, up to 10 MB)
                          -> {"text", "language", "model", "audio_s", "processing_ms", "where"}

Off by default. The service (ml/voice/service.py: Omnilingual CTC-1B, Apache-2.0) is reached at the URL in the
environment variable KRISHILOOP_VOICE_URL, for example http://127.0.0.1:8765. Without it, /asr answers 503 and /health
says available: false. A URL that is not loopback (127.0.0.1, ::1, localhost) is refused the same way: the audio must
not leave the machine that runs the API. The audio is passed through in memory; it is neither stored nor logged here.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request

ENV = "KRISHILOOP_VOICE_URL"
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
MAX_UPLOAD = 10 * 1024 * 1024          # the service's own limit (ml/voice/service.py)
LIMIT_PER_MIN = 20
HEALTH_TIMEOUT_S, ASR_TIMEOUT_S = 2.0, 30.0
WHERE = "our own voice service on this server (loopback only)"
EXT = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
       "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav"}

router = APIRouter(prefix="/api/voice", tags=["voice"])
transport: httpx.AsyncBaseTransport | None = None   # tests put an httpx.MockTransport here: no network at all
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def voice_url() -> tuple[str | None, str | None]:
    """(base URL, None) when the sovereign path is on, else (None, why it is off)."""
    raw = os.environ.get(ENV, "").strip()
    if not raw:
        return None, "not configured"
    try:
        u = urlsplit(raw)
        host = (u.hostname or "").lower()
        u.port   # raises ValueError on a malformed port
    except ValueError:
        return None, "invalid URL"
    if u.scheme not in ("http", "https") or host not in LOOPBACK or u.username or u.password:
        return None, "refused: the voice service must be on this machine (loopback URL)"
    return raw.rstrip("/"), None


def _client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, transport=transport, follow_redirects=False)


def _limited(client: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _hits[client]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= LIMIT_PER_MIN:
            return True
        q.append(now)
    return False


@router.get("/health")
async def voice_health():
    """Is our own speech-to-text reachable? The app shows the sovereign microphone only when it is."""
    url, why = voice_url()
    if not url:
        return {"available": False, "reason": why, "model": None, "where": WHERE}
    try:
        async with _client(HEALTH_TIMEOUT_S) as c:
            r = await c.get(f"{url}/health")
        body = r.json() if r.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        return {"available": False, "reason": "voice service not reachable", "model": None, "where": WHERE}
    ok = isinstance(body, dict) and body.get("status") == "ok" and bool(body.get("asr"))
    return {"available": ok, "reason": None if ok else "voice service not ready",
            "model": str(body.get("asr"))[:80] if ok else None, "where": WHERE}


@router.post("/asr")
async def voice_asr(request: Request):
    """A farmer's recorded question -> text, on our own GPU. Never stored; the text goes into the normal Ask flow."""
    url, why = voice_url()
    if not url:
        raise HTTPException(503, f"our own speech-to-text is off on this server ({why})")
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not ctype.startswith("audio/"):
        raise HTTPException(415, "send the recording as audio (webm, ogg, mp4, wav or mp3)")
    if _limited(request.client.host if request.client else "unknown"):
        raise HTTPException(429, "too many recordings; try again in a minute")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD:
        raise HTTPException(413, "audio too large (10 MB max)")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_UPLOAD:
            raise HTTPException(413, "audio too large (10 MB max)")
    if not body:
        raise HTTPException(400, "empty recording")
    files = {"audio": (f"question.{EXT.get(ctype, 'bin')}", bytes(body), ctype)}
    try:
        async with _client(ASR_TIMEOUT_S) as c:
            r = await c.post(f"{url}/asr", files=files)
    except httpx.HTTPError:
        raise HTTPException(503, "our voice service is not reachable right now")
    finally:
        body.clear()
    try:
        data = r.json()
    except ValueError:
        data = None
    if r.status_code in (400, 413):     # the service's own answer about the audio (too short, too long, unreadable)
        detail = data.get("detail") if isinstance(data, dict) else None
        raise HTTPException(r.status_code, str(detail or "the voice service could not use this recording")[:200])
    if r.status_code != 200 or not isinstance(data, dict) or not isinstance(data.get("text"), str):
        raise HTTPException(502, "the voice service sent an unexpected answer")
    return {"text": data["text"].strip()[:1000], "language": str(data.get("language", "bn"))[:8],
            "model": str(data.get("model", ""))[:120], "audio_s": data.get("audio_s"),
            "processing_ms": data.get("processing_ms"), "where": WHERE}
