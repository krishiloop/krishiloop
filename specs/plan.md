# Technical plan — preliminary release (submit Wed Nov 18; the portal closes Fri Nov 20)
*Status words (checked Oct 28): **implemented** = built and tested in the working tree (all tests pass locally: 57 on Oct 27, 59 on Oct 28) · **P0 / P1** = planned in that tier of `D:\AI_congress\MASTER_PLAN.md` §4 · **not scheduled**. The architecture is global: crop, country, currency, units and language live in packs, never in engine code.*

## Architecture (the Guide's 8 layers)
| Layer | Target implementation | Status |
|---|---|---|
| User interaction | PWA in `apps/web`: React 19 + Vite + TypeScript, Tailwind v4, three.js / react-three-fiber, GSAP + motion, onnxruntime-web, vite-plugin-pwa; a Lite mode without WebGL; per-pack language strings (bn, en, sw, hi); MapLibre for mission control; voice (Omnilingual ASR, browser Web Speech as a fallback) | **partial, P0 #11:** UI v1 in progress (story landing, farmer app, verifier with the RECALLED stamp, officer inbox); the Bangla strings are still empty; the on-device model integration, offline PWA and budgets are to finish. MapLibre and voice are P1. Two plain pages (demo plan + verifier) in `services/api/web/` are served by the API today |
| Application logic | FastAPI (`services/api/main.py`); the JSON Schemas in `contracts/schemas/` are the contract; FastAPI serves `/openapi.json` | **implemented:** plan, verify, credentials, recall, officer inbox, DID document and status-list endpoints; Pydantic request models; plans and credentials checked against their schemas in tests. A committed `contracts/openapi.yaml` is *planned* and does not exist |
| AI intelligence | A **deterministic planner** over `rules/registry` (ADR-1). On-device vision: a MobileNetV4 student as ONNX with fp16-stored weights (int8 post-training quantisation broke accuracy: `ml/vision/MODEL_CARD.md`). LLMs only **phrase** validated text or **draft** candidate rules: Gemini flash for phrasing (text only, no PII); Cerebras `gpt-oss-120b` for Knowledge Compiler drafts | **implemented:** planner + validator (English and Bangla doses, brand block). **Vision v0** exists (rice; cross-dataset macro-F1 ≈ 0.19; uncalibrated); the calibrated, crop-agnostic v1 is P0 #2. **No LLM is called by the product code yet:** phrasing is planned, and the Knowledge Compiler is planned, not built |
| Knowledge retrieval | Postgres + pgvector + BM25 (hybrid) + reranker over the **cleared** corpus; a small knowledge graph built from the rule registry | **planned:** the Ask router (P0 #5) is the first retrieval; pgvector arrives with the local Postgres (P1 #12). There is **no retrieval today**: rules are loaded from YAML |
| Agent orchestration | A **fixed** LangGraph: `perceive → context → retrieve → plan → validate → (abstain|phrase) → respond`; tools via 3 MCP servers (weather, satellite, knowledge/receipts) | **P1 #21, not built.** Today the pipeline is plain Python (`services/engine/planner.py`: snapshot → evaluate rules → validate → issue receipts → plan or abstain). We claim LangGraph only if the pipeline really runs on it |
| Data infrastructure | Postgres (local in the sovereign stack; Azure B1MS optional in cloud mode): fields, snapshots, plans, inbox, audit log | **Postgres is not implemented.** State is JSON files with a lock and atomic writes: `data/trust/<signer>/` (credentials, status list, recalls), `data/snapshots/`, `data/inbox/`. There is one data folder per signer identity, and the API refuses to start on a mismatch. The Postgres migration is P1 #12 |
| Automation | A nightly snapshot job (S2 + Open-Meteo + GloFAS) via a GitHub Actions cron or a container job, which precomputes weekly plans | **partial:** the snapshot is fetched on demand (Open-Meteo forecast + GloFAS, with a cache fallback) and plans are cached per (store, field, profile, day). The nightly job and the Sentinel-2 chip are P0 #1. CI (`.github/workflows/ci.yml`) runs contract validation, the quote check and pytest; it has **not yet run the services or their tests**, because that code is not committed |
| Deployment | One API container (Azure Container Apps) + the static PWA (Azure Static Web Apps); fallback Vercel + HF Space. Sovereign mode: Docker Compose on the RTX 5090 host | **planned:** nothing is deployed. Local-first until the staging URL (Thu Nov 5); production by G3 (Sun Nov 15). The shipped model file is gitignored and needs a release or Blob asset (`plan/AZURE_SETUP_GUIDE.md`) |

Added to the working tree on Oct 28 (tested; after the Oct 27 review): per-visitor demo sandboxes (each visitor gets its own status list, recall registry and inbox, so one visitor's recall does not change another's receipts), a planner-side gate for photo diagnoses (see ADR-3), officer-inbox get/resolve endpoints, and read endpoints for packs and snapshots.

## Key design decisions (ADR summary)
- **ADR-1: Rules over generation.** The planner is deterministic. The LLM only phrases (planned), so receipts are always exact. *Trade-off:* less flexible, but trustworthy, testable and explainable.
- **ADR-2: Quote integrity in CI.** Every rule has `quote` + `doc_id` + `page` + `quote_sha256`. For licence-cleared documents, CI verifies the quote is a substring of the committed text. For permission-pending documents (`licence_status: cited_permission_requested`), CI verifies the hash and that the quote is ≤25 words, and the full-text check runs locally against `corpus_private/` (`tools/check_quotes.py --private-dir`).
- **ADR-3: On-device vision first.** Privacy, offline use, latency. A server fallback exists only with consent (planned). A photo diagnosis reaches the planner only past a gate: calibrated, in-distribution and confident (the planner-side gate is in the working tree; a single-label prediction set is planned). Otherwise it becomes an officer case, and the weather-based plan still stands. No model can pass the gate yet (P0 #2).
- **ADR-4: Cache weekly plans per (store, field, profile, day)** (implemented: no new credentials on every click). A nightly precompute is planned (P0 #1). Real-time Q&A streams; p95 is published (planned).
- **ADR-5: Fixed graph, not an autonomous agent** (P1 #21). Predictable latency and cost; easy to explain to judges.
- **ADR-6: 3 MCP servers (weather, satellite, knowledge/receipts)** (P1 #21, not built), each a thin wrapper over functions the pipeline already uses. Tools are documented with their permissions; recall stays behind the admin token and is not exposed as a tool. Transport: streamable HTTP (stdio for local dev).
- **ADR-7: Global by construction.** Crop, country, currency, units and language live in packs and their parameters, never in engine code. Demo fields and profiles are data (`rules/demo/demo.yaml`). "Zero engine diff between packs" is the test of this decision, and it is **not yet shown**: only one pack exists.

## Data contracts
`contracts/schemas/` holds 10 JSON Schema 2020-12 files:
- `action`
- `attestation`
- `credential` (the W3C VC 2.0 envelope for rule credentials and advice receipts)
- `diagnosis`
- `field_snapshot`
- `inbox_item`
- `plan`
- `problem` (RFC 9457 API errors)
- `receipt`
- `share_link`

`contracts/examples/` holds 10 validated examples: `action`, `attestation`, `diagnosis`, `field_snapshot`, `inbox_item`, `plan.ok`, `plan.abstained`, `problem`, `receipt` and `share_link`. `credential` has no example file; its conformance is tested in `tests/test_vc.py`. `tools/validate_contracts.py` checks every schema and every example.
There is **no `ledger_entry` schema** (the farmer-held record is the `attestation`) and **no `contracts/openapi.yaml`**: FastAPI serves `/openapi.json`, and a committed copy is planned. The schemas change between milestones; they are not frozen.

## Evaluation plan (P0 #9; the eval harness is not built yet)
- **Vision:** perceptual-hash dedupe (within and across datasets) → group-aware splits → baseline → temperature scaling → in-dataset, cross-dataset and leave-one-dataset-out metrics (shared labels only); ECE and out-of-distribution behaviour.
- **Bangla safety:** n ≥ 60 native-speaker questions, raw LLM vs KrishiLoop, reported with coverage and correct abstention.
- **System:** latency and cost, logged per request.

## Security and privacy
- **Implemented:**
  - secrets come from the environment;
  - rate limiting on plan creation (20 per minute per client) plus the per-day plan cache;
  - security headers (CSP, `nosniff`, no-referrer, `X-Frame-Options`);
  - a constant-time admin-token check, validated request bodies, UUID-only credential ids (no path traversal);
  - no unbounded credential issuance;
  - a lock and atomic writes on state;
  - the verifier shows only the verified document, and any verification error is "invalid".
- **Planned:**
  - a CORS allow-list (the demo pages are same-origin, so none is configured);
  - an audit log for inbox and sharing actions (a recall already records its time, reason and actor);
  - officer accounts (the admin token stands in);
  - prompt-injection filtering on retrieved text (no retrieval or LLM exists yet);
  - a PII scrubber before any free-tier LLM call, so free-tier AI APIs receive de-identified text only;
  - a consent screen before voice input.
