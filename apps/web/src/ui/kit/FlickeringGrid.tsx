import { useEffect, useRef } from 'react';
import { cn } from './cn';

/**
 * A field of small squares that flicker like a crop seen from above at night (Magic UI FlickeringGrid, rebuilt):
 * canvas, about 12 frames a second, only while on screen, and a still frame under reduced motion.
 */
export function FlickeringGrid({
  className,
  square = 3,
  gap = 6,
  chance = 0.06,
  maxOpacity = 0.28,
  colorVar = '--color-sprout',
}: {
  className?: string;
  square?: number;
  gap?: number;
  chance?: number;
  maxOpacity?: number;
  colorVar?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let cols = 0;
    let rows = 0;
    let cells = new Float32Array(0);
    let dpr = 1;
    let color = '194 239 106';
    const readColor = () => {
      const v = getComputedStyle(c).getPropertyValue(colorVar).trim();
      const m = /^#?([0-9a-f]{6})$/i.exec(v);
      if (m) {
        const n = parseInt(m[1]!, 16);
        color = `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
      }
    };
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(r.width * dpr));
      c.height = Math.max(1, Math.floor(r.height * dpr));
      cols = Math.ceil(r.width / (square + gap));
      rows = Math.ceil(r.height / (square + gap));
      cells = new Float32Array(cols * rows).map(() => Math.random() * maxOpacity);
      readColor();
    };
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const s = square * dpr;
      const step = (square + gap) * dpr;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          ctx.fillStyle = `rgb(${color} / ${cells[i * rows + j]})`;
          ctx.fillRect(i * step, j * step, s, s);
        }
      }
    };
    size();
    draw();
    if (reduce) return;
    let on = false;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 80) return;
      last = t;
      for (let k = 0; k < cells.length; k++) if (Math.random() < chance) cells[k] = Math.random() * maxOpacity;
      draw();
    };
    const io = new IntersectionObserver(([e]) => {
      const vis = !!e?.isIntersecting;
      if (vis && !on) raf = requestAnimationFrame(tick);
      if (!vis && on) cancelAnimationFrame(raf);
      on = vis;
    });
    io.observe(c);
    const ro = new ResizeObserver(() => {
      size();
      draw();
    });
    ro.observe(c);
    const mo = new MutationObserver(() => {
      readColor();
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
    };
  }, [square, gap, chance, maxOpacity, colorVar]);
  return <canvas ref={canvas} aria-hidden className={cn('pointer-events-none block size-full', className)} />;
}
