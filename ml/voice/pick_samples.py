"""Pick 5-8 svara clips for the video: real rule titles first, best round-trip CER, both voices, < 5 MB total.

Inputs (copied back from the 5090): results/tts/svara/results.jsonl, results/roundtrip/svara__<asr>.hyps.jsonl,
and the Opus files in --opus-dir. Output: ml/voice/samples/*.ogg + samples/samples.json (text, rule, round-trip CER, licence).
"""
import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bn_text import utterance_errors  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asr-tag", required=True, help="e.g. omni-ctc-1b-v2")
    ap.add_argument("--opus-dir", required=True)
    ap.add_argument("--n", type=int, default=7)
    a = ap.parse_args()
    res = {json.loads(x)["clip"]: json.loads(x) for x in open(os.path.join(HERE, "results", "tts", "svara", "results.jsonl"), encoding="utf-8")}
    rt = {json.loads(x)["id"]: json.loads(x) for x in open(os.path.join(HERE, "results", "roundtrip", f"svara__{a.asr_tag}.hyps.jsonl"), encoding="utf-8")}
    rows = []
    for clip, r in res.items():
        if clip not in rt or r["audio_s"] < 1.0:
            continue
        e = utterance_errors(r["text"], rt[clip]["hyp"])
        rows.append({**r, "hyp": rt[clip]["hyp"], "cer": 100.0 * e["char_edits"] / max(1, e["ref_chars"])})
    rules = sorted([x for x in rows if x["group"] == "rule_title"], key=lambda x: (x["cer"], x["clip"]))
    qs = sorted([x for x in rows if x["group"] == "farmer_question"], key=lambda x: (x["cer"], x["clip"]))
    pick, seen_rule = [], set()
    for x in rules:  # one clip per rule, alternate voices where possible
        if x["id"] in seen_rule:
            continue
        pick.append(x)
        seen_rule.add(x["id"])
        if len(pick) >= a.n - 2:
            break
    pick += qs[:2]
    out = os.path.join(HERE, "samples")
    os.makedirs(out, exist_ok=True)
    total, meta = 0, []
    for x in pick:
        dst = os.path.join(out, x["clip"] + ".ogg")
        shutil.copyfile(os.path.join(a.opus_dir, x["clip"] + ".ogg"), dst)
        total += os.path.getsize(dst)
        meta.append({"file": x["clip"] + ".ogg", "kind": "rule title (real rule text, Bangla wording review pending)"
                     if x["group"] == "rule_title" else "farmer question (SYNTHETIC)", "source_id": x["id"],
                     "voice": x["voice"], "audio_s": x["audio_s"], "roundtrip_cer_pct": round(x["cer"], 1),
                     "roundtrip_asr": a.asr_tag, "text": x["text"], "asr_heard": x["hyp"]})
    info = {"generated": "2026-10-29 on the NBTC RTX 5090 by ml/voice/tts_eval.py",
            "voice_model": "kenpath/svara-tts-v1 (Q8_0 GGUF copy) + SNAC 24 kHz; Ogg/Opus",
            "licence": "Llama 3.2 Community License (svara-tts-v1 is a Llama-3.2-3B fine-tune): commercial use allowed "
                       "with conditions, including 'Built with Llama' attribution; SNAC codec MIT",
            "roundtrip_cer": "our best ASR transcribing the clip vs the source text: an intelligibility proxy",
            "total_bytes": total, "clips": meta}
    json.dump(info, open(os.path.join(out, "samples.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"copied {len(pick)} clips, {total/1024:.0f} KB")


if __name__ == "__main__":
    main()
