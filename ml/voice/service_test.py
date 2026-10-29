"""Start the voice service on 127.0.0.1, exercise /health, /tts and /asr, then stop it (always).

Writes <out>/service_test.json and the audio it produced. Checks: loopback-only bind (netstat), TTS returns
Ogg/Opus, ASR accepts wav, ogg/opus and webm/opus (what a browser MediaRecorder sends), size limits work,
warm latencies, and that no server process is left behind.
"""
import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bn_text import utterance_errors  # noqa: E402


def listening_addrs(port):
    out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True).stdout
    return sorted({ln.split()[1] for ln in out.splitlines() if f":{port} " in ln and "LISTENING" in ln})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fleurs-manifest", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    here = os.path.dirname(os.path.abspath(__file__))
    rep = {"asr": os.environ.get("VOICE_ASR", "omni-ctc-1b"), "tts": os.environ.get("VOICE_TTS", "svara"), "checks": {}}
    proc = subprocess.Popen([sys.executable, os.path.join(here, "service.py"), "--port", str(a.port)],
                            stdout=open(os.path.join(a.out, "service_log.txt"), "w"), stderr=subprocess.STDOUT)
    try:
        for _ in range(120):
            try:
                if requests.get(base + "/health", timeout=2).ok:
                    break
            except requests.RequestException:
                time.sleep(1)
        rep["health"] = requests.get(base + "/health", timeout=5).json()
        rep["listening_on"] = listening_addrs(a.port)
        rep["checks"]["loopback_only"] = all(x.startswith("127.0.0.1:") or x.startswith("[::1]:") for x in rep["listening_on"])

        text = "শিষের গোড়ায় বাদামি দাগ আছে কি না দেখুন। পেলে আপনার কর্মকর্তাকে জানান।"  # R-BDR-007 title.bn
        t0 = time.perf_counter()
        r = requests.post(base + "/tts", json={"text": text, "voice": "male"}, timeout=600)
        rep["tts_first_call_s"] = round(time.perf_counter() - t0, 2)  # includes lazy model load
        rep["checks"]["tts_ok"] = r.ok and r.headers.get("content-type", "").startswith("audio/ogg")
        ogg = os.path.join(a.out, "tts_R-BDR-007.ogg")
        open(ogg, "wb").write(r.content)
        rep["tts_headers"] = {k: v for k, v in r.headers.items() if k.lower().startswith("x-")}
        rep["tts_bytes"] = len(r.content)
        warm = []
        for _ in range(2):
            t0 = time.perf_counter()
            requests.post(base + "/tts", json={"text": text, "voice": "male"}, timeout=600)
            warm.append(time.perf_counter() - t0)
        rep["tts_warm_s"] = [round(x, 2) for x in warm]

        t0 = time.perf_counter()
        r = requests.post(base + "/asr", files={"audio": ("a.ogg", open(ogg, "rb"), "audio/ogg")}, timeout=600)
        rep["asr_first_call_s"] = round(time.perf_counter() - t0, 2)
        j = r.json()
        rep["roundtrip_service"] = {"source": text, "asr": j, "cer_pct": round(100 * utterance_errors(text, j.get("text", ""))["char_edits"] / max(1, utterance_errors(text, j.get("text", ""))["ref_chars"]), 1)}
        rep["checks"]["asr_ogg_ok"] = r.ok

        row = next(json.loads(x) for x in open(a.fleurs_manifest, encoding="utf-8") if json.loads(x)["dur_s"] >= 6)
        r = requests.post(base + "/asr", files={"audio": ("a.wav", open(row["wav"], "rb"), "audio/wav")}, timeout=600)
        e = utterance_errors(row["ref"], r.json().get("text", ""))
        rep["fleurs_wav"] = {"id": row["id"], "dur_s": row["dur_s"], "asr": r.json(), "cer_pct": round(100 * e["char_edits"] / max(1, e["ref_chars"]), 1)}
        rep["checks"]["asr_wav_ok"] = r.ok

        # simulate a browser MediaRecorder upload: webm container, Opus codec, 48 kHz
        webm = os.path.join(a.out, "fleurs_sample.webm")
        ffmpeg = shutil.which("ffmpeg")
        try:
            if ffmpeg:
                subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", row["wav"], "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", webm], check=True)
            else:  # PyAV ships its own FFmpeg
                import av
                import numpy as np
                import soundfile as sf
                from scipy.signal import resample_poly
                w, sr = sf.read(row["wav"], dtype="float32")
                w48 = resample_poly(w, 3, 1).astype(np.float32) if sr == 16000 else w
                with av.open(webm, "w", format="webm") as c:
                    st = c.add_stream("libopus", rate=48000, layout="mono")
                    fr = av.AudioFrame.from_ndarray(w48.reshape(1, -1), format="flt", layout="mono")
                    fr.sample_rate = 48000
                    for pkt in st.encode(fr):
                        c.mux(pkt)
                    for pkt in st.encode(None):
                        c.mux(pkt)
            rep["webm_made_with"] = "ffmpeg" if ffmpeg else "PyAV"
        except Exception as e:  # noqa: BLE001
            rep["webm_error"] = f"{type(e).__name__}: {e}"
        if os.path.exists(webm):
            r = requests.post(base + "/asr", files={"audio": ("a.webm", open(webm, "rb"), "audio/webm")}, timeout=600)
            e = utterance_errors(row["ref"], r.json().get("text", ""))
            rep["fleurs_webm_opus"] = {"bytes": os.path.getsize(webm), "asr": r.json(), "cer_pct": round(100 * e["char_edits"] / max(1, e["ref_chars"]), 1)}
            rep["checks"]["asr_webm_ok"] = r.ok

        clip5 = os.path.join(a.out, "clip5.wav")
        import soundfile as sf
        w, sr = sf.read(row["wav"], dtype="float32")
        sf.write(clip5, w[: sr * 5], sr)
        lat = []
        for _ in range(5):
            t0 = time.perf_counter()
            requests.post(base + "/asr", files={"audio": ("c.wav", open(clip5, "rb"), "audio/wav")}, timeout=600)
            lat.append(time.perf_counter() - t0)
        rep["asr_5s_clip_end_to_end_ms"] = {"median": round(1000 * statistics.median(lat), 1), "all": [round(1000 * x) for x in lat]}

        r = requests.post(base + "/tts", json={"text": "ক" * 401}, timeout=60)
        rep["checks"]["tts_rejects_long_text"] = r.status_code == 413
        r = requests.post(base + "/asr", files={"audio": ("x.webm", b"not audio at all", "audio/webm")}, timeout=60)
        rep["checks"]["asr_rejects_garbage"] = r.status_code == 400
    finally:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        time.sleep(2)
        rep["after_stop_listening_on"] = listening_addrs(a.port)
        rep["checks"]["stopped"] = not rep["after_stop_listening_on"]
        json.dump(rep, open(os.path.join(a.out, "service_test.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
