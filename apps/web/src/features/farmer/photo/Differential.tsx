import { Component, createRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { OTHER, type DiffRow } from './report';
import { useI18n } from '../../../lib/i18n';
import { useMotionReduced } from '../../../lib/motionPref';
import { fmtNum, pickText } from '../../../lib/format';
import { cx } from '../../../lib/cx';

const EASE_MOVE = 'cubic-bezier(0.77, 0, 0.175, 1)'; // on-screen movement: strong ease-in-out
const EASE_OUT = (x: number) => 1 - Math.pow(1 - x, 3);

/**
 * A list whose rows glide to their new places when the order changes (FLIP: First, Last, Invert, Play).
 * It measures in getSnapshotBeforeUpdate (the DOM still has the old layout, including a half-finished glide), cancels any
 * glide in flight, then plays transform-only animations from the old place: composited, and interruptible
 * because the next update starts from wherever the row visibly is.
 */
class FlipList extends Component<{ className?: string; reduced: boolean; children: ReactNode }> {
  private ref = createRef<HTMLUListElement>();
  private running = new WeakMap<Element, Animation>();

  getSnapshotBeforeUpdate(): Map<string, number> {
    const tops = new Map<string, number>();
    this.ref.current?.querySelectorAll<HTMLElement>('[data-flip]').forEach((n) => tops.set(n.dataset.flip!, n.getBoundingClientRect().top));
    return tops;
  }

  componentDidUpdate(_p: unknown, _s: unknown, before: Map<string, number>) {
    const nodes = Array.from(this.ref.current?.querySelectorAll<HTMLElement>('[data-flip]') ?? []);
    for (const n of nodes) this.running.get(n)?.cancel();
    if (this.props.reduced) return;
    for (const n of nodes) {
      const from = before.get(n.dataset.flip!);
      if (from == null) continue;
      const dy = from - n.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      const a = n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 560, easing: EASE_MOVE });
      this.running.set(n, a);
    }
  }

  render() {
    return (
      <ul ref={this.ref} className={this.props.className}>
        {this.props.children}
      </ul>
    );
  }
}

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
    if (reduced || from === value) {
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
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, ms]);
  // a language change re-formats without animating
  useEffect(() => {
    if (el.current) el.current.textContent = fmt.current(shown.current);
  }, [format]);
  return <span ref={el}>{initial}</span>;
}

/**
 * The differential diagnosis: every disease still in play with its probability.
 * When a new reading arrives the bars slide to their new values, the numbers count, the rows swap places, and a small
 * "+40 / −31" says how far each moved. The rows a pending photo request would tell apart are marked.
 */
export function Differential({ rows, reportId, separates, pending }: { rows: DiffRow[]; reportId: string; separates?: string[]; pending?: boolean }) {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [won, setWon] = useState<string | null>(null);
  const last = useRef<{ id: string; probs: Record<string, number>; top: string | undefined } | null>(null);
  const latest = useRef(rows);
  latest.current = rows;

  useEffect(() => {
    const now = latest.current;
    const probs = Object.fromEntries(now.map((r) => [r.id, r.prob]));
    const top = now.find((r) => r.id !== OTHER)?.id;
    const before = last.current;
    last.current = { id: reportId, probs, top };
    if (!before || before.id === reportId) return;
    const d: Record<string, number> = {};
    for (const r of now) {
      const dv = Math.round(r.prob * 100) - Math.round((before.probs[r.id] ?? 0) * 100);
      if (Math.abs(dv) >= 2) d[r.id] = dv;
    }
    setDeltas(d);
    setWon(before.top && top && before.top !== top ? top : null);
    const timer = window.setTimeout(() => {
      setDeltas({});
      setWon(null);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [reportId]);

  const pct = useCallback((n: number) => `${fmtNum(Math.round(n), lang)}%`, [lang]);
  return (
    <FlipList className="diff" reduced={reduced}>
      {rows.map((r, i) => {
        const name = r.id === OTHER ? { text: t('photo.other'), lang } : pickText(r.name, lang);
        const dv = deltas[r.id];
        return (
          <li key={r.id} data-flip={r.id} className={cx('diff-row', i === 0 && r.id !== OTHER && 'is-top', r.id === OTHER && 'is-other', separates?.includes(r.id) && 'is-sep')} data-won={won === r.id} data-pending={!!pending}>
            <span className="diff-name" lang={name.lang}>
              {name.text}
            </span>
            <span className="diff-bar" role="img" aria-label={`${name.text} ${pct(r.prob * 100)}`}>
              <span style={{ ['--p' as string]: r.prob }} />
            </span>
            <span className="diff-pct tabular">
              <AnimatedNumber value={r.prob * 100} format={pct} />
              {dv ? (
                <span className="diff-delta" data-dir={dv > 0 ? 'up' : 'down'} aria-hidden>
                  {dv > 0 ? '+' : '−'}
                  {fmtNum(Math.abs(dv), lang)}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </FlipList>
  );
}
