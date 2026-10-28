# Prompt Library (source for the portal's "Prompt Library" and "Prompt usage" fields)

**Rules:** only prompts we really used. Each entry has a purpose, the prompt (or an excerpt), and what it produced. Entries marked **proprietary** go into the portal with the proprietary toggle on, so only judges and admins see them. We never paste our private chat history. We curate the prompts that shaped the product.

| # | Category | Purpose | Prompt (excerpt) | Output / effect | Proprietary |
|---|---|---|---|---|---|
| 1 | Evaluation | Dated safety test of raw LLMs in Bangla | "একজন কৃষক জিজ্ঞেস করছেন: 'আমার আমন ধানের পাতায় চোখের মতো দাগ…' সহজ বাংলায় ৩-৪ লাইনে উত্তর দিন…" ("A farmer asks: 'I see eye-shaped spots on my Aman rice leaves…' Answer in 3–4 lines of simple Bangla…") | Showed invented doses and brands → led to the receipt validator (`research/llm_bangla_smoke_test.md`) | no |
| 2 | Design review | Independent red-team review of the concept and plan (judge panel + delivery manager) | "You are an independent, skeptical reviewer … Act as a 5-judge panel … Deliver: panel scores, concept critique, top 10 issues with fixes …" | Two reviews; the second gave us the headline, recall-as-MUST and the Ask router (`plan/REVIEW_LOG.md`) | yes |
| 3 | Research | Licence-checked dataset discovery (cheap-model subagent) | "Find Kaggle datasets … listing/metadata only … never print tokens … ranked shortlist with licences" | `research/kaggle_datasets.md` | no |
| 4 | Research | Live verification of open data APIs | "Make real HTTP calls … record status, latency, auth, licence, sample …" | `research/data_sources_verified.md` | no |
| 5 | Engineering | Spec-first build instruction to Claude Code for signed receipts | "Implement W3C VC 2.0 Data Integrity with cryptosuite eddsa-jcs-2022 and a Bitstring Status List; verifier must say authentic / recalled / invalid, never 'correct'" | `services/trust/vc.py` + tests | yes |
| 6 | Engineering | Rule registry + quote integrity | "Every rule carries a verbatim quote + doc + page; CI fails if the quote is not on that page" | `tools/check_quotes.py` + tests | no |
| 7 | Engineering | Read-only MCP servers (Claude Code session brief) | "Build read-only MCP servers … weather … satellite … receipts … rules/knowledge … photo-trust … Recall stays behind the admin token and is NOT an MCP tool … pytest tests with no network" | `services/mcp/` (5 servers, 14 tools), `tests/test_mcp.py`, `tools/mcp_demo_client.py`, `docs/mcp/README.md` | no |

*To add (as they are built): the Knowledge Compiler extraction prompt; the Bangla phrasing prompt (validated content only); the symptom-description VLM prompt (fixed JSON schema); the LLM-judge prompt for the Bangla safety eval.*
