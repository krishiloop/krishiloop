/** Class order of ml/vision/artifacts/label_map_union.json (21 classes). Pure data: no model code is loaded by importing this. */
export const PHOTO_LABELS = [
  'bacterial_leaf_blight',
  'bacterial_leaf_streak',
  'bacterial_panicle_blight',
  'bakanae',
  'brown_spot',
  'dead_heart',
  'downy_mildew',
  'false_smut',
  'grassy_stunt_virus',
  'healthy',
  'hispa',
  'leaf_scald',
  'leaf_smut',
  'narrow_brown_spot',
  'neck_blast',
  'ragged_stunt_virus',
  'rice_blast',
  'sheath_blight',
  'sheath_rot',
  'stem_rot',
  'tungro',
] as const;
export type PhotoLabel = (typeof PHOTO_LABELS)[number];

export interface LabelProb {
  label: PhotoLabel;
  prob: number;
}

/** The k most probable classes, most probable first. */
export function topOf(probs: ArrayLike<number>, k = 3): LabelProb[] {
  return Array.from(probs, (p, i) => ({ label: PHOTO_LABELS[i]!, prob: p }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, k);
}

/** "rice_blast" -> "rice blast" (for the middle of a sentence). Model labels are English words and stay English. */
export const labelName = (l: string) => l.replace(/_/g, ' ');
/** "rice_blast" -> "Rice blast" */
export const labelTitle = (l: string) => {
  const s = labelName(l);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
