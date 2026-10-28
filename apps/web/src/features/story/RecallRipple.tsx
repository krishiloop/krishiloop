import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { fmtNum } from '../../lib/format';
import { Button, LinkButton } from '../../ui/Button';
import { DataMark } from '../../ui/DataMark';
import { SectionHead } from './parts';

const COLS = 12;
const ROWS = 8;
const N = COLS * ROWS;

/** Three real rules of the Bangladesh rice pack; how often each one is cited by the simulated receipts. */
const RULES: { id: string; label: Key; weight: number }[] = [
  { id: 'R-BDR-002 v1', label: 'story.recall.r002', weight: 0.42 },
  { id: 'R-BDR-001 v1', label: 'story.recall.r001', weight: 0.24 },
  { id: 'R-BDR-010 v1', label: 'story.recall.r010', weight: 0.34 },
];

/** A tiny seeded generator, so every visitor sees the same field of receipts. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The innovation, made visible: every tile is one receipt; each cites one rule. Recall a rule and exactly the receipts
 * that used it flip to RECALLED, in a ripple from the middle of the field (24 ms per ring), while the rest stay
 * Authentic. A labelled simulation; the real recall runs in the officer console (and on the server's status list).
 */
export function RecallRipple() {
  const { t, lang } = useI18n();
  const [recalled, setRecalled] = useState<string[]>([]);

  const tiles = useMemo(() => {
    const rnd = seeded(20261028);
    const cx0 = (COLS - 1) / 2;
    const cy0 = (ROWS - 1) / 2;
    return Array.from({ length: N }, (_, i) => {
      const r = rnd();
      const rule = r < RULES[0]!.weight ? RULES[0]! : r < RULES[0]!.weight + RULES[1]!.weight ? RULES[1]! : RULES[2]!;
      const x = i % COLS;
      const y = Math.floor(i / COLS);
      const ring = Math.round(Math.hypot((x - cx0) * 1, (y - cy0) * 1.25));
      return { i, rule: rule.id, ring };
    });
  }, []);

  const counts = useMemo(() => Object.fromEntries(RULES.map((r) => [r.id, tiles.filter((x) => x.rule === r.id).length])), [tiles]);
  const nRecalled = tiles.filter((x) => recalled.includes(x.rule)).length;

  const toggle = (id: string) => setRecalled((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <section className="section cv" aria-labelledby="recall-title">
      <div className="wrap">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow={t('story.recall.eyebrow')} title={t('story.recall.title')} id="recall-title" />
          <DataMark kind="simulation" />
        </div>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1fr_1.35fr] lg:gap-14">
          <div data-reveal>
            <p className="eyebrow m-0">{t('story.recall.pick')}</p>
            <ul className="m-0 mt-4 grid list-none gap-2.5 p-0">
              {RULES.map((r) => {
                const on = recalled.includes(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(r.id)}
                      className={cx(
                        'group flex w-full items-center gap-4 rounded-[var(--radius-ui)] border px-4 py-3.5 text-left transition-[border-color,background-color] duration-200 active:scale-[0.99]',
                        on ? 'border-stop bg-stop-wash' : 'border-rule bg-card hover:border-rule-2',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cx('mono block text-sm font-semibold', on && 'text-stop line-through decoration-2')}>{r.id}</span>
                        <span className="mt-0.5 block text-[0.95rem] leading-snug text-ink-2">{t(r.label)}</span>
                      </span>
                      <span className="mono text-xs text-ink-3">×{fmtNum(counts[r.id] ?? 0, lang)}</span>
                      <span className={cx('btn btn-sm pointer-events-none', on ? 'btn-secondary' : 'btn-danger')} aria-hidden>
                        {on ? t('story.recall.undo') : t('story.recall.button')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8 flex items-end gap-8" aria-live="polite">
              <p className="m-0">
                <span className="block text-[2.6rem] font-[680] leading-none tabular-nums text-stop [font-stretch:82%]">{fmtNum(nRecalled, lang)}</span>
                <span className="mt-1 block text-sm text-ink-2">{t('story.recall.count')}</span>
              </p>
              <p className="m-0">
                <span className="block text-[2.6rem] font-[680] leading-none tabular-nums text-go [font-stretch:82%]">{fmtNum(N - nRecalled, lang)}</span>
                <span className="mt-1 block text-sm text-ink-2">{t('story.recall.left')}</span>
              </p>
              {recalled.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setRecalled([])} className="ml-auto">
                  <RotateCcw size={15} aria-hidden />
                  {t('story.recall.reset')}
                </Button>
              )}
            </div>
            <p className="m-0 mt-6 text-sm text-ink-3">{t('story.recall.note')}</p>
            <LinkButton to="/officer?tab=recall" variant="secondary" arrow className="mt-4">
              {t('story.recall.real')}
            </LinkButton>
          </div>

          <div className="ripple-field grid gap-[5px] rounded-[var(--radius-ui)] border border-rule bg-sunk/60 p-3 sm:gap-1.5 sm:p-4" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }} aria-hidden data-reveal>
            {tiles.map((tile) => {
              const off = recalled.includes(tile.rule);
              return (
                <span key={tile.i} className={cx('tile', off && 'is-off')} style={{ ['--ring' as string]: tile.ring }}>
                  <span className="tile-face tile-ok" />
                  <span className="tile-face tile-bad" />
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
