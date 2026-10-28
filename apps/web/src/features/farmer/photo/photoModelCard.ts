/**
 * The photo model's spec sheet, kept as DATA.
 *
 * The diagnosis receipt (DiagnosisReceipt.tsx) prints whatever is in here, so when the v1 student ships (leaf mask,
 * lesion heat-map, concept and disease heads; plan/VISION_RESEARCH_PLAN.md) the numbers change in this one file and
 * nothing in the UI does. Nothing in the UI hard-codes a disclaimer: what a farmer should make of a number is shown by
 * the number itself, next to the dataset it was measured on.
 *
 * Every figure below comes from ml/vision/artifacts/experiments.json (MODEL_CARD.md results table), macro-F1.
 * `score: null` means "not measured yet": it is printed as "Not tested yet", never as a guess.
 */
export interface TestedOn {
  id: string;
  /** what the model was tested on, in plain words */
  dataset: string;
  metric: 'macro-F1';
  /** null = not measured yet */
  score: number | null;
  /** photos in the test set */
  n?: number;
}

export interface PhotoModelCard {
  /** becomes Diagnosis.model.name and .version, and the reading source `on-device-model:<name>@<version>` */
  name: string;
  version: string;
  /** shown under the name, for people who want to know what it is */
  family: string;
  precision: string;
  sizeBytes: number;
  /** SHA-256 of the file we ship. The phone hashes what it downloaded and says whether the two agree. */
  sha256: string;
  /** crops this model may be used on */
  crops: readonly string[];
  /** has temperature scaling / ECE been done? Printed as a fact in the receipt. */
  calibrated: boolean;
  temperature?: number;
  testedOn: readonly TestedOn[];
}

/** Confidence at or above which a reading becomes a fact for the planner. PROVISIONAL until calibration is done. */
export const DEFAULT_THRESHOLD = 0.6;

/** Override per build: VITE_PHOTO_THRESHOLD=0.7 (a number strictly between 0 and 1). */
function configuredThreshold(): number {
  const raw = Number(import.meta.env.VITE_PHOTO_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : DEFAULT_THRESHOLD;
}
export const PHOTO_THRESHOLD = configuredThreshold();

export const PHOTO_MODEL_CARD: PhotoModelCard = {
  name: 'rice-leaf-mnv4s',
  version: 'union-v0',
  family: 'MobileNetV4-small',
  precision: 'fp16 weights',
  sizeBytes: 5_275_837,
  sha256: 'd163c0a2aa56f15fa58ae6c1cabe0ecdff77221d43039f32c178bc3076f11b50',
  crops: ['rice'],
  calibrated: false,
  // The number that predicts a new farmer's phone comes first (review_ml C3). The same-source rows are likely
  // optimistic: rotated/flipped near-copies can sit on both sides of that split (MODEL_CARD.md, v0 section).
  testedOn: [
    { id: 'cross-dataset', dataset: 'A dataset it never trained on (7 shared diseases)', metric: 'macro-F1', score: 0.185, n: 7620 },
    { id: 'bd-field', dataset: 'Bangladeshi field photos (Dhan-Shomadhan)', metric: 'macro-F1', score: null },
    { id: 'union-heldout', dataset: 'Held-out photos from the same datasets it trained on (likely optimistic)', metric: 'macro-F1', score: 0.952, n: 7299 },
    { id: 'paddy-heldout', dataset: 'Held-out Paddy Doctor photos, a dataset it trained on (likely optimistic)', metric: 'macro-F1', score: 0.902, n: 2040 },
  ],
};

/** `on-device-model:<name>@<version>`: how a receipt names the model that produced a reading. */
export const diagnosisSource = (c: PhotoModelCard = PHOTO_MODEL_CARD) => `on-device-model:${c.name}@${c.version}`;
