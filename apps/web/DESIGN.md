---
name: KrishiLoop
direction: field guide (the owner's KrishiGuard AI deck): cream pages, forest bands, Fraunces headlines
dials: {home: {variance: 7, motion: 6, density: 4}, app-screens: {variance: 4, motion: 4, density: 7}}
colors (exact values from the KrishiGuard AI pptx):
  cream (light, the DEFAULT):
    paper: "#F3EEE2"   # the deck's cream page
    card: "#FFFDF8"    # cream card (paper objects #FBF8F1)
    rule: "#DCD3BF"    # thin lines (paper objects #E6DECB)
    ink: "#14261C"     # forest ink
    ink-2: "#46524A"   # slate text
    ink-3: "#5A645C"   # slate, a shade darker than the deck's #5E675F so it passes AA on every cream surface
    eyebrow: "#8A5A0E" # gold-brown, uppercase, letter-spaced
  forest (dark, and every forest band):
    paper: "#14261C"   # forest
    sunk: "#0E2419"    # deepest (the band inside a forest page)
    card: "#173A29"    # dark card
    ink: "#F3EEE2"; ink-2: "#C9D3C8"; ink-3: "#A3B2A6"; sage: "#B7C6B6"
    eyebrow: "#E2A93B" # mustard on forest
  action:
    accent: "#E2A93B"       # mustard: the primary button (forest ink on it), highlights, numbers
    accent-soft: "#F3DDA8"  # soft mustard: pills and washes
  the photo gate (deck slide 6, fills with forest ink):
    very-sure: "#E2A93B"; not-sure: "#A8D1DF"; new-or-risky: "#EF9E80"
  meaning (always with an icon and a word): go, wait, stop, ember (recall), carbon (dashed, sample data)
typography:
  display: Fraunces (variable, opsz 9-144, self-hosted, preloaded): headlines, the wordmark, big numbers (.figure)
  sans: Inter (variable, self-hosted, preloaded): everything you read or tap; eyebrows in Inter 650 caps, 0.15em
  bangla: Hind Siliguri 400/600/700 (self-hosted, unicode-range: loads only when Bangla appears)
  mono: Geist Mono (ids, hashes, receipt lines)
  fallbacks: size-adjusted Arial / Georgia / Nirmala UI (measured with fontTools), so the swap moves nothing (CLS 0)
radius: {doc: 3, ui: 12, frame: 22, pill: 999, sheet: "clamp(24px, 3.4vw, 44px)", drawer: 28}
art: the deck's own line art (public/art/*.webp, 6-185 KB): field lines and a gold ring (hero), a mustard-flower branch
  (page tops), a leaf corner (forest page heroes), a rice plant (footer), the leaf with gold detection corners (the phone)
motion: expo-out (.16,1,.3,1) for reveals and sheets; quint-out for UI; reduced motion: short fades only
---

# KrishiLoop design system: "Field Guide"

**Source:** the owner's own KrishiGuard AI deck (6 slides). The site takes its palette, fonts, layout language and line
art from it, so the deck and the product read as one thing.

**Layout language**
- Forest-green bands alternate with cream sections (home: forest hero, cream product, forest "who it is for", cream
  system, forest "we asked AI first", cream measures, forest footer). `.band-night` is the forest band (in the dark
  theme it becomes the deepest green, so bands still alternate). `.kg-pagehero` opens a page as a forest band that runs
  up under the floating nav (/receipt, /trust, /proof).
- Gold-brown, uppercase, letter-spaced eyebrows (`.eyebrow`, `.label`); Fraunces headlines (`.t-*`).
- Cream cards with thin lines (`.surface`); dark rounded icon tiles with gold line icons (`.icon-tile`).
- Numbered 01 / 02 / 03 columns with a rule above (`.num-cols`, the hero's three problems, the product plates).
- Thin botanical line art as quiet decoration (`.botanic`, `.page-dawn`), never under text that must be read.

**Home, in the deck's order:** the hero (the Bangla name over a Fraunces wordmark, the promise "a crop doctor, farm
adviser and weather warning in every farmer's pocket, in Bangla", three numbered problems, a phone showing the leaf with
gold detection corners and the gate's answer, two glass alerts; all labelled Illustration), then the product: 01 Crop
Guardian (teacher-student, offline, the three-way gate with measured shares, the "where it looked" map), 02 Climate
Shield, 03 village disease radar, 04 precision savings, 05 Bangla voice and basic phones, 06 the officer and human
expert, 07 trust: the receipt anyone can check, and recall. The receipt print demo lives on /receipt and lower on home.

**Facts:** only VERIFIED rows of the fact register, with the row id in a code comment next to the number (A2 44.74% of
jobs in farming, A3 16.88M households, GL-14 Savary losses). The deck's BBS "45%" and Mohanty lab/field pair are not
in the register, so they are not on the site.

## Rules
- **Colour is reserved for meaning.**
  - Surfaces are cream or forest.
  - **Mustard** marks the primary action (one per screen), highlights and big numbers.
  - The photo gate has its own three fills (very sure mustard, not sure light blue, new or risky salmon), always with
    the words.
  - **Sprout** marks the moment something checks out.
  - **Ember** marks a recall.
  - Go, wait and stop are verdicts and decisions, always with an icon and a word.
  - Carbon (dashed) marks sample, recorded or replay data.
- **Never colour alone.** Every state has an icon and a word.
- **Every visual carries data:** a real receipt, a real rule id, measured numbers. If a graphic could be swapped for a
  random glow, delete it.
- **Honesty is visible:** synthetic, recorded, replay and simulation labels sit on the thing they label.
- **Not text-heavy.** One idea per section: a label, a big title and at most one line, then the artifact.
- **Surfaces have jobs:**
  - **Glass** (`.glass`: blur 16 px, 1 px edge, layered inner light, a refracted rim) only for floating UI: the nav pill,
    the app's tab bar, drawers' handles, the Ctrl K palette, toasts, tags over imagery. Never under body text.
  - **Liquid pills** (`.btn-primary`, `LiquidButton`) for actions: ambient glow, a refracted top highlight, a wave fill
    on hover.
  - **Neu-depth** (`.neu`, `.neu-raised`, `.seg`) only for tactile controls: segmented controls, toggles, steppers.
  - **Spotlight cards** (`.surface` with `spotlight()`) for content.
  - **Paper** (`.paper-object`) for receipts and printed rules.

## The kit (`src/ui/kit/`, `src/styles/kit.css`)

### Added on 19 Nov (use these; P and R included)

| Component | API | What it does |
|---|---|---|
| `Drawer` | `<Drawer open onClose title subtitle? steps?={string[]} step?={n} footer? side?='auto'\|'bottom' wide? testId?>{content of step}</Drawer>` | Slide-out panel (900 px and up) or bottom sheet (phones) on the native `<dialog>`: focus trap, Escape, focus return, backdrop click. Swipe down from the grip or header to close on phones. With 2+ `steps`: a progress bar, "Step n of m · name", and each step slides in from the side it came from. Children render only while open. Use it for any "Book", "Report", "Set up" flow. |
| `Comparer` | `<Comparer before={node} after={node} beforeLabel? afterLabel? label? initial?={50} onChange? className="aspect-[4/3]">` | Drag-to-compare two layers (the leaf photo and the model's "where it looked" map; a field before and after rain). The after layer is clipped at the handle (clip-path). Keyboard: the handle is a slider (arrows 2 %, Page Up/Down 10 %, Home/End). |
| `TiltCard` | `<TiltCard max?={7} glare?={true} as?='div'\|'article'\|'li'\|'figure' className>` | CSS perspective tilt toward the mouse with a soft glare. Off on touch, pen and reduced motion. No re-render per frame. |
| `LiquidButton`, `LiquidLink`, `LiquidAnchor` | `tone?='accent'\|'glass'\|'ink' size?='md'\|'lg' arrow? magnetic? icon?` plus button / `to` / `href` props | The house pill: glow, highlight, wave fill on hover. `magnetic` wraps it in `Magnetic`. One `accent` per screen. |
| `Skeleton`, `SkeletonBlock` | `<Skeleton className lines? round?>`; `<SkeletonBlock className>{placeholders}</SkeletonBlock>` | Shimmer placeholder in the shape of what is coming. `SkeletonBlock` adds `aria-busy` and one "Loading" for screen readers. The shimmer stops under reduced motion. The CSS class `.skeleton` (ui.css) shimmers too. |

Reveal helpers: `data-reveal` (one element, `--i` for a 70 ms stagger) and **`data-stagger`** on a container (its children
rise one after another, 80 ms apart). Both are driven by one IntersectionObserver (`lib/reveal.ts`).

### Existing (unchanged APIs)

| Component | What it does | Source |
|---|---|---|
| `SplitWords` | masked word rise for display headlines | CSS |
| `WordCycler` | one phrase at a time | Motion |
| `Magnetic` | the CTA leans toward the mouse | React Bits Magnet, rebuilt |
| `NumberTicker` | counts up once in view, final value for screen readers | Magic UI |
| `AnimatedBeam` | a light along a real path between two elements | Magic UI |
| `BorderBeam` | a light running round a card | Magic UI, CSS offset-path |
| `Marquee` | an endless row | Magic UI, CSS |
| `FlickeringGrid` | canvas, about 12 fps, only on screen | Magic UI |
| `HoldButton` | hold to confirm (the officer's recall) | Emil Kowalski |
| `CommandPalette` | Ctrl K | — |
| `SmoothScroll` | Lenis, story pages only, never in app screens | — |
| `LoopMark` / `Wordmark` | the brand mark | — |
| `IphoneFrame`, `SignalBeam`, `TracingBeam`, `Timeline`, `Terminal`, `AnimatedList`, `CountUp`, `CountText`, `HyperText`, `ClickSpark` | as before | Magic UI, Aceternity, React Bits |

**Hooks:** `useOnScreen` (sets `data-offscreen`, every CSS loop inside pauses), `useSeenOnce`, `spotlight()`.

**Classes**

| Kind | Classes |
|---|---|
| Surfaces | `.surface`, `.glass`, `.neu`, `.neu-raised`, `.sheet-band`, `.band-night`, `.paper-object` |
| Textures | `.bg-rows` (paddy rows from above), `.bg-dawn` (mustard and paddy light), `.bg-grid`, `.bg-dots` |
| Type | `.t-display`, `.t-hero`, `.t-title`, `.t-head`, `.t-lead`, `.serif-i`, `.text-sheen`, `.figure` (big numbers), `.label`, `.mono` |
| Live dot | `.ping` |
| Motion | `.spin-slow`, `.press`, `.liquid`, `.tilt` |

**Primitives** (`ui.css`): pill `.btn` (`btn-primary` is the liquid mustard pill), pill `.chip` (`chip-go`, `chip-wait`,
`chip-stop`, `chip-carbon`), `.stamp`, `.paper`, `.panel`, `.seg` (neu); `ReceiptCard`, `Stamp`, `Segmented`, `Tabs`,
`Sheet`, `Toast`, `DataMark`.

## Pages
| Kind | Pages | Dials |
|---|---|---|
| Story pages | home `/`, `/receipt` | variance 8, motion 7, density 3; Lenis on; editorial asymmetric layouts (overlapping hero cards, magazine grid, sticky sidebars, staggered collages) |
| App screens | `/app`, `/officer`, `/verify`, `/trust`, `/proof`, `/about` | variance 4, motion 4, density 7; Motion only for UI state (tabs, sheets, verdicts) |

Every inner page opens under the deck's mustard-flower branch and field lines (`.page-dawn`, added by `SiteLayout`).

| Page | Layout |
|---|---|
| `/` | The deck's order (see the top of this file): forest hero with the phone illustration and glass alerts, the product magazine with a sticky index (scroll-spy) and seven alternating plates, then the forest "who it is for" band (verified facts, bars drawn to scale, the ways to use it). |
| `/receipt`, `/trust`, `/proof` | Open with a forest band (`.kg-pagehero`) under the nav; /proof has a glass numbered table of contents. |
| `/officer`, `/verify`, `/about` | Cream, Fraunces titles and display figures, gold eyebrows, the field art at the top. |
| footer | A forest band with the deck's rice plant, the big sentence and the two actions (plain links in liquid pills: the shell never loads Motion). |

### The farmer app on a phone (`/app`)
- Full screen: `100dvh`, safe areas (notch, dynamic island, home bar) through `env(safe-area-inset-*)`.
- A forest app bar (the deck's dark band, rounded at the foot) holding the site strip, the field and the language; the
  content on cream cards.
- A floating glass tab bar (pill) in thumb reach, 60 px targets, a sliding lozenge with a mustard edge.
- Installable PWA (manifest: standalone, portrait, theme colour, maskable icons, shortcuts to /app, /verify, /officer).
- Connected to the website: the same account-less session (local storage), deep links to `/verify`, `/v/CODE` and
  `/officer`, and a "Website" link back in the app header.
- 1024 px and up: the phone frame with the "behind the tap" rails.

## Motion rules (Emil Kowalski's framework)
- **Animate only transform and opacity;** clip-path and stroke-dashoffset only for small SVGs and the Comparer.
- **Easing:** ease-out for entering, ease-in-out for moving, linear only for loops.
- **Frequency decides duration.** Things seen 100 times a day (keyboard tools, list navigation) get no animation.
  Occasional things (drawers, verdicts) get 200-340 ms. Explanatory story motion may be longer.
- **Entrances:** never from `scale(0)`; start at 0.9-0.95 with opacity.
- **Hover:** gate it behind `(hover: hover) and (pointer: fine)`.
- **Loops pause off-screen** (`data-offscreen`) and under reduced motion.
- **No WebGL:** it lagged and added nothing. CSS 3D tilt is fine. Depth comes from parallax layers, glass and light.

## Performance
- Fonts: two preloads (Inter latin 48 KB, Fraunces latin opsz 67 KB), `font-display: swap`, size-adjusted fallbacks.
  Fraunces italic (81 KB), Inter latin-ext and Hind Siliguri (about 72 KB per weight) load on use (unicode-range).
- Art: webp, 6 KB to 185 KB; the hero art has a 1024 px and a 1700 px file (`srcset`).
- Images: webp or avif, none over 200 KB, `<picture>`/`srcset` where a phone would get a big one.
- Size ceilings: `npm run size` (scripts/bundle-size.mjs). Raise one only with the reason written next to it.

## Don'ts
- No indigo-to-purple gradients, no cyan glow on slate, no neon, robots, brains or decorative 3D.
- No glass under body text.
- No number on screen that is not measured or sourced; synthetic and replay results say so next to the number.
- No em dashes in UI copy.
- Never say a receipt is "correct": it is Authentic, Recalled or Cannot verify.

## Third-party patterns
Rebuilt in our own code under their licences:
- Magic UI (MIT): NumberTicker, AnimatedBeam, BorderBeam, Marquee, FlickeringGrid, bento grid, AnimatedList,
  Terminal, CountUp/CountText, HyperText, an iPhone mockup in CSS (`IphoneFrame`), SignalBeam.
- Aceternity (free licence, no resale as a library): Timeline, Tracing Beam.
- React Bits (MIT + Commons Clause): Magnet, CountUp, ClickSpark.
- Emil Kowalski's hold-to-confirm (`HoldButton`) and drawer feel (`Drawer`: swipe velocity, resistance going up).

Libraries and fonts: Motion (MIT); Lenis (MIT); Fraunces (OFL); Inter (OFL); Hind Siliguri (OFL); Geist Mono (OFL);
Anek Devanagari (OFL); Tiro Bangla (OFL). Line art and the leaf illustration: the team's own KrishiGuard AI deck.

The owner's own projects (TakaResolve UVERA, ShadowAstra Atlas, ABRUBAB.github.io) set the house style: dials,
hairlines, the glass nav pill, split-word display type and one accent.
