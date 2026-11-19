import { describe, expect, it } from 'vitest';
import { GRID, heatColour, heatFromDrops, masked, maskedBatch, patches } from './occlusion';

describe('occlusion map', () => {
  it('covers the 224 px input with a 7 x 7 grid of 32 px patches, row-major, without gaps', () => {
    const ps = patches(224);
    expect(ps).toHaveLength(GRID * GRID);
    expect(ps[0]).toMatchObject({ row: 0, col: 0, x0: 0, x1: 32, y0: 0, y1: 32 });
    expect(ps[48]).toMatchObject({ row: 6, col: 6, x0: 192, x1: 224, y0: 192, y1: 224 });
    const area = ps.reduce((s, p) => s + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
    expect(area).toBe(224 * 224);
  });

  it('greys exactly one patch in every channel', () => {
    const S = 224;
    const x = new Float32Array(3 * S * S).fill(1);
    const p = patches(S)[24];
    const m = masked(x, S, p);
    expect(m.filter((v) => v === 0.5).length).toBe(3 * 32 * 32);
    expect(m[(p.y0 * S) + p.x0]).toBe(0.5);
    expect(m[2 * S * S + (p.y1 - 1) * S + p.x1 - 1]).toBe(0.5);
    expect(m[(p.y0 * S) + p.x1]).toBe(1);
    expect(x[(p.y0 * S) + p.x0]).toBe(1); // the original is untouched
    const b = maskedBatch(x, S, patches(S).slice(0, 7));
    expect(b.length).toBe(7 * 3 * S * S);
  });

  it('turns probability drops into a 0..1 map, as the server does', () => {
    expect(heatFromDrops(0.9, [0.9, 0.5, 0.8, 1.0])).toEqual([0, 1, 0.25, 0]);
    expect(heatFromDrops(0.2, [0.3, 0.2])).toEqual([0, 0]);
    expect(heatColour(0)[3]).toBeLessThan(heatColour(1)[3]);
  });
});
