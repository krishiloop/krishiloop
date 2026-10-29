"""Sovereign Bangla voice service for KrishiLoop: PROTOTYPE, not wired into the app.

Speech never leaves the machine: audio in, text out, and text in, audio out, all on our own GPU.

  POST /asr   multipart field "audio" (webm/ogg/opus/wav/mp3/m4a; up to 30 s, 10 MB)
              -> {"text", "language": "bn", "model", "audio_s", "processing_ms"}
  POST /tts   JSON {"text": "...", "voice": "male" (default) | "female"} (up to 400 characters)
              -> audio/ogg (Opus); headers X-Model, X-Audio-Seconds, X-Processing-Ms
  GET  /health -> which models are configured and loaded

Rules (NBTC lab contract): binds 127.0.0.1 only, models load lazily on first use, run only during tests.
Configuration is process-scoped environment variables:
  VOICE_MODELS  models root            (default F:\\krishiloop-5090\\models\\voice)
  VOICE_ASR     omni-ctc-1b | omni-ctc-3b | whisper-turbo   (default omni-ctc-1b)
  VOICE_TTS     svara | mms            (default svara; mms is CC BY-NC and may only be used for comparison)

Run:  python service.py --port 8765
"""

import argparse
import io
import os
import sys
import threading
import time
import unicodedata

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MODELS = os.environ.get("VOICE_MODELS", r"F:\krishiloop-5090\models\voice")
ASR_CHOICE = os.environ.get("VOICE_ASR", "omni-ctc-1b")
TTS_CHOICE = os.environ.get("VOICE_TTS", "svara")
MAX_UPLOAD = 10 * 1024 * 1024
MAX_AUDIO_S = 30.0
MAX_TEXT = 400
LOOPBACK = {"127.0.0.1", "::1", "localhost"}

_lock = threading.Lock()  # one GPU: serialise model calls
_models: dict = {}


def _asr():
    with _lock:
        if "asr" not in _models:
            if ASR_CHOICE.startswith("omni-ctc"):
                from omni_ctc import OmniCTCTranscriber
                size = ASR_CHOICE.split("-")[-1]  # 1b | 3b
                _models["asr"] = OmniCTCTranscriber(
                    os.path.join(MODELS, "omniasr", f"omniASR-CTC-{size.upper()}-v2.pt"),
                    os.path.join(MODELS, "omniasr", "omniASR_tokenizer_written_v2.model"), arch=f"{size}_v2")
            elif ASR_CHOICE == "whisper-turbo":
                from asr_eval import WhisperASR
                _models["asr"] = WhisperASR(os.path.join(MODELS, "whisper-large-v3-turbo"))
            else:
                raise RuntimeError(f"unknown VOICE_ASR {ASR_CHOICE}")
        return _models["asr"]


def _tts():
    with _lock:
        if "tts" not in _models:
            if TTS_CHOICE == "svara":
                from tts_eval import SvaraTTS
                _models["tts"] = SvaraTTS(os.path.join(MODELS, "svara-tts-v1"), os.path.join(MODELS, "svara-tts-v1-gguf"),
                                          "svara-tts-v1.Q8_0.gguf", os.path.join(MODELS, "snac_24khz"))
            elif TTS_CHOICE == "mms":
                from tts_eval import MmsTTS
                _models["tts"] = MmsTTS(os.path.join(MODELS, "mms-tts-ben"))
            else:
                raise RuntimeError(f"unknown VOICE_TTS {TTS_CHOICE}")
        return _models["tts"]


def decode_audio(data: bytes, target_sr: int = 16000) -> np.ndarray:
    """Decode any container/codec FFmpeg knows (webm/opus from MediaRecorder, ogg, wav, mp3, m4a) to mono 16 kHz."""
    import av
    chunks = []
    with av.open(io.BytesIO(data)) as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise ValueError("no audio stream")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=target_sr)
        for frame in container.decode(stream):
            for f in resampler.resample(frame):
                chunks.append(f.to_ndarray().reshape(-1))
        for f in resampler.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "")
    return "".join(c for c in text if unicodedata.category(c) not in ("Cc", "Co", "Cs") or c in "\n\t").strip()


def create_app():
    from fastapi import FastAPI, File, HTTPException, UploadFile
    from fastapi.responses import Response
    from pydantic import BaseModel

    app = FastAPI(title="KrishiLoop sovereign voice (prototype)", version="0.1")

    class TTSIn(BaseModel):
        text: str
        voice: str = "male"  # the female svara voice was often heard as Hindi by the ASR (round-trip test, 29 Oct)

    @app.get("/health")
    def health():
        return {"status": "ok", "asr": ASR_CHOICE, "tts": TTS_CHOICE, "loaded": sorted(_models),
                "bind": "127.0.0.1 only", "note": "prototype; audio and text stay on this machine"}

    @app.post("/asr")
    def asr(audio: UploadFile = File(...)):
        data = audio.file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "audio too large (10 MB max)")
        try:
            wav = decode_audio(data)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"could not decode audio: {type(e).__name__}")
        dur = len(wav) / 16000
        if dur < 0.2:
            raise HTTPException(400, "audio too short")
        if dur > MAX_AUDIO_S:
            raise HTTPException(413, f"audio too long ({dur:.1f} s; {MAX_AUDIO_S:.0f} s max)")
        model = _asr()
        t0 = time.perf_counter()
        with _lock:
            text = model.transcribe(wav)
        ms = 1000 * (time.perf_counter() - t0)
        return {"text": text, "language": "bn", "model": model.name, "audio_s": round(dur, 2),
                "processing_ms": round(ms, 1)}

    @app.post("/tts")
    def tts(body: TTSIn):
        import soundfile as sf
        text = clean_text(body.text)
        if not text:
            raise HTTPException(400, "empty text")
        if len(text) > MAX_TEXT:
            raise HTTPException(413, f"text too long ({MAX_TEXT} characters max)")
        model = _tts()
        voice = "Bengali (Male)" if body.voice.lower().startswith("m") else "Bengali (Female)"
        max_tokens = min(2048, 12 * len(text) + 200)  # ~7 audio tokens per character is typical; cap runaways
        t0 = time.perf_counter()
        with _lock:
            wav, _info = model.synth(text, voice=voice, seed=0, max_new_tokens=max_tokens, lean=True)
        ms = 1000 * (time.perf_counter() - t0)
        if len(wav) == 0:
            raise HTTPException(500, "synthesis produced no audio")
        buf = io.BytesIO()
        sf.write(buf, np.clip(wav, -1, 1), model.sr, format="OGG", subtype="OPUS")
        return Response(buf.getvalue(), media_type="audio/ogg",
                        headers={"X-Model": model.name.split(" [")[0][:120], "X-Audio-Seconds": f"{len(wav)/model.sr:.2f}",
                                 "X-Processing-Ms": f"{ms:.0f}"})

    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    if a.host not in LOOPBACK:
        sys.exit("refusing to bind a non-loopback address: this service is for 127.0.0.1 only")
    import uvicorn
    uvicorn.run(create_app(), host=a.host, port=a.port, log_level="info")
