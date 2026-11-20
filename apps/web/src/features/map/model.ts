/**
 * The Disease map's numbers (builder M), pure and tested (model.test.ts). Nothing here invents a count:
 *  - recorded sightings come from data/map/sightings.json (GBIF facet counts, built offline by tools/build_map_data.py);
 *  - farmer reports come from the outbreak radar (GET /api/radar, k-anonymous cells), never mixed with sightings;
 *  - the simulated outbreak is the radar's practice scenario, kept in its own layer.
 */
import type { RadarCell } from '../farmer/climate/types';

export type Country = 'BD' | 'IN' | 'KE' | 'ES' | 'PT' | 'BR';
/** Bangladesh first (home), then the countries with GBIF records for our pest list, in the order they were added. */
export const COUNTRIES: Country[] = ['BD', 'IN', 'KE', 'ES', 'PT', 'BR'];
export type PestId = 'faw' | 'blast' | 'late_blight' | 'bph' | 'locust' | 'blb' | 'brown_spot';
export const PESTS: PestId[] = ['faw', 'blast', 'late_blight', 'bph', 'locust', 'blb', 'brown_spot'];
export type PestChoice = PestId | 'all';
export type Level = 'district' | 'division' | 'state' | 'county' | 'region';
/** The level each country is drawn at (Bangladesh can also be shown as divisions). */
export const LEVEL_OF: Record<Country, Level> = { BD: 'district', IN: 'state', KE: 'county', ES: 'region', PT: 'district', BR: 'state' };

/** The radar's problem codes for each pest (tools/build_map_data.py TAXA keeps the same list). */
export const PEST_PROBLEMS: Record<PestId, string[]> = {
  faw: ['fall_armyworm'],
  blast: ['blast', 'rice_blast', 'neck_blast'],
  late_blight: ['late_blight'],
  bph: ['brown_planthopper'],
  locust: ['desert_locust', 'locust'],
  blb: ['bacterial_leaf_blight', 'bacterial_blight'],
  brown_spot: ['brown_spot'],
};

export interface AreaRec {
  /** every record placed in this area (with or without a year) */
  n: number;
  /** [year, records] for the records that have a year */
  y: [number, number][];
}
export interface LevelCounts {
  placed: number;
  unplaced: number;
  areas: Record<string, AreaRec>;
}
export interface TaxonCountry {
  total: number;
  years: [number, number] | null;
  dated: number;
  licences: Record<string, number>;
  basis: Record<string, number>;
  levels: Record<string, LevelCounts>;
}
export interface Sightings {
  v: number;
  queried: string;
  api: string;
  citation: string;
  taxa: { id: PestId; sci: string; key: number | null }[];
  countries: Record<Country, { levels: Record<string, { areas: number }>; taxa: Record<string, TaxonCountry>; default_level?: Level }>;
}

export interface GeoArea {
  code: string;
  name: string;
  d: string;
  label: [number, number];
  /** Bangladesh divisions only: the districts inside (for adding up district-level farmer reports) */
  districts?: string[];
  /** an inset (Portugal's islands): the place drawn here is really at (drawn lon - off[0], drawn lat - off[1]) */
  off?: [number, number];
}
export interface GeoFile {
  country: string;
  level: string;
  viewBox: [number, number, number, number];
  projection: { lon_min: number; lat_max: number; k: number; scale: number };
  source: string;
  licence: string;
  url: string;
  caveat?: string;
  areas: GeoArea[];
}

/* ------------------------------------------------------------------ years */
export interface YearRange {
  from: number;
  to: number;
}

/** The first and last year of any record in the file (all countries, all pests): the slider's ends. */
export function yearSpan(s: Sightings): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of Object.values(s.countries))
    for (const t of Object.values(c.taxa))
      if (t.years) {
        lo = Math.min(lo, t.years[0]);
        hi = Math.max(hi, t.years[1]);
      }
  return Number.isFinite(lo) ? [lo, hi] : [2000, 2026];
}

/** True when the range covers the whole span: then records without a year count too. */
export const isFullRange = (r: YearRange, span: [number, number]) => r.from <= span[0] && r.to >= span[1];

/** Records of one area in the year range. A record with no year is counted only when the range is the whole span. */
export function countInRange(rec: AreaRec | undefined, r: YearRange, span: [number, number]): number {
  if (!rec) return 0;
  if (isFullRange(r, span)) return rec.n;
  let n = 0;
  for (const [y, c] of rec.y) if (y >= r.from && y <= r.to) n += c;
  return n;
}

/* ------------------------------------------------------------------ aggregation */
const pestList = (p: PestChoice): PestId[] => (p === 'all' ? PESTS : [p]);

/** area code -> recorded sightings for the pest (or all pests together) in the year range. Zero areas are left out. */
export function sightingsByArea(s: Sightings, country: Country, level: Level, pest: PestChoice, r: YearRange, span: [number, number]): Map<string, number> {
  const out = new Map<string, number>();
  const c = s.countries[country];
  if (!c) return out;
  for (const p of pestList(pest)) {
    const lv = c.taxa[p]?.levels[level];
    if (!lv) continue;
    for (const [code, rec] of Object.entries(lv.areas)) {
      const n = countInRange(rec, r, span);
      if (n > 0) out.set(code, (out.get(code) ?? 0) + n);
    }
  }
  return out;
}

/** One area's sightings per pest (the side panel's list), in the year range. */
export function pestsInArea(s: Sightings, country: Country, level: Level, code: string, r: YearRange, span: [number, number]): { pest: PestId; n: number }[] {
  const c = s.countries[country];
  return PESTS.map((pest) => ({ pest, n: countInRange(c?.taxa[pest]?.levels[level]?.areas[code], r, span) }));
}

/** Country totals for the pest: every GBIF record, and how many of them have a place we can map. */
export function countryTotals(s: Sightings, country: Country, level: Level, pest: PestChoice): { total: number; placed: number } {
  const c = s.countries[country];
  let total = 0;
  let placed = 0;
  for (const p of pestList(pest)) {
    total += c?.taxa[p]?.total ?? 0;
    placed += c?.taxa[p]?.levels[level]?.placed ?? 0;
  }
  return { total, placed };
}

/** Licences of the records behind a count, e.g. {CC_BY_4_0: 49}. */
export function licencesFor(s: Sightings, country: Country, pest: PestChoice): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pestList(pest)) for (const [k, v] of Object.entries(s.countries[country]?.taxa[p]?.licences ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Farmer reports (radar cells) -> area code -> farmers reporting, for the pest. District cells add up into their
 *  Bangladesh division when the map shows divisions. Cells already passed the k rule; nothing is un-hidden here. */
export function reportsByArea(cells: RadarCell[], country: Country, pest: PestChoice, divisions?: GeoArea[]): Map<string, number> {
  const problems = pest === 'all' ? null : new Set(PEST_PROBLEMS[pest]);
  const parent = new Map<string, string>();
  if (divisions) for (const d of divisions) for (const k of d.districts ?? []) parent.set(k, d.code);
  const out = new Map<string, number>();
  for (const c of cells) {
    if (c.country !== country || (problems && !problems.has(c.problem))) continue;
    const code = divisions ? parent.get(c.area) : c.area;
    if (code) out.set(code, (out.get(code) ?? 0) + c.reporters);
  }
  return out;
}

/* ------------------------------------------------------------------ colour scale */
/** Lower bounds of steps 1..5 (step 0 = no record). Fixed, so the same colour means the same number in every country. */
export const BREAKS = [1, 3, 10, 30, 100] as const;
export function stepOf(n: number): 0 | 1 | 2 | 3 | 4 | 5 {
  let s = 0;
  for (const b of BREAKS) if (n >= b) s++;
  return s as 0 | 1 | 2 | 3 | 4 | 5;
}
/** The legend's ranges: [label-from, label-to | null] per step, e.g. [1,2], [3,9] ... [100, null]. */
export function legendSteps(): { step: number; from: number; to: number | null }[] {
  return BREAKS.map((b, i) => ({ step: i + 1, from: b, to: i + 1 < BREAKS.length ? BREAKS[i + 1]! - 1 : null }));
}

/** Farmers reporting -> marker size step, the radar's own steps (3-4, 5-7, 8+). */
export const reportStep = (n: number) => (n >= 8 ? 3 : n >= 5 ? 2 : 1);

/* ------------------------------------------------------------------ geography */
/** An SVG point back to longitude and latitude (inverse of the build's equirectangular projection). */
export function toLonLat(geo: Pick<GeoFile, 'projection'>, [x, y]: [number, number]): { lat: number; lon: number } {
  const p = geo.projection;
  return { lon: +(p.lon_min + x / (p.k * p.scale)).toFixed(3), lat: +(p.lat_max - y / p.scale).toFixed(3) };
}

/** The real longitude and latitude of an area's label point (undoing an inset, if the area has one). */
export function areaPlace(geo: Pick<GeoFile, 'projection'>, area: Pick<GeoArea, 'label' | 'off'>): { lat: number; lon: number } {
  const p = toLonLat(geo, area.label);
  return area.off ? { lon: +(p.lon - area.off[0]).toFixed(3), lat: +(p.lat - area.off[1]).toFixed(3) } : p;
}

export type Dir = 'left' | 'right' | 'up' | 'down';
/** The next area for an arrow key: the nearest label in that direction (angle counts double, so it feels straight). */
export function neighbour(areas: Pick<GeoArea, 'code' | 'label'>[], from: string, dir: Dir): string | null {
  const a = areas.find((x) => x.code === from);
  if (!a) return areas[0]?.code ?? null;
  const [ax, ay] = a.label;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const b of areas) {
    if (b.code === from) continue;
    const dx = b.label[0] - ax;
    const dy = b.label[1] - ay;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = b.code;
    }
  }
  return best;
}
