import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FlaskConical, Pause, Play, RotateCcw } from 'lucide-react';
import { ReplayChart } from './ReplayChart';
import { nearestIndex, readoutAt, replayStats, stageRows, REPLAY_DATASETS, type ReplayModel, type ShapedReplay } from './replay';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useCountUp, useInViewOnce } from '../../lib/hooks';
import { useMotionReduced } from '../../lib/motionPref';
import { cx } from '../../lib/cx';

const PLAY_MS = 5600;
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

/** A number under the chart that counts up once when it scrolls into view and again when another area is chosen. */
function Stat({ value, format, label, testId, tone }: { value: number; format: (n: number) => string; label: string; testId: string; tone?: 'go' }) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(box);
  const num = useCountUp(value, seen, format, 1000);
  return (
    <div ref={box} className="tr-stat" data-tone={tone} data-testid={testId}>
      <p className="tr-stat-num display">
        <span ref={num} className="tabular" aria-hidden>
          {format(value)}
        </span>
        <span className="sr-only">{format(value)}</span>
      </p>
      <p className="tr-stat-label">{label}</p>
    </div>
  );
}

/** The area with the biggest share of automatic answers: the most telling place to start, chosen from the data, not by name. */
const bestStart = (areas: ReplayModel[]) => [...areas].sort((a, b) => (b.summary.auto_share_of_all_photos ?? 0) - (a.summary.auto_share_of_all_photos ?? 0))[0]?.key ?? areas[0]!.key;

/**
 * Beat 3 of the pitch: the area trust panel's replay. One dataset at a time (the same model, different places), the lower
 * bound against officer answers, the dashed bar, the moment the gate opened, and after it how many photos were answered
 * automatically and how many of those were right. The label that says what this is (a replay of public datasets, the
 * labels standing in for officers) sits at the top, always, in plain words.
 */
export function ReplayPanel({ replay, sample }: { replay: ShapedReplay; sample: boolean }) {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const [key, setKey] = useState(() => bestStart(replay.areas));
  const model = useMemo(() => replay.areas.find((a) => a.key === key) ?? replay.areas[0]!, [replay, key]);
  const last = model.points.length - 1;
  const [cursor, setCursor] = useState(last);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  }, []);
  useEffect(() => {
    stop();
    setCursor(model.points.length - 1);
  }, [model, stop]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () => {
    cancelAnimationFrame(raf.current);
    const from = cursor >= last ? 0 : (model.points[cursor]?.verdicts ?? 0);
    const to = model.maxVerdicts;
    const t0 = performance.now();
    setPlaying(true);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / PLAY_MS);
      setCursor(nearestIndex(model, from + (to - from) * ease(p)));
      if (p < 1) raf.current = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(step);
  };
  const scrub = (i: number) => {
    stop();
    setCursor(i);
  };

  const s = replayStats(model);
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct0 = useCallback((n: number) => `${fmtNum(Math.round(n), lang)}%`, [lang]);
  const pct1 = useCallback((n: number) => `${fmtNum(n, lang, { maximumFractionDigits: 1 })}%`, [lang]);
  const int = useCallback((n: number) => fmtNum(Math.round(n), lang), [lang]);

  const r = readoutAt(model, cursor);
  const gateWord = t(r.gateOpen ? 'trust.replay.gate.open' : 'trust.replay.gate.closed');
  const readout =
    r.lowerBound === null
      ? t('trust.replay.readout.nobound', { verdicts: fmtNum(r.verdicts, lang), photos: fmtNum(r.photos, lang), gate: gateWord })
      : t('trust.replay.readout', { verdicts: fmtNum(r.verdicts, lang), photos: fmtNum(r.photos, lang), lb: two(r.lowerBound), gate: gateWord, auto: fmtNum(r.autoAnswers, lang), right: fmtNum(r.autoRight, lang) });
  const stages = stageRows(model.summary);
  const dataset = REPLAY_DATASETS[model.key] ?? model.key;
  const officerOnly = Math.max(0, s.photos - s.autoAnswers);

  return (
    <section className="surface surface-pad tr-replay" aria-labelledby="tr-replay-t" data-testid="replay-panel" data-area={model.key} data-sample={sample}>
      <p className="tr-label" data-testid="replay-label">
        <FlaskConical size={16} aria-hidden />
        <span>{t('trust.replay.label')}</span>
      </p>
      {sample ? (
        <p className="tr-sample" data-testid="replay-sample">
          <SampleBadge />
          <span>{t('trust.replay.sample')}</span>
        </p>
      ) : null}

      <h2 id="tr-replay-t" className="tr-h">
        {t('trust.replay.title')}
      </h2>

      <div className="tr-controls">
        <div className="seg tr-seg" role="group" aria-label={t('trust.replay.datasets')}>
          {replay.areas.map((a) => (
            <button key={a.key} type="button" aria-pressed={a.key === model.key} onClick={() => setKey(a.key)} data-testid={`replay-area-${a.key}`}>
              {a.key}
            </button>
          ))}
        </div>
        <p className="tr-ds" data-testid="replay-dataset">
          {t('trust.replay.ds', { name: dataset })}
        </p>
      </div>

      <ReplayChart model={model} policy={replay.policy} cursor={cursor} onCursor={scrub} />

      <ul className="tr-legend" aria-label={t('trust.replay.title')}>
        <li>
          <i className="tr-sw tr-sw-curve" aria-hidden /> {t('trust.meter.bound')}
        </li>
        <li>
          <i className="tr-sw tr-sw-bar" aria-hidden /> {t('trust.replay.bar', { bar: two(replay.policy.openLb) })}
        </li>
        {model.windows.length ? (
          <>
            <li>
              <i className="tr-sw tr-sw-open" aria-hidden /> {t('trust.replay.open')}
            </li>
            <li>
              <i className="tr-sw tr-sw-close" aria-hidden /> {t('trust.replay.closeBar', { bar: two(replay.policy.closeLb) })}
            </li>
          </>
        ) : null}
        <li>
          <i className="tr-sw tr-sw-hatch" aria-hidden /> {t('trust.replay.uncounted', { n: fmtNum(replay.policy.minSure, lang) })}
        </li>
      </ul>

      <div className="tr-scrub">
        {!reduced ? (
          <button type="button" className="btn btn-ghost btn-sm tr-play" onClick={playing ? stop : play} data-testid="replay-play" aria-pressed={playing}>
            {playing ? <Pause size={15} aria-hidden /> : cursor >= last ? <RotateCcw size={15} aria-hidden /> : <Play size={15} aria-hidden />}
            {playing ? t('trust.replay.pause') : cursor >= last ? t('trust.replay.again') : t('trust.replay.play')}
          </button>
        ) : null}
        <input type="range" className="tr-range" min={0} max={Math.max(1, last)} step={1} value={cursor} onChange={(e) => scrub(Number(e.currentTarget.value))} aria-label={t('trust.replay.scrub')} aria-valuetext={readout} data-testid="replay-range" />
      </div>
      <p className="tr-readout" aria-live="off" data-testid="replay-readout">
        {readout}
      </p>

      {s.neverOpened ? (
        <div className="tr-never" data-testid="replay-never">
          <Stat key={`${model.key}-0`} value={0} format={pct0} label={t('trust.replay.stat.auto')} testId="replay-stat-auto" />
          <p className="tr-note">{t('trust.replay.never')}</p>
        </div>
      ) : (
        <div className="tr-stats" data-testid="replay-stats">
          <Stat key={`${model.key}-a`} value={(s.autoShare ?? 0) * 100} format={pct0} label={t('trust.replay.stat.auto')} testId="replay-stat-auto" tone="go" />
          <Stat key={`${model.key}-b`} value={(s.autoPrecision ?? 0) * 100} format={pct1} label={t('trust.replay.stat.right')} testId="replay-stat-right" tone="go" />
          <Stat key={`${model.key}-c`} value={s.openedAfter ?? 0} format={int} label={t('trust.replay.stat.opened')} testId="replay-stat-opened" />
        </div>
      )}
      <p className="sr-only" data-testid="replay-auto-line">
        {s.autoShare !== null && s.autoPrecision !== null ? t('trust.replay.autoLine', { share: pct0((s.autoShare ?? 0) * 100), right: pct1((s.autoPrecision ?? 0) * 100) }) : ''}
      </p>

      <div className="tr-handled" key={`h-${model.key}`}>
        <p className="tr-handled-h">{t('trust.replay.handled', { photos: fmtNum(s.photos, lang) })}</p>
        <div className="tr-handled-bar" role="img" aria-label={`${t('trust.replay.handled.auto', { n: fmtNum(s.autoAnswers, lang) })}. ${t('trust.replay.handled.officer', { n: fmtNum(officerOnly, lang) })}`}>
          <span data-kind="auto" style={{ flexGrow: s.autoAnswers } as CSSProperties} />
          <span data-kind="officer" style={{ flexGrow: officerOnly } as CSSProperties} />
        </div>
        <p className="tr-handled-legend">
          <span className="tr-key" data-kind="auto">
            {t('trust.replay.handled.auto', { n: fmtNum(s.autoAnswers, lang) })}
          </span>
          <span className="tr-key" data-kind="officer">
            {t('trust.replay.handled.officer', { n: fmtNum(officerOnly, lang) })}
          </span>
        </p>
      </div>

      {s.closings > 0 ? (
        <p className={cx('tr-note', 'tr-note-stop')} data-testid="replay-closings">
          {t('trust.replay.closings', { n: fmtNum(s.closings, lang) })}
        </p>
      ) : null}

      {stages.length ? (
        <details className="tr-details" data-testid="replay-stages">
          <summary>{t('trust.replay.suggestion')}</summary>
          <p className="m-0 mt-2 text-sm text-chrome">{t('trust.replay.suggestion.body')}</p>
          <table className="tr-table">
            <tbody>
              {stages.map((row) => (
                <tr key={row.from}>
                  <th scope="row">{t('trust.replay.stage', { from: fmtNum(row.from, lang), to: fmtNum(Math.min(row.to, s.photos), lang) })}</th>
                  <td className="tabular">
                    {row.top1 === null ? '—' : pct0(row.top1 * 100)} <small>{t('trust.replay.top1')}</small>
                  </td>
                  <td className="tabular">
                    {row.top2 === null ? '—' : pct0(row.top2 * 100)} <small>{t('trust.replay.top2')}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      <p className="tr-credit">{t('trust.replay.credit', { backbone: replay.backbone })}</p>
      {replay.note && !sample && lang === 'en' ? <p className="tr-credit" lang="en">{t('trust.replay.serverNote', { note: replay.note })}</p> : null}
    </section>
  );
}
