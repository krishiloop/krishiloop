/** Magic UI NumberTicker / React Bits CountUp, rebuilt on requestAnimationFrame for app screens (no Motion: about 0.4 KB instead of about 45 KB). */
import { useLayoutEffect as useEffect, useRef } from 'react';
import { cn as cx } from './cn';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const expoOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

/**
 * Counts from `from` to `value` once: when it first scrolls into view (`when="view"`), or as soon as it mounts
 * (`when="mount"`, for a result that just arrived, like the receipts a recall reached). It writes the text node directly,
 * so React does not re-render per frame. The final value sits in a visually hidden span for screen readers, search and
 * tests; the moving copy is aria-hidden. Reduced motion shows the final value at once.
 */
export function CountUp({
  value,
  format,
  from = 0,
  duration = 1400,
  delay = 0,
  when = 'view',
  className,
  srClassName = 'sr-only-live',
}: {
  value: number;
  format: (n: number) => string;
  from?: number;
  duration?: number;
  delay?: number;
  when?: 'view' | 'mount';
  className?: string;
  srClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced() || value === from) {
      el.textContent = fmt.current(value);
      return;
    }
    let raf = 0;
    let t0 = 0;
    let wait = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / duration);
      el.textContent = fmt.current(from + (value - from) * expoOut(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const go = () => {
      wait = window.setTimeout(() => (raf = requestAnimationFrame(tick)), delay);
    };
    el.textContent = fmt.current(from);
    let io: IntersectionObserver | null = null;
    if (when === 'mount' || typeof IntersectionObserver === 'undefined') go();
    else {
      io = new IntersectionObserver(
        ([e]) => {
          if (e?.isIntersecting) {
            io?.disconnect();
            go();
          }
        },
        { rootMargin: '0px 0px -8% 0px' },
      );
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      window.clearTimeout(wait);
      cancelAnimationFrame(raf);
      el.textContent = fmt.current(value);
    };
  }, [value, from, duration, delay, when]);

  return (
    <span className={cx('num tabular-nums', className)}>
      <span className={srClassName}>{format(value)}</span>
      <span ref={ref} aria-hidden>
        {format(value)}
      </span>
    </span>
  );
}
