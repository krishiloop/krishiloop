import { useEffect, useMemo, useRef } from 'react';
import { useInViewOnce } from '../../lib/hooks';
import { useMotionReduced } from '../../lib/motionPref';
import { CALLS, DOT_HOUSEHOLDS, HOUSEHOLDS } from './facts';

const COLS = 160;
const ROWS = 106;
const DOTS = Math.round(HOUSEHOLDS.value / DOT_HOUSEHOLDS); // 16,880 dots, one per 1,000 households (A3)
const LIT = Math.round(CALLS.value / DOT_HOUSEHOLDS); // 92 glowing dots = 92 thousand calls received (D4)

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bangladesh's advice gap, drawn to scale: 16,880 dots (one per 1,000 farm households) and the 92 that light up
 * (the 92,094 calls the 16123 helpline received in a year). A canvas: 17 thousand dots are not 17 thousand DOM nodes.
 */
export function AdviceGap({ label }: { label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const seen = useInViewOnce(wrap, '0px 0px -10% 0px');
  const reduced = useMotionReduced();
  const lit = useMemo(() => {
    const r = rng(2026);
    const set = new Set<number>();
    while (set.size < LIT) set.add(Math.floor(r() * DOTS));
    return [...set];
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let start = 0;
    const draw = (progress: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = box.clientWidth;
      const h = Math.round((w * ROWS) / COLS);
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
        el.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sx = w / COLS;
      const sy = h / ROWS;
      const base = getComputedStyle(box).getPropertyValue('--gap-dot').trim() || '#313b32';
      ctx.fillStyle = base;
      const r = Math.max(0.55, sx * 0.2);
      ctx.beginPath();
      for (let i = 0; i < DOTS; i++) {
        const cx = (i % COLS) * sx + sx / 2;
        const cy = Math.floor(i / COLS) * sy + sy / 2;
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      const sun = getComputedStyle(box).getPropertyValue('--gap-lit').trim() || '#f0c96b';
      const n = Math.floor(progress * lit.length);
      for (let k = 0; k < n; k++) {
        const i = lit[k]!;
        const cx = (i % COLS) * sx + sx / 2;
        const cy = Math.floor(i / COLS) * sy + sy / 2;
        const age = Math.min(1, (progress * lit.length - k) / 6);
        const rr = Math.max(2.2, sx * 0.55) * (0.6 + 0.4 * age);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 3.2);
        g.addColorStop(0, sun);
        g.addColorStop(0.35, `${sun}88`);
        g.addColorStop(1, `${sun}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = sun;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (!seen) {
      draw(0);
      return;
    }
    if (reduced) {
      draw(1);
    } else {
      const tick = (now: number) => {
        start ||= now;
        const p = Math.min(1, (now - start) / 2600);
        draw(1 - Math.pow(1 - p, 3));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    const ro = new ResizeObserver(() => draw(1));
    ro.observe(box);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [seen, reduced, lit]);

  return (
    <div ref={wrap} className="gap-canvas">
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
