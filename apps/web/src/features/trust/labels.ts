import type { Key } from '../../lib/i18n';
import { humanize } from '../../lib/format';

/**
 * The labels the server's photo model chooses between (the `core` list of the replay data: ml/vision/artifacts/meta.json).
 * Pure data. The server stays the source of truth: a label this list does not know is shown humanised, never dropped.
 */
export const AREA_LABELS = ['healthy', 'blast', 'brown_spot', 'tungro', 'sheath_blight'] as const;
export type AreaLabel = (typeof AREA_LABELS)[number];

const KEY: Record<AreaLabel, Key> = {
  healthy: 'trust.label.healthy',
  blast: 'trust.label.blast',
  brown_spot: 'trust.label.brown_spot',
  tungro: 'trust.label.tungro',
  sheath_blight: 'trust.label.sheath_blight',
};

export const isAreaLabel = (l: string): l is AreaLabel => (AREA_LABELS as readonly string[]).includes(l);

/** The display name of a label in the UI language (the Bangla names are machine-written, see bn.trust.ts). */
export function areaLabelName(label: string, t: (k: Key) => string): string {
  return isAreaLabel(label) ? t(KEY[label]) : humanize(label);
}

/** Crops the server's photo model reads. Everything else keeps the on-device flow. */
export const SERVER_PHOTO_CROPS: readonly string[] = ['rice'];

/** The area a field's photos belong to: crop and place, never global (mirrors services/engine/planner.py trust_area). */
export function areaOf(field: { crop: string; country: string; area_code?: string }): string {
  return `${field.crop}@${field.area_code || field.country}`;
}

/** The photo demo: rice at tillering (BD-SAMPLE-02) with farmer profile D, where a trusted blast photo adds rule R-BDR-012. */
export const PHOTO_DEMO = { field: 'BD-SAMPLE-02', profile: 'demo-farmer-d', area: 'rice@BD' } as const;
