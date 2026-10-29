/** A few short sparks from the point of a tap (React Bits ClickSpark, MIT + Commons Clause; rebuilt with DOM spans and a CSS keyframe instead of a canvas). */
import type { PointerEvent, ReactNode } from 'react';
import { motionReduced } from '../../lib/motionPref';
import { cn } from './cn';
import './ClickSpark.css';

/**
 * Wrap ONE primary button of the farmer phone (DESIGN.md: nowhere else). Pointer only: a key press gets no spark (no
 * animation on keyboard actions), and none under reduced motion. Eight 8 px strokes, 380 ms, then the burst removes itself.
 */
export function ClickSpark({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (motionReduced() || e.button !== 0) return;
    const host = e.currentTarget;
    const target = e.target as HTMLElement;
    if (target.closest('button:disabled')) return;
    const r = host.getBoundingClientRect();
    const burst = document.createElement('span');
    burst.className = 'spark-burst';
    burst.setAttribute('aria-hidden', 'true');
    burst.style.left = `${e.clientX - r.left}px`;
    burst.style.top = `${e.clientY - r.top}px`;
    if (color) burst.style.setProperty('--spark', color);
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('span');
      s.style.setProperty('--a', `${i * 45}deg`);
      burst.appendChild(s);
    }
    host.appendChild(burst);
    window.setTimeout(() => burst.remove(), 460);
  };
  return (
    <span className={cn('spark-host', className)} onPointerDown={onPointerDown}>
      {children}
    </span>
  );
}
