# Spec — KrishiLoop preliminary release (target: Oct 30, 2026)

## Problem (verified facts only; IDs refer to `research/fact_register.md`)
- 16.88 M agriculture-based households (A3) and 44.74% of employment (A2).
- Blast losses up to 80% in some fields in the 2023 boro season (B2).
- The 2017 Sunamganj flash flood damaged 393,855 t of rice (B5).
- The 16123 call centre received 92,094 calls in FY2025-26 (D4).
- 26% of rural residents own a smartphone (D1).
- Widely available LLMs invent doses and brands in Bangla (our dated test).

## Users
1. **Farmer** (often on a shared phone): wants to know what to do this week and when *not* to spend.
2. **SAAO / extension officer:** handles escalated cases; serves farmers without smartphones.

## The one journey (user stories with acceptance criteria)

### US-1: See my field this week
*As a farmer I open the app (no login, "demo farmer") and see my field card.*
- AC1: The card shows crop, variety, stage (from transplant date), a Sentinel-2 NDVI image chip with acquisition date, a 7-day forecast summary, and a flood signal (GloFAS discharge trend), **each with source + timestamp**.
- AC2: When live sources fail, the card shows the last snapshot labelled "Data as of ⟨timestamp⟩".

### US-2: Diagnose a leaf on my phone
*As a farmer I photograph a leaf and get a diagnosis without uploading the photo.*
- AC1: Inference runs on-device (ONNX in the browser); p95 < 1.5 s on a mid-range Android.
- AC2: Output = top-3 labels with calibrated confidence, a heat-map, and a "what NOT to do" line.
- AC3: If confidence < threshold or the input is out-of-distribution → `abstained` with a reason, and an officer-inbox item is created (only with consent to attach the photo).

### US-3: Get a receipted input decision
*As a farmer I tap "What should I do this week?" and receive a plan.*
- AC1: The plan contains ≤3 actions. Exactly one is the **input decision** (`spray` / `dont_spray` / `recheck`), with a Tk impact computed from cited prices.
- AC2: **Every action has a receipt** (Article 1). Tapping it shows the quote + doc + page, the data used, the rule id(s) and the confidence.
- AC3: The validator blocks any action without a source, any dose not verbatim in the source, and any brand name → the response is `abstained`.
- AC4: The plan is stage-aware (aman heading → maturity for the preliminary).

### US-4: Personalised plans
*As two different farmers under the same forecast, we get different, explained plans.*
- AC1: The farmer profile (variety, stage, irrigation source, budget) changes the plan.
- AC2: A "Why this plan for you" panel lists the profile factors that changed it.

### US-5: Officer inbox
*As a SAAO I see the abstained cases from my farmers.*
- AC1: Each item shows the farmer's field context, the abstention reason, the model's top-3 (if any), and the photo **only if consent was given**.
- AC2: The officer can mark it resolved with a note (recorded in the audit log).

### US-6: "I did it" ledger + sharing
*As a farmer I confirm an action and keep proof.*
- AC1: An in-app photo + **server** timestamp + SHA-256 + an S2 chip reference create a ledger entry.
- AC2: The farmer can create a share link (scope: which entries; expiry ≤30 days) and revoke it.

### US-7: Bangla and voice
- AC1: Bangla is the default UI; English is a toggle.
- AC2: Voice input/output through the browser (Azure Bangla TTS is planned).
- AC3: Native-speaker review of the top journeys is recorded.

## Non-goals (preliminary)
Marketplace, lender features, AWD verification, carbon console, drones/IoT, other crops, 16123 copilot.

## Success metrics shown on `/evals`
- Ungrounded-dose rate: raw LLMs vs KrishiLoop (n ≥ 60 Bangla questions).
- Receipt coverage.
- Correct-abstention rate.
- Vision macro-F1: in-dataset and **deduplicated cross-dataset on shared labels**; ECE before/after calibration.
- p50/p95 latency; cost per answer.
