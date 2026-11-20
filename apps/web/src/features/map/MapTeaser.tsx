import '../../lib/i18n/strings.map';
import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useInViewOnce } from '../../lib/hooks';
import { LinkButton } from '../../ui/Button';
import { loadGeo, loadSightings } from './data';
import { COUNTRIES, LEVEL_OF, countryTotals, sightingsByArea, stepOf, yearSpan, type GeoFile, type Sightings } from './model';
import './teaser.css';

/**
 * A small "Disease map" card for the home page (the lead places it). Light: text and a link first; the mini map of
 * Bangladesh's divisions (3 KB) and the GBIF counts (3 KB) load only when the card comes near the screen. The number
 * it shows is computed from the same file as the map, never typed in.
 */
export function MapTeaser({ className }: { className?: string }) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const near = useInViewOnce(ref, '300px 0px 300px 0px');
  const [data, setData] = useState<{ geo: GeoFile; s: Sightings } | null>(null);

  useEffect(() => {
    if (!near || data) return;
    let alive = true;
    Promise.all([loadGeo('BD', 'division'), loadSightings()])
      .then(([geo, s]) => alive && setData({ geo, s }))
      .catch(() => undefined); // the card stands without its picture
    return () => {
      alive = false;
    };
  }, [near, data]);

  const placed = data ? COUNTRIES.reduce((n, c) => n + countryTotals(data.s, c, c === 'BD' ? 'division' : LEVEL_OF[c], 'all').placed, 0) : null;
  const values = data ? sightingsByArea(data.s, 'BD', 'division', 'all', { from: yearSpan(data.s)[0], to: yearSpan(data.s)[1] }, yearSpan(data.s)) : null;

  return (
    <article ref={ref} className={`mp-teaser ${className ?? ''}`} data-testid="map-teaser">
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2">
          <MapIcon size={15} aria-hidden />
          {t('map.teaser.eyebrow')}
        </p>
        <h3 className="t-head mt-2">{t('map.teaser.title')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{t('map.teaser.body')}</p>
        {placed != null && <p className="mono mt-2 text-xs text-ink-3">{t('map.teaser.stat', { n: fmtNum(placed, lang) })}</p>}
        <div className="mp-teaser-swatches mt-3" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((s) => (
            <span key={s} style={{ background: `var(--map-${s})` }} />
          ))}
        </div>
        <LinkButton to="/map" variant="secondary" className="mt-4" arrow>
          {t('map.teaser.cta')}
        </LinkButton>
      </div>
      {data && values && (
        <svg viewBox={data.geo.viewBox.join(' ')} className="mp-teaser-map" aria-hidden>
          {data.geo.areas.map((a) => (
            <path key={a.code} d={a.d} className={`s-${stepOf(values.get(a.code) ?? 0)}`} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
    </article>
  );
}
