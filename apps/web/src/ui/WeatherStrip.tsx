import { Cloud, CloudDrizzle, CloudRain, CloudRainWind, Sun, type LucideIcon } from 'lucide-react';
import type { ForecastDay } from '../lib/api/types';
import { useI18n } from '../lib/i18n';
import { fmtDate, fmtNum } from '../lib/format';
import { cx } from '../lib/cx';

type Sky = 'dry' | 'cloudy' | 'drizzle' | 'rain' | 'heavy';
const SKY_ICON: Record<Sky, LucideIcon> = { dry: Sun, cloudy: Cloud, drizzle: CloudDrizzle, rain: CloudRain, heavy: CloudRainWind };

/** Forecast numbers -> an icon. This does not rate risk: the planner's own `risk` is shown only when it is supplied. */
function skyOf(d: ForecastDay): Sky {
  const mm = d.precip_mm ?? 0;
  if (mm >= 10) return 'heavy';
  if (mm >= 2) return 'rain';
  if (mm >= 0.5) return 'drizzle';
  if ((d.rh_mean_pct ?? 0) >= 85) return 'cloudy';
  return 'dry';
}

const RISK_TONE = { high: 'text-stop', medium: 'text-wait', low: 'text-go', unknown: 'text-ink-3' } as const;

/**
 * Seven days in one row: weekday, sky, high temperature, rain as a bar (12 mm fills it) and the planner's risk word.
 * The whole strip is one list for screen readers; each day reads as a sentence.
 */
export function WeatherStrip({ days, today, className }: { days: ForecastDay[]; today?: string; className?: string }) {
  const { t, lang } = useI18n();
  return (
    <ol className={cx('grid grid-cols-7 gap-1 sm:gap-1.5', className)} aria-label={t('ui.wx.title')}>
      {days.slice(0, 7).map((d) => {
        const sky = skyOf(d);
        const Icon = SKY_ICON[sky];
        const isToday = today === d.date;
        const mm = d.precip_mm ?? 0;
        const fill = Math.min(1, mm / 12);
        return (
          <li
            key={d.date}
            className={cx('flex flex-col items-center rounded-[10px] px-0.5 pb-2 pt-2 text-center', isToday ? 'bg-card ring-1 ring-rule-2' : '')}
            aria-label={`${fmtDate(d.date, lang, 'weekday')} ${fmtDate(d.date, lang)}: ${d.tmax_c != null ? `${Math.round(d.tmax_c)}°` : ''}, ${t('ui.wx.rain', { mm: fmtNum(mm, lang, { maximumFractionDigits: 1 }) })}${d.risk ? `, ${t(`ui.wx.risk.${d.risk}`)}` : ''}`}
          >
            <span className={cx('text-[0.72rem] font-semibold uppercase tracking-wide', isToday ? 'text-ink' : 'text-ink-3')} aria-hidden>
              {isToday ? t('ui.wx.today') : fmtDate(d.date, lang, 'weekday')}
            </span>
            <Icon size={22} strokeWidth={1.6} className="mt-1.5 text-ink-2" aria-hidden />
            <span className="mono mt-1 text-sm text-ink" aria-hidden>
              {d.tmax_c != null ? `${fmtNum(Math.round(d.tmax_c), lang)}°` : '–'}
            </span>
            <span className="mt-1.5 h-9 w-2 overflow-hidden rounded-full bg-sunk" aria-hidden>
              <span className="block h-full w-full origin-bottom rounded-full bg-[#4f7fb8]" style={{ transform: `scaleY(${Math.max(fill, mm > 0 ? 0.08 : 0)})` }} />
            </span>
            <span className="mono mt-1 text-[0.68rem] text-ink-3" aria-hidden>
              {mm > 0 ? fmtNum(mm, lang, { maximumFractionDigits: mm < 10 ? 1 : 0 }) : '0'}
            </span>
            {d.risk && (
              <span className={cx('mt-1 text-[0.68rem] font-semibold', RISK_TONE[d.risk])} aria-hidden>
                {t(`ui.wx.risk.${d.risk}`)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
