import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Chip, type Tone } from '../../ui/Chip';
import { CountText } from '../../ui/kit/CountText';
import { useI18n, type Key, type Lang } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { Fold } from '../../ui/Fold';
import { EVALS, NEW_EVALS, type EvalTile, type EvalTone, type NewEval } from './sources';

/** Chart.js lives in its own chunk, loaded only when the Safety group renders. */
const SafetyChart = lazy(() => import('./SafetyChart'));
const WarehouseChart = lazy(() => import('./WarehouseChart'));

const TONE: Record<EvalTone, Tone> ={ bad: 'wait', synthetic: 'carbon', replay: 'carbon', measured: 'neutral' };

/** "0.267", "15–63%", "89–109": the same text with the digits of the page's language. */
export const localDigits = (s: string, lang: Lang) => (lang === 'en' ? s : s.replace(/\d/g, (d) => fmtNum(Number(d), lang)));

function Bars({ tile }: { tile: EvalTile }) {
  const { lang } = useI18n();
  return (
    <div className="pf-bars">
      {tile.bars!.map((b) => (
        <div key={b.label} className="pf-bar" data-strong={!!b.strong}>
          <span>{b.label}</span>
          <i style={{ ['--v' as string]: b.value }} aria-hidden />
          <b>{localDigits(b.value.toFixed(3).replace(/0$/, ''), lang)}</b>
        </div>
      ))}
    </div>
  );
}

function Line({ tile }: { tile: EvalTile }) {
  const { lang } = useI18n();
  const pts = tile.line!;
  const W = 260;
  const H = 72;
  const xs = [0, 1, 5, 10, 25];
  // x: evenly spaced by step (0, 1, 5, 10, 25 photos), y: 0.3..0.75
  const x = (i: number) => 14 + (i / (pts.length - 1)) * (W - 28);
  const y = (v: number) => 8 + (1 - (v - 0.3) / 0.45) * (H - 26);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.y)}`).join('');
  return (
    <svg className="pf-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => (
        <g key={p.x}>
          <circle cx={x(i)} cy={y(p.y)} r={3.2} vectorEffect="non-scaling-stroke" />
          <text x={x(i)} y={H - 2} textAnchor="middle">
            {localDigits(String(xs[i]), lang)}
          </text>
          {i === 0 || i === pts.length - 1 ? (
            <text x={x(i)} y={y(p.y) - 7} textAnchor={i === 0 ? 'start' : 'end'}>
              {localDigits(p.y.toFixed(2), lang)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function Ranges({ tile }: { tile: EvalTile }) {
  const { t, lang } = useI18n();
  const pct = (v: number) => `${fmtNum(Math.round(v * 100), lang)}%`;
  return (
    <div className="pf-bars">
      {tile.ranges!.map((r) => (
        <div key={r.key} className="pf-range" data-tone={r.bad ? 'bad' : undefined}>
          <span>{t(`proof.eval.threshold.${r.key}` as Key)}</span>
          <i style={{ ['--a' as string]: r.from, ['--b' as string]: r.to }} aria-hidden />
          <b>
            {pct(r.from)}–{pct(r.to)}
          </b>
        </div>
      ))}
    </div>
  );
}

function Table({ tile }: { tile: EvalTile }) {
  const { t, lang } = useI18n();
  return (
    <table className="pf-mini">
      <thead>
        <tr>
          <th scope="col">{t('proof.eval.trust.col.area')}</th>
          <th scope="col">{t('proof.eval.trust.col.open')}</th>
          <th scope="col">{t('proof.eval.trust.col.auto')}</th>
          <th scope="col">{t('proof.eval.trust.col.right')}</th>
        </tr>
      </thead>
      <tbody>
        {tile.table!.map((r) => (
          <tr key={r.area}>
            <th scope="row">{r.area}</th>
            <td>{localDigits(r.open, lang)}</td>
            <td>{localDigits(r.auto, lang)}</td>
            <td>{localDigits(r.right, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Item = { kind: 'eval'; tile: EvalTile } | { kind: 'new'; e: NewEval };
const evalById = (id: string) => EVALS.find((x) => x.id === id);
const newById = (id: string) => NEW_EVALS.find((x) => x.id === id);

/** The results, grouped the way a visitor asks: is it safe, does the photo AI work, is it fast. */
export const GROUPS = [
  { id: 'safety', tone: 'terracotta', items: ['new:safety', 'eval:threshold', 'eval:ask'] },
  { id: 'photo', tone: 'moss', items: ['new:agritriage', 'eval:v1', 'eval:zeroShot', 'eval:kshot', 'eval:trust'] },
  { id: 'speed', tone: 'monsoon', items: ['new:sovereign', 'new:speech'] },
] as const;
export type GroupId = (typeof GROUPS)[number]['id'];

const resolve = (ref: string): Item | null => {
  const [kind, id] = ref.split(':') as ['eval' | 'new', string];
  if (kind === 'eval') {
    const tile = evalById(id);
    return tile ? { kind, tile } : null;
  }
  const e = newById(id);
  return e ? { kind, e } : null;
};

/**
 * One result as a card: the big number, one plain line on what it means, the honest label, then the technical name in
 * small print, the caveat, and "See the file". The bad results stay in. Showcase cards lean toward the mouse on a
 * desktop (data-tilt, ui/kit/autoTilt).
 */
function ResultCard({ item, i }: { item: Item; i: number }) {
  const { t, lang } = useI18n();
  const id = item.kind === 'eval' ? item.tile.id : item.e.id;
  const base = item.kind === 'eval' ? `proof.eval.${id}` : `proof.new.${id}`;
  const tone = item.kind === 'eval' ? item.tile.tone : item.e.tone;
  const value = item.kind === 'eval' ? item.tile.value : item.e.value;
  const sources = item.kind === 'eval' ? item.tile.sources : (item.e.sources ?? [item.e.source]);
  return (
    <article className="pf-card" data-reveal data-tilt="3" style={{ ['--i' as string]: i % 3 }} data-testid={item.kind === 'eval' ? `eval-${id}` : `new-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="pf-card-k">{t(`${base}.kicker` as Key)}</h4>
        <span className="flex flex-wrap gap-1.5">
          {item.kind === 'new' && item.e.partial ? <Chip tone="wait">{t('proof.new.partial')}</Chip> : null}
          <Chip tone={TONE[tone]}>{t(`proof.tone.${tone}` as Key)}</Chip>
        </span>
      </div>
      <div className="pf-num">
        <CountText text={value} localize={(v) => localDigits(v, lang)} />
      </div>
      <p className="pf-plain">{t(`proof.plain.${id}` as Key)}</p>
      {item.kind === 'eval' && item.tile.bars ? <Bars tile={item.tile} /> : null}
      {item.kind === 'eval' && item.tile.line ? <Line tile={item.tile} /> : null}
      {item.kind === 'eval' && item.tile.table ? <Table tile={item.tile} /> : null}
      {item.kind === 'eval' && item.tile.ranges ? <Ranges tile={item.tile} /> : null}
      {item.kind === 'new' ? (
        <ul className="pf-cmp">
          {item.e.compare.map((c) => (
            <li key={c.key} data-strong={c.strong || undefined} data-bad={c.bad || undefined}>
              <span>{t(`proof.new.${id}.${c.key}` as Key)}</span>
              <i style={{ ['--v' as string]: c.width }} aria-hidden />
              <b>{localDigits(c.text, lang)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <Fold>
      <p className="pf-tech">
        <span className="pf-tech-k">{t('proof.tech')}</span> {t(`${base}.what` as Key)}
      </p>
      <p className="pf-caveat">{t(`${base}.caveat` as Key)}</p>
      <div className="pf-src">
        <span className="pf-src-k">{t('proof.seeFile')}</span>
        {sources.map((s) => (
          <a key={s.path} className="link" href={s.href} target="_blank" rel="noreferrer">
            {s.path}
          </a>
        ))}
        {item.kind === 'eval' && item.tile.more ? (
          <Link to={item.tile.more} className="link inline-flex items-center gap-1 text-[0.82rem]">
            {t('proof.eval.more')} <ArrowRight size={13} aria-hidden />
          </Link>
        ) : null}
      </div>
      </Fold>
    </article>
  );
}

/** One group of result cards (Safety, Photo AI, Speed). */
export function ResultGroup({ id }: { id: GroupId }) {
  const g = GROUPS.find((x) => x.id === id)!;
  const items = g.items.map(resolve).filter((x): x is Item => !!x);
  return (
    <>
      <div className="pf-cards" data-tone={g.tone} data-testid={`eval-group-${id}`}>
        {items.map((it, i) => (
          <ResultCard key={it.kind === 'eval' ? it.tile.id : it.e.id} item={it} i={i} />
        ))}
      </div>
      {id === 'safety' ? (
        <div data-tone={g.tone}>
          <Suspense fallback={<div className="pf-chart skeleton h-[360px]" aria-hidden />}>
            <SafetyChart />
          </Suspense>
          <Suspense fallback={<div className="pf-chart skeleton h-[300px]" aria-hidden />}>
            <WarehouseChart />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
