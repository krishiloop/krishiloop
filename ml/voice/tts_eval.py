"""Bangla TTS on the NBTC RTX 5090: synthesise rule titles and farmer questions, measure speed and VRAM.

Backends
  svara : kenpath/svara-tts-v1 (Orpheus-style Llama-3.2-3B fine-tune that emits SNAC audio tokens).
          Weights from the Q8_0 GGUF (mradermacher/svara-tts-v1-GGUF) because of the lab's link that day,
          dequantised tensor by tensor to bf16 by load_gguf_llama_state_dict (below); config + tokenizer from
          kenpath/svara-tts-v1; SNAC 24 kHz
          decoder from hubertsiuzdak/snac_24khz. Prompt format and sampling defaults follow the official
          inference repo (github.com/Kenpath/svara-tts-inference: temperature 0.75, top_p 0.9, top_k 40,
          repetition_penalty 1.1, stop at END_OF_SPEECH). Licence: Llama 3.2 Community License (base model).
  mms   : facebook/mms-tts-ben (VITS). CC BY-NC 4.0: measured as a comparison only, never shipped.

Outputs under --out-dir/<backend>/: opus/<id>__<voice>.ogg (small files for the app), wav16k/<id>__<voice>.wav
(input for the ASR round trip), results.jsonl (timing per clip), summary.json, manifest_roundtrip.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from math import gcd

import numpy as np
import soundfile as sf
import torch

# svara / Orpheus token ids (tts_engine/constants.py in the official inference repo)
BOS, START_HUMAN, END_HUMAN, START_AI, START_SPEECH, END_SPEECH, END_AI, EOT, AUDIO = (
    128000, 128259, 128260, 128261, 128257, 128258, 128262, 128009, 156939)
AUDIO_BASE = 128266


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    from scipy.signal import resample_poly
    g = gcd(sr_in, sr_out)
    return resample_poly(x, sr_out // g, sr_in // g).astype("float32")


def _reverse_permute(w, n_head):
    """Undo llama.cpp's rotary-layout permutation of q/k weights (convert_hf_to_gguf.py LlamaModel.permute)."""
    d = w.shape[0] // n_head // 2
    return w.reshape(n_head, d, 2, *w.shape[1:]).swapaxes(2, 1).reshape(w.shape)


def load_gguf_llama_state_dict(path, cfg):
    """Read a llama-architecture GGUF tensor by tensor (memory-mapped), dequantise, map to HF names, bf16.

    Peak host RAM stays near the bf16 model size (~6.6 GB for 3B) instead of a full fp32 copy.
    """
    from gguf import GGUFReader
    from gguf.quants import dequantize
    names = {"attn_norm": "input_layernorm", "attn_q": "self_attn.q_proj", "attn_k": "self_attn.k_proj",
             "attn_v": "self_attn.v_proj", "attn_output": "self_attn.o_proj", "ffn_norm": "post_attention_layernorm",
             "ffn_gate": "mlp.gate_proj", "ffn_up": "mlp.up_proj", "ffn_down": "mlp.down_proj"}
    sd = {}
    for t in GGUFReader(path).tensors:
        if t.name == "rope_freqs.weight":
            continue  # llama3 rope factors; transformers derives them from the config
        w = np.array(dequantize(t.data, t.tensor_type), dtype=np.float32, copy=True)
        if t.name == "token_embd.weight":
            key = "model.embed_tokens.weight"
        elif t.name == "output_norm.weight":
            key = "model.norm.weight"
        elif t.name == "output.weight":
            key = "lm_head.weight"
        else:
            _, i, kind, _w = t.name.split(".")
            key = f"model.layers.{i}.{names[kind]}.weight"
            if kind == "attn_q":
                w = _reverse_permute(w, cfg.num_attention_heads)
            elif kind == "attn_k":
                w = _reverse_permute(w, cfg.num_key_value_heads)
        sd[key] = torch.from_numpy(np.ascontiguousarray(w)).to(torch.bfloat16)
    return sd


class SvaraTTS:
    def __init__(self, svara_dir, gguf_dir, gguf_file, snac_dir, device="cuda"):
        from transformers import AutoConfig, AutoTokenizer, LlamaForCausalLM
        from transformers.models.llama.modeling_llama import LlamaRotaryEmbedding
        from snac import SNAC
        self.device = device
        self.tok = AutoTokenizer.from_pretrained(svara_dir)
        cfg = AutoConfig.from_pretrained(svara_dir, attn_implementation="sdpa")
        sd = load_gguf_llama_state_dict(os.path.join(gguf_dir, gguf_file), cfg)
        with torch.device("meta"):
            model = LlamaForCausalLM(cfg)
        res = model.load_state_dict(sd, strict=False, assign=True)
        del sd
        self.load_report = {"missing": list(res.missing_keys), "unexpected": list(res.unexpected_keys)}
        if cfg.tie_word_embeddings:
            model.lm_head.weight = model.model.embed_tokens.weight
        bad = [k for k in res.missing_keys if not (k == "lm_head.weight" and cfg.tie_word_embeddings)]
        if bad or res.unexpected_keys:
            raise RuntimeError(f"GGUF mapping problem: missing {bad[:5]}, unexpected {list(res.unexpected_keys)[:5]}")
        model.model.rotary_emb = LlamaRotaryEmbedding(config=cfg)  # its buffers were created on meta: rebuild on CPU
        left = [n for n, t in list(model.named_parameters()) + list(model.named_buffers()) if t.is_meta]
        if left:
            raise RuntimeError(f"tensors still on meta after loading: {left[:5]}")
        self.model = model.to(device).eval()
        emb, head = self.model.get_input_embeddings().weight, self.model.get_output_embeddings().weight
        self.tied = bool(emb.data_ptr() == head.data_ptr())
        self.snac = SNAC.from_pretrained(snac_dir).to(device).eval()
        self.sr = 24000
        self.name = "svara-tts-v1 (Q8_0 GGUF dequantised to bf16) + SNAC 24 kHz"

    def prompt_ids(self, text, voice):
        ids = self.tok(f"{voice}: {text}", add_special_tokens=False).input_ids
        return [BOS, START_HUMAN, AUDIO] + ids + [END_HUMAN, EOT, START_AI, START_SPEECH]

    @torch.inference_mode()
    def _generate_lean(self, ids, max_new_tokens, seed, temperature=0.75, top_p=0.9, top_k=40, rep=1.1):
        """Same sampling as generate() (repetition penalty -> temperature -> top-k -> top-p), minus its
        per-step Python overhead: one model call per token with a KV cache."""
        from transformers import DynamicCache
        g = torch.Generator(device=self.device).manual_seed(seed)
        cache = DynamicCache()
        seen = torch.zeros(self.model.config.vocab_size, dtype=torch.bool, device=self.device)
        seen[ids[0]] = True
        logits = self.model(input_ids=ids, past_key_values=cache, use_cache=True).logits[0, -1].float()
        gen = []
        for _ in range(max_new_tokens):
            sel = logits[seen]
            logits[seen] = torch.where(sel < 0, sel * rep, sel / rep)
            v, ix = torch.topk(logits / temperature, top_k)
            p = torch.softmax(v, -1)
            p = p.masked_fill((p.cumsum(-1) - p) > top_p, 0.0)
            nxt = ix[torch.multinomial(p / p.sum(), 1, generator=g)]
            tok = int(nxt)
            gen.append(tok)
            if tok in (END_SPEECH, END_AI):
                break
            seen[tok] = True
            logits = self.model(input_ids=nxt.view(1, 1), past_key_values=cache, use_cache=True).logits[0, -1].float()
        return gen

    @torch.inference_mode()
    def synth(self, text, voice="Bengali (Female)", seed=0, max_new_tokens=2048, lean=False):
        torch.manual_seed(seed)
        ids = torch.tensor([self.prompt_ids(text, voice)], device=self.device)
        if lean:
            gen = self._generate_lean(ids, max_new_tokens, seed)
        else:
            out = self.model.generate(ids, attention_mask=torch.ones_like(ids), max_new_tokens=max_new_tokens,
                                      do_sample=True, temperature=0.75, top_p=0.9, top_k=40,
                                      repetition_penalty=1.1, eos_token_id=[END_SPEECH, END_AI],
                                      pad_token_id=128263)
            gen = out[0, ids.shape[1]:].tolist()
        audio = [t for t in gen if t >= AUDIO_BASE]
        n = len(audio) // 7
        l0, l1, l2 = [], [], []
        bad = 0
        for f in range(n):
            c = [audio[7 * f + j] - AUDIO_BASE - j * 4096 for j in range(7)]
            if any(x < 0 or x >= 4096 for x in c):
                bad += 1
                continue
            l0.append(c[0]); l1 += [c[1], c[4]]; l2 += [c[2], c[3], c[5], c[6]]
        if not l0:
            return np.zeros(0, dtype="float32"), {"tokens": len(gen), "frames": 0, "bad_frames": bad}
        codes = [torch.tensor([x], device=self.device) for x in (l0, l1, l2)]
        wav = self.snac.decode(codes)[0, 0].float().cpu().numpy()
        hit_limit = len(gen) >= max_new_tokens
        return wav, {"tokens": len(gen), "frames": len(l0), "bad_frames": bad, "hit_token_limit": hit_limit}


class MmsTTS:
    def __init__(self, model_dir, device="cuda"):
        from transformers import AutoTokenizer, VitsModel
        self.tok = AutoTokenizer.from_pretrained(model_dir)
        if getattr(self.tok, "is_uroman", False):
            raise RuntimeError("this MMS checkpoint needs uroman romanisation; not set up")
        self.model = VitsModel.from_pretrained(model_dir).to(device).eval()
        self.device, self.sr = device, self.model.config.sampling_rate
        self.name = "facebook/mms-tts-ben (VITS, fp32) [CC BY-NC 4.0: comparison only]"

    @torch.inference_mode()
    def synth(self, text, voice="default", seed=0, **_):
        torch.manual_seed(seed)
        inp = self.tok(text, return_tensors="pt").to(self.device)
        wav = self.model(**inp).waveform[0].float().cpu().numpy()
        return wav, {"tokens": int(inp["input_ids"].shape[1])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["svara", "mms"], required=True)
    ap.add_argument("--texts", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--models", default=r"F:\krishiloop-5090\models\voice")
    ap.add_argument("--voices", default="Bengali (Female)")
    ap.add_argument("--rule-voices", default="Bengali (Female),Bengali (Male)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--lean", action="store_true", help="svara: lean sampling loop instead of generate()")
    a = ap.parse_args()
    out = os.path.join(a.out_dir, a.backend)
    for sub in ("opus", "wav16k"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    texts = [json.loads(x) for x in open(a.texts, encoding="utf-8")]
    if a.limit:
        texts = texts[: a.limit]

    torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()
    if a.backend == "svara":
        m = SvaraTTS(os.path.join(a.models, "svara-tts-v1"), os.path.join(a.models, "svara-tts-v1-gguf"),
                     "svara-tts-v1.Q8_0.gguf", os.path.join(a.models, "snac_24khz"))
        print("lm_head tied to embeddings:", m.tied, flush=True)
    else:
        m = MmsTTS(os.path.join(a.models, "mms-tts-ben"))
    torch.cuda.synchronize()
    load_s = time.perf_counter() - t0
    weights_gb = torch.cuda.memory_allocated() / 1e9
    print(f"loaded {m.name} in {load_s:.1f}s, weights {weights_gb:.2f} GB", flush=True)
    m.synth("পরীক্ষা।", **({"voice": "Bengali (Female)"} if a.backend == "svara" else {}))  # warm-up

    jobs = []
    for t in texts:
        voices = (a.rule_voices if t["group"] == "rule_title" else a.voices).split(",") if a.backend == "svara" else ["default"]
        for v in voices:
            jobs.append((t, v.strip()))
    res_path = os.path.join(out, "results.jsonl")
    done = {}
    if os.path.exists(res_path):
        for line in open(res_path, encoding="utf-8"):
            d = json.loads(line)
            done[d["clip"]] = d
    with open(res_path, "a", encoding="utf-8") as f:
        for i, (t, v) in enumerate(jobs):
            vtag = v.split("(")[-1].rstrip(")").lower() if "(" in v else v
            clip = f"{t['id']}__{vtag}"
            if clip in done:
                continue
            torch.cuda.synchronize()
            t1 = time.perf_counter()
            wav, info = m.synth(t["text"], voice=v, seed=1000 + i, lean=a.lean)
            torch.cuda.synchronize()
            dt = time.perf_counter() - t1
            wav = np.clip(wav, -1.0, 1.0)
            dur = len(wav) / m.sr
            sf.write(os.path.join(out, "opus", clip + ".ogg"), wav, m.sr, format="OGG", subtype="OPUS")
            sf.write(os.path.join(out, "wav16k", clip + ".wav"), resample(wav, m.sr, 16000), 16000, subtype="PCM_16")
            d = {"clip": clip, "id": t["id"], "group": t["group"], "voice": v, "text": t["text"],
                 "terms": t.get("terms", []), "audio_s": round(dur, 3), "synth_s": round(dt, 3),
                 "rtf": round(dt / max(dur, 1e-6), 3),
                 "opus_bytes": os.path.getsize(os.path.join(out, "opus", clip + ".ogg")),
                 "gen": ("lean" if a.lean else "generate") if a.backend == "svara" else "vits", **info}
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
            f.flush()
            done[clip] = d
            print(f"  {i+1}/{len(jobs)} {clip} {dur:.1f}s audio in {dt:.1f}s", flush=True)

    rs = [done[k] for k in done]
    with open(os.path.join(out, "manifest_roundtrip.jsonl"), "w", encoding="utf-8") as f:
        for d in rs:
            f.write(json.dumps({"id": d["clip"], "wav": os.path.join(out, "wav16k", d["clip"] + ".wav"),
                                "ref": d["text"], "dur_s": d["audio_s"], "group": d["group"],
                                "terms": d["terms"], "source": d["id"]}, ensure_ascii=False) + "\n")
    lat5 = None
    if a.backend == "svara":  # latency for a short answer (~5 s of speech)
        five = next((t["text"] for t in texts if t["id"] == "R-BDR-007"), texts[0]["text"])
        ts = []
        for k in range(3):
            torch.cuda.synchronize(); t1 = time.perf_counter()
            w, _ = m.synth(five, voice="Bengali (Female)", seed=77 + k, lean=a.lean)
            torch.cuda.synchronize(); ts.append((time.perf_counter() - t1, len(w) / m.sr))
        lat5 = {"text_id": "R-BDR-007", "runs": [{"synth_s": round(x, 2), "audio_s": round(y, 2)} for x, y in ts]}
    summary = {
        "backend": a.backend, "model": m.name, "n_clips": len(rs),
        "audio_s_total": round(sum(d["audio_s"] for d in rs), 1),
        "synth_s_total": round(sum(d["synth_s"] for d in rs), 1),
        "rtf_overall": round(sum(d["synth_s"] for d in rs) / max(sum(d["audio_s"] for d in rs), 1e-6), 3),
        "rtf_median": round(statistics.median(d["rtf"] for d in rs), 3) if rs else None,
        "synth_s_median": round(statistics.median(d["synth_s"] for d in rs), 2) if rs else None,
        "opus_kb_median": round(statistics.median(d["opus_bytes"] for d in rs) / 1024, 1) if rs else None,
        "empty_or_failed": sum(1 for d in rs if d["audio_s"] < 0.3),
        "hit_token_limit": sum(1 for d in rs if d.get("hit_token_limit")),
        "load_s": round(load_s, 1), "vram_weights_gb": round(weights_gb, 2),
        "vram_peak_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2),
        "short_answer_latency": lat5, "sample_rate": m.sr,
        "gpu": torch.cuda.get_device_name(0), "torch": torch.__version__, "when": time.strftime("%Y-%m-%d %H:%M"),
    }
    json.dump(summary, open(os.path.join(out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
