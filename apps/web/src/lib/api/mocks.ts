/**
 * Bundled SAMPLE data. Shape-for-shape the same as the API contracts (contracts/schemas/*.json), so every screen can
 * run with the API down. Everything that comes from here is labelled "sample" in the UI.
 *
 * Provenance (nothing here is invented agronomy):
 *  - plan.ke-a / plan.ke-b: captured from POST /api/plan on 2026-10-26 (real planner output, real CIP quotes and page numbers).
 *    Credential ids were rewritten to the sample range `urn:uuid:534d504c-...` ("SMPL") so sample mode never depends on the backend.
 *  - plan.bd-abstained: contracts/examples/plan.abstained.example.json (a rice field has no rule pack yet, so it abstains).
 *  - snapshot.KE-SAMPLE-01: the real Open-Meteo snapshot the API saved on 2026-10-26.
 *  - inbox: sample cases; the model labels come from ml/vision/artifacts/label_map.json.
 */
import demoJson from '../../mocks/demo.json';
import planA from '../../mocks/plan.ke-a.json';
import planB from '../../mocks/plan.ke-b.json';
import planAbstained from '../../mocks/plan.bd-abstained.json';
import snapshotKe from '../../mocks/snapshot.KE-SAMPLE-01.json';
import inboxJson from '../../mocks/inbox.json';
import { createStore } from '../store';
import { readJSON, writeJSON } from '../storage';
import type { Action, Credential, DemoPayload, FieldSnapshot, InboxItem, MoneyImpact, Plan, Receipt, VerifyResponse } from './types';

export const SAMPLE_ID_PREFIX = 'urn:uuid:534d504c-';
export const isSampleId = (id: string) => id.startsWith(SAMPLE_ID_PREFIX);

export type Scenario = 'live' | 'ke-a' | 'ke-b' | 'ke-money' | 'bd-abstained';

export const SCENARIOS: { id: Exclude<Scenario, 'live'>; field: string; profile: string; money?: boolean }[] = [
  { id: 'ke-a', field: 'KE-SAMPLE-01', profile: 'demo-farmer-a' },
  { id: 'ke-b', field: 'KE-SAMPLE-01', profile: 'demo-farmer-b' },
  { id: 'ke-money', field: 'KE-SAMPLE-01', profile: 'demo-farmer-a', money: true },
  { id: 'bd-abstained', field: 'BD-DEMO-01', profile: 'demo-farmer-a' },
];

export const MOCK_DEMO = demoJson as unknown as DemoPayload;
export const MOCK_INBOX = inboxJson as unknown as InboxItem[];

/** What a planner with cited prices could attach. Shown only in the "money" sample scenario and always marked sample. */
export const SAMPLE_MONEY: MoneyImpact = {
  direction: 'saves',
  amount_min: 1200,
  amount_max: 1800,
  currency: 'KES',
  basis: 'Sample numbers: one fungicide round avoided on a sample 0.2 ha plot at sample prices.',
  price_source_ids: ['SAMPLE-PRICE-001'],
  sample: true,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The bundled snapshot is a saved copy, so a sample plan says `snapshot` and when it was saved (backend v0.4.0 fields). */
const SAMPLE_DATA = { data_mode: 'snapshot' as const, data_as_of: (snapshotKe as { created_at: string }).created_at };

export function mockPlan(fieldId: string, profileId: string, money = false): Plan {
  if (fieldId === 'BD-DEMO-01') return { ...(clone(planAbstained) as unknown as Plan), ...SAMPLE_DATA };
  const base = (profileId === 'demo-farmer-b' ? planB : planA) as unknown as Plan;
  const plan = { ...clone(base), ...SAMPLE_DATA };
  if (money && plan.actions?.[0]) plan.actions[0].money_impact = { ...SAMPLE_MONEY };
  return plan;
}

/** The bundled forecast. The sample copy has no `risk`: the day-by-day rating is added only by the live snapshot endpoint. */
export function mockSnapshot(fieldId: string): FieldSnapshot | null {
  return fieldId === 'KE-SAMPLE-01' ? (clone(snapshotKe) as unknown as FieldSnapshot) : null;
}

function allMockActions(): Action[] {
  return [...((planA as unknown as Plan).actions ?? []), ...((planB as unknown as Plan).actions ?? [])];
}

const ISSUER = 'did:web:sample.krishiloop.example';
function envelope(id: string, type: string, subject: Credential['credentialSubject'], created: string, index: number): Credential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id,
    type: ['VerifiableCredential', type],
    issuer: ISSUER,
    validFrom: created,
    credentialSubject: subject,
    credentialStatus: {
      id: `https://sample.krishiloop.example/status/1#${index}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: String(index),
      statusListCredential: 'https://sample.krishiloop.example/status/1',
    },
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created,
      verificationMethod: `${ISSUER}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: 'zSampleSignatureNotRealSampleSignatureNotReal1111111111',
    },
  };
}

const RULE_META: Record<string, { page: number; doc_id: string }> = {
  'R-PLB-011': { page: 6, doc_id: 'DOC-CIP-001' },
  'R-PLB-006': { page: 28, doc_id: 'DOC-CIP-001' },
  'R-PLB-009': { page: 24, doc_id: 'DOC-CIP-001' },
};

/** Sample receipts predate `advice` and `plan` inside the signed content: rebuild them from the sample plan so the verifier shows what v0.4.0 receipts show. */
function withAdviceAndPlan(a: Action): Receipt {
  const plan = [planA, planB].map((p) => p as unknown as Plan).find((p) => p.actions?.some((x) => x.action_id === a.action_id)) ?? (planA as unknown as Plan);
  return {
    ...clone(a.receipt),
    advice: { action_id: a.action_id, kind: a.kind, title: clone(a.title), decision: a.decision, traffic_light: a.traffic_light, phrasing_model: null },
    plan: {
      plan_id: plan.plan_id,
      pack_id: plan.pack_id,
      crop: plan.crop,
      stage: plan.stage,
      valid_from: plan.valid_from,
      valid_to: plan.valid_to,
      field_ref: '534d504c534d504c',
      ...SAMPLE_DATA,
    },
  };
}

/** A credential for a sample id (receipt or rule), or null if the id is not one of ours. */
export function mockCredential(id: string): Credential | null {
  if (!isSampleId(id)) return null;
  const idx = Number(id.slice(-3)) || 0;
  for (const a of allMockActions()) {
    if (a.receipt_credential_id === id) return envelope(id, 'AdviceReceiptCredential', withAdviceAndPlan(a), a.receipt.created_at, idx);
  }
  for (const a of allMockActions()) {
    for (const r of a.receipt.rule_refs) {
      if (r.credential_id === id) {
        const meta = RULE_META[r.rule_id] ?? { page: 0, doc_id: 'DOC-CIP-001' };
        return envelope(
          id,
          'RuleCredential',
          {
            rule_id: r.rule_id,
            version: r.version,
            pack_id: 'pack-potato-late-blight',
            doc_id: meta.doc_id,
            page: meta.page,
            quote_sha256: a.receipt.sources[0]?.quote_sha256 ?? '',
            rule_sha256: '534d504c'.repeat(8),
            review_level: r.review_level,
          },
          a.receipt.created_at,
          idx,
        );
      }
    }
  }
  return null;
}

/* -------- simulated recall (sample mode only): lets the Authentic -> Recalled beat run with the API down */
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

/** Verify a sample id. Returns null when the id is unknown to the samples (so the caller must not call it "invalid"). */
export function mockVerify(id: string): VerifyResponse | null {
  const cred = mockCredential(id);
  if (!cred) return null;
  const recalls = sampleRecalls.get();
  const refs = (cred.credentialSubject as Receipt).rule_refs ?? [];
  const hit = refs.filter((r) => recalls.includes(`${r.rule_id}@${r.version}`));
  if (cred.type.includes('RuleCredential')) {
    const s = cred.credentialSubject as { rule_id: string; version: number };
    return recalls.includes(`${s.rule_id}@${s.version}`) ? { status: 'recalled', reason: 'this rule version was withdrawn', credential: cred, sandbox: false } : { status: 'authentic', reason: 'issued by KrishiLoop and unaltered', credential: cred, sandbox: false, expired: false };
  }
  if (hit.length) {
    const rules = hit.map((r) => `${r.rule_id} v${r.version}`);
    return { status: 'recalled', reason: `rule(s) withdrawn: ${rules.join(', ')}`, rules, credential: cred, sandbox: false };
  }
  // sample receipts are always "current": they are examples, and a sample must not pretend a week has passed
  return { status: 'authentic', reason: 'issued by KrishiLoop and unaltered', credential: cred, sandbox: false, expired: false };
}
