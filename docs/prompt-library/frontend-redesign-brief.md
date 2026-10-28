# Frontend redesign brief (prompt library #11)

Two prompts:

- **A** is the team lead's request, word for word.
- **B** is the optimised prompt Claude wrote from A, then followed itself.

Keep both. The portal's "Prompt Library" asks for prompts we really used, and this one rebuilt the whole web app.

---

## A. The original request (Oct 28, 2026, verbatim)

> the frontend is complete trash. we need a absolute ubdate. plz use your skills, and design. and plz i need the best ever ui/ux. it looks like an AI slop now. we have already builed many many amazing websites. but this needs to be better then everyone. plz solve the problem. you have used 3d animation that looks so bad and u=makes my website very very laggy. you need to completely redo. i dont see any features we talked about. did you completely foggot about a=our full plan?. this is a joke currently. plz i need the best one. how about you first optimize my prompt , then prompt yourself.

---

## B. The optimised prompt

### Role
You are the principal product designer and design engineer for KrishiLoop. You own taste, structure and code quality. Rebuild the web front end in `apps/web` from the ground up. Keep the data layer; replace everything people see.

### The product, in one sentence (use it verbatim; it is the pitch)
> **Every piece of AI farm advice comes with a receipt anyone can check — and if a rule turns out wrong, we recall it from every farmer who got it.**

### Why the current site fails (fix every point)
1. **It is slow.** The three.js/R3F rice scene, the chapter shaders and GSAP + Lenis smooth scroll make the page lag. A headless screenshot of the live home page timed out.
2. **It reads like a document, not a product.** It has walls of text, the same source block printed three times, and an "Implemented/Planned" chip on almost every line.
3. **It hides the product.** The built features are buried or labelled "planned" although they ship today:
   - the Ask router;
   - the Bangladesh rice pack;
   - photo cases with earned trust;
   - the officer verdict;
   - the MCP servers;
   - per-visitor sandboxes.

   A judge cannot find them.
4. **It looks generated:**
   - a dark background with a gold serif-italic accent;
   - grain and glows;
   - chapter shaders;
   - counters that render **"0 million+"** until an animation runs.

   It has no idea of its own.
5. **It is out of date:** it says "zero engine diff is not shown yet" although the BD pack commit changed 0 engine lines.

### Who it serves, and what each must manage in under a minute
| Person | Device | Job | Success |
|---|---|---|---|
| **Judge** (technical and non-technical) | laptop or projector, 3–5 min | understand the idea, see it work, find proof | says the sentence back; scanned or opened a receipt; saw a recall |
| **Farmer** | cheap Android, sunlight, Bangla, low literacy | know what to do this week, and trust it | one clear decision, one tap to its receipt, voice in and out |
| **Officer** | laptop or tablet | clear the inbox, confirm photos, recall a bad rule | case → verdict in 3 taps; recall shows exactly who is affected |
| **Anyone with the QR** | any phone camera | is this real? | a verdict in 1 second: Authentic, Recalled or Cannot verify |

### Design direction: "Field Receipt"
The product's own object is the design: **paper, ink and rubber stamps.**
- **Surfaces:** warm paper, ink-black type, hairline rules.
- **Data:** mono receipt lines, QR codes, perforated edges.
- **Verdicts:** stamps that *land*.

It doesn't look like any dark AI template. Light paper is also the honest choice for farmers: high contrast in sunlight. A full dark theme ("Lantern") exists for officers at night and for anyone who prefers it.

**Colour is reserved for meaning:**
- **Brand and controls** are ink on paper.
- **Green** means the decision is "no input needed", or the receipt is **Authentic**.
- **Turmeric** means re-check.
- **Vermilion** means act now, or **Recalled**.
- **Carbon-copy blue** marks **sample or recorded data**, everywhere, the same way.

**Tokens** (write them to `apps/web/DESIGN.md` and the CSS `@theme`):

| Token | Light (Paper) | Dark (Lantern) |
|---|---|---|
| paper / sunk / card | `#F4F0E6` / `#ECE6D8` / `#FCFAF4` | `#121110` / `#0B0A09` / `#1B1A17` |
| ink / ink-2 / ink-3 | `#1B1A16` / `#4A463E` / `#6B675D` | `#F0EADC` / `#C4BDAE` / `#9A9385` |
| rule / rule-2 | `#DAD2C1` / `#C2B8A3` | `#2E2B25` / `#423E35` |
| go (Authentic, no input needed) | `#1E6B45` | `#6CC596` |
| wait (re-check) | text `#8F5600`, fill `#E9A825` | `#F0B54A` |
| stop (act, Recalled) | `#C2361D` | `#FF7A5C` |
| carbon (sample/recorded) | `#3646A6` | `#9AA8FF` |

Every text/background pair is AA or better, checked with `npm run contrast`.

**Type: one family across scripts.** "Any language" becomes visible as one typeface family across three scripts:
- **Anek Latin, Anek Bangla and Anek Devanagari:** variable, with a width axis, from Ek Type, all OFL.
  - Display text is set condensed and heavy (`wdth` ≈ 85, `wght` 650).
  - Body text is set normal (`wdth` 100, `wght` 400).
- **Newsreader / Tiro Bangla:** *only* for verbatim source quotes, so a quote looks like the manual it came from.
- **JetBrains Mono:** receipt lines, ids, rule versions and data.

Bangla gets a larger line-height (1.75) and a slightly larger size. Font files load by `unicode-range`, so English readers never download Bangla. Only one font is preloaded.

**Shape:**
- Documents (receipts, quotes, rules) have 3 px corners and a single "paper lift" shadow.
- Controls have 10 px corners and are 44 px tall at minimum (48 px in the farmer app).
- Use hairlines, not shadows, for structure. Nothing is nested more than two levels deep.

**Motion: purposeful, physical, cheap:**
- **Curves:** `--ease-out: cubic-bezier(.23,1,.32,1)` for entering, `--ease-in-out: cubic-bezier(.77,0,.175,1)` for moving, `--ease-drawer: cubic-bezier(.32,.72,0,1)` for sheets.
- **Durations:**
  - UI 140–220 ms;
  - sheets 280–320 ms;
  - section reveals 600 ms with a 60 ms stagger;
  - a stamp lands with a spring (duration 0.45 s, bounce 0.25).
- **Only `transform` and `opacity`.** No animated filters, shadows or backdrop blur. Nothing runs on scroll on the main thread; use IntersectionObserver or CSS. Exits are faster than entrances. Nothing animates on keyboard actions.
- **Reduced motion:** no movement, only short fades. Every loop longer than 5 s gets a pause control.

**Signature moments** (the only "wow"; each explains something):
1. **The receipt prints** out of the decision card. This is advice turning into evidence.
2. **The stamp lands:** AUTHENTIC in green. On recall, a vermilion RECALLED stamp lands over it. This is the pitch's key moment.
3. **The recall reaches everyone:** a grid of receipts flips to Recalled in a ripple outward from the withdrawn rule. "Every farmer who got it" becomes visible.
4. **The gate opens:** the trust line crosses 0.85, and the area switches from "officer confirms" to "answers itself". Trust is earned, not assumed.
5. **The loop draws itself:** SEE → DECIDE → SPEAK → PROVE → LEARN, with stroke-dash on a single SVG. The brand is the method.
6. **Numbers roll into place:** digit columns slide; the final number is always in the DOM. It never renders "0".

### Banned (each of these is what makes it look generated)
- **Visual effects:**
  - three.js / R3F / WebGL / shaders;
  - smooth-scroll hijacking (Lenis) and GSAP pinning;
  - a custom cursor;
  - gradient blobs, glow, glassmorphism, neon;
  - purple-blue gradients;
  - serif-italic "accent words" in headings.
- **Content and styling:**
  - emoji as icons;
  - stock or AI-generated images;
  - cards inside cards;
  - badge soup (at most one status label per item);
  - all-caps paragraphs (caps only for mono micro-labels);
  - the same content twice on a page;
  - paragraphs over two sentences on story pages (details live on `/proof`).
- **Quality:**
  - dead buttons;
  - console errors;
  - layout shift;
  - unlabelled sample data;
  - any number not from a VERIFIED fact row or our own real output.

### Information architecture
Top bar: logo · Story `/` · Farmer app `/app` · Officer `/officer` · Verify `/verify` · Trust `/trust` · Proof `/proof` · language · theme. On a phone it collapses to a menu sheet. Inside the farmer app on a phone, the app's own header and bottom tabs replace the site bar.

**`/` Story** (scannable in 90 s; every section is one idea and one visual):
1. **Hero:**
   - the sentence (H1 + sub) and two actions, "Try the farmer app" and "Check a receipt";
   - the hero object: a real receipt (DOM text, not an image) that prints, gets an AUTHENTIC stamp, and has a "Recall this rule" toggle that lands RECALLED. Sample-labelled.
2. **The problem:** three verified numbers, big, with footnoted sources. Bangladesh's advice gap is shown side by side, never as a ratio.
3. **"We asked four chatbots"** (dark band): the Bangla question, four verdict chips, and the one-line result. Then the KrishiLoop contrast: a receipt or an honest "not sure → officer". Dated, labelled "an anecdote, not a benchmark".
4. **The loop** (sticky stage + five short steps). Each step shows the real artifact:
   - SEE: weather snapshot with source and time;
   - DECIDE: a rule as code with its verbatim quote and page;
   - SPEAK: a Bangla question, by voice or text, routed to one rule;
   - PROVE: the receipt + QR + stamp;
   - LEARN: recall, and photo trust earned per area.
5. **Recall, live:** the ripple grid. The visitor chooses a rule, presses Recall, and sees N receipts turn Recalled while every other receipt stays Authentic. Labelled "simulation in your browser"; it links to the real recall in `/officer`.
6. **Photos earn trust one area at a time:** a mini replay chart from the **real** replay (`ml/vision/artifacts/area_trust_replay.json`, bundled). It shows confirmations until the gate opened, the automatic share and the precision. Links to `/trust`.
7. **One engine, two countries:**
   - BD rice (Bangla, BRRI quotes) and Kenya potato late blight (English, CIP quotes) side by side;
   - the real command `git diff f90f5a0 c8a0fa2 -- services tools contracts` → *0 lines*.
8. **Under the hood** (technical judges):
   - an architecture strip;
   - standards (VC 2.0, eddsa-jcs-2022, Bitstring Status List, did:web);
   - the LangGraph Ask router, BioCLIP 2, Open-Meteo, 5 MCP servers / 14 tools;
   - test counts.
   Each item links to `/proof`.
9. **Honest status:** what works today, what is next. One list, current.
10. **End:** "Scan one receipt." + links + the Congress credit.

**`/app` Farmer app** (mobile-first; on wide screens a **"glass-box demo"**):
- **Left rail:**
  - a field picker (BD rice Savar · BD rice Gazipur · Kenya potato sample point);
  - a data-mode badge (Live / Recorded / Sample);
  - a **"What to try" checklist** that ticks itself: open the receipt, ask a question, send a photo, verify, recall from the officer console.
- **Centre:** the app at phone width.
- **Right rail:** a live **inspector**. Each action logs what really happened: rule id and version, data source and time, signature suite, receipt id, gate decision.
- **Tabs:**
  - **Today:** the decision card (pictogram, decision, when to re-check, money impact if present), the 7-day weather and risk strip, at most 2 other actions, "Why?" (rule, quote, data in plain words), and the abstained state ("we're not sure; your officer has it").
  - **Ask:** voice (consent first) or text; the answer is one sourced rule with a receipt, or an abstention to the officer.
  - **Photo:** consent → server reading → the officer confirms, or an automatic answer only where the area has earned trust.
  - **Receipts:** history, with live status; a recalled receipt says so and why.
- **Receipt sheet:** a boarding-pass receipt with QR, read aloud, and a link to verify.

**`/officer` Officer console** (desktop-first; calm and dense):
- **Inbox:** abstentions, unanswered questions, photo cases. Filters + list + detail + a verdict in 3 taps.
- **Rules & recall:** rule, version, review level, receipts issued. Recall → confirm → "N receipts now verify as Recalled" with the list.
- **Area trust:** meters per crop@area with the gate state and events.
- Sandbox note: "your recall only changes your own demo receipts".

**`/verify`, `/verify/:id`:**
- A full-bleed verdict stamp: Authentic, Recalled or Cannot verify. One line on what it means ("issued by KrishiLoop and unaltered, not 'correct'"). Expired and sandbox are shown as notes.
- Then the receipt as a document: advice; quotes with page; data with source and time; rule, version and review level; "numbers a person set" flagged *not from the source*; confidence; the signature (issuer DID, suite, status list); and a timeline (issued → recalled).
- Without an id: paste or scan, plus "try a sample receipt".

**`/trust`:** the earned-trust method in plain words, the real replay chart with its gate events, live area meters, and its limits (labelled: "dataset labels stand in for officers").

**`/proof`:**
- the architecture;
- the evaluation results (vision v1/v2, Ask acc@1 0.89 *synthetic*, earned-trust protocol 2);
- the standards map;
- MCP tools;
- test suites and CI;
- data and licence register;
- model cards;
- the prompt library.

Each item has a link and an implemented or planned mark.

### Data honesty (non-negotiable)
- **Live API** when reachable.
- Otherwise, **recorded real outputs**:
  - plans, receipts, verify responses and Ask answers, captured from our own local API on a stated date;
  - labelled with the carbon stamp **"Recorded · 28 Oct"**.
- Otherwise, **simulation** (clearly labelled), only for the home-page explainers.
- User-facing facts come only from VERIFIED rows of `research/fact_register*.md`.
- "Authentic" never means "correct".
- No farmer PII, anywhere.

### Engineering constraints
- **Keep:**
  - React 19, Vite, TypeScript, Tailwind v4, react-router;
  - `src/lib/api/*`, `src/lib/i18n/*`, the stores;
  - the logic modules and their unit tests (`trust/gate.ts`, `trust/replay.ts`, photo `downscale.ts`, …).
- **Remove:** three, @react-three/*, postprocessing, gsap, @gsap/react, lenis, @paper-design/shaders-react, the Geist and Instrument Serif fonts. `motion` is used through `LazyMotion` + `m` for presence and layout only.
- **Budgets:**
  - JS per route ≤ 100 KB gzip (the home page ≤ 90 KB) before fonts;
  - Lighthouse mobile: Performance ≥ 90, Accessibility 100, Best Practices 100;
  - LCP < 2.0 s, CLS < 0.05, INP < 200 ms;
  - 60 fps on a mid laptop and ≥ 30 fps on a 4× CPU-throttled phone profile.
- **Accessibility:**
  - WCAG 2.2 AA; meaning never carried by colour alone (stamp word + icon);
  - a full keyboard path and visible focus;
  - `aria-live` for verdicts;
  - axe shows 0 serious issues;
  - touch targets ≥ 44 px.
- **i18n:**
  - every string goes through `t()`;
  - English and Bangla complete;
  - Hindi and Swahili for the farmer app and the verifier, labelled "machine-translated preview";
  - new Bangla strings flagged for native review.

### Process (do it in this order; look at your own work)
1. Write `DESIGN.md` (tokens, rules, don'ts) and build the primitives and the shell. No page work before tokens exist.
2. Build the real content and layout, mobile-first, with no motion.
3. Add motion: the six signature moments only, each with a written purpose.
4. Run the review loop:
   - screenshots at 375 / 768 / 1440, light + dark + reduced motion;
   - fix every P1;
   - run `break-ui` on the receipt and the inbox (long Bangla, missing fields, huge counts).
5. Pass the gates:
   - `npm run check`;
   - the e2e suite (rewritten for the new UI) + axe;
   - `npm run contrast`;
   - `npm run size`;
   - Lighthouse.
6. Deploy to krishiloop.vercel.app (sample mode until the Azure API exists), check the deploy, then show the owner.

### Done means
- [ ] A first-time judge can say the sentence back after the hero alone.
- [ ] Every built feature in the inventory has a visible, working place, and planned items are only in Status/Proof.
- [ ] No WebGL; the home page scrolls at 60 fps; screenshots never time out.
- [ ] Every number is real or labelled; nothing renders "0" while it animates.
- [ ] Light and dark both look intentional, at 375 and 1440.
- [ ] Tests, axe, contrast and the size budget are green; the deploy is checked.
