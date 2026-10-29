/** Magic UI NumberTicker for measured strings ("0.267", "15–63%", "70–126"), rebuilt on requestAnimationFrame (no Motion). */
import { useLayoutEffect as useEffect, useRef } from 'react';
import { cn as cx } from './cn';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const expoOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

/**
 * A measured value as the file states it ("0.267", "15–63%", "70–126"), with every number in it counting up together.
 * The exact string is what screen readers and tests read; decimals and separators are kept as written.
 */
export function CountText({ text, localize, className, duration = 1300 }: { text: string; localize?: (s: string) => string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const loc = localize ?? ((s: string) => s);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || typeof IntersectionObserver === 'undefined') return;
    const parts = text.split(/(\d[\d,]*(?:\.\d+)?)/);
    const render = (k: number) =>
      parts
        .map((p, i) => {
          if (i % 2 === 0) return p;
          const n = Number(p.replace(/,/g, ''));
          const dec = (p.split('.')[1] ?? '').length;
          const v = n * k;
          return dec ? v.toFixed(dec) : String(Math.round(v));
        })
        .join('');
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / duration);
      el.textContent = loc(p >= 1 ? text : render(expoOut(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return; // already on screen at load: no count
    el.textContent = loc(render(0));
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          io.disconnect();
          raf = requestAnimationFrame(tick);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.textContent = loc(text);
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={cx('num tabular-nums', className)}>
      <span className="sr-only-live">{loc(text)}</span>
      <span ref={ref} aria-hidden>
        {loc(text)}
      </span>
    </span>
  );
}
