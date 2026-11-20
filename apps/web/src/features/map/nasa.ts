/**
 * NASA data for one area of the disease map. Two live, key-free sources, fetched only when the panel is open:
 *  - NASA GIBS pictures (src/lib/nasa/gibs.ts), drawn by the browser from the area's own outline box;
 *  - NASA POWER daily data for the area's centre (community AG): T2M_MAX, T2M_MIN, RH2M, ALLSKY_SFC_SW_DWN.
 * POWER marks a missing day with -999: that is "no data", never a number. POWER's rain is not used (it is wrong for recent weeks).
 */
import { toLonLat, type GeoArea, type GeoFile } from './model';

/** [west, south, east, north] of an area's outline, from its SVG path (only M, l and z are used by our outline files). */
export function areaBounds(geo: Pick<GeoFile, 'projection'>, area: Pick<GeoArea, 'd'>): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sub of area.d.split(/(?=M)/)) {
    const m = sub.match(/-?\d+(?:\.\d+)?/g);
    if (!m || m.length < 2) continue;
    let x = Number(m[0]);
    let y = Number(m[1]);
    const take = () => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    take();
    for (let i = 2; i + 1 < m.length; i += 2) {
      x += Number(m[i]);
      y += Number(m[i + 1]);
      take();
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 1, 1];
  const nw = toLonLat(geo, [minX, minY]);
  const se = toLonLat(geo, [maxX, maxY]);
  return [nw.lon, se.lat, se.lon, nw.lat];
}

/** The box GIBS is asked for: the area plus a little margin, never smaller than 0.5 degrees, so the picture has the same shape as its box. */
export function pictureBox(b: [number, number, number, number], pad = 0.08): { bbox: [number, number, number, number]; width: number; height: number } {
  const midLon = (b[0] + b[2]) / 2;
  const midLat = (b[1] + b[3]) / 2;
  const w = Math.max(0.5, (b[2] - b[0]) * (1 + pad * 2));
  const h = Math.max(0.5, (b[3] - b[1]) * (1 + pad * 2));
  const width = 480;
  // one degree of longitude is shorter than one of latitude: keep the picture's shape true on the ground
  const ratio = (w * Math.cos((midLat * Math.PI) / 180)) / h;
  const height = Math.max(160, Math.min(640, Math.round(width / ratio)));
  return { bbox: [midLon - w / 2, midLat - h / 2, midLon + w / 2, midLat + h / 2], width, height };
}

/* ------------------------------------------------------------------ NASA POWER */
export interface PowerDay {
  date: string; // 2026-11-14
  tmax: number | null;
  tmin: number | null;
  rh: number | null;
  sun: number | null; // MJ/m2/day
}
export interface PowerSeries {
  days: PowerDay[];
  lat: number;
  lon: number;
}

export const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const FILL = -999;
const powerCache = new Map<string, Promise<PowerSeries>>();
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** The last 14 days POWER has for a place. It runs a few days behind, so we ask for 21 days up to yesterday and drop the newest days that have nothing at all. */
export function fetchPower(lat: number, lon: number, now: Date = new Date()): Promise<PowerSeries> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - 20 * 86400000);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${ymd(end)}`;
  let p = powerCache.get(key);
  if (!p) {
    const q = new URLSearchParams({
      parameters: 'T2M_MAX,T2M_MIN,RH2M,ALLSKY_SFC_SW_DWN',
      community: 'AG',
      longitude: lon.toFixed(2),
      latitude: lat.toFixed(2),
      start: ymd(start),
      end: ymd(end),
      format: 'JSON',
    });
    p = fetch(`${POWER_URL}?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(`NASA POWER ${r.status}`);
        return r.json() as Promise<PowerJson>;
      })
      .then((j) => shapePower(j, lat, lon));
    p.catch(() => powerCache.delete(key));
    powerCache.set(key, p);
  }
  return p;
}

interface PowerJson {
  properties?: { parameter?: Record<string, Record<string, number>> };
}

export function shapePower(j: PowerJson, lat: number, lon: number): PowerSeries {
  const par = j.properties?.parameter ?? {};
  const val = (name: string, day: string) => {
    const v = par[name]?.[day];
    return typeof v === 'number' && v !== FILL && Number.isFinite(v) ? v : null;
  };
  const keys = Object.keys(par.T2M_MAX ?? {}).sort();
  const all: PowerDay[] = keys.map((k) => ({
    date: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`,
    tmax: val('T2M_MAX', k),
    tmin: val('T2M_MIN', k),
    rh: val('RH2M', k),
    sun: val('ALLSKY_SFC_SW_DWN', k),
  }));
  // drop the newest days with no data at all (POWER has not produced them yet)
  const empty = (d: PowerDay) => d.tmax == null && d.tmin == null && d.rh == null && d.sun == null;
  while (all.length && empty(all[all.length - 1]!)) all.pop();
  return { days: all.slice(-14), lat, lon };
}

export const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
