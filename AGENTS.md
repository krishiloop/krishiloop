# AGENTS.md — instructions for AI coding agents (Claude Code, Codex, Cursor, …)

## Product in one line
KrishiLoop: **every recommendation comes with a receipt — or goes to an officer.** A global trust layer for AI farm advice: any crop, any country, any language, any phone. Bangladesh (rice and more) is the home market, not the scope; the first packs (Kenya potato late blight, runnable; Bangladesh rice, in progress) are a demo choice, not a limit. Read `specs/constitution.md` before changing anything.

## Hard rules
1. **Contracts first.** The JSON Schemas in `contracts/schemas/` (`action`, `attestation`, `credential`, `diagnosis`, `field_snapshot`, `inbox_item`, `plan`, `problem`, `receipt`, `share_link`) are the API contract. FastAPI serves `/openapi.json`; a committed `contracts/openapi.yaml` is *planned* and does not exist yet. Change a schema only together with its example in `contracts/examples/`, through a PR that passes `tools/validate_contracts.py`.
2. **Never invent agronomy.** Every rule lives in `rules/registry/*.yaml` with `quote`, `doc_id` and `page`. `tools/check_quotes.py` must pass. If a source isn't available, write `TODO`; never paraphrase from memory.
3. **No doses and no brand names** in generated text, unless the dose (amount and unit) matches one stated in the cited source passage. The validator checks this numerically, in English and Bangla.
4. **Abstain when unsure.** Any path that can't produce a fully sourced recommendation must return `status: "abstained"` with a reason and route it to the officer inbox.
5. **Secrets:** read keys from environment variables only. Never print, log, commit or echo them. Local keys live in `../../secrets/.env`, outside the repo.
6. **Licences:** only sources in `corpus/manifest.yaml` with `licence_status` of `cleared` or `permitted` may be indexed. Documents with `licence_status: cited_permission_requested` (for example government documents whose permission has been requested) may be *cited* (title, link, page, short quote ≤25 words) but not bulk-indexed or committed. A quotation permission is not an open licence: the CIP manual (pack #2) is `permitted` for quotation with acknowledgement and is **not** CC BY, so never call it CC BY or "openly licensed".
7. **Honest status:** docs and UI must mark every control as `implemented` (with a link) or `planned`.
8. **Privacy:** no photos, names, phone numbers or exact locations are sent to free-tier third-party AI APIs.
9. **Global by construction:** never hard-code a crop, country, currency or language into the engine. Packs carry them as data.
10. **Wording:** write "we found no example", never "nobody does X". Do not claim "zero engine diff between packs" or "compiler-drafted" until it is true (only one pack exists, and the Knowledge Compiler is planned, not built). Validation is remote (phone, WhatsApp, video); there are no field trips. User-facing facts come only from VERIFIED rows of `research/fact_register.md` and `research/fact_register_global.md`.

## Layout and ownership (workstreams run in separate sessions; don't edit another stream's files)
| Path | Owner stream |
|---|---|
| `apps/web/` | frontend |
| `services/api/`, `services/engine/`, `services/trust/`, `services/mcp/` (planned, P1) | backend |
| `ml/vision/` | ml |
| `rules/`, `corpus/` | knowledge (with agronomist review) |
| `evals/` (planned; the eval harness is not built yet) | evals |
| `contracts/`, `specs/` | lead (change via PR) |

## Definition of done for any change
- Tests pass (`pytest -q`); contract validation passes; quote check passes.
- No new secrets or large binaries in git.
- If a prompt materially shaped the change, add it to `docs/prompt-library/` (purpose + output summary).
