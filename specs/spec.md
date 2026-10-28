# Spec — KrishiLoop preliminary release (target: submit Wed Nov 18, 2026; the portal closes Fri Nov 20)
*KrishiLoop is a global product: **any crop, any country, any language, any phone.** Bangladesh (rice and more) is the home market, not the scope. The two packs below are a demo choice, not a limit. Tiers: `D:\AI_congress\MASTER_PLAN.md` §4 (P0 never cut · P1 restored by the extension, cut first · P2 stretch). Status words: **implemented** (built and tested; the suite passes locally: 57 tests on Oct 27, 59 on Oct 28) · **P0 / P1** (planned).*

## Problem (verified facts only; IDs refer to `research/fact_register.md` and `research/fact_register_global.md`)
**Global**
- 608 M+ farms, 84% of them under 2 ha (GL-01, GL-02).
- Pathogens and pests cut yields by an estimated 17.2% (potato) to 30.0% (rice) across five staples (GL-14; expert-based estimates).

**Home market (Bangladesh)**
- 16.88 M agriculture-based households (A3) and 44.74% of employment (A2).
- Blast losses up to 80% in some fields in the 2023 boro season (B2).
- The 2017 Sunamganj flash flood damaged 393,855 t of rice (B5).
- The 16123 call centre received 92,094 calls in FY2025-26 (D4); these are calls, not unique farmers.
- 26% of rural residents own a smartphone (D1).

**AI advice**
- In our one-question test on Oct 25 (four models answered through API access, not consumer chatbots), three gave an ungrounded dose in Bangla and one invented a fungicide name. This is an anecdote, not a benchmark; the n ≥ 60 eval is P0 #9.

## Users
1. **Farmer** (often on a shared phone), in any country: wants to know what to do this week and when *not* to spend.
2. **Officer** (SAAO, extension officer, plant doctor, NGO field staff): handles escalated cases and serves farmers without smartphones.
3. **Verifier** (an officer, programme or auditor scanning a receipt's QR code).
4. **Pack reviewer** (an agronomist who reviews and signs rules). Today every rule is `review: pending`.
5. **AI adviser or developer** who wants receipts on its own answers (P1: through the API and MCP servers).

## The packs (a demo choice, not a limit)
| Pack | Crop · country · language | Status |
|---|---|---|
| `pack-potato-late-blight` | potato · Kenya sample location with no farmer · English (Swahili only after a native review, P1 #15) | **implemented:** 11 rules from short attributed quotes of CIP's manual (quotation with acknowledgement is permitted; it is **not** CC BY), written directly from the manual and **review pending** |
| BD rice (aman) | rice · Bangladesh · Bangla | **P0 #3, not built:** about 10–12 rules from short attributed quotes (permission requested) |
| Any other pack | any crop · country · language | adding a pack is the scaling path; the Knowledge Compiler that drafts candidate rules is **planned, not built** |

"Zero engine diff between packs" is **not yet shown**: only one pack exists. Claim it only after the BD rice pack runs on the same engine and a `git diff --stat` is recorded.

## The journeys (user stories with acceptance criteria)

### US-1: See my field this week
*As a farmer I open the app (no login, "demo farmer") and see my field card.*
- AC1: The card shows the crop, the stage (from the planting or transplant date), a 7-day forecast summary and a flood signal (GloFAS discharge trend), **each with source + timestamp** (implemented for the forecast and flood blocks). **P0 #1:** a Sentinel-2 NDVI image chip with its acquisition date. Anything illustrative (such as a procedural chip) is labelled "illustration" and is never shown as a real field.
- AC2: When live sources fail, the card shows the last snapshot labelled "Data as of ⟨timestamp⟩" (`data_mode`, `data_as_of`). A snapshot older than 36 h is never used for "this week" (US-3 AC5).

### US-2: Diagnose a leaf on my phone (the crop-agnostic photo flow)
*As a farmer I photograph a leaf of any supported crop and get a diagnosis without uploading the photo.*
- AC1: Inference runs on-device (ONNX in the browser); p95 < 1.5 s on a mid-range Android (P0 #2; not measured yet).
- AC2: Output = top-3 labels with calibrated confidence, a lesion highlight, a severity estimate and a "what NOT to do" line. The flow is **crop-agnostic by design**: the crop pack supplies the symptom signatures, the "next view" questions and the citations, so adding a crop adds data, not UI code.
- AC3: If confidence is below the threshold, the input is out-of-distribution, or the prediction set holds more than one label → `abstained` with a reason. The app first asks for the most informative next photo (for example the underside of the leaf), and if it is still unsure it creates an officer-inbox item (photo attached only with consent).
- AC4 (gate): a photo diagnosis may feed the planner **only** if the model is calibrated, passes the OOD check and is confident (P0 #2 adds a single-label prediction set). Otherwise it becomes an officer case and the weather-based plan still stands. The planner-side gate is implemented (added Oct 28). A sample or v0 diagnosis never feeds a decision: today's v0 rice model has a cross-dataset macro-F1 of about 0.19 and is uncalibrated, so it is shown as a hint only, and no model can pass the gate yet.
- AC5: The model card states each training set's licence status. A model trained on re-uploaded sets with unverified licences is labelled "demo/research use" until the upstream terms are traced.

### US-3: Get a receipted input decision
*As a farmer I tap "What should I do this week?" and receive a plan.*
- AC1: The plan contains ≤3 actions. Exactly **one** is the **input decision** (`spray` / `dont_spray` / `recheck`) with a traffic light. The money impact is shown in **the pack's local currency** (BDT for the BD pack, KES for the Kenya pack) from cited prices (P0 #4; no price data exists yet).
- AC2: **Every action has a receipt** (Article 1). Tapping it shows the quote + doc + page, the data readings, the rule id(s) and the confidence label.
- AC3 (validator, implemented): the validator blocks any action without a source, any dose whose (amount, unit) is not in the cited quote (English or Bangla, including Bangla digits and units, spelled-out numbers and `%`), and any brand name (Latin or Bangla script) → the response is `abstained`.
- AC4: The plan is stage-aware for the pack's crop. Potato: a stage guard in the rules (R-PLB-011 v2; implemented). BD rice: aman stages from the transplant date (P0 #3).
- AC5 (**abstain on missing or stale data**, implemented): if any weather fact that a decision rule needs is missing, the plan abstains with `data_unavailable`; unknown is never "no risk" (three-valued rule logic). If the forecast snapshot is older than 36 h, the plan abstains with `data_stale`. In both cases the farmer sees a fixed, localised message, the details (missing facts, blocked text) go to a stored officer-inbox record, and every plan and receipt carries `data_mode` and `data_as_of`. The other abstention reasons are `no_matching_rule`, `conflicting_rules`, `validator_blocked` and `rule_recalled`.
- AC6 (**recall stops the planner**, implemented): a recalled rule version is never served. If the input decision depended on it, the plan abstains with `rule_recalled` and an officer-inbox record is stored. A recall made before a rule was ever used is kept. Every receipt issued under the recalled version verifies as "Recalled".
- AC7 (**receipts sign the advice**, implemented): each receipt is a W3C VC 2.0 `AdviceReceiptCredential` (`eddsa-jcs-2022`) whose signed content includes the **advice text, decision and traffic light**, the **plan window** (`valid_from`, `valid_to`) and `validUntil`, plus the sources, data readings and rule versions. The verifier shows "This receipt certifies…" from the verified document only. Editing any of those fields makes verification fail ("Invalid").
- AC8 (verifier, implemented): scanning the QR opens `/verify/{id}`, which answers **Authentic**, **Recalled** or **Invalid**, and never "correct". Any verification error is "Invalid", never a server error. Today receipts verify against the local server; the stable public issuer domain is decided at staging (Thu Nov 5).

### US-4: Personalised plans
*As two different farmers under the same forecast, we get different, explained plans.*
- AC1: The farmer profile changes the plan. Potato pack (implemented): `crop_protected` and `soil_drainage`, declared in the rules (`boost_when`). BD rice pack (P0 #4): variety, stage, irrigation source and budget.
- AC2: A "Why this plan for you" panel lists the profile factors that changed it (implemented in the plan's `personalization` block).

### US-5: Officer inbox
*As an officer I see the abstained cases from my farmers.*
- AC1: Each item shows the field context, the reason code and details, the model's top-3 (if any), and the photo **only if consent was given**. The record is implemented (`GET /api/inbox`, behind the admin token until officer accounts exist); the officer screen is P0 #11.
- AC2: The officer can mark it resolved with a note. An API endpoint exists (added Oct 28, behind the admin token); the audit log and officer accounts are P1 #17.

### US-6: The Kenya potato pack journey (the second pack, on the same engine)
*As a potato grower at a labelled sample location in Kenya (no farmer is involved), I get the same journey in English.*
- AC1: `KE-SAMPLE-01` ("Sample Kenyan highland location (no farmer)") with the two demo profiles gives two different, explained plans from the same forecast (implemented).
- AC2: Each receipt shows the CIP source (title, publisher, PDF page, short quote), `licence_status: permitted` with the acknowledgement, and the rule's review status (`pending` today). Parameters set by the team are shown as "not from the source".
- AC3: Same API, same verifier, same planner. No engine change between packs is claimed until US-7 exists and the diff is recorded.
- AC4: The money impact is shown in KES (P0 #4). Swahili appears only after a native speaker's review; before that it is labelled "machine-translated preview" (P1 #15).

### US-7: The Bangladesh rice pack journey (home market; P0 #3, not built)
*As a rice farmer in Bangladesh I get the same journey in Bangla.*
- AC1: About 10–12 aman rules from short attributed quotes (≤25 words each) of documents with `licence_status: cited_permission_requested`, with the quote check passing in CI, scenario tests and the safety regression suite.
- AC2: Receipts and the UI are in Bangla (the Bangla UI strings are still to be filled, P0 #11), with native-speaker review of the top journeys recorded.

### US-8: Ask a question (P0 #5, not built)
*As a farmer or officer I ask a question and get rule ids or an abstention.*
- AC1: The router returns rule ids from the loaded packs. It never generates agronomy; an out-of-scope question is an abstention that routes to the officer.
- AC2: Coverage and correct-abstention are measured and shown on `/evals`.

### US-9: Action attestations and sharing (P1 #18)
*As a farmer I confirm an action and keep proof.*
- AC1: An in-app photo + a **server** timestamp + SHA-256 create an attestation (`attestation` schema); GPS EXIF is stripped from the stored copy. A Sentinel-2 chip reference may be attached as **context, not evidence**.
- AC2: The farmer can create a share link (scope: which attestations; expiry ≤30 days) and revoke it (`share_link` schema).

### US-10: Local language and voice
- AC1: The UI language follows the pack (Bangla for the BD pack, English for the Kenya pack). A one-tap language switch is P1 #20; any language without a native review is labelled "machine-translated preview".
- AC2: Voice input and a spoken readback of the receipt (P1 #13): Omnilingual ASR on the RTX 5090, or the browser's Web Speech as a fallback behind a consent screen (browser speech may send audio to a third party).
- AC3: Native-speaker review of the top journeys is recorded.

### US-11: Officer mission control and the outbreak radar (P1 #16, #17)
- AC1: Mission control combines the inbox, a map and a recall console. The recall console needs a confirmation step, a server-side token and an audit-log entry.
- AC2: The radar is built from aggregated abstentions and reports with k-anonymity, and is labelled *sample* until real reports exist.

## Non-goals (this release)
Marketplace, lender features, AWD verification, carbon console, drones/IoT, the 16123 copilot, federated learning, payments, the full impact engine (pilot only), and field trips (validation is remote: phone, WhatsApp, video). We also never claim that a satellite can evidence a spray on a 0.1 ha plot.
**Not a non-goal:** other crops, countries and languages. A new pack is how the product scales.

## Success metrics shown on `/evals` (P0 #9; the eval harness is not built yet)
- Ungrounded-dose rate: raw LLMs vs KrishiLoop (n ≥ 60 Bangla questions), with **coverage** and **correct abstention** next to it.
- Receipt coverage per pack; recall propagation (every receipt under a recalled rule version shows "Recalled").
- Vision macro-F1: in-dataset and **deduplicated cross-dataset on shared labels**, plus leave-one-dataset-out; ECE before and after calibration; abstention behaviour.
- p50/p95 latency; cost per answer.
