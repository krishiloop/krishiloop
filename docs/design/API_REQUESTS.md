# API requests from the web UI

## Status (Oct 28, backend v0.4.0)
| # | Request | Status |
|---|---|---|
| 1 | `GET /api/snapshots/{snapshot_id}` | ✅ done; includes per-day `risk` (`high`/`low`/`unknown`) and `risk_basis` (#2) |
| 2 | per-day risk | ✅ in the snapshot response (team-set thresholds, labelled as such) |
| 3 | `money_impact` with cited prices | ⏳ open: needs cited price sources |
| 4 | Inbox API | ✅ `GET /api/inbox`, `GET /api/inbox/{id}`, `POST /api/inbox/{id}/resolve` (admin token stands in for officer accounts). Demo: `GET /api/demo/{sid}/inbox`, no token |
| 5 | Recall without a browser token | ✅ via **demo sandboxes**: `POST /api/demo/session` → `{session_id}`; `POST /api/demo/{sid}/plan`; `POST /api/demo/{sid}/recall {rule_id, version, reason}`. Each session has its own status list (`/status/demo-<sid>`), so a recall changes only that session's receipts. `GET /api/verify/{id}` returns `sandbox: true` for those |
| 6 | `GET /api/stats` | ✅ official; `GET /api/demo/{sid}/stats` for a session |
| 7a/7c | `diagnosis` on `/api/plan` | ✅ accepted and validated (422 if invalid); `ood_score` is optional now. The **gate**: it informs rules only if `calibrated`, in-distribution and top-1 ≥ 0.85. Otherwise `diagnosis_used: false`, a `diagnosis_note` (`uncalibrated` / `low_confidence` / `out_of_distribution` / `model_abstained`), and an officer photo case. The weather plan still stands |
| 7b | receipt cites the diagnosis | ✅ when a rule uses `diagnosis_label`/`diagnosis_prob` (no current rule does) |
| 7d | `severity`, `symptoms` in the diagnosis | ✅ optional in `diagnosis.schema.json` |
| 7e/7f | model registry, signed diagnosis receipt | ⏳ open (after KrishiLens v1) |
| 8 | packs and signatures | ✅ `GET /api/packs`; `GET /api/packs/{id}/signatures` returns `[]` (planned) |
| 9 | Bangladesh rice in `/api/demo` | ⏳ open: needs the BD rice pack |
| 10 | photo cases to the inbox | ✅ through the gate (7a) |
| 11 | model hosting headers | ⏳ deployment task |

Also new: `GET /api/verify/{id}` returns the **verified credential** (`credential`); render only that. Receipts now carry `credentialSubject.advice` (the exact text, decision and light) and `credentialSubject.plan` (window, `data_mode`, `data_as_of`). Plans carry `data_mode`/`data_as_of`, and abstentions have new reason codes `rule_recalled` and `data_stale`.

The UI never edits the backend. Each item says what is missing, the shape the UI already codes against, and what it does until then. Numbers match references in code comments (`client.ts`, `diagnosis.ts`).

## 1. `GET /api/snapshots/{snapshot_id}`
`POST /api/plan` returns only `snapshot_id`; the 7-day forecast, satellite chip and flood trend live in the snapshot. The UI uses a bundled copy of the real Open-Meteo snapshot (labelled sample). Turn the live call on with `VITE_SNAPSHOT_API=1` once it exists. Shape: `contracts/schemas/field_snapshot.schema.json`.

## 2. `forecast.days[].risk` from the planner
The weather calendar can show a per-day risk (`low | medium | high | unknown`) only if the planner computes it with the same weather-favourability rules as the advice. Until then the calendar says "day-by-day risk ratings are not part of the plan yet" and shows the raw numbers.

## 3. `money_impact` with cited prices
The money counter renders only when an action carries `money_impact` (`amount_min`, `amount_max`, `currency`, `basis`, `price_source_ids`, `sample`). Prices must cite sources. A sample scenario exists in the demo drawer, labelled sample.

## 4. Officer inbox API
`GET /api/inbox`, `GET /api/inbox/{id}`, `POST /api/inbox/{id}/resolve {note}`. Shape: `inbox_item.schema.json`. Until then the inbox is sample cases plus cases the farmer app made on this device (kept in `localStorage`).

## 5. Recall proxy `POST /api/demo/recall {rule_id, version}`
Server-side, holding the admin token, so the demo can recall without the browser ever seeing it. Until then: sample mode simulates the recall in the browser; live mode shows a dev-only input that keeps a typed token in memory for one request.

## 6. `GET /api/stats`
Counters for the status board and the verifier ("N receipts issued, M recalled, rule versions withdrawn"). Until then the UI reads the Bitstring Status List itself (it shows how many entries are withdrawn).

## 7. Photo diagnosis as a planner input (crop-agnostic)
**7a. `POST /api/plan` accepts an optional `diagnosis`** (`diagnosis.schema.json`, additionalProperties false; the UI sends exactly those keys: labels top-3, model name + version + SHA-256, `on_device`, `calibrated`, `ood_score`, `status`, `inference_ms`, `created_at`, `crop`; never pixels). It is a fact like weather: the rule engine matches it against the crop's pack.
**7b. The receipt must cite it.** An action driven by the diagnosis carries a reading in `receipt.data[]` with `source: "on-device-model:<name>@<version>"` (e.g. `on-device-model:rice-leaf-mnv4s@union-v0`), `variable: "leaf_photo_diagnosis"` (value = disease id) and `leaf_photo_confidence`. The UI shows a receipted decision **only** if the returned plan has such a reading; otherwise it shows a neutral "Planned" card. Today the server ignores the key and the UI shows that card.
**7c. `ood_score` is required but v0 has no OOD head.** The UI sends `1 - top-1 probability` (a confidence complement, not a detector). Please make it optional or define it.
**7d. Extend the schema for the KrishiLens output** (all optional): `severity {pct, lo, hi}` (% of the plant part affected; manuals state thresholds in %, so rules can use it), `symptoms[] {concept, strength, signature_ref}` (universal concepts, see the research plan M4), `differential[]` (the conformal set, not only the top 3), `views[]` (extra photos asked and answered), `pack_id`, `plant_part`, `crop_check {seen, prob}` (vision double-checks the profile's crop). Until then these stay on the phone and in the on-screen receipt.
**7e. Model registry.** Resolve `model.sha256` to its model card (name, version, datasets tested on and scores, calibration, threshold) so the verifier shows the same spec sheet the phone shows. The phone currently holds that card as data (`photoModelCard.ts`).
**7f. A signed diagnosis receipt** (`POST /api/diagnosis` or inside `/api/plan`): the diagnosis itself as a Verifiable Credential, verifiable by `GET /api/verify/{id}` like advice, with each matched symptom citing the manual (quote + page).

## 8. Packs and signatures
`GET /api/packs` (crops with a pack and their status) and `GET /api/packs/{pack_id}/signatures` (symptom signatures from the Knowledge Compiler: disease, symptom concept, manual quote, page, `doc_id`, licence status, language). The UI's chips open a sheet with that quote + page; today these come from clearly labelled sample packs (`samplePacks.ts`). Quote-check CI should cover signatures like rules.

## 9. Bangladesh rice in `/api/demo`
The live `/api/demo` has only the Kenya potato field. The bundled demo mock adds `BD-DEMO-01` (rice, grain fill, `pack-bd-rice`) with an abstained plan ("no matching rule"). Please add the field and the pack, with Bangla titles (`title.bn`) and `quote`/licence notes.

## 10. Photo cases to the inbox
`POST /api/inbox` from the farmer app with the diagnosis (labels, probabilities, model, severity, symptoms) and `photo_attached: false`; a photo may attach only with an explicit consent flow. The UI already withdraws an automatic case when a later photo makes the answer sure.

## 11. Hosting the on-device model
Serve `/models/*.onnx` and the ORT `.wasm` with `Content-Length`, long immutable cache headers, and the SHA-256 published next to the file (the phone hashes what it downloads and prints "checked on this phone"). The file is 5.28 MB (fp16 weights) plus a 14.8 MB runtime; `*.onnx` is gitignored, so a deploy step must copy it into `apps/web/public/models/`.
