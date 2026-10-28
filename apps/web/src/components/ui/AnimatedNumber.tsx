import { useEffect, useRef, useState } from 'react';
import { useMotionReduced } from '../../lib/motionPref';

const EASE_OUT = (x: number) => 1 - Math.pow(1 - x, 3);

/** A percentage that counts from where it was to where it is, writing straight into the text node (no re-render per frame). */
export function AnimatedNumber({ value, format, ms = 800 }: { value: number; format: (n: number) => string; ms?: number }) {
  const reduced = useMotionReduced();
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const fmt = useRef(format);
  fmt.current = format;
  const [initial] = useState(() => format(value)); // React never touches the text again: the effect owns it
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const from = shown.current;
    if (reduced || from === value || document.hidden) {   // a hidden tab gets no animation frames: show the final value
      shown.current = value;
      node.textContent = fmt.current(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      shown.current = from + (value - from) * EASE_OUT(p);
      node.textContent = fmt.current(shown.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // a background or occluded window may never draw a frame: the final value still has to appear
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf);
      shown.current = value;
      node.textContent = fmt.current(value);
    }, ms + 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value, reduced, ms]);
  // a language change re-formats without animating
  useEffect(() => {
    if (el.current) el.current.textContent = fmt.current(shown.current);
  }, [format]);
  return <span ref={el}>{initial}</span>;
}
