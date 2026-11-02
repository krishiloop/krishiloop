import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import { apiStore, currentSessionId, fetchDemo, fetchPlan, forgetSession, recallRule, verifyReceipt, type RecallNotified } from '../../lib/api/client';
import { resetSampleRecalls } from '../../lib/api/mocks';
import type { Action, ActionKind, Decision, DemoField, DemoPayload, DemoProfile, I18nText, Plan, ReviewLevel, TrafficLight } from '../../lib/api/types';
import { forgetRecalls, logRecall } from './recallLog';

/**
 * The receipts of THIS visitor's sandbox and the rules they cite: what "Rules & recall" shows and what a recall reaches.
 *
 *  live      the demo plans are built in this tab's sandbox (POST /api/demo/{sid}/plan for each demo field and the
 *            profiles that fit it), so real signed receipts exist there. The server keeps one plan per field and profile per
 *            session, so building them again returns the same receipts. A recall is POST /api/demo/{sid}/recall; every
 *            affected receipt is then verified again (GET /api/verify/{id}) and the farmer plans that used the rule are
 *            rebuilt, so the screen shows the server's own answers: "Recalled", and a plan that now abstains.
 *  recorded  the recorded plans and Ask answers of our server (src/data/recorded). A recall is simulated in this browser
 *            (lib/api/mocks.ts) with the server's rule, and the recorded receipts then verify as recalled. Labelled.
 *
 * The receipt list is kept per tab (sessionStorage) for the sandbox it belongs to: after a recall the plans no longer cite
 * the rule, so the receipts that did would otherwise vanish from the screen.
 */
export interface LedgerReceipt {
  id: string;
  rules: { rule_id: string; version: number; review_level: ReviewLevel }[];
  field: string;
  profile: string;
  pack: string;
  crop: string;
  kind: ActionKind;
  decision?: Decision;
  light?: TrafficLight;
  title: I18nText;
  from: 'plan' | 'ask';
  issued: string;
}
export type ReceiptState = 'authentic' | 'recalled' | 'invalid' | 'unknown';
export interface PlanOutcome {
  field: string;
  profile: string;
  status: 'ok' | 'abstained';
  reason_code?: string;
  inbox_item_id?: string;
}
export interface RecallRecord {
  rule_id: string;
  version: number;
  reason: string;
  at: string;
  /** receipts in this sandbox that cite the rule version */
  affected: string[];
  /** ...of which the verifier now says "recalled" (asked again after the recall) */
  recalledNow: string[];
  /** the farmer plans that used it, built again */
  replans: PlanOutcome[];
  mode: 'sandbox' | 'sample';
  /** the server's recall notices to the receipts' holders (Telegram, sandbox SMS); absent for a simulated recall */
  notified?: RecallNotified;
}
export interface LedgerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  source: 'live' | 'recorded' | null;
  /** the sandbox these receipts belong to ('recorded' for the recordings) */
  sid: string | null;
  receipts: LedgerReceipt[];
  states: Record<string, ReceiptState>;
  plans: PlanOutcome[];
  recalls: RecallRecord[];
  error?: string;
}

const KEY = 'kl.officer.ledger';
type Saved = Pick<LedgerState, 'source' | 'sid' | 'receipts' | 'states' | 'recalls' | 'plans'>;
const saved = readJSON<Saved>(KEY, 'session');
export const ledger = createStore<LedgerState>({ status: 'idle', source: null, sid: null, receipts: [], states: {}, plans: [], recalls: [], ...(saved ?? {}) });
ledger.subscribe(() => {
  const { source, sid, receipts, states, recalls, plans } = ledger.get();
  if (source) writeJSON(KEY, { source, sid, receipts, states, recalls, plans } satisfies Saved, 'session');
});
export const useLedger = () => ledger.use();

/* ------------------------------------------------------------------ which demo profiles fit which demo field */
/**
 * A demo profile carries the inputs of one crop's rules: rice profiles carry planthopper counts (bph_*), potato profiles
 * say whether the crop is protected. A profile of another shape fits every field. (Demo glue only: the engine never
 * reads this.)
 */
export function fits(p: DemoProfile, f: DemoField): boolean {
  const keys = Object.keys(p);
  const pests = keys.some((k) => k.startsWith('bph_'));
  const guard = keys.includes('crop_protected');
  if (pests && !guard) return f.crop === 'rice';
  if (guard && !pests) return f.crop === 'potato';
  return true;
}
export const pairsOf = (demo: DemoPayload) => demo.fields.flatMap((f) => demo.profiles.filter((p) => fits(p, f)).map((p) => ({ field: f.field_id, profile: p.farmer_profile_id })));

function receiptOf(a: Action, plan: Pick<Plan, 'field_id' | 'farmer_profile_id' | 'pack_id' | 'crop'>, from: LedgerReceipt['from']): LedgerReceipt | null {
  if (!a.receipt_credential_id) return null;
  return {
    id: a.receipt_credential_id,
    rules: a.receipt.rule_refs.map((r) => ({ rule_id: r.rule_id, version: r.version, review_level: r.review_level })),
    field: plan.field_id,
    profile: plan.farmer_profile_id,
    pack: plan.pack_id,
    crop: plan.crop,
    kind: a.kind,
    decision: a.decision,
    light: a.traffic_light,
    title: a.title,
    from,
    issued: a.receipt.created_at,
  };
}

const outcomeOf = (p: Plan): PlanOutcome => ({ field: p.field_id, profile: p.farmer_profile_id, status: p.status, reason_code: p.abstention?.reason_code, inbox_item_id: p.abstention?.inbox_item_id });

const merge = (old: LedgerReceipt[], fresh: LedgerReceipt[]) => {
  const seen = new Set(old.map((r) => r.id));
  return [...old, ...fresh.filter((r) => !seen.has(r.id))];
};

let loading: Promise<void> | null = null;

/**
 * Build the ledger: live plans in the sandbox, or the recordings. Concurrent calls share one run. A tab that already built
 * the plans for its sandbox keeps them (`rebuild` asks again): after a recall the server re-issues receipts for every plan it
 * builds, so asking on every visit would mint new receipts each time.
 */
export function loadLedger(opts: { rebuild?: boolean } = {}): Promise<void> {
  loading ??= run(!!opts.rebuild).finally(() => {
    loading = null;
  });
  return loading;
}

async function run(rebuild: boolean) {
  const cur = ledger.get();
  if (!rebuild && !apiStore.get().forced && cur.source === 'live' && cur.receipts.length > 0 && cur.sid !== null && cur.sid === currentSessionId()) {
    ledger.set((s) => ({ ...s, status: 'ready', error: undefined }));
    return;
  }
  ledger.set((s) => ({ ...s, status: s.receipts.length ? s.status : 'loading', error: undefined }));
  try {
    const demo = await fetchDemo();
    if (demo.source === 'sample') return await loadRecordedLedger();
    const pairs = pairsOf(demo.data);
    const results = await Promise.allSettled(pairs.map((p) => fetchPlan(p.field, p.profile)));
    const plans = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (plans.length && plans.every((p) => p.source === 'sample')) return await loadRecordedLedger(); // the API went away mid-way
    const sid = currentSessionId();
    const fresh = plans.filter((p) => p.source === 'live').flatMap((p) => (p.data.actions ?? []).map((a) => receiptOf(a, p.data, 'plan')).filter((x): x is LedgerReceipt => !!x));
    ledger.set((s) => {
      const same = s.source === 'live' && s.sid === sid;
      const receipts = merge(same ? s.receipts : [], fresh);
      const states: Record<string, ReceiptState> = same ? { ...s.states } : {};
      for (const r of fresh) states[r.id] ??= 'authentic';
      return {
        status: plans.length || !pairs.length ? 'ready' : 'error',
        source: 'live',
        sid,
        receipts,
        states,
        plans: plans.map((p) => outcomeOf(p.data)),
        recalls: same ? s.recalls : [],
        error: plans.length || !pairs.length ? undefined : 'plans',
      };
    });
  } catch (e) {
    ledger.set((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : String(e) }));
  }
}

/** The recorded plans and Ask answers, with the simulated recalls of this browser applied. */
async function loadRecordedLedger() {
  const { loadRecorded } = await import('../../data/recorded');
  const rec = await loadRecorded();
  const receipts: LedgerReceipt[] = [];
  for (const plan of Object.values(rec.plans)) for (const a of plan.actions ?? []) {
    const r = receiptOf(a, plan, 'plan');
    if (r) receipts.push(r);
  }
  for (const ask of rec.asks) {
    const answer = (ask.response as { answer?: { receipt_credential_id?: string; action?: Action } }).answer;
    const pack = (ask.response as { pack_id?: string }).pack_id ?? '';
    const crop = (ask.response as { crop?: string }).crop ?? '';
    if (answer?.action && answer.receipt_credential_id) {
      const r = receiptOf({ ...answer.action, receipt_credential_id: answer.receipt_credential_id }, { field_id: ask.field_id, farmer_profile_id: ask.profile_id, pack_id: pack, crop }, 'ask');
      if (r && !receipts.some((x) => x.id === r.id)) receipts.push(r);
    }
  }
  ledger.set((s) => {
    const same = s.source === 'recorded';
    const states: Record<string, ReceiptState> = {};
    for (const r of receipts) states[r.id] = (same && s.states[r.id]) || 'authentic';
    return { status: 'ready', source: 'recorded', sid: 'recorded', receipts, states, plans: Object.values(rec.plans).map(outcomeOf), recalls: same ? s.recalls : [], error: undefined };
  });
}

/* ------------------------------------------------------------------ the recall */
export type RecallOutcome = { ok: true; record: RecallRecord } | { ok: false; message: string };

export const citesRule = (r: LedgerReceipt, ruleId: string, version: number) => r.rules.some((x) => x.rule_id === ruleId && x.version === version);

export async function recall(ruleId: string, version: number, reason: string): Promise<RecallOutcome> {
  const st = ledger.get();
  const sample = st.source === 'recorded';
  const res = await recallRule(ruleId, version, { reason, sample });
  if (!res.ok) return { ok: false, message: res.message ?? '' };
  const at = new Date().toISOString();
  const affected = st.receipts.filter((r) => citesRule(r, ruleId, version));
  // ask the verifier again, receipt by receipt: the count on screen is its answer, not ours
  const answers = await Promise.all(
    affected.map(async (r) => {
      try {
        const o = await verifyReceipt(r.id);
        return [r.id, (o.status === 'unreachable' ? 'unknown' : o.status) as ReceiptState] as const;
      } catch {
        return [r.id, 'unknown' as ReceiptState] as const;
      }
    }),
  );
  // the farmer plans that used the rule, built again: the planner no longer serves it
  const pairs = [...new Set(affected.filter((r) => r.from === 'plan').map((r) => `${r.field}|${r.profile}`))];
  const replans = (
    await Promise.all(
      pairs.map(async (key) => {
        const [field, profile] = key.split('|') as [string, string];
        try {
          return outcomeOf((await fetchPlan(field, profile, { sample })).data);
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is PlanOutcome => !!x);
  const record: RecallRecord = {
    rule_id: ruleId,
    version,
    reason,
    at,
    affected: affected.map((r) => r.id),
    recalledNow: answers.filter(([, s]) => s === 'recalled').map(([id]) => id),
    replans,
    mode: sample ? 'sample' : 'sandbox',
    ...(res.notified ? { notified: res.notified } : {}),
  };
  ledger.set((s) => {
    const states = { ...s.states };
    for (const [id, state] of answers) states[id] = state;
    const plans = s.plans.map((p) => replans.find((x) => x.field === p.field && x.profile === p.profile) ?? p);
    return { ...s, states, plans, recalls: [...s.recalls.filter((x) => !(x.rule_id === ruleId && x.version === version)), record] };
  });
  logRecall({ rule_id: ruleId, version, reason, at, mode: record.mode, sid: sample ? null : currentSessionId() });
  return { ok: true, record };
}

/** Start again: a new sandbox (live), or the recorded receipts with no simulated recall. */
export async function resetSandbox() {
  const st = ledger.get();
  if (st.source === 'recorded') {
    resetSampleRecalls();
    forgetRecalls((e) => e.mode === 'sample');
    ledger.set((s) => ({ ...s, states: Object.fromEntries(s.receipts.map((r) => [r.id, 'authentic' as ReceiptState])), recalls: [] }));
    return loadLedger();
  }
  const old = st.sid;
  forgetSession();
  forgetRecalls((e) => e.mode === 'sandbox' && e.sid === old);
  ledger.set({ status: 'loading', source: null, sid: null, receipts: [], states: {}, plans: [], recalls: [] });
  return loadLedger({ rebuild: true });
}

/* ------------------------------------------------------------------ rules, as the screen lists them */
export interface RuleRow {
  key: string;
  rule_id: string;
  version: number;
  review_level: ReviewLevel;
  pack: string;
  crop: string;
  /** what the rule says, as the advice title of a receipt that cites it */
  title: I18nText;
  receipts: LedgerReceipt[];
  recall: RecallRecord | null;
}

export function rulesOf(st: LedgerState): RuleRow[] {
  const map = new Map<string, RuleRow>();
  for (const r of st.receipts) {
    for (const ref of r.rules) {
      const key = `${ref.rule_id}@${ref.version}`;
      const row = map.get(key) ?? { key, rule_id: ref.rule_id, version: ref.version, review_level: ref.review_level, pack: r.pack, crop: r.crop, title: r.title, receipts: [], recall: null };
      row.receipts.push(r);
      map.set(key, row);
    }
  }
  for (const rec of st.recalls) {
    const row = map.get(`${rec.rule_id}@${rec.version}`);
    if (row) row.recall = rec;
  }
  return [...map.values()].sort((a, b) => a.pack.localeCompare(b.pack) || a.rule_id.localeCompare(b.rule_id) || a.version - b.version);
}
