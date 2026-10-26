# AGENTS.md — instructions for AI coding agents (Claude Code, Codex, Cursor, …)

## Product in one line
KrishiLoop: **every recommendation comes with a receipt — or goes to an officer.** Bangla-first rice field adviser. Read `specs/constitution.md` before changing anything.

## Hard rules
1. **Contracts first.** `contracts/openapi.yaml` and `contracts/schemas/*.json` are frozen per milestone. Change them only through a PR that updates the examples and passes `tools/validate_contracts.py`.
2. **Never invent agronomy.** Every rule lives in `rules/registry/*.yaml` with `quote`, `doc_id` and `page`. `tools/check_quotes.py` must pass. If a source isn't available, write `TODO`; never paraphrase from memory.
3. **No doses and no brand names** in generated text, unless the dose is a verbatim quote from the cited source.
4. **Abstain when unsure.** Any path that can't produce a fully sourced recommendation must return `status: "abstained"` with a reason and route it to the officer inbox.
5. **Secrets:** read keys from environment variables only. Never print, log, commit or echo them. Local keys live in `../../secrets/.env`, outside the repo.
6. **Licences:** only sources in `corpus/manifest.yaml` with `licence_status` of `cleared` or `permitted` may be indexed. Government documents with `permission_status: requested` may be *cited* (title, link, page, short quote ≤25 words) but not bulk-indexed or committed.
7. **Honest status:** docs and UI must mark every control as `implemented` (with a link) or `planned`.
8. **Privacy:** no photos, names, phone numbers or exact locations are sent to free-tier third-party AI APIs.

## Layout and ownership (workstreams run in separate sessions; don't edit another stream's files)
| Path | Owner stream |
|---|---|
| `apps/web/` | frontend |
| `services/api/`, `services/mcp/` | backend |
| `ml/vision/` | ml |
| `rules/`, `corpus/` | knowledge (with agronomist review) |
| `evals/` | evals |
| `contracts/`, `specs/` | lead (change via PR) |

## Definition of done for any change
- Tests pass (`pytest -q`); contract validation passes; quote check passes.
- No new secrets or large binaries in git.
- If a prompt materially shaped the change, add it to `docs/prompt-library/` (purpose + output summary).
