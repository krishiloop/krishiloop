---
name: KrishiLoop
direction: field night (editorial, dark-first)
dials: {home: {variance: 7, motion: 7, density: 3}, app-screens: {variance: 3, motion: 3, density: 7}}
colors:
  dark (default):
    paper: "#0A0B09"   # page: warm near-black soil, never pure black
    sunk: "#060705"
    card: "#121410"
    ink: "#ECEAE2"     # bone-white text
    ink-2: "#B4B3A9"
    ink-3: "#8B8B81"   # AA on paper and card
    rule: "#23261F"    # hairlines
    rule-2: "#383C32"
  light ("paper", data-theme=light): warm paper #F2F0E8, ink #121310
  accent:
    sprout: "#C2EF6A"  # the ONE accent: a rice shoot. Fill with sprout-ink #0D1406 text
  meaning:
    go: "#A9E06B"      # authentic, safe decision
    wait: "#F2B544"    # not sure, re-check, officer
    stop: "#FF7A57"    # recalled, stop
    ember: "#FF6A3D"   # the recall moment (rings, flips)
    carbon: "#9FB0FF"  # sample / recorded / replay data (always with a dashed chip)
typography:
  sans: Geist (variable, self-hosted, preloaded)
  mono: Geist Mono (labels, ids, numbers, receipt lines)
  serif: Instrument Serif italic (one accent phrase per heading)
  bangla: Anek Bangla (line-height 1.75); hindi: Anek Devanagari
  display: "clamp(3.3rem, 0.9rem + 8.6vw, 9.4rem), tracking -0.055em, leading 0.9"
radius: {doc: 3, ui: 12, frame: 22, pill: 999, sheet: "clamp(26px, 4vw, 52px)"}
elevation: hairlines; one soft shadow for floating things; film grain over everything
motion:
  ease: quint-out cubic-bezier(.22,1,.36,1); expo-out (.16,1,.3,1) for masked reveals
  press: scale .97, 160 ms
  ui: 150-250 ms (popovers, tabs); no animation on keyboard tools (Ctrl K palette)
  home: 0.9-1.3 s masked word rises, 70 ms stagger; loops on one clock; scroll-linked transforms
  reduced-motion: no travel or loops; short fades only
---

# KrishiLoop design system: "Field Night"

**Feeling:** a field at dusk. Warm near-black, bone-white type, hairlines, one living accent. Calm, exact, premium: an annual report you can scan, not a crypto app and not a chatbot. The receipt is the one physical object: it stays **paper** in both themes (`.paper-object`).

## Rules
- **Colour is reserved for meaning.**
  - Surfaces are soil-black or paper.
  - **Sprout** marks the primary action and the moment something checks out.
  - **Ember** marks a recall.
  - Go, wait and stop are verdicts and decisions, always with an icon and a word.
  - Carbon (dashed) marks sample, recorded or replay data.
- **Never colour alone.** Every state has an icon and a word.
- **Every visual carries data:** a real receipt, a real rule id, measured numbers. If a graphic could be swapped for a random glow, delete it.
- **Honesty is visible:** synthetic, recorded, replay and simulation labels sit on the thing they label.
- **Not text-heavy.** One idea per section: a label, a big title and at most one line, then the artifact.
- **Hairlines instead of shadows.**
  - **Glass** is only for floating UI (the nav pill, the Ctrl K palette, a toast).
  - **Spotlight cards** (`.surface` with `spotlight()`) for content.

## The kit (`src/ui/kit/`, `src/styles/kit.css`)

**Components**

| Component | What it does | Source |
|---|---|---|
| `SplitWords` | masked word rise for display headlines | CSS |
| `WordCycler` | one phrase at a time | Motion |
| `Magnetic` | the CTA leans toward the mouse | React Bits Magnet, rebuilt |
| `NumberTicker` | counts up once in view, writes the text node, final value for screen readers | Magic UI |
| `AnimatedBeam` | a light along a real path between two elements | Magic UI |
| `BorderBeam` | a light running round a card | Magic UI, CSS offset-path |
| `Marquee` | an endless row | Magic UI, CSS |
| `FlickeringGrid` | canvas, about 12 fps, only on screen | Magic UI |
| `CommandPalette` | Ctrl K | — |
| `SmoothScroll` | Lenis, story pages only, never in app screens | — |
| `LoopMark` / `Wordmark` | the brand mark | — |

**Hooks**
- `useOnScreen`: set `data-offscreen` on a section and every CSS loop inside pauses.
- `useSeenOnce`: plays something once, the first time it comes into view.
- `spotlight()`: the pointer light on `.surface` cards.

**Classes**

| Kind | Classes |
|---|---|
| Surfaces | `.surface`, `.glass`, `.sheet-band` |
| Textures | `.bg-grid`, `.bg-dots` |
| Headline type | `.text-sheen`, `.serif-i`, `.label` |
| Live dot | `.ping` |
| Motion | `.spin-slow`, `.press` |
| Display sizes | `.t-display`, `.t-hero`, `.t-title`, `.t-head`, `.t-lead` |

**Existing primitives restyled** (`ui.css`):
- pill `.btn` (`btn-primary` is sprout);
- pill `.chip`;
- `.stamp`, `.paper`, `.panel`;
- `ReceiptCard`, `Stamp`, `Segmented`, `Tabs`, `Sheet`, `Toast`, `DataMark`.

## Pages
| Kind | Pages | Dials |
|---|---|---|
| Story pages | home `/`, `/receipt` | variance 7, motion 7, density 3; Lenis on |
| App screens | `/app`, `/officer`, `/verify`, `/trust`, `/proof`, `/about` | variance 3, motion 3, density 7; Motion only for UI state (tabs, sheets, verdicts) |

## Motion rules (Emil Kowalski's framework)
- **Animate only transform and opacity;** clip-path and stroke-dashoffset only for small SVGs.
- **Easing:** ease-out for entering, ease-in-out for moving, linear only for loops.
- **Frequency decides duration.** Things seen 100 times a day (keyboard tools, list navigation) get no animation. Occasional things (sheets, verdicts) get 200–300 ms. Explanatory story motion may be longer.
- **Entrances:** never from `scale(0)`; start at 0.9–0.95 with opacity.
- **Hover:** gate it behind `(hover: hover) and (pointer: fine)`.
- **Loops pause off-screen** (`data-offscreen`) and under reduced motion.
- **No WebGL or 3D:** it lagged and added nothing. Depth comes from parallax layers and light.

## Don'ts
- No purple or blue AI gradients, neon glows, robots, brains or decorative 3D.
- No glassmorphism under body text.
- No number on screen that is not measured or sourced; synthetic and replay results say so next to the number.
- No em dashes in UI copy.
- Never say a receipt is "correct": it is Authentic, Recalled or Cannot verify.

## Third-party patterns
Rebuilt in our own code under their licences:
- Magic UI (MIT): NumberTicker, AnimatedBeam, BorderBeam, Marquee, FlickeringGrid, bento grid; for the app screens AnimatedList (officer inbox and photo cases), Terminal (/proof) and a Motion-free NumberTicker (`CountUp`, `CountText`); HyperText (ids and hashes resolving on /verify), an iPhone mockup in CSS (`IphoneFrame`, /app) and a one-shot AnimatedBeam (`SignalBeam`, phone to rail on /app).
- Aceternity (free licence, no resale as a library): Timeline with a scroll-traced line (/about); Tracing Beam, driven by state (`TracingBeam`, "behind the tap" on /app).
- React Bits (MIT + Commons Clause): Magnet, CountUp, ClickSpark (only on the farmer phone's Ask send and mic buttons).
- Emil Kowalski's hold-to-confirm (clip-path fill, 200 ms snap back), rebuilt as `HoldButton` (the officer's recall).

Libraries:
- Motion (MIT);
- Lenis (MIT);
- Geist and Geist Mono (OFL);
- Instrument Serif (OFL);
- Anek (OFL).

The owner's own projects (TakaResolve UVERA, ShadowAstra Atlas, ABRUBAB.github.io) set the house style: dials, hairlines, the glass nav pill, split-word display type and one accent.
