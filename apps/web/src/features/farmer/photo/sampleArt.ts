/**
 * SAMPLE leaf pictures (vector illustrations, not photographs) and the overlays that line up with them, so the whole
 * diagnosis result (lesion boxes, leaf mask, heat) can be designed, shown and tested before a model exists.
 * Everything built here is flagged `sample: true` and labelled "Sample" on screen.
 *
 * The geometry is shared: the same numbers draw a lesion on the picture and place its box in the overlay, so they
 * cannot drift apart. Overlay coordinates are in the model's input-crop space (the centre 87.5% of the picture).
 */
import type { Lesion, PhotoOverlay, Plane } from './overlay';

export type SampleArt = 'top' | 'underside' | 'close';

const PHOTO = 400;
const CROP0 = 25; // the model reads the centre 350 of 400 pixels
const CROP = 350;
const toCrop = (v: number) => (v - CROP0) / CROP;

interface Spot {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  deg: number;
  score: number;
}
interface Scene {
  svg: string;
  /** the leaf outline as an SVG path (drawn into the mask) */
  leaf: string;
  spots: Spot[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const bez = (p: Pt[], t: number): Pt => {
  const u = 1 - t;
  return [
    u * u * u * p[0]![0] + 3 * u * u * t * p[1]![0] + 3 * u * t * t * p[2]![0] + t * t * t * p[3]![0],
    u * u * u * p[0]![1] + 3 * u * u * t * p[1]![1] + 3 * u * t * t * p[2]![1] + t * t * t * p[3]![1],
  ];
};
const tangent = (p: Pt[], t: number): Pt => {
  const a = bez(p, Math.max(0, t - 0.01));
  const b = bez(p, Math.min(1, t + 0.01));
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};
const f = (n: number) => Math.round(n * 10) / 10;

const DEFS = `
<defs>
  <radialGradient id="bg" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#33442a"/><stop offset="1" stop-color="#0d140b"/></radialGradient>
  <linearGradient id="lf" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#376f29"/><stop offset=".55" stop-color="#52993a"/><stop offset="1" stop-color="#7cbd52"/></linearGradient>
  <linearGradient id="lu" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7da560"/><stop offset=".55" stop-color="#9dc27a"/><stop offset="1" stop-color="#bddb98"/></linearGradient>
  <filter id="rough" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9"/></filter>
  <filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="blur2"><feGaussianBlur stdDeviation="1.6"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .09 0"/></filter>
</defs>`;

const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PHOTO} ${PHOTO}" width="${PHOTO}" height="${PHOTO}">${DEFS}<rect width="${PHOTO}" height="${PHOTO}" fill="url(#bg)"/>${body}<rect width="${PHOTO}" height="${PHOTO}" filter="url(#grain)"/></svg>`;

/* ------------------------------------------------------------------ potato leaflet */
const POTATO_LEAF = 'M92 336C62 262 84 160 170 108C212 84 262 74 304 76C330 150 316 246 244 304C190 350 120 362 92 336Z';
const POTATO_RIB: Pt[] = [
  [96, 332],
  [150, 252],
  [222, 164],
  [296, 84],
];
const POTATO_SPOTS: Spot[] = [
  { cx: 236, cy: 150, rx: 30, ry: 26, deg: -20, score: 0.93 },
  { cx: 192, cy: 226, rx: 24, ry: 20, deg: -10, score: 0.86 },
  { cx: 146, cy: 283, rx: 17, ry: 15, deg: 0, score: 0.71 },
];

function veins(rib: Pt[], stroke: string, w: number, count = 6, spread = 70) {
  let out = `<path d="M${rib[0]![0]} ${rib[0]![1]}C${rib[1]![0]} ${rib[1]![1]} ${rib[2]![0]} ${rib[2]![1]} ${rib[3]![0]} ${rib[3]![1]}" stroke="${stroke}" stroke-width="${w * 2}" fill="none" stroke-linecap="round" opacity=".85"/>`;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const [x, y] = bez(rib, t);
    const [tx, ty] = tangent(rib, t);
    const len = spread * (1 - Math.abs(t - 0.45) * 0.9);
    for (const side of [-1, 1]) {
      const a = Math.atan2(ty, tx) + side * 0.95;
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      const mx = x + Math.cos(a) * len * 0.5 - side * ty * 6;
      const my = y + Math.sin(a) * len * 0.5 + side * tx * 6;
      out += `<path d="M${f(x)} ${f(y)}Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}" stroke="${stroke}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity=".7"/>`;
    }
  }
  return out;
}

function blight(s: Spot, underside: boolean) {
  const r = `rotate(${s.deg} ${s.cx} ${s.cy})`;
  return underside
    ? `<g filter="url(#rough)" transform="${r}"><ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx * 1.2}" ry="${s.ry * 1.15}" fill="#7a6a3a" opacity=".42"/><ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx * 0.8}" ry="${s.ry * 0.75}" fill="#4a3720" opacity=".55"/></g>`
    : `<g filter="url(#rough)" transform="${r}"><ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx * 1.5}" ry="${s.ry * 1.42}" fill="#c3c46a" opacity=".36" filter="url(#blur2)"/><ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="#3a2716" opacity=".95"/><ellipse cx="${s.cx + 2}" cy="${s.cy - 1}" rx="${s.rx * 0.52}" ry="${s.ry * 0.5}" fill="#1f140b" opacity=".9"/></g>`;
}

function fuzz(s: Spot, seed: number) {
  const r = rng(seed);
  let out = `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx * 1.35}" ry="${s.ry * 1.3}" fill="none" stroke="#fff" stroke-width="9" opacity=".3" filter="url(#blur6)"/>`;
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const k = 0.85 + r() * 0.75;
    const x = s.cx + Math.cos(a) * s.rx * k * 1.15;
    const y = s.cy + Math.sin(a) * s.ry * k * 1.1;
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.2 + r() * 2.2)}" fill="#f6f8f0" opacity="${f(0.45 + r() * 0.5)}"/>`;
  }
  return out;
}

function potato(art: SampleArt): Scene {
  const under = art === 'underside';
  const body = `<path d="${POTATO_LEAF}" fill="url(#${under ? 'lu' : 'lf'})" stroke="${under ? '#7d9d5e' : '#2c5a22'}" stroke-width="3"/>${veins(POTATO_RIB, under ? '#e3f1c6' : '#a6d680', under ? 1.6 : 1.3)}${POTATO_SPOTS.map((s) => blight(s, under)).join('')}${under ? fuzz(POTATO_SPOTS[0]!, 11) + fuzz(POTATO_SPOTS[1]!, 23) : ''}`;
  return { svg: wrap(body), leaf: POTATO_LEAF, spots: POTATO_SPOTS };
}

/* ------------------------------------------------------------------ rice blade */
function blade(c: Pt[], half: (t: number) => number, n = 28) {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = bez(c, t);
    const [tx, ty] = tangent(c, t);
    const w = half(t);
    left.push([x - ty * w, y + tx * w]);
    right.push([x + ty * w, y - tx * w]);
  }
  const pts = [...left, ...right.reverse()];
  return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
}

function riceBlade(c: Pt[], half: (t: number) => number, spots: { t: number; rx: number; ry: number; score: number }[], opts: { veins: number }) {
  const leaf = blade(c, half);
  let body = `<path d="${leaf}" fill="url(#lf)" stroke="#2c5a22" stroke-width="3"/>`;
  for (let k = -opts.veins; k <= opts.veins; k++) {
    const off = k / (opts.veins + 0.6);
    let d = '';
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const [x, y] = bez(c, t);
      const [tx, ty] = tangent(c, t);
      const w = half(t) * off;
      d += `${i ? 'L' : 'M'}${f(x - ty * w)} ${f(y + tx * w)}`;
    }
    body += `<path d="${d}" stroke="${k === 0 ? '#c7e6a4' : '#9ccd78'}" stroke-width="${k === 0 ? 3 : 1.3}" fill="none" opacity="${k === 0 ? 0.85 : 0.55}"/>`;
  }
  const out: Spot[] = [];
  for (const s of spots) {
    const [cx, cy] = bez(c, s.t);
    const [tx, ty] = tangent(c, s.t);
    const deg = (Math.atan2(ty, tx) * 180) / Math.PI;
    const r = `rotate(${f(deg)} ${f(cx)} ${f(cy)})`;
    body += `<g filter="url(#rough)" transform="${r}"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${s.rx * 1.3}" ry="${s.ry * 1.9}" fill="#d6c25a" opacity=".5" filter="url(#blur2)"/><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${s.rx}" ry="${s.ry}" fill="#6a3f20"/><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${s.rx * 0.64}" ry="${s.ry * 0.52}" fill="#cfd3c6"/></g>`;
    out.push({ cx, cy, rx: s.rx, ry: s.ry * 1.5, deg, score: s.score });
  }
  return { svg: wrap(body), leaf, spots: out } satisfies Scene;
}

const RICE_TOP: Pt[] = [
  [30, 376],
  [130, 300],
  [250, 196],
  [372, 44],
];
const RICE_CLOSE: Pt[] = [
  [-10, 330],
  [120, 262],
  [262, 150],
  [410, 70],
];

function rice(art: SampleArt): Scene {
  if (art === 'close') {
    return riceBlade(RICE_CLOSE, (t) => 118 * (1 - 0.25 * t), [{ t: 0.5, rx: 104, ry: 28, score: 0.94 }, { t: 0.22, rx: 40, ry: 12, score: 0.77 }, { t: 0.8, rx: 36, ry: 11, score: 0.69 }], { veins: 4 });
  }
  return riceBlade(RICE_TOP, (t) => 24 * Math.pow(1 - t, 0.5) + 2, [{ t: 0.3, rx: 36, ry: 10, score: 0.92 }, { t: 0.53, rx: 32, ry: 9, score: 0.84 }, { t: 0.75, rx: 26, ry: 8, score: 0.7 }], { veins: 2 });
}

const SCENES: Record<string, Scene> = {};
function scene(crop: string, art: SampleArt): Scene {
  const key = `${crop}/${art}`;
  return (SCENES[key] ??= crop === 'rice' ? rice(art) : potato(art));
}

/** A data: URL for the sample picture of this crop and view. */
export const sampleImage = (crop: string, art: SampleArt): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(scene(crop, art).svg)}`;

const box = (s: Spot): Lesion => {
  const t = (s.deg * Math.PI) / 180;
  const hw = Math.hypot(s.rx * Math.cos(t), s.ry * Math.sin(t));
  const hh = Math.hypot(s.rx * Math.sin(t), s.ry * Math.cos(t));
  return { x: toCrop(s.cx - hw), y: toCrop(s.cy - hh), w: (2 * hw) / CROP, h: (2 * hh) / CROP, score: s.score };
};

const PLANE = 96;

function heatPlane(spots: Spot[]): Plane {
  const data = new Uint8Array(PLANE * PLANE);
  for (let y = 0; y < PLANE; y++) {
    for (let x = 0; x < PLANE; x++) {
      const px = CROP0 + ((x + 0.5) / PLANE) * CROP;
      const py = CROP0 + ((y + 0.5) / PLANE) * CROP;
      let v = 0;
      for (const s of spots) {
        const sx = (s.rx + s.ry) * 0.75;
        v += s.score * Math.exp(-(((px - s.cx) ** 2 + (py - s.cy) ** 2) / (2 * sx * sx)));
      }
      data[y * PLANE + x] = Math.min(255, Math.round(v * 255));
    }
  }
  return { size: PLANE, data };
}

/** Rasterise the leaf outline into a mask plane (needs a browser canvas; returns undefined without one). */
function maskPlane(leaf: string): Plane | undefined {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = PLANE;
    c.height = PLANE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PLANE, PLANE);
    ctx.scale(PLANE / CROP, PLANE / CROP);
    ctx.translate(-CROP0, -CROP0);
    ctx.fillStyle = '#fff';
    ctx.fill(new Path2D(leaf));
    const px = ctx.getImageData(0, 0, PLANE, PLANE).data;
    const data = new Uint8Array(PLANE * PLANE);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4]!;
    return { size: PLANE, data };
  } catch {
    return undefined;
  }
}

/** Lesion boxes, leaf mask and heat that line up with `sampleImage(crop, art)`. */
export function sampleOverlay(crop: string, art: SampleArt): PhotoOverlay {
  const s = scene(crop, art);
  return { sample: true, lesions: s.spots.map(box), heat: heatPlane(s.spots), mask: maskPlane(s.leaf) };
}
