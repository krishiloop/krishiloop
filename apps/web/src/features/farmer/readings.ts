import type { Reading } from '../../lib/api/types';

export interface ReadingGroup {
  /** variable name without the [date] suffix */
  variable: string;
  source: string;
  unit?: string;
  derived: boolean;
  /** time series when the variable carries a [date]; a single value otherwise */
  series: { date: string | null; value: number | string | boolean; observed_at: string }[];
  retrieved_at: string;
}

const DATED = /^(.*)\[(\d{4}-\d{2}-\d{2})\]$/;

/** Group a receipt's readings by variable so a week of humidity values reads as one line, not seven. */
export function groupReadings(data: Reading[]): ReadingGroup[] {
  const map = new Map<string, ReadingGroup>();
  for (const r of data) {
    const m = DATED.exec(r.variable);
    const variable = m ? m[1]! : r.variable;
    const key = `${r.source}|${variable}`;
    let g = map.get(key);
    if (!g) {
      g = { variable, source: r.source, unit: r.unit, derived: r.source === 'krishiloop:derived', series: [], retrieved_at: r.retrieved_at };
      map.set(key, g);
    }
    g.series.push({ date: m ? m[2]! : null, value: r.value, observed_at: r.observed_at });
  }
  return [...map.values()];
}

export const numericSeries = (g: ReadingGroup): number[] => g.series.map((s) => (typeof s.value === 'number' ? s.value : NaN)).filter((n) => Number.isFinite(n));
