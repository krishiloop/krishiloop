---
name: KrishiLoop web
direction: "Field Receipt" — paper, ink, rubber stamps
dials: { story: { variance: 7, motion: 6, density: 3 }, apps: { variance: 3, motion: 3, density: 7 } }
themes: [paper (default), lantern (dark)]
colors:
  paper:  { paper: "#F4F0E6", sunk: "#EBE5D6", card: "#FCFAF4", ink: "#1B1A16", ink-2: "#4A463E", ink-3: "#66625A", rule: "#DAD2C1", rule-2: "#C2B8A3" }
  lantern: { paper: "#121110", sunk: "#0C0B0A", card: "#1B1A17", ink: "#F0EADC", ink-2: "#C4BDAE", ink-3: "#9A9385", rule: "#2E2B25", rule-2: "#45403A" }
  meaning:
    go:     { paper: "#1E6B45", lantern: "#6CC596", means: "no input needed · Authentic" }
    wait:   { paper: "#8F5600", lantern: "#F0B54A", fill: "#E9A825", means: "re-check" }
    stop:   { paper: "#B9321A", lantern: "#FF7A5C", means: "act now · Recalled" }
    carbon: { paper: "#3646A6", lantern: "#9AA8FF", means: "sample, recorded or simulated data — always" }
typography:
  sans: "Anek Latin / Anek Bangla / Anek Devanagari (one family, three scripts)"
  serif: "Newsreader (Latin) / Tiro Bangla — verbatim source quotes ONLY"
  mono: "JetBrains Mono — receipt lines, ids, versions, data"
  display: { stretch: "82%", weight: 640, tracking: "-0.022em", leading: 0.95 }
shape: { doc: 3px, ui: 10px, frame: 18px, control-min: 44px, farmer-control-min: 48px }
motion:
  ease-out: "cubic-bezier(.23,1,.32,1)"
  ease-in-out: "cubic-bezier(.77,0,.175,1)"
  ease-drawer: "cubic-bezier(.32,.72,0,1)"
  durations: { press: 140ms, ui: 200ms, sheet: 300ms, reveal: 600ms, stagger: 60ms }
  stamp: "spring, 0.45s, bounce 0.25"
---

# KrishiLoop design system

The product's own object is the design: **a receipt.** Warm paper, ink type, hairline rules, mono receipt lines, QR codes and stamps that land. It must look like nothing generated, run smoothly on a cheap Android phone, and stay readable in sunlight.

The source prompt is `docs/prompt-library/frontend-redesign-brief.md`. This file is the contract every screen follows.

## Rules
1. **Colour means something, or it is ink.**
   - Brand, buttons and links are ink on paper.
   - Green means "no input needed" or Authentic. Turmeric means re-check. Vermilion means act now or Recalled.
   - Carbon-copy blue marks **sample, recorded or simulated** data, everywhere, the same way (`<DataMark>`).
   - Colour is never the only signal: a word and an icon go with it.
2. **Documents look like documents.** Receipts, rules and quotes are paper objects:
   - 3 px corners, the `--shadow-lift` shadow and a hairline;
   - mono for data, the serif only for verbatim source quotes;
   - in the dark theme, a receipt stays paper (a receipt under a lantern: `.paper-object`).
3. **Hairlines, not boxes.** Structure comes from rules and spacing.
   - Nothing is nested more than two levels deep: no cards inside cards.
   - Each item carries at most one status label.
4. **Every visual carries data.** If a graphic could be swapped for a random shape without losing meaning, delete it.
   - Charts use real numbers.
   - Illustrations are pictograms of a decision, never decoration.
5. **Short words, big type.** On story pages:
   - a heading is followed by at most two sentences;
   - details live on `/proof` or behind "Show more".
6. **Honesty is visible:**
   - live data shows its source and time (`<DataAsOf>`);
   - sample, recorded and simulated data carry the carbon mark;
   - "Authentic" never means "correct".

## Motion
**Animate only `transform` and `opacity`.** These are banned:
- animated filters, shadows, backdrop blur and layout properties;
- scroll handlers on the main thread (use IntersectionObserver or CSS);
- infinite loops;
- motion on keyboard actions.

| Moment | What it explains | Spec |
|---|---|---|
| Receipt prints | advice becomes evidence | translateY −100% → 0 in a paper slot, 900 ms, `linear()` with three feed pauses |
| Stamp lands | a verdict | scale 1.5 → 1, rotate −14° → −7°, opacity 0 → 1, 420 ms, overshoot curve; the paper nudges 1.5 px |
| Recall ripple | "every farmer who got it" | tiles flip to Recalled, ordered by distance from the source, 24 ms per ring, 200 ms each |
| Gate opens | trust is earned | the line draws (stroke-dashoffset) and the gate marker pops; one time only |
| Loop draws | the method | a single SVG path, stroke-dashoffset, 1.2 s, once |
| Number roll | real totals | the digit columns slide from 100% to 0; the final value is always in the DOM |
| UI | feedback | press `scale(.97)` 140 ms; sheets 300 ms `--ease-drawer`; reveals 600 ms + 60 ms stagger |

**Reduced motion:** no travel, only 150 ms fades; stamps and receipts appear in place.

## Layout
- **Containers:** `.wrap` (max 1240 px, gutters `clamp(16px, 4vw, 40px)`). Story sections use `.section` (block padding `clamp(72px, 10vw, 136px)`).
- **Breakpoints:** 640 / 768 / 1024 / 1280. Design at 375 first.
- **Touch targets:** at least 44 px (48 px in the farmer app). Tap areas never overlap.
- **Below-the-fold story sections:** `content-visibility: auto`.

## Type
| Role | Class | Notes |
|---|---|---|
| Hero | `.t-hero` | `clamp(2.9rem, 1.4rem + 6vw, 6.6rem)`, display settings |
| Section title | `.t-title` | `clamp(2.1rem, 1.3rem + 3.3vw, 4.1rem)` |
| Heading | `.t-head` | `clamp(1.4rem, 1.15rem + 1vw, 1.9rem)` |
| Lead | `.t-lead` | 1.25 rem / 1.5, ink-2 |
| Body | — | 1 rem / 1.6 (Bangla 1.75) |
| Label | `.eyebrow` | mono 12 px caps, tracking .08em |
| Quote | `.quote` | serif, verbatim only, with page + publisher |
| Data | `.mono` | tabular figures, slashed zero |

Bangla never gets negative tracking or condensed width. Display line-height is 1.2 or more.

## Components (`src/ui`)
- **Actions and labels:**
  - `Button`, `IconButton`, `LinkButton`;
  - `Chip` (one per item);
  - `DataMark` (carbon: sample / recorded / simulation);
  - `Stamp` (authentic / recalled / invalid / expired).
- **Documents:** `Paper` (document surface), `Receipt` (boarding-pass receipt with QR), `Quote` (source passage with page).
- **Decision and data:**
  - `DecisionCard` (traffic-light decision with a pictogram);
  - `WeatherStrip` (7 days);
  - `DataAsOf` (source and time);
  - `RollNumber`.
- **Containers:** `Sheet` (bottom sheet on phones, side sheet on desktop), `Tabs`, `Segmented`.
- **Feedback:** `Toast`.
- **Site:** `LangSwitch`, `ThemeToggle`, `Logo`, `Reveal`.

## Don'ts (each one is an "AI slop" tell)
- **Visual effects:**
  - WebGL, three.js, shaders;
  - smooth-scroll libraries, scroll-jacking;
  - a custom cursor;
  - gradient blobs, glows, glassmorphism, neon;
  - purple-blue gradients;
  - serif-italic accent words in headings.
- **Content and styling:**
  - emoji as icons;
  - stock or AI imagery;
  - badge soup;
  - all-caps paragraphs;
  - repeated blocks;
  - "Implemented/Planned" chips on every line (one status list instead).
- **Quality:**
  - counters that show 0 first;
  - dead buttons;
  - console errors;
  - layout shift.
