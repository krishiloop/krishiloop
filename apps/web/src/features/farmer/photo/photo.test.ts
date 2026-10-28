/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { PHOTO_LABELS } from './labels';
import { meanProbs, onDeviceV0, sampleEngine, type ShotRead } from './engines';
import { DIAGNOSIS_SOURCE_PREFIX, citingActions, toDiagnosis } from './diagnosis';
import { OTHER, sortDifferential, topLabels, type Report } from './report';
import { DEFAULT_THRESHOLD, PHOTO_MODEL_CARD, PHOTO_THRESHOLD, diagnosisSource } from './photoModelCard';
import { SAMPLE_PACKS, SAMPLE_SCENARIOS } from './samplePacks';
import { sampleImage, sampleOverlay } from './sampleArt';
import type { Plan } from '../../../lib/api/types';

/** probabilities over the 21 classes: `top` gets `p`, the rest share what is left, `second` gets a fixed slice */
function probs(top: string, p: number, second?: [string, number]): number[] {
  const rest = 1 - p - (second?.[1] ?? 0);
  const others = PHOTO_LABELS.filter((l) => l !== top && l !== second?.[0]);
  return PHOTO_LABELS.map((l) => (l === top ? p : l === second?.[0] ? second[1] : rest / others.length));
}
const read = (p: number[]): ShotRead => ({ probs: p, ms: 5, prepMs: 2 });

describe('model card (the data slot)', () => {
  it('has a sha256 that looks like one and a threshold in (0,1)', () => {
    expect(PHOTO_MODEL_CARD.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(PHOTO_THRESHOLD).toBeGreaterThan(0);
    expect(PHOTO_THRESHOLD).toBeLessThan(1);
    expect(DEFAULT_THRESHOLD).toBe(0.6);
  });
  it('names the model the way receipts will', () => {
    expect(diagnosisSource()).toBe('on-device-model:rice-leaf-mnv4s@union-v0');
    expect(diagnosisSource().startsWith(DIAGNOSIS_SOURCE_PREFIX)).toBe(true);
  });
  it('every tested-on score is a probability or null, and the Bangladesh row is honest about being untested', () => {
    for (const r of PHOTO_MODEL_CARD.testedOn) expect(r.score === null || (r.score >= 0 && r.score <= 1)).toBe(true);
    expect(PHOTO_MODEL_CARD.testedOn.find((r) => r.id === 'bd-field')?.score).toBeNull();
  });
});

describe('on-device engine (v0)', () => {
  it('is confident at or above the threshold and the differential sums to 1', () => {
    const r = onDeviceV0.combine([read(probs('rice_blast', 0.82, ['brown_spot', 0.1]))], { crop: 'rice', scenario: 'needs_view' });
    expect(r.verdict).toBe('confident');
    expect(r.differential[0]!.id).toBe('rice_blast');
    expect(r.nextView).toBeNull();
    expect(r.differential.reduce((a, d) => a + d.prob, 0)).toBeCloseTo(1, 6);
  });
  it('asks for another leaf when it is not sure and photos remain, then hands over to the officer', () => {
    const unsure = read(probs('rice_blast', 0.41, ['brown_spot', 0.33]));
    const one = onDeviceV0.combine([unsure], { crop: 'rice', scenario: 'needs_view' });
    expect(one.verdict).toBe('ambiguous');
    expect(one.nextView?.id).toBe('another_leaf');
    const three = onDeviceV0.combine([unsure, unsure, unsure], { crop: 'rice', scenario: 'needs_view' });
    expect(three.verdict).toBe('unsure');
    expect(three.nextView).toBeNull();
  });
  it('combines photos by the mean of their softmax, so disagreement lowers confidence instead of multiplying it', () => {
    const a = probs('rice_blast', 0.7, ['brown_spot', 0.2]);
    const b = probs('brown_spot', 0.7, ['rice_blast', 0.2]);
    const m = meanProbs([a, b]);
    expect(m.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
    const r = onDeviceV0.combine([read(a), read(b)], { crop: 'rice', scenario: 'needs_view' });
    expect(r.agree).toBe(false);
    expect(r.verdict).toBe('ambiguous');
    expect(r.differential[0]!.prob).toBeCloseTo(0.45, 2);
    expect(r.ms).toBe(10);
  });
  it('supports rice only (the crop comes from the field profile)', () => {
    expect(onDeviceV0.supports('rice')).toBe(true);
    expect(onDeviceV0.supports('potato')).toBe(false);
  });
});

describe('sample engine (scripted, labelled)', () => {
  it('has a pack for potato and rice and is flagged sample everywhere', () => {
    expect(Object.keys(SAMPLE_PACKS).sort()).toEqual(['potato', 'rice']);
    expect(sampleEngine.info.sample).toBe(true);
    expect(sampleEngine.info.testedOn).toEqual([]);
  });
  for (const crop of ['potato', 'rice']) {
    it(`${crop}: needs_view asks for ONE specific view, then the differential shifts to a confident answer`, () => {
      const first = sampleEngine.combine([{ ms: 0, prepMs: 0 }], { crop, scenario: 'needs_view' });
      expect(first.verdict).toBe('ambiguous');
      expect(first.nextView).not.toBeNull();
      expect(first.nextView!.separates?.length).toBe(2);
      expect(first.severity).not.toBeNull();
      const second = sampleEngine.combine([{ ms: 0, prepMs: 0 }, { ms: 0, prepMs: 0 }], { crop, scenario: 'needs_view' });
      expect(second.verdict).toBe('confident');
      expect(second.nextView).toBeNull();
      // the answer moved: the leader of step 1 is not the leader of step 2, and the asked-about view added a symptom
      expect(second.differential[0]!.id).not.toBe(first.differential[0]!.id);
      expect(first.nextView!.separates).toContain(second.differential[0]!.id);
      expect(second.symptoms.filter((s) => s.seen).length).toBeGreaterThan(first.symptoms.filter((s) => s.seen).length);
    });
    it(`${crop}: unsure ends with the officer after the extra view did not help`, () => {
      const second = sampleEngine.combine([{ ms: 0, prepMs: 0 }, { ms: 0, prepMs: 0 }], { crop, scenario: 'unsure' });
      expect(second.verdict).toBe('unsure');
    });
    it(`${crop}: every symptom carries a citation that is flagged as a sample`, () => {
      for (const sc of SAMPLE_SCENARIOS) {
        for (const n of [1, 2]) {
          const r = sampleEngine.combine(Array.from({ length: n }, () => ({ ms: 0, prepMs: 0 })), { crop, scenario: sc });
          for (const s of r.symptoms) {
            expect(s.cite?.sample).toBe(true);
            expect(s.cite?.quote.length).toBeGreaterThan(10);
          }
        }
      }
    });
  }
  it('never produces a Diagnosis for the planner', () => {
    const r = sampleEngine.combine([{ ms: 0, prepMs: 0 }], { crop: 'potato', scenario: 'confident' });
    expect(() => toDiagnosis(r, { sha256: PHOTO_MODEL_CARD.sha256 })).toThrow(/sample/);
  });
  it('draws a picture and an overlay that line up (boxes inside the model crop)', () => {
    for (const crop of ['potato', 'rice']) {
      for (const art of ['top', 'underside', 'close'] as const) {
        expect(sampleImage(crop, art)).toMatch(/^data:image\/svg\+xml/);
        const o = sampleOverlay(crop, art);
        expect(o.sample).toBe(true);
        for (const l of o.lesions ?? []) {
          expect(l.x).toBeGreaterThan(-0.05);
          expect(l.y).toBeGreaterThan(-0.05);
          expect(l.x + l.w).toBeLessThan(1.05);
          expect(l.y + l.h).toBeLessThan(1.05);
        }
      }
    }
  });
});

describe('the Diagnosis the planner is sent', () => {
  const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../../contracts/schemas/diagnosis.schema.json', import.meta.url)), 'utf-8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const sha = PHOTO_MODEL_CARD.sha256;

  it('is valid against contracts/schemas/diagnosis.schema.json when confident', () => {
    const r = onDeviceV0.combine([read(probs('rice_blast', 0.8, ['brown_spot', 0.1]))], { crop: 'rice', scenario: 'needs_view' });
    const d = toDiagnosis(r, { sha256: sha });
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true);
    expect(d.status).toBe('ok');
    expect(d.labels.length).toBeLessThanOrEqual(3);
    expect(d.labels.every((l) => l.label !== OTHER)).toBe(true);
    expect(d.model).toEqual({ name: 'rice-leaf-mnv4s', version: 'union-v0', sha256: sha });
    expect(d.on_device).toBe(true);
    expect(d.crop).toBe('rice');
  });
  it('is valid when abstained and says why', () => {
    const r = onDeviceV0.combine([read(probs('rice_blast', 0.4, ['brown_spot', 0.3]))], { crop: 'rice', scenario: 'needs_view' });
    const d = toDiagnosis(r, { sha256: sha });
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true);
    expect(d.status).toBe('abstained');
    expect(d.abstention_reason).toBe('low_confidence');
  });
  it('carries no pixels and no keys the schema does not know', () => {
    const r = onDeviceV0.combine([read(probs('healthy', 0.9))], { crop: 'rice', scenario: 'needs_view' });
    const d = toDiagnosis(r, { sha256: sha });
    expect(Object.keys(d).sort()).toEqual(['calibrated', 'cam_available', 'created_at', 'crop', 'diagnosis_id', 'inference_ms', 'labels', 'model', 'on_device', 'status'].sort());
  });
});

describe('does a plan cite the diagnosis?', () => {
  const action = (source: string) =>
    ({
      action_id: 'a1',
      kind: 'input_decision',
      title: { en: 't' },
      receipt: { receipt_id: 'r', claim: 'c', sources: [], data: [{ source, variable: 'x', value: 1, observed_at: '', retrieved_at: '' }], rule_refs: [], confidence: { level: 'high', basis: '' }, generated_by: { planner_version: '', validator_version: '' }, created_at: '' },
    }) as unknown as Plan['actions'] extends (infer A)[] | undefined ? A : never;
  const plan = (...sources: string[]) => ({ actions: sources.map(action) }) as unknown as Plan;
  it('finds the actions whose receipt names the on-device model', () => {
    expect(citingActions(plan('open-meteo:forecast', diagnosisSource()))).toHaveLength(1);
    expect(citingActions(plan('on-device-model:future-student@v1'))).toHaveLength(1);
  });
  it('says no for a plan that ignores the diagnosis (an older server) or an empty one', () => {
    expect(citingActions(plan('open-meteo:forecast'))).toHaveLength(0);
    expect(citingActions({} as Plan)).toHaveLength(0);
    expect(citingActions(null)).toHaveLength(0);
  });
});

describe('differential helpers', () => {
  it('sorts by probability with Other last', () => {
    const rows = sortDifferential([
      { id: OTHER, name: { en: 'Other' }, prob: 0.5 },
      { id: 'b', name: { en: 'B' }, prob: 0.1 },
      { id: 'a', name: { en: 'A' }, prob: 0.4 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', OTHER]);
  });
  it('takes the top labels without Other', () => {
    const r = { differential: sortDifferential([{ id: OTHER, name: {}, prob: 0.6 }, { id: 'a', name: { en: 'A' }, prob: 0.3 }, { id: 'b', name: { en: 'B' }, prob: 0.1 }]) } as Report;
    expect(topLabels(r).map((d) => d.id)).toEqual(['a', 'b']);
  });
});
