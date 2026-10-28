import type { ForecastDay } from '../../lib/api/types';

/**
 * Display helpers for the 7-day calendar. These only turn forecast NUMBERS into an icon and a word.
 * They do not rate risk: a risk chip appears only when the planner supplies `risk` (see API_REQUESTS.md).
 */
export type Sky = 'dry' | 'cloudy' | 'drizzle' | 'rain' | 'heavy';

export function skyOf(d: ForecastDay): Sky {
  const mm = d.precip_mm ?? 0;
  if (mm >= 10) return 'heavy';
  if (mm >= 2) return 'rain';
  if (mm >= 0.5) return 'drizzle';
  if ((d.rh_mean_pct ?? 0) >= 85) return 'cloudy';
  return 'dry';
}

/** 0..1 bar height for rain: 12 mm and above fills the bar. */
export const rainFill = (mm: number | undefined) => Math.min(1, (mm ?? 0) / 12);

/** The scene in the 3D field follows the selected day: heavy rain -> rain, otherwise golden morning. */
export const sceneForDay = (d: ForecastDay | undefined): 'sun' | 'rain' => (d && (d.precip_mm ?? 0) >= 5 ? 'rain' : 'sun');
