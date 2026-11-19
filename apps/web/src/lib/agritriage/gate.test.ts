import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gate, topClasses, type TriageConfig } from './gate';
import fixture from './gate.fixture.json';

/** The shipped config (the same file the phone and the server load). */
const cfg = JSON.parse(readFileSync(new URL('../../../public/models/agritriage/config.json', import.meta.url), 'utf8')) as TriageConfig;

describe('AgriTriage gate (browser port)', () => {
  it('matches the Python gate on every fixed logit vector', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
    for (const c of fixture.cases) {
      const r = gate(c.logits, cfg, c.crop);
      expect(r.set, c.name).toEqual(c.expect.set);
      expect(r.action, c.name).toBe(c.expect.action);
      expect(r.energy).toBeCloseTo(c.expect.energy, 5);
      for (const [i, p] of c.expect.top) expect(r.p[i]).toBeCloseTo(p, 6);
    }
  });

  it('reads the three outcomes the product acts on', () => {
    const z = new Array(cfg.classes.length).fill(-4);
    const blast = cfg.classes.indexOf('rice blast');
    z[blast] = 9;
    const d = gate(z, cfg, 'rice');
    expect([d.outcome, d.set]).toEqual(['diagnose', [blast]]);
    expect(topClasses(d, cfg).every((c) => c.label.startsWith('rice'))).toBe(true);
    z[cfg.classes.indexOf('rice sheath blight')] = 9;
    expect(gate(z, cfg, 'rice').outcome).toBe('shortlist');
    const flat = gate(new Array(cfg.classes.length).fill(0), cfg, null);
    expect([flat.outcome, flat.reason]).toEqual(['refer', 'unknown']);
  });

  it('uses the shipped thresholds and refuses an unknown crop', () => {
    expect(cfg.classes).toHaveLength(89);
    expect(cfg.alpha).toBe(0.1);
    expect((cfg as unknown as { samples: unknown[] }).samples).toEqual([]);
    expect(() => gate(new Array(89).fill(0), cfg, 'cassava')).toThrow();
  });
});
