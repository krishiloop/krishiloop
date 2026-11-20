import { useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { COUNTRIES, LEVEL_OF, countryTotals, type Country, type Sightings } from './model';

const SEEN = 'krishiloop.map.picked';
const seen = () => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return false;
  }
};

/**
 * The country choice, big and first: one card per country with its name and its number of GBIF sightings, the chosen one
 * filled. A radio group (arrow keys move the choice, one tab stop); on a phone the cards scroll sideways and snap. The line
 * "Pick a country to see its map" shows until the first pick (remembered on this phone).
 */
export function CountrySwitch({ value, onChange, sightings }: { value: Country; onChange: (c: Country) => void; sightings: Sightings }) {
  const { t, lang } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [picked, setPicked] = useState(seen);
  const choose = (c: Country) => {
    onChange(c);
    setPicked(true);
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      /* the hint just shows again next visit */
    }
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -99 : e.key === 'End' ? 99 : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.abs(d) === 99 ? (d < 0 ? 0 : COUNTRIES.length - 1) : (i + d + COUNTRIES.length) % COUNTRIES.length;
    choose(COUNTRIES[n]!);
    refs.current[n]?.focus();
  };
  return (
    <div className="mp-switch" data-testid="map-switch" data-picked={picked ? 'yes' : 'no'}>
      {!picked && (
        <p className="mp-switch-hint" data-testid="map-switch-hint">
          {t('map.switch.hint')}
        </p>
      )}
      <div role="radiogroup" aria-label={t('map.ctl.country')} className="mp-switch-row">
        {COUNTRIES.map((c, i) => {
          const on = c === value;
          const n = countryTotals(sightings, c, LEVEL_OF[c], 'all').total;
          return (
            <button
              key={c}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={cx('mp-sw-card', on && 'is-on')}
              data-country={c}
              onClick={() => choose(c)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="mp-sw-name">
                {t(`map.country.${c}`)}
                {on && <Check size={16} aria-hidden strokeWidth={3} />}
              </span>
              <span className="mp-sw-n mono">{t('map.switch.count', { n: fmtNum(n, lang) })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
