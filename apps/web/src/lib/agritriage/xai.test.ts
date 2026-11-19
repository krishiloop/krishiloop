import { describe, expect, it } from 'vitest';
import fx from './xai.fixture.json';
import { attentionReceived, attentionView, camUnit, GRID, lesion, outline, overlap, synthAttention, synthLeaf, toRgb, upsample, type Kind } from './xai';

/** The browser's XAI maths against the Python answers in xai.fixture.json (tests/test_agritriage_xai.py checks the same file). */
const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!), `index ${i}`).toBeLessThanOrEqual(tol);
};
const sumIdx = (m: Uint8Array) => m.reduce((s, v, i) => s + (v ? i : 0), 0);

describe('XAI maths, as on the server', () => {
  it('CAM view and its smooth upsampling', () => {
    close(camUnit(fx.cam.cells), fx.cam.unit, 1e-9);
    close(upsample(camUnit(fx.cam.cells), GRID, 28), fx.cam.up28, 1e-9);
    expect(camUnit([-1, -2])).toEqual([0, 0]);
    expect(camUnit([-0.2, 0, 0.4])).toEqual([0, 0, 1]);
  });

  it('attention received: rows sum to 1, so the 49 values sum to 1; the sink is left out of the scale', () => {
    const blocks = synthAttention(fx.attention.blocks, fx.attention.heads);
    for (let r = 0; r < 3 * 49; r++) expect(blocks[0]!.subarray(r * 49, r * 49 + 49).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    const recv = attentionReceived(blocks, fx.attention.heads, 49);
    close(recv, fx.attention.received, 1e-9);
    expect(recv.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    const { view, sinks } = attentionView(recv);
    expect(sinks).toEqual(fx.attention.sinks);
    close(view, fx.attention.view, 1e-9);
  });

  it('lesion estimate on the drawn leaf: the same masks, threshold, severity and overlap', () => {
    const L = fx.lesion;
    const { rgb, nLeaf, nSpot } = synthLeaf(L.size, L.spots as [number, number, number, Kind][]);
    expect([nLeaf, nSpot]).toEqual([L.drawn_leaf, L.drawn_spots]);
    const les = lesion(rgb, L.size);
    expect(les.threshold).toBe(L.threshold);
    expect(les.leaf.reduce((s, v) => s + v, 0)).toBe(L.leaf_px);
    expect(les.spots.reduce((s, v) => s + v, 0)).toBe(L.spot_px);
    expect(sumIdx(les.leaf)).toBe(L.leaf_index_sum);
    expect(sumIdx(les.spots)).toBe(L.spot_index_sum);
    expect(outline(les.spots, L.size, L.size).reduce((s, v) => s + v, 0)).toBe(L.outline_px);
    expect(les.severityPct!).toBeCloseTo(L.severity_pct, 1);
    expect(les.leafPct).toBeCloseTo(L.leaf_pct, 1);
    for (const k of ['brown', 'yellow', 'dark'] as const) expect(les.kindsPct[k]!).toBeCloseTo(L.kinds_pct[k], 1);
    const ov = overlap(upsample(camUnit(fx.cam.cells), GRID, L.size), les);
    expect(ov.verdict).toBe(L.overlap.verdict);
    expect(ov.onSpotsPct).toBeCloseTo(L.overlap.on_spots_pct, 1);
    expect(ov.onLeafPct).toBeCloseTo(L.overlap.on_leaf_pct, 1);
    expect(ov.spotAreaPct).toBeCloseTo(L.overlap.spot_area_pct, 1);
    // the drawn truth: spots are 7.2% of the leaf; the estimate is within a point
    expect(Math.abs(les.severityPct! - (100 * nSpot) / nLeaf)).toBeLessThan(1);
  });

  it('no leaf, no estimate; a CHW input converts back to the same bytes', () => {
    const grey = new Uint8Array(60 * 60 * 3).fill(128);
    const les = lesion(grey, 60);
    expect(les.leafFound).toBe(false);
    expect(les.severityPct).toBeNull();
    expect(overlap(new Float64Array(3600).fill(1), les).verdict).toBe('no_leaf');
    // a 2 x 2 CHW input (R plane, G plane, B plane) -> RGB bytes per pixel
    const x = new Float32Array([0, 1, 128 / 255, 1, 10 / 255, 0, 0, 0, 1, 1, 1, 0]);
    expect(Array.from(toRgb(x, 2))).toEqual([0, 10, 255, 255, 0, 255, 128, 0, 255, 255, 0, 0]);
  });
});
