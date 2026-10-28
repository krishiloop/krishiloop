/**
 * A procedurally drawn "satellite chip": blocky 10-metre-style pixels coloured by greenness (NDVI-like ramp),
 * parcels with irregular borders, a river and roads, and one highlighted parcel (the field).
 * It is an ILLUSTRATION used only when the field has no real Sentinel-2 chip yet, and the UI says so.
 * Deterministic per seed, so the same field always looks the same.
 */
export const CHIP_W = 120;
export const CHIP_H = 75;

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const STOPS: [number, [number, number, number]][] = [
  [0.0, [122, 100, 70]],
  [0.2, [143, 125, 69]],
  [0.4, [134, 160, 65]],
  [0.6, [88, 149, 58]],
  [0.8, [47, 125, 51]],
  [1.0, [27, 94, 43]],
];
function ramp(v: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]!;
    if (x <= p1) {
      const [p0, c0] = STOPS[i - 1]!;
      const k = (x - p0) / (p1 - p0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS.at(-1)![1];
}
const curve = (x: number) => Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, x))), 1.3);

interface Parcel {
  id: number;
  type: 'crop' | 'fallow' | 'forest' | 'pond';
  phase: number;
  amp: number;
}

/** Everything that does not change with the season, computed once per seed. */
export interface ChipGeometry {
  parcel: Uint32Array;
  info: Map<number, Parcel>;
  focus: number;
  water: Uint8Array;
  road: Uint8Array;
  edge: Uint8Array;
  tex: Float32Array;
}

export function buildGeometry(seed: number): ChipGeometry {
  const PW = 15;
  const PH = 12;
  const parcel = new Uint32Array(CHIP_W * CHIP_H);
  const info = new Map<number, Parcel>();
  const water = new Uint8Array(CHIP_W * CHIP_H);
  const road = new Uint8Array(CHIP_W * CHIP_H);
  const tex = new Float32Array(CHIP_W * CHIP_H);
  const riverY = (x: number) => CHIP_H * 0.84 + Math.sin(x * 0.09 + (seed % 7)) * 4 + Math.sin(x * 0.21) * 1.6;
  for (let y = 0; y < CHIP_H; y++) {
    for (let x = 0; x < CHIP_W; x++) {
      const xw = x + (vnoise(x * 0.07, y * 0.07, seed) - 0.5) * 9;
      const yw = y + (vnoise(x * 0.07 + 40, y * 0.07 + 40, seed) - 0.5) * 9;
      const px = Math.floor(xw / PW);
      const py = Math.floor(yw / PH);
      const id = ((px + 64) * 211 + (py + 64)) >>> 0;
      const i = y * CHIP_W + x;
      parcel[i] = id;
      if (!info.has(id)) {
        const r = hash2(px, py, seed);
        const r2 = hash2(px + 9, py + 3, seed);
        info.set(id, { id, type: r < 0.62 ? 'crop' : r < 0.78 ? 'fallow' : r < 0.9 ? 'forest' : 'pond', phase: (r2 - 0.5) * 0.32, amp: 0.68 + hash2(px, py + 5, seed) * 0.32 });
      }
      tex[i] = (vnoise(x * 0.9, y * 0.9, seed + 3) - 0.5) * 0.12 + (hash2(x, y, seed + 1) - 0.5) * 0.05;
      if (Math.abs(y - riverY(x)) < 1.7) water[i] = 1;
      const fx = xw / PW - px;
      const fy = yw / PH - py;
      if ((fx < 0.045 || fy < 0.06) && hash2(px, py, seed + 11) < 0.34) road[i] = 1;
    }
  }
  // the field = the parcel under the centre, forced to be a crop
  const focus = parcel[Math.floor(CHIP_H * 0.46) * CHIP_W + Math.floor(CHIP_W * 0.5)]!;
  const f = info.get(focus)!;
  f.type = 'crop';
  f.phase = 0;
  f.amp = 1;
  const edge = new Uint8Array(CHIP_W * CHIP_H);
  for (let y = 1; y < CHIP_H - 1; y++) {
    for (let x = 1; x < CHIP_W - 1; x++) {
      const i = y * CHIP_W + x;
      if (parcel[i] !== focus) continue;
      if (parcel[i - 1] !== focus || parcel[i + 1] !== focus || parcel[i - CHIP_W] !== focus || parcel[i + CHIP_W] !== focus) edge[i] = 1;
    }
  }
  return { parcel, info, focus, water, road, edge, tex };
}

/** Paint the chip for season progress t in [0,1] (0 = season start, 1 = season end). */
export function paintChip(ctx: CanvasRenderingContext2D, geo: ChipGeometry, t: number, outline: [number, number, number] = [240, 201, 107]) {
  const img = ctx.createImageData(CHIP_W, CHIP_H);
  const d = img.data;
  for (let i = 0; i < CHIP_W * CHIP_H; i++) {
    let r: number;
    let g: number;
    let b: number;
    if (geo.water[i]) {
      [r, g, b] = [44, 74, 90];
    } else if (geo.road[i]) {
      [r, g, b] = [172, 164, 140];
    } else {
      const p = geo.info.get(geo.parcel[i]!)!;
      if (p.type === 'pond') [r, g, b] = [46, 78, 92];
      else if (p.type === 'forest') [r, g, b] = ramp(0.86 + geo.tex[i]! * 1.6);
      else if (p.type === 'fallow') [r, g, b] = ramp(0.1 + 0.12 * Math.sin(t * 3 + p.id) * 0.5 + 0.1 + geo.tex[i]!);
      else {
        const v = 0.1 + 0.78 * curve(t * 1.08 - 0.04 - p.phase) * p.amp + geo.tex[i]!;
        [r, g, b] = ramp(v);
      }
    }
    if (geo.edge[i]) [r, g, b] = outline;
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
