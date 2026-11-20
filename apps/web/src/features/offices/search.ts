/** "Search an upazila or district": matches office places in Bangla and English. Pure functions, no network. */
import { districtOf } from './districts';
import { haversineKm, type Office } from './nearest';

/**
 * One spelling for comparing: Unicode NFC (so a Bangla letter typed as base + nukta matches the single code point),
 * lower case, no zero-width joiners, no apostrophes, and any other punctuation turned into one space.
 */
export function norm(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‌‍'’`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}
const squash = (s: string) => s.replace(/ /g, '');

export interface Hit {
  office: Office;
  /** km from the farmer, when we know where the farmer is */
  km: number | null;
  score: number;
}

/** How well one name matches the query: whole name, start of the name, start of a word, anywhere. 0 for no match. */
function nameScore(name: string | null | undefined, q: string, qs: string): number {
  if (!name) return 0;
  const n = norm(name);
  const ns = squash(n);
  if (ns === qs) return 4;
  if (ns.startsWith(qs)) return 3;
  if (n.split(' ').some((w) => w.startsWith(q))) return 2;
  if (ns.includes(qs)) return 1;
  return 0;
}

/**
 * Offices whose upazila or district matches `query` (Bangla or English, other spellings of a district too).
 * An upazila match ranks above a district match; within the same strength the nearest comes first when `from` is
 * known, otherwise the listed order. Fewer than 2 letters finds nothing (one Bangla letter matches half the country).
 */
export function searchOffices(offices: readonly Office[], query: string, from?: { lat: number; lon: number } | null, limit = 30): Hit[] {
  const q = norm(query);
  const qs = squash(q);
  if ([...qs].length < 2) return [];
  const hits: (Hit & { i: number })[] = [];
  offices.forEach((office, i) => {
    const d = districtOf(office.district_en);
    const up = Math.max(nameScore(office.upazila_en, q, qs), nameScore(office.upazila_bn, q, qs));
    const dist = Math.max(nameScore(office.district_en, q, qs), nameScore(d?.bn, q, qs), ...(d?.alt ?? []).map((a) => nameScore(a, q, qs)));
    // an upazila match outranks a district match of the same strength; matching both ("Mymensingh Sadar" for
    // "Mymensingh") edges ahead of the district's other offices
    const score = Math.max(up * 2, dist * 2 - 1) + (up > 0 && dist > 0 ? 0.5 : 0);
    if (score <= 0) return;
    hits.push({ office, km: from ? haversineKm(from.lat, from.lon, office.lat, office.lon) : null, score, i });
  });
  hits.sort((a, b) => b.score - a.score || (a.km ?? 0) - (b.km ?? 0) || a.i - b.i);
  return hits.slice(0, limit).map(({ office, km, score }) => ({ office, km, score }));
}
