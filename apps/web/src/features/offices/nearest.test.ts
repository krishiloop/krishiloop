import { describe, expect, it } from 'vitest';
import { directionsUrl, haversineKm, nearest, osmUrl, telHref, type Office } from './nearest';

const mk = (id: string, lat: number, lon: number): Office => ({
  id, name_en: id, name_bn: null, upazila_en: id, upazila_bn: null, district_en: 'D', district_bn: null, lat, lon,
  geo: 'upazila_centre', geo_source: 'x', phone: null, email: null, officer: null, source_url: null, source_read: null,
});

describe('haversineKm', () => {
  it('is 0 for the same point', () => expect(haversineKm(24.75, 90.4, 24.75, 90.4)).toBe(0));
  it('matches a known distance (Dhaka to Mymensingh, about 100 km)', () => {
    const d = haversineKm(23.8103, 90.4125, 24.7471, 90.4203);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(108);
  });
  it('one degree of latitude is about 111 km', () => expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.2, 0));
  it('is symmetric', () => expect(haversineKm(1, 2, 3, 4)).toBeCloseTo(haversineKm(3, 4, 1, 2), 9));
});

describe('nearest', () => {
  const list = [mk('far', 26, 90), mk('mid', 24.9, 90.4), mk('near', 24.76, 90.41), mk('tie', 24.76, 90.41)];
  it('sorts closest first with km', () => {
    const r = nearest(list, 24.75, 90.4, 3);
    expect(r.map((x) => x.office.id)).toEqual(['near', 'tie', 'mid']);
    expect(r[0]!.km).toBeLessThan(2);
    expect(r[0]!.km).toBeLessThanOrEqual(r[2]!.km);
  });
  it('limits to n and does not change the input', () => {
    const copy = [...list];
    expect(nearest(list, 0, 0, 2)).toHaveLength(2);
    expect(list).toEqual(copy);
  });
});

describe('links', () => {
  it('builds the directions URL', () => expect(directionsUrl(24.7471, 90.4203)).toBe('https://www.google.com/maps/dir/?api=1&destination=24.7471,90.4203'));
  it('builds the OpenStreetMap URL', () => expect(osmUrl(24.7, 90.4)).toBe('https://www.openstreetmap.org/?mlat=24.7&mlon=90.4#map=15/24.7/90.4'));
  it('cleans a phone for tel:', () => {
    expect(telHref('16123')).toBe('tel:16123');
    expect(telHref('+880 9032-56005')).toBe('tel:+880903256005');
  });
});
