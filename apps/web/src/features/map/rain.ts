/**
 * Satellite rainfall for Bangladesh districts: NASA GPM IMERG (Late Run, V07, daily, 0.1 degree), added up over the last
 * 7 days by tools/nasa_imerg.py (district = mean of the 0.1 degree cell centres inside its outline). The file is built
 * ahead of time with a NASA Earthdata token (never in the browser) and loads only when the layer or an area panel asks.
 */
export interface RainFile {
  source: string;
  product: string;
  version: string;
  run: string;
  days: string[];
  made: string;
  method: string;
  districts: Record<string, number | null>;
}

const files = import.meta.glob<{ default: RainFile }>('../../data/nasa/imerg_bd.json');
let call: Promise<RainFile | null> | null = null;
/** null when the file has not been built (the layer then says so instead of guessing). */
export const loadRain = (): Promise<RainFile | null> => (call ??= (Object.values(files)[0]?.() ?? Promise.resolve(null)).then((m) => (m ? m.default : null)).catch(() => null));

/** Lower bounds of steps 1..5 of the 7-day total, in mm; step 0 is under 1 mm. Fixed, so a colour means the same in every week. */
export const RAIN_BREAKS = [1, 10, 25, 50, 100] as const;
export function rainStep(mm: number): 0 | 1 | 2 | 3 | 4 | 5 {
  let s = 0;
  for (const b of RAIN_BREAKS) if (mm >= b) s++;
  return s as 0 | 1 | 2 | 3 | 4 | 5;
}
