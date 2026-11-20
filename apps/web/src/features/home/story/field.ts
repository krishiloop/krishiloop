import { DEPTH, LIFE, PALETTE, PALETTE_LIGHT, shapeBuilders, type Shape } from './shapes';
import { STEPS } from './steps';

/**
 * The leaf field (builder H v4, reworked by builder Ho v5): a few hundred small leaves on a 2D canvas that fly from one
 * picture of the hero story to the next. v5: the story plays by itself (HomeHero calls `go(step)` every few seconds),
 * so each change is one timed morph: the leaves set off in a wave, like wind crossing the field, fly on eased curved
 * paths (lifting toward the viewer mid-flight and tumbling), and settle softly. Behind and in front of the picture,
 * two depth layers of big, soft, blurred pastel leaves drift at their own speeds, and shift a little with the pointer
 * (parallax). A soft glow (a DOM element, moved with a transform) follows the story's subject.
 *
 * No WebGL: every leaf is one pre-drawn sprite per colour (the blurred ones are blurred once, when made), placed with
 * setTransform. Budget: 300 leaves at 30 fps on phones, 680 at the display's rate elsewhere; the loop stops off screen
 * and in a hidden tab. Reduced motion: no loop at all, each picture is drawn once, still.
 */
export type FieldApi = { destroy(): void; go(step: number): void; setDark(dark: boolean): void };
export type FieldOptions = {
  canvas: HTMLCanvasElement;
  /** the soft light that follows the subject (moved with --gx / --gy, a CSS transform transition) */
  glow?: HTMLElement | null;
  step: number;
  reduced: boolean;
  mobile: boolean;
  dark: boolean;
};

const SPR_L = 40; // sprite size in CSS px (drawn at the device pixel ratio)
const SPR_W = 18;
/** seconds one change of picture takes, from the first leaf leaving to the last one landing */
const MORPH = 2.2;
/** the share of that time over which the leaves set off (the wave) */
const WAVE = 0.42;
/** where each picture's subject is (the glow sits there), in the pictures' -1..1 box; picture 2 uses its lesion */
const SUBJECT: [number, number][] = [
  [0.02, -0.32], // the rice plant's ears
  [0.03, -0.94], // the potato flower
  [0.2, 0.4], // the tomatoes
  [0, 0], // the lesion (replaced by the shape's own centre)
  [-0.04, -0.42], // the cloud
  [-0.04, 0.02], // the map
  [0.13, 0.32], // the stamp and tick
  [0, 0], // the loop
];

type Spr = { img: HTMLCanvasElement; w: number; h: number };

function leafPath(g: CanvasRenderingContext2D, L: number, W: number, x0: number) {
  const m = W / 2;
  g.beginPath();
  g.moveTo(x0 + L * 0.04, m);
  g.bezierCurveTo(x0 + L * 0.28, W * 0.03, x0 + L * 0.7, W * 0.08, x0 + L * 0.975, m);
  g.bezierCurveTo(x0 + L * 0.7, W * 0.92, x0 + L * 0.28, W * 0.97, x0 + L * 0.04, m);
  g.closePath();
}

/** a crisp leaf: fill, light on the upper half, a darker midrib */
function sprite(color: string, dpr: number): Spr {
  const c = document.createElement('canvas');
  c.width = Math.ceil(SPR_L * dpr);
  c.height = Math.ceil(SPR_W * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  leafPath(g, SPR_L, SPR_W, 0);
  g.fillStyle = color;
  g.fill();
  const hi = g.createLinearGradient(0, 0, 0, SPR_W);
  hi.addColorStop(0, 'rgba(255,255,255,0.28)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0)');
  hi.addColorStop(1, 'rgba(20,38,28,0.18)');
  g.fillStyle = hi;
  g.fill();
  g.beginPath();
  g.moveTo(3, SPR_W / 2);
  g.quadraticCurveTo(SPR_L * 0.5, SPR_W / 2 - 0.8, SPR_L - 4, SPR_W / 2);
  g.strokeStyle = 'rgba(20,38,28,0.28)';
  g.lineWidth = 1.1;
  g.stroke();
  return { img: c, w: SPR_L, h: SPR_W };
}

/**
 * A soft, out-of-focus leaf for the depth layers: the leaf is drawn into a tiny canvas (one pixel for every `blur` CSS
 * pixels) and placed at full size, so the browser's smooth upscaling does the blurring. No shadow or filter blur, so
 * making all twelve costs almost nothing, and drawing one costs the same as a crisp leaf.
 */
function softSprite(color: string, L: number, blur: number): Spr {
  const W = L * 0.45;
  const pad = blur * 1.5;
  const w = L + pad * 2;
  const h = W + pad * 2;
  const k = 1 / Math.max(1, blur * 0.7);
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.ceil(w * k));
  c.height = Math.max(4, Math.ceil(h * k));
  const g = c.getContext('2d')!;
  g.scale(c.width / w, c.height / h);
  g.translate(pad, pad);
  leafPath(g, L, W, 0);
  g.fillStyle = color;
  g.fill();
  return { img: c, w, h };
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
/** smootherstep: no jolt as a leaf leaves, no bump as it lands */
const ease = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * v * (v * (v * 6 - 15) + 10));
const wrapAngle = (a: number) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const hash = (i: number, a: number, b: number) => {
  const r = Math.sin(i * a + b) * 43758.5453;
  return r - Math.floor(r);
};

export function startField({ canvas, glow, step: first, reduced, mobile, dark: dark0 }: FieldOptions): FieldApi {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {}, go() {}, setDark() {} };
  const n = mobile ? 360 : 960; // v6: a fuller, bolder picture (owner: "big and bold"); still one 2D canvas
  // the pictures: the one on screen now, the others one per idle moment (or at once when asked for), so starting the
  // field is one short task, not one long one
  const builders = shapeBuilders(n);
  const cache: (Shape | undefined)[] = [];
  const shape = (i: number): Shape => (cache[i] ??= builders[i]!());
  shape(first);
  type IdleWin = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  const w = window as IdleWin;
  let idle = 0;
  const later = (k: number) => {
    if (k >= STEPS) return;
    const next = () => {
      shape(k);
      later(k + 1);
    };
    idle = w.requestIdleCallback ? w.requestIdleCallback(next, { timeout: 2500 }) : window.setTimeout(next, 150);
  };
  later(0);
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2);
  let dark = dark0;
  let sprites: Spr[] = [];
  const paint = () => {
    sprites = (dark ? PALETTE : PALETTE_LIGHT).map((c) => sprite(c, dpr));
  };
  paint();
  // the soft depth leaves (tiny canvases, see softSprite)
  const far = reduced ? [] : DEPTH.map((c) => softSprite(c, 84, 6));
  const near = reduced ? [] : DEPTH.map((c) => softSprite(c, 150, 12));

  // per leaf: a seed, a size, which way it curls in flight, the push the pointer gave it (offset, velocity, spin),
  // where it is now (r*) and where its flight started (f*)
  const seed = new Float32Array(n);
  const size = new Float32Array(n);
  const curl = new Float32Array(n);
  const ox = new Float32Array(n);
  const oy = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const sp = new Float32Array(n);
  const sv = new Float32Array(n);
  const rx = new Float32Array(n), ry = new Float32Array(n), ra = new Float32Array(n), ro = new Float32Array(n);
  const rs = new Float32Array(n), rl = new Float32Array(n), rw = new Float32Array(n);
  const rc = new Uint8Array(n);
  const fx = new Float32Array(n), fy = new Float32Array(n), fa = new Float32Array(n), fo = new Float32Array(n);
  const fs = new Float32Array(n), fl = new Float32Array(n), fw = new Float32Array(n);
  const fc = new Uint8Array(n);
  const delay = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seed[i] = hash(i, 12.9898, 78.233);
    size[i] = 0.78 + hash(i, 4.1414, 3.7) * 0.44;
    curl[i] = (i % 2 ? 1 : -1) * (0.16 + seed[i]! * 0.28);
    // the first visit: the leaves blow in from the right, on the wind
    fx[i] = 1.3 + seed[i]! * 0.9;
    fy[i] = -1.1 + ((i * 0.618) % 1) * 2.2;
    fa[i] = seed[i]! * 6;
    fo[i] = 0;
    fs[i] = 1;
    fl[i] = 1;
    fw[i] = 1;
    fc[i] = shape(first).c[i]!;
  }

  // the depth layers: big soft leaves far behind (slow) and a few nearer (faster, at the edges)
  const NF = mobile ? 16 : 34;
  const NN = mobile ? 4 : 8;
  type Deep = { x: number; y: number; s: number; c: number; v: number; ph: number; spin: number };
  const mkDeep = (k: number, nearer: boolean): Deep => {
    const a = hash(k + (nearer ? 500 : 0), 7.13, 1.9);
    const b = hash(k + (nearer ? 500 : 0), 3.71, 8.2);
    const edge = nearer ? (k % 2 ? 0.02 + a * 0.12 : 0.86 + a * 0.12) : a;
    return { x: edge, y: b * 1.2 - 0.1, s: nearer ? 0.8 + b * 0.45 : 0.55 + b * 0.6, c: k % DEPTH.length, v: (nearer ? 0.03 : 0.012) + a * 0.012, ph: b * 6.28, spin: (a - 0.5) * 0.3 };
  };
  const farL = Array.from({ length: NF }, (_, k) => mkDeep(k, false));
  const nearL = Array.from({ length: NN }, (_, k) => mkDeep(k, true));

  let W = 0;
  let H = 0;
  let R = 1;
  let cx = 0;
  let cy = 0;
  let leaf = 12;
  let target = first;
  let m = reduced ? 1 : 0; // the morph's progress, 0 to 1
  let t = 0;
  let wind = 0;
  const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, on: false, t: 0, px: 0, py: 0, sx: 0, sy: 0 };

  const placeGlow = () => {
    if (!glow) return;
    const [gx, gy] = target === 3 ? [shape(3).bx, shape(3).by] : SUBJECT[target]!;
    glow.style.setProperty('--gx', `${(cx + gx * R).toFixed(1)}px`);
    glow.style.setProperty('--gy', `${(cy + gy * R).toFixed(1)}px`);
  };
  const resize = () => {
    const b = canvas.getBoundingClientRect();
    W = b.width;
    H = b.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    R = (Math.min(W, H) / 2) * 0.88;
    cx = W / 2;
    cy = H / 2;
    leaf = Math.max(9, Math.min(23, R * 0.072));
    placeGlow();
    if (reduced) draw(0);
  };

  /** one depth layer: soft leaves drifting down and across, shifted a little by the pointer */
  function drawDeep(list: Deep[], sprs: Spr[], alpha: number, par: number, dt: number) {
    if (!sprs.length) return;
    const g = ctx!;
    const base = Math.max(W, H);
    for (const d of list) {
      if (dt > 0) {
        d.y += d.v * dt;
        if (d.y > 1.15) d.y -= 1.3;
      }
      const sw = Math.sin(t * 0.35 + d.ph);
      const px = (d.x + sw * 0.025) * W - ptr.sx * par;
      const py = d.y * H - ptr.sy * par;
      const ang = d.ph + t * d.spin + sw * 0.35;
      const spr = sprs[d.c]!;
      const sc = (d.s * base) / 900;
      const co = Math.cos(ang) * sc;
      const si = Math.sin(ang) * sc;
      g.globalAlpha = alpha;
      g.setTransform(co * dpr, si * dpr, -si * dpr, co * dpr, px * dpr, py * dpr);
      g.drawImage(spr.img, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
    }
  }

  /** one frame: where every leaf is, how it moves, and paint it */
  function draw(dt: number) {
    const B = shape(target);
    const g = ctx!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!reduced) drawDeep(farL, far, dark ? 0.2 : 0.5, 10, dt);
    const rad = mobile ? 72 : 96;
    const rad2 = rad * rad;
    const physics = !reduced && dt > 0;
    const k = 1 - Math.exp(-dt * 7); // pointer velocity decay
    ptr.vx -= ptr.vx * k;
    ptr.vy -= ptr.vy * k;
    const span = 1 - WAVE;

    for (let i = 0; i < n; i++) {
      const sd = seed[i]!;
      const r = life(B.k[i]!, B.x[i]!, B.y[i]!, B.a[i]!, B.o[i]!, sd, B.bx, B.by);
      let x = r[0], y = r[1], ang = r[2], alpha = r[3], sc = r[4];
      let lm = B.l[i]!, wm = B.w[i]!;
      let ci = B.c[i]!;
      const u = reduced ? 1 : ease((m - delay[i]!) / span);
      if (u < 1) {
        // in flight: a curved path that lifts a little (a leaf on the wind), a tumble, and nearer to the eye mid-way
        const x0 = fx[i]!, y0 = fy[i]!;
        const dx = x - x0, dy = y - y0;
        const dist = Math.hypot(dx, dy);
        const qx = (x0 + x) / 2 - dy * curl[i]!;
        const qy = (y0 + y) / 2 + dx * curl[i]! - 0.16 * dist - 0.04;
        const v = 1 - u;
        x = v * v * x0 + 2 * u * v * qx + u * u * x;
        y = v * v * y0 + 2 * u * v * qy + u * u * y;
        const arc = Math.sin(Math.PI * u);
        ang = fa[i]! + wrapAngle(ang - fa[i]!) * u + arc * (sd - 0.5) * 6;
        alpha = fo[i]! + (alpha - fo[i]!) * u;
        sc = (fs[i]! + (sc - fs[i]!) * u) * (1 + 0.34 * arc);
        lm = fl[i]! + (lm - fl[i]!) * u;
        wm = fw[i]! + (wm - fw[i]!) * u;
        if (u < 0.5) ci = fc[i]!;
      }
      if (!reduced) ang += Math.sin(t * 1.7 + sd * 20) * 0.1;
      rx[i] = x; ry[i] = y; ra[i] = ang; ro[i] = alpha; rs[i] = sc; rl[i] = lm; rw[i] = wm; rc[i] = ci;

      let px = cx + x * R;
      let py = cy + y * R;
      if (physics) {
        let fxp = 0;
        let fyp = 0;
        if (ptr.on) {
          const ddx = px + ox[i]! - ptr.x;
          const ddy = py + oy[i]! - ptr.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < rad2) {
            const d = Math.sqrt(d2) + 0.5;
            const fall = (1 - d / rad) ** 2;
            fxp += (ddx / d) * 2600 * fall + ptr.vx * 9 * fall;
            fyp += (ddy / d) * 2600 * fall + ptr.vy * 9 * fall;
            sv[i]! += ((ddx / d) * ptr.vy - (ddy / d) * ptr.vx) * 0.004 * fall;
          }
        }
        vx[i]! += (fxp - 16 * ox[i]! - 5.2 * vx[i]!) * dt;
        vy[i]! += (fyp - 16 * oy[i]! - 5.2 * vy[i]!) * dt;
        ox[i]! += vx[i]! * dt;
        oy[i]! += vy[i]! * dt;
        sv[i]! -= (sv[i]! * 3 + sp[i]! * 10) * dt;
        sp[i]! += sv[i]! * dt;
      }
      px += ox[i]!;
      py += oy[i]!;
      ang += sp[i]!;
      if (alpha < 0.02) continue;

      const s = sc * size[i]! * (leaf / SPR_L);
      const L = lm * s;
      const Wd = wm * s;
      const co = Math.cos(ang);
      const si = Math.sin(ang);
      g.globalAlpha = alpha > 1 ? 1 : alpha;
      g.setTransform(co * L * dpr, si * L * dpr, -si * Wd * dpr, co * Wd * dpr, px * dpr, py * dpr);
      g.drawImage(sprites[ci]!.img, -SPR_L / 2, -SPR_W / 2, SPR_L, SPR_W);
    }
    if (!reduced) drawDeep(nearL, near, dark ? 0.16 : 0.34, 26, dt);
    g.globalAlpha = 1;
  }

  // the picture's life: x, y, angle, opacity, size (reused array, no garbage per leaf)
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 1];
  function life(kind: number, x: number, y: number, a: number, o: number, sd: number, bx: number, by: number) {
    let s = 1;
    if (kind === LIFE.sway) {
      const h = Math.max(0, Math.min(1, (0.92 - y) / 1.9));
      const wv = (Math.sin(t * 1.05 + sd * 0.7 + y * 0.9) * 0.05 + wind * 0.16) * h * h;
      x += wv;
      a += wv * 1.6;
    } else if (kind === LIFE.rain) {
      const top = -0.14;
      const span = 1.04;
      y = top + ((((y - top + t * (0.5 + sd * 0.25)) % span) + span) % span);
      x += (y - top) * 0.16;
      o *= Math.min(1, (y - top) / 0.12, (top + span - y) / 0.12);
    } else if (kind === LIFE.pulse) {
      s = 1 + Math.sin(t * 2.4 + sd * 6.28) * 0.16;
    } else if (kind === LIFE.bracket) {
      const kk = 1 + (0.5 + 0.5 * Math.sin(t * 2.1)) * 0.08;
      x = bx + (x - bx) * kk;
      y = by + (y - by) * kk;
    } else if (kind === LIFE.orbit) {
      const th = t * (0.1 + sd * 0.06);
      const c = Math.cos(th);
      const s2 = Math.sin(th);
      const nx = x * c - y * s2;
      y = x * s2 + y * c;
      x = nx;
      a += th;
    } else if (kind === LIFE.drift) {
      x += Math.sin(t * 0.33 + sd * 12) * 0.05;
      y += Math.cos(t * 0.29 + sd * 9) * 0.04;
      a += Math.sin(t * 0.2 + sd * 5) * 1.4;
    }
    out[0] = x;
    out[1] = y;
    out[2] = a;
    out[3] = o;
    out[4] = s;
    return out;
  }

  /** the wave: leaves set off from the left first (the wind's side), a little shuffled */
  const setDelays = () => {
    for (let i = 0; i < n; i++) delay[i] = WAVE * (0.62 * clamp01((fx[i]! + 1.1) / 2.2) + 0.38 * seed[i]!);
  };
  setDelays();

  // ---- the loop: only while on screen and the tab is visible; 30 fps on phones
  let raf = 0;
  let last = 0;
  let onScreen = true;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (mobile && now - last < 31) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    m = Math.min(1, m + dt / MORPH);
    wind -= wind * Math.min(1, dt * 1.6);
    // the pointer's parallax target, eased
    const e = 1 - Math.exp(-dt * 3);
    ptr.sx += (ptr.px - ptr.sx) * e;
    ptr.sy += (ptr.py - ptr.sy) * e;
    draw(dt);
  };
  const run = () => {
    if (reduced || raf || !onScreen || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const halt = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const io = new IntersectionObserver(([e]) => {
    onScreen = !!e?.isIntersecting;
    if (onScreen) run();
    else halt();
  });
  io.observe(canvas);
  const onVis = () => (document.hidden ? halt() : run());
  document.addEventListener('visibilitychange', onVis);
  const ro2 = new ResizeObserver(resize);
  ro2.observe(canvas);

  // ---- the pointer is wind: a brush pushes leaves aside, a tap is a gust; it also tilts the depth layers (parallax)
  const local = (ev: PointerEvent) => {
    const b = canvas.getBoundingClientRect();
    return [ev.clientX - b.left, ev.clientY - b.top] as const;
  };
  const onMove = (ev: PointerEvent) => {
    const [x, y] = local(ev);
    const now = performance.now();
    if (ptr.on) {
      const dtm = Math.max(8, now - ptr.t) / 1000;
      ptr.vx = ptr.vx * 0.5 + ((x - ptr.x) / dtm) * 0.5;
      ptr.vy = ptr.vy * 0.5 + ((y - ptr.y) / dtm) * 0.5;
    }
    ptr.x = x;
    ptr.y = y;
    ptr.t = now;
    ptr.on = true;
    ptr.px = W ? x / W - 0.5 : 0;
    ptr.py = H ? y / H - 0.5 : 0;
  };
  const onLeave = () => {
    ptr.on = false;
    ptr.x = ptr.y = -1e4;
    ptr.px = ptr.py = 0;
  };
  const onDown = (ev: PointerEvent) => {
    const [gx, gy] = local(ev);
    wind = 1;
    for (let i = 0; i < n; i++) {
      const px = cx + rx[i]! * R + ox[i]!;
      const py = cy + ry[i]! * R + oy[i]!;
      const dx = px - gx;
      const dy = py - gy;
      const d = Math.hypot(dx, dy) + 1;
      const fall = Math.exp(-(d * d) / (2 * 150 * 150));
      vx[i]! += (dx / d) * 820 * fall + 160 * (0.4 + seed[i]!);
      vy[i]! += (dy / d) * 820 * fall - 90 * seed[i]!;
      sv[i]! += (seed[i]! - 0.5) * 26;
    }
  };
  if (!reduced) {
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerleave', onLeave, { passive: true });
    canvas.addEventListener('pointercancel', onLeave, { passive: true });
    canvas.addEventListener('pointerdown', onDown, { passive: true });
  }

  resize();
  run();

  return {
    destroy() {
      halt();
      if (w.cancelIdleCallback) w.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      io.disconnect();
      ro2.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
    },
    go(step: number) {
      if (step === target || step < 0 || step >= STEPS) return;
      // the next flight starts where every leaf is right now (even mid-flight), so a quick change never jumps
      fx.set(rx);
      fy.set(ry);
      fa.set(ra);
      fo.set(ro);
      fs.set(rs);
      fl.set(rl);
      fw.set(rw);
      fc.set(rc);
      setDelays();
      target = step;
      m = 0;
      placeGlow();
      if (reduced) draw(0);
    },
    setDark(d: boolean) {
      if (d === dark) return;
      dark = d;
      paint();
      if (reduced) draw(0);
    },
  };
}
