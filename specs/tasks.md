# Tasks — preliminary release (Oct 26 → Nov 18; the portal closes Nov 20)
Status: `[x]` done · `[~]` in progress · `[ ]` todo. Streams: LEAD, BE (backend), FE (frontend), ML, KN (knowledge), EV (evals), BIZ.
Tiers and gates: `D:\AI_congress\MASTER_PLAN.md` §4 (P0 never cut · P1 restored by the extension · P2 stretch).

## Done (Oct 26–27)
- [x] LEAD: repo scaffold, licence, .gitignore, AGENTS/CLAUDE.md
- [x] LEAD: constitution, spec, plan, tasks
- [x] LEAD: JSON Schemas + validated examples (v0.2: VC envelope, recall status, BCP-47)
- [x] KN: rule-registry format + `check_quotes.py` + tests
- [x] KN: pack #2 potato late blight (R-PLB-001..011; short attributed CIP quotes, quotation permission, not CC BY; review pending) + scenario tests
- [x] BE: snapshot (Open-Meteo forecast + GloFAS, cache fallback); planner + validator; two-farmer personalisation
- [x] BE: signed rule credentials + receipts (VC 2.0, eddsa-jcs-2022), verifier, status-list recall, did:web document, FastAPI
- [x] ML: Kaggle rice baseline v2 (cross-dataset collapse found → experiments E1–E4)

## Review fixes (Oct 27 evening; see `D:/AI_congress/plan/reviews/CONSOLIDATED_2026-10-27.md`)
- [x] Trust: the receipt signs the advice; W3C proof @context; recall stops the planner; recall before first use; lock + atomic writes; per-identity storage; UUID-only ids; no status slots for receipts; plan cache + rate limit; verifier checks
- [x] Safety: three-valued rules (a gap is never "no risk"); stale-data abstention; EN+BN dose validator with numeric grounding; exactly one decision; R-PLB-011 v2
- [x] Tests: 17 → 57 passing (W3C vector, tamper, recall, concurrency, traversal, weather gaps, validator)

## Week 1 — Tue Oct 27 → Sun Nov 1 · "core real, local" (gate G1)
- [~] FE: premium UI v1 in `apps/web` (story landing, farmer app + Lite mode, verifier stamp, officer inbox)
- [x] ML: experiments E1–E4 done; model card written; shipped MobileNetV4 union fp16-weights ONNX (5.3 MB), handed to the UI agent
- [ ] ML (5090): calibration + ECE + OOD; Dhan-Shomadhan external test (BD field images); DINOv2 fine-tune → distill; Grad-CAM; make the Kaggle kernels public
- [x] LEAD: CI workflow exists (`.github/workflows/ci.yml`). It has never run the trust/engine tests, because that code is not committed yet (commits on hold)
- [ ] BE: recall proxy for the UI (server-side admin token; never in the browser) + notification record
- [x] BE: officer inbox records + `GET /api/inbox` (admin token stands in for officer accounts)
- [ ] KN: BD rice pack ~10–12 aman rules (short attributed quotes, permission requested) + scenario tests
- [ ] BE: Ask router (question → rule IDs or abstain)
- [ ] EV: eval harness (dose-error with coverage + correct-abstention)
- [ ] BIZ/H1: roles; Secretariat (4 questions), BRRI/DAE/BARI and CIP emails; hero-field consent; 5090 access; 60 Bangla eval items

## Week 2 — Mon Nov 2 → Sun Nov 8 · "sovereign + reach + depth" (gate G2)
- [ ] ML/BE: sovereign stack on the RTX 5090 (vLLM gpt-oss-20b A/B Gemma 4, Qwen3-VL-8B, Omnilingual ASR, local Postgres) + latency/cost benchmark
- [ ] FE/BE: Bangla voice (ASR + TTS readback)
- [ ] BE: Telegram bot + SMS summary format with a short verify code
- [ ] BE: S2 NDVI chip for both packs; ML: potato few-shot vision
- [ ] BE: fields-like-yours v1 (AlphaEarth embeddings); outbreak radar v1 (aggregated, k-anonymous)
- [ ] BE: action attestations + scoped/expiring/revocable share links
- [ ] EV: Bangla safety eval n ≥ 60 + vision eval page + ASR WER
- [ ] LEAD: Azure staging URL by Thu Nov 5; two-phone QR test on mobile data
- [ ] BIZ: pathologist session (sign-off + compiler ground truth); native Bangla/Swahili review

## Week 3 — Mon Nov 9 → Sun Nov 15 · "proof + polish" (gate G3: freeze Sun 18:00)
- [ ] FE: officer mission control (inbox + map + recall console + audit log)
- [ ] ML: flood backtest (or drop it honestly)
- [ ] FE: break-ui, axe, Lighthouse passes; real mid-range Android test
- [ ] LEAD: `/docs` (portal prompt), `/evals`, `/architecture`, `/security`, README, model cards; prompt library ≥10
- [ ] BIZ (remote only, no field trips): phone/WhatsApp interviews ≥12; dealer prices by phone (cited); consented photos from a farmer contact if available
- [ ] LEAD: production deploy; 1-pager + portal drafts ≥90%; footage from the frozen build

## Final — Mon Nov 16 → Wed Nov 18
- [ ] Video ≤181 s · all links PASS logged-out · **leader submits Wed Nov 18 by 18:00** (Thu–Fri = buffer)
