/**
 * Leaf kit: the drawing helpers for KrishiLoop's leaf-built farmer and his paddy world (the home hero film and the
 * <LeafFarmer> character used across the site). Everything is built of leaves, rice blades and grains, at real human
 * proportions (about seven heads tall, three-quarter view, facing right). Pure string builders plus small renderers
 * that only set transforms and a few path `d`s, so a frame is cheap. Colours are CSS variables (`--lf-*`, see
 * leafFarmer.css), so both themes work without touching the code.
 */

export type Rng = () => number;

/** A small seeded random generator (mulberry32): the same seed draws the same farmer on every visit. */
export const rng = (seed: number): Rng => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** ease out (cubic) */
export const eo = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
/** ease in-out (cubic) */
export const eio = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
/** ease out with a small overshoot (back) */
export const eob = (x: number, s = 1.5) => {
  const v = clamp01(x);
  return 1 + (s + 1) * Math.pow(v - 1, 3) + s * Math.pow(v - 1, 2);
};

const f1 = (n: number) => n.toFixed(1);

/** One leaf as a piece of path: centred on (x,y), length l, width w, turned a degrees, bent by b. */
export function lf(x: number, y: number, l: number, w: number, a: number, b = 0): string {
  const r = (a * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const h = l / 2;
  const P = (u: number, v: number) => `${f1(x + u * c - v * s)} ${f1(y + u * s + v * c)}`;
  return `M${P(-h, 0)}Q${P(-h * 0.15, -w + b * w)} ${P(h, b * w * 0.6)}Q${P(h * 0.1, w + b * w)} ${P(-h, 0)}Z`;
}

/** A rice blade rising from (x,y): height h, lean dx, width w. */
export function blade(x: number, y: number, h: number, dx: number, w: number): string {
  return (
    `M${f1(x - w / 2)} ${f1(y)}Q${f1(x + dx * 0.25)} ${f1(y - h * 0.62)} ${f1(x + dx)} ${f1(y - h)}` +
    `Q${f1(x + dx * 0.25 + w * 0.7)} ${f1(y - h * 0.55)} ${f1(x + w / 2)} ${f1(y)}Z`
  );
}

/** A clump of seedlings: four to six blades from one root. */
export function clump(r: Rng, x: number, y: number, h: number): string {
  let d = '';
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    d += blade(x + (i - n / 2) * 2.4, y, h * (0.7 + r() * 0.45), (i - n / 2) * h * 0.17 + (r() - 0.5) * h * 0.2, Math.max(2, h * 0.07));
  }
  return d;
}

/** Is (x,y) inside the polygon p? */
export function inside(p: number[][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i]![0]!;
    const yi = p[i]![1]!;
    const xj = p[j]![0]!;
    const yj = p[j]![1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

type Edge = { x: number; y: number; a: number; l: number; w: number; c: string; fx: number; fy: number; spin: number; at: number; el?: SVGElement };
type Part = { markup: string; edges: Edge[]; name: string; at: number; base?: SVGElement | null; tex?: SVGElement | null };
type PartOpts = { fill: string; tones: string[]; n: number; l: number; w: number; a: number; ja: number; edge: number; grid?: number };

/** One body part: an opaque base, leaf texture clipped inside it, and loose edge leaves that can fly in to it. */
function part(r: Rng, cls: string, name: string, poly: number[][], o: PartOpts): Part {
  const xs = poly.map((p) => p[0]!);
  const ys = poly.map((p) => p[1]!);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const d = `M${poly.map((p) => `${p[0]} ${p[1]}`).join('L')}Z`;
  const cid = `${cls}-${name}-clip`;
  const tex = ['', '', ''];
  const edges: Edge[] = [];
  let tries = 0;
  let placed = 0;
  while (placed < o.n && tries < o.n * 10) {
    tries++;
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    if (!inside(poly, x, y)) continue;
    placed++;
    const k = o.grid ? ((Math.floor(x / o.grid) + Math.floor(y / o.grid) + 400) % 2) + (r() < 0.15 ? 1 : 0) : Math.floor(r() * 3);
    tex[Math.min(k, 2)] += lf(x, y, o.l * (0.75 + r() * 0.6), o.w * (0.75 + r() * 0.6), o.a + (r() - 0.5) * o.ja, (r() - 0.5) * 0.6);
  }
  for (let i = 0; i < o.edge; i++) {
    const j = Math.floor(r() * poly.length);
    const q = poly[j]!;
    const q2 = poly[(j + 1) % poly.length]!;
    const u = r();
    edges.push({
      x: q[0]! + (q2[0]! - q[0]!) * u,
      y: q[1]! + (q2[1]! - q[1]!) * u,
      a: o.a + (r() - 0.5) * 80,
      l: o.l * (0.9 + r() * 0.5),
      w: o.w,
      c: o.tones[Math.floor(r() * 3)]!,
      fx: (r() - 0.3) * 900,
      fy: -300 - r() * 520,
      spin: (r() - 0.5) * 560,
      at: r(),
    });
  }
  const markup =
    `<g class="${cls}-${name}"><clipPath id="${cid}"><path d="${d}"/></clipPath>` +
    `<path class="${cls}-base" d="${d}" style="fill:${o.fill};stroke:${o.fill};stroke-width:10;stroke-linejoin:round"/>` +
    `<g clip-path="url(#${cid})">${tex.map((t, i) => `<path d="${t}" style="fill:${o.tones[i]}"/>`).join('')}</g>` +
    edges.map((e) => `<path class="${cls}-edge" d="${lf(0, 0, e.l, e.w, 0, 0.3)}" style="fill:${e.c}"/>`).join('') +
    `</g>`;
  return { markup, edges, name, at: 0 };
}

export type Pose = { fu: number; ff: number; nu: number; nf: number };
export type Face = { hd: number; lift?: number; knit?: number; smile?: number; open?: number; lid?: number };
export type FarmerState = Pose & Face & { t: number; g?: number; hat?: number };

const SHOULDER = { F: [70, -628], N: [-58, -622] } as const;
const L1 = 165;
const L2 = 158;

/** Where a hand is, in the farmer's own units (feet at 0,0). F is the far arm, N the near arm. */
export function fk(P: Pose, side: 'F' | 'N') {
  const S = SHOULDER[side];
  const a = ((side === 'F' ? P.fu : P.nu) * Math.PI) / 180;
  const b = a + ((side === 'F' ? P.ff : P.nf) * Math.PI) / 180;
  return { x: S[0] - L1 * Math.sin(a) - L2 * Math.sin(b), y: S[1] + L1 * Math.cos(a) + L2 * Math.cos(b), a: (b * 180) / Math.PI };
}

/** The arm angles that put a hand at (tx,ty) (farmer units). bend +1 keeps the elbow low. */
export function ik(side: 'F' | 'N', tx: number, ty: number, bend = 1) {
  const S = SHOULDER[side];
  const dx = tx - S[0];
  const dy = ty - S[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), 20), L1 + L2 - 0.5);
  const a = Math.atan2(-dx, dy);
  const al = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const be = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  return { u: ((a + bend * al) * 180) / Math.PI, f: (-bend * (Math.PI - be) * 180) / Math.PI };
}

export type Farmer = {
  markup: string;
  bind(root: Element): void;
  render(o: FarmerState): void;
};

/**
 * The farmer: a whole man built of leaves, three-quarter view facing right, about seven heads tall, feet at (0,0),
 * hat top near y = -844. Pale lotus shirt, a checked lungi of monsoon-blue leaves, a red-and-green gamcha on the
 * shoulder, and a woven mathal hat of leaf strips. `cls` must be unique on the page (it prefixes classes and ids).
 */
export function farmer(cls: string, seed = 42): Farmer {
  const r = rng(seed);
  const parts: Part[] = [];
  const SK = ['var(--lf-skinlit)', 'var(--lf-skin)', 'var(--lf-skinmd)'];
  const SH = ['var(--lf-shirtlt)', 'var(--lf-shirt)', 'var(--lf-lotus)'];
  const LU = ['var(--lf-clothlt)', 'var(--lf-cloth)', 'var(--lf-clothdk)'];
  const GA = ['var(--lf-second)', 'var(--lf-leaf2)', 'var(--lf-strawdk)'];
  const HA = ['var(--lf-ink)', 'var(--lf-leaf)', 'var(--lf-skindk)'];
  const P = (name: string, at: number, poly: number[][], o: PartOpts) => {
    const p = part(r, cls, name, poly, o);
    p.at = at;
    parts.push(p);
    return p.markup;
  };
  const arm = (s: string, at: number) =>
    P(`${s}u`, at, [[-14, 70], [14, 70], [12, 168], [-12, 168]], { fill: 'var(--lf-skin)', tones: SK, n: 10, l: 16, w: 8, a: 90, ja: 30, edge: 2 }) +
    P(`${s}s`, at, [[-19, -10], [19, -10], [18, 84], [-17, 84]], { fill: 'var(--lf-shirt)', tones: SH, n: 14, l: 20, w: 10, a: 80, ja: 40, edge: 3 }) +
    `<g class="${cls}-fore${s}">` +
    P(`${s}f`, at + 0.05, [[-12, -6], [12, -6], [10, 142], [-9, 142]], { fill: 'var(--lf-skin)', tones: SK, n: 14, l: 16, w: 8, a: 90, ja: 30, edge: 3 }) +
    `<g class="${cls}-hand${s}">` +
    P(`${s}h`, at + 0.08, [[-12, -2], [12, -2], [15, 20], [9, 36], [-8, 36], [-14, 20]], { fill: 'var(--lf-skindk)', tones: SK, n: 6, l: 14, w: 8, a: 90, ja: 50, edge: 2 }) +
    `</g></g>`;
  const face =
    `<g class="${cls}-face">` +
    `<path d="${lf(-14, -726, 26, 16, 80)}" style="fill:var(--lf-skindk)"/>` +
    `<path d="${lf(32, -688, 42, 12, -18)}" style="fill:var(--lf-skindk);opacity:.5"/>` +
    `<path class="${cls}-cheek" d="${lf(35, -716, 22, 12, -15)}" style="fill:var(--lf-skinlit)"/>` +
    `<path d="M50 -744 Q62 -722 65 -712 Q58 -705 50 -709 Z" style="fill:var(--lf-skindk)"/>` +
    `<g class="${cls}-eyes"><path d="${lf(26, -734, 16, 8, 0)}" style="fill:var(--lf-ground)"/><path d="${lf(29, -734, 7, 6, 0)}" style="fill:var(--lf-ink)"/>` +
    `<path d="${lf(46, -734, 10, 6, 0)}" style="fill:var(--lf-ground)"/><path d="${lf(48, -734, 5, 5, 0)}" style="fill:var(--lf-ink)"/></g>` +
    `<path class="${cls}-browN" d="${lf(0, 0, 26, 7, 0, 0.3)}" style="fill:var(--lf-ink)"/>` +
    `<path class="${cls}-browF" d="${lf(0, 0, 15, 6, 0, 0.3)}" style="fill:var(--lf-ink)"/>` +
    `<path class="${cls}-teeth" style="fill:var(--lf-ground);stroke:var(--lf-skindk);stroke-width:2.5;stroke-linejoin:round"/>` +
    `<path class="${cls}-mouth" style="fill:none;stroke:var(--lf-skindk);stroke-width:4;stroke-linecap:round"/>` +
    `<path d="${lf(44, -703, 20, 7, 8)}${lf(56, -702, 12, 6, -22)}" style="fill:var(--lf-ink)"/></g>`;
  let s1 = '';
  let s2 = '';
  for (let i = 0; i <= 18; i++) {
    const u = i / 18;
    const bx = -116 + u * 244;
    const by = -770 + Math.sin(u * Math.PI) * 18;
    const dx = bx + 2;
    const dy = by + 842;
    const leaf = lf((bx - 2) / 2, (by - 842) / 2, Math.hypot(dx, dy) * 1.04, 11, (Math.atan2(dy, dx) * 180) / Math.PI);
    if (i % 2) s1 += leaf;
    else s2 += leaf;
  }
  const cone = 'M-120 -770 Q-60 -812 -2 -844 Q62 -812 130 -770 Q6 -736 -120 -770 Z';
  const hat =
    `<g class="${cls}-hat"><clipPath id="${cls}-hatclip"><path d="${cone}"/></clipPath><path d="${cone}" style="fill:var(--lf-straw)"/>` +
    `<g clip-path="url(#${cls}-hatclip)"><path d="${s1}" style="fill:var(--lf-strawdk)"/><path d="${s2}" style="fill:var(--lf-shirtlt)"/></g>` +
    `<path d="M-66 -797 Q2 -780 74 -797" style="fill:none;stroke:var(--lf-second);stroke-width:5;stroke-linecap:round"/>` +
    `<path d="M-120 -770 Q6 -736 130 -770" style="fill:none;stroke:var(--lf-strawdk);stroke-width:7;stroke-linecap:round"/></g>`;
  const markup =
    `<g class="${cls}">` +
    `<g class="${cls}-armF">${arm('F', 0.42)}</g>` +
    P('legF', 0, [[10, -84], [30, -84], [34, -16], [60, -6], [58, 2], [14, 2]], { fill: 'var(--lf-skin)', tones: SK, n: 8, l: 14, w: 7, a: 90, ja: 30, edge: 2 }) +
    P('legN', 0.02, [[-36, -86], [-12, -86], [-8, -20], [22, -9], [20, 0], [-36, 0]], { fill: 'var(--lf-skin)', tones: SK, n: 8, l: 14, w: 7, a: 90, ja: 30, edge: 2 }) +
    P('lungi', 0.12, [[-64, -430], [60, -430], [66, -300], [78, -88], [60, -66], [-20, -60], [-80, -70], [-74, -300]], { fill: 'var(--lf-cloth)', tones: LU, n: 64, l: 26, w: 12, a: 90, ja: 26, grid: 30, edge: 10 }) +
    P('shirt', 0.3, [[-82, -632], [-42, -648], [20, -650], [78, -636], [72, -560], [66, -470], [68, -396], [-68, -396], [-72, -470], [-76, -560]], { fill: 'var(--lf-shirt)', tones: SH, n: 56, l: 28, w: 13, a: 65, ja: 50, edge: 10 }) +
    P('neck', 0.5, [[-18, -684], [16, -680], [20, -632], [-22, -634]], { fill: 'var(--lf-skin)', tones: SK, n: 8, l: 14, w: 7, a: 90, ja: 30, edge: 0 }) +
    P('gamcha', 0.46, [[-86, -640], [-50, -652], [-38, -600], [-42, -516], [-64, -512], [-72, -590]], { fill: 'var(--lf-second)', tones: GA, n: 22, l: 16, w: 8, a: 85, ja: 20, grid: 13, edge: 4 }) +
    `<g class="${cls}-head">` +
    P('skull', 0.58, [[30, -676], [8, -680], [-16, -690], [-34, -712], [-42, -738], [-36, -764], [-18, -782], [8, -788], [32, -780], [46, -764], [52, -744], [54, -734], [64, -714], [60, -708], [52, -706], [54, -698], [50, -688], [44, -680]], { fill: 'var(--lf-skin)', tones: SK, n: 26, l: 14, w: 7, a: 100, ja: 70, edge: 0 }) +
    P('hair', 0.62, [[-44, -740], [-40, -768], [-20, -788], [10, -792], [36, -784], [22, -772], [-4, -768], [-20, -754], [-26, -728], [-36, -704]], { fill: 'var(--lf-ink)', tones: HA, n: 18, l: 18, w: 7, a: 120, ja: 40, edge: 4 }) +
    `<path d="${lf(18, -763, 104, 16, -4)}" style="fill:var(--lf-shade)"/>${face}${hat}</g>` +
    `<g class="${cls}-armN">${arm('N', 0.4)}</g></g>`;

  type Refs = Record<'armF' | 'armN' | 'foreF' | 'foreN' | 'handF' | 'handN' | 'head' | 'hat' | 'eyes' | 'browN' | 'browF' | 'mouth' | 'teeth' | 'cheek', SVGElement>;
  let R: Refs | null = null;
  const set = (el: SVGElement, v: string) => el.setAttribute('transform', v);
  return {
    markup,
    bind(root: Element) {
      const q = (s: string) => root.querySelector(`.${cls}${s}`) as SVGElement;
      R = {
        armF: q('-armF'), armN: q('-armN'), foreF: q('-foreF'), foreN: q('-foreN'), handF: q('-handF'), handN: q('-handN'), head: q('-head'), hat: q('-hat'),
        eyes: q('-eyes'), browN: q('-browN'), browF: q('-browF'), mouth: q('-mouth'), teeth: q('-teeth'), cheek: q('-cheek'),
      };
      for (const p of parts) {
        const g = q(`-${p.name}`);
        const ed = g.querySelectorAll(`:scope > .${cls}-edge`);
        p.base = g.querySelector(`.${cls}-base`);
        p.tex = g.querySelector('g');
        p.edges.forEach((e, i) => {
          e.el = ed[i] as SVGElement;
        });
      }
    },
    render(o: FarmerState) {
      if (!R) return;
      const t = o.t;
      const g = o.g ?? 1;
      const hp = o.hat ?? 1;
      set(R.armF, `translate(70 -628) rotate(${o.fu.toFixed(2)})`);
      set(R.foreF, `translate(0 165) rotate(${o.ff.toFixed(2)})`);
      set(R.handF, 'translate(0 140)');
      set(R.armN, `translate(-58 -622) rotate(${o.nu.toFixed(2)})`);
      set(R.foreN, `translate(0 165) rotate(${o.nf.toFixed(2)})`);
      set(R.handN, 'translate(0 140)');
      set(R.head, `rotate(${(o.hd + Math.sin(t * 2.1) * 0.8).toFixed(2)} 0 -672)`);
      set(R.hat, `translate(${f1((1 - hp) * 60)} ${f1(-(1 - hp) * 300)}) rotate(${((1 - hp) * -30).toFixed(2)} 6 -790)`);
      const lift = o.lift ?? 0;
      const knit = o.knit ?? 0;
      const sm = o.smile ?? 0;
      const op = o.open ?? 0;
      set(R.browN, `translate(24 ${f1(-750 - lift * 6 - knit * 2)}) rotate(${f1(-knit * 18 - lift * 4)})`);
      set(R.browF, `translate(47 ${f1(-750 - lift * 5 - knit * 2)}) rotate(${f1(knit * 18 + lift * 3)})`);
      const lid = Math.max(o.lid ?? 0, sm > 0.6 ? (sm - 0.6) * 1.1 : 0);
      set(R.eyes, `translate(0 -734) scale(1 ${(1 - lid * 0.85).toFixed(3)}) translate(0 734)`);
      const yl = -692 - sm * 3;
      const yr = -691 - sm * 4.5;
      const cy = -691 + sm * 7;
      R.mouth.setAttribute('d', `M40 ${f1(yl)} Q47 ${f1(cy)} 56 ${f1(yr)}`);
      R.teeth.setAttribute('d', op > 0.01 ? `M40 ${f1(yl)} Q47 ${f1(cy)} 56 ${f1(yr)} L56 ${f1(yr + op * 3)} Q47 ${f1(cy + op * 10)} 40 ${f1(yl + op * 3)} Z` : 'M0 0');
      set(R.cheek, `translate(0 ${f1(-Math.max(0, sm) * 4)})`);
      for (const p of parts) {
        const pp = eo(clamp01((g - p.at * 0.6) / 0.4));
        if (p.base) p.base.style.opacity = String(pp);
        if (p.tex) p.tex.style.opacity = String(pp);
        for (const e of p.edges) {
          const ep = eo(clamp01((g - p.at * 0.6 - e.at * 0.12) / 0.32));
          const k = 1 - ep;
          e.el?.setAttribute(
            'transform',
            `translate(${f1(e.x + e.fx * k + Math.sin(ep * Math.PI) * 50)} ${f1(e.y + e.fy * k)}) rotate(${f1(e.a + e.spin * k + Math.sin(t * 3 + e.at * 6) * 5)})`,
          );
        }
      }
    },
  };
}

/** The phone: a dark body of pressed leaf, its rim woven from two colours of stalk, a pale leaf screen. Held at its foot. */
export function phone(cls: string): string {
  const rim = 'x="-52" y="-196" width="104" height="204" rx="24"';
  return (
    `<g class="${cls}"><rect ${rim} style="fill:var(--lf-ink)"/>` +
    `<rect ${rim} style="fill:none;stroke:var(--lf-strawdk);stroke-width:6;stroke-dasharray:16 8"/>` +
    `<rect ${rim} style="fill:none;stroke:var(--lf-leaf2);stroke-width:6;stroke-dasharray:8 16;stroke-dashoffset:-12"/>` +
    `<rect x="-40" y="-182" width="80" height="166" rx="14" style="fill:var(--lf-glint)"/>` +
    `<path d="${lf(2, -104, 52, 26, -50, 0.2)}" style="fill:var(--lf-leaf3)"/><path d="${lf(-6, -96, 12, 6, -40)}${lf(10, -112, 9, 5, -60)}" style="fill:var(--lf-skindk)"/>` +
    `<rect class="${cls}-bar" x="-36" y="-178" width="72" height="5" rx="2" style="fill:var(--lf-second)"/>` +
    `<path d="${lf(0, -4, 22, 8, 0)}" style="fill:var(--lf-leaf3)"/></g>`
  );
}

export type LeafRender = { x: number; y: number; a: number; s: number; les?: number; heal?: number };
export type LeafActor = { markup: string; bind(root: Element): void; render(o: LeafRender): void; el: SVGElement | null };

/** Spots on the sick leaf, in its own units: x, y, length, angle. */
export const SPOTS: [number, number, number, number][] = [
  [110, -18, 66, -8],
  [196, 16, 58, 10],
  [254, -12, 38, -4],
];

/**
 * A broad leaf built of small leaves on a stalk midrib, stem at (0,0), growing along +x. kind 'blast': spindle-shaped
 * blast spots (brown grain rims, ash-grey centres). kind 'odd': soft pale blotches the photo AI can't name.
 */
export function sickLeaf(cls: string, kind: 'blast' | 'odd' = 'blast', seed = 31): LeafActor {
  const r = rng(seed);
  const out = lf(160, 0, 320, 132, 0, 0.12);
  const tex = ['', '', ''];
  let veins = 'M-6 0 Q120 -6 316 2';
  for (let i = 0; i < 46; i++) {
    const u = r();
    const x = 20 + u * 280;
    const hw = Math.sin(u * Math.PI) * 58;
    const y = (r() - 0.5) * 2 * hw;
    tex[Math.floor(r() * 3)] += lf(x, y, 22 + r() * 18, 10 + r() * 6, (y < 0 ? -35 : 35) + (r() - 0.5) * 30, 0.2);
  }
  for (let i = 1; i < 8; i++) {
    const x = i * 38;
    const e = (Math.sin((i / 8) * Math.PI) * 52).toFixed(0);
    veins += `M${x} 0 Q${x + 26} -22 ${x + 42} -${e}M${x} 0 Q${x + 26} 22 ${x + 42} ${e}`;
  }
  const spots = SPOTS.map((s) => {
    let grains = '';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 6.283;
      grains += lf(Math.cos(a) * s[2] * 0.48, Math.sin(a) * s[2] * 0.19, 10, 5, a * 57.3 + 90);
    }
    return kind === 'blast'
      ? `<g class="${cls}-spot"><path d="${lf(0, 0, s[2], s[2] * 0.44, 0)}" style="fill:var(--lf-skindk)"/>` +
          `<path d="${lf(0, 0, s[2] * 0.62, s[2] * 0.2, 0)}" style="fill:var(--lf-ash)"/><path d="${grains}" style="fill:var(--lf-second)"/></g>`
      : `<g class="${cls}-spot"><path d="${lf(0, 0, s[2] * 1.1, s[2] * 0.7, 20, 0.3)}" style="fill:var(--lf-lilac);opacity:.85"/>` +
          `<path d="${grains}" style="fill:var(--lf-clothlt)"/></g>`;
  }).join('');
  const markup =
    `<g class="${cls}"><path d="M-26 4 Q-10 2 4 0" style="fill:none;stroke:var(--lf-leaf);stroke-width:7;stroke-linecap:round"/>` +
    `<clipPath id="${cls}-clip"><path d="${out}"/></clipPath><path d="${out}" style="fill:var(--lf-leaf2)"/>` +
    `<g clip-path="url(#${cls}-clip)"><path d="${tex[0]}" style="fill:var(--lf-leaf3)"/><path d="${tex[1]}" style="fill:var(--lf-leaf)"/><path d="${tex[2]}" style="fill:var(--lf-leaf4)"/>` +
    `<path d="${veins}" style="fill:none;stroke:var(--lf-sage);stroke-width:3;stroke-linecap:round"/>${spots}</g>` +
    `<path d="${out}" style="fill:none;stroke:var(--lf-leaf);stroke-width:3"/></g>`;
  let els: SVGElement[] = [];
  const actor: LeafActor = {
    markup,
    el: null,
    bind(root: Element) {
      actor.el = root.querySelector(`.${cls}`);
      els = Array.from(root.querySelectorAll(`.${cls}-spot`));
    },
    render(o: LeafRender) {
      actor.el?.setAttribute('transform', `translate(${f1(o.x)} ${f1(o.y)}) rotate(${o.a.toFixed(2)}) scale(${Math.max(0.001, o.s).toFixed(3)})`);
      els.forEach((el, i) => {
        const s = SPOTS[i]!;
        const k = eob(clamp01(((o.les ?? 0) - i * 0.22) / 0.5), 1.5);
        el.setAttribute('transform', `translate(${s[0]} ${s[1]}) rotate(${s[3]}) scale(${Math.max(0.001, k).toFixed(3)})`);
        el.style.opacity = String(1 - (o.heal ?? 0));
      });
    },
  };
  return actor;
}

/** A rice plant at full growth: five blades and a drooping head of ripe grain. Base at (0,0). */
export function plant(r: Rng, h: number): string {
  let b = '';
  let gr = '';
  for (let i = 0; i < 5; i++) b += blade((i - 2) * 3, 0, h * (0.6 + r() * 0.4), (i - 2) * h * 0.18 + (r() - 0.5) * 20, 7);
  const tx = (r() - 0.3) * 30;
  const top = -h * 1.05;
  const stalk = `M0 0 Q${f1(tx * 0.5)} ${f1(top * 0.6)} ${f1(tx)} ${f1(top)} Q${f1(tx + 34)} ${f1(top - 6)} ${f1(tx + 46)} ${f1(top + 60)}`;
  for (let k = 0; k < 9; k++) {
    const u = k / 8;
    const x = tx + 44 * u;
    const y = top - 6 * Math.sin(u * Math.PI) + 60 * u * u;
    gr += lf(x + 6, y, 16, 8, 50 + u * 40) + lf(x - 4, y + 6, 14, 7, 110 + u * 20);
  }
  return (
    `<path d="${b}" style="fill:var(--lf-${r() < 0.5 ? 'leaf2' : 'leaf'})"/><path d="${stalk}" style="fill:none;stroke:var(--lf-strawdk);stroke-width:4;stroke-linecap:round"/>` +
    `<path d="${gr}" style="fill:var(--lf-grain)"/>`
  );
}
