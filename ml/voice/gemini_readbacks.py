"""Make the app's spoken readbacks with Google Gemini 3.8 Flash TTS, once, ahead of time (owner, 20 Nov: "a much better Bangla and
English voice, more human, less computationally heavy, latest tech").

Gemini 3.8 Flash TTS is a hosted model: it runs here once per text, at build time, and the app only plays the small Opus
files it made. Phones do no speech work, and no farmer text or data is ever sent (only our own rule texts and notices).

Every clip keeps the readback promise of readbacks.py:
  - it is keyed by rule id + version (or notice id) + the sha256 of the normalised text, and the app plays it only for
    that exact text; anything else falls back to the device's voice;
  - it is transcribed back (Gemini 3.8 Flash, speech to text) and held back when the round trip is worse than 10 % CER,
    the same gate the svara clips passed on 29 Oct (a SYNTHETIC check, not a native listen);
  - a Bangla rule with no passing Gemini clip keeps its svara-tts-v1 clip (Built with Llama) if it has one, labelled as
    that voice per clip.

  python ml/voice/gemini_readbacks.py              (GEMINI_API_KEY from the environment; never printed)
  python ml/voice/gemini_readbacks.py --no-synth   (no new audio: round-trip the files on disk and rebuild the manifest)

The free tier allows only a few TTS requests a day; a run stops at the daily limit and the next run carries on.
Writes apps/web/public/audio/<lang>/gemini38-<sha16>.ogg, apps/web/public/audio/manifest.json and
ml/voice/results/gemini_roundtrip.json.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bn_text import utterance_errors  # noqa: E402  (the scoring used for every voice number in REPORT.md)
from readbacks import MAX_CER, SCHEMA, norm_spoken, text_sha  # noqa: E402  (the same normalisation the app uses)

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "apps" / "web"
AUDIO = WEB / "public" / "audio"
I18N = WEB / "src" / "lib" / "i18n"
ROUNDTRIP = Path(__file__).resolve().parent / "results" / "gemini_roundtrip.json"
# TTS models in order of preference, each with its own file prefix (clips of two models never mix). The free tier gives
# each model a small daily quota; when the first is used up, the next takes over, in the same "Kore" voice.
MODELS = [("gemini-3.8-flash-tts", "gemini38"), ("gemini-3.8-flash-lite-tts", "gemini38l"), ("gemini-3.1-flash-tts-preview", "gemini31")]
MODEL = MODELS[0][0]
VOICE = "Kore"
# speech-to-text for the round trip, also in order (each has its own daily quota); every record names the model it used
ASR_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-flash-latest"]
ASR_MODEL = ASR_MODELS[0]
LANGS = ("bn", "en")
LANG_NAME = {"bn": "Bangla (Bengali script)", "en": "English"}
NOTICES = {"recalled": "fa.voice.recalledSay", "invalid": "fa.voice.invalidSay"}
API = "https://generativelanguage.googleapis.com/v1beta/models"


class DailyLimit(Exception):
    pass


def i18n_value(lang: str, key: str) -> str | None:
    for f in sorted(I18N.glob(f"{lang}.*.ts")):
        for line in f.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*'" + re.escape(key) + r"':\s*'(.*)',\s*$", line)
            if m:
                return m.group(1).replace("\\'", "'")
    return None


def texts() -> list[dict]:
    """Notices first (they guard recalled advice), then every active rule's action title, Bangla before English."""
    out, seen = [], set()
    for nid, key in NOTICES.items():
        for lang in LANGS:
            t = i18n_value(lang, key)
            if t:
                out.append({"kind": "notice", "notice_id": nid, "lang": lang, "text": norm_spoken(t)})
    rules = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in sorted((ROOT / "rules" / "registry").glob("*/R-*.yaml"))]
    for lang in LANGS:
        for r in rules:
            if r.get("status") != "active":
                continue
            t = (((r.get("action") or {}).get("title") or r.get("title") or {}).get(lang) or "").strip()
            k = (r["rule_id"], r["version"], lang)
            if t and k not in seen:
                seen.add(k)
                out.append({"kind": "rule", "rule_id": r["rule_id"], "version": r["version"], "lang": lang, "text": norm_spoken(t)})
    return out


def post(model: str, body: dict, key: str) -> dict:
    req = urllib.request.Request(f"{API}/{model}:generateContent", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace").replace(key, "***")
            if e.code == 429 and ("PerDay" in msg or "per day" in msg.lower()):
                raise DailyLimit(model) from None
            if e.code in (429, 500, 503) and attempt < 2:
                time.sleep(30 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code} from {model}: {msg[:200]}") from None
    raise RuntimeError(f"{model}: no answer")


def synth(text: str, key: str, model: str) -> np.ndarray:
    d = post(model, {"contents": [{"parts": [{"text": text}]}],
                     "generationConfig": {"responseModalities": ["AUDIO"],
                                          "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}}}, key)
    pcm = base64.b64decode(d["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def transcribe(path: Path, lang: str, key: str, model: str) -> str:
    audio = base64.b64encode(path.read_bytes()).decode()
    d = post(model, {"contents": [{"parts": [
        {"inlineData": {"mimeType": "audio/ogg", "data": audio}},
        {"text": f"Transcribe this speech word for word in {LANG_NAME[lang]}. Write only what is said, nothing else."}]}],
        "generationConfig": {"temperature": 0}}, key)
    return "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"]).strip()


def entry(it: dict, rel: str, model: str, cer: float | None, hyp: str | None, asr: str) -> dict:
    import soundfile as sf
    p = AUDIO / rel
    return {**it, "text_sha256": text_sha(it["text"]), "file": rel, "bytes": p.stat().st_size,
            "audio_s": round(sf.info(str(p)).duration, 3), "voice": f"gemini:{model}:{VOICE}", "roundtrip_cer_pct": cer, "roundtrip_asr": asr,
            "roundtrip_text": hyp}


def main() -> int:
    import soundfile as sf
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-synth", action="store_true", help="make no new audio; round-trip the files on disk only")
    a = ap.parse_args()
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("GEMINI_API_KEY is not set")
        return 2
    items = texts()
    old = json.loads((AUDIO / "manifest.json").read_text(encoding="utf-8")) if (AUDIO / "manifest.json").exists() else {}
    rt = json.loads(ROUNDTRIP.read_text(encoding="utf-8")) if ROUNDTRIP.exists() else {}
    closed: set[str] = set() if not a.no_synth else {m for m, _ in MODELS}   # models whose daily quota is used up
    asr_closed: set[str] = set()
    made = held = 0
    gem: dict[tuple, dict] = {}
    for it in items:
        sha = text_sha(it["text"])
        have = [(m, f"{it['lang']}/{pre}-{sha[:16]}.ogg") for m, pre in MODELS if (AUDIO / it["lang"] / f"{pre}-{sha[:16]}.ogg").exists()]
        if have:
            model, rel = have[0]
        else:
            x = None
            for model, pre in MODELS:
                if model in closed:
                    continue
                try:
                    x = synth(it["text"], key, model)
                    break
                except DailyLimit:
                    print(f"{model}: daily limit reached", flush=True)
                    closed.add(model)
                except Exception as e:  # noqa: BLE001
                    print(f"TTS failed for {it.get('rule_id') or it.get('notice_id')} {it['lang']} ({model}): {e}", flush=True)
                    break
            if x is None:
                continue
            rel = f"{it['lang']}/{pre}-{sha[:16]}.ogg"
            (AUDIO / it["lang"]).mkdir(parents=True, exist_ok=True)
            sf.write(AUDIO / rel, x, 24000, format="OGG", subtype="OPUS")
            if (was := rt.pop(rel, None)) is not None:  # a new take is checked again; the earlier take's result is kept
                rt.setdefault("_earlier_takes", []).append({**was, "file": rel})
            made += 1
            time.sleep(7)  # stay under the free tier's requests per minute
        r = rt.get(rel)
        for asr in ASR_MODELS:
            if r is not None or asr in asr_closed:
                continue
            try:
                hyp = transcribe(AUDIO / rel, it["lang"], key, asr)
                e = utterance_errors(it["text"], hyp)
                r = rt[rel] = {"text": it["text"], "heard": hyp, "cer_pct": round(100.0 * e["char_edits"] / max(e["ref_chars"], 1), 2), "asr": asr}
                ROUNDTRIP.parent.mkdir(parents=True, exist_ok=True)
                ROUNDTRIP.write_text(json.dumps(rt, ensure_ascii=False, indent=1), encoding="utf-8")
                time.sleep(7)
            except DailyLimit:
                print(f"{asr}: speech-to-text daily limit reached", flush=True)
                asr_closed.add(asr)
            except Exception as e:  # noqa: BLE001
                print(f"round trip failed for {rel} ({asr}): {e}", flush=True)
                break
        name = f"{it.get('rule_id') or it.get('notice_id')} {it['lang']}"
        if r is None or r["text"] != it["text"] or r["cer_pct"] > MAX_CER:
            held += 1
            print(f"held back {name}: round trip {'not checked' if r is None else str(r['cer_pct']) + ' % CER'}", flush=True)
            continue
        k = (it["kind"], it.get("rule_id") or it.get("notice_id"), it.get("version"), it["lang"])
        gem[k] = entry(it, rel, model, r["cer_pct"], r["heard"], r.get("asr", ASR_MODEL))
        print(f"ok {name} {gem[k]['audio_s']} s, round trip {r['cer_pct']} % CER", flush=True)

    # a Bangla rule with no passing Gemini clip keeps its earlier svara clip (same exact-text key), labelled per clip
    kept = []
    for c in old.get("clips", []):
        if c.get("voice", "").startswith("gemini:"):
            continue
        k = (c["kind"], c.get("rule_id") or c.get("notice_id"), c.get("version"), c["lang"])
        if k not in gem and (AUDIO / c["file"]).exists():
            kept.append(c)
    clips = list(gem.values()) + kept
    fallback = old.get("voice", {}).get("fallback") or {
        "model": "kenpath/svara-tts-v1", "speaker": "Bengali (Male)", "licence": "Llama 3.2 Community License",
        "attribution": "Built with Llama", "made": "2026-10-29, NBTC RTX 5090 (ml/voice/tts_eval.py --lean)",
        "used_for": "Bangla rule texts that have no passing Gemini clip yet"}
    manifest = {
        "schema": SCHEMA,
        "voice": {"model": f"Google {MODEL}", "speaker": VOICE, "made": time.strftime("%Y-%m-%d"),
                  "also": [f"Google {m}" for m, _ in MODELS[1:]] + ["(when the first model's daily quota is used up; each clip names its model)"],
                  "how": "made once, ahead of time (ml/voice/gemini_readbacks.py); phones only play the clips",
                  "roundtrip": f"a Gemini text model ({', '.join(ASR_MODELS)}, in that order) transcribed each clip back; each clip names the one used; a clip over {MAX_CER:g} % CER is held back (a SYNTHETIC check)",
                  "review": "pending: no native speaker has listened yet",
                  "fallback": fallback},
        "normalisation": old.get("normalisation", "NFC; drop U+200B U+2060 U+FEFF U+00AD; whitespace runs to one space; trim; NFC"),
        "match": "rule_id + version (or notice_id) + sha256(normalised text): the app plays a clip only for that exact text",
        "clips": clips,
    }
    (AUDIO / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    left = sum(1 for it in items if not any((AUDIO / it["lang"] / f"{pre}-{text_sha(it['text'])[:16]}.ogg").exists() for _, pre in MODELS))
    print(f"made {made}; Gemini clips shipped {len(gem)}; svara kept {len(kept)}; held back {held}; texts without audio {left}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
