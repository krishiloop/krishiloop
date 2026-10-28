import { createStore } from '../../lib/store';
import { readJSON, writeJSON, writeStore } from '../../lib/storage';
import { apiStore, fetchDemo, fetchPlan, fetchSnapshot, HttpError, PLAN_CACHE_PREFIX, recallEpoch, sessionStore } from '../../lib/api/client';
import { sampleRecalls } from '../../lib/api/mocks';
import type { DataSource, DemoField, DemoProfile, FieldSnapshot, Plan } from '../../lib/api/types';
import { logBoot, logError, logPlan, logRecall } from './inspector';
import { holdPlan, refreshStatuses } from './receipts';
import { tick } from './checklist';
import { profilesFor } from './words';

/**
 * State of the farmer app: the demo field and farmer, this week's plan, and the forecast behind it.
 *
 * Plans are built inside this tab's demo sandbox (POST /api/demo/{sid}/plan), so a recall in the officer console changes
 * exactly these receipts. Building a plan signs new credentials, so a plan is kept per field and farmer for the tab
 * (sessionStorage, the sandbox's own lifetime) and rebuilt only when asked: a reload never mints a new pile.
 * When a recall reaches this tab (a sandbox recall, or a simulated one with recorded data) the plan on screen is dropped
 * and rebuilt, so the farmer sees the server's answer after the recall (an abstention), never the stale decision.
 */
export interface FarmerState {
  boot: 'idle' | 'loading' | 'ready' | 'error';
  fields: DemoField[];
  profiles: DemoProfile[];
  fieldId: string | null;
  profileId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  plan: Plan | null;
  planSource: DataSource | null;
  /** the plan on screen is the copy kept for this tab, not a fresh call */
  cached: boolean;
  /** the plan was rebuilt because a recall reached this tab */
  afterRecall: boolean;
  /** the plan was built with a photo case the server answered automatically */
  photoCaseId: string | null;
  snapshot: FieldSnapshot | null;
  error: string | null;
}

const initial: FarmerState = {
  boot: 'idle',
  fields: [],
  profiles: [],
  fieldId: null,
  profileId: null,
  status: 'idle',
  plan: null,
  planSource: null,
  cached: false,
  afterRecall: false,
  photoCaseId: null,
  snapshot: null,
  error: null,
};

export const farmer = createStore<FarmerState>(initial);
export const useFarmer = () => farmer.use();

const SEL_KEY = 'kl.farmer.sel';
const TTL = 6 * 3600 * 1000;
/** The home market first: Bangladesh rice, the farmer whose rule the recorded recall withdrew. */
const DEFAULT = { field: 'BD-SAMPLE-02', profile: 'demo-farmer-d' };
const cacheKey = (f: string, p: string) => `${PLAN_CACHE_PREFIX}${f}.${p}`;

interface Cached {
  plan: Plan;
  at: number;
  snapshot: FieldSnapshot | null;
}

function message(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ mount, so a recall can rebuild the plan at once */
let mounted = 0;
export function attach() {
  mounted++;
  return () => {
    mounted--;
  };
}

/**
 * Forget the plans kept for this tab. client.ts clearSavedPlans() removes them from sessionStorage, but lib/storage keeps
 * an in-memory copy of every value it wrote and reads it back when sessionStorage has none, so a recall would otherwise
 * be answered with the stale plan. Clearing through lib/storage drops both copies.
 */
function dropSavedPlans() {
  const { fields, profiles } = farmer.get();
  for (const f of fields) for (const p of profiles) writeStore(cacheKey(f.field_id, p.farmer_profile_id), null, 'session');
}

function onRecall(mode: 'sandbox' | 'sample') {
  dropSavedPlans();
  logRecall(mode);
  tick('recall');
  farmer.set((s) => ({ ...s, status: 'idle', plan: null, snapshot: null, cached: false, photoCaseId: null, afterRecall: true }));
  if (mounted > 0 && farmer.get().boot === 'ready') void loadPlan();
  void refreshStatuses();
}
recallEpoch.subscribe(() => onRecall('sandbox'));
sampleRecalls.subscribe(() => onRecall('sample'));
// a new sandbox (the server forgot the old one) owns none of the saved plans
sessionStore.subscribe(() => {
  if (sessionStore.get() === null) dropSavedPlans();
});

/* ------------------------------------------------------------------ selection */

function fitSelection(fields: DemoField[], profiles: DemoProfile[], want: { fieldId?: string | null; profileId?: string | null }) {
  const saved = readJSON<{ fieldId?: string; profileId?: string }>(SEL_KEY);
  const has = (id: string | null | undefined) => !!id && fields.some((f) => f.field_id === id);
  const fieldId = [want.fieldId, saved?.fieldId, DEFAULT.field].find(has) ?? fields[0]?.field_id ?? null;
  const fit = profilesFor(fieldId, profiles);
  const ok = (id: string | null | undefined) => !!id && fit.some((p) => p.farmer_profile_id === id);
  const profileId = [want.profileId, saved?.profileId, DEFAULT.profile].find(ok) ?? fit[0]?.farmer_profile_id ?? null;
  return { fieldId, profileId };
}

let bootCall: Promise<void> | null = null;

/** Load the demo fields and farmers once, pick the deep-linked (or saved) field and farmer, and build the plan. */
export function init(want: { fieldId?: string | null; profileId?: string | null } = {}): Promise<void> {
  const st = farmer.get();
  if (st.boot === 'ready') {
    if (want.fieldId || want.profileId) {
      const sel = fitSelection(st.fields, st.profiles, want);
      if (sel.fieldId !== st.fieldId || sel.profileId !== st.profileId) return select(sel.fieldId, sel.profileId);
    }
    return st.status === 'idle' ? loadPlan() : Promise.resolve();
  }
  bootCall ??= (async () => {
    farmer.set((s) => ({ ...s, boot: 'loading', error: null }));
    try {
      const demo = await fetchDemo();
      const { fields, profiles } = demo.data;
      logBoot(demo.source, fields.length, profiles.length);
      const sel = fitSelection(fields, profiles, want);
      farmer.set((s) => ({ ...s, boot: 'ready', fields, profiles, ...sel }));
      await loadPlan();
    } catch (e) {
      logError('GET /api/demo', message(e));
      farmer.set((s) => ({ ...s, boot: 'error', error: message(e) }));
    } finally {
      bootCall = null;
    }
  })();
  return bootCall;
}

export function select(fieldId: string | null, profileId?: string | null): Promise<void> {
  const st = farmer.get();
  const fit = profilesFor(fieldId, st.profiles);
  const pid = profileId && fit.some((p) => p.farmer_profile_id === profileId) ? profileId : fit.some((p) => p.farmer_profile_id === st.profileId) ? st.profileId : (fit[0]?.farmer_profile_id ?? null);
  writeJSON(SEL_KEY, { fieldId, profileId: pid });
  farmer.set((s) => ({ ...s, fieldId, profileId: pid, afterRecall: false, photoCaseId: null }));
  return loadPlan();
}

/* ------------------------------------------------------------------ the plan */
let planSeq = 0;

/**
 * Build (or reuse) this week's plan for the selected field and farmer.
 * `force` asks the server again; `photoCaseId` rebuilds it with a photo case the server answered automatically.
 */
export async function loadPlan(opts: { force?: boolean; photoCaseId?: string } = {}): Promise<void> {
  const { fieldId, profileId } = farmer.get();
  if (!fieldId || !profileId) {
    farmer.set((s) => ({ ...s, status: 'ready', plan: null }));
    return;
  }
  const token = ++planSeq;
  const forced = apiStore.get().forced;
  const key = cacheKey(fieldId, profileId);
  if (!opts.force && !forced && !opts.photoCaseId) {
    const hit = readJSON<Cached>(key, 'session');
    if (hit && Date.now() - hit.at < TTL && hit.plan.field_id === fieldId) {
      const snapshot = hit.snapshot ?? (await fetchSnapshot(hit.plan, 'live').catch(() => ({ data: null }))).data;
      if (token !== planSeq) return;
      farmer.set((s) => ({ ...s, status: 'ready', plan: hit.plan, planSource: 'live', cached: true, photoCaseId: null, snapshot, error: null }));
      logPlan(hit.plan, 'live', { cached: true });
      holdPlan(hit.plan, 'live');
      return;
    }
  }
  farmer.set((s) => ({ ...s, status: 'loading', error: null }));
  try {
    const p = await fetchPlan(fieldId, profileId, { sample: forced, photoCaseId: opts.photoCaseId });
    const snap = await fetchSnapshot(p.data, p.source).catch(() => ({ data: null }));
    if (token !== planSeq) return;
    if (p.source === 'live' && !opts.photoCaseId) writeJSON(key, { plan: p.data, at: Date.now(), snapshot: snap.data } satisfies Cached, 'session');
    farmer.set((s) => ({ ...s, status: 'ready', plan: p.data, planSource: p.source, cached: false, photoCaseId: opts.photoCaseId ?? null, snapshot: snap.data, error: null }));
    logPlan(p.data, p.source, { photoCaseId: opts.photoCaseId });
    holdPlan(p.data, p.source);
  } catch (e) {
    if (token !== planSeq) return;
    logError(forced ? 'recorded · plans.json' : 'POST /api/demo/‹sid›/plan', message(e));
    farmer.set((s) => ({ ...s, status: 'error', error: message(e) }));
  }
}

export const currentField = (s: FarmerState = farmer.get()) => s.fields.find((f) => f.field_id === s.fieldId) ?? null;
