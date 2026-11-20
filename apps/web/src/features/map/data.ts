/**
 * Lazy loaders for the Disease map (builder M). Every file is fetched once per page and only when shown:
 * outlines per country (Bangladesh districts and Kenya counties are the outbreak radar's own files), the GBIF counts,
 * and the "what to watch" rules. The 7-day forecast comes straight from Open-Meteo in the browser, only when an area's
 * panel opens, one request per place, cached in memory for this visit.
 */
import type { Country, GeoFile, Level, Sightings } from './model';

const geoCache = new Map<string, Promise<GeoFile>>();
export function loadGeo(country: Country, level: Level): Promise<GeoFile> {
  const key = `${country}|${level}`;
  let p = geoCache.get(key);
  if (!p) {
    p = (
      country === 'IN'
        ? import('../../data/map/geo-in.json')
        : country === 'KE'
          ? import('../officer/radar/geo/ke.json')
          : country === 'ES'
            ? import('../../data/map/geo-es.json')
            : country === 'PT'
              ? import('../../data/map/geo-pt.json')
              : country === 'BR'
                ? import('../../data/map/geo-br.json')
                : level === 'division'
                  ? import('../../data/map/geo-bd-div.json')
                  : import('../officer/radar/geo/bd.json')
    ).then((m) => m.default as unknown as GeoFile);
    p.catch(() => geoCache.delete(key));
    geoCache.set(key, p);
  }
  return p;
}

let sightingsCall: Promise<Sightings> | null = null;
export const loadSightings = () => (sightingsCall ??= import('../../data/map/sightings.json').then((m) => m.default as unknown as Sightings));

export interface WatchRule {
  id: string;
  v: number;
  title: { en: string; bn: string };
  doc: string;
  page: number;
  publisher: string | null;
  url: string | null;
}
export type Watch = Partial<Record<Country, { pack: string; crop: string; pests: Record<string, WatchRule[]> }>>;
let watchCall: Promise<Watch> | null = null;
export const loadWatch = () => (watchCall ??= import('../../data/map/watch.json').then((m) => m.default as unknown as Watch));

/* ------------------------------------------------------------------ weather (Open-Meteo, CC BY 4.0) */
export interface DayWx {
  date: string;
  rain: number | null;
  rainChance: number | null;
  tmax: number | null;
  tmin: number | null;
  rh: number | null;
}
export interface Forecast {
  days: DayWx[];
  timezone: string;
  lat: number;
  lon: number;
}

export const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const wxCache = new Map<string, Promise<Forecast>>();

/** One request per place (rounded to 0.01°), kept for this visit. A failed request is forgotten so Retry asks again. */
export function fetchForecast(lat: number, lon: number): Promise<Forecast> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let p = wxCache.get(key);
  if (!p) {
    const q = new URLSearchParams({
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      daily: 'precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean',
      timezone: 'auto',
      forecast_days: '7',
    });
    p = fetch(`${OPEN_METEO}?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
        return r.json() as Promise<OpenMeteoDaily>;
      })
      .then(shapeForecast);
    p.catch(() => wxCache.delete(key));
    wxCache.set(key, p);
  }
  return p;
}

interface OpenMeteoDaily {
  latitude: number;
  longitude: number;
  timezone?: string;
  daily?: {
    time: string[];
    precipitation_sum?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    relative_humidity_2m_mean?: (number | null)[];
  };
}

export function shapeForecast(r: OpenMeteoDaily): Forecast {
  const d = r.daily;
  const at = <T,>(a: (T | null)[] | undefined, i: number) => (a && a[i] != null ? (a[i] as T) : null);
  return {
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone ?? '',
    days: (d?.time ?? []).slice(0, 7).map((date, i) => ({
      date,
      rain: at(d?.precipitation_sum, i),
      rainChance: at(d?.precipitation_probability_max, i),
      tmax: at(d?.temperature_2m_max, i),
      tmin: at(d?.temperature_2m_min, i),
      rh: at(d?.relative_humidity_2m_mean, i),
    })),
  };
}

/** Rain is "forecast" when any day has at least 1 mm: the only thing that turns on the panel's rain effect. */
export const rainForecast = (f: Forecast | null) => !!f?.days.some((d) => (d.rain ?? 0) >= 1);
