/**
 * API client for the KrishiLoop FastAPI service (services/api/main.py, backend v0.4.0).
 *
 *   GET  /api/demo                         -> { fields, profiles }
 *   POST /api/plan {field_id, profile_id}  official plan (cached per day on the server; used by the story page)
 *   POST /api/demo/session                 -> { session_id }   a private sandbox: own status list, recalls and inbox
 *   POST /api/demo/{sid}/plan              the farmer app's plan (receipts live in the sandbox)
 *   POST /api/demo/{sid}/recall {rule_id, version, reason}   recall inside the sandbox only. No admin token anywhere.
 *   GET  /api/demo/{sid}/inbox | /stats    this session's cases and counters (GET /api/stats is the official one)
 *   GET  /api/verify/{id}                  -> { status, reason, credential, sandbox, expired? }: render ONLY `credential`
 *   GET  /api/snapshots/{snapshot_id}      the forecast behind a plan, with per-day `risk` and `risk_basis`
 *   GET  /api/packs                        crops with a rule pack (symptom signatures are "planned")
 *   GET  /.well-known/did.json, /status/{id}   issuer key and Bitstring Status Lists
 *
 * The session id is kept in sessionStorage (one sandbox per browser tab). If the server forgot it (restart, 24 h
 * expiry) the next call makes a new one, and the plans saved for the old one are dropped.
 *
 * When the API is unreachable (network error, 5xx from the dev proxy, timeout) every call falls back to the bundled
 * sample JSON (mocks.ts) and the result says so: `source: 'sample'`. 4xx answers are real answers (e.g. unknown field)
 * and are surfaced as errors, never hidden behind samples.
 */
import { createStore } from '../store';
import { queryParam, readStore, writeStore } from '../storage';
import { MOCK_DEMO, isSampleId, mockPlan, mockSnapshot, mockVerify, simulateRecall } from './mocks';
import type { DataSource, DemoPayload, DidDocument, Diagnosis, FieldSnapshot, InboxItem, PackInfo, Plan, Sourced, Stats, VerifyResponse } from './types';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiState {
  /** unknown until the first call answers */
  mode: 'unknown' | 'live' | 'sample';
  /** sample mode switched on by the visitor (?sample=1 or the demo drawer) */
  forced: boolean;
  reason: string | null;
}

const isForced = () => queryParam('sample') === '1' || readStore('kl.sample') === '1';
export const apiStore = createStore<ApiState>({ mode: 'unknown', forced: typeof window !== 'undefined' && isForced(), reason: null });
if (apiStore.get().forced) apiStore.set((s) => ({ ...s, mode: 'sample', reason: 'forced' }));

export function setForcedSample(on: boolean) {
  if (queryParam('sample') == null) writeStore('kl.sample', on ? '1' : null);
  apiStore.set({ mode: on ? 'sample' : 'unknown', forced: on, reason: on ? 'forced' : null });
}

export const useApiState = () => apiStore.use();

const detailText = (d: unknown): string => (typeof d === 'string' ? d : JSON.stringify(d));

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(path, { ...init, signal: ctrl.signal, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON: the dev proxy answers an unreachable API with a plain 5xx */
    }
    if (!res.ok) {
      const detail = body && typeof body === 'object' && 'detail' in body ? detailText((body as { detail: unknown }).detail) : res.statusText || `HTTP ${res.status}`;
      throw new HttpError(res.status, detail);
    }
    if (body === null) throw new HttpError(502, 'The API sent an empty answer.');
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Network failure, timeout or an upstream/proxy error: the API itself did not answer. */
export function isUnreachable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status >= 500;
  return e instanceof TypeError || (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError'));
}

function describe(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}`;
  if (e instanceof DOMException && e.name === 'AbortError') return 'timeout';
  return 'network';
}

async function sourced<T>(live: () => Promise<T>, sample: () => T): Promise<Sourced<T>> {
  if (apiStore.get().forced) return { data: sample(), source: 'sample', note: 'forced' };
  try {
    const data = await live();
    apiStore.set((s) => (s.mode === 'live' && s.reason === null ? s : { ...s, mode: 'live', reason: null }));
    return { data, source: 'live' };
  } catch (e) {
    if (isUnreachable(e)) {
      apiStore.set((s) => ({ ...s, mode: 'sample', reason: describe(e) }));
      return { data: sample(), source: 'sample', note: describe(e) };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ the demo sandbox (one per browser tab) */
const SID_KEY = 'kl.demo.sid';
/** plans saved for the sandbox of this tab (sessionStorage): `kl.plan.<field>.<profile>` */
export const PLAN_CACHE_PREFIX = 'kl.plan.';
const sessionStore = createStore<string | null>(readStore(SID_KEY, 'session'));
/** Bumped after every successful sandbox recall: screens that hold a plan rebuild it. */
export const recallEpoch = createStore(0);
let sessionCall: Promise<string> | null = null;

/** The demo session id of this tab, or null before the first sandbox call. Never kept beyond the tab. */
export const currentSessionId = () => sessionStore.get();
export const useSessionId = () => sessionStore.use();

/** Drop the plans saved for the sandbox (they belong to it). */
export function clearSavedPlans() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PLAN_CACHE_PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

export function forgetSession() {
  writeStore(SID_KEY, null, 'session');
  sessionStore.set(null);
  clearSavedPlans();
}

/** Make (or reuse) this tab's sandbox: POST /api/demo/session. */
export function ensureSession(): Promise<string> {
  const have = sessionStore.get();
  if (have) return Promise.resolve(have);
  sessionCall ??= request<{ session_id: string }>('/api/demo/session', { method: 'POST' }, 15000)
    .then((r) => {
      writeStore(SID_KEY, r.session_id, 'session');
      sessionStore.set(r.session_id);
      return r.session_id;
    })
    .finally(() => {
      sessionCall = null;
    });
  return sessionCall;
}

const isGoneSession = (e: unknown) => e instanceof HttpError && e.status === 404 && /session/i.test(e.message);

/** A call inside the sandbox. If the server no longer knows the session, one new session is made and the call retried. */
async function sandbox<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const sid = await ensureSession();
    try {
      return await request<T>(`/api/demo/${encodeURIComponent(sid)}${path}`, init, timeoutMs);
    } catch (e) {
      if (attempt === 0 && isGoneSession(e)) {
        forgetSession();
        continue;
      }
      throw e;
    }
  }
}

/** True when this (verified) credential's status list is the sandbox of THIS tab, so a recall here changes its verdict. */
export function isMySandboxCredential(statusListCredential: string | undefined): boolean {
  const sid = currentSessionId();
  return !!sid && !!statusListCredential && statusListCredential.endsWith(`/status/demo-${sid}`);
}

/* ------------------------------------------------------------------ data */
export const fetchDemo = () => sourced(() => request<DemoPayload>('/api/demo'), () => MOCK_DEMO);

/**
 * Build a plan.
 *  - default: inside this tab's demo sandbox, so a recall from the verifier changes THIS plan's receipts.
 *  - `official`: POST /api/plan (the server keeps one per day: used by the story page so it never mints a pile of receipts).
 *  - `diagnosis` (contracts/schemas/diagnosis.schema.json, never pixels) is sent as is. The SERVER decides whether the
 *    photo reading counts: the plan comes back with `diagnosis_used` and `diagnosis_note`. Sample readings are never sent
 *    (the callers guarantee it, and `toDiagnosis` throws for them).
 */
export function fetchPlan(fieldId: string, profileId: string, opts: { money?: boolean; sample?: boolean; diagnosis?: Diagnosis; official?: boolean } = {}): Promise<Sourced<Plan>> {
  if (opts.sample) return Promise.resolve({ data: mockPlan(fieldId, profileId, opts.money), source: 'sample' as DataSource, note: 'scenario' });
  const body = JSON.stringify({ field_id: fieldId, profile_id: profileId, ...(opts.diagnosis ? { diagnosis: opts.diagnosis } : {}) });
  return sourced(
    () => (opts.official ? request<Plan>('/api/plan', { method: 'POST', body }, 30000) : sandbox<Plan>('/plan', { method: 'POST', body }, 30000)),
    () => mockPlan(fieldId, profileId, opts.money),
  );
}

/**
 * The forecast behind a plan: GET /api/snapshots/{snapshot_id}, with a per-day `risk` (`high` / `low` / `unknown`) and the
 * `risk_basis` sentence. A live plan never borrows the bundled sample forecast: if the snapshot cannot be fetched the
 * calendar says there is no forecast. Only sample plans use the bundled copy.
 */
export async function fetchSnapshot(plan: Plan, planSource: DataSource): Promise<Sourced<FieldSnapshot | null>> {
  if (planSource === 'sample' || apiStore.get().forced) return { data: mockSnapshot(plan.field_id), source: 'sample', note: 'bundled-snapshot' };
  try {
    const data = await request<FieldSnapshot>(`/api/snapshots/${encodeURIComponent(plan.snapshot_id)}`);
    return { data, source: 'live' };
  } catch (e) {
    if (isUnreachable(e) || (e instanceof HttpError && e.status === 404)) return { data: null, source: 'live', note: 'snapshot-unavailable' };
    throw e;
  }
}

export type VerifyOutcome =
  | (VerifyResponse & { source: DataSource })
  /** the verifier could not be reached: this says NOTHING about the receipt */
  | { status: 'unreachable'; reason: string; source: 'none'; rules?: undefined; credential?: undefined; sandbox?: undefined; expired?: undefined; status_list?: undefined };

/** GET /api/verify/{id}. The page renders only `credential` from this one answer: there is no second fetch. */
export async function verifyReceipt(id: string): Promise<VerifyOutcome> {
  if (isSampleId(id)) {
    const r = mockVerify(id);
    if (r) return { ...r, source: 'sample' };
  }
  if (apiStore.get().forced) return { status: 'unreachable', reason: 'sample mode is on: only sample receipts can be checked', source: 'none' };
  try {
    const r = await request<VerifyResponse>(`/api/verify/${encodeURIComponent(id)}`);
    apiStore.set((s) => (s.mode === 'live' ? s : { ...s, mode: 'live', reason: null }));
    return { ...r, source: 'live' };
  } catch (e) {
    if (isUnreachable(e)) return { status: 'unreachable', reason: describe(e), source: 'none' };
    throw e;
  }
}

export async function fetchDid(): Promise<DidDocument | null> {
  if (apiStore.get().forced) return null;
  try {
    return await request<DidDocument>('/.well-known/did.json');
  } catch {
    return null;
  }
}

export interface RecallResult {
  ok: boolean;
  /** `sample`: simulated in this browser; `sandbox`: recalled inside this tab's demo session */
  mode: 'sample' | 'sandbox' | 'unavailable';
  hits?: string[];
  message?: string;
}

/**
 * Recall a rule version (withdraw it from every receipt that used it), inside this tab's demo sandbox only:
 * POST /api/demo/{sid}/recall {rule_id, version, reason}. No token is ever involved. Sample mode simulates it.
 */
export async function recallRule(ruleId: string, version: number, opts: { reason?: string; sample?: boolean } = {}): Promise<RecallResult> {
  if (opts.sample || apiStore.get().forced || apiStore.get().mode === 'sample') {
    simulateRecall(ruleId, version);
    return { ok: true, mode: 'sample', hits: [`${ruleId} v${version}`], message: 'Simulated in this browser (sample mode).' };
  }
  try {
    const body = JSON.stringify({ rule_id: ruleId, version, reason: (opts.reason ?? '').slice(0, 500) });
    const r = await sandbox<{ recalled_rule_credentials?: string[] }>('/recall', { method: 'POST', body });
    clearSavedPlans(); // the server dropped its cached plans too: the next plan is built without the recalled rule
    recallEpoch.set((n) => n + 1);
    return { ok: true, mode: 'sandbox', hits: r.recalled_rule_credentials };
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) return { ok: false, mode: 'unavailable', message: e.message };
    return { ok: false, mode: 'unavailable', message: 'The API is not reachable.' };
  }
}

/** This session's officer cases: GET /api/demo/{sid}/inbox (no token). */
export async function fetchDemoInbox(): Promise<Sourced<InboxItem[]>> {
  return sourced(
    async () => (await sandbox<{ items: InboxItem[] }>('/inbox')).items,
    () => [],
  );
}

/** Counters: this session's (GET /api/demo/{sid}/stats) once the tab has a sandbox, otherwise the official GET /api/stats. */
export async function fetchStats(): Promise<{ stats: Stats; scope: 'session' | 'official' } | null> {
  if (apiStore.get().forced) return null; // sample mode: no counters at all rather than invented ones
  const sid = currentSessionId();
  try {
    if (sid) {
      try {
        return { stats: await request<Stats>(`/api/demo/${encodeURIComponent(sid)}/stats`), scope: 'session' };
      } catch (e) {
        if (!isGoneSession(e)) throw e;
        forgetSession();
      }
    }
    return { stats: await request<Stats>('/api/stats'), scope: 'official' };
  } catch {
    return null;
  }
}

/** GET /api/packs: which crops have a rule pack (symptom signatures are still "planned"). */
export async function fetchPacks(): Promise<PackInfo[] | null> {
  if (apiStore.get().forced) return null;
  try {
    return (await request<{ packs: PackInfo[] }>('/api/packs')).packs;
  } catch {
    return null;
  }
}
