import { describe, expect, it } from 'vitest';
import { convertCostPerUnit, convertSize, decimalsPer, parseNum, savings, switchUnit, tidy, validInput, type CalcInput } from './calc';

const base: CalcInput = { size: 1, unit: 'bigha', decimalsPerBigha: 33, productPerUnit: 600, labourPerUnit: 300, sprays: 3 };

describe('units', () => {
  it('a decimal is 1/100 acre and a hectare is 10 000 m² over the international acre', () => {
    expect(decimalsPer('decimal')).toBe(1);
    expect(decimalsPer('acre')).toBe(100);
    expect(decimalsPer('hectare')).toBeCloseTo(247.105381, 5);
    expect(convertSize(1, 'hectare', 'acre')).toBeCloseTo(2.4710538, 6);
    expect(convertSize(1, 'acre', 'hectare')).toBeCloseTo(0.40468564, 7);
  });

  it('a bigha is whatever the farmer says, 33 decimals by default', () => {
    expect(decimalsPer('bigha')).toBe(33);
    expect(convertSize(3, 'bigha', 'decimal')).toBe(99);
    expect(convertSize(1, 'bigha', 'decimal', 20)).toBe(20);
    expect(convertSize(100, 'decimal', 'bigha', 20)).toBe(5);
  });

  it('costs per unit convert the other way round', () => {
    // Tk 900 per bigha of 33 decimals is Tk 900 × 100 / 33 per acre
    expect(convertCostPerUnit(900, 'bigha', 'acre')).toBeCloseTo((900 * 100) / 33, 9);
    expect(convertCostPerUnit(100, 'acre', 'decimal')).toBe(1);
  });

  it('a round trip comes back to the same number', () => {
    for (const u of ['decimal', 'bigha', 'acre', 'hectare'] as const) {
      expect(convertSize(convertSize(7.5, 'bigha', u), u, 'bigha')).toBeCloseTo(7.5, 10);
    }
  });
});

describe('savings', () => {
  it('is size × (product + labour) per unit × sprays skipped', () => {
    const r = savings(base);
    expect(r.ok).toBe(true);
    expect(r.perSpray).toBe(900);
    expect(r.total).toBe(2700);
    expect(r.decimals).toBe(33);
  });

  it('does not change when the unit is switched (same field, same money)', () => {
    const before = savings({ ...base, size: 2.5 }).total;
    for (const u of ['decimal', 'acre', 'hectare', 'bigha'] as const) {
      const after = savings(switchUnit({ ...base, size: 2.5 }, u));
      expect(after.total).toBeCloseTo(before, 6);
      expect(after.decimals).toBeCloseTo(82.5, 9);
    }
  });

  it('a different bigha size changes the land, not the arithmetic on what was typed', () => {
    expect(savings({ ...base, decimalsPerBigha: 20 }).total).toBe(2700);
    expect(savings({ ...base, decimalsPerBigha: 20 }).decimals).toBe(20);
  });

  it('zero sprays skipped saves nothing', () => {
    expect(savings({ ...base, sprays: 0 }).total).toBe(0);
  });

  it('refuses negatives, fractions of a spray, a zero bigha and absurd sizes', () => {
    expect(validInput({ ...base, size: -1 })).toBe(false);
    expect(validInput({ ...base, sprays: 1.5 })).toBe(false);
    expect(validInput({ ...base, decimalsPerBigha: 0 })).toBe(false);
    expect(validInput({ ...base, unit: 'acre', decimalsPerBigha: 0 })).toBe(true); // the bigha size only matters for bigha
    expect(validInput({ ...base, size: 1e9 })).toBe(false);
    expect(savings({ ...base, productPerUnit: Number.NaN }).ok).toBe(false);
  });
});

describe('typing', () => {
  it('reads Latin and Bangla digits, commas and one decimal point', () => {
    expect(parseNum('1,250')).toBe(1250);
    expect(parseNum('১২৫০')).toBe(1250);
    expect(parseNum('২.৫')).toBe(2.5);
    expect(parseNum(' 33 ')).toBe(33);
    expect(parseNum('')).toBe(0);
    expect(parseNum('.5')).toBe(0.5);
  });

  it('says null for anything that is not a plain number', () => {
    for (const s of ['-3', '1.2.3', 'abc', '3kg', '.', '1e5']) expect(parseNum(s)).toBeNull();
  });

  it('tidies converted numbers for the input boxes', () => {
    expect(tidy(0.33000000001, 3)).toBe('0.33');
    expect(tidy(2727.2727, 2)).toBe('2727.27');
    expect(tidy(Number.NaN, 2)).toBe('');
  });
});
