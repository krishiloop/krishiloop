import { createStore } from '../../lib/store';
import { queryParam, readJSON, writeJSON } from '../../lib/storage';
import { apiStore, fetchDemo, fetchPlan, fetchSnapshot, HttpError, PLAN_CACHE_PREFIX, recallEpoch, setForcedSample } from '../../lib/api/client';
import { SCENARIOS, type Scenario } from '../../lib/api/mocks';
import type { DataSource, DemoField, DemoProfile, FieldSnapshot, Plan, Sourced } from '../../lib/api/types';

/**
 * State of the farmer app: which field + farmer profile, the plan (live or sample), its snapshot.
 * Plans are built inside this tab's demo sandbox (POST /api/demo/{sid}/plan), so a recall from the verifier changes
 * exactly these receipts. Building a plan makes the API sign new credentials, so plans are cached per selection in
 * sessionStorage (the same lifetime as the sandbox) and rebuilt only when asked: a reload must never mint a new pile.
 */
export interface FarmerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  fields: DemoField[];
  profiles: DemoProfile[];
  fieldId: string | null;
  profileId: string | null;
  plan: Plan | null;
  planSource: DataSource | null;
  planAt: number | null;
  /** the plan on screen came from the saved copy, not a fresh call */
  cached: boolean;
  snapshot: FieldSnapshot | null;
  error: string | null;
  scenario: Scenario;
  /** sample scenario with the money counter */
  money: boolean;
}

const initial: FarmerState = {
  status: 'idle',
  fields: [],
  profiles: [],
  fieldId: null,
  profileId: null,
  plan: null,
  planSource: null,
  planAt: null,
  cached: false,
  snapshot: null,
  error: null,
  scenario: 'live',
  money: false,
};

export const farmer = createStore<FarmerState>(initial);
export const useFarmer = () => farmer.use();

const SEL_KEY = 'kl.farmer.sel';
const TTL = 6 * 3600 * 1000;
const cacheKey = (f: string, p: string) => `${PLAN_CACHE_PREFIX}${f}.${p}`;

// a recall in the sandbox changes what the planner would answer: forget the plan on screen so the app rebuilds it
recallEpoch.subscribe(() => farmer.set((s) => ({ ...s, status: 'idle', plan: null, snapshot: null, cached: false })));
let inflight: Promise<void> | null = null;

interface Cached {
  plan: Plan;
  at: number;
  snapshot: FieldSnapshot | null;
}

export function init(): Promise<void> {
  if (farmer.get().status === 'ready' || farmer.get().status === 'loading') return inflight ?? Promise.resolve();
  farmer.set((s) => ({ ...s, status: 'loading', error: null }));
  inflight = (async () => {
    try {
      const demo = await fetchDemo();
      const sel = readJSON<{ fieldId: string; profileId: string }>(SEL_KEY);
      const fields = demo.data.fields;
      const profiles = demo.data.profiles;
      const fieldId = fields.find((f) => f.field_id === sel?.fieldId)?.field_id ?? fields[0]?.field_id ?? null;
      const profileId = profiles.find((p) => p.farmer_profile_id === sel?.profileId)?.farmer_profile_id ?? profiles[0]?.farmer_profile_id ?? null;
      farmer.set((s) => ({ ...s, fields, profiles, fieldId, profileId }));
      await loadPlan();
    } catch (e) {
      farmer.set((s) => ({ ...s, status: 'error', error: message(e) }));
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function message(e: unknown): string {
  if (e instanceof HttpError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export async function loadPlan(opts: { force?: boolean } = {}): Promise<void> {
  const { fieldId, profileId, money } = farmer.get();
  if (!fieldId || !profileId) {
    farmer.set((s) => ({ ...s, status: 'ready', plan: null }));
    return;
  }
  const sample = apiStore.get().forced;
  const key = cacheKey(fieldId, profileId);
  if (!opts.force && !sample) {
    const hit = readJSON<Cached>(key, 'session');
    if (hit && Date.now() - hit.at < TTL) {
      const snap = hit.snapshot ?? (await fetchSnapshot(hit.plan, 'live')).data;
      farmer.set((s) => ({ ...s, status: 'ready', plan: hit.plan, planSource: 'live', planAt: hit.at, cached: true, snapshot: snap, error: null }));
      return;
    }
  }
  farmer.set((s) => ({ ...s, status: 'loading', error: null }));
  try {
    const p = await fetchPlan(fieldId, profileId, { money, sample });
    const snap = await fetchSnapshot(p.data, p.source);
    const at = Date.now();
    if (p.source === 'live') writeJSON(key, { plan: p.data, at, snapshot: snap.data } satisfies Cached, 'session');
    farmer.set((s) => ({ ...s, status: 'ready', plan: p.data, planSource: p.source, planAt: at, cached: false, snapshot: snap.data, error: null }));
  } catch (e) {
    farmer.set((s) => ({ ...s, status: 'error', error: message(e) }));
  }
}

export function selectField(fieldId: string) {
  writeJSON(SEL_KEY, { fieldId, profileId: farmer.get().profileId });
  farmer.set((s) => ({ ...s, fieldId, scenario: apiStore.get().forced ? s.scenario : 'live' }));
  void loadPlan();
}

export function selectProfile(profileId: string) {
  writeJSON(SEL_KEY, { fieldId: farmer.get().fieldId, profileId });
  farmer.set((s) => ({ ...s, profileId }));
  void loadPlan();
}

/**
 * ?field=BD-SAMPLE-02&profile=demo-farmer-d (the photo demo link on the trust page): once the lists are loaded, select that
 * field and farmer in one step, so only one plan is built. Ids the API does not know are ignored.
 */
export function applyDeepLink() {
  const st = farmer.get();
  const f = queryParam('field');
  const p = queryParam('profile');
  const fieldId = f && st.fields.some((x) => x.field_id === f) ? f : st.fieldId;
  const profileId = p && st.profiles.some((x) => x.farmer_profile_id === p) ? p : st.profileId;
  if (!fieldId || !profileId || (fieldId === st.fieldId && profileId === st.profileId)) return;
  writeJSON(SEL_KEY, { fieldId, profileId });
  farmer.set((s) => ({ ...s, fieldId, profileId, scenario: apiStore.get().forced ? s.scenario : 'live' }));
  void loadPlan();
}

/** Switch between the live API and bundled sample data. */
export async function chooseSource(source: DataSource) {
  setForcedSample(source === 'sample');
  farmer.set((s) => ({ ...s, scenario: source === 'sample' ? (s.scenario === 'live' ? 'ke-a' : s.scenario) : 'live', money: source === 'sample' ? s.money : false, status: 'idle' }));
  await init();
}

export async function applyScenario(id: Scenario) {
  if (id === 'live') return chooseSource('live');
  const sc = SCENARIOS.find((s) => s.id === id)!;
  setForcedSample(true);
  writeJSON(SEL_KEY, { fieldId: sc.field, profileId: sc.profile });
  farmer.set((s) => ({ ...s, scenario: id, money: !!sc.money, fieldId: sc.field, profileId: sc.profile, status: 'idle' }));
  await init();
}

let demoPlan: Promise<Sourced<Plan>> | null = null;

/**
 * One demo plan for the story page (hero receipt, "AI vs KrishiLoop"): the OFFICIAL plan (POST /api/plan), which the server
 * keeps one of per day, so opening the story page never mints a pile of receipts and never creates a sandbox. The farmer
 * app and the recall controls use the visitor's own sandbox instead.
 */
export function ensureDemoPlan(): Promise<Sourced<Plan>> {
  demoPlan ??= fetchPlan('KE-SAMPLE-01', 'demo-farmer-a', { sample: apiStore.get().forced, official: true }).catch((e) => {
    demoPlan = null;
    throw e;
  });
  return demoPlan;
}
