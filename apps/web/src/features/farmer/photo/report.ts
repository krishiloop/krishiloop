/**
 * The photo diagnosis, as the UI needs it. One shape for every crop and every engine.
 *
 * Today two engines fill it (engines.ts): the real on-device rice model (v0: a differential, nothing else) and a
 * clearly labelled SAMPLE engine that scripts the full result for the crops we have sample packs for. The KrishiLens
 * student + crop packs (plan/VISION_RESEARCH_PLAN.md: M1 mask, M3 lesions + severity, M4 symptom concepts,
 * M5 cited diagnosis, M6 next view) will produce all of it for real, and nothing in the UI changes:
 *
 *   differential   conformal set / calibrated probabilities over the crop pack's diseases (+ the rest as "Other")
 *   severity       % of the plant part affected (lesion area / tissue area), with a range
 *   lesions, mask  PhotoOverlay: boxes and a leaf mask in the model's input-crop space
 *   symptoms       universal symptom concepts, each with the manual quote + page it comes from
 *   nextView       the one most informative extra photo, with a one-line reason
 */
import type { I18nText } from '../../../lib/api/types';
import type { TestedOn } from './photoModelCard';

/**
 * confident  the top disease reached the threshold: the diagnosis feeds the planner
 * ambiguous  not sure yet, and one more photo can help: the engine names which one (nextView)
 * unsure     not sure, and nothing more to ask: the case goes to the officer
 */
export type Verdict = 'confident' | 'ambiguous' | 'unsure';

export interface DiffRow {
  /** a disease id from the crop pack, or a model class name. "other" = all the probability not listed. */
  id: string;
  name: I18nText;
  prob: number;
}
export const OTHER = 'other';

export interface Citation {
  doc_id: string;
  title: string;
  publisher: string;
  page: number | string;
  quote: string;
  url?: string;
  /** true until the Knowledge Compiler supplies the real quote and page. Always labelled "Sample" on screen. */
  sample?: boolean;
}

export interface Symptom {
  /** universal symptom concept (plan/VISION_RESEARCH_PLAN.md M4), e.g. "water_soaked_tissue" */
  concept: string;
  label: I18nText;
  /** seen in the photo(s); false = the signature expects it and it has not been seen (yet) */
  seen: boolean;
  /** 0..1 */
  strength?: number;
  /** disease ids whose signature includes this symptom */
  pointsTo?: string[];
  cite?: Citation;
}

/** % of the plant part's area that is affected. `lo`/`hi` bound the estimate. */
export interface Severity {
  pct: number;
  lo?: number;
  hi?: number;
}

export type ViewArt = 'underside' | 'close_up' | 'another_leaf';

/** The one extra photo that would help most. Text comes from the pack (I18nText) or, for generic views, from the i18n keys photo.view.<id>.*. */
export interface ViewRequest {
  id: string;
  art: ViewArt;
  title?: I18nText;
  reason?: I18nText;
  /** disease ids this view helps tell apart: their rows are marked while the request is open */
  separates?: string[];
}

export interface EngineInfo {
  id: string;
  kind: 'on-device' | 'sample';
  /** not a real model's output: everything it produces is labelled "Sample" */
  sample: boolean;
  name: string;
  version: string;
  family?: string;
  precision?: string;
  sizeBytes?: number;
  /** SHA-256 of the model file the app ships (the phone hashes what it downloaded and compares) */
  sha256?: string;
  calibrated: boolean;
  /** top disease at or above this => confident */
  threshold: number;
  testedOn: readonly TestedOn[];
}

export interface Report {
  id: string;
  crop: string;
  engine: EngineInfo;
  photos: number;
  /** most likely first; "other" (when present) is always last */
  differential: DiffRow[];
  verdict: Verdict;
  threshold: number;
  severity: Severity | null;
  symptoms: Symptom[];
  nextView: ViewRequest | null;
  /** several photos: do they all point at the same disease? */
  agree?: boolean;
  /** model time summed over the photos, ms (0 = not measured, e.g. a sample) */
  ms: number;
  prepMs: number;
  createdAt: string;
}

export const MAX_PHOTOS = 3;

export const topDisease = (r: Report): DiffRow | undefined => r.differential.find((d) => d.id !== OTHER);

/** Rows sorted by probability with "Other" last, probabilities rounded so they read cleanly. */
export function sortDifferential(rows: DiffRow[]): DiffRow[] {
  const other = rows.find((r) => r.id === OTHER);
  const rest = rows.filter((r) => r.id !== OTHER).sort((a, b) => b.prob - a.prob);
  return other ? [...rest, other] : rest;
}

/** The first non-"other" rows, for the Diagnosis contract (the schema allows three labels). */
export const topLabels = (r: Report, n = 3) => r.differential.filter((d) => d.id !== OTHER).slice(0, n);

export const newReportId = () => `dx-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
