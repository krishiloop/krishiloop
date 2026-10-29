/** An id or a hash scrambling into place, left to right (Magic UI HyperText, MIT; rebuilt: ~30 fps, writes the text node directly so React does not re-render per frame). */
import { useLayoutEffect, useRef } from 'react';
import { motionReduced } from '../../lib/motionPref';
import { cn } from './cn';

const HEX = '0123456789abcdef';
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

/**
 * The final text is what screen readers (and anyone with reduced motion) get, at once. Only letters and digits scramble:
 * colons, dashes and dots stay put, so an id keeps its shape while it resolves. Mono type keeps the width steady.
 */
export function HyperText({ text, className, duration = 620, delay = 0 }: { text: string; className?: string; duration?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motionReduced() || !text) {
      el.textContent = text;
      return;
    }
    const pool = /^[0-9a-f…:. -]+$/.test(text) ? HEX : ALNUM;
    const scramble = (fixed: number) => {
      let out = '';
      for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        out += i < fixed || !/[0-9a-z]/i.test(c) ? c : pool[(Math.random() * pool.length) | 0];
      }
      return out;
    };
    el.textContent = scramble(0);
    let raf = 0;
    let start = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = now - start - delay;
      if (t >= 0 && now - last >= 33) {
        last = now;
        const p = Math.min(1, t / duration);
        el.textContent = p >= 1 ? text : scramble(Math.floor(p * text.length));
        if (p >= 1) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = text;
    };
  }, [text, duration, delay]);

  return (
    <span className={cn('mono', className)}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden>
        {text}
      </span>
    </span>
  );
}
