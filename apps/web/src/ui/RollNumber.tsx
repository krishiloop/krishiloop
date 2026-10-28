import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';

/**
 * A number that rolls into place the first time it scrolls into view (DESIGN.md: digit columns slide up, 45 ms apart).
 * The final value is always the text in the DOM: nothing ever renders "0" first, and screen readers, search and a
 * background tab all see the real number. Numbers already on screen at load, and reduced motion, do not roll.
 */
export function RollNumber({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<'still' | 'armed' | 'rolling'>('still');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already visible: no roll
    setState('armed');
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setState('rolling');
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={ref} className={cx('roll', state === 'rolling' && 'is-rolling', className)}>
      <span className="sr-only-live">{value}</span>
      {[...value].map((ch, i) => (
        <span key={i} aria-hidden style={{ ['--d' as string]: i, ...(state === 'armed' ? { transform: 'translateY(105%)' } : null) }}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}
