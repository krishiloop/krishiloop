import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Chip, type Tone } from '../../ui/Chip';
import { CountText } from '../../ui/kit/CountText';
import { spotlight } from '../../ui/kit/hooks';
import { useI18n, type Key, type Lang } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { EVALS, NEW_EVALS, type EvalTile, type EvalTone } from './sources';

const TONE: Record<EvalTone, Tone> = { bad: 'wait', synthetic: 'carbon', replay: 'carbon', measured: 'neutral' };

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

/**
 * The evaluations, one tile each: the number as the file states it, what it measures, the caveat, and the files. The bad
 * results are first and stay in: a model near chance, a threshold that passes wrong answers, a synthetic test set.
 */
export function EvalTiles() {
  const { t, lang } = useI18n();
  return (
    <div className="pf-tiles" data-testid="eval-tiles">
      {EVALS.map((tile, i) => (
        <article key={tile.id} className="pf-tile surface" data-reveal style={{ ['--i' as string]: i % 3 }} data-testid={`eval-${tile.id}`} {...spotlight()}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="eyebrow m-0">{t(`proof.eval.${tile.id}.kicker` as Key)}</h3>
            <Chip tone={TONE[tile.tone]}>{t(`proof.tone.${tile.tone}` as Key)}</Chip>
          </div>
          <div className="pf-num">
            <CountText text={tile.value} localize={(v) => localDigits(v, lang)} />
          </div>
          <p className="m-0 font-semibold leading-snug">{t(`proof.eval.${tile.id}.what` as Key)}</p>
          {tile.bars ? <Bars tile={tile} /> : null}
          {tile.line ? <Line tile={tile} /> : null}
          {tile.table ? <Table tile={tile} /> : null}
          {tile.ranges ? <Ranges tile={tile} /> : null}
          <p className="m-0 text-[0.9rem] text-ink-2">{t(`proof.eval.${tile.id}.caveat` as Key)}</p>
          <div className="pf-src">
            {tile.sources.map((s) => (
              <a key={s.path} className="link" href={s.href} target="_blank" rel="noreferrer">
                {s.path}
              </a>
            ))}
            {tile.more ? (
              <Link to={tile.more} className="link inline-flex items-center gap-1 text-[0.82rem]">
                {t('proof.eval.more')} <ArrowRight size={13} aria-hidden />
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * The three results measured on 29 Oct (safety eval v1, Bangla speech, sovereign mode): the headline number, a two- or
 * three-row comparison exactly as the report states it, the caveat, and the report. "Not final" where runs continue.
 */
export function NewTiles() {
  const { t, lang } = useI18n();
  return (
    <div className="pf-new" data-testid="eval-new">
      {NEW_EVALS.map((e, i) => (
        <article key={e.id} className="pf-tile surface" data-reveal style={{ ['--i' as string]: i }} data-testid={`new-${e.id}`} {...spotlight()}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="eyebrow m-0">{t(`proof.new.${e.id}.kicker` as Key)}</h3>
            <span className="flex flex-wrap gap-1.5">
              {e.partial ? <Chip tone="wait">{t('proof.new.partial')}</Chip> : null}
              <Chip tone={TONE[e.tone]}>{t(`proof.tone.${e.tone}` as Key)}</Chip>
            </span>
          </div>
          <div className="pf-num">
            <CountText text={e.value} localize={(v) => localDigits(v, lang)} />
          </div>
          <p className="m-0 font-semibold leading-snug">{t(`proof.new.${e.id}.what` as Key)}</p>
          <ul className="pf-cmp">
            {e.compare.map((c) => (
              <li key={c.key} data-strong={c.strong || undefined} data-bad={c.bad || undefined}>
                <span>{t(`proof.new.${e.id}.${c.key}` as Key)}</span>
                <i style={{ ['--v' as string]: c.width }} aria-hidden />
                <b>{localDigits(c.text, lang)}</b>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[0.9rem] text-ink-2">{t(`proof.new.${e.id}.caveat` as Key)}</p>
          <div className="pf-src">
            <a className="link" href={e.source.href} target="_blank" rel="noreferrer">
              {e.source.path}
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
