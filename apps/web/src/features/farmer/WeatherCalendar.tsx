import { Cloud, CloudDrizzle, CloudRain, CloudRainWind, Droplets, Sun, TriangleAlert } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, fmtNum, parseDate } from '../../lib/format';
import { rainFill, skyOf, type Sky } from './weather';
import type { FieldSnapshot, ForecastDay, RiskLevel } from '../../lib/api/types';

const SKY_ICON = { dry: Sun, cloudy: Cloud, drizzle: CloudDrizzle, rain: CloudRain, heavy: CloudRainWind } as const;
const SKY_KEY: Record<Sky, Key> = { dry: 'weather.dry', cloudy: 'weather.cloudy', drizzle: 'weather.drizzle', rain: 'weather.rainy', heavy: 'weather.heavy' };
const RISK_KEY: Record<RiskLevel, Key> = { low: 'risk.low', medium: 'risk.medium', high: 'risk.high', unknown: 'risk.unknown' };

const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 7-day weather and risk calendar. Numbers come from the field snapshot's forecast (source + issue time shown).
 * A risk dot appears only when the planner supplies `risk`; we never invent a rating here.
 */
export function WeatherCalendar({ snapshot, selected, onSelect }: { snapshot: FieldSnapshot | null; selected: number; onSelect: (i: number) => void }) {
  const { t, lang } = useI18n();
  const fc = snapshot?.forecast;
  const days = (fc?.days ?? []).slice(0, 7);

  if (!snapshot || !fc || days.length === 0) {
    return (
      <section className="weather surface surface-pad" aria-labelledby="weather-t">
        <h2 id="weather-t" className="text-lg font-semibold tracking-tight">
          {t('weather.title')}
        </h2>
        <p className="mt-3 mb-0 text-chrome">{t('weather.empty')}</p>
      </section>
    );
  }

  const today = localISO();
  const stale = Date.now() - new Date(snapshot.created_at).getTime() > 36 * 3600 * 1000;
  const anyRisk = days.some((d) => d.risk && d.risk !== 'unknown');
  const sel = days[Math.min(selected, days.length - 1)]!;
  const selSky = skyOf(sel);

  return (
    <section className="weather surface" aria-labelledby="weather-t" data-testid="weather">
      <div className="surface-pad !pb-3">
        <h2 id="weather-t" className="text-lg font-semibold tracking-tight">
          {t('weather.title')}
        </h2>
        <p className="m-0 mt-1 text-xs text-dim">
          {t('weather.source', { source: fc.source })} · {t('weather.issued', { when: fmtDate(fc.issued_at, lang, 'datetime') })}
        </p>
      </div>

      <ol className="weather-grid" aria-label={t('weather.title')}>
        {days.map((d, i) => (
          <DayTile key={d.date} d={d} today={d.date === today} active={i === selected} onSelect={() => onSelect(i)} />
        ))}
      </ol>

      <div className="surface-pad !pt-4">
        <p className="weather-detail" aria-live="polite" data-testid="weather-detail">
          <span className="font-semibold text-bone">{fmtDate(sel.date, lang, 'long')}</span>
          <span className="chip">{t(SKY_KEY[selSky])}</span>
          {sel.precip_mm != null ? (
            <span className="chip chip-mono" aria-label={`${t('weather.rain')} ${fmtNum(sel.precip_mm, lang, { maximumFractionDigits: 1 })} mm`}>
              <CloudRain size={12} aria-hidden />
              {fmtNum(sel.precip_mm, lang, { maximumFractionDigits: 1 })} mm
            </span>
          ) : null}
          {sel.rh_mean_pct != null ? (
            <span className="chip chip-mono" aria-label={`${t('weather.humidity')} ${fmtNum(sel.rh_mean_pct, lang)}%`}>
              <Droplets size={12} aria-hidden />
              {fmtNum(sel.rh_mean_pct, lang)}%
            </span>
          ) : null}
          {sel.risk ? (
            <span className="chip" data-tone={sel.risk === 'high' ? 'stop' : sel.risk === 'low' ? 'go' : undefined} data-testid="weather-risk">
              {t(RISK_KEY[sel.risk])}
            </span>
          ) : null}
          {sel.tmax_c != null && sel.tmin_c != null ? (
            <span className="chip chip-mono">
              {fmtNum(sel.tmin_c, lang, { maximumFractionDigits: 0 })}° – {fmtNum(sel.tmax_c, lang, { maximumFractionDigits: 0 })}°
            </span>
          ) : null}
        </p>
        {!anyRisk ? <p className="m-0 mt-3 text-xs text-dim">{t('weather.noRisk')}</p> : null}
        {snapshot.risk_basis ? (
          <p className="m-0 mt-3 text-xs text-dim" data-testid="risk-basis">
            {t('weather.riskBasis')}: {snapshot.risk_basis}
          </p>
        ) : null}
        <p className="m-0 mt-3 text-xs text-dim">
          {snapshot.mode === 'snapshot' ? t('weather.snapshot', { when: fmtDate(snapshot.created_at, lang, 'datetime') }) : null} {t('weather.iconNote')}
        </p>
        {stale ? (
          <p className="m-0 mt-3 flex items-start gap-2 rounded-xl border border-dashed border-wait/50 p-3 text-sm text-wait" role="note">
            <TriangleAlert size={16} className="mt-0.5 flex-none" aria-hidden />
            {t('weather.stale', { when: fmtDate(snapshot.created_at, lang, 'long') })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function DayTile({ d, today, active, onSelect }: { d: ForecastDay; today: boolean; active: boolean; onSelect: () => void }) {
  const { t, lang } = useI18n();
  const sky = skyOf(d);
  const Icon = SKY_ICON[sky];
  const label = `${fmtDate(d.date, lang, 'long')}: ${t(SKY_KEY[sky])}${d.precip_mm != null ? `, ${t('weather.rain')} ${fmtNum(d.precip_mm, lang, { maximumFractionDigits: 1 })} mm` : ''}${d.rh_mean_pct != null ? `, ${t('weather.humidity')} ${fmtNum(d.rh_mean_pct, lang)}%` : ''}`;
  const rain = rainFill(d.precip_mm);
  return (
    <li>
      <button type="button" className="day" aria-pressed={active} aria-label={label} onClick={onSelect} data-today={today}>
        <span className="day-name">{today ? t('weather.today') : fmtDate(parseDate(d.date), lang, 'weekday')}</span>
        <span className="day-num tabular">{fmtDate(parseDate(d.date), lang, 'dayNum')}</span>
        <Icon size={22} strokeWidth={1.8} className="day-icon" data-sky={sky} aria-hidden />
        <span className="day-temp tabular">
          <b>{d.tmax_c != null ? `${fmtNum(d.tmax_c, lang, { maximumFractionDigits: 0 })}°` : '–'}</b>
          <i>{d.tmin_c != null ? `${fmtNum(d.tmin_c, lang, { maximumFractionDigits: 0 })}°` : '–'}</i>
        </span>
        <span className="day-rain" aria-hidden>
          <span className="rainbar">
            <span style={{ ['--f' as string]: Math.max(rain, d.precip_mm ? 0.06 : 0) }} />
          </span>
          <span className="tabular">{d.precip_mm != null ? fmtNum(d.precip_mm, lang, { maximumFractionDigits: 1 }) : '–'}</span>
        </span>
        <span className="day-rh tabular" aria-hidden>
          <Droplets size={11} aria-hidden />
          {d.rh_mean_pct != null ? fmtNum(d.rh_mean_pct, lang) : '–'}
        </span>
        {d.risk ? (
          <span className="day-risk" data-risk={d.risk}>
            <span className="sr-only">{t(RISK_KEY[d.risk])}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}
