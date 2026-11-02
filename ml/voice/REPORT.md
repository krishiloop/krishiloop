# Voice track: sovereign Bangla speech on our own GPU (P1 #13, W3)

Measured on 29 Oct 2026 on the NBTC RTX 5090 (Windows 11, torch 2.14.1+cu130). The safety-eval LLM and other teams' jobs shared the GPU and CPU throughout, so speed numbers are conservative. Numbers are in `report.json`; raw outputs are in `results/`.

## Bottom line

| | Ship? | Why |
|---|---|---|
| **ASR: Meta Omnilingual `omniASR_CTC_1B_v2`** | **Yes** (Apache-2.0) | FLEURS Bangla: **CER 6.2 %, WER 25.4 %**; 40 ms for a 5 s clip; 2.4 GB VRAM |
| ASR: Whisper large-v3-turbo | No | CER 45.3 %, WER 91.6 %; Devanagari letters in 85 % of its outputs; 1.26 s for a 5 s clip |
| **TTS: `kenpath/svara-tts-v1`, "Bengali (Male)" voice** | **Yes, with conditions** (Llama 3.2 Community License) | Round trip on real rule titles: CER 8.6 % |
| TTS: svara female voice | Not without a native listen | The ASR wrote 19 of 51 female clips in Devanagari or Gujarati; 4 clips speak the label "Bengali" aloud |
| TTS: MMS-TTS `ben` | **Never: CC BY-NC** | Comparison only; fast but robotic |
| TTS: Indic Parler-TTS | Not tested | Gated on Hugging Face (401 without a token); skipped per the brief |

**Architecture suggestion:** the rule readbacks are a fixed, versioned set. Synthesise them ahead of time and cache the audio per rule version, regenerating it when a rule is recalled or changed. The farmer then never waits for TTS. All 11 rice rule titles in one voice come to about 1.5 minutes of audio, roughly 0.25 MB as Opus.

## 1. Speech to text: FLEURS `bn_in` test, all 920 utterances (3.43 h)

**Data and scoring:**
- FLEURS is CC BY 4.0 and was downloaded without credentials.
- References are the raw transcriptions. References and hypotheses go through the same normaliser (`bn_text.py`):
  - Unicode NFC (this also unifies ড় ঢ় য় written precomposed or with a separate nukta);
  - old khanda-ta spelling becomes ৎ;
  - zero-width characters removed (ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen);
  - Bangla digits become ASCII digits;
  - Latin letters lower-cased;
  - all punctuation, symbols and separators (danda, double danda, U+09F7, pipe, quotes, dashes, brackets) become spaces;
  - spaces collapsed.
- Number words are not turned into digits.
- WER and CER are corpus-level. CER counts code points, including single spaces between words.
- Speed is batch 1, GPU-synchronised, excluding file reads.
- VRAM figures are PyTorch allocator numbers; the CUDA context adds about 0.5 GB.

| model | licence | WER | CER | median utterance CER | real-time factor (batch 1) | 5 s clip latency | VRAM weights / peak |
|---|---|---|---|---|---|---|---|
| omniASR_CTC_1B_v2 | Apache-2.0 | **25.4 %** | **6.2 %** | 5.7 % | **0.003** | **40 ms** (p90 44) | 1.95 / 2.44 GB |
| whisper-large-v3-turbo | MIT | 91.6 % | 45.3 % | 32.2 % | 0.204 | 1,264 ms (p90 1,403) | 1.62 / 2.41 GB |

**Whisper turbo** (run with the language forced to Bangla, `language="bn"`, greedy):
- Omnilingual is better on every one of the 920 utterances.
- 779 of 920 Whisper outputs mix Devanagari into the Bangla.
- 14 outputs loop; without them Whisper is still at CER 43.6 % / WER 89.4 %.
- Accuracy was measured at batch 16. Speed was measured at batch 1 on 40 evenly spread utterances.

**Omnilingual quirk:** in 93 of 920 outputs a digit is glued to Bangla letters, e.g. "2ুই" for দুই ("two"). Utterances whose reference contains digits score CER 7.9 %, against 5.75 % for the rest. A small post-processing fix would help; it was not applied.

**How Omnilingual was run:**
- fairseq2 has no Windows support, so `omni_ctc.py` re-declares the model in plain PyTorch with fairseq2's parameter names.
- It loads the official checkpoint (`dl.fbaipublicfiles.com/mms/omniASR-CTC-1B-v2.pt`) with strict matching: all 807 tensors match by name and shape.
- Architecture values and the inference steps come from the official sources (omnilingual-asr 0.2.0 and fairseq2 0.6).
- A broken port could not reach 6.2 % CER, but it has not yet been cross-checked against fairseq2 itself. `nbtc/wsl_setup.sh` builds that environment if wanted.

## 2. Text to speech

| model | licence | clips | VRAM weights / peak | real-time factor | Opus size per clip (median) |
|---|---|---|---|---|---|
| svara-tts-v1 (Q8_0 GGUF dequantised to bf16) + SNAC 24 kHz | Llama 3.2 Community License | 102: 11 rule titles and 40 questions, each in both voices; none empty | 6.68 / 7.21 GB | 4.74 with transformers `generate()`; 2.11 with our lean sampling loop | 15.7 KB |
| MMS-TTS ben (VITS) | CC BY-NC 4.0 | 51 | 0.15 / 0.44 GB | 0.037 | 12.8 KB |

**svara speed:**
- The lean loop uses the same sampling (temperature 0.75, top-p 0.9, top-k 40, repetition penalty 1.1). Its real-time factor ranged from 1.02 to 7.7, depending on CPU load from other jobs.
- A short readback (rule R-BDR-007, about 6 s of speech) took 6.4–6.8 s on a quiet host and 14–17 s on a busy one. In the service, warm calls took 6.1–6.3 s.
- Loading from the GGUF takes 35–98 s because it is dequantised on the CPU.
- Faster runtimes (vLLM on Linux, or llama.cpp with the GGUF) were not measured.

**Samples for the video:** 7 clips in `samples/`, 237 KB in total, with `samples.json` listing text, voice and round-trip CER:
- 5 real rule titles (R-BDR-001, 004, 007, 008, 012), round-trip CER 1.3–4.3 %;
- 2 synthetic questions (q-p05, q-r17), round-trip CER 2.7 % and 0.0 %;
- mixed voices: 4 male, 3 female.

## 3. Domain check (SYNTHETIC round trip: TTS speech transcribed by ASR, not real farmers)

**Texts:**
- the 11 distinct real `title.bn` texts from `rules/registry/pack-bd-rice` (Bangla wording still `review: pending`);
- 40 synthetic farmer questions: 32 unique seed questions plus 8 written on 29 Oct so that কুশি and বিঘা are covered, all labelled SYNTHETIC in `tts_texts.jsonl`.

| TTS → ASR | rule titles CER / WER | farmer questions CER / WER | farm words heard correctly |
|---|---|---|---|
| svara male → Omnilingual | **8.6 % / 26.8 %** | 25.8 % / 43.6 % | 13 of 28 (46 %) |
| svara female → Omnilingual | 13.8 % / 33.7 % | 36.9 % / 59.2 % | 13 of 28 |
| MMS → Omnilingual | 10.3 % / 32.7 % | 13.8 % / 39.7 % | 11 of 28 (13 of 28 allowing spelling variants) |
| svara (both voices) → Whisper turbo | 56.1 % / 85.9 % | 66.6 % / 91.0 % | 8.9 % |
| MMS → Whisper turbo | 40.4 % / 74.2 % | 74.5 % / 88.3 % | 7.1 % |

**Farm-word errors seen:**
- ইউরিয়া → ইউডিয়া, উরিয়া or ইউনিয়া;
- ব্লাস্ট → ব্যাস্ট;
- বাদামি গাছফড়িং → বাদামি গাজফোরিং, or "বাদ আমি গাছ ফরে";
- বিঘা → বিহা;
- কুশি is usually right.

A small farm-word lexicon correction or LM biasing is the obvious next step; neither was built here. Short questions are harder for svara than long rule titles.

## 4. Sovereign voice service (prototype, not wired in)

**Endpoints** (`service.py`, FastAPI on 127.0.0.1:8765 only, models load lazily):
- `POST /asr`: webm, ogg, wav, mp3 or m4a up to 30 s; returns text, language, model, audio length and processing time.
- `POST /tts`: JSON text (up to 400 characters, male voice by default); returns Ogg/Opus.
- `GET /health`.

**Test** (`service_test.py`, 29 Oct; the service was stopped afterwards). All checks passed:
- **Bind:** listened on 127.0.0.1:8765 only; nothing was listening after the stop.
- **TTS:** returned Ogg/Opus, 23.9 KB for 5.7 s of speech.
- **ASR input formats:**
  - the TTS output (ogg): CER 5.8 %, 96 ms;
  - a 21.6 s FLEURS wav: CER 2.5 %, 26 ms;
  - the same clip as browser-style webm/Opus at 32 kbps: CER 3.0 %, 24 ms.
- **Latency:** a 5 s clip takes 46 ms end to end over HTTP (median). First calls include the lazy model load: TTS 86 s, ASR 5 s.
- **Rejections:** over-long text gets 413; garbage audio gets 400.

## 5. One-GPU sovereign deployment

- **VRAM:** ASR 2.4 GB + TTS 6.9–7.2 GB + CUDA context about 0.5 GB comes to roughly 10 GB, so the voice stack fits a 12–16 GB card. On the 5090 next to gpt-oss:20b (about 13 GB) the total is about 23 GB.
- **Latency:** ASR is about 45 ms per 5 s utterance end to end. With pre-synthesised readbacks there is no TTS wait at request time. Live TTS for text that is not a rule runs at roughly real time at best on this runtime.

## 6. Licences

| name | licence | URL | status |
|---|---|---|---|
| Google FLEURS bn_in | CC BY 4.0 | huggingface.co/datasets/google/fleurs | used |
| Omnilingual omniASR_CTC_1B_v2 + tokenizer_written_v2 | Apache-2.0 (code and weights) | github.com/facebookresearch/omnilingual-asr | used, recommended |
| Omnilingual omniASR_CTC_3B_v2 | Apache-2.0 | dl.fbaipublicfiles.com/mms/omniASR-CTC-3B-v2.pt | overnight job |
| whisper-large-v3-turbo | MIT | huggingface.co/openai/whisper-large-v3-turbo | used |
| whisper-large-v3 | Apache-2.0 on the Hugging Face card (MIT on GitHub) | huggingface.co/openai/whisper-large-v3 | overnight job |
| kenpath/svara-tts-v1 | **Llama 3.2 Community License** (fine-tune of Llama-3.2-3B via canopylabs/3b-hi-ft-research_release; the card's "Apache-2.0" does not override it). Commercial use allowed with "Built with Llama" attribution, the acceptable-use policy and under 700M monthly users. Training data includes IndicTTS: check its terms. | huggingface.co/kenpath/svara-tts-v1 | used, recommended with conditions |
| mradermacher/svara-tts-v1-GGUF (Q8_0) | same as svara | huggingface.co/mradermacher/svara-tts-v1-GGUF | used because of bandwidth; ship the original weights |
| hubertsiuzdak/snac_24khz | MIT | huggingface.co/hubertsiuzdak/snac_24khz | used |
| facebook/mms-tts-ben | **CC BY-NC 4.0** | huggingface.co/facebook/mms-tts-ben | comparison only, never shipped |
| ai4bharat indic-parler-tts / IndicF5 / indic-conformer | Apache-2.0 / MIT / MIT | huggingface.co/ai4bharat | not tested: gated |
| k2-fsa/OmniVoice | weights CC BY-NC | huggingface.co/k2-fsa/OmniVoice | not tested |
| bangla-speech-processing/BanglaASR | MIT | huggingface.co/bangla-speech-processing/BanglaASR | not run (bandwidth) |

## 7. Caveats

- FLEURS is read speech in quiet rooms; farmers on phones in fields will score worse.
- The round trips are synthetic proxies, not real farmer speech.
- Rule titles are real, but their Bangla wording is still pending review.
- Speed was measured on a shared host.
- svara ran from a Q8_0 GGUF copy.
- The Omnilingual port has not been cross-checked against fairseq2.

## 8. Commands

All long jobs went through `ssh -o BatchMode=yes nbtc5090 "powershell -NoProfile -ExecutionPolicy Bypass -File F:\krishiloop-5090\scripts\kljob.ps1 -Name <job> -Script F:\krishiloop-5090\scripts\voice\<script>.ps1"`:

| job | script | what it ran |
|---|---|---|
| `voice-dl2` | `dl_window_now.ps1` | downloads in the link window, up to 4 connections per file |
| `voice-prep` | `run_prep.ps1` | `prepare_fleurs.py` |
| `voice-asr-turbo` | `run_asr_turbo.ps1` | Whisper turbo on FLEURS |
| `voice-pipe4` | `run_pipeline.ps1` | Omnilingual on FLEURS, svara and MMS TTS, round trips |
| `voice-male` | `run_male_questions.ps1` | questions in the male voice |
| `voice-svc` | `run_service_test2.ps1` | service test |
| `voice-overnight` | `run_overnight.ps1` | Omnilingual CTC-3B-v2 and Whisper large-v3 on FLEURS and the round trips (resumable; starts after the model downloads) |

- The venv `F:\krishiloop-5090\venvs\voice` was created over SSH with `make_venv.ps1`, using `--system-site-packages` from `dl`.
- On the laptop: `build_texts.py`, `make_report.py`, `pick_samples.py --asr-tag omni-ctc-1b-v2`.
- **After the overnight job:** `scp "nbtc5090:F:/krishiloop-5090/work/voice/asr/*" ml/voice/results/asr/`, the same for `roundtrip/*`, then `python ml/voice/make_report.py`.

## 9. Wired into the app (2 Nov 2026)

**Readbacks (our own voice, Bangla).**
- `readbacks.py build` copies only the clips that pass three checks into `apps/web/public/audio/bn/` and writes `apps/web/public/audio/manifest.json`:
  - male voice only;
  - the clip's text is exactly today's `action.title.bn` of an active rule (sha256 of the normalised text, keyed with rule id and version);
  - round-trip CER of at most 10 %.
- Shipped: 8 files (289.8 KB) covering 9 rule versions: R-BDR-001, 002, 003 (same text as 002), 004, 005, 007, 009, 010 and 012, all v1.
- Held back: R-BDR-006, 008 and 011, whose round trips were 19.2 %, 23.7 % and 14.5 %. Their transcripts hint that the audio does not say the text: a garbled first word, a repeated phrase, and a probable number error in "৮০টির". All potato rules (R-PLB-001 to 011) have Bangla text but no clip yet.
- The app plays a clip only for that exact rule version and text. Otherwise it uses the device's Bangla voice, or says there is none.
- A receipt that is Recalled (or cannot be verified) never plays its advice: it reads or shows the recall notice instead.
- Where our voice plays, the app says: our own machine voice (svara-tts-v1), Built with Llama, not yet checked by a native speaker. /proof lists it under "Data and licences".

**Speech input.**
- Web Speech stays the default, labelled as the browser's service, which may send the audio to the browser's maker.
- The sovereign path is off by default. With `KRISHILOOP_VOICE_URL=http://127.0.0.1:8765` (loopback only) on the API host:
  - `GET /api/voice/health` reports the service;
  - the Ask tab records with MediaRecorder (Bangla only);
  - `POST /api/voice/asr` passes the audio to `service.py` and returns the text into the normal Ask flow.
  - Code: `services/voice_proxy/`; tests: `tests/test_voice_proxy.py` (fake service, no network).

**Not run yet: regeneration on the 5090.** It is lent to another project.
1. `python ml/voice/readbacks.py todo` lists 15 texts, 2 takes each: the 3 held-back rules, the 11 potato rules and the recall notice.
2. `ml/voice/nbtc/run_readbacks.ps1` synthesises them (male voice) and transcribes them back.
3. `readbacks.py build` with both results files keeps the best take of each text that passes.

The steps are in the script's header.
