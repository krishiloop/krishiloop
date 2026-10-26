# CLAUDE.md

Follow `AGENTS.md` (the hard rules apply to Claude Code too). Project context:

- **Deadline:** the Idea-to-Unicorn preliminary closes **Sat Oct 31, 2026, 23:59 BST**. The team's internal target is submitting by **Fri Oct 30, 18:00**.
- **Planning docs live outside the repo:** `D:\AI_congress\MASTER_PLAN.md` (v4; §4 is the "ship only" list, §9.4 the sprint), `D:\AI_congress\plan\` (concept, judging strategy, traceability, review log, Azure guide) and `D:\AI_congress\research\` (verified facts and data sources).
- **Secrets:** `D:\AI_congress\secrets\.env`. Load it via environment variables. Never print values.
- **Cheap work goes to cheap models:** delegate mechanical tasks (listing, boilerplate, fact lookups) to Haiku-class subagents.
- **Verified data spine (Oct 25):**
  - Open-Meteo (forecast, archive, soil moisture, GloFAS flood; the free tier is non-commercial)
  - Sentinel-2 L2A and Sentinel-1 via the Earth Search / Planetary Computer STAC APIs
  - SoilGrids via WCS (the REST API is down)
  - Not used: NASA POWER precipitation (wrong for recent weeks)
- **Models (Oct 25):**
  - Cerebras `gpt-oss-120b` (fast planner)
  - Gemini `gemini-flash-latest`, for Bangla phrasing only; free tier, so no photos or PII
  - The on-device vision model is trained on Kaggle
- Facts for any user-facing text come **only** from `D:\AI_congress\research\fact_register.md`, VERIFIED rows.
