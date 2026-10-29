import { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { cn } from './cn';

/**
 * Counts up to `value` the first time it scrolls into view (Magic UI NumberTicker, rebuilt: it writes the text node
 * directly, so React does not re-render per frame). The final value is what screen readers and no-JS readers get.
 */
export function NumberTicker({
  value,
  format,
  className,
  duration = 1.6,
  delay = 0,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  duration?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView || reduce) return;
    const ctl = animate(0, value, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = format(v);
      },
    });
    return () => ctl.stop();
  }, [inView, reduce, value, duration, delay, format]);
  return (
    <span className={cn('num tabular-nums', className)}>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden>
        {format(reduce ? value : 0)}
      </span>
    </span>
  );
}
