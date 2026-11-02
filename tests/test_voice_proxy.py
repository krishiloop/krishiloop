"""The sovereign speech-to-text proxy (services/voice_proxy): off by default, loopback only, audio passed through as is.

The voice service is faked with httpx.MockTransport: no socket is opened and no model is loaded.
"""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from services.api import main
from services.voice_proxy import proxy

WEBM = b"\x1aE\xdf\xa3fake-webm-opus-bytes" * 8


class FakeVoiceService:
    """Stands in for ml/voice/service.py: records what it was sent, answers like the real one."""

    def __init__(self, asr_status=200, asr_body=None, health=None, down=False):
        self.calls = []
        self.asr_status, self.down = asr_status, down
        self.asr_body = asr_body if asr_body is not None else {
            "text": "ধানে বাদামি গাছফড়িং দেখছি, এখন কি স্প্রে করব", "language": "bn",
            "model": "omniASR_CTC_1B_v2 (native PyTorch port)", "audio_s": 3.2, "processing_ms": 41.0}
        self.health = health if health is not None else {"status": "ok", "asr": "omni-ctc-1b", "tts": "svara", "loaded": []}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        if request.url.path == "/health":
            return httpx.Response(200, json=self.health)
        if request.url.path == "/asr" and request.method == "POST":
            return httpx.Response(self.asr_status, json=self.asr_body)
        return httpx.Response(404, json={"detail": "Not Found"})


@pytest.fixture()
def fake(monkeypatch):
    svc = FakeVoiceService()
    monkeypatch.setattr(proxy, "transport", httpx.MockTransport(svc))
    monkeypatch.setattr(proxy, "_hits", type(proxy._hits)(proxy._hits.default_factory))
    return svc


@pytest.fixture()
def client():
    return TestClient(main.app)


def post_audio(client, data=WEBM, ctype="audio/webm;codecs=opus"):
    return client.post("/api/voice/asr", content=data, headers={"Content-Type": ctype})


def test_off_by_default_503_and_health_says_so(client, fake, monkeypatch):
    monkeypatch.delenv(proxy.ENV, raising=False)
    h = client.get("/api/voice/health")
    assert h.status_code == 200 and h.json()["available"] is False and h.json()["reason"] == "not configured"
    r = post_audio(client)
    assert r.status_code == 503 and "off" in r.json()["detail"]
    assert fake.calls == []                       # nothing was sent anywhere


@pytest.mark.parametrize("url", ["http://voice.example.com:8765", "http://10.0.0.5:8765", "ftp://127.0.0.1:8765",
                                 "http://user:pw@127.0.0.1:8765", "http://127.0.0.1:notaport", "127.0.0.1:8765"])
def test_refuses_anything_but_loopback(client, fake, monkeypatch, url):
    monkeypatch.setenv(proxy.ENV, url)
    assert client.get("/api/voice/health").json()["available"] is False
    assert post_audio(client).status_code == 503
    assert fake.calls == []                       # the audio never left


@pytest.mark.parametrize("url", ["http://127.0.0.1:8765", "http://localhost:8765/", "http://[::1]:8765"])
def test_loopback_urls_are_accepted(monkeypatch, url):
    monkeypatch.setenv(proxy.ENV, url)
    assert proxy.voice_url()[0] == url.rstrip("/")


def test_health_reports_the_service(client, fake, monkeypatch):
    monkeypatch.setenv(proxy.ENV, "http://127.0.0.1:8765")
    body = client.get("/api/voice/health").json()
    assert body["available"] is True and body["model"] == "omni-ctc-1b" and "loopback" in body["where"]
    assert str(fake.calls[0].url) == "http://127.0.0.1:8765/health"


def test_asr_passes_the_audio_through_and_returns_the_text(client, fake, monkeypatch):
    monkeypatch.setenv(proxy.ENV, "http://127.0.0.1:8765")
    r = post_audio(client)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["text"] == fake.asr_body["text"] and out["language"] == "bn" and out["model"].startswith("omniASR")
    sent = fake.calls[-1]
    assert str(sent.url) == "http://127.0.0.1:8765/asr" and sent.method == "POST"
    raw = sent.read()
    assert b'name="audio"' in raw and b'filename="question.webm"' in raw and b"Content-Type: audio/webm" in raw
    assert WEBM in raw                            # byte for byte, not re-encoded


def test_asr_rejects_non_audio_and_too_large(client, fake, monkeypatch):
    monkeypatch.setenv(proxy.ENV, "http://127.0.0.1:8765")
    assert post_audio(client, ctype="application/json").status_code == 415
    assert post_audio(client, data=b"").status_code == 400
    monkeypatch.setattr(proxy, "MAX_UPLOAD", 64)
    assert post_audio(client, data=b"x" * 65).status_code == 413
    assert fake.calls == []


def test_service_errors_are_passed_on_honestly(client, monkeypatch):
    monkeypatch.setenv(proxy.ENV, "http://127.0.0.1:8765")
    monkeypatch.setattr(proxy, "_hits", type(proxy._hits)(proxy._hits.default_factory))
    short = FakeVoiceService(asr_status=400, asr_body={"detail": "audio too short"})
    monkeypatch.setattr(proxy, "transport", httpx.MockTransport(short))
    r = post_audio(client)
    assert r.status_code == 400 and r.json()["detail"] == "audio too short"
    monkeypatch.setattr(proxy, "transport", httpx.MockTransport(FakeVoiceService(down=True)))
    assert post_audio(client).status_code == 503
    assert client.get("/api/voice/health").json() == {"available": False, "reason": "voice service not reachable",
                                                     "model": None, "where": proxy.WHERE}
    monkeypatch.setattr(proxy, "transport", httpx.MockTransport(FakeVoiceService(asr_status=500, asr_body={"oops": 1})))
    assert post_audio(client).status_code == 502


def test_rate_limit(client, fake, monkeypatch):
    monkeypatch.setenv(proxy.ENV, "http://127.0.0.1:8765")
    monkeypatch.setattr(proxy, "LIMIT_PER_MIN", 2)
    assert [post_audio(client).status_code for _ in range(3)] == [200, 200, 429]


def test_routes_are_mounted_in_the_api():
    paths = main.app.openapi()["paths"]
    assert "post" in paths["/api/voice/asr"] and "get" in paths["/api/voice/health"]   # documented in /openapi.json
    assert json.dumps(paths["/api/voice/asr"])
