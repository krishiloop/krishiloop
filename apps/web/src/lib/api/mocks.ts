/**
 * What the app shows when the live API cannot be reached: RECORDED real answers of our own server (src/data/recorded,
 * 28 Oct 2026, a demo sandbox at labelled sample locations), never invented ones. Every screen labels them
 * "Recorded <date>" (<DataMark kind="recorded">).
 *
 * A recall with no server is simulated in this browser on the recorded receipts, with the server's own rule: a receipt
 * is "recalled" when any rule version it cites is withdrawn (the recorded after-recall answers follow the same rule).
 */
import demoJson from '../../data/recorded/demo.json';
import inboxJson from '../../data/recorded/inbox.json';
import recordedIds from '../../data/recorded/ids.json';
import { loadRecorded, recordedPlan, recordedSnapshot } from '../../data/recorded';
import { createStore } from '../store';
import { readJSON, writeJSON } from '../storage';
import type { DemoPayload, FieldSnapshot, InboxItem, Plan, Receipt, VerifyResponse } from './types';

const IDS = new Set(recordedIds as string[]);
const full = (id: string) => (id.startsWith('urn:uuid:') ? id : `urn:uuid:${id}`);

/** True for a receipt id we recorded (it is answered from the recordings, never from the live server). */
export const isSampleId = (id: string) => IDS.has(full(id));

/** Ready-made situations on the recorded data (field + farmer), for the demo pickers. */
export type Scenario = 'live' | 'bd-calm' | 'bd-pests' | 'bd-grain' | 'ke-a' | 'ke-b' | 'bd-recalled';
export const SCENARIOS: { id: Exclude<Scenario, 'live'>; field: string; profile: string }[] = [
  { id: 'bd-calm', field: 'BD-SAMPLE-02', profile: 'demo-farmer-d' },
  { id: 'bd-pests', field: 'BD-SAMPLE-02', profile: 'demo-farmer-c' },
  { id: 'bd-grain', field: 'BD-SAMPLE-01', profile: 'demo-farmer-d' },
  { id: 'ke-a', field: 'KE-SAMPLE-01', profile: 'demo-farmer-a' },
  { id: 'ke-b', field: 'KE-SAMPLE-01', profile: 'demo-farmer-b' },
];

export const MOCK_DEMO = demoJson as unknown as DemoPayload;
export const MOCK_INBOX = (inboxJson as unknown as { items: InboxItem[] }).items;

/* -------- simulated recall (no server): the Authentic -> Recalled beat still runs, labelled as a simulation */
const RECALL_KEY = 'kl.sampleRecalls';
export const sampleRecalls = createStore<string[]>(readJSON<string[]>(RECALL_KEY, 'session') ?? []);
export function simulateRecall(ruleId: string, version: number) {
  const key = `${ruleId}@${version}`;
  sampleRecalls.set((cur) => {
    const next = cur.includes(key) ? cur : [...cur, key];
    writeJSON(RECALL_KEY, next, 'session');
    return next;
  });
}
export function resetSampleRecalls() {
  writeJSON(RECALL_KEY, [], 'session');
  sampleRecalls.set([]);
}
const isRecalled = (ruleId: string, version: number) => sampleRecalls.get().includes(`${ruleId}@${version}`);

/** The recorded plan for this field and farmer. If a rule it cites was recalled here, it abstains like the server does. */
export async function mockPlan(fieldId: string, profileId: string): Promise<Plan> {
  const plan = await recordedPlan(fieldId, profileId);
  if (!plan) throw new Error(`no recorded plan for ${fieldId}`);
  const hit = (plan.actions ?? []).find((a) => a.kind === 'input_decision' && a.receipt.rule_refs.some((r) => isRecalled(r.rule_id, r.version)));
  if (hit) {
    // the server's own answer after a recall (recorded for R-BDR-002 v1); any other recalled rule gets the same shape
    const { recall } = await loadRecorded();
    return { ...plan, status: 'abstained', actions: [], abstention: { ...recall.plan_after.abstention!, reason_code: 'rule_recalled' } };
  }
  return plan;
}

export async function mockSnapshot(snapshotId: string, fieldId: string): Promise<FieldSnapshot | null> {
  return recordedSnapshot(snapshotId, fieldId);
}

/** Verify a recorded receipt. Returns null when the id was never recorded (the caller must not call it "invalid"). */
export async function mockVerify(id: string): Promise<VerifyResponse | null> {
  if (!isSampleId(id)) return null;
  const { verifyBefore } = await loadRecorded();
  const base = verifyBefore[full(id)];
  if (!base) return null;
  const refs = (base.credential?.credentialSubject as Receipt | undefined)?.rule_refs ?? [];
  const hit = refs.filter((r) => isRecalled(r.rule_id, r.version)).map((r) => `${r.rule_id} v${r.version}`);
  if (hit.length) return { ...base, status: 'recalled', reason: `rule(s) withdrawn: ${hit.join(', ')}`, rules: hit, expired: undefined };
  return base;
}
