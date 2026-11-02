/**
 * Recorded real answers of our own API: what the app shows when the live server cannot be reached.
 *
 * Recorded on 2 Nov 2026 (first on 28 Oct) from the KrishiLoop API on our development machine, inside one demo sandbox at the labelled
 * sample locations (no farmer). Nothing here is invented: the plans, receipts, Ask answers, the recall and the inbox are
 * the server's own JSON. Receipts are signed by the development key (issuer did:web:127.0.0.1%3A5173), so they are always
 * shown as "Recorded <date>", never as live. The JSON files load lazily: a visitor on the live server never downloads them.
 */
import meta from './meta.json';
import type { DemoPayload, FieldSnapshot, InboxItem, PackInfo, Plan, ReplayPayload, Stats, VerifyResponse } from '../../lib/api/types';
import type { AskResponse } from '../../lib/api/ask';

export const RECORDED_AT: string = meta.recorded_at;
export const RECORDED_ISSUER: string = (meta.health as { issuer?: string }).issuer ?? '';

export interface RecordedAsk {
  field_id: string;
  profile_id: string;
  lang: string;
  question: string;
  response: AskResponse;
}

export interface Recorded {
  demo: DemoPayload;
  /** "FIELD|PROFILE" -> plan */
  plans: Record<string, Plan>;
  /** snapshot id -> snapshot */
  snapshots: Record<string, FieldSnapshot>;
  /** credential id -> verify answer before the recall (authentic, with the signed credential) */
  verifyBefore: Record<string, VerifyResponse>;
  /** credential id -> verdict after R-BDR-002 v1 was recalled (no credential: it is the same signed content) */
  verifyAfter: Record<string, Omit<VerifyResponse, 'credential'>>;
  asks: RecordedAsk[];
  recall: { rule_id: string; version: number; receipt_credential_id: string; plan_after: Plan; response: { recalled_rule_credentials: string[]; note: string } };
  inbox: InboxItem[];
  stats: Stats;
  packs: PackInfo[];
}

let cache: Promise<Recorded> | null = null;

/** Load every recorded file once (one lazy chunk per file). */
export function loadRecorded(): Promise<Recorded> {
  cache ??= Promise.all([
    import('./demo.json'),
    import('./plans.json'),
    import('./snapshots.json'),
    import('./verify-before.json'),
    import('./verify-after.json'),
    import('./asks.json'),
    import('./recall.json'),
    import('./inbox.json'),
    import('./stats.json'),
    import('./packs.json'),
  ]).then(([demo, plans, snapshots, before, after, asks, recall, inbox, stats, packs]) => ({
    demo: demo.default as unknown as DemoPayload,
    plans: plans.default as unknown as Record<string, Plan>,
    snapshots: snapshots.default as unknown as Record<string, FieldSnapshot>,
    verifyBefore: before.default as unknown as Record<string, VerifyResponse>,
    verifyAfter: after.default as unknown as Record<string, Omit<VerifyResponse, 'credential'>>,
    asks: asks.default as unknown as RecordedAsk[],
    recall: recall.default as unknown as Recorded['recall'],
    inbox: (inbox.default as unknown as { items: InboxItem[] }).items,
    stats: stats.default as unknown as Stats,
    packs: (packs.default as unknown as { packs: PackInfo[] }).packs,
  }));
  return cache;
}

/** The real replay of the earned-trust simulation (ml/vision/artifacts/area_trust_replay.json), bundled. */
export async function recordedReplay(): Promise<ReplayPayload> {
  return (await import('./area-trust-replay.json')).default as unknown as ReplayPayload;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The recorded plan for a field and farmer, or the nearest one recorded for that field. */
export async function recordedPlan(fieldId: string, profileId: string): Promise<Plan | null> {
  const { plans } = await loadRecorded();
  const hit = plans[`${fieldId}|${profileId}`] ?? Object.entries(plans).find(([k]) => k.startsWith(`${fieldId}|`))?.[1];
  return hit ? clone(hit) : null;
}

export async function recordedSnapshot(snapshotId: string, fieldId?: string): Promise<FieldSnapshot | null> {
  const { snapshots } = await loadRecorded();
  const hit = snapshots[snapshotId] ?? (fieldId ? Object.values(snapshots).find((s) => s.field_id === fieldId) : undefined);
  return hit ? clone(hit) : null;
}

/** Every credential id the recordings can verify (plan receipts and Ask receipts). */
export async function isRecordedId(id: string): Promise<boolean> {
  const { verifyBefore } = await loadRecorded();
  const full = id.startsWith('urn:uuid:') ? id : `urn:uuid:${id}`;
  return full in verifyBefore;
}

/**
 * The short verify code the server issued for each recorded receipt (services/reach, recorded with the receipts). Lazy:
 * only the SMS preview and the /v/CODE lookup in sample mode load it.
 */
async function recordedCodes(): Promise<Record<string, { code: string }>> {
  return (await import('./codes.json')).default as unknown as Record<string, { code: string }>;
}

export async function recordedCodeFor(id: string): Promise<string | null> {
  const full = id.startsWith('urn:uuid:') ? id : `urn:uuid:${id}`;
  return (await recordedCodes())[full]?.code ?? null;
}

/** A canonical code (8 characters, no dash) -> the recorded receipt that carries it (the server stores "7KQ2-MX4P"). */
export async function recordedIdForCode(code: string): Promise<string | null> {
  const hit = Object.entries(await recordedCodes()).find(([, v]) => v.code.replace('-', '') === code);
  return hit ? hit[0] : null;
}
