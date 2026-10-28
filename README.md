# KrishiLoop

**Every piece of AI farm advice comes with a receipt anyone can check — and if a rule turns out wrong, we recall it from every farmer who got it.**

KrishiLoop is a trust layer for AI farm advice, built to work for any crop, in any country and language, on any phone.
- Advice comes from **rule packs**: agronomy written as code, where every rule carries a verbatim quote from its source and its page, and tests.
- Each recommendation is issued as a **signed receipt**: a W3C Verifiable Credential 2.0 using `eddsa-jcs-2022`. The receipt signs the advice itself, its sources, the data it used and the rule version.
- A QR code lets an officer or auditor check that a receipt is **authentic**. If a rule is withdrawn, every receipt that used it verifies as **recalled**, and the planner stops serving that rule.
- When data is missing or out of date, or the rules disagree, the system **abstains**, and the case goes to the extension officer's inbox.

Built for the International AI Builders Congress 2026 · AgriSphere AI · Idea to Unicorn.

> **Status (Oct 27, 2026):** pre-release. Nothing here is production-ready yet.
> - **Runnable today:**
>   - one rule pack (potato late blight at a labelled *sample* location in Kenya, using short attributed quotes from CIP's manual; **review pending**);
>   - signed receipts, a verifier and recall;
>   - live weather from Open-Meteo (its free tier is non-commercial).
> - **In progress:**
>   - a Bangladesh rice pack;
>   - the crop-agnostic on-device vision model (KrishiLens);
>   - the web app in `apps/web`.
>
> Planned controls are marked *planned*; we never present them as done.

## Repository map
| Path | What lives there |
|---|---|
| `specs/` | Spec-first development: constitution → spec → plan → tasks |
| `contracts/` | JSON Schemas (Draft 2020-12) for plans, actions, receipts, credentials, inbox items, diagnoses and snapshots, plus validated examples. An OpenAPI file is *planned*; FastAPI serves `/openapi.json` today |
| `rules/` | Rule registry (one folder per pack). Every rule carries a verbatim source quote, doc id and page, with scenario tests. `rules/guardrails/` holds blocked brand names |
| `corpus/` | `manifest.yaml`: every source document with its licence/permission status; committed text only where permitted |
| `services/trust/` | VC 2.0 signing and verification (`eddsa-jcs-2022`), Bitstring Status List, did:web document, recall registry |
| `services/engine/` | Weather snapshot, rule evaluation (three-valued: a missing fact is never "no risk"), deterministic planner, dose/brand validator, officer inbox |
| `services/api/` | FastAPI app and two simple pages (demo plan and verifier) |
| `apps/web/` | The full web app (Vite + React); see `docs/design/DESIGN.md` |
| `ml/vision/` | Kaggle training scripts, ONNX packing and the model card |
| `tools/` | `check_quotes.py` (quote integrity) and `validate_contracts.py` |
| `tests/` | pytest suite (trust, engine, API safety), run in CI |
| `docs/` | Design, prompt library, keys (public only) |

## Run it
```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # Windows (Git Bash)
.venv/Scripts/python tools/validate_contracts.py
.venv/Scripts/python tools/check_quotes.py
.venv/Scripts/python -m pytest -q
# API: needs KRISHILOOP_ISSUER_SEED (64 hex chars) and ADMIN_TOKEN in the environment; PUBLIC_BASE_URL is the
# address that phones will use for the QR codes (ISSUER_DID is optional; by default it is derived from PUBLIC_BASE_URL)
.venv/Scripts/python -m uvicorn services.api.main:app --port 8000
```

## Integrity rules (non-negotiable)
1. **No fabricated data or results.** Sample data is labelled *sample*; metrics are reproducible.
2. **The LLM never writes agronomy.** Recommendations come from the rule registry. An LLM may only rephrase validated text (planned), and the validator rejects any dose that is not a verbatim (number, unit) match in a cited quote, in English or Bangla.
3. **No generated doses and no brand names.**
4. **Secrets never enter git.** Local keys live outside the repo.
5. **Licences are respected** (see `corpus/manifest.yaml`). Documents without a licence are cited by link and short attributed quotation until written permission is granted.

## Licence
Code: Apache-2.0 (`LICENSE`). Data and corpus items keep their own licences, listed in `corpus/manifest.yaml`.
