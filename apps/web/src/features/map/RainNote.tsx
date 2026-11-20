import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { RAIN_BREAKS, type RainFile } from './rain';

/** The rainfall layer's label and its steps: source, the 7 dates and when the file was made, said next to the map. Own chunk. */
export function RainNote({ rain, state }: { rain: RainFile | null; state: 'loading' | 'ready' | 'level' }) {
  const { t, lang } = useI18n();
  if (state === 'level') return <p className="mp-note" data-testid="map-label-rain">{t('map.label.rain.level')}</p>;
  if (!rain) return <p className="mp-note" data-testid="map-label-rain">{state === 'loading' ? '…' : t('map.label.rain.none')}</p>;
  const n = (x: number) => fmtNum(x, lang);
  const steps = RAIN_BREAKS.map((b, i) => ({ step: i + 1, from: b, to: i + 1 < RAIN_BREAKS.length ? RAIN_BREAKS[i + 1]! - 1 : null }));
  return (
    <div className="mp-note" data-testid="map-label-rain" style={{ display: 'grid', gap: '0.3rem' }}>
      <span>
        <span className="chip chip-go">NASA</span>{' '}
        {t('map.label.rain', { from: fmtDate(rain.days[0]!, lang, 'long'), to: fmtDate(rain.days[rain.days.length - 1]!, lang, 'long'), version: rain.version, made: fmtDate(rain.made.slice(0, 10), lang, 'long') })}
      </span>
      <ol className="mp-rainlegend" aria-label={t('map.rain.legend')}>
        <li>
          <span className="mp-swatch r-0" aria-hidden />
          {t('map.rain.step0')}
        </li>
        {steps.map((s) => (
          <li key={s.step}>
            <span className={`mp-swatch r-${s.step}`} aria-hidden />
            {s.to == null ? t('map.rain.plus', { n: n(s.from) }) : t('map.rain.range', { from: n(s.from), to: n(s.to) })}
          </li>
        ))}
      </ol>
    </div>
  );
}
