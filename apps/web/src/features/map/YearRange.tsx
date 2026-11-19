import { useId } from 'react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import type { YearRange as Range } from './model';

/**
 * Two native range inputs on one track (each keeps its own label, keyboard and screen-reader support), plus quick picks.
 * The ends never cross: moving "from" past "to" pushes "to" along, and back.
 */
export function YearRange({ span, value, onChange }: { span: [number, number]; value: Range; onChange: (r: Range) => void }) {
  const { t, lang } = useI18n();
  const id = useId();
  const [lo, hi] = span;
  const pct = (y: number) => ((y - lo) / Math.max(1, hi - lo)) * 100;
  const yr = (y: number) => fmtNum(y, lang, { useGrouping: false });
  const picks: { key: string; r: Range }[] = [
    { key: 'map.years.all', r: { from: lo, to: hi } },
    { key: 'map.years.since2000', r: { from: Math.max(lo, 2000), to: hi } },
    { key: 'map.years.last10', r: { from: Math.max(lo, hi - 9), to: hi } },
  ];
  return (
    <fieldset className="mp-years" data-testid="map-years">
      <legend className="mp-ctl-label">
        {t('map.years.label')}{' '}
        <output htmlFor={`${id}-from ${id}-to`} className="mp-years-out" data-testid="map-years-out">
          {t('map.years.range', { from: yr(value.from), to: yr(value.to) })}
        </output>
      </legend>
      <div className="mp-dual" style={{ ['--a' as string]: `${pct(value.from)}%`, ['--b' as string]: `${pct(value.to)}%` }}>
        <span className="mp-dual-track" aria-hidden />
        <input
          id={`${id}-from`}
          type="range"
          min={lo}
          max={hi}
          step={1}
          value={value.from}
          aria-label={t('map.years.from')}
          aria-valuetext={yr(value.from)}
          onChange={(e) => {
            const from = Number(e.target.value);
            onChange({ from, to: Math.max(from, value.to) });
          }}
          data-testid="map-year-from"
        />
        <input
          id={`${id}-to`}
          type="range"
          min={lo}
          max={hi}
          step={1}
          value={value.to}
          aria-label={t('map.years.to')}
          aria-valuetext={yr(value.to)}
          onChange={(e) => {
            const to = Number(e.target.value);
            onChange({ from: Math.min(value.from, to), to });
          }}
          data-testid="map-year-to"
        />
      </div>
      <div className="mp-years-ends" aria-hidden>
        <span>{yr(lo)}</span>
        <span>{yr(hi)}</span>
      </div>
      <div className="mp-picks">
        {picks.map((p) => (
          <button
            key={p.key}
            type="button"
            className="mp-pick"
            aria-pressed={value.from === p.r.from && value.to === p.r.to}
            onClick={() => onChange(p.r)}
          >
            {t(p.key as 'map.years.all')}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
