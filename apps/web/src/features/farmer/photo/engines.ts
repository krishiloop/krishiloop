/**
 * Diagnosis engines: whatever turns photos into a Report. The UI knows only this interface, so the crop comes from
 * the field profile and the engine can change underneath it:
 *
 *   onDeviceV0    the real on-device rice model (MobileNetV4-small, 21 classes). It gives a differential and nothing
 *                 else: no severity, lesions, symptoms. When it is not sure it asks for another leaf, and several
 *                 photos are combined by the mean of their softmax.
 *   sampleEngine  SCRIPTED sample results for the crops that have a sample pack. It does not look at the photo. It
 *                 exists so the complete result (severity, lesion boxes, symptoms with citations, a targeted next
 *                 photo) can be designed and shown before the real model exists. Labelled "Sample" everywhere.
 *   (next)        the KrishiLens student + crop packs: all crops, everything real. It plugs in here.
 */
import { classify, isModelLoaded, loadModel, type LoadProgress } from './photoModel';
import { PHOTO_MODEL_CARD, PHOTO_THRESHOLD } from './photoModelCard';
import { labelTitle, topOf } from './labels';
import type { PhotoOverlay } from './overlay';
import { MAX_PHOTOS, OTHER, newReportId, sortDifferential, type DiffRow, type EngineInfo, type Report, type Symptom, type Verdict } from './report';
import { SAMPLE_PACKS, type SampleScenarioId } from './samplePacks';
import { sampleOverlay, type SampleArt } from './sampleArt';
import { motionReduced } from '../../../lib/motionPref';

/** What an engine made of one photo. */
export interface ShotRead {
  /** all class probabilities (the real model only) */
  probs?: number[];
  ms: number;
  prepMs: number;
  overlay?: PhotoOverlay;
  /** the sample picture this step shows (the sample engine only) */
  art?: SampleArt;
}

export interface ReadCtx {
  crop: string;
  /** 0 for the first photo */
  index: number;
  scenario: SampleScenarioId;
}
export interface CombineCtx {
  crop: string;
  scenario: SampleScenarioId;
}

export interface Engine {
  info: EngineInfo;
  supports(crop: string): boolean;
  /** must fetch a model before the first photo (the farmer is asked first) */
  needsDownload: boolean;
  isReady(): boolean;
  prepare(onProgress?: (p: LoadProgress) => void): Promise<void>;
  read(file: Blob | null, ctx: ReadCtx): Promise<ShotRead>;
  combine(reads: readonly ShotRead[], ctx: CombineCtx): Report;
}

export const DEFAULT_SCENARIO: SampleScenarioId = 'needs_view';

/* ------------------------------------------------------------------ helpers */
export function meanProbs(list: readonly (readonly number[])[]): number[] {
  const n = list[0]?.length ?? 0;
  const out = new Array<number>(n).fill(0);
  for (const p of list) for (let i = 0; i < n; i++) out[i]! += p[i] ?? 0;
  return out.map((v) => v / Math.max(1, list.length));
}
const argmax = (p: readonly number[]) => p.reduce((best, v, i) => (v > p[best]! ? i : best), 0);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withOther(named: DiffRow[]): DiffRow[] {
  const rest = 1 - sum(named.map((r) => r.prob));
  return sortDifferential(rest >= 0.01 ? [...named, { id: OTHER, name: { en: 'Other' }, prob: rest }] : named);
}

/* ------------------------------------------------------------------ the real on-device model (rice, v0) */
const V0_INFO: EngineInfo = {
  id: PHOTO_MODEL_CARD.name,
  kind: 'on-device',
  sample: false,
  name: PHOTO_MODEL_CARD.name,
  version: PHOTO_MODEL_CARD.version,
  family: PHOTO_MODEL_CARD.family,
  precision: PHOTO_MODEL_CARD.precision,
  sizeBytes: PHOTO_MODEL_CARD.sizeBytes,
  sha256: PHOTO_MODEL_CARD.sha256,
  calibrated: PHOTO_MODEL_CARD.calibrated,
  threshold: PHOTO_THRESHOLD,
  testedOn: PHOTO_MODEL_CARD.testedOn,
};

/**
 * DEV and tests only (the bundler removes it from production builds): `window.__klPhotoStub = { probs: number[] }` makes the
 * on-device engine answer with those probabilities and skip the 20 MB model, so the flow around it can be tested exactly.
 */
const stub = () => (import.meta.env.DEV ? (globalThis as { __klPhotoStub?: { probs: number[] } }).__klPhotoStub : undefined);

export const onDeviceV0: Engine = {
  info: V0_INFO,
  supports: (crop) => PHOTO_MODEL_CARD.crops.includes(crop),
  needsDownload: true,
  isReady: () => !!stub() || isModelLoaded(),
  prepare: (onProgress) => (stub() ? Promise.resolve() : loadModel(onProgress)),
  async read(file) {
    const fake = stub();
    if (fake) return { probs: fake.probs, ms: 5, prepMs: 1 };
    if (!file) throw new Error('the on-device model needs a photo');
    const r = await classify(file);
    return { probs: r.probs, ms: r.ms, prepMs: r.prepMs, overlay: r.overlay };
  },
  combine(reads, ctx) {
    const probs = meanProbs(reads.map((r) => r.probs ?? []));
    const top = topOf(probs, 3);
    const differential = withOther(top.map((l) => ({ id: l.label, name: { en: labelTitle(l.label) }, prob: l.prob })));
    const confident = top[0]!.prob >= V0_INFO.threshold;
    const verdict: Verdict = confident ? 'confident' : reads.length < MAX_PHOTOS ? 'ambiguous' : 'unsure';
    const first = argmax(reads[0]?.probs ?? []);
    return {
      id: newReportId(),
      crop: ctx.crop,
      engine: V0_INFO,
      photos: reads.length,
      differential,
      verdict,
      threshold: V0_INFO.threshold,
      severity: null,
      symptoms: [],
      nextView: verdict === 'ambiguous' ? { id: 'another_leaf', art: 'another_leaf' } : null,
      agree: reads.every((r) => argmax(r.probs ?? []) === first),
      ms: sum(reads.map((r) => r.ms)),
      prepMs: sum(reads.map((r) => r.prepMs)),
      createdAt: new Date().toISOString(),
    };
  },
};

/* ------------------------------------------------------------------ the sample engine (scripted, any crop with a sample pack) */
const SAMPLE_INFO: EngineInfo = {
  id: 'sample',
  kind: 'sample',
  sample: true,
  name: 'sample-engine',
  version: 'scripted',
  calibrated: false,
  threshold: PHOTO_THRESHOLD,
  testedOn: [],
};

export const sampleEngine: Engine = {
  info: SAMPLE_INFO,
  supports: (crop) => crop in SAMPLE_PACKS,
  needsDownload: false,
  isReady: () => true,
  prepare: async () => undefined,
  async read(_file, ctx) {
    const pack = SAMPLE_PACKS[ctx.crop];
    if (!pack) throw new Error(`no sample pack for ${ctx.crop}`);
    const steps = pack.scenarios[ctx.scenario];
    const art = steps[Math.min(ctx.index, steps.length - 1)]!.art;
    // a short, honest pause: the scan animation needs something to scan
    await delay(motionReduced() ? 120 : 950);
    return { ms: 0, prepMs: 0, art, overlay: sampleOverlay(ctx.crop, art) };
  },
  combine(reads, ctx) {
    const pack = SAMPLE_PACKS[ctx.crop];
    if (!pack) throw new Error(`no sample pack for ${ctx.crop}`);
    const steps = pack.scenarios[ctx.scenario];
    const step = steps[Math.min(reads.length, steps.length) - 1]!;
    const differential = withOther(step.differential.map(([id, prob]) => ({ id, name: pack.diseases[id] ?? { en: id }, prob })));
    const confident = differential[0]!.prob >= SAMPLE_INFO.threshold;
    const verdict: Verdict = confident ? 'confident' : step.view ? 'ambiguous' : 'unsure';
    const symptom = (concept: string, seen: boolean, strength?: number): Symptom | null => {
      const def = pack.symptoms[concept];
      return def ? { concept, label: def.label, seen, strength, pointsTo: def.pointsTo, cite: def.cite } : null;
    };
    const symptoms = [...step.seen.map(([c, s]) => symptom(c, true, s)), ...(step.expected ?? []).map((c) => symptom(c, false))].filter((s): s is Symptom => !!s);
    const view = step.view ? pack.views[step.view] : undefined;
    return {
      id: newReportId(),
      crop: ctx.crop,
      engine: SAMPLE_INFO,
      photos: reads.length,
      differential,
      verdict,
      threshold: SAMPLE_INFO.threshold,
      severity: step.severity ?? null,
      symptoms,
      nextView: view && step.view ? { id: step.view, art: view.art, title: view.title, reason: view.reason, separates: view.separates } : null,
      ms: 0,
      prepMs: 0,
      createdAt: new Date().toISOString(),
    };
  },
};

/** The engines that can read this crop: the real one (if any) and the sample one (if the crop has a sample pack). */
export function enginesFor(crop: string): { real?: Engine; sample?: Engine } {
  return { real: onDeviceV0.supports(crop) ? onDeviceV0 : undefined, sample: sampleEngine.supports(crop) ? sampleEngine : undefined };
}
