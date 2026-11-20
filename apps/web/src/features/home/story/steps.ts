import type { Key } from '../../../lib/i18n';

/** A picture's pastel (index.css, the painter's palette): its wash behind the hero and the glow on its subject. */
export type Tone = 'butter' | 'lotus' | 'monsoon' | 'hyacinth' | 'moss' | 'terracotta';

/**
 * The hero's story (builder H v4; v5 builder Ho: it plays by itself): six pictures the leaves make, each with one plain
 * line and its own pastel. This file is tiny and ships with the first screen; the leaf field that draws the pictures
 * (field.ts, shapes.ts) is its own lazy chunk.
 */
export const STORY: { name: Key; line: Key; tone: Tone }[] = [
  { name: 'home.story.s1', line: 'home.story.s1.line', tone: 'butter' }, // the field: a rice plant swaying
  { name: 'home.story.s7', line: 'home.story.s7.line', tone: 'moss' }, // a potato plant (v6: plants the photo AI knows)
  { name: 'home.story.s8', line: 'home.story.s8.line', tone: 'terracotta' }, // a tomato plant
  { name: 'home.story.s2', line: 'home.story.s2.line', tone: 'lotus' }, // one leaf with a lesion, read by the crop doctor
  { name: 'home.story.s9', line: 'home.story.s9.line', tone: 'terracotta' }, // not sure: a pin on the nearest Krishi office
  { name: 'home.story.s3', line: 'home.story.s3.line', tone: 'monsoon' }, // a rain cloud, drops and a bolt: the weather warning
  { name: 'home.story.s4', line: 'home.story.s4.line', tone: 'hyacinth' }, // Bangladesh with hot spots: the disease map
  { name: 'home.story.s5', line: 'home.story.s5.line', tone: 'moss' }, // a receipt with a stamp and a tick
  { name: 'home.story.s6', line: 'home.story.s6.line', tone: 'terracotta' }, // the KrishiLoop loop
];

export const STEPS = STORY.length;

/** How long each picture stays before the next one comes (ms). The leaves' flight takes the first 2.2 s of it. */
export const STEP_MS = 3800;
