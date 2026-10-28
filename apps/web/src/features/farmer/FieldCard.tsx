import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Satellite } from 'lucide-react';
import { SampleBadge } from '../../components/ui/Badges';
import { CHIP_H, CHIP_W, buildGeometry, paintChip, seedOf } from './syntheticChip';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, fmtNum, humanize } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { useOnScreen } from '../../lib/hooks';
import type { DemoField, FieldSnapshot } from '../../lib/api/types';

const PRECISION_KEY: Record<string, Key> = {
  sample_location: 'field.precision.sample_location',
  field_private: 'field.precision.field_private',
  fuzzed_1km: 'field.precision.fuzzed_1km',
  union_level: 'field.precision.union_level',
};
const DURATION = 5200;

/**
 * "Your field from space": the Sentinel-2 chip when the snapshot has one (`s2.chip_url`), the season time-lapse
 * when it has `s2.timelapse_url`; otherwise a clearly labelled ILLUSTRATION (drawn pixels, animated season) so the
 * slot is alive and the layout never shifts when real imagery arrives.
 */
export function FieldCard({ field, snapshot }: { field: DemoField; snapshot: FieldSnapshot | null }) {
  const { t, lang } = useI18n();
  const s2 = snapshot?.s2 ?? null;
  const chipUrl = s2?.chip_url || null;
  const lapseUrl = s2?.timelapse_url || null;
  const real = !!(chipUrl || lapseUrl);
  const both = !!(chipUrl && lapseUrl);
  const [view, setView] = useState<'chip' | 'lapse'>(lapseUrl ? 'lapse' : 'chip');

  return (
    <section className="fieldcard surface" aria-labelledby="field-t" data-testid="field-card">
      <div className="surface-pad !pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="field-t" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Satellite size={18} className="text-sun" aria-hidden /> {t('field.title')}
          </h2>
          {both ? (
            <div className="seg" role="group" aria-label={t('field.title')}>
              <button type="button" aria-pressed={view === 'chip'} onClick={() => setView('chip')}>
                {t('field.title')}
              </button>
              <button type="button" aria-pressed={view === 'lapse'} onClick={() => setView('lapse')}>
                {t('field.timelapse')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="fieldcard-frame">
        {real ? (
          view === 'lapse' && lapseUrl ? (
            <Lapse url={lapseUrl} label={t('field.timelapse')} />
          ) : chipUrl ? (
            <img src={chipUrl} alt={t('field.alt')} width={CHIP_W} height={CHIP_H} className="fieldcard-img" />
          ) : null
        ) : (
          <SyntheticLapse field={field} />
        )}
        <span className="fieldcard-bracket" data-p="tl" aria-hidden />
        <span className="fieldcard-bracket" data-p="tr" aria-hidden />
        <span className="fieldcard-bracket" data-p="bl" aria-hidden />
        <span className="fieldcard-bracket" data-p="br" aria-hidden />
        <span className="fieldcard-tag tl chip chip-mono">{field.field_id}</span>
        {!real ? (
          <span className="fieldcard-tag tr">
            <SampleBadge label={t('field.illustration')} className="bg-void/70" />
          </span>
        ) : null}
        {s2 ? (
          <span className="fieldcard-tag bl chip chip-mono">
            {t('field.s2', { date: fmtDate(s2.acquired_at, lang) })} · {t('field.cloud', { n: fmtNum(Math.round(s2.cloud_cover), lang) })}
          </span>
        ) : null}
      </div>

      <div className="surface-pad !pt-4">
        {!real ? <p className="m-0 mb-3 text-sm text-chrome">{t('field.noChip')}</p> : null}
        <dl className="fieldcard-facts">
          <div>
            <dt>{t('field.crop')}</dt>
            <dd>{humanize(field.crop)}</dd>
          </div>
          <div>
            <dt>{t('field.stage')}</dt>
            <dd>{humanize(field.stage)}</dd>
          </div>
          <div>
            <dt>{t('field.place')}</dt>
            <dd>{PRECISION_KEY[field.precision] ? t(PRECISION_KEY[field.precision]!) : field.precision}</dd>
          </div>
          {s2?.ndvi_mean != null ? (
            <div>
              <dt>NDVI</dt>
              <dd className="tabular">{fmtNum(s2.ndvi_mean, lang, { maximumFractionDigits: 2 })}</dd>
            </div>
          ) : null}
        </dl>
        <p className="m-0 mt-3 text-xs text-dim">{field.label}</p>
      </div>
    </section>
  );
}

function Lapse({ url, label }: { url: string; label: string }) {
  const { t } = useI18n();
  const reduced = useMotionReduced();
  const video = useRef<HTMLVideoElement>(null);
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing]);
  if (!isVideo) return <img src={url} alt={label} className="fieldcard-img" />;
  return (
    <>
      <video ref={video} src={url} className="fieldcard-img" muted loop playsInline autoPlay={!reduced} aria-label={label} />
      <button type="button" className="fieldcard-play btn btn-quiet btn-icon btn-sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t('field.pause') : t('field.play')}>
        {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
      </button>
    </>
  );
}

/** Drawn illustration with a season scrubber. Plays once when it scrolls into view (never loops), then you drive it. */
function SyntheticLapse({ field }: { field: DemoField }) {
  const { t } = useI18n();
  const reduced = useMotionReduced();
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const onScreen = useOnScreen(wrap, '0px');
  const geo = useMemo(() => buildGeometry(seedOf(field.field_id)), [field.field_id]);
  const tRef = useRef(reduced ? 0.55 : 0);
  const rafRef = useRef(0);
  const startedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);

  const draw = (t01: number) => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    tRef.current = t01;
    paintChip(ctx, geo, t01);
    if (slider.current) slider.current.value = String(Math.round(t01 * 1000));
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };

  const play = (from = tRef.current >= 0.999 ? 0 : tRef.current) => {
    cancelAnimationFrame(rafRef.current);
    setDone(false);
    setPlaying(true);
    const t0 = performance.now();
    const startT = from;
    const tick = (now: number) => {
      const p = Math.min(1, startT + ((now - t0) / DURATION) * (1 - startT));
      draw(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setPlaying(false);
        setDone(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    draw(tRef.current);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  // autoplay once, when the card is first seen (not with reduced motion: the scrubber is there)
  useEffect(() => {
    if (!onScreen || startedRef.current || reduced) return;
    startedRef.current = true;
    play(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreen, reduced]);

  return (
    <div ref={wrap} className="fieldcard-canvaswrap">
      <canvas ref={canvas} width={CHIP_W} height={CHIP_H} className="fieldcard-img fieldcard-pixels" role="img" aria-label={t('field.alt')} />
      <div className="fieldcard-controls">
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => (playing ? stop() : play())} aria-label={playing ? t('field.pause') : done ? t('field.replay') : t('field.play')}>
          {playing ? <Pause size={16} aria-hidden /> : done ? <RotateCcw size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <label className="sr-only" htmlFor="season-scrub">
          {t('field.scrub')}
        </label>
        <input
          ref={slider}
          id="season-scrub"
          className="range"
          type="range"
          min={0}
          max={1000}
          defaultValue={Math.round(tRef.current * 1000)}
          onChange={(e) => {
            stop();
            draw(Number(e.currentTarget.value) / 1000);
          }}
        />
      </div>
    </div>
  );
}
