import { LIFE, PALETTE, shapeBuilders, type Shape } from './shapes';
import { holdMap, STEPS } from './steps';

/**
 * The leaf field (builder H): a few hundred small leaves on a 2D canvas that morph between the six pictures of the
 * hero story as the page scrolls. No WebGL: every leaf is one pre-drawn sprite per colour, placed with setTransform.
 * The pointer brushes leaves aside like wind; a tap is a gust. Lazy chunk, started after the first paint.
 *
 * Budget: 300 leaves at 30 fps on phones, 680 at the display's rate elsewhere; the loop stops off screen and in a
 * hidden tab. Reduced motion: no loop at all, each picture is drawn once, still, when its step comes.
 */
export type FieldApi = { destroy(): void; setStep(step: number): void };
export type FieldOptions = {
  canvas: HTMLCanvasElement;
  /** scroll progress, 0 to STEPS - 1 */
  getProgress: () => number;
  reduced: boolean;
  mobile: boolean;
};

const SPR_L = 40; // sprite size in CSS px (drawn at the device pixel ratio)
const SPR_W = 18;

function sprite(color: string, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(SPR_L * dpr);
  c.height = Math.ceil(SPR_W * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const m = SPR_W / 2;
  g.beginPath();
  g.moveTo(1.5, m);
  g.bezierCurveTo(SPR_L * 0.28, 0.6, SPR_L * 0.7, 1.4, SPR_L - 1, m);
  g.bezierCurveTo(SPR_L * 0.7, SPR_W - 1.4, SPR_L * 0.28, SPR_W - 0.6, 1.5, m);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  // light on the upper half, a darker midrib: a leaf, not a dash
  const hi = g.createLinearGradient(0, 0, 0, SPR_W);
  hi.addColorStop(0, 'rgba(255,255,255,0.28)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0)');
  hi.addColorStop(1, 'rgba(20,38,28,0.18)');
  g.fillStyle = hi;
  g.fill();
  g.beginPath();
  g.moveTo(3, m);
  g.quadraticCurveTo(SPR_L * 0.5, m - 0.8, SPR_L - 4, m);
  g.strokeStyle = 'rgba(20,38,28,0.28)';
  g.lineWidth = 1.1;
  g.stroke();
  return c;
}

const smooth = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
const wrapAngle = (a: number) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

export function startField({ canvas, getProgress, reduced, mobile }: FieldOptions): FieldApi {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {}, setStep() {} };
  const n = mobile ? 300 : 680;
  // the pictures: the first two now, the others one per idle moment (or at once when the story reaches them)
  const builders = shapeBuilders(n);
  const cache: (Shape | undefined)[] = [];
  const shape = (i: number): Shape => (cache[i] ??= builders[i]!());
  shape(0);
  shape(1);
  type IdleWin = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  const w = window as IdleWin;
  let idle = 0;
  const later = (i: number) => {
    if (i >= STEPS) return;
    const next = () => {
      shape(i);
      later(i + 1);
    };
    idle = w.requestIdleCallback ? w.requestIdleCallback(next, { timeout: 2000 }) : window.setTimeout(next, 120);
  };
  later(2);
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2);
  const sprites = PALETTE.map((c) => sprite(c, dpr));

  // per leaf: a seed, a size, which way it curls in flight, and the push the pointer gave it (offset, velocity, spin)
  const seed = new Float32Array(n);
  const size = new Float32Array(n);
  const curl = new Float32Array(n);
  const ox = new Float32Array(n);
  const oy = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const sp = new Float32Array(n);
  const sv = new Float32Array(n);
  const ix = new Float32Array(n);
  const iy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    seed[i] = r - Math.floor(r);
    const r2 = Math.sin(i * 4.1414 + 3.7) * 9631.17;
    size[i] = 0.78 + (r2 - Math.floor(r2)) * 0.44;
    curl[i] = (i % 2 ? 1 : -1) * (0.18 + seed[i]! * 0.3);
    // the first visit: the leaves blow in from the right, on the wind
    ix[i] = 1.25 + seed[i]! * 0.9;
    iy[i] = -1.1 + ((i * 0.618) % 1) * 2.2;
  }

  let W = 0;
  let H = 0;
  let R = 1;
  let cx = 0;
  let cy = 0;
  let leaf = 12;
  const resize = () => {
    const b = canvas.getBoundingClientRect();
    W = b.width;
    H = b.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    R = (Math.min(W, H) / 2) * 0.88;
    cx = W / 2;
    cy = H / 2;
    leaf = Math.max(8, Math.min(18, R * 0.062));
    if (reduced) draw(0);
  };

  let state = reduced ? 0 : holdMap(getProgress());
  let staticStep = 0;
  let t = 0;
  let intro = reduced ? 1 : 0;
  let wind = 0;
  const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, on: false, t: 0 };

  /** one frame: where every leaf is, how it moves, and paint it */
  function draw(dt: number) {
    const s = Math.min(STEPS - 1, Math.max(0, state));
    const i0 = Math.min(STEPS - 2, Math.floor(s));
    const f = s - i0;
    const A = shape(i0);
    const B = shape(i0 + 1);
    const g = ctx!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const rad = mobile ? 72 : 96;
    const rad2 = rad * rad;
    const physics = !reduced && dt > 0;
    const k = 1 - Math.exp(-dt * 7); // pointer velocity decay
    ptr.vx -= ptr.vx * k;
    ptr.vy -= ptr.vy * k;

    for (let i = 0; i < n; i++) {
      const sd = seed[i]!;
      const lf = smooth((f - sd * 0.35) / 0.65);
      // each picture's own life, applied to its end of the flight
      let ax = A.x[i]!, ay = A.y[i]!, aa = A.a[i]!, al = A.o[i]!, as = 1;
      let bx = B.x[i]!, by = B.y[i]!, ba = B.a[i]!, bl = B.o[i]!, bs = 1;
      if (lf < 1) {
        const r = life(A.k[i]!, ax, ay, aa, al, sd, A.bx, A.by);
        ax = r[0]; ay = r[1]; aa = r[2]; al = r[3]; as = r[4];
      }
      if (lf > 0) {
        const r = life(B.k[i]!, bx, by, ba, bl, sd, B.bx, B.by);
        bx = r[0]; by = r[1]; ba = r[2]; bl = r[3]; bs = r[4];
      }
      let x = ax + (bx - ax) * lf;
      let y = ay + (by - ay) * lf;
      let ang = aa + wrapAngle(ba - aa) * lf;
      if (lf > 0 && lf < 1) {
        // in flight: a curved path and a tumble, like a leaf on the wind
        const arc = Math.sin(Math.PI * lf);
        x += -(by - ay) * arc * curl[i]!;
        y += (bx - ax) * arc * curl[i]!;
        ang += arc * (sd - 0.5) * 7;
      }
      let alpha = al + (bl - al) * lf;
      if (intro < 1) {
        const li = smooth((intro - sd * 0.45) / 0.55);
        x = ix[i]! + (x - ix[i]!) * li;
        y = iy[i]! + (y - iy[i]!) * li + Math.sin(li * Math.PI) * 0.18 * (sd - 0.5);
        ang += (1 - li) * (sd * 9 - 4);
        alpha *= Math.min(1, li * 1.6);
      }
      if (!reduced) ang += Math.sin(t * 1.7 + sd * 20) * 0.12;

      let px = cx + x * R;
      let py = cy + y * R;
      if (physics) {
        let fx = 0;
        let fy = 0;
        if (ptr.on) {
          const dx = px + ox[i]! - ptr.x;
          const dy = py + oy[i]! - ptr.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < rad2) {
            const d = Math.sqrt(d2) + 0.5;
            const fall = (1 - d / rad) ** 2;
            fx += (dx / d) * 2600 * fall + ptr.vx * 9 * fall;
            fy += (dy / d) * 2600 * fall + ptr.vy * 9 * fall;
            sv[i]! += ((dx / d) * ptr.vy - (dy / d) * ptr.vx) * 0.004 * fall;
          }
        }
        vx[i]! += (fx - 16 * ox[i]! - 5.2 * vx[i]!) * dt;
        vy[i]! += (fy - 16 * oy[i]! - 5.2 * vy[i]!) * dt;
        ox[i]! += vx[i]! * dt;
        oy[i]! += vy[i]! * dt;
        sv[i]! -= (sv[i]! * 3 + sp[i]! * 10) * dt;
        sp[i]! += sv[i]! * dt;
      }
      px += ox[i]!;
      py += oy[i]!;
      ang += sp[i]!;
      if (alpha < 0.02) continue;

      const ci = lf < 0.5 ? A.c[i]! : B.c[i]!;
      const sc = (as + (bs - as) * lf) * size[i]! * (leaf / SPR_L);
      const lm = (A.l[i]! + (B.l[i]! - A.l[i]!) * lf) * sc;
      const wm = (A.w[i]! + (B.w[i]! - A.w[i]!) * lf) * sc;
      const co = Math.cos(ang);
      const si = Math.sin(ang);
      g.globalAlpha = alpha > 1 ? 1 : alpha;
      g.setTransform(co * lm * dpr, si * lm * dpr, -si * wm * dpr, co * wm * dpr, px * dpr, py * dpr);
      g.drawImage(sprites[ci]!, -SPR_L / 2, -SPR_W / 2, SPR_L, SPR_W);
    }
    g.globalAlpha = 1;
  }

  // the picture's life: x, y, angle, opacity, size (reused array, no garbage per leaf)
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 1];
  function life(kind: number, x: number, y: number, a: number, o: number, sd: number, bx: number, by: number) {
    let s = 1;
    if (kind === LIFE.sway) {
      const h = Math.max(0, Math.min(1, (0.92 - y) / 1.9));
      const w = (Math.sin(t * 1.05 + sd * 0.7 + y * 0.9) * 0.05 + wind * 0.16) * h * h;
      x += w;
      a += w * 1.6;
    } else if (kind === LIFE.rain) {
      const top = -0.14;
      const span = 1.04;
      y = top + ((((y - top + t * (0.5 + sd * 0.25)) % span) + span) % span);
      x += (y - top) * 0.16;
      o *= Math.min(1, (y - top) / 0.12, (top + span - y) / 0.12);
    } else if (kind === LIFE.pulse) {
      s = 1 + Math.sin(t * 2.4 + sd * 6.28) * 0.16;
    } else if (kind === LIFE.bracket) {
      const k = 1 + (0.5 + 0.5 * Math.sin(t * 2.1)) * 0.08;
      x = bx + (x - bx) * k;
      y = by + (y - by) * k;
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
    intro = Math.min(1, intro + dt / 1.7);
    wind -= wind * Math.min(1, dt * 1.6);
    const target = holdMap(getProgress());
    state += (target - state) * (1 - Math.exp(-dt * 5));
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
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ---- the pointer is wind: a brush pushes leaves aside, a tap is a gust
  const local = (e: PointerEvent) => {
    const b = canvas.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top] as const;
  };
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e);
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
  };
  const onLeave = () => {
    ptr.on = false;
    ptr.x = ptr.y = -1e4;
  };
  const onDown = (e: PointerEvent) => {
    const [gx, gy] = local(e);
    wind = 1;
    const here = shape(Math.round(Math.min(STEPS - 1, state)));
    for (let i = 0; i < n; i++) {
      const px = cx + here.x[i]! * R + ox[i]!;
      const py = cy + here.y[i]! * R + oy[i]!;
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
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
    },
    setStep(step: number) {
      if (!reduced || step === staticStep) return;
      staticStep = step;
      state = step;
      draw(0);
    },
  };
}
