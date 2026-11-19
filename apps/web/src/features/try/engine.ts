/**
 * The "Try it yourself" engines: small TypeScript ports of KrishiLoop's own Python, run in the browser so the tools
 * answer as a visitor moves a slider. No new rules and no new numbers: the conditions, thresholds, titles and quotes
 * come from the rule YAML through data/rules.json (tools/build_try_data.py), and engine.test.ts checks every answer
 * against what the Python code says on a grid of inputs (fixtures/*.json, made by the same script).
 *
 * Ported:
 * - services/engine/rules.py      evaluate(): three-valued logic, a missing fact is "unknown", never "no";
 * - services/engine/snapshot.py   weather_facts(): humid-and-mild days and heavy-rain days from a 7-day forecast;
 * - services/engine/planner.py    make_plan()'s decision step: which input decision fires, or why the plan abstains,
 *                                 and the two practices shown beside it (the server's validator and signing are not
 *                                 ported: a real receipt is signed by the server; the tools show an unsigned preview);
 * - services/engine/climate.py    shield(): the four Climate-Smart Shield checks and the rule each warning cites.
 */
import data from './data/rules.json';

export type PackId = 'pack-bd-rice' | 'pack-potato-late-blight';
export type Op = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in';
export interface Cond {
  all?: Cond[];
  any?: Cond[];
  fact?: string;
  op?: Op;
  value?: unknown;
}
export interface Param {
  name: string;
  value: number | string;
  unit?: string;
  set_by: string;
  note?: string;
}
export interface RuleSource {
  doc_id: string;
  page: number;
  quote: string;
}
export interface Rule {
  rule_id: string;
  version: number;
  pack_id: string;
  status?: string;
  crop?: string;
  when?: Cond;
  boost_when?: Cond;
  action: { kind: string; decision?: 'dont_spray' | 'recheck' | 'spray'; traffic_light?: 'red' | 'amber' | 'green'; title: { en: string; bn: string } };
  basis_note?: string;
  review_level: string;
  reviewer_parameters: Param[];
  sources: RuleSource[];
}
export interface Doc {
  title: string;
  publisher: string;
  url: string;
  language: string;
  licence_status: string;
}
interface Pack {
  params: Record<string, number | string>;
  defs: Record<string, Param>;
  rules: Rule[];
}
interface Data {
  planner_version: string;
  climate_version: string;
  window_days: number;
  min_days: number;
  packs: Record<PackId, Pack>;
  shield: {
    team_params: Record<string, Param & { value: number }>;
    links: Record<string, Record<string, { rule_id: string; quote: number; show_action: boolean }>>;
    context: Record<string, Record<string, { fact_id: string; source: string; url: string; text: Record<string, string> }>>;
  };
  docs: Record<string, Doc>;
}
export const DATA = data as unknown as Data;
export const PLANNER_VERSION = DATA.planner_version;

export type Facts = Record<string, unknown>;
export interface Day {
  date: string;
  precip_mm?: number | null;
  tmax_c?: number | null;
  tmin_c?: number | null;
  rh_mean_pct?: number | null;
}
type Tri = boolean | null;

export const rulesOf = (pack: PackId) => DATA.packs[pack].rules;
export const ruleById = (pack: PackId, id: string) => DATA.packs[pack].rules.find((r) => r.rule_id === id);

/* ------------------------------------------------------------------ rules.py */
/** Python's ==: True == 1 and False == 0 (the YAML never relies on it, but the port should not differ). */
const pyEq = (a: unknown, b: unknown) => (typeof a === 'boolean' || typeof b === 'boolean' ? Number(a) === Number(b) : a === b);
const OPS: Record<Op, (a: unknown, b: unknown) => boolean> = {
  eq: pyEq,
  ne: (a, b) => !pyEq(a, b),
  lt: (a, b) => (a as number) < (b as number),
  lte: (a, b) => (a as number) <= (b as number),
  gt: (a, b) => (a as number) > (b as number),
  gte: (a, b) => (a as number) >= (b as number),
  in: (a, b) => Array.isArray(b) && b.some((x) => pyEq(a, x)),
};

function paramValue(v: unknown, rule: Rule): unknown {
  if (typeof v === 'string' && v.startsWith('param:')) {
    const name = v.slice(6);
    const p = rule.reviewer_parameters.find((x) => x.name === name);
    if (!p) throw new Error(`${rule.rule_id}: parameter ${name} not defined`);
    return p.value;
  }
  return v;
}

function cond3(c: Cond, facts: Facts, rule: Rule): [Tri, Set<string>] {
  if ('all' in c || 'any' in c) {
    const res = (c.all ?? c.any ?? []).map((x) => cond3(x, facts, rule));
    const vals = res.map(([v]) => v);
    const decisive = !('all' in c);
    if (vals.includes(decisive)) return [decisive, new Set()];
    if (vals.includes(null)) return [null, new Set(res.filter(([v]) => v === null).flatMap(([, m]) => [...m]))];
    return [!decisive, new Set()];
  }
  const f = c.fact!;
  if (facts[f] == null) return [null, new Set([f])];
  return [Boolean(OPS[c.op!](facts[f], paramValue(c.value, rule))), new Set()];
}

/** (true | false | null, missing facts). null: the rule might fire, but a fact it needs is missing. */
export function evaluate(rule: Rule, facts: Facts, when?: Cond): [Tri, Set<string>] {
  if ((rule.status ?? 'active') !== 'active') return [false, new Set()];
  const w = when ?? (rule.when && Object.keys(rule.when).length ? rule.when : { all: [] });
  return cond3(w, facts, rule);
}

/* ------------------------------------------------------------------ snapshot.py */
/** '10-25', '-2-12' or [lo, hi] -> [lo, hi]. */
export function parseRange(v: unknown): [number, number] {
  if (Array.isArray(v)) return [Number(v[0]), Number(v[1])];
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:-|to|\.\.)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(v));
  if (!m) throw new Error(`bad range ${String(v)}`);
  return [Number(m[1]), Number(m[2])];
}

export interface WeatherFacts {
  forecast_humid_mild_days: number | null;
  forecast_heavy_rain_days: number | null;
}

/** Days from `today` on, at most 7 of them. */
export const windowDays = (days: Day[], today: string) => days.filter((d) => (d.date ?? '') >= today).slice(0, DATA.window_days);

export function weatherFacts(days: Day[], params: Record<string, number | string>, today: string): WeatherFacts {
  const w = windowDays(days, today);
  if (w.length < DATA.min_days) return { forecast_humid_mild_days: null, forecast_heavy_rain_days: null };
  const rhMin = Number(params.humid_rh_pct_min ?? 90);
  const [lo, hi] = parseRange(params.mild_temp_c_range ?? '10-25');
  const heavy = Number(params.heavy_rain_mm ?? 10);
  const has = (d: Day, k: keyof Day) => d[k] != null;
  const humid = w.every((d) => has(d, 'rh_mean_pct') && has(d, 'tmin_c') && has(d, 'tmax_c'))
    ? w.filter((d) => d.rh_mean_pct! >= rhMin && lo <= d.tmin_c! && d.tmax_c! <= hi).length
    : null;
  const rain = w.every((d) => has(d, 'precip_mm')) ? w.filter((d) => d.precip_mm! >= heavy).length : null;
  return { forecast_humid_mild_days: humid, forecast_heavy_rain_days: rain };
}

/* ------------------------------------------------------------------ planner.py (the decision step) */
const LIGHT_RANK: Record<string, number> = { red: 0, amber: 1, green: 2 };
/** derived facts -> the pack parameters that shape them (planner.FACT_PARAMS) */
export const FACT_PARAMS: Record<string, string[]> = {
  forecast_humid_mild_days: ['humid_rh_pct_min', 'mild_temp_c_range'],
  forecast_heavy_rain_days: ['heavy_rain_mm'],
};

export type AbstainCode = 'data_unavailable' | 'no_matching_rule' | 'conflicting_rules' | 'rule_recalled';
export type PlanOutcome =
  | { status: 'ok'; decision: Rule; others: Rule[]; facts: Facts }
  | { status: 'abstained'; reason: AbstainCode; rules: string[]; facts: Facts };

const rank = (r: Rule, facts: Facts): [number, number, string] => {
  const boost = r.boost_when && evaluate(r, facts, r.boost_when)[0] === true ? -1 : 0;
  return [boost, LIGHT_RANK[r.action.traffic_light ?? ''] ?? 3, r.rule_id];
};
const byRank = (facts: Facts) => (a: Rule, b: Rule) => {
  const x = rank(a, facts);
  const y = rank(b, facts);
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
};

/**
 * make_plan's choice for one field (no photo, a live forecast): every rule is evaluated; a decision rule that needs a
 * missing fact makes the plan abstain; a recalled rule version is never served; exactly one decision, or abstain.
 */
export function plan(pack: PackId, stage: string, profile: Facts, days: Day[], today: string, recalled: ReadonlySet<string> = new Set()): PlanOutcome {
  const facts: Facts = { stage, ...weatherFacts(days, DATA.packs[pack].params, today), ...profile };
  const fired: Rule[] = [];
  const unknown: string[] = [];
  const recalledDecisions: string[] = [];
  for (const r of rulesOf(pack)) {
    const isDecision = r.action.kind === 'input_decision';
    const [result] = evaluate(r, facts);
    if (result === null && isDecision) unknown.push(r.rule_id);
    else if (result) {
      if (recalled.has(`${r.rule_id}@${r.version}`)) {
        if (isDecision) recalledDecisions.push(`${r.rule_id} v${r.version}`);
        continue;
      }
      fired.push(r);
    }
  }
  if (unknown.length) return { status: 'abstained', reason: 'data_unavailable', rules: unknown, facts };
  const decisions = fired.filter((r) => r.action.kind === 'input_decision');
  if (!decisions.length) {
    return recalledDecisions.length
      ? { status: 'abstained', reason: 'rule_recalled', rules: recalledDecisions, facts }
      : { status: 'abstained', reason: 'no_matching_rule', rules: [], facts };
  }
  if (new Set(decisions.map((r) => r.action.decision)).size > 1) {
    return { status: 'abstained', reason: 'conflicting_rules', rules: decisions.map((r) => r.rule_id), facts };
  }
  const sort = byRank(facts);
  const decision = [...decisions].sort(sort)[0]!;
  const others = fired.filter((r) => r.action.kind !== 'input_decision').sort(sort).slice(0, 2);
  return { status: 'ok', decision, others, facts };
}

function factsUsed(c: Cond | undefined, out = new Set<string>()): Set<string> {
  if (!c) return out;
  if ('all' in c || 'any' in c) [...(c.all ?? []), ...(c.any ?? [])].forEach((x) => factsUsed(x, out));
  else if (c.fact) out.add(c.fact);
  return out;
}

export interface ReceiptPreview {
  rule: Rule;
  sources: (RuleSource & Doc)[];
  params: Param[];
  data: { variable: string; value: number | null; unit: string }[];
  confidence: 'medium' | 'high';
  basis: string;
}

/** What the server's receipt would carry (planner._receipt), as an UNSIGNED preview: sources, team-set numbers, data. */
export function receiptPreview(pack: PackId, rule: Rule, facts: Facts): ReceiptPreview {
  const used = factsUsed(rule.when);
  const derived = Object.keys(FACT_PARAMS).filter((f) => used.has(f));
  const params = new Map(rule.reviewer_parameters.map((p) => [p.name, p]));
  const defs = DATA.packs[pack].defs;
  for (const f of derived) for (const n of FACT_PARAMS[f]!) if (defs[n] && !params.has(n)) params.set(n, defs[n]);
  return {
    rule,
    sources: rule.sources.map((s) => ({ ...s, ...DATA.docs[s.doc_id]! })),
    params: [...params.values()],
    data: derived.filter((f) => facts[f] != null).map((f) => ({ variable: f, value: facts[f] as number, unit: 'days' })),
    confidence: derived.length ? 'medium' : 'high',
    basis: rule.basis_note ?? (derived.length ? 'forecast' : 'direct'),
  };
}

/** The spray tool's week (tools/build_try_data.py spray_week): every day has the chosen humidity and temperatures; the
 * heaviest rain falls on day 1, the other days are dry. */
export function sprayWeek(humidity: number, low: number, high: number, rain: number, today: string): Day[] {
  return Array.from({ length: 7 }, (_, i) => ({ date: addDays(today, i), rh_mean_pct: humidity, tmin_c: low, tmax_c: high, precip_mm: i === 0 ? rain : 0 }));
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today in the visitor's own time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/* ------------------------------------------------------------------ climate.py (the Climate-Smart Shield) */
export type CheckKind = 'heavy_rain' | 'heat' | 'flood' | 'disease';
export type CheckLevel = 'warn' | 'clear' | 'unknown';
export const KINDS: CheckKind[] = ['heavy_rain', 'heat', 'flood', 'disease'];
export interface Citation {
  rule_id: string;
  version: number;
  applies: boolean;
  title: { en: string; bn: string } | null;
  review_level: string;
  source: RuleSource & Doc;
}
export interface Check {
  kind: CheckKind;
  level: CheckLevel;
  days: string[];
  peak: { date: string | null; value: number; unit: string; trend?: string; of?: number; min?: number } | null;
  thresholds: Param[];
  reason: string | null;
  rule: Citation | null;
  rule_withdrawn: string | null;
  context: { fact_id: string; source: string; url: string; text: Record<string, string> } | null;
}
export interface River {
  trend: 'rising' | 'stable' | 'falling';
  discharge: { date: string; m3s: number }[];
}
export interface ShieldReport {
  warnings: number;
  checks: Check[];
}

function link(kind: CheckKind, pack: PackId, facts: Facts, isRecalled: (id: string, v: number) => boolean): [Citation | null, string | null] {
  const hit = DATA.shield.links[pack]?.[kind];
  if (!hit) return [null, null];
  const rule = ruleById(pack, hit.rule_id);
  if (!rule || (rule.status ?? 'active') !== 'active') return [null, null];
  if (isRecalled(rule.rule_id, rule.version)) return [null, `${rule.rule_id} v${rule.version}`];
  const holds = hit.show_action ? evaluate(rule, facts)[0] : null;
  if (holds === false) return [null, null];
  const src = rule.sources[hit.quote]!;
  return [
    {
      rule_id: rule.rule_id,
      version: rule.version,
      applies: holds === true,
      title: holds === true ? { ...rule.action.title } : null,
      review_level: rule.review_level,
      source: { ...src, ...DATA.docs[src.doc_id]! },
    },
    null,
  ];
}

const maxBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((best, x) => (f(x) > f(best) ? x : best), xs[0]!);
const check = (kind: CheckKind, level: CheckLevel, kw: Partial<Check> = {}): Check => ({
  kind,
  level,
  days: kw.days ?? [],
  peak: kw.peak ?? null,
  thresholds: kw.thresholds ?? [],
  reason: kw.reason ?? null,
  rule: kw.rule ?? null,
  rule_withdrawn: kw.rule_withdrawn ?? null,
  context: kw.context ?? null,
});

/** climate.shield() on a live 7-day week: heavy rain, heat, the river, and weather that favours disease. */
export function shield(
  pack: PackId,
  stage: string,
  country: 'BD' | 'KE',
  profile: Facts,
  allDays: Day[],
  river: River | null,
  today: string,
  isRecalled: (id: string, v: number) => boolean = () => false,
): ShieldReport {
  const { params, defs } = DATA.packs[pack];
  const team = DATA.shield.team_params;
  const days = windowDays(allDays, today);
  const noFc = !allDays.length ? 'no_forecast' : days.length < DATA.min_days ? 'too_few_days' : null;
  const wf = noFc ? { forecast_humid_mild_days: null, forecast_heavy_rain_days: null } : weatherFacts(allDays, params, today);
  const facts: Facts = { stage, ...wf, ...profile };
  const ctx = (kind: string) => DATA.shield.context[country]?.[kind] ?? null;
  const checks: Check[] = [];

  // heavy rain
  let th = defs.heavy_rain_mm ? [defs.heavy_rain_mm] : [];
  if (noFc || !th.length) checks.push(check('heavy_rain', 'unknown', { reason: noFc ?? 'no_threshold', thresholds: th }));
  else if (days.some((d) => d.precip_mm == null)) checks.push(check('heavy_rain', 'unknown', { reason: 'missing_variable', thresholds: th }));
  else {
    const mm = Number(params.heavy_rain_mm);
    const wet = days.filter((d) => d.precip_mm! >= mm);
    const peak = maxBy(days, (d) => d.precip_mm!);
    const [rule, withdrawn] = wet.length ? link('heavy_rain', pack, facts, isRecalled) : [null, null];
    checks.push(
      check('heavy_rain', wet.length ? 'warn' : 'clear', {
        days: wet.map((d) => d.date),
        thresholds: th,
        peak: { date: peak.date, value: peak.precip_mm!, unit: 'mm' },
        rule,
        rule_withdrawn: withdrawn,
      }),
    );
  }

  // heat
  th = [team.heat_tmax_c!];
  if (noFc) checks.push(check('heat', 'unknown', { reason: noFc, thresholds: th }));
  else if (days.some((d) => d.tmax_c == null)) checks.push(check('heat', 'unknown', { reason: 'missing_variable', thresholds: th }));
  else {
    const hot = days.filter((d) => d.tmax_c! >= team.heat_tmax_c!.value);
    const peak = maxBy(days, (d) => d.tmax_c!);
    checks.push(
      check('heat', hot.length ? 'warn' : 'clear', {
        days: hot.map((d) => d.date),
        thresholds: th,
        peak: { date: peak.date, value: peak.tmax_c!, unit: 'C' },
        context: hot.length ? ctx('heat') : null,
      }),
    );
  }

  // flood (the river's discharge forecast, when there is one)
  th = [team.flood_rise_pct!];
  if (!river || !river.discharge.length) checks.push(check('flood', 'unknown', { reason: 'no_river_forecast', thresholds: th }));
  else {
    const q = river.discharge;
    const peak = maxBy(q, (x) => x.m3s);
    const rising = river.trend === 'rising';
    checks.push(
      check('flood', rising ? 'warn' : 'clear', {
        thresholds: th,
        days: rising ? [q[q.length - 1]!.date] : [],
        peak: { date: peak.date, value: peak.m3s, unit: 'm3/s', trend: river.trend },
        context: rising ? ctx('flood') : null,
      }),
    );
  }

  // weather that favours disease (the planner's humid-and-mild count)
  th = (['humid_rh_pct_min', 'mild_temp_c_range', 'humid_mild_days_min'] as const).filter((n) => defs[n]).map((n) => defs[n]!);
  const n = wf.forecast_humid_mild_days;
  if (noFc || n == null || params.humid_mild_days_min == null) {
    checks.push(check('disease', 'unknown', { reason: noFc ?? (n == null ? 'missing_variable' : 'no_threshold'), thresholds: th }));
  } else {
    const rhMin = Number(params.humid_rh_pct_min);
    const [lo, hi] = parseRange(params.mild_temp_c_range);
    const favour = days.filter((d) => d.rh_mean_pct! >= rhMin && lo <= d.tmin_c! && d.tmax_c! <= hi).map((d) => d.date);
    const min = Number(params.humid_mild_days_min);
    const warn = n >= min;
    const [rule, withdrawn] = warn ? link('disease', pack, facts, isRecalled) : [null, null];
    checks.push(
      check('disease', warn ? 'warn' : 'clear', {
        days: favour,
        thresholds: th,
        peak: { date: null, value: n, unit: 'days', of: days.length, min },
        rule,
        rule_withdrawn: withdrawn,
      }),
    );
  }
  return { warnings: checks.filter((c) => c.level === 'warn').length, checks };
}

/** The weather tool's practice river (tools/build_try_data.py river): 400 m3/s moving 30% over the week, called
 * rising / stable / falling by the snapshot's own 10% rule (services/engine/snapshot.py). */
export function practiceRiver(trend: 'none' | 'rising' | 'stable' | 'falling', today: string): River | null {
  if (trend === 'none') return null;
  const end = { rising: 1.3, stable: 1.0, falling: 0.7 }[trend];
  const q = Array.from({ length: 7 }, (_, i) => Math.round(400 * (1 + ((end - 1) * i) / 6) * 10) / 10);
  const t = q[6]! > q[0]! * 1.1 ? 'rising' : q[6]! < q[0]! * 0.9 ? 'falling' : 'stable';
  return { trend: t, discharge: q.map((m3s, i) => ({ date: addDays(today, i), m3s })) };
}
