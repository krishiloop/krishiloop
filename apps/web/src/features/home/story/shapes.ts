/**
 * The six pictures of the hero story, as targets for a field of leaves (lazy chunk with field.ts). Every picture is n
 * points in a box from -1 to 1 (y down), each with an angle (leaves lie along the line they draw), a colour from the
 * painter's palette, a life (how it moves once in place), a length and width (a grain is short and round, a raindrop
 * long and thin) and an opacity. Drawn by hand in code: an ILLUSTRATION, never data (the hot spots on the map are not
 * real reports; the hero labels it).
 */

/** The painter's palette (index.css): the leaves are the pure pastels, so the field reads as art on the forest band. */
export const PALETTE = [
  '#b9cfa8', // 0 moss (pale sage, young paddy)
  '#8fc26a', // 1 paddy green
  '#f2d98b', // 2 butter (rice straw)
  '#e2a93b', // 3 mustard (the action colour)
  '#ef9e80', // 4 terracotta
  '#f0b9b4', // 5 lotus
  '#a8d1df', // 6 monsoon
  '#c6b7e4', // 7 hyacinth
  '#f3eee2', // 8 cream
  '#b7d98a', // 9 sprout (something checks out)
  '#c97a55', // 10 clay (a lesion's rim)
] as const;
const MOSS = 0, GREEN = 1, BUTTER = 2, MUSTARD = 3, TERRA = 4, LOTUS = 5, MONSOON = 6, HYACINTH = 7, CREAM = 8, SPROUT = 9, CLAY = 10;

/** How a leaf lives once in place. */
export const LIFE = { still: 0, sway: 1, rain: 2, pulse: 3, bracket: 4, orbit: 5, drift: 6 } as const;

export type Shape = {
  x: Float32Array;
  y: Float32Array;
  a: Float32Array;
  c: Uint8Array;
  k: Uint8Array;
  l: Float32Array;
  w: Float32Array;
  o: Float32Array;
  /** the centre the detection corners breathe around (picture 2) */
  bx: number;
  by: number;
};

type Sample = [x: number, y: number, a: number, c: number, k: number, l: number, w: number, o: number];
type Rand = () => number;
type Part = [weight: number, make: (r: Rand, j: number, count: number) => Sample];

function rng(seed: number): Rand {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const pick = (r: Rand, xs: readonly number[]) => xs[Math.floor(r() * xs.length)]!;
const jit = (r: Rand, s: number) => (r() - 0.5) * 2 * s;

/** A point and its direction along a curve given as a function of t in [0, 1]. */
function along(f: (t: number) => [number, number], t: number): [number, number, number] {
  const [x, y] = f(t);
  const [x2, y2] = f(Math.min(1, t + 0.01));
  const [x1, y1] = f(Math.max(0, t - 0.01));
  return [x, y, Math.atan2(y2 - y1, x2 - x1)];
}
const quad = (p0: number[], p1: number[], p2: number[]) => (t: number): [number, number] => {
  const u = 1 - t;
  return [u * u * p0[0]! + 2 * u * t * p1[0]! + t * t * p2[0]!, u * u * p0[1]! + 2 * u * t * p1[1]! + t * t * p2[1]!];
};
const cubic = (p0: number[], p1: number[], p2: number[], p3: number[]) => (t: number): [number, number] => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0]! + b * p1[0]! + c * p2[0]! + d * p3[0]!, a * p0[1]! + b * p1[1]! + c * p2[1]! + d * p3[1]!];
};
const polyline = (pts: number[][]) => {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0]! - pts[i]![0]!, p[1]! - pts[i]![1]!));
  const total = seg.reduce((s, v) => s + v, 0);
  return (t: number): [number, number] => {
    let d = t * total;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i]! || i === seg.length - 1) {
        const f = seg[i]! ? Math.min(1, d / seg[i]!) : 0;
        const a = pts[i]!, b = pts[i + 1]!;
        return [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f];
      }
      d -= seg[i]!;
    }
    return [pts[0]![0]!, pts[0]![1]!];
  };
};

/** Leaves drifting round the picture: the same quiet air in every scene. */
const ambient = (colors: readonly number[], o = 0.5): Part[1] => (r) => {
  const th = r() * TAU;
  const rad = 0.8 + r() * 0.36;
  return [Math.cos(th) * rad * 1.08, Math.sin(th) * rad, r() * TAU, pick(r, colors), LIFE.drift, 0.8 + r() * 0.3, 0.9, o * (0.6 + r() * 0.4)];
};

function build(n: number, parts: Part[], seed: number, bx = 0, by = 0): Shape {
  const r = rng(seed);
  const total = parts.reduce((s, p) => s + p[0], 0);
  const counts = parts.map((p) => Math.floor((p[0] / total) * n));
  let left = n - counts.reduce((s, c) => s + c, 0);
  for (let i = 0; left > 0; i = (i + 1) % counts.length, left--) counts[i]!++;
  const samples: Sample[] = [];
  parts.forEach(([, make], pi) => {
    const c = counts[pi]!;
    for (let j = 0; j < c; j++) samples.push(make(r, j, c));
  });
  // the same order in every picture (by angle round the centre, a little shuffled), so a leaf travels to the same side of
  // the next picture: the field morphs instead of exploding
  const key = samples.map((s) => Math.atan2(s[1], s[0]) + r() * 0.5);
  const order = samples.map((_, i) => i).sort((a, b) => key[a]! - key[b]!);
  const out: Shape = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    a: new Float32Array(n),
    c: new Uint8Array(n),
    k: new Uint8Array(n),
    l: new Float32Array(n),
    w: new Float32Array(n),
    o: new Float32Array(n),
    bx,
    by,
  };
  order.forEach((si, i) => {
    const s = samples[si]!;
    out.x[i] = s[0];
    out.y[i] = s[1];
    out.a[i] = s[2];
    out.c[i] = s[3];
    out.k[i] = s[4];
    out.l[i] = s[5];
    out.w[i] = s[6];
    out.o[i] = s[7];
  });
  return out;
}

/* ------------------------------------------------------------------ 1 the field: a rice plant, swaying */
function ricePlant(n: number): Shape {
  const base = [0, 0.9];
  const blades = [-0.98, -0.72, -0.46, -0.22, 0.02, 0.24, 0.5, 0.76, 1.0].map((phi, b) => {
    const L = 1.5 - Math.abs(phi) * 0.42;
    const p0 = [base[0]! + phi * 0.05, base[1]!];
    const p1 = [p0[0]! + Math.sin(phi) * L * 0.32, p0[1]! - L * 0.92];
    const p2 = [p0[0]! + Math.sin(phi) * L * 0.98, p0[1]! - L * (0.98 - Math.abs(phi) * 0.62)];
    return { f: quad(p0, p1, p2), b };
  });
  const panicles = [
    [-0.42, -1],
    [0.12, 1],
    [0.52, 1],
  ].map(([x, dir]) => cubic([x! * 0.15, 0.9], [x! * 0.25, -0.2], [x! * 0.75 + dir! * 0.05, -1.02], [x! * 1.15 + dir! * 0.3, -0.62]));
  return build(
    n,
    [
      [
        50,
        (r) => {
          const bl = pick(r, blades.map((_, i) => i));
          const t = 0.06 + Math.pow(r(), 0.85) * 0.94;
          const [x, y, a] = along(blades[bl]!.f, t);
          return [x + jit(r, 0.012), y + jit(r, 0.012), a, t > 0.72 ? pick(r, [SPROUT, GREEN]) : pick(r, [GREEN, GREEN, MOSS]), LIFE.sway, 1.05, 1 - t * 0.35, 0.95];
        },
      ],
      [
        27,
        (r, j) => {
          const f = panicles[j % 3]!;
          const t = 0.58 + r() * 0.42;
          const [x, y, a] = along(f, t);
          const side = j % 2 ? 1 : -1;
          const off = 0.035 * side;
          return [x - Math.sin(a) * off, y + Math.cos(a) * off, a + side * 0.62, pick(r, [BUTTER, BUTTER, MUSTARD]), LIFE.sway, 0.62, 1.2, 1];
        },
      ],
      [
        5,
        (r, j) => {
          const [x, y, a] = along(panicles[j % 3]!, r() * 0.58);
          return [x, y, a, MOSS, LIFE.sway, 1.1, 0.42, 0.85];
        },
      ],
      [
        8,
        (r) => {
          const x = jit(r, 0.78);
          const y = 0.94 + Math.abs(jit(r, 0.05)) + (Math.abs(x) > 0.5 ? 0.02 : 0);
          return [x, y, jit(r, 0.06), MONSOON, LIFE.still, 1.5, 0.32, 0.55 + r() * 0.3];
        },
      ],
      [10, ambient([MOSS, BUTTER, LOTUS, SPROUT])],
    ],
    11,
  );
}

/* ------------------------------------------------------------------ 2 one leaf with a lesion, and the crop doctor's corners */
function sickLeaf(n: number): Shape {
  const S = [-0.82, 0.62];
  const T = [0.84, -0.62];
  const ax = T[0]! - S[0]!, ay = T[1]! - S[1]!;
  const len = Math.hypot(ax, ay);
  const ux = ax / len, uy = ay / len;
  const nx = -uy, ny = ux;
  const axis = Math.atan2(uy, ux);
  const hw = (u: number) => 0.46 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, u)))), 0.8) * (1 - 0.18 * u);
  const at = (u: number, v: number): [number, number] => [S[0]! + ux * u * len + nx * v, S[1]! + uy * u * len + ny * v];
  const lesion = at(0.56, 0.08);
  const lesion2 = at(0.33, -0.12);
  return build(
    n,
    [
      [
        16,
        (r) => {
          const side = r() < 0.5 ? 1 : -1;
          const [x, y, a] = along((t) => at(t, side * hw(t)), 0.02 + r() * 0.96);
          return [x, y, a, pick(r, [GREEN, GREEN, SPROUT]), LIFE.still, 1, 0.8, 1];
        },
      ],
      [
        7,
        (r) => {
          const u = -0.08 + r() * 1.06;
          const [x, y] = at(u, 0);
          return [x, y, axis, u < 0 ? MOSS : SPROUT, LIFE.still, 1.1, 0.5, 0.9];
        },
      ],
      [
        22,
        (r, j) => {
          const v0 = 0.1 + (j % 8) * 0.105;
          const side = j % 2 ? 1 : -1;
          const t = r();
          const u = v0 + t * 0.13;
          const [x, y, a] = along((s) => at(v0 + s * 0.13, side * hw(v0 + s * 0.13) * 0.88 * s), t);
          return [x, y, a, u > 0.9 ? SPROUT : pick(r, [MOSS, SPROUT]), LIFE.still, 0.85, 0.5, 0.75];
        },
      ],
      [
        26,
        (r) => {
          const u = 0.04 + r() * 0.92;
          const [x, y] = at(u, jit(r, hw(u) * 0.86));
          return [x, y, axis + jit(r, 0.5), pick(r, [GREEN, MOSS]), LIFE.still, 0.9, 0.85, 0.5];
        },
      ],
      [
        13,
        (r, j) => {
          const big = j % 3 !== 0;
          const c = big ? lesion : lesion2;
          const rr = Math.sqrt(r());
          const th = r() * TAU;
          const ex = (big ? 0.17 : 0.1) * rr * Math.cos(th);
          const ey = (big ? 0.075 : 0.05) * rr * Math.sin(th);
          return [c[0] + ux * ex + nx * ey, c[1] + uy * ex + ny * ey, axis + jit(r, 0.8), rr > 0.62 ? CLAY : rr > 0.35 ? TERRA : CREAM, LIFE.pulse, 0.75, 0.9, 1];
        },
      ],
      [
        9,
        (r, j) => {
          const corner = j % 4;
          const arm = (j >> 2) % 2;
          const sx = corner % 2 ? 1 : -1;
          const sy = corner < 2 ? -1 : 1;
          const W = 0.27, H = 0.21, A = 0.11;
          const t = r();
          const x = lesion[0] + sx * W - (arm ? 0 : sx * A * t);
          const y = lesion[1] + sy * H - (arm ? sy * A * t : 0);
          return [x, y, arm ? Math.PI / 2 : 0, MUSTARD, LIFE.bracket, 0.9, 0.62, 1];
        },
      ],
      [7, ambient([LOTUS, BUTTER, MOSS])],
    ],
    23,
    lesion[0],
    lesion[1],
  );
}

/* ------------------------------------------------------------------ 3 the weather warning: a cloud, rain and a bolt */
function rainCloud(n: number): Shape {
  const C = [
    [-0.44, -0.44, 0.27],
    [-0.1, -0.6, 0.36],
    [0.29, -0.5, 0.3],
    [0.55, -0.34, 0.2],
    [0.0, -0.34, 0.3],
    [-0.64, -0.3, 0.17],
  ] as const;
  const FLOOR = -0.2;
  const inside = (x: number, y: number) => y <= FLOOR && C.some(([cx, cy, cr]) => (x - cx) ** 2 + (y - cy) ** 2 < cr * cr);
  const bolt = polyline([
    [0.12, -0.2],
    [-0.02, 0.1],
    [0.11, 0.1],
    [-0.06, 0.44],
  ]);
  return build(
    n,
    [
      [
        18,
        (r) => {
          for (let tries = 0; tries < 40; tries++) {
            if (r() < 0.22) {
              const x = -0.76 + r() * 1.5;
              if (inside(x, FLOOR - 0.01)) return [x, FLOOR, 0, pick(r, [CREAM, HYACINTH]), LIFE.still, 1, 0.65, 0.95];
              continue;
            }
            const [cx, cy, cr] = C[Math.floor(r() * C.length)]!;
            const th = r() * TAU;
            const x = cx + Math.cos(th) * cr, y = cy + Math.sin(th) * cr;
            if (y > FLOOR || C.some(([ox, oy, or]) => (ox !== cx || oy !== cy) && (x - ox) ** 2 + (y - oy) ** 2 < or * or * 0.96)) continue;
            return [x, y, th + Math.PI / 2, pick(r, [CREAM, CREAM, HYACINTH]), LIFE.still, 1, 0.7, 1];
          }
          return [0, -0.6, 0, CREAM, LIFE.still, 1, 0.7, 1];
        },
      ],
      [
        25,
        (r) => {
          for (let tries = 0; tries < 60; tries++) {
            const x = -0.82 + r() * 1.62, y = -0.98 + r() * 0.78;
            if (inside(x, y)) return [x, y, jit(r, 0.5), pick(r, [HYACINTH, HYACINTH, MONSOON, CREAM]), LIFE.drift, 0.9, 1, 0.6];
          }
          return [0, -0.5, 0, HYACINTH, LIFE.still, 0.9, 1, 0.6];
        },
      ],
      [
        31,
        (r, j) => {
          const col = j % 11;
          const x = -0.6 + col * 0.12 + jit(r, 0.025);
          return [x, -0.14 + r() * 1.02, Math.PI / 2 + 0.16, pick(r, [MONSOON, MONSOON, MONSOON, CREAM]), LIFE.rain, 1.1, 0.36, 0.95];
        },
      ],
      [
        7,
        (r) => {
          const [x, y, a] = along(bolt, r());
          return [x + jit(r, 0.012), y, a, MUSTARD, LIFE.pulse, 0.9, 0.85, 1];
        },
      ],
      [
        10,
        (r, j) => {
          const big = j % 2;
          const th = r() * TAU;
          const rx = big ? 0.66 : 0.4, ry = big ? 0.075 : 0.045;
          return [Math.cos(th) * rx, 0.94 + Math.sin(th) * ry, th + Math.PI / 2 + (Math.sin(th) < 0 ? 0 : 0), MONSOON, LIFE.still, 0.85, 0.42, 0.65];
        },
      ],
      [9, ambient([MONSOON, HYACINTH, LOTUS])],
    ],
    37,
  );
}

/* ------------------------------------------------------------------ 4 the village disease map: Bangladesh with hot spots */
// Bangladesh at 48 x 66 cells (1 = land), rasterised from the radar map's district outlines (features/officer/radar/geo,
// geoBoundaries gbOpen BGD ADM2, CC BY 3.0 IGO), one hex digit per four cells, row by row. Borders are approximate.
const BD_W = 48;
const BD_H = 66;
const BD =
  '0000000000001800000000000660000000000e20000000001ff0000000003ff0400000003ff8c00000007fffe00000007fffe00000003fffe00000000fffe000000007ffe000000003ffe000000000ffe0000000007fe0000000003ff80000000fffffffebe00ffffffffff00ffffffffff87ffffffffffc7ffffffffff0fffffffffff0fffffffffff07fffffffffe03fffffffffe007ffffffff8001ffffffff0000fffffffc0001fffffff80000ffffffc00001ffffff800003ffffff800003ffffff800003ffffff80f001ffffff807000ffffff80f001ffffffc1f801ffffdfc1f8007fffffd1f8007fffdfd1f8007fffdff3f8007fffdffff8003fffeffffc007fffe7cffc007ffff7effc003ffff1d7fe003ffff913fe003ffff803fe003ffff981fe001fffd981fe001fffb901fe001feff000fe001ee7e000fe001ee60001fe000a800000fe0000000000fe0000000000fe00000000007e000000000077000000000061000000000060000000000020000000000030000000000010000000000010000000000000';

function bangladesh(n: number): Shape {
  // decode the hex rows once into one byte per cell
  const bits = new Uint8Array(BD_W * BD_H);
  for (let i = 0; i < BD.length; i++) {
    const h = parseInt(BD[i]!, 16);
    for (let b = 0; b < 4; b++) bits[i * 4 + b] = (h >> (3 - b)) & 1;
  }
  const land = (x: number, y: number) => (x < 0 || y < 0 || x >= BD_W || y >= BD_H ? 0 : bits[y * BD_W + x]!);
  const cell = 1.86 / BD_H;
  const x0 = -(BD_W * cell) / 2 + 0.02;
  const y0 = -0.93;
  const edge: [number, number, number][] = [];
  const inner: [number, number][] = [];
  for (let y = 0; y < BD_H; y++)
    for (let x = 0; x < BD_W; x++) {
      if (!land(x, y)) continue;
      const gx = land(x + 1, y - 1) + 2 * land(x + 1, y) + land(x + 1, y + 1) - land(x - 1, y - 1) - 2 * land(x - 1, y) - land(x - 1, y + 1);
      const gy = land(x - 1, y + 1) + 2 * land(x, y + 1) + land(x + 1, y + 1) - land(x - 1, y - 1) - 2 * land(x, y - 1) - land(x + 1, y - 1);
      if (!land(x + 1, y) || !land(x - 1, y) || !land(x, y + 1) || !land(x, y - 1)) edge.push([x, y, gx || gy ? Math.atan2(gy, gx) + Math.PI / 2 : 0]);
      else inner.push([x, y]);
    }
  const toU = (cx: number, cy: number): [number, number] => [x0 + (cx + 0.5) * cell, y0 + (cy + 0.5) * cell];
  // three hot spots, placed by hand for the picture (north-west, centre, south-west): not reports
  const spots = [
    [13, 24, 1],
    [28, 33, 1.25],
    [19, 47, 0.9],
  ].map(([cx, cy, s]) => [...toU(cx!, cy!), s!] as const);
  return build(
    n,
    [
      [
        47,
        (r) => {
          const [cx, cy, a] = edge[Math.floor(r() * edge.length)]!;
          const [x, y] = toU(cx + jit(r, 0.35), cy + jit(r, 0.35));
          return [x, y, a + jit(r, 0.2), pick(r, [MOSS, MOSS, SPROUT, CREAM]), LIFE.still, 1, 0.68, 0.95];
        },
      ],
      [
        19,
        (r) => {
          const [cx, cy] = inner[Math.floor(r() * inner.length)]!;
          const [x, y] = toU(cx + jit(r, 0.5), cy + jit(r, 0.5));
          return [x, y, -0.5 + jit(r, 0.35), pick(r, [GREEN, MOSS, MOSS]), LIFE.still, 0.85, 0.7, 0.42];
        },
      ],
      [
        26,
        (r, j) => {
          const [sx, sy, s] = spots[j % 3]!;
          const rr = Math.pow(r(), 0.75);
          const th = r() * TAU;
          const rad = 0.14 * s * rr;
          return [sx + Math.cos(th) * rad, sy + Math.sin(th) * rad, th + Math.PI / 2, rr < 0.4 ? TERRA : rr < 0.72 ? LOTUS : BUTTER, LIFE.pulse, 0.8, 0.9, 1];
        },
      ],
      [8, ambient([LOTUS, BUTTER, MOSS])],
    ],
    41,
  );
}

/* ------------------------------------------------------------------ 5 a receipt with a stamp and a tick */
function receipt(n: number): Shape {
  const rot = -0.07;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const R = (x: number, y: number, a: number): [number, number, number] => [x * cs - y * sn, x * sn + y * cs, a + rot];
  const L = -0.46, Rt = 0.46, Tp = -0.86, Bt = 0.72;
  const teeth = polyline(Array.from({ length: 17 }, (_, i) => [L + (i * (Rt - L)) / 16, Bt + (i % 2 ? 0.05 : 0)]));
  const rows = [
    [-0.7, 0.18, BUTTER, 0.95],
    [-0.54, 0.3, CREAM, 0.5],
    [-0.42, 0.08, CREAM, 0.5],
    [-0.3, 0.24, CREAM, 0.5],
    [-0.18, -0.02, CREAM, 0.5],
    [-0.06, 0.2, MOSS, 0.5],
  ] as const;
  const stamp = [0.13, 0.34, 0.27];
  const tick = polyline([
    [-0.03, 0.34],
    [0.08, 0.46],
    [0.29, 0.2],
  ]);
  return build(
    n,
    [
      [
        22,
        (r) => {
          const side = r();
          if (side < 0.24) return [...R(L + r() * (Rt - L), Tp, 0), CREAM, LIFE.still, 1, 0.6, 0.95] as Sample;
          if (side < 0.5) return [...R(L, Tp + r() * (Bt - Tp), Math.PI / 2), CREAM, LIFE.still, 1, 0.6, 0.95] as Sample;
          if (side < 0.76) return [...R(Rt, Tp + r() * (Bt - Tp), Math.PI / 2), CREAM, LIFE.still, 1, 0.6, 0.95] as Sample;
          const [x, y, a] = along(teeth, r());
          return [...R(x, y, a), CREAM, LIFE.still, 0.8, 0.6, 0.95] as Sample;
        },
      ],
      [
        28,
        (r, j) => {
          const [y, x1, c, w] = rows[j % rows.length]!;
          const x = -0.34 + r() * (x1 + 0.34);
          return [...R(x, y, 0), c, LIFE.still, 1.05, w, c === CREAM ? 0.7 : 0.95] as Sample;
        },
      ],
      [
        22,
        (r, j) => {
          const inner = j % 4 === 0;
          const th = r() * TAU;
          const rad = stamp[2]! * (inner ? 0.8 : 1) + jit(r, 0.015);
          return [...R(stamp[0]! + Math.cos(th) * rad, stamp[1]! + Math.sin(th) * rad, th + Math.PI / 2), MUSTARD, LIFE.still, 1, inner ? 0.5 : 0.8, inner ? 0.7 : 1] as Sample;
        },
      ],
      [
        14,
        (r) => {
          const [x, y, a] = along(tick, r());
          return [...R(x + jit(r, 0.012), y + jit(r, 0.012), a), SPROUT, LIFE.pulse, 1.05, 0.95, 1] as Sample;
        },
      ],
      [14, ambient([BUTTER, MOSS, LOTUS, MONSOON])],
    ],
    53,
  );
}

/* ------------------------------------------------------------------ 6 the KrishiLoop mark: an almost closed loop and its sprout */
function loopMark(n: number): Shape {
  // the mark (ui/kit/LoopMark.tsx): a ring with a gap at the top, the dot sitting in the gap
  const R0 = 0.64;
  const start = (-62 * Math.PI) / 180;
  const sweep = (309 * Math.PI) / 180;
  return build(
    n,
    [
      [
        62,
        (r) => {
          const th = start + r() * sweep;
          const rad = R0 + jit(r, 0.06);
          return [Math.cos(th) * rad, Math.sin(th) * rad, th + Math.PI / 2 + jit(r, 0.15), r() < 0.78 ? MUSTARD : BUTTER, LIFE.still, 1.05, 0.85, 1];
        },
      ],
      [
        14,
        (r) => {
          const th = r() * TAU;
          const rad = 0.17 * Math.sqrt(r());
          return [Math.cos(th) * rad, -R0 + Math.sin(th) * rad, th, pick(r, [SPROUT, SPROUT, GREEN]), LIFE.pulse, 0.85, 0.9, 1];
        },
      ],
      [
        24,
        (r) => {
          const th = r() * TAU;
          const rad = 0.86 + r() * 0.24;
          return [Math.cos(th) * rad, Math.sin(th) * rad, th + Math.PI / 2, pick(r, [BUTTER, LOTUS, MONSOON, HYACINTH, MOSS, TERRA]), LIFE.orbit, 0.95, 0.85, 0.8];
        },
      ],
    ],
    67,
  );
}

/** The six pictures, each built the first time it is asked for (the field builds the first two at once, the rest when idle). */
export function shapeBuilders(n: number): (() => Shape)[] {
  return [() => ricePlant(n), () => sickLeaf(n), () => rainCloud(n), () => bangladesh(n), () => receipt(n), () => loopMark(n)];
}
