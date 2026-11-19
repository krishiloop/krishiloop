import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { fmtNum } from '../../../lib/format';
import { cx } from '../../../lib/cx';
import type { RadarCell } from '../../farmer/climate/types';

export interface GeoFile {
  country: 'BD' | 'KE';
  level: string;
  viewBox: [number, number, number, number];
  source: string;
  licence: string;
  url: string;
  areas: { code: string; name: string; d: string; label: [number, number] }[];
}

const cache: Partial<Record<'BD' | 'KE', Promise<GeoFile>>> = {};
/** The outlines load only when the map is shown (Bangladesh 11 KB, Kenya 5 KB gzipped), once per page. */
export function loadGeo(country: 'BD' | 'KE'): Promise<GeoFile> {
  return (cache[country] ??= (country === 'BD' ? import('./geo/bd.json') : import('./geo/ke.json')).then((m) => m.default as unknown as GeoFile));
}

/** Farmers reporting -> a step of the warm scale (3-4, 5-7, 8+). */
export const step = (reporters: number) => (reporters >= 8 ? 3 : reporters >= 5 ? 2 : 1);

/**
 * The radar map: district (Bangladesh) or county (Kenya) outlines from geoBoundaries, simplified and inline SVG, loaded
 * lazily. Places with a shown cell are warm by how many farmers reported; a simulated layer is hatched and stamped
 * SIMULATION. The map is a picture (role img with a summary); the list beside it is the way to act.
 */
export function RadarMap({
  country,
  cells,
  simulated,
  selected,
  onSelect,
}: {
  country: 'BD' | 'KE';
  cells: RadarCell[];
  simulated: boolean;
  selected: string | null;
  onSelect: (area: string) => void;
}) {
  const { t, lang } = useI18n();
  const [geo, setGeo] = useState<GeoFile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setGeo(null);
    loadGeo(country)
      .then((g) => alive && setGeo(g))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [country]);

  /** the strongest cell per place */
  const hot = useMemo(() => {
    const m = new Map<string, RadarCell>();
    for (const c of cells) if (!m.get(c.area) || m.get(c.area)!.reporters < c.reporters) m.set(c.area, c);
    return m;
  }, [cells]);

  if (failed) return null;
  if (!geo) {
    return (
      <div className="kg-map kg-map-loading" aria-busy="true">
        <p className="sr-only-live" role="status">
          {t('off.radar.loadingMap')}
        </p>
        <div className="skeleton h-full w-full" />
      </div>
    );
  }
  const [, , w, h] = geo.viewBox;
  const label = t('off.radar.map', { country: t(`off.radar.c.${country}`), n: fmtNum(hot.size, lang) });
  const hatch = `kg-hatch-${country}`;

  return (
    <figure className={cx('kg-map', simulated && 'is-sim')} data-testid="kg-radar-map" data-country={country}>
      {simulated && (
        <span className="kg-map-stamp" data-testid="kg-radar-stamp">
          {t('off.radar.simBanner')}
        </span>
      )}
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="kg-map-svg" style={{ aspectRatio: `${w} / ${h}` }}>
        <defs>
          <pattern id={hatch} width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="18" className="kg-hatch-line" />
          </pattern>
        </defs>
        <g className="kg-map-base">
          {geo.areas.map((a) => (
            <path key={a.code} d={a.d} vectorEffect="non-scaling-stroke" onClick={hot.has(a.code) ? () => onSelect(a.code) : undefined} className={cx(hot.has(a.code) && 'is-hot')} />
          ))}
        </g>
        <g className="kg-map-heat">
          {geo.areas
            .filter((a) => hot.has(a.code))
            .map((a) => (
              <path key={a.code} d={a.d} vectorEffect="non-scaling-stroke" className={`kg-step-${step(hot.get(a.code)!.reporters)}`} onClick={() => onSelect(a.code)} />
            ))}
        </g>
        {simulated && (
          <g className="kg-map-hatch" aria-hidden>
            {geo.areas
              .filter((a) => hot.has(a.code))
              .map((a) => (
                <path key={a.code} d={a.d} fill={`url(#${hatch})`} />
              ))}
          </g>
        )}
        {selected && geo.areas.find((a) => a.code === selected) && (
          <path d={geo.areas.find((a) => a.code === selected)!.d} vectorEffect="non-scaling-stroke" className="kg-map-sel" />
        )}
        <g className="kg-map-pulses" aria-hidden>
          {geo.areas
            .filter((a) => hot.has(a.code) && step(hot.get(a.code)!.reporters) >= 2)
            .map((a, i) => (
              <circle key={a.code} cx={a.label[0]} cy={a.label[1]} r={w / 70} className="kg-pulse" style={{ animationDelay: `${i * 0.4}s` }} />
            ))}
        </g>
        <g className="kg-map-labels" aria-hidden>
          {geo.areas
            .filter((a) => hot.has(a.code))
            .map((a) => (
              <text key={a.code} x={a.label[0]} y={a.label[1] - w / 45} textAnchor="middle" style={{ fontSize: w / 30 }}>
                {a.name}
              </text>
            ))}
        </g>
      </svg>
      <figcaption className="kg-map-cap">
        <span className="kg-maplegend" aria-hidden={false}>
          <span className="kg-maplegend-label">{t('off.radar.legend')}</span>
          {[
            ['3-4', 1],
            ['5-7', 2],
            ['8+', 3],
          ].map(([txt, s]) => (
            <span key={s} className="kg-maplegend-item">
              <span className={`kg-swatch kg-step-${s}`} aria-hidden />
              {String(txt).replace(/\d/g, (d) => fmtNum(Number(d), lang))}
            </span>
          ))}
        </span>
        <span className="kg-credit">
          {t('off.radar.credit', { source: geo.source, licence: geo.licence })}{' '}
          <a href={geo.url} target="_blank" rel="noreferrer" className="kg-link">
            geoBoundaries
          </a>
        </span>
      </figcaption>
    </figure>
  );
}
