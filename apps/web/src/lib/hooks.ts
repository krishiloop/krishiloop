import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMotionReduced } from './motionPref';

/** True once the element has been on screen (stays true: reveals play once). */
export function useInViewOnce<T extends Element>(ref: RefObject<T | null>, rootMargin = '0px 0px -12% 0px'): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}

/** Live "is on screen" flag (updates both ways): used to stop rendering canvases that are off screen. */
export function useOnScreen<T extends Element>(ref: RefObject<T | null>, rootMargin = '200px'): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return on;
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

/**
 * Count a number up when `start` becomes true. Writes straight into the element (no React re-render per frame).
 * With reduced motion it shows the final value at once.
 */
export function useCountUp(target: number, start: boolean, format: (n: number) => string, ms = 1100) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMotionReduced();
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!start || reduced) {
      el.textContent = fmt.current(start || reduced ? target : 0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = fmt.current(target * easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, reduced, ms]);
  return ref;
}

/** Re-run `cb` on window resize (rAF-throttled). */
export function useResize(cb: () => void) {
  const fn = useRef(cb);
  fn.current = cb;
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fn.current());
    };
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      cancelAnimationFrame(raf);
    };
  }, []);
}
