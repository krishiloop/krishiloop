import type { Key } from '../../../lib/i18n';

/**
 * The hero's scroll story (builder H): six pictures the leaves make, each with one plain line. This file is tiny and
 * ships with the first screen; the leaf field that draws the pictures (field.ts, shapes.ts) is its own lazy chunk.
 */
export const STORY: { name: Key; line: Key }[] = [
  { name: 'home.story.s1', line: 'home.story.s1.line' }, // the field: a rice plant swaying
  { name: 'home.story.s2', line: 'home.story.s2.line' }, // one leaf with a lesion, read by the crop doctor
  { name: 'home.story.s3', line: 'home.story.s3.line' }, // a rain cloud, drops and a bolt: the weather warning
  { name: 'home.story.s4', line: 'home.story.s4.line' }, // Bangladesh with hot spots: the village disease map
  { name: 'home.story.s5', line: 'home.story.s5.line' }, // a receipt with a stamp and a tick
  { name: 'home.story.s6', line: 'home.story.s6.line' }, // the KrishiLoop loop
];

export const STEPS = STORY.length;

/**
 * Scroll progress (0 to STEPS-1) to story state: each picture holds still for the first part of its stretch of scroll
 * and morphs into the next only in the second part, so a reader who stops scrolling always sees a whole picture.
 */
export function holdMap(p: number): number {
  if (!(p > 0)) return 0;
  const i = Math.floor(p);
  if (i >= STEPS - 1) return STEPS - 1;
  const s = Math.min(1, Math.max(0, (p - i - 0.3) / 0.55));
  return i + s * s * (3 - 2 * s);
}
