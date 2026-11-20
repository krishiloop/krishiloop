import { lazy, Suspense, useEffect, useState } from 'react';
import { CloudRain, ExternalLink, RefreshCw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { useMotionReduced } from '../../lib/motionPref';
import { DataMark } from '../../ui/DataMark';
import type { RadarCell } from '../farmer/climate/types';
import { fetchForecast, loadWatch, rainForecast, type Forecast, type Watch } from './data';
import { PEST_PROBLEMS, PESTS, pestsInArea, areaPlace, type Country, type GeoArea, type GeoFile, type Level, type PestChoice, type PestId, type Sightings, type YearRange } from './model';

/** NASA pictures and POWER weather: their own chunk, fetched when an area's panel opens. */
const NasaPanel = lazy(() => import('./NasaPanel').then((m) => ({ default: m.NasaPanel })));

/** Problem code (radar) -> our pest id, so a farmer report reads with the same plain name as the map. */
const PEST_OF_PROBLEM = new Map(PESTS.flatMap((p) => PEST_PROBLEMS[p].map((code) => [code, p] as const)));

export function useProblemName() {
  const { t } = useI18n();
  return (problem: string) => {
    const p = PEST_OF_PROBLEM.get(problem);
    if (p) return t(`map.pest.${p}`);
    if (problem === 'unidentified') return t('map.problem.unidentified');
    return problem.replace(/_/g, ' ');
  };
}

/**
 * Everything about one area: recorded sightings per pest (GBIF), recent farmer reports (radar, k-anonymous, its own window),
 * the simulated outbreak only when its layer is on (labelled), a live 7-day forecast from Open-Meteo for the area's
 * centre (fetched now, not before), and "what to watch": our sourced rules for that country, or a plain "none yet".
 */
export function AreaPanel({
  country,
  level,
  area,
  geo,
  sightings,
  range,
  span,
  pest,
  realCells,
  realOn,
  simCells,
  windowDays,
  k,
}: {
  country: Country;
  level: Level;
  area: GeoArea;
  geo: GeoFile;
  sightings: Sightings;
  range: YearRange;
  span: [number, number];
  pest: PestChoice;
  /** null: farmer reports need the live service (recorded mode) */
  realCells: RadarCell[] | null;
  realOn: boolean;
  simCells: RadarCell[] | null;
  /** the radar's window and k (services/engine/radar.py), shown as they are */
  windowDays: number;
  k: number;
}) {
  const { t, lang } = useI18n();
  const problemName = useProblemName();
  const rows = pestsInArea(sightings, country, level, area.code, range, span);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const inArea = (c: RadarCell) => (level === 'division' ? (area.districts ?? []).includes(c.area) : c.area === area.code);
  const real = realCells?.filter(inArea) ?? null;
  const sim = simCells?.filter(inArea) ?? null;
  const yr = (y: number) => fmtNum(y, lang, { useGrouping: false });

  return (
    <div className="mp-panel" data-testid="map-panel" data-area={area.code}>
      {/* recorded sightings */}
      <section aria-labelledby="mp-p-rec">
        <h3 id="mp-p-rec" className="mp-p-h">
          {t('map.panel.recorded')}
        </h3>
        <p className="mp-p-sub">{t('map.panel.recordedSub', { from: yr(range.from), to: yr(range.to), n: fmtNum(total, lang) })}</p>
        <ul className="mp-bars" data-testid="map-panel-pests">
          {rows.map((r) => (
            <li key={r.pest} className={cx('mp-bar', pest === r.pest && 'is-on', r.n === 0 && 'is-zero')} data-pest={r.pest}>
              <span className="mp-bar-name">{t(`map.pest.${r.pest}`)}</span>
              <span className="mp-bar-track" aria-hidden>
                <span className="mp-bar-fill" style={{ transform: `scaleX(${r.n / max})` }} />
              </span>
              <span className="mp-bar-n mono">{fmtNum(r.n, lang)}</span>
            </li>
          ))}
        </ul>
        <p className="mp-p-note">{t('map.panel.recordedNote')}</p>
      </section>

      {/* recent farmer reports (the radar's window) */}
      <section aria-labelledby="mp-p-rep">
        <h3 id="mp-p-rep" className="mp-p-h">
          {t('map.layer.reports', { days: fmtNum(windowDays, lang) })}
        </h3>
        {country !== 'BD' && country !== 'KE' ? (
          <p className="mp-p-sub">{country === 'IN' ? t('map.reports.india') : t('map.reports.noCountry', { country: t(`map.country.${country}`) })}</p>
        ) : !realOn ? (
          <p className="mp-p-sub">{t('map.reports.layerOff')}</p>
        ) : real === null ? (
          <p className="mp-p-sub mp-p-flag">
            <DataMark kind="recorded" />
            <span>{t('map.reports.needsLive')}</span>
          </p>
        ) : real.length ? (
          <ul className="mp-cells">
            {real.map((c) => (
              <li key={`${c.area}|${c.problem}`}>
                <strong>{fmtNum(c.reporters, lang)}</strong> {t('map.reports.cell', { problem: problemName(c.problem), area: c.area_name })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mp-p-sub">{t('map.reports.none', { k: fmtNum(k, lang), days: fmtNum(windowDays, lang) })}</p>
        )}
      </section>

      {sim && (
        <section aria-labelledby="mp-p-sim" className="mp-p-sim" data-testid="map-panel-sim">
          <h3 id="mp-p-sim" className="mp-p-h">
            {t('map.layer.sim')}
          </h3>
          {sim.length ? (
            <ul className="mp-cells">
              {sim.map((c) => (
                <li key={`${c.area}|${c.problem}`}>
                  <strong>{fmtNum(c.reporters, lang)}</strong> {t('map.reports.cell', { problem: problemName(c.problem), area: c.area_name })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mp-p-sub">{t('map.sim.noneHere')}</p>
          )}
        </section>
      )}

      <Weather area={area} geo={geo} />
      <Suspense fallback={<div className="skeleton h-24 w-full" aria-hidden />}>
        <NasaPanel key={area.code} area={area} geo={geo} rainName={country === 'BD' && level === 'district' ? area.name : null} />
      </Suspense>
      <WatchList country={country} pest={pest} order={rows} />
    </div>
  );
}

/* ------------------------------------------------------------------ weather */
function Weather({ area, geo }: { area: GeoArea; geo: GeoFile }) {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const [{ lat, lon }] = useState(() => areaPlace(geo, area));
  const [wx, setWx] = useState<Forecast | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(false);
    fetchForecast(lat, lon)
      .then((f) => alive && setWx(f))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [lat, lon, tick]);

  const rainy = rainForecast(wx);
  const maxRain = Math.max(10, ...(wx?.days.map((d) => d.rain ?? 0) ?? []));
  const one = (n: number | null, digits = 0) => (n == null ? '–' : fmtNum(n, lang, { maximumFractionDigits: digits }));

  return (
    <section aria-labelledby="mp-p-wx" className={cx('mp-wx', rainy && 'is-rainy')} data-testid="map-weather" data-rain={rainy ? 'yes' : 'no'}>
      {rainy && !reduced && (
        <div className="mp-rain" aria-hidden data-testid="map-rain">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 7.3 + 3) % 100}%`, animationDelay: `${(i * 0.37) % 1.3}s`, animationDuration: `${0.9 + (i % 4) * 0.15}s` }} />
          ))}
        </div>
      )}
      <div className="mp-wx-head">
        <h3 id="mp-p-wx" className="mp-p-h">
          {t('map.wx.title')}
        </h3>
        {wx && <DataMark kind="live" />}
      </div>
      {err ? (
        <div role="alert" className="mp-p-sub">
          <p>{t('map.wx.error')}</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setTick((n) => n + 1)}>
            <RefreshCw size={15} aria-hidden />
            {t('ui.retry')}
          </button>
        </div>
      ) : !wx ? (
        <div aria-busy="true">
          <p className="sr-only-live" role="status">
            {t('map.wx.loading')}
          </p>
          <div className="skeleton h-28 w-full" />
        </div>
      ) : (
        <>
          {rainy && (
            <p className="mp-wx-rainnote">
              <CloudRain size={16} aria-hidden /> {t('map.wx.rainAhead', { mm: one(wx.days.reduce((s, d) => s + (d.rain ?? 0), 0), 1) })}
            </p>
          )}
          <ol className="mp-wx-days" data-testid="map-wx-days">
            {wx.days.map((d) => {
              const mm = d.rain ?? 0;
              return (
                <li
                  key={d.date}
                  aria-label={t('map.wx.day', {
                    day: fmtDate(d.date, lang, 'weekday'),
                    mm: one(d.rain, 1),
                    hi: one(d.tmax),
                    lo: one(d.tmin),
                    rh: one(d.rh),
                  })}
                >
                  <span className="mp-wx-dow" aria-hidden>
                    {fmtDate(d.date, lang, 'weekday')}
                  </span>
                  <span className="mp-wx-bar" aria-hidden>
                    <span style={{ transform: `scaleY(${mm > 0 ? Math.max(0.06, Math.min(1, mm / maxRain)) : 0})` }} />
                  </span>
                  <span className="mp-wx-mm mono" aria-hidden>
                    {one(d.rain, mm < 10 ? 1 : 0)}
                  </span>
                  <span className="mp-wx-t mono" aria-hidden>
                    {one(d.tmax)}°
                  </span>
                  <span className="mp-wx-lo mono" aria-hidden>
                    {one(d.tmin)}°
                  </span>
                  <span className="mp-wx-rh mono" aria-hidden>
                    {one(d.rh)}%
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mp-wx-key" aria-hidden>
            {t('map.wx.key')}
          </p>
        </>
      )}
      <p className="mp-credit">
        {t('map.wx.credit', { lat: fmtNum(lat, lang, { maximumFractionDigits: 2 }), lon: fmtNum(lon, lang, { maximumFractionDigits: 2 }) })}{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="mp-link">
          Open-Meteo.com
        </a>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ what to watch */
function WatchList({ country, pest, order }: { country: Country; pest: PestChoice; order: { pest: PestId; n: number }[] }) {
  const { t, lang } = useI18n();
  const [watch, setWatch] = useState<Watch | null>(null);
  useEffect(() => {
    let alive = true;
    void loadWatch().then((w) => alive && setWatch(w));
    return () => {
      alive = false;
    };
  }, []);
  const pack = watch?.[country];
  // the pests recorded most in this area come first
  const pests = (pest === 'all' ? [...order].sort((a, b) => b.n - a.n).map((r) => r.pest) : [pest]) as PestId[];
  const withRules = pack ? pests.filter((p) => pack.pests[p]?.length) : [];
  const without = pests.filter((p) => !withRules.includes(p));
  const countryName = t(`map.country.${country}`);

  return (
    <section aria-labelledby="mp-p-watch" className="mp-watch" data-testid="map-watch">
      <h3 id="mp-p-watch" className="mp-p-h">
        {t('map.watch.title')}
      </h3>
      {!watch ? (
        <div className="skeleton h-12 w-full" />
      ) : !pack ? (
        <p className="mp-p-sub" data-testid="map-watch-none">
          {t('map.watch.noCountry', { country: countryName })}
        </p>
      ) : (
        <>
          <p className="mp-p-sub">{t(`map.watch.pack.${country as 'BD'}`)}</p>
          {withRules.map((p) => (
            <div key={p} className="mp-watch-pest">
              <p className="mp-watch-name">{t(`map.pest.${p}`)}</p>
              <ul>
                {pack.pests[p]!.map((r) => (
                  <li key={r.id} className="mp-rule">
                    <span className="mp-rule-id mono">{r.id}</span>
                    <span lang={lang === 'bn' ? 'bn' : 'en'}>{lang === 'bn' ? r.title.bn : r.title.en}</span>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" className="mp-link mp-rule-src">
                        {t('map.watch.source', { publisher: r.publisher ?? r.doc, page: fmtNum(r.page, lang) })}
                        <ExternalLink size={12} aria-hidden className="ml-1 inline align-[-1px]" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {without.length > 0 && (
            <p className="mp-p-sub" data-testid="map-watch-none">
              {t('map.watch.noRule', { pests: without.map((p) => t(`map.pest.${p}`)).join(', '), country: countryName })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
