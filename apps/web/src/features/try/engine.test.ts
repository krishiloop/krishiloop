import { describe, expect, it } from 'vitest';
import planFix from './fixtures/plan-parity.json';
import shieldFix from './fixtures/shield-parity.json';
import { addDays, DATA, evaluate, parseRange, plan, practiceRiver, receiptPreview, ruleById, shield, sprayWeek, type Check, type PackId } from './engine';

/**
 * Parity: the browser ports answer exactly as the Python code does. The fixtures are the REAL answers of
 * services/engine/planner.py make_plan and services/engine/climate.py shield on a grid of inputs, written by
 * tools/build_try_data.py (tests/test_try_data.py fails if they drift from the YAML or the Python).
 */
const CASES: Record<string, { pack: PackId; stage: string; country: 'BD' | 'KE' }> = {
  'rice-tillering': { pack: 'pack-bd-rice', stage: 'tillering', country: 'BD' },
  'rice-booting': { pack: 'pack-bd-rice', stage: 'booting', country: 'BD' },
  'potato-vegetative': { pack: 'pack-potato-late-blight', stage: 'vegetative', country: 'KE' },
};
const TODAY = planFix.today;

describe('planner port (make_plan decision step) matches Python', () => {
  it(`gives the same answer on all ${planFix.rows.length} grid rows`, () => {
    const bad: string[] = [];
    for (const row of planFix.rows) {
      const c = CASES[row.case]!;
      const [h, lo, hi, rain] = row.week as [number, number, number, number];
      const out = plan(c.pack, c.stage, row.profile, sprayWeek(h, lo, hi, rain, TODAY), TODAY, new Set(row.recalled));
      const got =
        out.status === 'ok'
          ? { status: 'ok', actions: [out.decision, ...out.others].map((r) => r.rule_id), decision: out.decision.action.decision }
          : { status: 'abstained', reason: out.reason };
      if (JSON.stringify(got) !== JSON.stringify(row.expect)) bad.push(`${JSON.stringify(row)} -> ${JSON.stringify(got)}`);
    }
    expect(bad).toEqual([]);
  });

  it('covers every answer the spray tool can show', () => {
    const seen = new Set(planFix.rows.map((r) => `${r.case}:${'decision' in r.expect ? r.expect.decision : r.expect.reason}`));
    for (const k of ['rice-tillering:dont_spray', 'rice-booting:recheck', 'potato-vegetative:no_matching_rule', 'rice-tillering:rule_recalled']) expect(seen).toContain(k);
  });

  it('builds the same week from the sliders as the Python script', () => {
    const w = sprayWeek(85, 22, 30, 19, '2026-11-19');
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ date: '2026-11-19', rh_mean_pct: 85, tmin_c: 22, tmax_c: 30, precip_mm: 19 });
    expect(w[6]).toEqual({ date: '2026-11-25', rh_mean_pct: 85, tmin_c: 22, tmax_c: 30, precip_mm: 0 });
  });

  it('treats a missing fact as unknown, never as "no" (three-valued logic)', () => {
    const r = ruleById('pack-bd-rice', 'R-BDR-001')!;
    expect(evaluate(r, { stage: 'tillering' })[0]).toBeNull();
    expect([...evaluate(r, { stage: 'tillering' })[1]].sort()).toEqual(['bph_females_per_hill', 'bph_nymphs_per_hill']);
    expect(evaluate(r, { stage: 'tillering', bph_females_per_hill: 3 })[0]).toBe(true); // "any": one known true is enough
    const out = plan('pack-bd-rice', 'tillering', {}, sprayWeek(60, 20, 30, 0, TODAY), TODAY);
    expect(out.status === 'abstained' && out.reason).toBe('data_unavailable');
  });

  it('reads ranges as snapshot.py does', () => {
    expect(parseRange('22-32')).toEqual([22, 32]);
    expect(parseRange('-2-12')).toEqual([-2, 12]);
    expect(parseRange([10, 25])).toEqual([10, 25]);
  });

  it('previews the receipt with the rule, its quote and page, and the team-set numbers it used', () => {
    const out = plan('pack-bd-rice', 'booting', { bph_females_per_hill: 0, bph_nymphs_per_hill: 0 }, sprayWeek(85, 24, 30, 0, TODAY), TODAY);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.decision.rule_id).toBe('R-BDR-004');
    const p = receiptPreview('pack-bd-rice', out.decision, out.facts);
    expect(p.sources[0]).toMatchObject({ doc_id: 'DOC-BRRIKB-003', page: 2, publisher: expect.stringContaining('BRRI') });
    expect(p.params.map((x) => x.name)).toEqual(expect.arrayContaining(['bph_females_min', 'humid_rh_pct_min', 'mild_temp_c_range', 'heavy_rain_mm']));
    expect(p.params.every((x) => x.set_by === 'team')).toBe(true);
    expect(p.data).toEqual([
      { variable: 'forecast_humid_mild_days', value: 7, unit: 'days' },
      { variable: 'forecast_heavy_rain_days', value: 0, unit: 'days' },
    ]);
    expect(p.confidence).toBe('medium');
  });

  it('never decides "spray": no rule in either pack says spray', () => {
    for (const pack of Object.keys(DATA.packs) as PackId[]) for (const r of DATA.packs[pack].rules) expect(r.action.decision).not.toBe('spray');
  });
});

describe('Climate-Smart Shield port matches Python', () => {
  const slim = (c: Check) => ({
    kind: c.kind,
    level: c.level,
    reason: c.reason,
    days: c.days,
    peak: c.peak,
    thresholds: c.thresholds.map((p) => p.name),
    rule: c.rule ? { rule_id: c.rule.rule_id, version: c.rule.version, applies: c.rule.applies, title: c.rule.title, quote: c.rule.source.quote, page: c.rule.source.page } : null,
    rule_withdrawn: c.rule_withdrawn,
    context: c.context?.fact_id ?? null,
  });

  it(`gives the same four checks on all ${shieldFix.rows.length} practice weeks`, () => {
    const bad: string[] = [];
    for (const row of shieldFix.rows) {
      const c = CASES[row.case]!;
      const days = shieldFix.weeks[row.week]!.map((d, i) => ({ ...d, date: addDays(shieldFix.today, i) }));
      const recalled = new Set(row.recalled);
      const rep = shield(c.pack, c.stage, c.country, row.profile, days, practiceRiver(row.river as 'none', shieldFix.today), shieldFix.today, (r, v) => recalled.has(`${r}@${v}`));
      const got = { warnings: rep.warnings, checks: rep.checks.map(slim) };
      if (JSON.stringify(got) !== JSON.stringify(row.expect)) bad.push(`${row.case} week ${row.week} river ${row.river}: ${JSON.stringify(got)} != ${JSON.stringify(row.expect)}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it('calls the practice river rising, stable or falling by the snapshot rule', () => {
    expect(practiceRiver('none', TODAY)).toBeNull();
    expect(practiceRiver('rising', TODAY)!.trend).toBe('rising');
    expect(practiceRiver('stable', TODAY)!.trend).toBe('stable');
    expect(practiceRiver('falling', TODAY)!.discharge.map((d) => d.m3s)).toEqual([400, 380, 360, 340, 320, 300, 280]);
  });

  it('cites no withdrawn rule: a recalled rule version is named as withdrawn instead', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(TODAY, i), precip_mm: i === 2 ? 48 : 0, tmax_c: 30, tmin_c: 20, rh_mean_pct: 65 }));
    const ok = shield('pack-bd-rice', 'tillering', 'BD', {}, days, null, TODAY);
    expect(ok.checks[0]!.rule?.rule_id).toBe('R-BDR-009');
    const gone = shield('pack-bd-rice', 'tillering', 'BD', {}, days, null, TODAY, (r) => r === 'R-BDR-009');
    expect(gone.checks[0]!.rule).toBeNull();
    expect(gone.checks[0]!.rule_withdrawn).toBe('R-BDR-009 v1');
  });
});
