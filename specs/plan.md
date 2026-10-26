# Technical plan — preliminary release

## Architecture (the Guide's 8 layers)
| Layer | Implementation |
|---|---|
| User interaction | PWA: React + Vite + TypeScript + Tailwind + shadcn/ui; i18next (bn default); MapLibre; onnxruntime-web; browser speech |
| Application logic | FastAPI service implementing `contracts/openapi.yaml`; responses validated against `contracts/schemas/*` |
| AI intelligence | On-device vision (ONNX int8 + CAM); a deterministic planner over `rules/registry`; Cerebras `gpt-oss-120b` for English phrasing and tool use; Gemini flash for Bangla phrasing (text only, no PII) |
| Knowledge retrieval | Postgres + pgvector + BM25 (hybrid) + reranker over the **cleared** corpus; a small knowledge graph built from the rule registry (Wikidata/GBIF entity ids) |
| Agent orchestration | A **fixed** LangGraph: `perceive → context → retrieve → plan → validate → (abstain|phrase) → respond`; tools via 3 MCP servers |
| Data infrastructure | Postgres (Azure B1MS or Supabase fallback): farmers (demo profiles), fields, snapshots, plans, ledger, inbox, audit log |
| Automation | Nightly snapshot job (S2 + Open-Meteo + GloFAS) via GitHub Actions cron or a container job; precomputes weekly plans |
| Deployment | One API container (Azure Container Apps) + static PWA (Azure Static Web Apps). Fallback: Vercel + HF Space |

## Key design decisions (ADR summary)
- **ADR-1: Rules over generation.** The planner is deterministic. The LLM only phrases, so receipts are always exact. *Trade-off:* less flexible, but trustworthy, testable and explainable.
- **ADR-2: Quote integrity in CI.** Every rule has `quote` + `doc_id` + `page` + `quote_sha256`. For licence-cleared documents, CI verifies the quote is a substring of the committed text. For permission-pending documents, CI verifies the hash and that the quote is ≤25 words, and the full-text check runs locally against `corpus_private/` (`tools/check_quotes.py --private-dir`).
- **ADR-3: On-device vision first.** Privacy, offline use, latency. A server fallback exists only with consent.
- **ADR-4: Precompute weekly plans nightly.** Real-time Q&A streams; p95 is published.
- **ADR-5: Fixed graph, not an autonomous agent.** Predictable latency and cost; easy to explain to judges.
- **ADR-6: 3 MCP servers (weather, satellite, knowledge)**, each a thin wrapper over functions the pipeline already uses. Transport: streamable HTTP (stdio for local dev).

## Data contracts
`contracts/schemas/`: `receipt`, `action`, `plan`, `diagnosis`, `field_snapshot`, `ledger_entry`, `share_link`, `inbox_item`, `problem` (errors). All are JSON Schema 2020-12. Validated examples live in `contracts/examples/`.

## Evaluation plan
- **Vision:** perceptual-hash dedupe (within and across datasets) → group-aware splits → baseline → temperature scaling → in-dataset and cross-dataset metrics (shared labels only).
- **Bangla safety:** n ≥ 60 native-speaker questions, raw LLM vs KrishiLoop.
- **System:** latency and cost, logged per request.

## Security and privacy
- Secrets come from the environment; the CORS allow-list; rate limiting.
- Validator + prompt-injection filtering on retrieved text.
- Audit log for inbox and sharing actions.
- Free-tier AI APIs receive de-identified text only.
