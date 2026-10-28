import { describe, expect, it } from 'vitest';
import { B64_LIMIT, MAX_EDGE, fitWithin } from './downscale';

describe('downscaling a photo for the server', () => {
  it('shrinks a phone photo to at most 1024 px on the long side and keeps its shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(4032, 4032)).toEqual({ width: 1024, height: 1024 });
  });
  it('never scales a small photo up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1024, 1024)).toEqual({ width: 1024, height: 1024 });
  });
  it('never makes a side smaller than one pixel', () => {
    expect(fitWithin(1, 5000)).toEqual({ width: 1, height: 1024 });
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
  });
  it('can fit a smaller square when the encoded photo is still too large', () => {
    expect(fitWithin(1024, 768, 819)).toEqual({ width: 819, height: 614 });
  });
  it('sends at most what the server takes (4,000,000 base64 characters)', () => {
    expect(MAX_EDGE).toBe(1024);
    expect(B64_LIMIT).toBeLessThan(4_000_000);
  });
});
