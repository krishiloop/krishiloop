import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { GIBS, gibsDate, gibsImageUrl, type GibsId } from '../../lib/nasa/gibs';
import { areaBounds, fetchPower, mean, pictureBox, type PowerSeries } from './nasa';
import { loadRain, type RainFile } from './rain';
import { areaPlace, type GeoArea, type GeoFile } from './model';

/**
 * "NASA, from space" for one area: a satellite or crop-health picture (NASA GIBS, drawn from the area's own box, loaded
 * lazily) with the area's outline on top, and the last 14 days of NASA POWER weather at the area's centre. Every block says
 * its source and its dates. A missing POWER day is "no data", never a number.
 */
/** rainName: the district's name in the rainfall file (Bangladesh districts only), otherwise null. */
export function NasaPanel({ area, geo, rainName }: { area: GeoArea; geo: GeoFile; rainName: string | null }) {
  const { t, lang } = useI18n();
  const [pic, setPic] = useState<GibsId>('truecolor');
  const [picErr, setPicErr] = useState(false);
  const [date] = useState(() => gibsDate());
  const { lat, lon } = useMemo(() => areaPlace(geo, area), [geo, area]);
  const box = useMemo(() => pictureBox(areaBounds(geo, area)), [geo, area]);
  const layer = GIBS[pic];
  const src = gibsImageUrl(layer, date, box.bbox, box.width, box.height);

  // outline over the picture: SVG units of the outline file, cut to the picture's box
  const p = geo.projection;
  const [ox, oy] = area.off ?? [0, 0]; // an inset is drawn away from its real place
  const vb = [
    (box.bbox[0] + ox - p.lon_min) * p.k * p.scale,
    (p.lat_max - (box.bbox[3] + oy)) * p.scale,
    (box.bbox[2] - box.bbox[0]) * p.k * p.scale,
    (box.bbox[3] - box.bbox[1]) * p.scale,
  ];

  const [power, setPower] = useState<PowerSeries | null>(null);
  const [perr, setPerr] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setPerr(false);
    setPower(null);
    fetchPower(lat, lon)
      .then((s) => alive && setPower(s))
      .catch(() => alive && setPerr(true));
    return () => {
      alive = false;
    };
  }, [lat, lon, tick]);

  useEffect(() => setPicErr(false), [pic, src]);

  const [rain, setRain] = useState<RainFile | null>(null);
  useEffect(() => {
    let alive = true;
    if (rainName) void loadRain().then((r) => alive && setRain(r));
    return () => {
      alive = false;
    };
  }, [rainName]);
  const mm = rainName && rain ? rain.districts[rainName] : undefined;

  const n1 = (n: number | null, d = 0) => (n == null ? t('map.nasa.power.none') : fmtNum(n, lang, { maximumFractionDigits: d }));
  const days = power?.days ?? [];
  const lows = days.map((d) => d.tmin).filter((x): x is number => x != null);
  const highs = days.map((d) => d.tmax).filter((x): x is number => x != null);
  const lo = lows.length ? Math.min(...lows) : 0;
  const hi = highs.length ? Math.max(...highs) : 1;
  const span = Math.max(1, hi - lo);

  return (
    <section aria-labelledby="mp-p-nasa" className="mp-nasa" data-testid="map-nasa">
      <h3 id="mp-p-nasa" className="mp-p-h">
        {t('map.nasa.title')}
      </h3>

      <div className="mp-nasa-tabs" role="group" aria-label={t('map.nasa.title')}>
        {(['truecolor', 'ndvi'] as const).map((id) => (
          <button key={id} type="button" className={cx('mp-nasa-tab', pic === id && 'is-on')} aria-pressed={pic === id} data-pic={id} onClick={() => setPic(id)}>
            {t(id === 'truecolor' ? 'map.nasa.pic.true' : 'map.nasa.pic.ndvi')}
          </button>
        ))}
      </div>
      <div className="mp-nasa-pic" style={{ aspectRatio: `${box.width} / ${box.height}` }}>
        {picErr ? (
          <p className="mp-p-sub" role="alert">
            {t('map.nasa.pic.error')}
          </p>
        ) : (
          <>
            <img
              key={src}
              src={src}
              alt={t('map.nasa.pic.alt', { area: area.name, date: fmtDate(date, lang, 'long') })}
              width={box.width}
              height={box.height}
              loading="lazy"
              decoding="async"
              referrerPolicy="strict-origin-when-cross-origin"
              onError={() => setPicErr(true)}
              data-testid="map-nasa-img"
            />
            <svg viewBox={vb.join(' ')} preserveAspectRatio="none" aria-hidden>
              <path d={area.d} fill="none" vectorEffect="non-scaling-stroke" />
            </svg>
          </>
        )}
      </div>
      <p className="mp-credit" data-testid="map-nasa-credit">
        {t('map.nasa.pic.credit', { product: layer.product, date: fmtDate(date, lang, 'long') })}
      </p>

      {rainName && rain && mm !== undefined && (
        <div className="mp-nasa-rain" data-testid="map-nasa-rain">
          <p className="mp-nasa-rainrow">
            {mm == null
              ? t('map.nasa.rain.nodata')
              : t('map.nasa.rain.row', { mm: fmtNum(mm, lang, { maximumFractionDigits: 1 }), from: fmtDate(rain.days[0]!, lang, 'short'), to: fmtDate(rain.days[rain.days.length - 1]!, lang, 'short') })}
          </p>
          <p className="mp-credit">{t('map.nasa.rain.credit', { version: rain.version, made: fmtDate(rain.made.slice(0, 10), lang, 'short') })}</p>
        </div>
      )}

      <h4 className="mp-nasa-sub">{t('map.nasa.power.title')}</h4>
      {perr ? (
        <div role="alert" className="mp-p-sub">
          <p>{t('map.nasa.power.error')}</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setTick((n) => n + 1)}>
            <RefreshCw size={15} aria-hidden />
            {t('ui.retry')}
          </button>
        </div>
      ) : !power ? (
        <div aria-busy="true">
          <p className="sr-only-live" role="status">
            {t('map.nasa.power.loading')}
          </p>
          <div className="skeleton h-24 w-full" />
        </div>
      ) : days.length === 0 ? (
        <p className="mp-p-sub">{t('map.nasa.power.none')}</p>
      ) : (
        <>
          <dl className="mp-nasa-tiles" data-testid="map-power-tiles">
            <div>
              <dt>{t('map.nasa.power.hi')}</dt>
              <dd className="mono">{n1(mean(days.map((d) => d.tmax)), 1)}{mean(days.map((d) => d.tmax)) != null && ' °C'}</dd>
            </div>
            <div>
              <dt>{t('map.nasa.power.lo')}</dt>
              <dd className="mono">{n1(mean(days.map((d) => d.tmin)), 1)}{mean(days.map((d) => d.tmin)) != null && ' °C'}</dd>
            </div>
            <div>
              <dt>{t('map.nasa.power.rh')}</dt>
              <dd className="mono">{n1(mean(days.map((d) => d.rh)), 0)}{mean(days.map((d) => d.rh)) != null && '%'}</dd>
            </div>
            <div>
              <dt>{t('map.nasa.power.sun')}</dt>
              <dd className="mono">{n1(mean(days.map((d) => d.sun)), 1)}</dd>
            </div>
          </dl>
          <ol className="mp-nasa-days" data-testid="map-power-days">
            {days.map((d) => (
              <li
                key={d.date}
                aria-label={t('map.nasa.power.day', { day: fmtDate(d.date, lang, 'short'), hi: n1(d.tmax, 1), lo: n1(d.tmin, 1), rh: n1(d.rh, 0), sun: n1(d.sun, 1) })}
                data-missing={d.tmax == null || d.tmin == null ? 'yes' : 'no'}
              >
                <span className="mp-nasa-col" aria-hidden>
                  {d.tmax != null && d.tmin != null && <i style={{ bottom: `${((d.tmin - lo) / span) * 100}%`, height: `${Math.max(4, ((d.tmax - d.tmin) / span) * 100)}%` }} />}
                </span>
                <span className="mp-nasa-d mono" aria-hidden>
                  {fmtDate(d.date, lang, 'dayNum')}
                </span>
              </li>
            ))}
          </ol>
          <p className="mp-wx-key" aria-hidden>
            {t('map.nasa.power.key')}
          </p>
          <p className="mp-credit" data-testid="map-power-credit">
            {t('map.nasa.power.credit', {
              from: fmtDate(days[0]!.date, lang, 'long'),
              to: fmtDate(days[days.length - 1]!.date, lang, 'long'),
              lat: fmtNum(power.lat, lang, { maximumFractionDigits: 2 }),
              lon: fmtNum(power.lon, lang, { maximumFractionDigits: 2 }),
            })}{' '}
            <a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer" className="mp-link">
              NASA POWER
            </a>
          </p>
        </>
      )}
    </section>
  );
}
