"""Collect the voice-track results into ml/voice/report.json (numbers only; REPORT.md is written by hand).

Reads ml/voice/results/:
  asr/<tag>.summary.json                 FLEURS bn_in test, one per ASR model
  tts/<backend>/summary.json, results.jsonl
  roundtrip/<tts>__<asr>.hyps.jsonl      TTS clips transcribed back (SYNTHETIC proxy, not real farmers)
  service/service_test.json
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bn_text import corpus_rates, normalize_bn  # noqa: E402

RES = os.path.join(HERE, "results")
TERMS = ["বাদামি গাছফড়িং", "ব্লাস্ট", "স্প্রে", "কুশি", "ইউরিয়া", "বিঘা"]

LICENCES = [
    {"name": "Google FLEURS (bn_in test)", "role": "ASR test data", "licence": "CC BY 4.0",
     "url": "https://huggingface.co/datasets/google/fleurs", "use": "evaluation", "status": "used"},
    {"name": "Meta Omnilingual ASR omniASR_CTC_1B_v2", "role": "ASR", "licence": "Apache-2.0 (code and weights)",
     "url": "https://github.com/facebookresearch/omnilingual-asr", "use": "candidate to ship", "status": "used"},
    {"name": "Meta Omnilingual ASR omniASR_CTC_3B_v2", "role": "ASR", "licence": "Apache-2.0",
     "url": "https://dl.fbaipublicfiles.com/mms/omniASR-CTC-3B-v2.pt", "use": "candidate", "status": "not run yet (bandwidth); overnight download"},
    {"name": "OpenAI whisper-large-v3-turbo", "role": "ASR baseline", "licence": "MIT",
     "url": "https://huggingface.co/openai/whisper-large-v3-turbo", "use": "baseline", "status": "used"},
    {"name": "OpenAI whisper-large-v3", "role": "ASR baseline", "licence": "Apache-2.0 on the HF card (OpenAI's Whisper code and weights are MIT on GitHub)",
     "url": "https://huggingface.co/openai/whisper-large-v3", "use": "baseline", "status": "not run (bandwidth); overnight download"},
    {"name": "kenpath/svara-tts-v1", "role": "TTS", "licence": "Llama 3.2 Community License (fine-tune of meta-llama/Llama-3.2-3B via canopylabs/3b-hi-ft-research_release; the card's 'Apache-2.0' does not override the base licence). Commercial use allowed with conditions: 'Built with Llama' attribution, Meta's acceptable-use policy, under 700M monthly active users. Training data listed: SYSPIN, RASA, IndicTTS, SPICOR; check IndicTTS terms before shipping.",
     "url": "https://huggingface.co/kenpath/svara-tts-v1", "use": "candidate to ship (with conditions)", "status": "used"},
    {"name": "mradermacher/svara-tts-v1-GGUF (Q8_0)", "role": "TTS weights (quantised copy)", "licence": "same as svara-tts-v1",
     "url": "https://huggingface.co/mradermacher/svara-tts-v1-GGUF", "use": "used because the link was slow; ship the original weights", "status": "used"},
    {"name": "hubertsiuzdak/snac_24khz", "role": "audio codec for svara", "licence": "MIT",
     "url": "https://huggingface.co/hubertsiuzdak/snac_24khz", "use": "part of the TTS path", "status": "used"},
    {"name": "facebook/mms-tts-ben", "role": "TTS comparison", "licence": "CC BY-NC 4.0 (non-commercial)",
     "url": "https://huggingface.co/facebook/mms-tts-ben", "use": "COMPARISON ONLY, NEVER SHIPPED", "status": "used"},
    {"name": "ai4bharat/indic-parler-tts", "role": "TTS", "licence": "Apache-2.0", "url": "https://huggingface.co/ai4bharat/indic-parler-tts",
     "use": "the plan's first choice", "status": "NOT TESTED: gated on Hugging Face (terms + token); skipped per brief"},
    {"name": "ai4bharat/IndicF5", "role": "TTS", "licence": "MIT", "url": "https://huggingface.co/ai4bharat/IndicF5", "use": "-", "status": "not tested: gated"},
    {"name": "ai4bharat/indic-conformer-600m-multilingual", "role": "ASR (Bangla-capable)", "licence": "MIT", "url": "https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual", "use": "-", "status": "not tested: gated"},
    {"name": "k2-fsa/OmniVoice", "role": "TTS", "licence": "code Apache-2.0, weights CC BY-NC", "url": "https://huggingface.co/k2-fsa/OmniVoice", "use": "-", "status": "not tested (non-commercial weights)"},
    {"name": "bangla-speech-processing/BanglaASR", "role": "ASR (Bangla-tuned Whisper small)", "licence": "MIT (card)", "url": "https://huggingface.co/bangla-speech-processing/BanglaASR", "use": "optional", "status": "not run (bandwidth)"},
]


RECOMMENDATION = {
    "asr": "Ship Meta Omnilingual ASR omniASR_CTC_1B_v2 (Apache-2.0): FLEURS Bangla CER 6.2 %, WER 25.4 %, 40 ms for a 5-second "
           "clip, ~2.4 GB VRAM. Whisper large-v3-turbo is not usable for Bangla (CER 45.3 %, WER 91.6 %, Devanagari mixed into 85 % "
           "of outputs). Try omniASR_CTC_3B_v2 overnight; switch only if it is clearly better.",
    "tts": "Use the 'Bengali (Male)' svara voice (round trip on rule titles: CER 8.6 %; the female voice was transcribed in "
           "Devanagari/Gujarati script for 19 of 51 clips and sometimes speaks the speaker label). Ship kenpath/svara-tts-v1 only after the lead accepts the Llama 3.2 Community License conditions ('Built with Llama', "
           "acceptable-use policy, < 700M MAU) and checks the IndicTTS data terms; otherwise get the gated (Apache-2.0) Indic "
           "Parler-TTS approved and measure it with the same harness. Never ship MMS-TTS (CC BY-NC).",
    "architecture": "Pre-synthesise and cache every rule readback per rule version (recall regenerates it); use live TTS only for "
                    "text that is not a rule. ASR runs live on the same GPU.",
}
COMMANDS = [
    r'ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name <job> -Script F:\krishiloop-5090\scripts\voice\<script>.ps1"',
    "voice-dl2: nbtc/dl_window_now.ps1 -> download_assets.py --stage window --no-wait (4 range connections per file, in the lead's link window)",
    "voice-prep: nbtc/run_prep.ps1 -> prepare_fleurs.py (920 wav files + manifest)",
    "voice-asr-turbo: nbtc/run_asr_turbo.ps1 -> asr_eval.py --backend whisper --batch 16 (accuracy) + batch-1 timing on 40 utterances",
    "voice-pipe4: nbtc/run_pipeline.ps1 -> asr_eval.py --backend omni (1b_v2) ; tts_eval.py --backend svara --lean ; "
    "tts_eval.py --backend mms ; run_roundtrip.ps1 ; run_service_test.ps1 (service.py on 127.0.0.1:8765, stopped after the test)",
    r"one-off over SSH: nbtc/make_venv.ps1 (venv F:\krishiloop-5090\venvs\voice with --system-site-packages; pip install soundfile jiwer av fastapi uvicorn python-multipart gguf snac)",
    "laptop: python ml/voice/build_texts.py ; python ml/voice/make_report.py ; python ml/voice/pick_samples.py --asr-tag omni-ctc-1b-v2 --opus-dir <copied opus>",
]
NOT_DONE = [
    "omniASR_CTC_3B_v2 and whisper-large-v3 on FLEURS (bandwidth): queued as the one-shot job kl-voice-overnight, which waits for the Ollama pulls to finish",
    "Cross-check of the native Omnilingual port against the official fairseq2 pipeline (needs the WSL venv: nbtc/wsl_setup.sh)",
    "Indic Parler-TTS (gated), IndicF5 (gated), a Bangla-tuned third ASR (bandwidth)",
    "Real farmer recordings (none available; synthetic round trips are only a proxy)",
    "Listening test by native speakers (MOS) of the svara clips",
    "Integration into services/ and apps/web (out of scope; the lead decides)",
]
NEEDS = [
    "Decide on svara-tts-v1's Llama 3.2 licence conditions, or accept the Hugging Face gate for ai4bharat/indic-parler-tts with a team account so it can be measured",
    "A native Bangla speaker to listen to ml/voice/samples and to review the rule titles' Bangla (review: pending)",
    "A few consented real farmer voice notes (remote, WhatsApp) to measure field accuracy",
    "Integration call: services/api proxies /voice/asr and /voice/tts to 127.0.0.1:8765; apps/web records webm/opus with MediaRecorder",
]


def load(p):
    return json.load(open(p, encoding="utf-8"))


def lenient(t):
    """Spelling-tolerant key for the domain-word check: ignore spaces, long/short i and u vowel signs, and
    ষ্ট vs স্ট (all common Bangla spelling variants that sound the same). Documented in the report."""
    t = t.replace(" ", "").replace("ী", "ি").replace("ূ", "ু").replace("ষ্ট", "স্ট")
    return t.replace("ঈ", "ই").replace("ঊ", "উ")


def roundtrip_stats(path):
    rows = [json.loads(x) for x in open(path, encoding="utf-8")]
    out = {"all": corpus_rates(rows)}
    for g in sorted({r.get("group", "?") for r in rows}):
        out[g] = corpus_rates([r for r in rows if r.get("group") == g])
    terms = {}
    for t in TERMS:
        tn = normalize_bn(t)
        rel = [r for r in rows if t in (r.get("terms") or [])]
        if rel:
            hit = sum(1 for r in rel if tn in normalize_bn(r["hyp"]))
            loose = sum(1 for r in rel if lenient(tn) in lenient(normalize_bn(r["hyp"])))
            terms[t] = {"utterances": len(rel), "recognised": hit, "recognised_lenient": loose}
    out["domain_terms"] = terms
    tot = sum(v["utterances"] for v in terms.values())
    out["domain_term_recall_pct"] = round(100 * sum(v["recognised"] for v in terms.values()) / tot, 1) if tot else None
    out["domain_term_recall_lenient_pct"] = round(100 * sum(v["recognised_lenient"] for v in terms.values()) / tot, 1) if tot else None
    out["examples"] = [{"id": r["id"], "ref": r["ref"], "hyp": r["hyp"]} for r in rows[:3]]
    return out


def asr_extra(tag):
    import re
    import statistics
    p = os.path.join(RES, "asr", f"{tag}.hyps.jsonl")
    if not os.path.exists(p):
        return None
    rows = [json.loads(x) for x in open(p, encoding="utf-8")]
    cer = sorted(r["char_edits"] / max(1, r["ref_chars"]) for r in rows)
    dig = [r for r in rows if re.search(r"[0-9০-৯]", r["ref"])]
    nod = [r for r in rows if not re.search(r"[0-9০-৯]", r["ref"])]
    return {
        "median_utterance_cer_pct": round(100 * statistics.median(cer), 1),
        "p90_utterance_cer_pct": round(100 * cer[int(0.9 * len(cer))], 1),
        "outputs_with_devanagari": sum(1 for r in rows if any("ऀ" <= c <= "ॿ" for c in r["hyp"])),
        "outputs_looping_over_2x_ref_length": sum(1 for r in rows if len(r["hyp"]) > 2 * len(r["ref"])),
        "outputs_with_digit_glued_to_bangla": sum(1 for r in rows if re.search(r"[0-9][ঀ-৿]|[ঀ-৿][0-9]", r["hyp"])),
        "refs_with_digits": corpus_rates(dig), "refs_without_digits": corpus_rates(nod),
        "without_looping_outputs": corpus_rates([r for r in rows if len(r["hyp"]) <= 2 * len(r["ref"])]),
    }


def main():
    rep = {"track": "voice (P1 #13, W3)", "machine": "NBTC RTX 5090 32 GB, Windows 11, torch 2.14.1+cu130",
           "asr_fleurs_bn_in_test": {}, "tts": {}, "roundtrip_synthetic": {}, "service": None,
           "licences": LICENCES,
           "caveats": [
               "FLEURS is read speech (Wikipedia sentences, 16 kHz, quiet): real farmers on phones in fields will score worse.",
               "Omnilingual ASR was run with our own native PyTorch port of the official CTC checkpoints (strict weight loading), not with fairseq2, because fairseq2 has no Windows support and the link was too slow for a second CUDA stack in WSL.",
               "Round-trip numbers are SYNTHETIC: TTS speech transcribed by ASR. They test intelligibility of the TTS and domain-word handling of the ASR together; they are a proxy, not real farmer speech.",
               "Rule titles used for TTS are real rule texts, but their Bangla wording is still 'review: pending' in the registry.",
               "Number words vs digits are not unified by the normaliser; this inflates WER/CER slightly for every model.",
               "svara-tts ran from a Q8_0 GGUF copy dequantised to bf16 (bandwidth); the original bf16 weights may sound marginally different.",
           ]}
    for p in sorted(glob.glob(os.path.join(RES, "asr", "*.summary.json"))):
        s = load(p)
        s["extra"] = asr_extra(s["tag"])
        rep["asr_fleurs_bn_in_test"][s["tag"]] = s
    for p in sorted(glob.glob(os.path.join(RES, "tts", "*", "summary.json"))):
        s = load(p)
        rep["tts"][s["backend"]] = s
    for p in sorted(glob.glob(os.path.join(RES, "roundtrip", "*.hyps.jsonl"))):
        tag = os.path.basename(p).replace(".hyps.jsonl", "")
        rep["roundtrip_synthetic"][tag] = roundtrip_stats(p)
        bv = p.replace(".hyps.jsonl", ".by_voice.json")
        if os.path.exists(bv):
            rep["roundtrip_synthetic"][tag]["by_voice"] = load(bv)
        sp = p.replace(".hyps.jsonl", ".summary.json")
        if os.path.exists(sp):
            s = load(sp)
            rep["roundtrip_synthetic"][tag]["asr_rtf"] = s.get("rtf")
    sp = os.path.join(RES, "service", "service_test.json")
    if os.path.exists(sp):
        rep["service"] = load(sp)
    # one-GPU sovereign deployment, from the measured numbers
    asr = rep["asr_fleurs_bn_in_test"].get("omni-ctc-1b-v2", {})
    tts = rep["tts"].get("svara", {})
    if asr and tts:
        rep["deployment_one_gpu"] = {
            "asr_vram_peak_gb": asr.get("vram_peak_gb"), "tts_vram_peak_gb": tts.get("vram_peak_gb"),
            "cuda_context_gb_approx": 0.5,
            "voice_stack_total_gb_approx": round((asr.get("vram_peak_gb") or 0) + (tts.get("vram_peak_gb") or 0) + 0.5, 1),
            "asr_latency_5s_clip_ms": (asr.get("latency_5s_clip") or {}).get("median_ms"),
            "tts_rtf_overall": tts.get("rtf_overall"),
            "note": "Rule readbacks are a fixed, versioned set: synthesise them ahead of time and cache the audio per rule "
                    "version (regenerate on recall/change), so the farmer never waits for TTS. Live TTS speed needs a faster "
                    "runtime than transformers generate (vLLM on Linux or llama.cpp with the GGUF): not measured here.",
        }
    rep["recommendation"] = RECOMMENDATION
    rep["commands"] = COMMANDS
    rep["not_done"] = NOT_DONE
    rep["needs_from_lead"] = NEEDS
    json.dump(rep, open(os.path.join(HERE, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("wrote report.json:", {k: (list(v) if isinstance(v, dict) else v is not None) for k, v in rep.items() if k in ("asr_fleurs_bn_in_test", "tts", "roundtrip_synthetic", "service")})


if __name__ == "__main__":
    main()
