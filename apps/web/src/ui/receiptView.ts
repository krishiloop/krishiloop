import type { Receipt, Reading } from '../lib/api/types';

/** Human labels for the readings our rules use. Unknown variables fall back to their name with spaces. */
const LABEL: Record<string, string> = {
  relative_humidity_2m_mean: 'Daily humidity',
  precipitation_sum: 'Rain',
  temperature_2m_max: 'Max temperature',
  temperature_2m_min: 'Min temperature',
  temperature_2m_mean: 'Mean temperature',
  forecast_humid_mild_days: 'Humid, mild days ahead',
  forecast_heavy_rain_days: 'Heavy-rain days ahead',
  soil_moisture_0_to_7cm_mean: 'Soil moisture',
  river_discharge: 'River flow',
  bph_females_per_hill: 'Planthopper females per hill',
  bph_nymphs_per_hill: 'Planthopper nymphs per hill',
  question_sha256: 'Question fingerprint',
};

export interface ReadingLine {
  label: string;
  value: string;
  source: string;
  count: number;
  derived: boolean;
  retrieved_at: string;
}

const DATED = /^(.*)\[(\d{4}-\d{2}-\d{2})\]$/;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A week of readings becomes one line ("Daily humidity 78–89 %, 7 readings"), not seven. */
export function readingLines(data: Reading[]): ReadingLine[] {
  const groups = new Map<string, { variable: string; source: string; unit?: string; values: (number | string | boolean)[]; retrieved_at: string }>();
  for (const r of data) {
    const m = DATED.exec(r.variable);
    const variable = m ? m[1]! : r.variable;
    const key = `${r.source}|${variable}`;
    const g = groups.get(key) ?? { variable, source: r.source, unit: r.unit, values: [], retrieved_at: r.retrieved_at };
    g.values.push(r.value);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const nums = g.values.filter((v): v is number => typeof v === 'number');
    let value: string;
    if (g.variable === 'question_sha256') value = `${String(g.values[0]).slice(0, 12)}…`;
    else if (nums.length > 1) {
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      value = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
    } else value = String(nums[0] ?? g.values[0] ?? '');
    const unit = g.unit && !/^(days?|count)$/.test(g.unit) && g.variable !== 'question_sha256' ? ` ${g.unit}` : g.unit === 'days' || g.unit === 'day' ? ' days' : '';
    return {
      label: LABEL[g.variable] ?? g.variable.replace(/_/g, ' '),
      value: `${value}${unit}`,
      source: g.source,
      count: g.values.length,
      derived: g.source === 'krishiloop:derived',
      retrieved_at: g.retrieved_at,
    };
  });
}

/** "open-meteo:forecast" -> "Open-Meteo forecast"; our own derived values say so. */
export function sourceLabel(source: string): string {
  if (source === 'krishiloop:derived') return 'worked out by KrishiLoop';
  if (source.startsWith('open-meteo')) return `Open-Meteo${source.includes(':') ? ` ${source.split(':')[1]}` : ''}`;
  if (source.startsWith('farmer:')) return 'the farmer';
  return source;
}

/** The rule the decision rests on (first ref) as "R-BDR-002 v1". */
export const ruleLabel = (r: Receipt) => (r.rule_refs[0] ? `${r.rule_refs[0].rule_id} v${r.rule_refs[0].version}` : '');
