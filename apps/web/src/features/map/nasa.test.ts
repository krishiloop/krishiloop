import { describe, expect, it } from 'vitest';
import { gibsDate, gibsImageUrl, GIBS } from '../../lib/nasa/gibs';
import { areaBounds, mean, shapePower } from './nasa';

describe('NASA POWER shaping', () => {
  const par = {
    T2M_MAX: { '20261110': 30, '20261111': 31, '20261112': -999 },
    T2M_MIN: { '20261110': 18, '20261111': -999, '20261112': -999 },
    RH2M: { '20261110': 60, '20261111': 62, '20261112': -999 },
    ALLSKY_SFC_SW_DWN: { '20261110': 15, '20261111': -999, '20261112': -999 },
  };
  const s = shapePower({ properties: { parameter: par } }, 23, 90);
  it('drops the newest all-missing day and turns -999 into null, never a number', () => {
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11']);
    expect(s.days[1]).toMatchObject({ tmax: 31, tmin: null, sun: null, rh: 62 });
    expect(JSON.stringify(s)).not.toContain('-999');
  });
  it('averages only real values', () => {
    expect(mean([30, null, 32])).toBe(31);
    expect(mean([null])).toBeNull();
  });
});

describe('GIBS helpers', () => {
  it('uses a day two days back (UTC)', () => expect(gibsDate(new Date('2026-11-20T10:00:00Z'))).toBe('2026-11-18'));
  it('builds a WMS box in lon,lat order with the date', () => {
    const u = gibsImageUrl(GIBS.ndvi, '2026-11-18', [89, 23, 90, 24], 480, 480);
    expect(u).toContain('LAYERS=MODIS_Terra_NDVI_8Day');
    expect(u).toContain('BBOX=89.0000,23.0000,90.0000,24.0000');
    expect(u).toContain('TIME=2026-11-18');
  });
  it('finds the box of an outline path', () => {
    const geo = { projection: { lon_min: 88, lat_max: 26, k: 1, scale: 100 } };
    const [w, s, e, n] = areaBounds(geo, { d: 'M0 0l100 0l0 100l-100 0z' });
    expect([w, s, e, n]).toEqual([88, 25, 89, 26]);
  });
});
