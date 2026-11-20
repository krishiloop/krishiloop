import { describe, expect, it } from 'vitest';
import raw from '../../data/offices/bd.json';
import { DISTRICTS, districtName, placeLine } from './districts';
import { originOf, rankForPlace, type Office, type OfficeData } from './nearest';
import { askNeedsOfficer, cardModel, photoNeedsOfficer } from './unsure';

const real = raw as unknown as OfficeData;
const officer = (mobile: string | null) => ({ name_bn: 'নাম', designation_bn: 'উপজেলা কৃষি অফিসার', designation_en: 'Upazila Agriculture Officer', mobile });
const mk = (id: string, district_en: string, lat: number, lon: number, extra: Partial<Office> = {}): Office => ({
  id, name_en: id, name_bn: null, upazila_en: id, upazila_bn: null, district_en, district_bn: null, lat, lon,
  geo: 'upazila_centre', geo_source: 'x', phone: null, email: null, officer: null, source_url: null, source_read: null, ...extra,
});
const data = (offices: Office[]): OfficeData => ({ ...real, offices });
const list = [
  mk('a', 'Mymensingh', 24.75, 90.4, { officer: officer('01700000001'), phone: '01800000001' }),
  mk('b', 'Mymensingh', 24.6, 90.4, { phone: '01800000002' }),
  mk('c', 'Bogra', 24.85, 89.37),
];

describe('when the nearest officer card shows', () => {
  it('photo check: not for one confident reading, yes for a shortlist or a refer', () => {
    expect(photoNeedsOfficer('diagnose')).toBe(false);
    expect(photoNeedsOfficer('shortlist')).toBe(true);
    expect(photoNeedsOfficer('refer')).toBe(true);
  });
  it('Ask: yes when abstained or no answer, or when the answer says talk to your officer', () => {
    expect(askNeedsOfficer({ status: 'abstained', answer: null })).toBe(true);
    expect(askNeedsOfficer({ status: 'ok', answer: null })).toBe(true);
    expect(askNeedsOfficer({ status: 'ok', answer: { action: { kind: 'officer_contact' } } })).toBe(true);
    expect(askNeedsOfficer({ status: 'ok', answer: { action: { kind: 'input_decision' } } })).toBe(false);
  });
});

describe('cardModel: what the card says', () => {
  it('asks for the place when it is unknown (never guesses)', () => {
    expect(cardModel(data(list), null)).toEqual({ kind: 'ask' });
    expect(cardModel(null, null)).toEqual({ kind: 'ask' });
  });
  it('waits while the list loads', () => expect(cardModel(null, { kind: 'gps', lat: 24.75, lon: 90.4 })).toEqual({ kind: 'loading' }));
  it('GPS: the nearest office with km; Call rings the officer, so no 16123', () => {
    const m = cardModel(data(list), { kind: 'gps', lat: 24.74, lon: 90.4 });
    if (m.kind !== 'office') throw new Error(m.kind);
    expect(m.office.id).toBe('a');
    expect(m.km).toBeGreaterThan(0);
    expect(m.km).toBeLessThan(2);
    expect(m.call).toEqual({ who: 'officer', phone: '01700000001' });
    expect(m.helpline).toBeNull();
  });
  it('no officer phone: Call rings the office and 16123 is offered', () => {
    const m = cardModel(data(list), { kind: 'gps', lat: 24.6, lon: 90.4 });
    if (m.kind !== 'office') throw new Error(m.kind);
    expect(m.office.id).toBe('b');
    expect(m.call).toEqual({ who: 'office', phone: '01800000002' });
    expect(m.helpline).toBe('16123');
  });
  it('no phone at all: no Call button, only 16123', () => {
    const m = cardModel(data(list), { kind: 'gps', lat: 24.85, lon: 89.37 });
    if (m.kind !== 'office') throw new Error(m.kind);
    expect(m.office.id).toBe('c');
    expect(m.call).toBeNull();
    expect(m.helpline).toBe('16123');
  });
  it('a picked district: an office in that district, and no km (we do not know where in it)', () => {
    const m = cardModel(data(list), { kind: 'district', district: 'Bogra' });
    if (m.kind !== 'office') throw new Error(m.kind);
    expect(m.office.district_en).toBe('Bogra');
    expect(m.km).toBeNull();
  });
  it('far from every office (Nairobi): only the helpline', () => {
    expect(cardModel(data(list), { kind: 'gps', lat: -1.29, lon: 36.82 })).toEqual({ kind: 'far', helpline: '16123' });
  });
  it('on the real list, the officer shown is exactly the one the data has', () => {
    const m = cardModel(real, { kind: 'gps', lat: 22.81235, lon: 89.86529 }); // Chitalmari, Bagerhat
    if (m.kind !== 'office') throw new Error(m.kind);
    const o = real.offices.find((x) => x.id === m.office.id)!;
    expect(m.office.officer).toEqual(o.officer);
    if (o.officer?.mobile) expect(m.call).toEqual({ who: 'officer', phone: o.officer.mobile });
  });
});

describe('place helpers', () => {
  it('the middle of a district is the mean of its offices', () => {
    expect(originOf({ kind: 'district', district: 'Mymensingh' }, list)).toEqual({ lat: (24.75 + 24.6) / 2, lon: 90.4 });
    expect(originOf({ kind: 'district', district: 'Nowhere' }, list)).toBeNull();
    expect(originOf(null, list)).toBeNull();
  });
  it('a district ranks its own offices first', () => {
    expect(rankForPlace(list, { kind: 'district', district: 'Bogra' }, 3).map((r) => r.office.id)).toEqual(['c', 'a', 'b']);
  });
  it('every district in the data has a Bangla name, and place lines read in Bangla', () => {
    const known = new Set(DISTRICTS.map((d) => d.en));
    for (const o of real.offices) expect(known.has(o.district_en!), o.district_en!).toBe(true);
    expect(districtName('Bogra', 'bn')).toBe('বগুড়া');
    expect(placeLine(mk('Trishal', 'Mymensingh', 0, 0), 'bn')).toBe('Trishal, ময়মনসিংহ');
  });
});
