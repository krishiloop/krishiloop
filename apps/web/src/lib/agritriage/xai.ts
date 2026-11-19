/**
 * Real explainability in the browser: the same maths as services/vision/agritriage_xai.py (xai.fixture.json holds
 * fixed inputs and the Python answers; xai.test.ts checks this file against them). Pure: no DOM.
 *
 * - CAM (exact): model_xai.onnx outputs each 7 x 7 cell's share of every class's score (`xai_cam`) and the fixed part
 *   no cell owns (`xai_cam_bias`); the 49 shares plus the bias give back the score. We show the cells that pushed most.
 * - Attention: the stage-3 self-attention (one 7 x 7 window over the whole photo): how much attention each square
 *   receives, averaged over the 14 heads, the 49 asking squares and the 2 blocks. "Sink" squares that soak up more than
 *   4x a fair share in almost every photo are left out of the scale and marked.
 * - Lesion estimate (a colour rule, NOT the model): leaf = excess green (2G - R - B) above an Otsu threshold, holes
 *   filled; spots = brown, yellow or dark pixels inside it, cleaned with a 3 x 3 opening. Severity = spot / leaf area.
 */
export const GRID = 7;
export const EXG_MIN = 10;
export const EXG_MAX = 60;
export const DARK_V = 0.2;
export const BROWN_HUE = 42;
export const YELLOW_HUE = 64;
export const BROWN_S = 0.22;
export const YELLOW_S = 0.32;
export const BROWN_V = 0.2;
export const YELLOW_V = 0.4;
export const SINK = 4;
export const MIN_LEAF = 0.03;
export const KINDS = ['brown', 'yellow', 'dark'] as const;
export type Kind = (typeof KINDS)[number];
type Num = ArrayLike<number>;

/** CAM view: cells that pushed against the answer are 0; the rest run from the weakest push (0) to the strongest (1). */
export function camUnit(v: Num): number[] {
  const a = Array.from(v);
  if (!a.length) return [];
  const hi = Math.max(...a);
  if (hi <= 0) return a.map(() => 0);
  const lo = Math.max(0, Math.min(...a));
  if (hi <= lo) return a.map((x) => (x > 0 ? 1 : 0));
  return a.map((x) => Math.min(1, Math.max(0, (x - lo) / (hi - lo))));
}

/** The attention each square receives: mean over heads and asking squares (rows), then over blocks. Sums to 1. */
export function attentionReceived(blocks: Num[], heads: number, n: number): number[] {
  const acc = new Array<number>(n).fill(0);
  for (const A of blocks) {
    const col = new Array<number>(n).fill(0);
    for (let h = 0; h < heads; h++) {
      for (let i = 0; i < n; i++) {
        const base = (h * n + i) * n;
        for (let j = 0; j < n; j++) col[j] += A[base + j]!;
      }
    }
    for (let j = 0; j < n; j++) acc[j] += col[j]! / (heads * n);
  }
  return acc.map((x) => x / blocks.length);
}

/** Attention view: sink squares (above SINK x a fair share) are left out of the scale (0) and returned; the rest 0..1. */
export function attentionView(received: Num, sink = SINK): { view: number[]; sinks: number[] } {
  const v = Array.from(received);
  const sinks = v.flatMap((x, i) => (x > sink / v.length ? [i] : []));
  const rest = v.filter((_, i) => !sinks.includes(i));
  const view = v.map(() => 0);
  if (rest.length) {
    const lo = Math.min(...rest);
    const hi = Math.max(...rest);
    if (hi > lo) v.forEach((x, i) => (view[i] = sinks.includes(i) ? 0 : (x - lo) / (hi - lo)));
  }
  return { view, sinks };
}

/** Bilinear, cell centres at (i + 0.5) * size / g, edges clamped (align_corners=False): g*g values -> size*size. */
export function upsample(grid: Num, g: number, size: number): Float64Array {
  const c = new Float64Array(size);
  const i0 = new Int32Array(size);
  const i1 = new Int32Array(size);
  const f = new Float64Array(size);
  for (let k = 0; k < size; k++) {
    c[k] = Math.min(g - 1, Math.max(0, ((k + 0.5) * g) / size - 0.5));
    i0[k] = Math.floor(c[k]!);
    i1[k] = Math.min(i0[k]! + 1, g - 1);
    f[k] = c[k]! - i0[k]!;
  }
  const rows = new Float64Array(size * g);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < g; x++) rows[y * g + x] = grid[i0[y]! * g + x]! * (1 - f[y]!) + grid[i1[y]! * g + x]! * f[y]!;
  }
  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + x] = rows[y * g + i0[x]!]! * (1 - f[x]!) + rows[y * g + i1[x]!]! * f[x]!;
  }
  return out;
}

/** The model's CHW input in [0, 1] -> RGB bytes, S*S*3 (exact: the input was bytes / 255). */
export function toRgb(x: Num, size: number): Uint8Array {
  const n = size * size;
  const out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[3 * i + c] = Math.min(255, Math.max(0, Math.round(x[c * n + i]! * 255)));
  }
  return out;
}

/** RGBA bytes (a canvas) -> RGB bytes. */
export function rgbaToRgb(d: Num): Uint8Array {
  const n = d.length / 4;
  const out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[3 * i] = d[4 * i]!;
    out[3 * i + 1] = d[4 * i + 1]!;
    out[3 * i + 2] = d[4 * i + 2]!;
  }
  return out;
}

export function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = 60 * ((g - b) / d);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx / 255];
}

/** Otsu's threshold on integers in [lo, hi]; the upper class is "value > t". Ties keep the first. */
export function otsu(values: Num, lo = -510, hi = 510): number {
  const hist = new Float64Array(hi - lo + 1);
  for (let i = 0; i < values.length; i++) hist[values[i]! - lo]! += 1;
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < hist.length; i++) {
    total += hist[i]!;
    if (hist[i]) sumAll += (lo + i) * hist[i]!;
  }
  let best = -1;
  let bestT = lo;
  let wB = 0;
  let sumB = 0;
  for (let i = 0; i < hist.length; i++) {
    if (hist[i] === 0 && wB === 0) continue;
    wB += hist[i]!;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += (lo + i) * hist[i]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = lo + i;
    }
  }
  return bestT;
}

type Mask = Uint8Array;

function morph(m: Mask, H: number, W: number, all: boolean): Mask {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = m[y * W + x]!;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || (dx === 0 && dy === 0)) continue;
          v = all ? v & m[yy * W + xx]! : v | m[yy * W + xx]!;
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}
export const erode = (m: Mask, H: number, W: number) => morph(m, H, W, true);
export const dilate = (m: Mask, H: number, W: number) => morph(m, H, W, false);

/** Everything not reachable from the border through non-mask pixels (4-neighbours) joins the mask. */
export function fillHoles(m: Mask, H: number, W: number): Mask {
  const seen = new Uint8Array(m.length);
  const q = new Int32Array(m.length);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!m[i] && !seen[i]) {
      seen[i] = 1;
      q[tail++] = i;
    }
  };
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  while (head < tail) {
    const i = q[head++]!;
    const y = Math.floor(i / W);
    const x = i - y * W;
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = seen[i] ? 0 : 1;
  return out;
}

export function outline(m: Mask, H: number, W: number): Mask {
  const e = erode(m, H, W);
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = m[i]! & (e[i]! ^ 1);
  return out;
}

export interface Lesion {
  size: number;
  leaf: Mask;
  spots: Mask;
  threshold: number;
  leafFound: boolean;
  /** percentages, unrounded */
  leafPct: number;
  severityPct: number | null;
  kindsPct: Record<Kind, number | null>;
}

const count = (m: Mask) => m.reduce((s, v) => s + v, 0);

/** Leaf mask, spot mask and severity from colour alone. rgb: S*S*3 bytes of a square photo. */
export function lesion(rgb: Num, size: number): Lesion {
  const n = size * size;
  const exg = new Int32Array(n);
  for (let i = 0; i < n; i++) exg[i] = 2 * rgb[3 * i + 1]! - rgb[3 * i]! - rgb[3 * i + 2]!;
  const t = Math.min(Math.max(otsu(exg), EXG_MIN), EXG_MAX);
  const green = new Uint8Array(n);
  for (let i = 0; i < n; i++) green[i] = exg[i]! > t ? 1 : 0;
  const leaf = fillHoles(erode(dilate(dilate(erode(green, size, size), size, size), size, size), size, size), size, size);
  const kinds: Record<Kind, Mask> = { brown: new Uint8Array(n), yellow: new Uint8Array(n), dark: new Uint8Array(n) };
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [h, s, v] = hsv(rgb[3 * i]!, rgb[3 * i + 1]!, rgb[3 * i + 2]!);
    const dark = v < DARK_V && (h < YELLOW_HUE || h >= 330 || s < 0.25);
    const brown = v >= DARK_V && (h < BROWN_HUE || h >= 330) && s > BROWN_S && v >= BROWN_V;
    const yellow = v >= DARK_V && h >= BROWN_HUE && h < YELLOW_HUE && s > YELLOW_S && v >= YELLOW_V;
    kinds.dark[i] = dark ? 1 : 0;
    kinds.brown[i] = brown ? 1 : 0;
    kinds.yellow[i] = yellow ? 1 : 0;
    cand[i] = (dark || brown || yellow) && leaf[i] ? 1 : 0;
  }
  const opened = dilate(erode(cand, size, size), size, size);
  const spots = new Uint8Array(n);
  for (let i = 0; i < n; i++) spots[i] = opened[i]! & leaf[i]!;
  const nLeaf = count(leaf);
  const nSpot = count(spots);
  const found = nLeaf >= MIN_LEAF * n;
  const kindsPct = {} as Record<Kind, number | null>;
  for (const k of KINDS) {
    let c = 0;
    for (let i = 0; i < n; i++) c += kinds[k][i]! & spots[i]!;
    kindsPct[k] = found ? (100 * c) / nLeaf : null;
  }
  return { size, leaf, spots, threshold: t, leafFound: found, leafPct: (100 * nLeaf) / n, severityPct: found ? (100 * nSpot) / nLeaf : null, kindsPct };
}

export type Verdict = 'no_leaf' | 'no_spots' | 'mostly_spots' | 'more_on_spots' | 'other_leaf' | 'outside_leaf';

export interface Overlap {
  onSpotsPct: number;
  onLeafPct: number;
  spotAreaPct: number;
  lift: number | null;
  verdict: Verdict;
}

/** How much of the CAM's mass (an S*S map in 0..1) falls on the spots and on the leaf, against the spots' share. */
export function overlap(camUp: Num, les: Lesion): Overlap {
  let total = 0;
  let onS = 0;
  let onL = 0;
  let nS = 0;
  for (let i = 0; i < camUp.length; i++) {
    const c = camUp[i]!;
    total += c;
    if (les.spots[i]) {
      onS += c;
      nS++;
    }
    if (les.leaf[i]) onL += c;
  }
  const spotArea = nS / camUp.length;
  const onSpots = total > 0 ? onS / total : 0;
  const onLeaf = total > 0 ? onL / total : 0;
  let verdict: Verdict;
  if (!les.leafFound) verdict = 'no_leaf';
  else if ((les.severityPct ?? 0) < 0.5) verdict = 'no_spots';
  else if (onSpots >= 0.5) verdict = 'mostly_spots';
  else if (spotArea > 0 && onSpots / spotArea >= 2) verdict = 'more_on_spots';
  else if (onLeaf >= 0.6) verdict = 'other_leaf';
  else verdict = 'outside_leaf';
  return { onSpotsPct: 100 * onSpots, onLeafPct: 100 * onLeaf, spotAreaPct: 100 * spotArea, lift: spotArea > 0 ? onSpots / spotArea : null, verdict };
}

/* ---------------------------------------------------------------- fixed inputs, the same as in Python */
/** A drawn leaf with integer maths only (agritriage_xai.synth_leaf draws the same pixels). */
export function synthLeaf(size: number, spots: [number, number, number, Kind][], bg: [number, number, number] = [214, 204, 170]) {
  const cy = Math.floor(size / 2);
  const cx = cy;
  const a = Math.floor((size * 9) / 20);
  const b = Math.floor((size * 3) / 10);
  const col: Record<Kind, [number, number, number]> = { brown: [132, 86, 44], yellow: [214, 196, 58], dark: [34, 26, 20] };
  const rgb = new Uint8Array(size * size * 3);
  let nLeaf = 0;
  let nSpot = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = 3 * (y * size + x);
      if ((x - cx) ** 2 * b * b + (y - cy) ** 2 * a * a > a * a * b * b) {
        rgb.set(bg, o);
        continue;
      }
      nLeaf++;
      const t = ((x * 7 + y * 13) % 11) - 5;
      let px: [number, number, number] = [58 + t, 128 + 2 * t, 52 + t];
      for (const [sy, sx, r, kind] of spots) {
        if ((x - sx) ** 2 + (y - sy) ** 2 <= r * r) {
          px = col[kind];
          nSpot++;
          break;
        }
      }
      rgb.set(px, o);
    }
  }
  return { rgb, nLeaf, nSpot };
}

/** Softmax rows from a closed formula (agritriage_xai.synth_attention): square 6 is a sink. */
export function synthAttention(blocks = 2, heads = 3, n = 49): Float64Array[] {
  const out: Float64Array[] = [];
  for (let bl = 0; bl < blocks; bl++) {
    const A = new Float64Array(heads * n * n);
    for (let h = 0; h < heads; h++) {
      for (let i = 0; i < n; i++) {
        const z: number[] = [];
        for (let j = 0; j < n; j++) z.push(3 * Math.sin(1.3 * i + 0.7 * j + 0.31 * h + 2.1 * bl) + (j === 6 ? 4 : 0));
        const m = Math.max(...z);
        const e = z.map((v) => Math.exp(v - m));
        let s = 0;
        for (const v of e) s += v;
        e.forEach((v, j) => (A[(h * n + i) * n + j] = v / s));
      }
    }
    out.push(A);
  }
  return out;
}
