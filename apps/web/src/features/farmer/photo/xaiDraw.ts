/**
 * Pictures for the XAI views (canvas, in the browser): the square the model saw, with a map, an outline or the spots
 * drawn over it. Pastel ramps from the site's palette (DESIGN.md "Palette"); the strongest area is also outlined, and
 * attention sinks get a ring, so nothing is told by colour alone. The same pictures in both themes (they are photos).
 */
import { dilate, outline, upsample, type Lesion } from '../../../lib/agritriage/xai';

/** butter -> apricot -> terracotta -> clay rose -> deep lotus (the /map scale): "pushed the answer" */
export const WARM = ['#f5e7b2', '#f4cc94', '#eda383', '#cf6f66', '#8c3550'];
/** pale monsoon -> monsoon -> hyacinth -> deep hyacinth: "attention" */
export const COOL = ['#d9ecf2', '#a8d1df', '#c6b7e4', '#8d77c4', '#4b3a78'];
export const SPOT = '#f0b9b4'; // lotus
export const LEAF = '#a8d1df'; // monsoon
const LINE_DARK: [number, number, number] = [43, 26, 48]; // aubergine-deep
const LINE_LIGHT: [number, number, number] = [255, 250, 240];
/** the strongest area's outline: map values at or above this */
export const TOP = 0.6;

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rampCache = new Map<string[], [number, number, number][]>();
function ramp(stops: string[], t: number): [number, number, number] {
  let rgb = rampCache.get(stops);
  if (!rgb) rampCache.set(stops, (rgb = stops.map(hex)));
  const x = Math.min(1, Math.max(0, t)) * (rgb.length - 1);
  const i = Math.min(rgb.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [rgb[i]!, rgb[i + 1]!];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** RGB bytes of the S x S square -> a canvas twice as big (sharp on phones). */
function base(rgb: Uint8Array, S: number): { cv: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData } {
  const small = document.createElement('canvas');
  small.width = S;
  small.height = S;
  const sg = small.getContext('2d')!;
  const d = sg.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    d.data[4 * i] = rgb[3 * i]!;
    d.data[4 * i + 1] = rgb[3 * i + 1]!;
    d.data[4 * i + 2] = rgb[3 * i + 2]!;
    d.data[4 * i + 3] = 255;
  }
  sg.putImageData(d, 0, 0);
  const cv = document.createElement('canvas');
  cv.width = 2 * S;
  cv.height = 2 * S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, 2 * S, 2 * S);
  return { cv, g, img: g.getImageData(0, 0, 2 * S, 2 * S) };
}

/** The photo alone (the Comparer's other layer), at the same size as the overlays. */
export function photoUrl(rgb: Uint8Array, S: number): string {
  return base(rgb, S).cv.toDataURL('image/jpeg', 0.88);
}

/** Paint a two-tone line (light on dark) along the edge of `mask` (W x W). */
function line(px: Uint8ClampedArray, mask: Uint8Array, W: number) {
  const edge = outline(mask, W, W);
  const halo = dilate(edge, W, W);
  for (let i = 0; i < mask.length; i++) {
    if (edge[i]) px.set(LINE_LIGHT, 4 * i);
    else if (halo[i] && !mask[i]) px.set(LINE_DARK, 4 * i);
  }
}

/** A smooth map (values 0..1 on a g x g grid, or blocky with `blocky`) over the photo, its top area outlined. */
export function heatUrl(rgb: Uint8Array, S: number, grid: ArrayLike<number>, g: number, stops: string[], opts: { blocky?: boolean; sinks?: number[] } = {}): string {
  const { cv, g: ctx, img } = base(rgb, S);
  const W = 2 * S;
  const m = opts.blocky ? blockUp(grid, g, W) : upsample(grid, g, W);
  const px = img.data;
  const top = new Uint8Array(W * W);
  for (let i = 0; i < W * W; i++) {
    const v = m[i]!;
    const [r, gg, b] = ramp(stops, v);
    const a = 0.08 + 0.74 * Math.pow(v, 1.5);
    const k = 0.78 * (1 - a); // the photo is dimmed a little so pastel colours read on a green leaf
    px[4 * i] = px[4 * i]! * k + r * a;
    px[4 * i + 1] = px[4 * i + 1]! * k + gg * a;
    px[4 * i + 2] = px[4 * i + 2]! * k + b * a;
    top[i] = v >= TOP ? 1 : 0;
  }
  line(px, top, W);
  ctx.putImageData(img, 0, 0);
  for (const s of opts.sinks ?? []) {
    const cell = W / g;
    const [cx, cy] = [((s % g) + 0.5) * cell, (Math.floor(s / g) + 0.5) * cell];
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgb(43 26 48)';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgb(255 250 240)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return cv.toDataURL('image/jpeg', 0.88);
}

function blockUp(grid: ArrayLike<number>, g: number, W: number): Float64Array {
  const out = new Float64Array(W * W);
  for (let y = 0; y < W; y++) {
    const r = Math.min(g - 1, Math.floor((y * g) / W));
    for (let x = 0; x < W; x++) out[y * W + x] = grid[r * g + Math.min(g - 1, Math.floor((x * g) / W))]!;
  }
  return out;
}

/** The spots (lotus wash, two-tone outline) and the leaf's edge (dotted monsoon) over the photo. */
export function spotsUrl(rgb: Uint8Array, S: number, les: Lesion): string {
  const { cv, g, img } = base(rgb, S);
  const W = 2 * S;
  const up = (m: Uint8Array) => {
    const o = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) o[y * W + x] = m[(y >> 1) * S + (x >> 1)]!;
    return o;
  };
  const spots = up(les.spots);
  const leaf = up(les.leaf);
  const leafEdge = outline(leaf, W, W);
  const [sr, sg, sb] = hex(SPOT);
  const [lr, lg, lb] = hex(LEAF);
  const px = img.data;
  for (let i = 0; i < W * W; i++) {
    if (spots[i]) {
      px[4 * i] = px[4 * i]! * 0.45 + sr * 0.55;
      px[4 * i + 1] = px[4 * i + 1]! * 0.45 + sg * 0.55;
      px[4 * i + 2] = px[4 * i + 2]! * 0.45 + sb * 0.55;
    } else if (!leaf[i]) {
      px[4 * i] = px[4 * i]! * 0.55;
      px[4 * i + 1] = px[4 * i + 1]! * 0.55;
      px[4 * i + 2] = px[4 * i + 2]! * 0.55;
    }
    if (leafEdge[i] && ((i % W) + Math.floor(i / W)) % 8 < 5) px.set([lr, lg, lb], 4 * i);
  }
  line(px, spots, W);
  g.putImageData(img, 0, 0);
  return cv.toDataURL('image/jpeg', 0.88);
}

/** CSS for a legend bar in the same ramp. */
export const rampCss = (stops: string[]) => `linear-gradient(90deg, ${stops.join(', ')})`;
