/**
 * "Where the model looked": occlusion sensitivity. Grad-CAM needs gradients, which the exported ONNX student does not
 * give, so we hide one patch of the photo at a time (a 7 x 7 grid of 32 px squares on the 224 px input, filled with mid
 * grey) and measure how much the chosen disease's probability drops. A big drop means the model relied on that patch.
 * The server does the same (services/vision/agritriage.py occlusion_inputs / occlusion_heat). Pure: no DOM.
 */
export const GRID = 7;
export const FILL = 0.5;

export interface Patch {
  row: number;
  col: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The grid's patches in row-major order, on an S x S input (integer edges, as the server's S*k//grid). */
export function patches(size: number, grid = GRID): Patch[] {
  const out: Patch[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      out.push({
        row,
        col,
        y0: Math.floor((row * size) / grid),
        y1: Math.floor(((row + 1) * size) / grid),
        x0: Math.floor((col * size) / grid),
        x1: Math.floor(((col + 1) * size) / grid),
      });
    }
  }
  return out;
}

/** Copy a CHW image (3 x S x S) with one patch set to `fill`. */
export function masked(chw: Float32Array, size: number, p: Patch, fill = FILL): Float32Array {
  const out = chw.slice();
  const n = size * size;
  for (let c = 0; c < 3; c++) {
    for (let y = p.y0; y < p.y1; y++) {
      out.fill(fill, c * n + y * size + p.x0, c * n + y * size + p.x1);
    }
  }
  return out;
}

/** Several masked copies stacked into one batch [k, 3, S, S]. */
export function maskedBatch(chw: Float32Array, size: number, ps: Patch[], fill = FILL): Float32Array {
  const one = 3 * size * size;
  const out = new Float32Array(one * ps.length);
  ps.forEach((p, k) => out.set(masked(chw, size, p, fill), k * one));
  return out;
}

/** How much hiding each patch lowers the chosen class's probability, scaled to [0, 1] (all 0 when nothing does). */
export function heatFromDrops(base: number, maskedProbs: number[]): number[] {
  const drop = maskedProbs.map((v) => Math.max(0, base - v));
  const top = Math.max(0, ...drop);
  return drop.map((d) => (top > 0 ? Math.round((d / top) * 10000) / 10000 : 0));
}

/** A heat value -> an RGBA colour for the overlay (transparent where the model did not look, warm where it did). */
export function heatColour(v: number): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  // dark violet -> red -> amber -> pale yellow (readable on green leaves), alpha grows with the value
  const stops: [number, number, number][] = [
    [40, 10, 90],
    [200, 30, 60],
    [245, 150, 30],
    [255, 240, 160],
  ];
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  const [a, b] = [stops[i], stops[i + 1]];
  return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2]), Math.round(40 + 175 * t)];
}
