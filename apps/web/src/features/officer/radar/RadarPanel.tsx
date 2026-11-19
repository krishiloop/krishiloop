import { useEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, Megaphone, RefreshCw, Send, X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import '../../../lib/i18n/strings.krishiguard';
import { fmtNum } from '../../../lib/format';
import { cx } from '../../../lib/cx';
import { DataMark } from '../../../ui/DataMark';
import { Segmented } from '../../../ui/Segmented';
import { fetchRadar, noticePreview, warnNeighbours } from '../../farmer/climate/api';
import { agoText, problemName } from '../../farmer/climate/NearYou';
import type { RadarAggregate, RadarCell, RadarData, WarnResult } from '../../farmer/climate/types';
import { RadarMap } from './RadarMap';
import { SimChip } from '../../farmer/climate/SimChip';
import './radar.css';

type Layer = 'real' | 'sim';

/**
 * The officer's village outbreak radar (builder R): a mission-control map of places where at least k farmers reported
 * the same problem in the last 14 days, from real reports or from the SIMULATED village scenario (kept apart and
 * labelled). Hidden cells are only counted. "Warn neighbours" sends one fixed notice through Reach to this session's
 * holders in that place (sandbox SMS, Telegram when the bot runs); in recorded mode it shows the notice and sends nothing.
 */
export default function RadarPanel() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<RadarData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [country, setCountry] = useState<'BD' | 'KE'>('BD');
  const [selected, setSelected] = useState<string | null>(null);

  const load = (force = false) => {
    setErr(null);
    fetchRadar(force)
      .then((d) => {
        setData(d);
        setLayer((l) => l ?? (d.real && d.real.cells.length ? 'real' : 'sim'));
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => load(), []);

  const agg: RadarAggregate | null = data ? (layer === 'real' ? data.real : data.simulated) : null;
  const cells = useMemo(() => (agg?.cells ?? []).filter((c) => c.country === country), [agg, country]);
  const k = data?.simulated.k ?? 3;
  const days = data?.simulated.window_days ?? 14;

  if (err) {
    return (
      <section className="kg-radar" role="alert">
        <p className="text-ink-2">{err}</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => load(true)}>
          <RefreshCw size={16} aria-hidden />
          {t('ui.retry')}
        </button>
      </section>
    );
  }
  if (!data || !layer) {
    return (
      <section className="kg-radar" aria-busy="true">
        <p className="sr-only-live" role="status">
          {t('off.radar.loading')}
        </p>
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton mt-4 h-80" />
      </section>
    );
  }

  return (
    <section className="kg-radar" aria-labelledby="kg-radar-title" data-testid="kg-radar">
      <header className="kg-radar-head">
        <div className="min-w-0">
          <h2 id="kg-radar-title" className="t-head">
            {t('off.radar.title')}
          </h2>
          <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-ink-2">{t('off.radar.sub', { days: fmtNum(days, lang), k: fmtNum(k, lang) })}</p>
        </div>
        <div className="kg-radar-controls">
          <Segmented
            label={t('off.radar.layer')}
            value={layer}
            onChange={(v) => {
              setLayer(v);
              setSelected(null);
            }}
            options={[
              { value: 'real', label: t('off.radar.layer.real') },
              { value: 'sim', label: t('off.radar.layer.sim') },
            ]}
          />
          <Segmented
            label={t('off.radar.country')}
            value={country}
            onChange={(v) => {
              setCountry(v);
              setSelected(null);
            }}
            options={[
              { value: 'BD', label: t('off.radar.c.BD') },
              { value: 'KE', label: t('off.radar.c.KE') },
            ]}
          />
        </div>
      </header>

      {layer === 'sim' ? (
        <p className="kg-radar-note is-sim" data-testid="kg-radar-simnote">
          <SimChip />
          <span>{t('off.radar.simNote')}</span>
        </p>
      ) : data.real === null ? (
        <p className="kg-radar-note" data-testid="kg-radar-realoff">
          <DataMark kind="recorded" />
          <span>{t('off.radar.realOff')}</span>
        </p>
      ) : (
        <p className="kg-radar-note">
          <DataMark kind="live" />
          {data.real.cells.length === 0 && <span>{t('off.radar.realNone', { k: fmtNum(k, lang) })}</span>}
        </p>
      )}

      <div className="kg-radar-grid">
        <RadarMap country={country} cells={cells} simulated={layer === 'sim'} selected={selected} onSelect={setSelected} />
        <div className="kg-radar-side">
          <h3 className="eyebrow">{t('off.radar.cells')}</h3>
          {cells.length ? (
            <ul className="kg-cells" data-testid="kg-radar-cells">
              {cells.map((c) => (
                <CellRow key={`${c.area}|${c.problem}`} cell={c} layer={layer} windowDays={days} selected={selected === c.area} onSelect={() => setSelected(c.area)} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-2">{t('off.radar.cellsNone', { country: t(`off.radar.c.${country}`) })}</p>
          )}
          {agg && (
            <p className="kg-hidden" data-testid="kg-radar-hidden">
              <EyeOff size={15} aria-hidden className="mr-1.5 inline align-[-2px]" />
              {agg.hidden.reports
                ? t('off.radar.hidden', { reports: fmtNum(agg.hidden.reports, lang), cells: fmtNum(agg.hidden.cells, lang), k: fmtNum(k, lang) })
                : t('off.radar.hiddenNone')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function CellRow({ cell: c, layer, windowDays, selected, onSelect }: { cell: RadarCell; layer: Layer; windowDays: number; selected: boolean; onSelect: () => void }) {
  const { t, lang } = useI18n();
  const [stage, setStage] = useState<'idle' | 'confirm' | 'sending' | 'done'>('idle');
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const [result, setResult] = useState<WarnResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const simulated = layer === 'sim';

  const open = async () => {
    onSelect();
    setStage('confirm');
    setError(null);
    setPreview(await noticePreview(c, simulated, windowDays));
    requestAnimationFrame(() => confirmRef.current?.focus());
  };
  const send = async () => {
    setStage('sending');
    try {
      const r = await warnNeighbours(c, simulated ? 'simulated' : 'real', windowDays);
      setResult(r);
      if (r.text) setPreview(r.text);
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('confirm');
    }
  };
  const title = t('off.radar.cellTitle', { area: c.area_name, problem: problemName(c.problem, t) });

  return (
    <li className={cx('kg-cell', selected && 'is-sel')} data-testid="kg-radar-cell" data-area={c.area}>
      <button type="button" className="kg-cell-main" onClick={onSelect} aria-pressed={selected}>
        <span className={`kg-cell-n kg-step-${c.reporters >= 8 ? 3 : c.reporters >= 5 ? 2 : 1}`} aria-hidden>
          {fmtNum(c.reporters, lang)}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-semibold leading-snug">{title}</span>
          <span className="block text-xs text-ink-3">
            {t('off.radar.cellMeta', { n: fmtNum(c.reporters, lang), reports: fmtNum(c.reports, lang), ago: agoText(c.last_days_ago, t, lang) })}
          </span>
          <span className="block text-xs text-ink-3">
            {t('off.radar.kinds', { photo: fmtNum(c.kinds.photo, lang), ask: fmtNum(c.kinds.ask, lang), abstention: fmtNum(c.kinds.abstention, lang) })}
          </span>
        </span>
      </button>
      {stage === 'idle' ? (
        <button type="button" className="btn btn-secondary btn-sm kg-warn-btn" onClick={() => void open()} data-testid="kg-warn">
          <Megaphone size={15} aria-hidden />
          {t('off.radar.warn')}
        </button>
      ) : (
        <div ref={confirmRef} tabIndex={-1} className="kg-warn-box" role="group" aria-label={t('off.radar.warnTitle', { area: c.area_name })} data-testid="kg-warn-box">
          <p className="font-semibold">{t('off.radar.warnTitle', { area: c.area_name })}</p>
          <p className="text-xs text-ink-2">{t('off.radar.warnSub', { area: c.area_name })}</p>
          {preview && (
            <div className="kg-notice">
              <p className="eyebrow">{t('off.radar.warnPreview')}</p>
              <p lang="bn" className="text-sm">
                {preview.bn}
              </p>
              <p lang="en" className="text-sm text-ink-2">
                {preview.en}
              </p>
            </div>
          )}
          {stage === 'done' && result && (
            <p className="kg-warn-result" role="status" data-testid="kg-warn-result">
              {result.mode === 'sample'
                ? t('off.radar.warnSample', { area: c.area_name })
                : result.total === 0
                  ? t('off.radar.warnNone', { area: c.area_name })
                  : t('off.radar.warnDone', { n: fmtNum(result.total, lang), sms: fmtNum(result.sms_sandbox, lang), tg: fmtNum(result.telegram, lang) })}
            </p>
          )}
          {error && (
            <p className="kg-err" role="alert">
              {t('off.radar.warnErr', { msg: error })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {stage !== 'done' && (
              <button type="button" className="btn btn-primary btn-sm" disabled={stage === 'sending'} onClick={() => void send()} data-testid="kg-warn-send">
                <Send size={15} aria-hidden />
                {stage === 'sending' ? t('off.radar.warnSending') : t('off.radar.warnSend')}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStage('idle')}>
              <X size={15} aria-hidden />
              {stage === 'done' ? t('fa.drawer.close') : t('off.radar.warnCancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
