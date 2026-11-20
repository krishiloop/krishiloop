import { describe, expect, it } from 'vitest';
import raw from '../../data/offices/bd.json';
import type { Office, OfficeData } from './nearest';
import { norm, searchOffices } from './search';

const data = raw as unknown as OfficeData;
const mk = (id: string, upazila_en: string, district_en: string, lat: number, lon: number, upazila_bn: string | null = null): Office => ({
  id, name_en: `Upazila Agriculture Office, ${upazila_en}`, name_bn: null, upazila_en, upazila_bn, district_en, district_bn: null, lat, lon,
  geo: 'upazila_centre', geo_source: 'x', phone: null, email: null, officer: null, source_url: null, source_read: null,
});
const list = [
  mk('trishal', 'Trishal', 'Mymensingh', 24.58, 90.39),
  mk('mym-sadar', 'Mymensingh Sadar', 'Mymensingh', 24.75, 90.4),
  mk('bogra-sadar', 'Bogra Sadar', 'Bogra', 24.85, 89.37),
  mk('hathazari', 'Hathazari', 'Chittagong', 22.5, 91.8, 'হাটহাজারী'),
  mk('ramu', 'Ramu', "Cox's Bazar", 21.4, 92.1),
];
const ids = (q: string, from?: { lat: number; lon: number }) => searchOffices(list, q, from).map((h) => h.office.id);

describe('norm', () => {
  it('lower-cases and drops punctuation and apostrophes', () => expect(norm("  Cox's   Bazar! ")).toBe('coxs bazar'));
  it('makes a Bangla nukta letter one spelling (ড + ় and ড় match)', () => expect(norm('বগুড়া')).toBe(norm('বগুড়া')));
});

describe('searchOffices', () => {
  it('finds an upazila by English name, or the start of it, in any case', () => {
    expect(ids('Trishal')).toEqual(['trishal']);
    expect(ids('tris')).toEqual(['trishal']);
    expect(ids('TRISHAL')).toEqual(['trishal']);
  });
  it('finds every office of a district, an upazila-name match first', () => expect(ids('mymensingh')).toEqual(['mym-sadar', 'trishal']));
  it('finds a district by its Bangla name', () => expect(ids('ময়মনসিংহ').sort()).toEqual(['mym-sadar', 'trishal']));
  it('finds an upazila by its Bangla name when the data has it', () => expect(ids('হাটহাজারী')).toEqual(['hathazari']));
  it('finds a district by a newer English spelling', () => {
    expect(ids('Bogura')).toEqual(['bogra-sadar']);
    expect(ids('Chattogram')).toEqual(['hathazari']);
    expect(ids('coxs bazar')).toEqual(['ramu']);
  });
  it('finds Bogra by its Bangla name', () => expect(ids('বগুড়া')).toEqual(['bogra-sadar']));
  it('sorts equal matches by distance when the place is known', () => {
    const near = searchOffices(list, 'Mymensingh', { lat: 24.57, lon: 90.39 });
    // "Mymensingh Sadar" matches the upazila name, so it stays first; the km is filled in
    expect(near.map((h) => h.office.id)).toEqual(['mym-sadar', 'trishal']);
    expect(near[1]!.km).toBeLessThan(2);
    // a district search is all equal matches: the nearest first
    expect(ids('ময়মনসিংহ', { lat: 24.57, lon: 90.39 })).toEqual(['trishal', 'mym-sadar']);
  });
  it('finds nothing for an empty, one-letter or unknown query', () => {
    expect(ids('')).toEqual([]);
    expect(ids('t')).toEqual([]);
    expect(ids('ক')).toEqual([]);
    expect(ids('Nairobi')).toEqual([]);
  });
  it('works on the real office list (544 offices, 64 districts)', () => {
    expect(data.offices).toHaveLength(544);
    expect(searchOffices(data.offices, 'Trishal')[0]!.office.id).toBe('bd-mymensingh-trishal');
    const bn = searchOffices(data.offices, 'ময়মনসিংহ');
    expect(bn.length).toBeGreaterThan(5);
    expect(bn.every((h) => h.office.district_en === 'Mymensingh')).toBe(true);
    for (const d of new Set(data.offices.map((o) => o.district_en))) expect(searchOffices(data.offices, d!).length, d!).toBeGreaterThan(0);
  });
});
