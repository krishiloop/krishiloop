import { describe, expect, it } from 'vitest';
import { buildChart, gateWindows, nearestIndex, niceTicks, parsePoints, readoutAt, replayStats, shapeArea, shapeReplay, stageRows, type ChartBox, type ReplayPoint } from './replay';
import { POLICY_V1, policyFromSettings, requiredRight, wilsonLowerBound } from './policy';
import recordedReplay from '../../data/recorded/area-trust-replay.json';
import type { ReplayArea, ReplayPayload } from '../../lib/api/types';

/** A small hand-made replay area: 6 points, the bound counted from the 3rd, the gate opens after 4 verdicts. */
const FIELDS = ['photos_seen', 'officer_verdicts', 'lower_bound_before_this_verdict', 'gate_open', 'auto_answers', 'auto_right'];
const area = (over: Partial<ReplayArea> = {}): ReplayArea => ({
  fields: FIELDS,
  points: [
    [1, 1, null, 0, 0, 0],
    [2, 2, null, 0, 0, 0],
    [3, 3, 0.7, 0, 0, 0],
    [4, 4, 0.84, 0, 0, 0],
    [9, 5, 0.88, 1, 3, 3],
    [20, 6, 0.9, 1, 12, 11],
  ],
  summary: {
    photos: 20,
    confirmations_until_open: 4,
    officer_confirmations: 6,
    auto_answers: 12,
    auto_precision: 0.9167,
    auto_share_of_all_photos: 0.6,
    gate_closings: 0,
    open_at_end: true,
    suggestion_by_stage: { '0-50': [20, 0.7, 0.9], '50-200': [0, null, null] },
  },
  ...over,
});
const BOX: ChartBox = { width: 400, height: 200, left: 40, right: 10, top: 10, bottom: 30 };
const model = () => shapeArea('BD-D', area())!;

describe('policy', () => {
  it('has the numbers of rules/policy/photo-trust.yaml v1', () => {
    expect(POLICY_V1).toEqual({ sure: 0.85, window: 50, minSure: 30, openLb: 0.85, closeLb: 0.8, audit: 0.1 });
  });
  it('reads a replay own settings and falls back to v1 for any missing number', () => {
    expect(policyFromSettings({ sure: 0.9, window: 40, min_n: 20, open_lb: 0.9, close_lb: 0.85, audit: 0.2 })).toEqual({ sure: 0.9, window: 40, minSure: 20, openLb: 0.9, closeLb: 0.85, audit: 0.2 });
    expect(policyFromSettings({ open_lb: 0.9 })).toEqual({ ...POLICY_V1, openLb: 0.9 });
    expect(policyFromSettings(null)).toEqual(POLICY_V1);
  });
  it('computes the Wilson 95% lower bound like the server does', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(30, 30)).toBeCloseTo(0.8865, 4);
    expect(wilsonLowerBound(29, 30)).toBeCloseTo(0.8333, 4);
    expect(wilsonLowerBound(48, 50)).toBeCloseTo(0.8654, 4);
  });
  it('says how many right answers the bar needs: with 30 sure answers every one of them', () => {
    expect(requiredRight(30, 0.85)).toBe(30);
    expect(requiredRight(40, 0.85)).toBe(39);
    expect(requiredRight(50, 0.85)).toBe(48);
    expect(requiredRight(10, 0.85)).toBeNull();
  });
});

describe('replay points', () => {
  it('reads rows by the declared field names, and null bounds stay null', () => {
    const pts = parsePoints(area());
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual({ photos: 1, verdicts: 1, lb: null, open: false, auto: 0, autoRight: 0 });
    expect(pts[4]).toEqual({ photos: 9, verdicts: 5, lb: 0.88, open: true, auto: 3, autoRight: 3 });
  });
  it('does not assume the column order', () => {
    const pts = parsePoints({ fields: ['officer_verdicts', 'photos_seen', 'gate_open', 'lower_bound_before_this_verdict', 'auto_right', 'auto_answers'], points: [[7, 12, 1, 0.9, 2, 3]] });
    expect(pts[0]).toEqual({ photos: 12, verdicts: 7, lb: 0.9, open: true, auto: 3, autoRight: 2 });
  });
  it('falls back to the documented order when fields is absent, and skips rows that are not numbers', () => {
    const pts = parsePoints({ points: [[1, 1, null, 0, 0, 0], ['x', 2, 0.5, 0, 0, 0] as unknown as number[], [3, 3, 0.6, 1, 1, 1]] });
    expect(pts.map((p) => p.verdicts)).toEqual([1, 3]);
  });
});

describe('gate windows', () => {
  const pt = (verdicts: number, open: boolean): ReplayPoint => ({ photos: verdicts, verdicts, lb: 0.9, open, auto: 0, autoRight: 0 });
  it('opens at the summary moment, which comes one verdict before the first point that shows the gate open', () => {
    const { windows, closings } = gateWindows([pt(1, false), pt(5, true), pt(9, true)], 4);
    expect(windows).toEqual([{ from: 4, to: null }]);
    expect(closings).toEqual([]);
  });
  it('closes and reopens: two windows and one closing (drift)', () => {
    const { windows, closings } = gateWindows([pt(1, false), pt(5, true), pt(9, true), pt(12, false), pt(15, false), pt(18, true)], 4);
    expect(windows).toEqual([
      { from: 4, to: 12 },
      { from: 18, to: null },
    ]);
    expect(closings).toEqual([12]);
  });
  it('never opened: no window', () => {
    expect(gateWindows([pt(1, false), pt(2, false)], null)).toEqual({ windows: [], closings: [] });
  });
});

describe('one area, shaped', () => {
  it('finds the opening moment, the first counted bound and the end of the x axis', () => {
    const m = model();
    expect(m.openAt).toBe(4);
    expect(m.firstBound).toBe(3);
    expect(m.maxVerdicts).toBe(6);
    expect(m.windows).toEqual([{ from: 4, to: null }]);
  });
  it('derives the opening from the points when the summary has none, and says never-opened when there is none', () => {
    const a = area();
    a.summary = { ...a.summary, confirmations_until_open: null as unknown as number };
    expect(shapeArea('x', a)!.openAt).toBe(5);
    const never = area({ points: [[1, 1, null, 0, 0, 0], [2, 2, 0.5, 0, 0, 0]], summary: { ...area().summary, confirmations_until_open: null, auto_answers: 0, auto_precision: null, open_at_end: false, auto_share_of_all_photos: 0 } });
    const nm = shapeArea('x', never)!;
    expect(nm.openAt).toBeNull();
    expect(replayStats(nm).neverOpened).toBe(true);
  });
  it('rejects an area without points or summary', () => {
    expect(shapeArea('x', undefined)).toBeNull();
    expect(shapeArea('x', { points: [], summary: area().summary })).toBeNull();
    expect(shapeArea('x', { points: [[1, 1, null, 0, 0, 0]] } as unknown as ReplayArea)).toBeNull();
  });
});

describe('the numbers under the chart', () => {
  it('"X% of photos answered automatically, Y% of those right" come from the summary', () => {
    const s = replayStats(model());
    expect(s.autoShare).toBeCloseTo(0.6, 4);
    expect(s.autoPrecision).toBeCloseTo(0.9167, 4);
    expect(s.autoAnswers).toBe(12);
    expect(s.autoRight).toBe(11);
    expect(s.openedAfter).toBe(4);
    expect(s.officerChecks).toBe(6);
    expect(s.openAtEnd).toBe(true);
  });
  it('lists the suggestion quality by stage, only for stages that had photos', () => {
    expect(stageRows(model().summary)).toEqual([{ from: 0, to: 50, photos: 20, top1: 0.7, top2: 0.9 }]);
  });
  it('reads the cursor: the share of photos answered automatically so far, and how many of those were right', () => {
    const r = readoutAt(model(), 5);
    expect(r).toMatchObject({ photos: 20, verdicts: 6, lowerBound: 0.9, gateOpen: true, autoAnswers: 12, autoRight: 11 });
    expect(r.autoShare).toBeCloseTo(0.6, 4);
    expect(r.autoPrecision).toBeCloseTo(11 / 12, 4);
    expect(readoutAt(model(), 0).autoShare).toBe(0);
    expect(readoutAt(model(), 0).autoPrecision).toBeNull();
    expect(readoutAt(model(), 99).index).toBe(5);
    expect(readoutAt(model(), -3).index).toBe(0);
  });
});

describe('the whole payload', () => {
  const payload = (): ReplayPayload => ({
    note: 'note',
    settings: { sure: 0.85, window: 50, min_n: 30, open_lb: 0.85, close_lb: 0.8, audit: 0.1 },
    areas: { bioclip2: { 'BD-E': area(), 'BD-A': area(), 'BD-D': area() }, siglip2_b: { 'BD-A': area() } },
  });
  it('picks the bioclip2 backbone and orders the areas BD-A, BD-C, BD-D, BD-E', () => {
    const r = shapeReplay(payload())!;
    expect(r.backbone).toBe('bioclip2');
    expect(r.backbones).toEqual(['bioclip2', 'siglip2_b']);
    expect(r.areas.map((a) => a.key)).toEqual(['BD-A', 'BD-D', 'BD-E']);
    expect(r.policy).toEqual(POLICY_V1);
  });
  it('falls back to the first backbone when the preferred one is absent', () => {
    const p = payload();
    delete p.areas.bioclip2;
    expect(shapeReplay(p)!.backbone).toBe('siglip2_b');
  });
  it('gives null for anything it cannot draw', () => {
    expect(shapeReplay(null)).toBeNull();
    expect(shapeReplay({})).toBeNull();
    expect(shapeReplay({ areas: {} })).toBeNull();
    expect(shapeReplay({ areas: { bioclip2: { 'BD-A': { points: [], summary: {} } } } })).toBeNull();
  });
  it('shapes the real bundled replay (ml/vision/artifacts/area_trust_replay.json): four areas, each opens once, none closes', () => {
    const r = shapeReplay(recordedReplay)!;
    expect(r.areas.map((a) => a.key)).toEqual(['BD-A', 'BD-C', 'BD-D', 'BD-E']);
    expect(r.policy).toEqual(POLICY_V1);
    for (const a of r.areas) {
      expect(a.firstBound).not.toBeNull();
      expect(a.closings).toEqual([]);
      expect(a.points.every((p, i, all) => i === 0 || p.verdicts > all[i - 1]!.verdicts)).toBe(true);
    }
    const opened = Object.fromEntries(r.areas.map((a) => [a.key, a.openAt]));
    expect(opened).toEqual({ 'BD-A': 229, 'BD-C': 126, 'BD-D': 93, 'BD-E': 328 });
    const d = replayStats(r.areas.find((a) => a.key === 'BD-D')!);
    expect(d.autoShare).toBeCloseTo(0.8592, 4);
    expect(d.autoPrecision).toBeCloseTo(0.9957, 4);
  });
  it('the real replay never counts a bound outside 0..1', () => {
    for (const a of shapeReplay(recordedReplay)!.areas) for (const p of a.points) if (p.lb !== null) expect(p.lb).toBeGreaterThanOrEqual(0), expect(p.lb).toBeLessThanOrEqual(1);
  });
});

describe('chart geometry', () => {
  it('maps verdicts to x and the lower bound to y inside the plot box', () => {
    const g = buildChart(model(), POLICY_V1, BOX);
    expect(g.plotW).toBe(350);
    expect(g.plotH).toBe(160);
    expect(g.x(0)).toBe(40);
    expect(g.x(6)).toBe(390);
    expect(g.y(0)).toBe(170);
    expect(g.y(1)).toBe(10);
    expect(g.y(0.5)).toBe(90);
    expect(g.x(999)).toBe(390);
  });
  it('draws the bar at 0.85 and the closing line at 0.80', () => {
    const g = buildChart(model(), POLICY_V1, BOX);
    expect(g.bar.value).toBe(0.85);
    expect(g.bar.y).toBe(g.y(0.85));
    expect(g.closeBar.y).toBe(g.y(0.8));
    expect(g.bar.y).toBeLessThan(g.closeBar.y);
  });
  it('marks the moment the gate opened on the bar, and shades the open stretch to the end', () => {
    const g = buildChart(model(), POLICY_V1, BOX);
    expect(g.openMarker).toEqual({ x: g.x(4), y: g.y(0.85) });
    expect(g.windows).toHaveLength(1);
    expect(g.windows[0]!.x).toBe(g.x(4));
    expect(g.windows[0]!.x + g.windows[0]!.w).toBeCloseTo(g.x(6), 0);
  });
  it('starts the curve where the bound starts to count, and says what is uncounted before it', () => {
    const g = buildChart(model(), POLICY_V1, BOX);
    expect(g.curve.startsWith(`M${g.x(3)} ${g.y(0.7)}`)).toBe(true);
    expect(g.curve.match(/M/g)).toHaveLength(1);
    expect(g.uncounted).toEqual({ x: g.x(0), w: g.x(3) - g.x(0) });
    expect(g.fill.endsWith('Z')).toBe(true);
  });
  it('a replay that never counts a bound is uncounted all the way and has no curve', () => {
    const m = shapeArea('x', area({ points: [[1, 1, null, 0, 0, 0], [2, 2, null, 0, 0, 0]] }))!;
    const g = buildChart(m, POLICY_V1, BOX);
    expect(g.curve).toBe('');
    expect(g.fill).toBe('');
    expect(g.uncounted).toEqual({ x: g.x(0), w: g.plotW });
  });
  it('breaks the curve where the bound is not counted, and draws the closings', () => {
    const a = area({
      points: [
        [1, 1, 0.7, 0, 0, 0],
        [2, 2, null, 0, 0, 0],
        [3, 3, 0.9, 1, 1, 1],
        [4, 4, 0.78, 0, 1, 1],
      ],
    });
    const m = shapeArea('x', a)!;
    const g = buildChart(m, POLICY_V1, BOX);
    expect(g.curve.match(/M/g)).toHaveLength(2);
    expect(g.closeMarkers).toEqual([{ x: g.x(4), y: g.y(0.8) }]);
  });
  it('gives round ticks and the position of every point', () => {
    expect(niceTicks(394)).toEqual([0, 100, 200, 300]);
    expect(niceTicks(1545)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(6)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(0)).toEqual([0]);
    const g = buildChart(model(), POLICY_V1, BOX);
    expect(g.at(2)).toEqual({ x: g.x(3), y: g.y(0.7) });
    expect(g.at(0).y).toBeNull();
  });
  it('can start the y axis at 0.5 (the trust page) without moving the bar or the points', () => {
    const g = buildChart(model(), POLICY_V1, BOX, 0.5);
    expect(g.y(1)).toBe(10);
    expect(g.y(0.5)).toBe(170);
    expect(g.y(0.2)).toBe(170); // clamped to the floor
    expect(g.y(0.75)).toBe(90);
    expect(g.yTicks).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(g.bar.y).toBe(g.y(0.85));
    expect(g.fill.endsWith(`${g.y(0.5)}Z`)).toBe(true);
    expect(buildChart(model(), POLICY_V1, BOX).yTicks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it('finds the point nearest to a position on the axis', () => {
    const m = model();
    expect(nearestIndex(m, 0)).toBe(0);
    expect(nearestIndex(m, 3.4)).toBe(2);
    expect(nearestIndex(m, 100)).toBe(5);
  });
});
