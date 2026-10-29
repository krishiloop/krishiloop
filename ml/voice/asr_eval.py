"""Bangla ASR evaluation on the NBTC RTX 5090 (resumable).

Backends
  whisper : OpenAI Whisper checkpoints through Hugging Face transformers (fp16, greedy, language="bn").
  omni    : Meta Omnilingual ASR CTC v2 checkpoints through omni_ctc.py (bf16, greedy CTC).

Input: a JSONL manifest with id, wav, ref (and dur_s). Output in --out-dir:
  <tag>.hyps.jsonl     one line per utterance: id, ref, hyp, dur_s, proc_s, char/word edits
  <tag>.summary.json   WER, CER, RTF, latency for a 5-second clip, VRAM, load time, settings

Timing covers feature extraction + model + decoding on the GPU (torch.cuda.synchronize around each call),
batch size 1, after warm-up; file reading is excluded. VRAM numbers are PyTorch allocator figures
(weights after load, peak during the run); the CUDA context adds roughly 0.4-0.6 GB on top.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from math import gcd

import numpy as np
import soundfile as sf
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bn_text import corpus_rates, utterance_errors  # noqa: E402


def load_audio_16k(path):
    wav, sr = sf.read(path, dtype="float32", always_2d=True)
    wav = wav.mean(axis=1)
    if sr != 16000:
        from scipy.signal import resample_poly
        g = gcd(sr, 16000)
        wav = resample_poly(wav, 16000 // g, sr // g).astype("float32")
    return wav


class WhisperASR:
    def __init__(self, model_dir, device="cuda", num_beams=1):
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
        self.proc = WhisperProcessor.from_pretrained(model_dir)
        self.model = WhisperForConditionalGeneration.from_pretrained(model_dir, dtype=torch.float16).to(device).eval()
        self.device, self.num_beams = device, num_beams
        self.name = os.path.basename(os.path.normpath(model_dir))
        self.settings = {"dtype": "float16", "decoding": f"beam {num_beams}" if num_beams > 1 else "greedy",
                         "language": "bn", "task": "transcribe", "max_new_tokens": 440}

    @torch.inference_mode()
    def transcribe(self, wav, sample_rate=16000):
        feats = self.proc(wav, sampling_rate=16000, return_tensors="pt").input_features
        feats = feats.to(self.device, torch.float16)
        out = self.model.generate(feats, language="bn", task="transcribe", num_beams=self.num_beams,
                                  max_new_tokens=440)
        return self.proc.batch_decode(out, skip_special_tokens=True)[0].strip()

    @torch.inference_mode()
    def transcribe_batch(self, wavs):
        feats = self.proc(wavs, sampling_rate=16000, return_tensors="pt").input_features
        feats = feats.to(self.device, torch.float16)
        out = self.model.generate(feats, language="bn", task="transcribe", num_beams=self.num_beams,
                                  max_new_tokens=440)
        return [s.strip() for s in self.proc.batch_decode(out, skip_special_tokens=True)]


def build(args):
    if args.backend == "whisper":
        return WhisperASR(args.model_dir, num_beams=args.beams)
    from omni_ctc import OmniCTCTranscriber
    m = OmniCTCTranscriber(args.ckpt, args.tokenizer, arch=args.arch)
    m.settings = {"dtype": "bfloat16", "decoding": "greedy CTC", "arch": args.arch,
                  "runtime": "native PyTorch port (omni_ctc.py), official checkpoint, strict load"}
    return m


def timed(model, wav):
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    hyp = model.transcribe(wav)
    torch.cuda.synchronize()
    return hyp, time.perf_counter() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["whisper", "omni"], required=True)
    ap.add_argument("--model-dir")
    ap.add_argument("--ckpt")
    ap.add_argument("--tokenizer")
    ap.add_argument("--arch", default="1b_v2")
    ap.add_argument("--beams", type=int, default=1)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-latency", action="store_true", help="skip the 5-second clip benchmark")
    ap.add_argument("--batch", type=int, default=1, help="Whisper only: batch size for the accuracy pass")
    ap.add_argument("--timing-n", type=int, default=40, help="utterances timed at batch 1 when --batch > 1")
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    rows = [json.loads(x) for x in open(a.manifest, encoding="utf-8")]
    if a.limit:
        rows = rows[: a.limit]

    torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()
    model = build(a)
    torch.cuda.synchronize()
    load_s = time.perf_counter() - t0
    weights_gb = torch.cuda.memory_allocated() / 1e9
    print(f"[{a.tag}] loaded {model.name} in {load_s:.1f}s, weights {weights_gb:.2f} GB", flush=True)

    # warm-up on the first clip
    w0 = load_audio_16k(rows[0]["wav"])
    for _ in range(2):
        timed(model, w0[: 16000 * 5])

    hyp_path = os.path.join(a.out_dir, f"{a.tag}.hyps.jsonl")
    done = {}
    if os.path.exists(hyp_path):
        for line in open(hyp_path, encoding="utf-8"):
            d = json.loads(line)
            done[d["id"]] = d

    def record(f, r, wav, hyp, dt, extra=None):
        e = utterance_errors(r["ref"], hyp)
        d = {"id": r["id"], "ref": r["ref"], "hyp": hyp, "dur_s": round(len(wav) / 16000, 3),
             "proc_s": None if dt is None else round(dt, 4),
             **{k: e[k] for k in ("word_edits", "ref_words", "char_edits", "ref_chars")}, **(extra or {})}
        for k in ("group", "terms", "source"):
            if k in r:
                d[k] = r[k]
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
        f.flush()
        done[r["id"]] = d

    pending = [r for r in rows if r["id"] not in done]
    batched_s = 0.0
    with open(hyp_path, "a", encoding="utf-8") as f:
        if a.batch > 1 and hasattr(model, "transcribe_batch"):
            # accuracy pass, batched by similar duration (Whisper decodes Bangla slowly token by token)
            pending.sort(key=lambda r: r.get("dur_s", 0))
            for k in range(0, len(pending), a.batch):
                chunk = pending[k:k + a.batch]
                wavs = [load_audio_16k(r["wav"]) for r in chunk]
                torch.cuda.synchronize(); t1 = time.perf_counter()
                hyps = model.transcribe_batch(wavs)
                torch.cuda.synchronize(); dt = time.perf_counter() - t1
                batched_s += dt
                for r, w, h in zip(chunk, wavs, hyps):
                    record(f, r, w, h, None, {"batch_s": round(dt, 3), "batch_n": len(chunk)})
                print(f"  {k+len(chunk)}/{len(pending)} batched", flush=True)
        else:
            for i, r in enumerate(pending):
                wav = load_audio_16k(r["wav"])
                try:
                    hyp, dt = timed(model, wav)
                except Exception as e:  # noqa: BLE001 - record the failure, keep going
                    hyp, dt = "", float("nan")
                    print(f"  fail {r['id']}: {type(e).__name__}: {e}", flush=True)
                record(f, r, wav, hyp, dt)
                if (i + 1) % 100 == 0:
                    print(f"  {i+1}/{len(pending)}", flush=True)

    res = [done[r["id"]] for r in rows if r["id"] in done]
    ok = [x for x in res if x["proc_s"] is not None and x["proc_s"] == x["proc_s"]]
    timing_note = "batch 1, every utterance"
    if not ok and res:  # batched accuracy pass: time batch 1 on an evenly spread subset instead
        step = max(1, len(rows) // max(1, a.timing_n))
        sub = rows[::step][: a.timing_n]
        ok = []
        for r in sub:
            w = load_audio_16k(r["wav"])
            _, dt = timed(model, w)
            ok.append({"dur_s": len(w) / 16000, "proc_s": dt})
        timing_note = f"batch 1 on {len(ok)} evenly spread utterances (accuracy pass used batch {a.batch})"
    rates = corpus_rates(res)
    lat5 = None
    if not a.no_latency:
        clip = next((load_audio_16k(r["wav"]) for r in rows if r.get("dur_s", 0) >= 5.0), None)
        if clip is not None:
            clip = clip[: 16000 * 5]
            for _ in range(3):
                timed(model, clip)
            ts = sorted(timed(model, clip)[1] for _ in range(10))
            lat5 = {"median_ms": round(1000 * statistics.median(ts), 1), "p90_ms": round(1000 * ts[8], 1),
                    "runs": 10}
    tot_audio = sum(x["dur_s"] for x in ok)
    tot_proc = sum(x["proc_s"] for x in ok)
    summary = {
        "tag": a.tag, "model": model.name, "settings": getattr(model, "settings", {}),
        "manifest": os.path.basename(a.manifest), **rates,
        "audio_hours": round(sum(x["dur_s"] for x in res) / 3600, 3),
        "rtf": round(tot_proc / max(tot_audio, 1e-9), 4),
        "rtf_timing": timing_note,
        "batched_throughput_rtf": round(batched_s / max(sum(x["dur_s"] for x in res), 1e-9), 4) if batched_s else None,
        "median_utt_latency_ms": round(1000 * statistics.median([x["proc_s"] for x in ok]), 1) if ok else None,
        "latency_5s_clip": lat5,
        "load_s": round(load_s, 1),
        "vram_weights_gb": round(weights_gb, 2),
        "vram_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2),
        "failures": sum(1 for x in res if x["proc_s"] is not None and x["proc_s"] != x["proc_s"]),
        "runaway_outputs": sum(1 for x in res if len(x["hyp"]) > 2 * max(len(x["ref"]), 1)),
        "empty_outputs": sum(1 for x in res if not x["hyp"].strip()),
        "gpu": torch.cuda.get_device_name(0), "torch": torch.__version__,
        "when": time.strftime("%Y-%m-%d %H:%M"),
    }
    json.dump(summary, open(os.path.join(a.out_dir, f"{a.tag}.summary.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
