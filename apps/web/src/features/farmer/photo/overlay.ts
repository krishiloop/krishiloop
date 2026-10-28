/**
 * What the photo view can draw over a leaf photo. The v0 model has one head (disease logits), so it returns none of
 * this. The v1 student (plan/VISION_RESEARCH_PLAN.md: leaf mask, lesion heat-map, attention over lesion crops) fills
 * these slots and PhotoCanvas shows them with no UI change.
 *
 * Coordinates are in the space the model reads: its 224x224 input crop (the centre of the photo's short side).
 * PhotoCanvas maps that crop onto the photo, so a box at x=0, y=0 is the top-left corner of what the model saw.
 */
export interface Plane {
  /** the plane is size x size values, row-major, covering the model's input crop */
  size: number;
  /** 0..255 */
  data: ArrayLike<number>;
}

export interface Lesion {
  /** fractions (0..1) of the model's input crop */
  x: number;
  y: number;
  w: number;
  h: number;
  /** how sure the model is that this is a lesion, 0..1 */
  score: number;
}

export interface PhotoOverlay {
  /** leaf = 255, background = 0. Drawn as a veil over everything that is not leaf. */
  mask?: Plane;
  /** attention / class-activation map, 0..255. Drawn as a gold glow. */
  heat?: Plane;
  lesions?: Lesion[];
  /** true for the sample engine's overlays: drawn with a "Sample overlay" badge, never a model output */
  sample?: boolean;
}

export type OverlayLayer = 'mask' | 'lesions' | 'heat';

export function availableLayers(o?: PhotoOverlay | null): OverlayLayer[] {
  if (!o) return [];
  const out: OverlayLayer[] = [];
  if (o.mask) out.push('mask');
  if (o.lesions?.length) out.push('lesions');
  if (o.heat) out.push('heat');
  return out;
}
