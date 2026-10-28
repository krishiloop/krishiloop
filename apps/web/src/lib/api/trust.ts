/**
 * Earned trust for photo diagnosis: the API calls (backend v0.4.0 + earned-trust endpoints, plan/EARNED_TRUST_DESIGN.md).
 *
 *   POST /api/demo/{sid}/photo                      {field_id, image_b64, consent} -> PhotoCase   (503: no photo model on this server)
 *   GET  /api/demo/{sid}/photo/cases                -> {cases}                                    (newest first)
 *   GET  /api/demo/{sid}/photo/{case_id}/image      the JPEG, only with consent and only until the verdict (404 after)
 *   POST /api/demo/{sid}/photo/{case_id}/verdict    {label} -> {case, event, area}                (409: already judged)
 *   GET  /api/demo/{sid}/areas/{area}               -> AreaStats
 *   GET  /api/replay/area-trust                     the replay of public datasets (404 until the server has generated it)
 *
 * Everything is inside the visitor's own demo sandbox (the same session as the plan, the recall and the inbox), so a photo,
 * a verdict and a gate event can never change what another visitor sees. There is no token anywhere.
 */
import { createStore } from '../store';
import { readJSON, writeJSON, writeStore } from '../storage';
import { apiStore, currentSessionId, HttpError, isUnreachable, request, sandbox, sessionStore } from './client';
import type { AreaStats, PhotoCase, ReplayPayload, VerdictResult } from './types';

/* ------------------------------------------------------------------ what went wrong, in the words the screens use */
export type PhotoErrorKind =
  /** 503: the photo model is not installed on this server */
  | 'unavailable'
  /** 422: not a readable image */
  | 'unreadable'
  /** 429: too many requests */
  | 'rate'
  /** 409: the case was already judged */
  | 'judged'
  /** the API did not answer */
  | 'offline'
  | 'other';

/** The API answers 503 with "the photo model is not installed on this server". A bare 5xx (a proxy, a crash) is not that. */
export const isPhotoUnavailable = (e: unknown) => e instanceof HttpError && e.status === 503 && /photo model/i.test(e.message);

export function photoErrorKind(e: unknown): PhotoErrorKind {
  if (isPhotoUnavailable(e)) return 'unavailable';
  if (e instanceof HttpError) {
    if (e.status === 422) return 'unreadable';
    if (e.status === 429) return 'rate';
    if (e.status === 409) return 'judged';
  }
  if (isUnreachable(e)) return 'offline';
  return 'other';
}

/** Sample data is on, or the API did not answer: there is no server to read a photo, so the server path is not offered. */
export const serverPathOffered = () => !apiStore.get().forced && apiStore.get().mode !== 'sample';

/* ------------------------------------------------------------------ calls */
/** Send one photo (a JPEG of at most 1024 px, base64 without the data: prefix). Reading it can take a few seconds. */
export function sendPhoto(fieldId: string, imageB64: string, consent: boolean): Promise<PhotoCase> {
  return sandbox<PhotoCase>('/photo', { method: 'POST', body: JSON.stringify({ field_id: fieldId, image_b64: imageB64, consent }) }, 60_000);
}

/** This session's photo cases, newest first. */
export async function listPhotoCases(): Promise<PhotoCase[]> {
  return (await sandbox<{ cases: PhotoCase[] }>('/photo/cases')).cases;
}

/** Where the officer's photo lives (same origin, the session id is in the path). null before the tab has a session. */
export function photoImageUrl(caseId: string): string | null {
  const sid = currentSessionId();
  return sid ? `/api/demo/${encodeURIComponent(sid)}/photo/${encodeURIComponent(caseId)}/image` : null;
}

/** The officer's verdict (in the demo the visitor plays the officer). Also refreshes what is known of the area. */
export async function judgePhotoCase(caseId: string, label: string): Promise<VerdictResult> {
  const r = await sandbox<VerdictResult>(`/photo/${encodeURIComponent(caseId)}/verdict`, { method: 'POST', body: JSON.stringify({ label }) });
  rememberArea(r.area);
  return r;
}

/** The evidence behind one area's gate. */
export async function loadAreaStats(area: string): Promise<AreaStats> {
  const a = await sandbox<AreaStats>(`/areas/${encodeURIComponent(area)}`);
  rememberArea(a);
  return a;
}

export type ReplayResult =
  | { state: 'ready'; payload: ReplayPayload }
  /** invented curves in the same shape: sample data is on, or the API did not answer. Always labelled "Sample". */
  | { state: 'sample'; payload: ReplayPayload }
  /** the server has not generated a replay yet (404) */
  | { state: 'missing' }
  | { state: 'error'; message: string };

/** With no server, the REAL replay bundled from ml/vision/artifacts (recorded, not invented): the same numbers the server serves. */
async function sampleReplay(): Promise<ReplayPayload> {
  return (await import('../../data/recorded')).recordedReplay();
}

/** The replay of public datasets. Without a server the bundled copy of the same real replay stands in, labelled "Recorded". */
export async function fetchReplay(): Promise<ReplayResult> {
  if (apiStore.get().forced) return { state: 'sample', payload: await sampleReplay() };
  try {
    const payload = await request<ReplayPayload>('/api/replay/area-trust', {}, 15_000);
    apiStore.set((s) => (s.mode === 'live' && s.reason === null ? s : { ...s, mode: 'live', reason: null }));
    return { state: 'ready', payload };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { state: 'missing' };
    if (isUnreachable(e)) {
      apiStore.set((s) => ({ ...s, mode: 'sample', reason: e instanceof HttpError ? `HTTP ${e.status}` : 'network' }));
      return { state: 'sample', payload: await sampleReplay() };
    }
    return { state: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ what this tab knows about its areas */
const CRED_KEY = 'kl.trust.cred';

interface AreaCache {
  areas: Record<string, AreaStats>;
  /** the last AreaTrustCredential id seen per area: a withdrawn credential is no longer in the area's stats, but its page still verifies */
  creds: Record<string, string>;
}

export const areaCache = createStore<AreaCache>({ areas: {}, creds: readJSON<Record<string, string>>(CRED_KEY, 'session') ?? {} });

/** Keep the newest stats of an area (and the credential id, while the gate stands). */
export function rememberArea(a: AreaStats) {
  areaCache.set((s) => {
    const creds = a.trust_credential_id && s.creds[a.area] !== a.trust_credential_id ? { ...s.creds, [a.area]: a.trust_credential_id } : s.creds;
    if (creds !== s.creds) writeJSON(CRED_KEY, creds, 'session');
    return { areas: { ...s.areas, [a.area]: a }, creds };
  });
}

export const useAreaStats = (area: string | null | undefined): AreaStats | null => areaCache.useSelector((s) => (area ? (s.areas[area] ?? null) : null));
export const knownCredential = (area: string): string | null => areaCache.get().creds[area] ?? null;

// a new sandbox is a new ledger: forget what the old one said
sessionStore.subscribe(() => {
  if (sessionStore.get() === null) {
    areaCache.set({ areas: {}, creds: {} });
    writeStore(CRED_KEY, null, 'session');
    photoSupport.set('unknown');
  }
});

/* ------------------------------------------------------------------ is there a photo model on this server? */
/**
 *  unknown      not asked yet
 *  available    the server read stats for the area: its photo model is installed
 *  unavailable  503: no photo model here (the screens keep the on-device flow and say so calmly)
 *  offline      the API did not answer
 */
export type PhotoSupport = 'unknown' | 'available' | 'unavailable' | 'offline';
export const photoSupport = createStore<PhotoSupport>('unknown');

/** Ask the server once for an area's numbers; the answer also tells whether the photo model is installed. */
export async function probePhotoSupport(area: string): Promise<{ support: PhotoSupport; stats: AreaStats | null }> {
  try {
    const stats = await loadAreaStats(area);
    photoSupport.set('available');
    return { support: 'available', stats };
  } catch (e) {
    const kind = photoErrorKind(e);
    const support: PhotoSupport = kind === 'unavailable' ? 'unavailable' : kind === 'offline' ? 'offline' : 'unknown';
    photoSupport.set(support);
    return { support, stats: null };
  }
}
