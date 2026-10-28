# KrishiLoop web: design record

Status: session 2 (Oct 28) on top of session 1 (Oct 27); see section 14 for what changed. Code in `apps/web`. Screens in `docs/design/screens/`. What the backend still owes the UI is in `API_REQUESTS.md`.

The sentence every screen serves: **Every piece of AI farm advice comes with a receipt anyone can check, and if a rule turns out wrong, we recall it from every farmer who got it.**

## 1. Direction

- **A calm, serious instrument with one warm accent.** Neutrals carry the page; sun-gold is the only accent. Green, amber and red appear **only** as go / re-check / stop, and always with an icon and a word (never colour alone).
- **The receipt is paper in both themes.** Everything that is evidence (advice receipt, diagnosis receipt, manual quote) is cream paper with ink text and mono kickers. Everything that is interface is dark glass (or warm rice paper in the light theme).
- **Motion explains, never decorates.** Each animation names a purpose (state change, spatial continuity, "something is being checked"). Everything is interruptible, runs on transform/opacity, and degrades under reduced motion.
- **Honest by construction.** Anything not from the live API or a real model wears a dashed "Sample" label. Unknown scores print "Not tested yet", never a guess. A failed verifier call says "could not check", never "invalid".
- **Mobile first, one hand.** 390 px is the design width; the desktop layout is the same content in two columns. Lite mode (no WebGL) keeps every function.

## 2. Experiences

| Route | Experience | Notes |
|---|---|---|
| `/` | Judge story: 3D rice-field hero, the problem (verified facts only), AI vs KrishiLoop, five morphing chapters (SEE, DECIDE, SPEAK, PROVE, LEARN), live verify + recall demo, any crop/any language, honest status board, CTA | Lenis smooth scroll on desktop pointer only |
| `/app` | Farmer app: field card, 7-day weather + risk, "Should I spray?" traffic light, up to 3 action cards each with a boarding-pass receipt + QR, abstention, "Why this plan for you", money counter (only when `money_impact` exists), voice, language switch, **leaf photo check** | `#photo` deep-links to the photo card |
| `/verify`, `/verify/:id` | Verifier: finder, staged check, AUTHENTIC (calm green) / RECALLED (ink stamp + reason) / INVALID / could-not-check, source details, how it was checked | Copy rule: "authentic = issued by KrishiLoop and unaltered"; never "correct" |
| `/officer`, `/officer/:id` | Officer inbox mock: cases the AI would not guess on, each with evidence | Cases made by the farmer app (photo cases) appear here |

## 3. Tokens

Defined once in `src/styles/index.css` (`@theme static`), re-declared for `[data-theme="dark"]` so nested dark windows (hero, verdict, chapters) work inside the light theme. Contrast measured by `node scripts/contrast.mjs` (all pairs pass AA).

| Token | Dark | Light | Use | Contrast dark / light |
|---|---|---|---|---|
| `void` | near-black green | warm rice paper | page | |
| `bone` | `#eeebe0`-ish | ink | primary text | 16.5 / 14.5 on void |
| `chrome` | mid grey-green | | secondary text | 8.9 / 7.8 |
| `dim` | | | tertiary text | 6.1 / 5.6 |
| `sun` | `#f0c96b` | `#8a5b00` | the one accent | 12.4 / 5.2 |
| `go` / `wait` / `stop` | `#6fd08c` / `#f2a93b` / `#f58a76` | `#1b7544` / `#8a5200` / `#b3261e` | decisions only | 10.4 / 9.9 / 8.2 on void (dark); 5.1 / 5.7 / 5.8 (light) |
| `paper`, `paper-ink`, `paper-dim`, `paper-accent` | `#ece6d3`, `#1b211b`, `#555d50`, `#7a5200` | `#fffdf7` base | receipts | ink 13.2 / 16.1 |

- **Type:** Geist Variable (UI), Geist Mono (kickers, ids, hashes), Instrument Serif (display, quotes), Hind Siliguri (Bengali). Self-hosted via fontsource; fallback faces use `size-adjust` so nothing jumps. Bangla: no negative tracking, taller line-height (`html[lang="bn"]` overrides).
- **Spacing/radii:** 4 px base; cards 20-24 px radius; chips full-round; receipts 22 px with 13 px ticket notches (CSS mask).
- **Modes:** dark (default), light, **Lite** (`html.lite`: auto when no WebGL, Data Saver, 2 GB or less, 2G; user choice persisted as `kl.mode`), **reduced motion** (OS setting or the on-page pause switch, `html.reduce-motion`).

## 4. Motion

Curves (CSS variables): `--ease-out cubic-bezier(.23,1,.32,1)` (entrances, bars, reveals), `--ease-in-out cubic-bezier(.77,0,.175,1)` (on-screen movement, FLIP), `--ease-drawer cubic-bezier(.32,.72,0,1)` (sheets), `--ease-cine cubic-bezier(.22,1,.36,1)` (hero). Durations: press 160 ms, popovers 200 ms, sheets 320-450 ms, bars/counters 700-800 ms, hero and verdict theatre 600-1100 ms (rare, deliberate).

| Moment | What moves | Why | Tool |
|---|---|---|---|
| Traffic light | sweep, then settle on the answer lamp | the answer arrives, not appears | CSS keyframes |
| Verifier | staged checks, calm seal, **stamp slam** with ink filter and a buzz on impact (only after a tap) | the recall is a consequence; make it felt | CSS + SVG filter |
| Boarding pass | vertical on phones, horizontal at 600 px (container query) | one object, two shapes | CSS container queries |
| Photo scan | a gold line sweeps the photo while the engine reads it | "something is looking", not "stuck" | CSS transform |
| **Differential shift** (the wow) | bars slide (`scaleX`), numbers count from old to new, rows swap places (FLIP), "+46 / -38" pills, a gold sweep on a new leader, a new symptom chip pops with a ring | the answer visibly changed because of the photo you just took | transitions + WAAPI FLIP (class component, `getSnapshotBeforeUpdate`); counters write into the text node, no re-render per frame |
| Next-photo card | rises in; its illustration's ring breathes; the leader rows are marked with a gold edge | ties the ask to the two diseases it separates | CSS |
| Sheets | `@starting-style` slide/fade on native `<dialog>` | focus trap and Escape come free | CSS |

Rules kept: only transform/opacity in loops; no `transition: all`; transitions (not keyframes) for anything retriggered; hover effects gated by `(hover: hover) and (pointer: fine)`; global reduced-motion clamps durations to 0.01 ms and iterations to 1, with two explicit overrides (the +/- pills and the receipt chevron stay readable).

## 5. Component inventory

- **ui:** `Logo`, `Safe` (ErrorBoundary / Scene / PageBoundary), `Sheet` (native dialog), `Toaster`, `Badges` (`SampleBadge`, `PreviewBadge`), `Reveal`.
- **shell:** `Layout`, `Controls` (language, theme, motion, mode, data badge, mode banner).
- **farmer:** `FarmerApp`, `Signal` + `TrafficLight`, `ActionList`, `ReceiptPass` (boarding pass + QR), `MoneySaved`, `FieldCard` (+ synthetic satellite chip), `WeatherCalendar`, `WhyPanel`, `Abstention`, `VoiceSheet`, `DemoSheet`.
- **photo (crop-agnostic):** `PhotoHint` (flow), `usePhotoSession` (state + side effects), `PhotoCanvas` (+ `LayerToggle`), `Differential` (FLIP list, `AnimatedNumber`), `SeverityMeter`, `SymptomChips` + `CitationSheet`, `ViewRequestCard` + `ViewArt`, `DiagnosisReceipt`, `PhotoDecision`.
- **verify:** `VerifyPage`, `VerdictStage`, `TicketCard`, `Stamp`, `ReceiptDetails`, `HowChecked`, `RecallPanel`, `NotificationPreview`, `MeshBackdrop`.
- **officer:** `OfficerPage`, `inboxStore` (sample cases + cases made on this device).
- **landing:** `Hero` (GSAP SplitText), `HeroPoster` (SVG fallback), `HeroReceipt`, `Problem` + `facts.ts`, `AdviceGap`, `Versus`, `Chapters` + `ChapterFallback`, `ProveDemo`, `World`, `StatusBoard`, `Closing`.
- **three (lazy chunks):** `RiceScene`, `HeroScene`, `ChapterScene`, shaders in `riceShaders.ts`, `chapterShader.ts`, `lightModes.ts`.

## 6. 3D and shader notes

- **Hero field:** ~80k instanced blade ribbons (`InstancedBufferGeometry`, shuffled so density thinning works), wind and pointer-brush in the vertex shader, reflective paddy water (fresnel, sun glitter, rain ripples, hill AO via `uHill`), sky dome, tree line, rain as `LineSegments`. Light modes: morning, rain, dusk (driven by weather). Satellite scan ring: viridis NDVI trail + gold front. `PerformanceMonitor` thins density when fps drops; `useOnScreen` stops the frame loop off-screen; reduced motion renders one still frame; SVG poster when WebGL is missing.
- **Chapters:** one ray-marched SDF object morphing between five signed-distance shapes (planet + satellite, traffic light, voice bars, seal with tick, loop) by blending distance fields, driven by scroll progress 0..4. SVG fallback in Lite.
- Dev-only: `window.__klU` uniform inspector (guarded by `import.meta.env.DEV`).

## 7. The leaf photo check (crop-agnostic)

One flow for every crop; **the crop comes from the field profile** (rice in Bangladesh, potato in Kenya, more later). Nothing in the flow is rice-specific.

```
photo -> Engine.read -> Engine.combine -> Report
Report { differential, severity, lesions/mask (PhotoOverlay), symptoms (each with manual quote + page), nextView, verdict, engine info }
  confident  -> planner (real engines): POST /api/plan { diagnosis }  -> receipted decision, only if the returned plan cites the diagnosis
                (sample engine: nothing is sent, and the card says so)
  ambiguous  -> ONE targeted extra photo (picture + one-line reason); the differential then shifts
  unsure     -> the officer gets the case (created once, updated as photos are added, withdrawn if a later photo makes the answer sure)
```

- **Engines** (`photo/engines.ts`): `onDeviceV0` = the real rice model (MobileNetV4-small, 21 classes, ONNX/WASM, 5.3 MB + 14.8 MB runtime, downloaded only after consent; photos combined by the mean of softmax; differential only; when unsure it asks for "another leaf"). `sampleEngine` = scripted, labelled **Sample**, for crops that have a sample pack (potato, rice): full result (severity, lesion boxes, symptoms with sample citations, targeted view). It never looks at the photo and its result is never sent to the planner. Rice offers a switch between the two; potato has only the sample until a real model exists.
- **Slots to fill when the model and signatures arrive:** `photoModelCard.ts` (name, version, SHA-256, `testedOn` rows with scores, `calibrated`, threshold; override threshold with `VITE_PHOTO_THRESHOLD`), `samplePacks.ts` (replace with packs from the Knowledge Compiler: diseases, symptom concepts, citations with real quote + page, next-view questions), `PhotoOverlay` (`overlay.ts`: leaf mask, heat, lesion boxes in the model's 224x224 input-crop space; `classify()` returns it, `PhotoCanvas` already draws it), a new `Engine` for the KrishiLens student.
- **Diagnosis receipt:** one spec line always visible (`name · version · tested on N sets · ms on this phone`); open it for reading, severity, symptoms with their quotes, tested-on rows with scores (Bangladeshi field photos print "Not tested yet"), threshold and calibration state, the model file's SHA-256 **hashed on the phone** (and compared with the model card), and "photo stays on this phone". No hard-coded disclaimer anywhere: the numbers speak.
- **Contract:** the Diagnosis sent to the planner is validated against `contracts/schemas/diagnosis.schema.json` in unit tests. Severity, symptoms and the next view are not in the schema yet (see API_REQUESTS.md #7).
- **Sample policy:** `sample: true` on every citation and overlay; the "Sample" badge on the card, the overlay and the receipt; the officer case made from a sample reading says so. The sample leaf pictures are vector illustrations, not photographs.

## 8. Data layer

- Live API first; on network failure, timeout or 5xx the app falls back to bundled mocks (`src/mocks`, captured from the real API with sample ids prefixed `534d504c`, "SMPL") and says so. 4xx answers are real answers and are shown as errors.
- `?sample=1` forces sample mode (used for screenshots and design work: it mints nothing). Plans are cached 6 h per field + profile so a reload never mints new credentials.
- Bitstring Status List decoded in the browser (`DecompressionStream`, popcount; bit 0 is the MSB of byte 0).
- No admin token exists anywhere in the browser (Oct 28): recalls go to the visitor's own demo sandbox, see section 14.

## 9. Performance (measured, production build, this machine)

| Item | Size |
|---|---|
| Farmer app initial JS, gzip (entry 71.5 + shared UI 31.0 + route 30.7 + small shared ~18) | **151 KB** (budget 250) |
| CSS, gzip | 25 KB |
| Landing: `Landing` 10.8 KB gz + GSAP 27 KB gz; three.js/R3F chunk 913 KB raw / 242 KB gz, **lazy**, never loaded by the farmer app or verifier | |
| On-device model (on demand): ORT wasm runtime 14.8 MB + model 5.3 MB; cached, not precached | |
| PWA precache | 39 entries, 1.07 MB; verifier calls are `NetworkOnly` so a recalled receipt can never look authentic offline |

Inference measured in headless Chrome on a laptop: about 50-55 ms per photo, 190-400 ms wall clock including the UI. Phone latency is not measured. Not yet run: Lighthouse, a 60 fps trace of the hero, CLS audit on a phone.

## 10. Accessibility

WCAG 2.2 AA target. Skip link, one `<main>`, visible focus ring (sun), native `<dialog>` for sheets, state never by colour alone, bars are `role="img"` with text, the severity meter is a real `meter` with `aria-valuetext`, screen-reader status line announces each photo result, live regions only where news arrives, all controls 24 px or larger (primary actions 44 px), Bangla line-height and tracking handled, motion pause switch (WCAG 2.2.2). Not yet run: axe in CI and a screen-reader pass.

## 11. Owner patterns reused

ShadowAstra: `motionPref` (system + on-page pause), `Safe`/`Scene` error boundaries with fallback metrics, Playwright + axe shape. UVERA: recorded-data fallback and the morph-field idea behind the chapters. Playbook rules: one accent, receipts as paper, sample labelling.

## 12. Known gaps (start here tomorrow)

1. ~~Bangla dictionary is an empty stub~~ Filled on Oct 28 (machine-written, **pending native-speaker review**, see section 14). `hi.ts` and `sw.ts` are older machine drafts (not updated for the Oct 28 keys, which fall back to English).
2. Not done: axe specs (a Playwright smoke test exists since Oct 28), Lighthouse, the `break-ui` worst-case pass, a second polish pass over every screen (one set of screenshots was taken and the hero, verifier, officer and photo flow reviewed; light theme and Lite were only looked at on the farmer screen).
3. Sample data to replace: citations (placeholders), the two sample packs, the sample leaf pictures. The live API has no Bangladesh rice field (the bundled demo mock does).
4. `docs/design/screens/` was produced by `node scripts/screens.mjs` (needs `npm run dev`). It is not committed (about 47 MB); regenerate it locally.

## 13. Run it

```
cd apps/web
npm install
npm run dev            # http://127.0.0.1:5173, proxies /api /status /.well-known to 127.0.0.1:8000 (KRISHILOOP_API overrides)
npm run build          # tsc + vite build (+ PWA)   npm run preview
npm test               # vitest: photo engines, contract validity, citation detection
node scripts/screens.mjs                 # screenshots into docs/design/screens (dev server running)
node scripts/photo-flow.mjs <dir>        # frame-by-frame capture of the sample photo flow
node scripts/photo-real.mjs <dir> a.jpg  # the real model on local images
node scripts/icons.mjs                   # PWA icons from public/favicon.svg
node scripts/contrast.mjs                # token contrast table
```

## 14. Oct 28 changes (backend v0.4.0)

**Wiring.** The status table at the top of `API_REQUESTS.md` is the contract.
- **Demo sandbox.** `POST /api/demo/session` once per browser tab (id kept in `sessionStorage` key `kl.demo.sid`; if the server forgets it, one new session is made and saved plans are dropped). The farmer app builds plans with `POST /api/demo/{sid}/plan`; recalls use `POST /api/demo/{sid}/recall {rule_id, version, reason}`. No admin token and no token input anywhere. The recall control says "Demo sandbox: your recall affects only your session." and works only on receipts whose status list is this tab's (`/status/demo-<sid>`); an official receipt or another session's receipt gets an explanation instead of a button. A successful recall clears saved plans so the app rebuilds (the planner then abstains with `rule_recalled` or picks another rule). Sample mode still simulates the recall in the browser.
- **Story page** uses the official `POST /api/plan` (the server keeps one per day), so it never creates a sandbox. `ProveDemo` is still the sample receipt with a simulated recall.
- **Verifier.** One call, `GET /api/verify/{id}`, and only its `credential` is rendered (no `/api/credentials` fetch; the per-rule status bits in "How this was checked" were dropped with it, the receipt's own bit is read from the list the credential points at, same-origin `/status/<id>` only). It opens with "This receipt certifies the advice:" + `advice.title`, decision, light, plan window and "Weather data as of {data_as_of} ({data_mode})", with `sandbox` and `expired` badges. The word "correct" is not used anywhere in the UI copy (a unit test checks it).
- **Plans** show "Weather data as of ... (live | saved snapshot | sample)"; abstentions show `abstention.reason.en` as sent (plus a one-line gloss in the UI language when the text is English-only) and the new codes `rule_recalled`, `data_stale`.
- **Weather calendar** reads `GET /api/snapshots/{id}`: per-day `risk` (`high`/`low`/`unknown`) as a dot with a different shape per level, the selected day's risk in words, and `risk_basis` as small print. A live plan never borrows the bundled sample forecast.
- **Officer inbox** in live mode reads `GET /api/demo/{sid}/inbox` (items + `details`, `diagnosis_id`, `top_labels`); resolving a case is saved in this browser only (the sandbox has no resolve endpoint). Sample cases show only when the API is unreachable or `?sample=1`.
- **Stats** (`GET /api/demo/{sid}/stats`, else `GET /api/stats`) on the verifier entry page; none in sample mode (no invented counters). **Packs** (`GET /api/packs`) label the pack behind the photo card and the Kenya pack card; signatures read "planned".
- **Photo to plan.** The diagnosis (no `ood_score`, which is optional now and v0 has no OOD head) goes with the plan request; sample readings are never sent. The server decides: `diagnosis_used` true and a receipt cites it -> that decision; used but no rule uses it -> "passed the gate, plan unchanged"; false -> "Photo check sent to your officer (reason)" per `diagnosis_note` (`uncalibrated`, `low_confidence`, `out_of_distribution`, `model_abstained`), with a link to the case found in the session inbox; no answer -> "could not tell if it was used". The photo is never implied to have driven a decision unless the server says so and a receipt cites it. Today the model card is `calibrated: false`, so every real reading ends in "model not calibrated yet".

**Bangla.** `src/lib/i18n/bn.ts` has every key (typed `Record<Key, string>`, so a new English key fails the build until translated), short plain sentences, product names kept. Header: "Machine-written; pending native-speaker review". Words to settle with a reviewer: বাতিল (Recalled), খাঁটি (Authentic), রসিদ (receipt), কৃষি সম্প্রসারণ অফিসার. `i18n.test.ts` checks key coverage, placeholders and the "correct" rule. Data values that come from the API (the advice title, `poor` drainage, model labels) stay as sent.

**Tests.** `npm test` (vitest, 29+ tests) and `npm run test:e2e` (Playwright, Chrome channel, mocked API in `tests/e2e/mockApi.ts`, no backend): landing, farmer app, verifier (certifies, sandbox, recall, unknown id), officer, and Bangla at 390 px (no horizontal scroll). `SCREENS=1 npx playwright test screens` retakes `farmer-{top,full}-{en,bn}-{390,1440}.png` and `verify-{authentic,recalled}-{en,bn}-{390,1440}.png` into `docs/design/screens/` from the mocked API (the older untagged screenshots are from Oct 27 sample mode).

**Still mocked or open.** Screenshots and e2e use a mocked API (the backend was not running). Not exercised against the real backend: the sandbox calls end to end. The photo-to-plan "not used" path was covered only by the mock. `ProveDemo` (landing) is simulated. `hi.ts`/`sw.ts` lack the Oct 28 keys. Money impact (#3), model registry and signed diagnosis receipts (#7e/f) remain open on the backend.
