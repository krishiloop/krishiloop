# CLAUDE.md

Follow `AGENTS.md` (the hard rules apply to Claude Code too). Project context:

- **Product:** a global trust layer for AI farm advice (any crop, any country, any language, any phone). Bangladesh (rice and more) is the home market, not the scope; the current packs (Kenya potato late blight, runnable; Bangladesh rice, P0 and not built) are a demo choice, not a limit.
- **Standing rules:** validation is remote (phone, WhatsApp, video), no field trips; never fabricate; write "we found no example", never "nobody does X"; the CIP manual is quoted under its publisher's acknowledgement statement and is **not** CC BY; the Knowledge Compiler is planned, not built; "zero engine diff between packs" is not yet shown (only one pack exists).
- **Deadline (extended):** the Idea-to-Unicorn preliminary closes **Fri Nov 20, 2026** (time to confirm; assume 23:59 BST). The team's internal target is submitting by **Wed Nov 18, 18:00**. Gates: G1 Sun Nov 1 (local journey), G2 Sun Nov 8 (sovereign + staging), G3 Sun Nov 15 (freeze).
- **Local-first:** develop and test on local machines; a public URL is needed only for phone QR tests (staging from Nov 5) and judge links.
- **Planning docs live outside the repo:** `D:\AI_congress\MASTER_PLAN.md` (v6; §4 is the P0/P1/P2 scope and the gates, §9.3 the sprint), `D:\AI_congress\plan\` (concept, judging strategy, traceability, review log, Azure guide) and `D:\AI_congress\research\` (verified facts and data sources).
- **Secrets:** `D:\AI_congress\secrets\.env`. Load it via environment variables. Never print values.
- **Cheap work goes to cheap models:** delegate mechanical tasks (listing, boilerplate, fact lookups) to Haiku-class subagents.
- **Verified data spine (Oct 25):**
  - Open-Meteo (forecast, archive, soil moisture, GloFAS flood; the free tier is non-commercial)
  - Sentinel-2 L2A and Sentinel-1 via the Earth Search / Planetary Computer STAC APIs
  - Not used: NASA POWER precipitation (wrong for recent weeks); SoilGrids (the REST API is down and WCS is untested)
- **Models (Oct 25):**
  - The **planner is deterministic** (`services/engine/planner.py`, ADR-1). An LLM may only phrase validated text or draft candidate rules; it never plans or authors agronomy, and no LLM is called by the product code yet
  - Cerebras `gpt-oss-120b`: drafts for the Knowledge Compiler (planned, not built) and a raw-LLM baseline in the evals
  - Gemini `gemini-flash-latest`, for Bangla phrasing only (planned); free tier, so no photos or PII
  - The on-device vision model is trained on Kaggle
- Facts for any user-facing text come **only** from the VERIFIED rows of `D:\AI_congress\research\fact_register.md` and `fact_register_global.md`.
