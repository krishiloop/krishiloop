/** Aceternity Timeline (scroll-traced line), rebuilt without Motion: one passive scroll listener writes a transform. */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { CircleDashed } from 'lucide-react';
import { cn as cx } from './cn';
import './timeline.css';

export interface TimelineItem {
  date: string;
  body: ReactNode;
  done: boolean;
}

/**
 * Dates on the left, what happened (or is planned) on the right, a rail between them. Done and planned never blur:
 * the solid rail and its sprout trace stop at "now"; below it the rail is dashed, the dots are dashed rings, and each
 * item says Done or Planned in words. The trace grows with scroll through the done part only (transform: scaleY), and is
 * simply full under reduced motion.
 */
export function Timeline({ items, doneLabel, plannedLabel, nowLabel, className }: { items: TimelineItem[]; doneLabel: string; plannedLabel: string; nowLabel: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const solid = useRef<HTMLSpanElement>(null);
  const trace = useRef<HTMLSpanElement>(null);
  const nowAt = items.findIndex((i) => !i.done);

  useEffect(() => {
    const el = box.current;
    const s = solid.current;
    const tr = trace.current;
    if (!el || !s || !tr) return;
    const first = el.querySelector<HTMLElement>('[data-first-planned]');
    const measure = () => {
      const h = first ? first.offsetTop + 6 : el.offsetHeight;
      s.style.height = `${h}px`;
    };
    measure();
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = s.getBoundingClientRect();
      const p = still ? 1 : Math.min(1, Math.max(0, (window.innerHeight * 0.62 - r.top) / Math.max(1, r.height)));
      tr.style.transform = `scaleY(${p})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (measure(), onScroll())) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [items.length]);

  return (
    <div ref={box} className={cx('tl', className)}>
      <span className="tl-rail" aria-hidden />
      <span ref={solid} className="tl-solid" aria-hidden>
        <span ref={trace} className="tl-trace" />
      </span>
      <ol className="timeline tl-list">
        {items.map((it, i) => (
          <li
            key={i}
            className={cx('tl-item', it.done ? 'is-done' : 'is-planned')}
            data-first-planned={i === nowAt ? '' : undefined}
            data-reveal
            style={{ '--i': i % 3 } as CSSProperties}
          >
            {i === nowAt ? (
              <span className="tl-now" aria-hidden>
                {nowLabel}
              </span>
            ) : null}
            <span className="tl-dot" aria-hidden>
              {it.done ? <span /> : <CircleDashed size={14} />}
            </span>
            <p className="tl-date">{it.date}</p>
            <div className="tl-body">
              <span className={cx('chip', it.done ? 'chip-go' : 'tl-chip-plan')}>{it.done ? doneLabel : plannedLabel}</span>
              <div className="tl-text">{it.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
