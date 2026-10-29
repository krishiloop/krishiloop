/** A line that fills down to the step that has run, with a light at its head (Aceternity Tracing Beam, free licence; rebuilt: driven by state instead of scroll, transform only). */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from './cn';
import './TracingBeam.css';

/**
 * Children mark their stops with `data-beam-stop` (the dot of each step). `at` is the index of the last stop that has
 * run (-1: none yet); the fill grows to that stop's centre and the head light sits on it. `tone` colours the fill
 * (a CSS colour, e.g. var(--color-wait) when the path ends at the officer). Re-measured when the box resizes.
 */
export function TracingBeam({ at, tone, x = 15, className, children }: { at: number; tone?: string; x?: number; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ y: 0, h: 1 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const stops = el.querySelectorAll<HTMLElement>('[data-beam-stop]');
      const r = el.getBoundingClientRect();
      const stop = at >= 0 ? stops[Math.min(at, stops.length - 1)] : undefined;
      const s = stop?.getBoundingClientRect();
      setPos({ y: s ? s.top - r.top + s.height / 2 : 0, h: Math.max(1, r.height) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [at, children]);

  return (
    <div ref={box} className={cn('tbeam', className)} style={{ '--tb-x': `${x}px`, ...(tone ? { '--tb-color': tone } : null) } as CSSProperties}>
      <span className="tbeam-track" aria-hidden>
        <span className="tbeam-fill" style={{ transform: `scaleY(${pos.y / pos.h})` }} />
      </span>
      <span className="tbeam-head" data-on={at >= 0 || undefined} style={{ transform: `translateY(${pos.y}px)` }} aria-hidden />
      {children}
    </div>
  );
}
