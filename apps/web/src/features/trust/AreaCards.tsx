import { useMemo } from 'react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { REPLAY_DATASETS, replayStats, type ReplayModel } from './replay';
import type { Policy } from './policy';
import type { CiFile } from './CiPanel';

const W = 200;
const H = 38;
const Y_MIN = 0.5;

/** A tiny copy of one area's curve: the counted lower bound, the bar, and the dot where the gate opened. */
function Spark({ m, policy }: { m: ReplayModel; policy: Policy }) {
  const geo = useMemo(() => {
    const max = Math.max(1, m.maxVerdicts);
    const x = (v: number) => Math.round((v / max) * W * 10) / 10;
    const y = (lb: number) => Math.round((1 - (Math.min(Math.max(lb, Y_MIN), 1) - Y_MIN) / (1 - Y_MIN)) * H * 10) / 10;
    let d = '';
    let pen = false;
    // every second point is plenty at this size
    m.points.forEach((p, i) => {
      if (p.lb === null) {
        pen = false;
        return;
      }
      if (i % 2 && i !== m.points.length - 1 && pen) return;
      d += `${pen ? 'L' : 'M'}${x(p.verdicts)} ${y(p.lb)}`;
      pen = true;
    });
    return { d, bar: y(policy.openLb), open: m.openAt !== null ? { x: x(m.openAt), y: y(policy.openLb) } : null };
  }, [m, policy]);
  return (
    <svg className="tp-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <line x1={0} x2={W} y1={geo.bar} y2={geo.bar} vectorEffect="non-scaling-stroke" />
      <path d={geo.d} vectorEffect="non-scaling-stroke" />
      {geo.open ? <circle cx={geo.open.x} cy={geo.open.y} r={3} /> : null}
    </svg>
  );
}

/** The same number across all the random orders, so this card's one order is never read as typical. */
function CiLine({ a, n }: { a: NonNullable<CiFile['areas'][string]>; n: number }) {
  const { t, lang } = useI18n();
  const [lo, med, hi] = a.answers_to_open;
  if (med === null || lo === null) return null;
  const f = (v: number) => fmtNum(v, lang);
  return (
    <span className="tp-card-ci">
      {hi === null ? t('tp.card.ciOpen', { n: f(n), med: f(med), k: f(a.opened_runs) }) : t('tp.card.ci', { n: f(n), med: f(med), lo: f(lo), hi: f(hi) })}
    </span>
  );
}

/**
 * One card per replayed area: officer answers until the gate opened, then the share of photos answered automatically and
 * how many of those were right. Same model, same policy, very different areas: that is the point. The cards are also the
 * chart's area picker (aria-pressed), so there is one control, not two.
 */
export function AreaCards({ areas, policy, selected, onSelect, ci }: { areas: ReplayModel[]; policy: Policy; selected: string; onSelect: (key: string) => void; ci?: CiFile | null }) {
  const { t, lang } = useI18n();
  const pct = (v: number, d = 0) => `${fmtNum(v * 100, lang, { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
  return (
    <div className="tp-cards" role="group" aria-label={t('tp.areas.pick')} data-testid="area-cards">
      {areas.map((m, i) => {
        const st = replayStats(m);
        const name = REPLAY_DATASETS[m.key] ?? m.key;
        return (
          <div key={m.key} data-reveal style={{ ['--i' as string]: i }}>
          <button type="button" className="tp-card h-full w-full" aria-pressed={m.key === selected} onClick={() => onSelect(m.key)} data-testid={`area-card-${m.key}`}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="mono text-[0.72rem] tracking-[0.06em] text-ink-3">{m.key}</span>
              <span className="mono text-[0.72rem] text-ink-3">{t('tp.card.photos', { n: fmtNum(st.photos, lang) })}</span>
            </span>
            <span className="text-[0.95rem] font-semibold leading-snug">{name}</span>
            <Spark m={m} policy={policy} />
            <span className="flex items-baseline gap-2">
              <span className="tp-big tp-big-sm">{st.openedAfter !== null ? fmtNum(st.openedAfter, lang) : '—'}</span>
              <span className="text-[0.8rem] leading-tight text-ink-2">{st.openedAfter !== null ? t('tp.card.toOpen') : t('tp.card.never')}</span>
            </span>
            {ci?.areas[m.key] ? <CiLine a={ci.areas[m.key]!} n={ci.seeds_per_area} /> : null}
            <span className="mono flex flex-wrap gap-x-3 gap-y-1 border-t border-rule pt-2 text-[0.8rem]">
              <span>
                <b className="font-semibold">{st.autoShare !== null ? pct(st.autoShare) : '—'}</b> <span className="text-ink-3">{t('tp.card.auto')}</span>
              </span>
              <span>
                <b className="font-semibold text-go">{st.autoPrecision !== null ? pct(st.autoPrecision, 1) : '—'}</b> <span className="text-ink-3">{t('tp.card.right')}</span>
              </span>
            </span>
          </button>
          </div>
        );
      })}
    </div>
  );
}
