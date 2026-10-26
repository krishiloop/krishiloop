# KrishiLoop (কৃষিলুপ)

**Every recommendation comes with a receipt — or goes to an officer.**

KrishiLoop is an independent, Bangla-first AI field adviser for smallholder rice farmers in Bangladesh. A farmer photographs a leaf, and diagnosis runs on the phone. The farmer then gets a stage-aware plan centred on an **input decision** (spray, don't spray, or re-check), and every line of it carries a **receipt**: the source passage, the field data with its timestamp, the rule, and the model's confidence. When the system is unsure it **abstains** and sends the case to the extension officer's inbox. When the farmer acts, the proof goes into their own **field ledger**, which they can share if they choose.

Built for the International AI Builders Congress 2026 · AgriSphere AI · Precision Farm.

> Status: **Day 1 scaffold (Oct 26, 2026).** Nothing here is production-ready yet. Planned controls are marked *planned*; we never present them as done.

## Repository map
| Path | What lives there |
|---|---|
| `specs/` | Spec-first development: constitution → spec → plan → tasks |
| `contracts/` | **Frozen API contract**: `openapi.yaml` + JSON Schemas (receipt, plan, ledger, inbox) + validated examples |
| `rules/` | **Rule registry**: every agronomic rule carries a verbatim source quote, doc id and page |
| `corpus/` | `manifest.yaml`: every source document with its licence and permission status. Licence-cleared texts only |
| `tools/` | `check_quotes.py` (quote integrity), `validate_contracts.py` |
| `tests/` | pytest suite run in CI |
| `ml/vision/` | Kaggle notebook: perceptual-hash dedupe → leakage-free splits → baseline → calibration → ONNX |
| `apps/web/` | PWA (Bangla-first) *(Day 2+)* |
| `services/api/` | FastAPI + fixed LangGraph pipeline *(Day 2+)* |
| `services/mcp/` | MCP servers: weather, satellite, knowledge *(Day 2+)* |
| `evals/` | Bangla safety eval, vision eval, latency/cost *(Day 3+)* |
| `docs/` | Architecture, evals, prompt library, submission drafts, team contributions |

## Quick start (checks only, Day 1)
```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Windows (Git Bash)
.venv/Scripts/python tools/validate_contracts.py
.venv/Scripts/python tools/check_quotes.py
.venv/Scripts/python -m pytest -q
```

## Integrity rules (non-negotiable)
1. **No fabricated data or results.** Sample data is labelled *sample*; metrics are reproducible.
2. **The LLM never writes agronomy.** Recommendations come from the rule registry plus retrieval over licence-cleared sources. The LLM only phrases them, and the validator rejects anything without a source.
3. **No generated doses and no brand names.** Doses appear only when they are a verbatim quote from a cited source.
4. **Secrets never enter git** (see `.gitignore`). Local keys live outside the repo.
5. **Licences are respected:** see `corpus/manifest.yaml`. Government documents with no licence are not committed. They are cited by link and short attributed quotation until written permission is granted.

## Licence
Code: Apache-2.0 (`LICENSE`). Data and corpus items keep their own licences, listed in `corpus/manifest.yaml`.
