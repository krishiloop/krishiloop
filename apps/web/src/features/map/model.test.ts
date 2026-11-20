import { describe, expect, it } from 'vitest';
import type { RadarCell } from '../farmer/climate/types';
import {
  COUNTRIES,
  LEVEL_OF,
  areaPlace,
  countInRange,
  countryTotals,
  isFullRange,
  legendSteps,
  neighbour,
  pestsInArea,
  reportStep,
  reportsByArea,
  sightingsByArea,
  stepOf,
  toLonLat,
  yearSpan,
  type Country,
  type GeoFile,
  type Sightings,
} from './model';
import real from '../../data/map/sightings.json';
import bdDivJson from '../../data/map/geo-bd-div.json';

const bdDiv = bdDivJson as unknown as GeoFile;
const S: Sightings = {
  v: 1,
  queried: '2026-11-19',
  api: 'x',
  citation: 'GBIF.org',
  taxa: [],
  countries: {
    BD: {
      levels: { district: { areas: 64 } },
      taxa: {
        bph: { total: 10, years: [2014, 2020], dated: 8, licences: { CC_BY_4_0: 10 }, basis: {}, levels: { district: { placed: 9, unplaced: 0, areas: { 'BD-dhaka': { n: 6, y: [[2014, 2], [2019, 3]] }, 'BD-sylhet': { n: 3, y: [[2020, 3]] } } } } },
        blast: { total: 4, years: [1990, 1990], dated: 1, licences: { CC0_1_0: 4 }, basis: {}, levels: { district: { placed: 2, unplaced: 0, areas: { 'BD-dhaka': { n: 2, y: [[1990, 1]] } } } } },
      },
    },
    IN: { levels: { state: { areas: 36 } }, taxa: {} },
    KE: { levels: { county: { areas: 47 } }, taxa: { faw: { total: 1, years: [2022, 2022], dated: 1, licences: {}, basis: {}, levels: { county: { placed: 1, unplaced: 0, areas: { 'KE-nakuru': { n: 1, y: [[2022, 1]] } } } } } } },
    ES: { levels: { region: { areas: 19 } }, taxa: {} },
    PT: { levels: { district: { areas: 20 } }, taxa: {} },
    BR: { levels: { state: { areas: 27 } }, taxa: {} },
  },
};
const span = yearSpan(S);

describe('years', () => {
  it('the span runs from the earliest to the latest record of any pest and country', () => {
    expect(span).toEqual([1990, 2022]);
  });
  it('the whole span counts records with no year too; a narrower range counts only dated records in it', () => {
    const rec = S.countries.BD.taxa.bph!.levels.district!.areas['BD-dhaka'];
    expect(isFullRange({ from: 1990, to: 2022 }, span)).toBe(true);
    expect(countInRange(rec, { from: 1990, to: 2022 }, span)).toBe(6); // 5 dated + 1 without a year
    expect(countInRange(rec, { from: 1990, to: 2018 }, span)).toBe(2);
    expect(countInRange(rec, { from: 2019, to: 2019 }, span)).toBe(3);
    expect(countInRange(rec, { from: 2021, to: 2022 }, span)).toBe(0);
    expect(countInRange(undefined, { from: 1990, to: 2022 }, span)).toBe(0);
  });
});

describe('aggregation', () => {
  it('one pest per area, zero areas left out', () => {
    const m = sightingsByArea(S, 'BD', 'district', 'bph', { from: 2019, to: 2022 }, span);
    expect([...m]).toEqual([
      ['BD-dhaka', 3],
      ['BD-sylhet', 3],
    ]);
  });
  it('all pests add up per area', () => {
    const m = sightingsByArea(S, 'BD', 'district', 'all', { from: 1990, to: 2022 }, span);
    expect(m.get('BD-dhaka')).toBe(8);
    expect(m.get('BD-sylhet')).toBe(3);
  });
  it('the panel lists every pest for one area, zeros included', () => {
    const rows = pestsInArea(S, 'BD', 'district', 'BD-dhaka', { from: 1990, to: 2022 }, span);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.pest === 'bph')!.n).toBe(6);
    expect(rows.find((r) => r.pest === 'faw')!.n).toBe(0);
  });
  it('country totals: all records, and those with a mappable place', () => {
    expect(countryTotals(S, 'BD', 'district', 'all')).toEqual({ total: 14, placed: 11 });
    expect(countryTotals(S, 'IN', 'state', 'faw')).toEqual({ total: 0, placed: 0 });
  });
});

describe('farmer reports', () => {
  const cell = (area: string, problem: string, reporters: number, country: 'BD' | 'KE' = 'BD'): RadarCell => ({
    area,
    area_name: area,
    country,
    level: 'district',
    problem,
    reports: reporters,
    reporters,
    kinds: { photo: 0, abstention: 0, ask: 0 },
    last_days_ago: 0,
  });
  const cells = [cell('BD-mymensingh', 'bacterial_leaf_blight', 9), cell('BD-netrakona', 'bacterial_leaf_blight', 5), cell('BD-tangail', 'blast', 4), cell('KE-nakuru', 'late_blight', 4, 'KE')];
  it('filters by country and pest (through the radar problem codes)', () => {
    expect([...reportsByArea(cells, 'BD', 'blb')]).toEqual([
      ['BD-mymensingh', 9],
      ['BD-netrakona', 5],
    ]);
    expect([...reportsByArea(cells, 'KE', 'all')]).toEqual([['KE-nakuru', 4]]);
    expect(reportsByArea(cells, 'IN', 'all').size).toBe(0);
  });
  it('adds district cells into their Bangladesh division', () => {
    const m = reportsByArea(cells, 'BD', 'all', bdDiv.areas);
    expect(m.get('BD-div-mymensingh')).toBe(14);
    expect(m.get('BD-div-dhaka')).toBe(4); // Tangail is in Dhaka division
  });
  it('marker steps follow the radar (3-4, 5-7, 8+)', () => {
    expect([3, 4, 5, 7, 8, 20].map(reportStep)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('colour scale', () => {
  it('fixed steps with numbers for the legend', () => {
    expect([0, 1, 2, 3, 9, 10, 29, 30, 99, 100, 5000].map(stepOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(legendSteps()).toEqual([
      { step: 1, from: 1, to: 2 },
      { step: 2, from: 3, to: 9 },
      { step: 3, from: 10, to: 29 },
      { step: 4, from: 30, to: 99 },
      { step: 5, from: 100, to: null },
    ]);
  });
});

describe('geography', () => {
  it('turns a map point back into longitude and latitude (Dhaka division centre)', () => {
    const dhaka = bdDiv.areas.find((a) => a.code === 'BD-div-dhaka')!;
    const { lat, lon } = toLonLat(bdDiv, dhaka.label);
    expect(lat).toBeGreaterThan(23);
    expect(lat).toBeLessThan(24.5);
    expect(lon).toBeGreaterThan(89.5);
    expect(lon).toBeLessThan(91);
  });
  it('arrow keys move to the nearest area in that direction', () => {
    const areas = [
      { code: 'a', label: [0, 0] as [number, number] },
      { code: 'b', label: [10, 1] as [number, number] },
      { code: 'c', label: [0, 10] as [number, number] },
      { code: 'd', label: [30, 0] as [number, number] },
    ];
    expect(neighbour(areas, 'a', 'right')).toBe('b');
    expect(neighbour(areas, 'a', 'down')).toBe('c');
    expect(neighbour(areas, 'a', 'left')).toBe(null);
    expect(neighbour(areas, 'b', 'right')).toBe('d');
    expect(neighbour(areas, 'zz', 'up')).toBe('a');
  });
});

describe('the built file', () => {
  const data = real as unknown as Sightings;
  it('has all six countries, the query date, the citation, and resolved GBIF keys', () => {
    expect(Object.keys(data.countries).sort()).toEqual([...COUNTRIES].sort());
    expect(data.queried).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.citation).toMatch(/^GBIF\.org/);
    expect(data.taxa.filter((t) => t.key).length).toBeGreaterThanOrEqual(5);
  });
  it('never places more records than GBIF holds for that country and pest', () => {
    for (const c of Object.values(data.countries))
      for (const t of Object.values(c.taxa)) for (const lv of Object.values(t.levels)) expect(lv.placed).toBeLessThanOrEqual(t.total);
  });
});

describe('the new countries (Spain, Portugal, Brazil)', () => {
  const data = real as unknown as Sightings;
  const geos = import.meta.glob('../../data/map/geo-{es,pt,br}.json', { eager: true }) as Record<string, { default: GeoFile }>;
  const geoOf = (c: string) => Object.entries(geos).find(([k]) => k.endsWith(`geo-${c.toLowerCase()}.json`))![1].default;
  it('every area code in the counts is an area of the outline, and the level is the one the page draws', () => {
    for (const c of ['ES', 'PT', 'BR'] as const) {
      const g = geoOf(c);
      const codes = new Set(g.areas.map((a) => a.code));
      const level = LEVEL_OF[c];
      expect(Object.keys(data.countries[c].levels)).toEqual([level]);
      for (const t of Object.values(data.countries[c].taxa)) for (const code of Object.keys(t.levels[level]?.areas ?? {})) expect(codes.has(code), `${c} ${code}`).toBe(true);
    }
  });
  it('has real records for Spain, Portugal and Brazil, with the pests GBIF holds', () => {
    const tot = (c: Country) => Object.values(data.countries[c].taxa).reduce((n, t) => n + t.total, 0);
    expect(tot('ES')).toBeGreaterThan(500);
    expect(tot('PT')).toBeGreaterThan(0);
    expect(tot('BR')).toBeGreaterThan(1000);
  });
  it('Portugal draws its islands as insets and asks for their real place', () => {
    const g = geoOf('PT');
    const madeira = g.areas.find((a) => a.name === 'Madeira')!;
    expect(madeira.off).toEqual([4.8, 3.3]);
    const p = areaPlace(g, madeira);
    expect(p.lat).toBeGreaterThan(32.3);
    expect(p.lat).toBeLessThan(33.3); // Madeira is at about 32.7 N, not at the inset
    expect(p.lon).toBeLessThan(-16);
    const faro = g.areas.find((a) => a.name === 'Faro')!;
    expect(areaPlace(g, faro).lat).toBeGreaterThan(36.8);
  });
});
