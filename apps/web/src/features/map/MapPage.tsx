// this page's words (English loads per screen)
import '../../lib/i18n/strings.map';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { MapPin } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { DataMark } from '../../ui/DataMark';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { fetchRadar } from '../farmer/climate/api';
import type { RadarData } from '../farmer/climate/types';
import { loadGeo, loadSightings } from './data';
import {
  COUNTRIES,
  PESTS,
  countryTotals,
  isFullRange,
  legendSteps,
  licencesFor,
  reportsByArea,
  sightingsByArea,
  yearSpan,
  type Country,
  type GeoFile,
  type Level,
  type PestChoice,
  type Sightings,
  type YearRange as Range,
} from './model';
import { MapView } from './MapView';
import { AreaPanel } from './AreaPanel';
import { YearRange } from './YearRange';
import './map.css';

type View = Country | 'all';
interface Layers {
  sightings: boolean;
  reports: boolean;
  sim: boolean;
}
interface Open {
  country: Country;
  level: Level;
  code: string;
}

const LEVEL_OF: Record<Country, Level> = { BD: 'district', IN: 'state', KE: 'county' };
const LICENCE_NAME: Record<string, string> = { CC0_1_0: 'CC0 1.0', CC_BY_4_0: 'CC BY 4.0', CC_BY_NC_4_0: 'CC BY-NC 4.0' };

const wideQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
function useWide() {
  return useSyncExternalStore(
    (f) => {
      wideQuery?.addEventListener('change', f);
      return () => wideQuery?.removeEventListener('change', f);
    },
    () => !!wideQuery?.matches,
    () => true,
  );
}

/**
 * /map, the Disease map (builder M): Bangladesh, India and Kenya, every district, state or county coloured by
 * RECORDED SIGHTINGS in GBIF (built offline, labelled as such), with recent FARMER REPORTS (the radar's 14-day window) from the outbreak
 * radar (live only with the API) and the SIMULATED OUTBREAK as a separate, labelled practice layer. Click an area for
 * its counts per pest, a live 7-day forecast from Open-Meteo, and the sourced rules we hold for it (or a plain "none").
 */
export default function MapPage() {
  const { t, lang } = useI18n();
  const wide = useWide();
  const [sightings, setSightings] = useState<Sightings | null>(null);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [view, setView] = useState<View>('BD');
  const [bdLevel, setBdLevel] = useState<Level | null>(null);
  const [pest, setPest] = useState<PestChoice>('all');
  const [range, setRange] = useState<Range | null>(null);
  const [layers, setLayers] = useState<Layers>({ sightings: true, reports: true, sim: false });
  const [open, setOpen] = useState<Open | null>(null);
  const [geos, setGeos] = useState<Record<string, GeoFile>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSightings()
      .then((s) => {
        if (!alive) return;
        setSightings(s);
        const sp = yearSpan(s);
        setRange((r) => r ?? { from: sp[0], to: sp[1] });
        setBdLevel((l) => l ?? s.countries.BD.default_level ?? 'district');
      })
      .catch(() => alive && setFailed(true));
    fetchRadar()
      .then((d) => alive && setRadar(d))
      .catch(() => undefined); // the map stands without the radar; the reports layer then says it is unavailable
    return () => {
      alive = false;
    };
  }, []);

  const levelOf = useCallback((c: Country): Level => (c === 'BD' ? (bdLevel ?? 'district') : LEVEL_OF[c]), [bdLevel]);
  const shown: Country[] = view === 'all' ? COUNTRIES : [view];

  // outlines: only the countries on screen, each once (Bangladesh divisions also feed the district -> division sums)
  useEffect(() => {
    if (!bdLevel) return;
    const want = shown.map((c) => [c, levelOf(c)] as const);
    if (shown.includes('BD') && levelOf('BD') === 'division') want.push(['BD', 'division']);
    let alive = true;
    for (const [c, l] of want) {
      const key = `${c}|${l}`;
      if (geos[key]) continue;
      loadGeo(c, l)
        .then((g) => alive && setGeos((m) => ({ ...m, [key]: g })))
        .catch(() => alive && setFailed(true));
    }
    return () => {
      alive = false;
    };
  }, [view, bdLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  const span = useMemo<[number, number]>(() => (sightings ? yearSpan(sightings) : [2000, 2026]), [sightings]);

  if (failed) {
    return (
      <section className="wrap py-16" role="alert">
        <p className="t-lead">{t('map.loadError')}</p>
      </section>
    );
  }

  const ready = sightings && range && bdLevel;
  const realOn = layers.reports;
  const days = radar?.real?.window_days ?? radar?.simulated.window_days ?? 14;
  const realCells = radar?.real ? radar.real.cells : null;
  const simCells = layers.sim && radar ? radar.simulated.cells : null;
  const openGeo = open ? geos[`${open.country}|${open.level}`] : undefined;
  const openArea = open && openGeo ? openGeo.areas.find((a) => a.code === open.code) : undefined;
  const panelTitle = openArea && open ? t('map.panel.title', { area: openArea.name, level: t(`map.level.${open.level}`), country: t(`map.country.${open.country}`) }) : '';

  const panel =
    ready && open && openGeo && openArea ? (
      <AreaPanel
        key={`${open.country}|${open.code}`}
        country={open.country}
        level={open.level}
        area={openArea}
        geo={openGeo}
        sightings={sightings}
        range={range}
        span={span}
        pest={pest}
        realCells={realCells}
        realOn={realOn}
        simCells={simCells}
        windowDays={days}
        k={radar?.real?.k ?? radar?.simulated.k ?? 3}
      />
    ) : null;

  const yr = (y: number) => fmtNum(y, lang, { useGrouping: false });
  /** years and layers: always open on a wide screen, folded into "Years and layers" on phones so the map comes sooner */
  const moreControls = () => (
    <>
      <YearRange span={span} value={range!} onChange={setRange} />
      <fieldset className="mp-layers" data-testid="map-layers">
        <legend className="mp-ctl-label">{t('map.ctl.layers')}</legend>
        {(
          [
            ['sightings', 'map.layer.sightings', 'sw-sight'],
            ['reports', 'map.layer.reports', 'sw-rep'],
            ['sim', 'map.layer.sim', 'sw-sim'],
          ] as const
        ).map(([k, key, sw]) => (
          <label key={k} className="mp-toggle">
            <input type="checkbox" role="switch" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} data-testid={`map-layer-${k}`} />
            <span className={cx('mp-sw', sw)} aria-hidden />
            <span>{t(key, { days: fmtNum(days, lang) })}</span>
          </label>
        ))}
      </fieldset>
    </>
  );

  return (
    <div className="mp-page wrap" data-testid="map-page">
      <header className="mp-head">
        <p className="eyebrow">{t('map.eyebrow')}</p>
        <h1 className="t-title mt-3">{t('map.title')}</h1>
        <p className="t-lead mt-4 max-w-[62ch]">{t('map.lead')}</p>
      </header>

      {!ready ? (
        <div aria-busy="true" className="mt-8">
          <p className="sr-only-live" role="status">
            {t('map.loading')}
          </p>
          <div className="skeleton h-12 w-full" />
          <div className="skeleton mt-4 h-[60vh] w-full" />
        </div>
      ) : (
        <>
          <div className="mp-controls" data-testid="map-controls">
            <div className="mp-ctl">
              <span className="mp-ctl-label" id="mp-c-country">
                {t('map.ctl.country')}
              </span>
              <Segmented
                label={t('map.ctl.country')}
                value={view}
                onChange={(v) => {
                  setView(v);
                  setOpen(null);
                }}
                options={[...COUNTRIES.map((c) => ({ value: c as View, label: t(`map.country.${c}`) })), { value: 'all' as View, label: t('map.country.all') }]}
                className="mp-seg"
              />
            </div>
            {shown.includes('BD') && (
              <div className="mp-ctl">
                <span className="mp-ctl-label">{t('map.ctl.bdLevel')}</span>
                <Segmented
                  label={t('map.ctl.bdLevel')}
                  value={bdLevel}
                  onChange={(v) => {
                    setBdLevel(v);
                    if (open?.country === 'BD') setOpen(null);
                  }}
                  options={[
                    { value: 'district' as Level, label: t('map.levels.district') },
                    { value: 'division' as Level, label: t('map.levels.division') },
                  ]}
                  className="mp-seg"
                />
              </div>
            )}
            <PestPicker value={pest} onChange={setPest} sightings={sightings} shown={shown} levelOf={levelOf} />
            {wide ? (
              moreControls()
            ) : (
              <details className="mp-more" data-testid="map-more">
                <summary>{t('map.ctl.more', { from: yr(range.from), to: yr(range.to), n: fmtNum(Object.values(layers).filter(Boolean).length, lang) })}</summary>
                <div className="mp-more-body">{moreControls()}</div>
              </details>
            )}
          </div>

          <div className="mp-labels">
            {layers.sightings && (
              <p className="mp-note" data-testid="map-label-sightings">
                <span className="chip chip-carbon">{t('map.mark.recorded')}</span>
                <span>
                  {t('map.label.sightings', { from: yr(range.from), to: yr(range.to) })}
                  {isFullRange(range, span) && ` ${t('map.label.undated')}`}
                </span>
              </p>
            )}
            {layers.reports && (
              <p className="mp-note" data-testid="map-label-reports">
                {radar?.real ? <DataMark kind="live" /> : <DataMark kind="recorded" />}
                <span>{radar?.real ? t('map.reports.live', { k: fmtNum(radar.real.k, lang), days: fmtNum(radar.real.window_days, lang) }) : t('map.reports.needsLive')}</span>
              </p>
            )}
            {layers.sim && (
              <p className="mp-note is-sim" data-testid="map-label-sim">
                <span className="chip chip-carbon">{t('map.mark.sim')}</span>
                <span>{t('map.label.sim')}</span>
              </p>
            )}
          </div>

          <div className={cx('mp-body', view === 'all' && 'is-all', wide && open && 'has-panel')}>
            <div className={cx('mp-maps', view === 'all' && 'is-three')}>
              {shown.map((c) => (
                <CountryMap
                  key={c}
                  country={c}
                  level={levelOf(c)}
                  geo={geos[`${c}|${levelOf(c)}`]}
                  divisions={c === 'BD' && levelOf(c) === 'division' ? geos['BD|division'] : undefined}
                  sightings={sightings}
                  range={range}
                  span={span}
                  pest={pest}
                  layers={layers}
                  radar={radar}
                  selected={open?.country === c ? open.code : null}
                  onOpen={(code) => setOpen({ country: c, level: levelOf(c), code })}
                  compact={view === 'all'}
                />
              ))}
            </div>
            {wide && (
              <aside className="mp-side" aria-label={panelTitle || t('map.panel.empty')} data-testid="map-side">
                {panel ? (
                  <>
                    <div className="mp-side-head">
                      <h2 className="t-head">{panelTitle}</h2>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
                        {t('ui.close')}
                      </button>
                    </div>
                    {panel}
                  </>
                ) : (
                  <p className="mp-side-empty">
                    <MapPin size={18} aria-hidden />
                    {t('map.panel.empty')}
                  </p>
                )}
              </aside>
            )}
          </div>
          {!wide && (
            <Sheet open={!!panel} onClose={() => setOpen(null)} title={panelTitle} className="mp-sheet">
              {panel}
            </Sheet>
          )}

          <Legend days={days} />
          <Credits sightings={sightings} shown={shown} geos={shown.map((c) => geos[`${c}|${levelOf(c)}`]).filter(Boolean) as GeoFile[]} pest={pest} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ one country */
function CountryMap({
  country,
  level,
  geo,
  divisions,
  sightings,
  range,
  span,
  pest,
  layers,
  radar,
  selected,
  onOpen,
  compact,
}: {
  country: Country;
  level: Level;
  geo: GeoFile | undefined;
  divisions?: GeoFile;
  sightings: Sightings;
  range: Range;
  span: [number, number];
  pest: PestChoice;
  layers: Layers;
  radar: RadarData | null;
  selected: string | null;
  onOpen: (code: string) => void;
  compact: boolean;
}) {
  const { t, lang } = useI18n();
  const values = useMemo(() => sightingsByArea(sightings, country, level, pest, range, span), [sightings, country, level, pest, range, span]);
  const divAreas = level === 'division' ? divisions?.areas : undefined;
  const reports = useMemo(
    () => (layers.reports && radar?.real ? reportsByArea(radar.real.cells, country, pest, divAreas) : null),
    [layers.reports, radar, country, pest, divAreas],
  );
  const sim = useMemo(() => (layers.sim && radar ? reportsByArea(radar.simulated.cells, country, pest, divAreas) : null), [layers.sim, radar, country, pest, divAreas]);
  const totals = countryTotals(sightings, country, level, pest);
  const countryName = t(`map.country.${country}`);

  const describe = useCallback(
    (code: string, name: string) => {
      const parts = [name, t('map.a11y.sightings', { n: fmtNum(values.get(code) ?? 0, lang) })];
      if (reports?.get(code)) parts.push(t('map.a11y.reports', { n: fmtNum(reports.get(code)!, lang), days: fmtNum(radar?.real?.window_days ?? 14, lang) }));
      if (sim?.get(code)) parts.push(t('map.a11y.sim', { n: fmtNum(sim.get(code)!, lang) }));
      return parts.join(', ');
    },
    [values, reports, sim, t, lang, radar],
  );
  const tipText = useCallback(
    (code: string, name: string) => {
      const base = t('map.tip', { area: name, n: fmtNum(values.get(code) ?? 0, lang) });
      const r = reports?.get(code);
      return r ? `${base} · ${t('map.tipReports', { n: fmtNum(r, lang) })}` : base;
    },
    [values, reports, t, lang],
  );

  const top = useMemo(() => [...values].sort((a, b) => b[1] - a[1]).slice(0, compact ? 3 : 6), [values, compact]);

  return (
    <figure className={cx('mp-country', layers.sim && sim?.size && 'is-sim')} data-testid={`map-country-${country}`} data-level={level}>
      <figcaption className="mp-country-cap">
        <span className="mp-country-name">{countryName}</span>
        <span className="mp-country-meta" data-testid={`map-totals-${country}`}>
          {t('map.totals', { placed: fmtNum(totals.placed, lang), total: fmtNum(totals.total, lang), level: t(`map.levels.${level}`) })}
        </span>
      </figcaption>
      {layers.sim && !!sim?.size && (
        <span className="mp-stamp" data-testid="map-sim-stamp">
          {t('map.mark.sim')}
        </span>
      )}
      {geo ? (
        <MapView
          geo={geo}
          values={layers.sightings ? values : null}
          reports={reports}
          sim={sim}
          selected={selected}
          onOpen={onOpen}
          describe={describe}
          tipText={tipText}
          label={t('map.svgLabel', { country: countryName, level: t(`map.levels.${level}`) })}
          compact={compact}
        />
      ) : (
        <div className="skeleton mp-map-skel" aria-hidden />
      )}
      {layers.sightings && (
        <div className="mp-top">
          {top.length ? (
            <>
              <p className="mp-ctl-label">{t('map.top', { level: t(`map.levels.${level}`) })}</p>
              <ol>
                {top.map(([code, n]) => (
                  <li key={code}>
                    <button type="button" className="mp-top-btn" onClick={() => onOpen(code)} aria-pressed={selected === code}>
                      <span>{geo?.areas.find((a) => a.code === code)?.name ?? code}</span>
                      <span className="mono">{fmtNum(n, lang)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="mp-p-sub" data-testid={`map-empty-${country}`}>
              {t('map.noneInRange', { country: countryName })}
            </p>
          )}
        </div>
      )}
      {geo?.caveat && <p className="mp-caveat">{t('map.caveat.IN')}</p>}
    </figure>
  );
}

/* ------------------------------------------------------------------ pest picker */
function PestPicker({
  value,
  onChange,
  sightings,
  shown,
  levelOf,
}: {
  value: PestChoice;
  onChange: (p: PestChoice) => void;
  sightings: Sightings;
  shown: Country[];
  levelOf: (c: Country) => Level;
}) {
  const { t, lang } = useI18n();
  const options: PestChoice[] = ['all', ...PESTS];
  const count = (p: PestChoice) => shown.reduce((s, c) => s + countryTotals(sightings, c, levelOf(c), p).placed, 0);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n]!);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="mp-ctl mp-ctl-wide">
      <span className="mp-ctl-label" id="mp-c-pest">
        {t('map.ctl.pest')}
      </span>
      <div role="radiogroup" aria-labelledby="mp-c-pest" className="mp-pests" data-testid="map-pests">
        {options.map((p, i) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            tabIndex={value === p ? 0 : -1}
            className="mp-pest"
            onClick={() => onChange(p)}
            onKeyDown={(e) => onKey(e, i)}
            data-pest={p}
          >
            <span>{p === 'all' ? t('map.pest.all') : t(`map.pest.${p}`)}</span>
            <span className="mp-pest-n mono">{fmtNum(count(p), lang)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ legend and credits */
function Legend({ days }: { days: number }) {
  const { t, lang } = useI18n();
  return (
    <div className="mp-legend" data-testid="map-legend">
      <p className="mp-ctl-label">{t('map.legend.title')}</p>
      <ol className="mp-legend-steps">
        <li>
          <span className="mp-swatch s-0" aria-hidden />
          {t('map.legend.none')}
        </li>
        {legendSteps().map((s) => (
          <li key={s.step}>
            <span className={`mp-swatch s-${s.step}`} aria-hidden>
              {s.step}
            </span>
            {s.to == null ? t('map.legend.plus', { n: fmtNum(s.from, lang) }) : t('map.legend.range', { from: fmtNum(s.from, lang), to: fmtNum(s.to, lang) })}
          </li>
        ))}
      </ol>
      <ul className="mp-legend-marks">
        <li>
          <span className="mp-mark-rep" aria-hidden />
          {t('map.legend.reports', { days: fmtNum(days, lang) })}
        </li>
        <li>
          <span className="mp-mark-sim" aria-hidden />
          {t('map.legend.sim')}
        </li>
      </ul>
    </div>
  );
}

function Credits({ sightings, shown, geos, pest }: { sightings: Sightings; shown: Country[]; geos: GeoFile[]; pest: PestChoice }) {
  const { t, lang } = useI18n();
  const lic: Record<string, number> = {};
  for (const c of shown) for (const [k, v] of Object.entries(licencesFor(sightings, c, pest))) lic[k] = (lic[k] ?? 0) + v;
  const keys = sightings.taxa.filter((x) => x.key && (pest === 'all' || x.id === pest));
  return (
    <footer className="mp-credits" data-testid="map-credits">
      <p>
        <strong>{t('map.credit.sightings')}</strong> {t('map.credit.gbif', { date: fmtDate(sightings.queried, lang, 'long') })}{' '}
        <a href="https://www.gbif.org/occurrence/search" target="_blank" rel="noreferrer" className="mp-link">
          GBIF.org
        </a>
        {'. '}
        {t('map.credit.licences', {
          list: Object.entries(lic)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${LICENCE_NAME[k] ?? k} (${fmtNum(v, lang)})`)
            .join(', ') || '–',
        })}{' '}
        {t('map.credit.keys')}{' '}
        {keys.map((x, i) => (
          <span key={x.id}>
            {i > 0 && ', '}
            <a href={`https://www.gbif.org/species/${x.key}`} target="_blank" rel="noreferrer" className="mp-link">
              <i>{x.sci}</i> {x.key}
            </a>
          </span>
        ))}
        .
      </p>
      {geos.map((g) => (
        <p key={`${g.country}|${g.level}`}>
          <strong>{t('map.credit.borders', { country: t(`map.country.${g.country as Country}`) })}</strong> {g.source}, {g.licence}.{' '}
          <a href={g.url} target="_blank" rel="noreferrer" className="mp-link">
            geoBoundaries
          </a>
        </p>
      ))}
      <p>
        <strong>{t('map.credit.weather')}</strong> {t('map.credit.openmeteo')}
      </p>
    </footer>
  );
}
