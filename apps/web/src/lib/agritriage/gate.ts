/**
 * The AgriTriage-Lite gate, ported line by line from the owner's demo (poster/demo/index.html `gate()`); the server runs
 * the same gate in Python (services/vision/agritriage.py) and gate.test.ts checks both against one fixture of logits.
 *
 *   1. energy = -logsumexp(raw logits): the "unknown photo" score;
 *   2. softmax of logits / T (calibrated temperature); crop-known mode zeroes the other crops' classes and renormalises;
 *   3. deterministic APS: walk the classes from most to least likely, adding each while the mass BEFORE it is <= q
 *      (q fitted on PlantWild's cal split for 90% coverage), and stop once the mass passes q;
 *   4. energy above its threshold -> refer (unknown); a set of 1 -> diagnose; 2..3 -> shortlist; more -> refer.
 *
 * Pure: no DOM, no ONNX Runtime. Research weights (trained on PlantWild, non-commercial).
 */

export interface TriageConfig {
  model: string;
  model_mb: number;
  precision: string;
  onnx_test_accuracy: { fp32: number; int8: number };
  arch: string;
  input_size: number;
  resize: number;
  temperature: number;
  energy_threshold: number;
  q_any_crop: number;
  q_crop_known: number;
  alpha: number;
  shortlist_max: number;
  classes: string[];
  crops: string[];
}

export type Action = 'act' | 'shortlist' | 'refer';
export type Outcome = 'diagnose' | 'shortlist' | 'refer';
export type Reason = 'unknown' | 'single' | 'few' | 'many';

export interface GateResult {
  /** probabilities after temperature (and the crop mask), one per class */
  p: number[];
  /** class indices, most likely first */
  order: number[];
  /** the conformal set (class indices) */
  set: number[];
  action: Action;
  outcome: Outcome;
  reason: Reason;
  energy: number;
  /** the threshold that built the set */
  q: number;
}

export const OUTCOME: Record<Action, Outcome> = { act: 'diagnose', shortlist: 'shortlist', refer: 'refer' };

export function gate(logits: ArrayLike<number>, cfg: TriageConfig, crop: string | null = null, qOverride?: number): GateResult {
  const C = logits.length;
  const T = cfg.temperature;
  if (C !== cfg.classes.length) throw new Error('logits do not match the classes');
  if (crop && !cfg.crops.includes(crop)) throw new Error(`the model has no crop "${crop}"`);
  let m = -Infinity;
  for (let i = 0; i < C; i++) m = Math.max(m, logits[i]);
  let z = 0;
  for (let i = 0; i < C; i++) z += Math.exp(logits[i] - m);
  const energy = -(m + Math.log(z));
  let mt = -Infinity;
  for (let i = 0; i < C; i++) mt = Math.max(mt, logits[i] / T);
  let p = Array.from(logits, (v) => Math.exp(v / T - mt));
  if (crop) p = p.map((v, i) => (cfg.crops[i] === crop ? v : 0));
  const s = p.reduce((a, b) => a + b, 0);
  p = p.map((v) => v / s);
  const order = [...Array(C).keys()].sort((a, b) => p[b] - p[a]);
  const q = qOverride ?? (crop ? cfg.q_crop_known : cfg.q_any_crop);
  const set: number[] = [];
  let before = 0;
  for (const i of order) {
    if (before <= q && p[i] > 0) set.push(i);
    before += p[i];
    if (before > q) break;
  }
  let action: Action;
  let reason: Reason;
  if (energy > cfg.energy_threshold) [action, reason] = ['refer', 'unknown'];
  else if (set.length === 1) [action, reason] = ['act', 'single'];
  else if (set.length <= cfg.shortlist_max) [action, reason] = ['shortlist', 'few'];
  else [action, reason] = ['refer', 'many'];
  return { p, order, set, action, outcome: OUTCOME[action], reason, energy, q };
}

/** The classes worth showing: the most likely first, only those the crop allows, at most `n`. */
export function topClasses(r: GateResult, cfg: TriageConfig, n = 5): { label: string; prob: number; inSet: boolean }[] {
  return r.order
    .filter((i) => r.p[i] > 0)
    .slice(0, n)
    .map((i) => ({ label: cfg.classes[i], prob: r.p[i], inSet: r.set.includes(i) }));
}

/** The model's crop names (for the crop chips), from the config. */
export const modelCrops = (cfg: TriageConfig) => [...new Set(cfg.crops)].sort();

/** KrishiLoop field crop -> the model's crop (rules/policy/agritriage-classes.yaml `crops`). */
export const FIELD_TO_MODEL_CROP: Record<string, string> = { rice: 'rice', potato: 'potato' };

/** "rice blast" -> "Rice blast" (disease names stay in English on purpose, as in the demo: unchecked translations mislead). */
export const niceClass = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const WEIGHTS_LABEL_KEY = 'fa.photo.ai.weights' as const;
