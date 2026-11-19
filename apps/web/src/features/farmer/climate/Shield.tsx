import { useId, useState } from 'react';
import { Bug, ChevronDown, CloudRain, ExternalLink, ShieldAlert, ShieldCheck, Square, ThermometerSun, Volume2, Waves, type LucideIcon } from 'lucide-react';
import { isFallback, useI18n, type Key, type Lang } from '../../../lib/i18n';
import { fmtDate, fmtNum, pickText } from '../../../lib/format';
import { cx } from '../../../lib/cx';
import { DataMark } from '../../../ui/DataMark';
import { sourceLabel } from '../../../ui/receiptView';
import { toast } from '../../../ui/Toast';
import { SimChip } from './SimChip';
import { useReader } from '../voice';
import type { ClimateCheck, ClimateReport } from './types';

const ICON: Record<ClimateCheck['kind'], LucideIcon> = { heavy_rain: CloudRain, heat: ThermometerSun, flood: Waves, disease: Bug };

/** "Sat 21, Sun 22" (at most three, then "+2"). */
export function fmtDays(days: string[], lang: Lang): string {
  const f = (d: string) => `${fmtDate(d, lang, 'weekday')} ${fmtDate(d, lang, 'dayNum')}`;
  const head = days.slice(0, 3).map(f).join(', ');
  return days.length > 3 ? `${head} +${fmtNum(days.length - 3, lang)}` : head;
}

const num = (n: number, lang: Lang) => fmtNum(n, lang, { maximumFractionDigits: 1 });

/** One plain line per check, in the UI language (the screen and the voice say the same thing). */
export function checkLine(c: ClimateCheck, t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): string {
  if (c.level === 'unknown') return t(`fa.climate.r.${c.reason ?? 'no_forecast'}` as Key);
  const th = c.thresholds[0];
  const peak = c.peak;
  switch (c.kind) {
    case 'heavy_rain':
      return c.level === 'warn'
        ? t('fa.climate.rain.warn', { days: fmtDays(c.days, lang), mm: num(peak?.value ?? 0, lang) })
        : t('fa.climate.rain.clear', { mm: num(Number(th?.value ?? 0), lang), peak: num(peak?.value ?? 0, lang) });
    case 'heat':
      return c.level === 'warn'
        ? t('fa.climate.heat.warn', { days: fmtDays(c.days, lang), c: num(peak?.value ?? 0, lang) })
        : t('fa.climate.heat.clear', { c: num(Number(th?.value ?? 0), lang), peak: num(peak?.value ?? 0, lang) });
    case 'flood':
      return c.level === 'warn'
        ? t('fa.climate.flood.warn', { q: num(peak?.value ?? 0, lang) })
        : t('fa.climate.flood.clear', { trend: t(`fa.climate.trend.${peak?.trend === 'falling' ? 'falling' : 'stable'}` as Key) });
    case 'disease': {
      const p = { n: fmtNum(peak?.value ?? 0, lang), of: fmtNum(peak?.of ?? 7, lang), min: fmtNum(peak?.min ?? 0, lang) };
      return c.level === 'warn' ? t('fa.climate.disease.warn', { ...p, days: fmtDays(c.days, lang) }) : t('fa.climate.disease.clear', p);
    }
  }
}

function thresholdText(c: ClimateCheck, lang: Lang): string {
  return c.thresholds
    .map((p) => `${typeof p.value === 'number' ? num(p.value, lang) : p.value}${p.unit ? ` ${p.unit === 'C' ? '°C' : p.unit}` : ''}`)
    .join(' · ');
}

/** What "Hear" reads: the warnings, and for each the rule's own action when it applies here. */
export function sayText(r: ClimateReport, t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): string {
  const warn = r.checks.filter((c) => c.level === 'warn');
  if (!warn.length) return t('fa.climate.say.none');
  const parts = [t('fa.climate.say.intro')];
  for (const c of warn) {
    parts.push(`${t(`fa.climate.k.${c.kind}`)}: ${checkLine(c, t, lang)}.`);
    const title = c.rule?.title ? pickText(c.rule.title, lang) : null;
    if (title && !title.fellBack) parts.push(`${t('fa.climate.ruleSays')}: ${title.text}`);
  }
  return parts.join(' ');
}

/**
 * The Climate-Smart Shield card on Today: four checks for the next 7 days from the plan's own forecast. A warning tied
 * to a sourced rule shows the rule (its own action only when its condition holds here) and the verbatim quote; every
 * threshold says it was set by our team. Unknown is said as unknown, never as "no risk".
 */
export function Shield({
  report,
  source,
  simulated,
  loading,
}: {
  report: ClimateReport | null;
  source: 'live' | 'recorded';
  simulated: boolean;
  loading: boolean;
}) {
  const { t, lang } = useI18n();
  const reader = useReader();
  const headId = useId();

  if (loading && !report) {
    return (
      <section className="kg-card kg-shield" aria-busy="true" data-testid="kg-shield">
        <p className="sr-only-live" role="status">
          {t('fa.climate.loading')}
        </p>
        <div className="skeleton h-6 w-1/2" />
        <div className="skeleton mt-4 h-14" />
        <div className="skeleton mt-2 h-14" />
      </section>
    );
  }

  const warn = report?.warnings ?? 0;
  const Mark = warn ? ShieldAlert : ShieldCheck;
  const hear = async () => {
    if (!report) return;
    const textLang = isFallback(lang, 'fa.climate.say.intro') ? 'en' : lang;
    const r = await reader.toggle(() => ({ text: sayText(report, t, lang), textLang, status: 'unknown', notice: '', noticeLang: textLang }));
    if (r?.state === 'no-voice') toast(t('fa.voice.noVoice', { lang: r.lang === 'bn' ? 'বাংলা' : r.lang.toUpperCase() }), { tone: 'info', ms: 4500 });
    if (r?.state === 'unsupported') toast(t('fa.voice.noTts'), { tone: 'info', ms: 4500 });
  };

  return (
    <section className={cx('kg-card kg-shield', warn > 0 && 'has-warn', simulated && 'is-sim')} aria-labelledby={headId} data-testid="kg-shield">
      <header className="kg-shield-head">
        <span className={cx('kg-shield-mark', warn ? 'is-warn' : 'is-clear')} aria-hidden>
          <Mark size={26} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{t('fa.climate.eyebrow')}</p>
          <h2 id={headId} className="kg-shield-title" data-testid="kg-shield-title">
            {!report ? t('fa.climate.title') : warn === 0 ? t('fa.climate.none') : warn === 1 ? t('fa.climate.one') : t('fa.climate.some', { n: fmtNum(warn, lang) })}
          </h2>
        </div>
        {report && (
          <button type="button" className="kg-hear" onClick={() => void hear()} aria-pressed={reader.playing} aria-label={t('fa.climate.hear')} data-testid="kg-hear">
            {reader.playing ? <Square size={16} aria-hidden /> : <Volume2 size={18} aria-hidden />}
            <span aria-hidden>{reader.playing ? t('fa.climate.stop') : t('fa.climate.hearShort')}</span>
          </button>
        )}
      </header>

      {simulated && (
        <p className="kg-sim-note" data-testid="kg-shield-sim">
          <SimChip />
          <span>{t('fa.climate.simNote')}</span>
        </p>
      )}

      {!report ? (
        <p className="mt-3 text-sm text-ink-2">{t('fa.climate.noForecast')}</p>
      ) : (
        <ul className="kg-checks" aria-label={t('fa.climate.title')}>
          {report.checks.map((c, i) => (
            <CheckRow key={c.kind} check={c} index={i} />
          ))}
        </ul>
      )}

      {report && (
        <footer className="kg-shield-foot">
          {simulated ? null : source === 'recorded' ? <DataMark kind="recorded" date={report.data_as_of ?? undefined} /> : <DataMark kind="live" />}
          {!simulated && report.forecast_source && <span className="text-xs text-ink-3">{t('fa.climate.forecastBy', { source: sourceLabel(report.forecast_source) })}</span>}
          {!simulated && report.checks.some((c) => c.kind === 'flood' && c.level !== 'unknown') && <span className="text-xs text-ink-3">{t('fa.climate.riverBy')}</span>}
        </footer>
      )}
    </section>
  );
}

function CheckRow({ check: c, index }: { check: ClimateCheck; index: number }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(c.level === 'warn');
  const id = useId();
  const Icon = ICON[c.kind];
  const title = c.rule?.title ? pickText(c.rule.title, lang) : null;
  const hasMore = c.level !== 'unknown' || !!c.thresholds.length;
  return (
    <li className={cx('kg-check', `is-${c.level}`)} style={{ ['--i' as string]: index }} data-testid={`kg-check-${c.kind}`} data-level={c.level}>
      <button type="button" className="kg-check-row" aria-expanded={hasMore ? open : undefined} aria-controls={hasMore ? id : undefined} onClick={() => hasMore && setOpen((o) => !o)}>
        <span className="kg-check-icon" aria-hidden>
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="kg-check-name">{t(`fa.climate.k.${c.kind}`)}</span>
            <span className={cx('chip', c.level === 'warn' ? 'chip-stop' : c.level === 'clear' ? 'chip-go' : 'chip-wait')}>{t(`fa.climate.l.${c.level}`)}</span>
          </span>
          <span className="kg-check-line">{checkLine(c, t, lang)}</span>
        </span>
        {hasMore && <ChevronDown size={18} aria-hidden className={cx('kg-chev flex-none', open && 'is-open')} />}
      </button>
      {hasMore && open && (
        <div id={id} className="kg-check-body">
          {c.rule && (
            <div className="kg-rule" data-testid={`kg-rule-${c.kind}`}>
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="mono font-semibold text-ink">{t('fa.climate.rule', { id: c.rule.rule_id, v: c.rule.version })}</span>
                <span className="chip">{t(`ui.review.${c.rule.review_level}` as Key)}</span>
              </p>
              {title && (
                <p className="kg-rule-says">
                  <span className="eyebrow block">{t('fa.climate.ruleSays')}</span>
                  <span lang={title.lang}>{title.text}</span>
                </p>
              )}
              <blockquote className="kg-quote" lang={c.rule.source.language}>
                <span className="eyebrow block" lang={lang}>
                  {t('fa.climate.sourceSays')}
                </span>
                “{c.rule.source.quote}”
              </blockquote>
              <p className="text-xs text-ink-3">
                <a className="kg-link" href={c.rule.source.url} target="_blank" rel="noreferrer">
                  {t('fa.climate.source', { doc: c.rule.source.publisher, page: fmtNum(c.rule.source.page, lang) })}
                  <ExternalLink size={12} aria-hidden className="ml-1 inline" />
                </a>
              </p>
            </div>
          )}
          {c.rule_withdrawn && <p className="kg-withdrawn">{t('fa.climate.withdrawn', { rule: c.rule_withdrawn })}</p>}
          {c.thresholds.length > 0 && (
            <p className="kg-team" data-testid={`kg-team-${c.kind}`}>
              <span className="mono">{thresholdText(c, lang)}</span>
              <span> · {t('fa.climate.team')}</span>
            </p>
          )}
          {c.level === 'unknown' && <p className="text-xs text-ink-3">{t('fa.climate.unknownNote')}</p>}
          {c.context && (
            <p className="kg-context">
              <span className="eyebrow block">{t('fa.climate.why')}</span>
              <span lang={pickText(c.context.text, lang).lang}>{pickText(c.context.text, lang).text}</span>{' '}
              <a className="kg-link" href={c.context.url} target="_blank" rel="noreferrer">
                {c.context.source}
              </a>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
