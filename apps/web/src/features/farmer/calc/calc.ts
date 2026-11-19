/**
 * "What skipping an unneeded spray saves": arithmetic on the farmer's own numbers, never ours. No dose, no price, no
 * yield claim: field size × the farmer's cost of one spray (product + labour, per unit of land) × sprays skipped.
 *
 * Units (definitions, not estimates):
 *  - decimal = 1/100 acre (the Bangladesh "shotangsho");
 *  - acre = 4046.8564224 m² (the international acre), hectare = 10 000 m², so 1 ha = 247.105… decimals;
 *  - bigha = an editable number of decimals: 33 by default, labelled as varying by region.
 */
export type Unit = 'decimal' | 'bigha' | 'acre' | 'hectare';
export const UNITS: Unit[] = ['decimal', 'bigha', 'acre', 'hectare'];
export const ACRE_M2 = 4046.8564224;
export const HECTARE_M2 = 10_000;
export const DECIMALS_PER_ACRE = 100;
export const DEFAULT_DECIMALS_PER_BIGHA = 33;
/** Sanity bounds: beyond these a typo is far likelier than a real field or cost. */
export const LIMITS = { size: 100_000, cost: 10_000_000, sprays: 100, dpb: 1_000 };

/** How many decimals one unit holds. */
export function decimalsPer(unit: Unit, decimalsPerBigha = DEFAULT_DECIMALS_PER_BIGHA): number {
  switch (unit) {
    case 'decimal':
      return 1;
    case 'acre':
      return DECIMALS_PER_ACRE;
    case 'hectare':
      return (HECTARE_M2 / ACRE_M2) * DECIMALS_PER_ACRE;
    case 'bigha':
      return decimalsPerBigha;
  }
}

/** The same piece of land in another unit. */
export function convertSize(size: number, from: Unit, to: Unit, decimalsPerBigha = DEFAULT_DECIMALS_PER_BIGHA): number {
  return (size * decimalsPer(from, decimalsPerBigha)) / decimalsPer(to, decimalsPerBigha);
}

/** A cost per unit of land in another unit (Tk per bigha -> Tk per acre is ×(decimals per acre / decimals per bigha)). */
export function convertCostPerUnit(cost: number, from: Unit, to: Unit, decimalsPerBigha = DEFAULT_DECIMALS_PER_BIGHA): number {
  return (cost * decimalsPer(to, decimalsPerBigha)) / decimalsPer(from, decimalsPerBigha);
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * What a farmer typed, as a number: Bangla or Latin digits, thousands commas, one decimal point. Empty is 0.
 * Anything else (letters, a minus sign, two points) is null, so the screen can say "type a number".
 */
export function parseNum(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/[,\s]/g, '');
  if (s === '') return 0;
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface CalcInput {
  size: number;
  unit: Unit;
  decimalsPerBigha: number;
  /** the farmer's cost of one spray on ONE unit of land (the unit above), in Taka */
  productPerUnit: number;
  labourPerUnit: number;
  sprays: number;
}

export interface CalcResult {
  ok: boolean;
  /** one spray on the whole field, Tk */
  perSpray: number;
  /** all the sprays skipped, Tk (rounded to whole Taka for display by the caller) */
  total: number;
  /** the field in decimals (the canonical unit) */
  decimals: number;
}

export function validInput(i: CalcInput): boolean {
  const inRange = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max;
  return (
    inRange(i.size, LIMITS.size) &&
    inRange(i.productPerUnit, LIMITS.cost) &&
    inRange(i.labourPerUnit, LIMITS.cost) &&
    inRange(i.sprays, LIMITS.sprays) &&
    Number.isInteger(i.sprays) &&
    (i.unit !== 'bigha' || (i.decimalsPerBigha > 0 && i.decimalsPerBigha <= LIMITS.dpb))
  );
}

/** Taka saved: size (in the chosen unit) × cost of one spray per that unit × sprays skipped. The unit cancels out. */
export function savings(i: CalcInput): CalcResult {
  if (!validInput(i)) return { ok: false, perSpray: 0, total: 0, decimals: 0 };
  const perSpray = i.size * (i.productPerUnit + i.labourPerUnit);
  return { ok: true, perSpray, total: perSpray * i.sprays, decimals: i.size * decimalsPer(i.unit, i.decimalsPerBigha) };
}

/** Switch the unit and keep the same field and the same money: size and per-unit costs are converted together. */
export function switchUnit(i: CalcInput, to: Unit): CalcInput {
  const d = i.decimalsPerBigha;
  return {
    ...i,
    unit: to,
    size: convertSize(i.size, i.unit, to, d),
    productPerUnit: convertCostPerUnit(i.productPerUnit, i.unit, to, d),
    labourPerUnit: convertCostPerUnit(i.labourPerUnit, i.unit, to, d),
  };
}

/** A number for an input box after a unit switch: at most 3 decimals for land, 2 for money, no trailing zeros. */
export function tidy(n: number, places: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toFixed(places)));
}
