import { describe, expect, it } from 'vitest';
import { caseStatus, evidenceDelta, isClosed, isOpened, lastEvent, meterView, newestFirst, otherLabels, reviewVerdict, splitRecalled } from './gate';
import { AREA_LABELS, areaLabelName, areaOf, isAreaLabel } from './labels';
import { POLICY_V1 } from './policy';
import type { AreaStats, GateEvent, PhotoCase } from '../../lib/api/types';

const area = (over: Partial<AreaStats> = {}): AreaStats => ({
  area: 'rice@BD',
  model: 'bioclip2@1',
  policy_version: 1,
  verdicts: 0,
  sure_in_window: 0,
  sure_right_in_window: 0,
  precision: null,
  lower_bound: 0,
  gate_open: false,
  events: [],
  trust_credential_id: null,
  ...over,
});

const photoCase = (over: Partial<PhotoCase> = {}): PhotoCase => ({
  case_id: 'pc-0123456789abcdef',
  area: 'rice@BD',
  model: 'bioclip2@1',
  field_id: 'BD-SAMPLE-02',
  created_at: '2026-10-28T10:00:00Z',
  route: 'officer',
  sure: true,
  suggestion: [
    { label: 'blast', prob: 0.91 },
    { label: 'brown_spot', prob: 0.06 },
  ],
  consent: true,
  verdict: null,
  photo_available: true,
  ...over,
});

describe('the area meter', () => {
  it('starts with nothing: collecting, the gate closed, 30 sure answers still needed', () => {
    const m = meterView(null);
    expect(m).toMatchObject({ phase: 'collecting', gateOpen: false, verdicts: 0, sure: 0, remaining: 30, sureProgress: 0, lowerBound: 0, counted: false, reachedBar: false, bar: 0.85, closeBar: 0.8 });
  });
  it('a high bound on few sure answers does not count: the gate needs 30 of them', () => {
    const m = meterView(area({ verdicts: 12, sure_in_window: 12, sure_right_in_window: 12, precision: 1, lower_bound: 0.7575 }));
    expect(m.phase).toBe('collecting');
    expect(m.counted).toBe(false);
    expect(m.remaining).toBe(18);
    expect(m.sureProgress).toBeCloseTo(0.4, 6);
    expect(m.reachedBar).toBe(false);
  });
  it('enough sure answers but a bound under the bar is "building"', () => {
    const m = meterView(area({ verdicts: 40, sure_in_window: 32, sure_right_in_window: 28, precision: 0.875, lower_bound: 0.71 }));
    expect(m.phase).toBe('building');
    expect(m.counted).toBe(true);
    expect(m.remaining).toBe(0);
    expect(m.sureProgress).toBe(1);
    expect(m.reachedBar).toBe(false);
  });
  it('the open gate is "open" whatever the number says, and reaching the bar needs a counted bound', () => {
    const open = meterView(area({ gate_open: true, sure_in_window: 34, sure_right_in_window: 34, lower_bound: 0.89, precision: 1, trust_credential_id: 'urn:uuid:x' }));
    expect(open.phase).toBe('open');
    expect(open.reachedBar).toBe(true);
    expect(meterView(area({ sure_in_window: 5, lower_bound: 0.9 })).reachedBar).toBe(false);
  });
  it('clamps what the server sends into 0..1 and never goes negative', () => {
    expect(meterView(area({ lower_bound: 1.4 })).lowerBound).toBe(1);
    expect(meterView(area({ lower_bound: -0.2, sure_in_window: -3 })).lowerBound).toBe(0);
    expect(meterView(area({ sure_in_window: -3 })).sure).toBe(0);
  });
  it('uses the policy it is given', () => {
    const m = meterView(area({ sure_in_window: 10 }), { ...POLICY_V1, minSure: 10, openLb: 0.9 });
    expect(m.counted).toBe(true);
    expect(m.bar).toBe(0.9);
  });
});

describe('photo cases', () => {
  it('open = waiting for the officer, resolved = answered, auto = answered automatically', () => {
    expect(caseStatus(photoCase())).toBe('open');
    expect(caseStatus(photoCase({ verdict: 'blast' }))).toBe('resolved');
    expect(caseStatus(photoCase({ route: 'auto', suggestion: [{ label: 'blast', prob: 0.93 }] }))).toBe('auto');
    expect(caseStatus(photoCase({ route: 'auto', verdict: 'blast' }))).toBe('resolved');
  });
  it('lists the newest case first without touching the original', () => {
    const rows = [photoCase({ case_id: 'a', created_at: '2026-10-28T09:00:00Z' }), photoCase({ case_id: 'b', created_at: '2026-10-28T11:00:00Z' }), photoCase({ case_id: 'c', created_at: '2026-10-28T10:00:00Z' })];
    expect(newestFirst(rows).map((c) => c.case_id)).toEqual(['b', 'c', 'a']);
    expect(rows.map((c) => c.case_id)).toEqual(['a', 'b', 'c']);
  });
  it('"something else" offers the labels outside the frozen top-2', () => {
    expect(otherLabels(photoCase())).toEqual(['healthy', 'tungro', 'sheath_blight']);
    expect(otherLabels(photoCase({ suggestion: [{ label: 'healthy', prob: 0.5 }, { label: 'tungro', prob: 0.3 }] }))).toEqual(['blast', 'brown_spot', 'sheath_blight']);
  });
});

describe('what a verdict says about the frozen suggestion', () => {
  it('right: the first suggestion was the officer answer', () => {
    expect(reviewVerdict(photoCase(), 'blast')).toEqual({ chosen: 'blast', suggested: 'blast', suggestedProb: 0.91, rank: 0, right: true, sure: true, countsTowardGate: true });
  });
  it('wrong, but the second guess was right: the triage still helped', () => {
    const r = reviewVerdict(photoCase(), 'brown_spot')!;
    expect(r.right).toBe(false);
    expect(r.rank).toBe(1);
  });
  it('wrong, and neither guess was right', () => {
    const r = reviewVerdict(photoCase(), 'tungro')!;
    expect(r.right).toBe(false);
    expect(r.rank).toBeNull();
  });
  it('only a sure suggestion counts toward the gate', () => {
    const r = reviewVerdict(photoCase({ sure: false, suggestion: [{ label: 'blast', prob: 0.5 }, { label: 'healthy', prob: 0.3 }] }), 'blast')!;
    expect(r.right).toBe(true);
    expect(r.sure).toBe(false);
    expect(r.countsTowardGate).toBe(false);
  });
  it('reads the verdict from the case when none is given, and nothing when there is none', () => {
    expect(reviewVerdict(photoCase({ verdict: 'blast' }))!.right).toBe(true);
    expect(reviewVerdict(photoCase())).toBeNull();
    expect(reviewVerdict(photoCase({ suggestion: [] }), 'blast')).toBeNull();
  });
});

describe('the evidence moving with a verdict', () => {
  it('shows before and after, and notices a sure verdict was counted', () => {
    const d = evidenceDelta(area({ verdicts: 12, sure_in_window: 8, sure_right_in_window: 7, lower_bound: 0.52 }), area({ verdicts: 13, sure_in_window: 9, sure_right_in_window: 8, lower_bound: 0.57 }));
    expect(d.before!.verdicts).toBe(12);
    expect(d.after.verdicts).toBe(13);
    expect(d.sureCounted).toBe(true);
    expect(d.crossedUp).toBe(false);
    expect(d.crossedDown).toBe(false);
  });
  it('an unsure verdict adds an officer answer but leaves the sure window alone', () => {
    const d = evidenceDelta(area({ verdicts: 12, sure_in_window: 8, sure_right_in_window: 7, lower_bound: 0.52 }), area({ verdicts: 13, sure_in_window: 8, sure_right_in_window: 7, lower_bound: 0.52 }));
    expect(d.sureCounted).toBe(false);
    expect(d.after.verdicts - d.before!.verdicts).toBe(1);
  });
  it('sees the bound cross the bar upward (trust earned) and downward through the closing line (drift)', () => {
    const up = evidenceDelta(area({ lower_bound: 0.83, sure_in_window: 33 }), area({ lower_bound: 0.86, sure_in_window: 34, gate_open: true }));
    expect(up.crossedUp).toBe(true);
    const down = evidenceDelta(area({ lower_bound: 0.81, sure_in_window: 40, gate_open: true }), area({ lower_bound: 0.78, sure_in_window: 41 }));
    expect(down.crossedDown).toBe(true);
    expect(down.crossedUp).toBe(false);
  });
  it('without the numbers from before, only the after is known', () => {
    const d = evidenceDelta(null, area({ verdicts: 1 }));
    expect(d.before).toBeNull();
    expect(d.crossedUp).toBe(false);
    expect(d.after.verdicts).toBe(1);
  });
});

describe('gate events', () => {
  const ev = (event: GateEvent['event']): GateEvent => ({ event, at: '2026-10-28T10:00:00Z', verdicts: 40, sure_in_window: 34, precision: 0.97, lower_bound: 0.86, policy_version: 1 });
  it('tells opened from closed, and finds the latest', () => {
    expect(isOpened(ev('opened'))).toBe(true);
    expect(isClosed(ev('opened'))).toBe(false);
    expect(isClosed(ev('closed'))).toBe(true);
    expect(isOpened(null)).toBe(false);
    expect(lastEvent(area({ events: [ev('opened'), ev('closed')] }))!.event).toBe('closed');
    expect(lastEvent(area())).toBeNull();
    expect(lastEvent(null)).toBeNull();
  });
});

describe('advice that relied on a photo reading', () => {
  it('tells "photo trust for <model> in <area>" apart from a recalled rule', () => {
    const r = splitRecalled(['R-BDR-012 v1', 'photo trust for bioclip2@1 in rice@BD']);
    expect(r.rules).toEqual(['R-BDR-012 v1']);
    expect(r.photoTrust).toEqual([{ entry: 'photo trust for bioclip2@1 in rice@BD', model: 'bioclip2@1', area: 'rice@BD' }]);
  });
  it('a recall with only rules has no photo trust entry, and nothing at all is fine', () => {
    expect(splitRecalled(['R-PLB-011 v1']).photoTrust).toEqual([]);
    expect(splitRecalled(undefined)).toEqual({ photoTrust: [], rules: [] });
    expect(splitRecalled(['photo trust for withdrawn']).photoTrust).toEqual([]);
  });
});

describe('labels and areas', () => {
  it('knows the five labels of the server model and names them through i18n keys', () => {
    expect(AREA_LABELS).toEqual(['healthy', 'blast', 'brown_spot', 'tungro', 'sheath_blight']);
    expect(isAreaLabel('blast')).toBe(true);
    expect(isAreaLabel('rice_blast')).toBe(false);
    expect(areaLabelName('brown_spot', (k) => `[${k}]`)).toBe('[trust.label.brown_spot]');
  });
  it('shows a label it does not know humanised, never dropped', () => {
    expect(areaLabelName('leaf_scald', (k) => k)).toBe('leaf scald');
  });
  it('an area is crop at place: the area code when the field has one, else the country', () => {
    expect(areaOf({ crop: 'rice', country: 'BD' })).toBe('rice@BD');
    expect(areaOf({ crop: 'rice', country: 'BD', area_code: 'BD-Mymensingh' })).toBe('rice@BD-Mymensingh');
    expect(areaOf({ crop: 'potato', country: 'KE' })).toBe('potato@KE');
  });
});
