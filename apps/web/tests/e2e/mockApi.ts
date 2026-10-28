/**
 * A mocked KrishiLoop API v0.4.0 for the smoke tests (no backend needed). Shapes follow services/api/main.py:
 * demo sessions, sandbox plan/recall/inbox/stats, verify with `credential`, snapshots with `risk`, packs.
 * Ids are NOT in the sample range (urn:uuid:534d504c-...), so the app treats every answer as live.
 */
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const SID = 'abcdef0123456789';
export const RECEIPT_ID = '11111111-2222-4333-8444-555555555555';
const RULE_CRED = 'urn:uuid:aaaaaaaa-2222-4333-8444-555555555555';

const mock = (name: string) => JSON.parse(readFileSync(new URL(`../../src/mocks/${name}`, import.meta.url), 'utf8'));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (n: number) => iso(new Date(Date.now() + n * 86400_000));

export interface Calls {
  paths: string[];
  headers: Record<string, string>[];
  bodies: Record<string, unknown>[];
}

export function liveFixtures() {
  const planKe = mock('plan.ke-a.json');
  const action = planKe.actions[0];
  const today = plus(0);
  const asOf = new Date().toISOString();
  const receipt = {
    ...action.receipt,
    advice: { action_id: action.action_id, kind: action.kind, title: action.title, decision: action.decision, traffic_light: action.traffic_light, phrasing_model: null },
    plan: { plan_id: '99999999-2222-4333-8444-555555555555', pack_id: planKe.pack_id, crop: 'potato', stage: 'vegetative', valid_from: today, valid_to: plus(6), field_ref: 'abcdef0123456789', data_mode: 'live', data_as_of: asOf },
  };
  const plan = {
    ...planKe,
    plan_id: receipt.plan.plan_id,
    valid_from: today,
    valid_to: plus(6),
    data_mode: 'live',
    data_as_of: asOf,
    snapshot_id: 'snap-live-1',
    actions: [{ ...action, receipt_credential_id: `urn:uuid:${RECEIPT_ID}`, receipt: { ...action.receipt, rule_refs: [{ ...action.receipt.rule_refs[0], credential_id: RULE_CRED }] } }],
  };
  const snapshot = mock('snapshot.KE-SAMPLE-01.json');
  snapshot.snapshot_id = 'snap-live-1';
  snapshot.mode = 'live';
  snapshot.created_at = asOf;
  snapshot.forecast.days = snapshot.forecast.days.map((d: Record<string, unknown>, i: number) => ({ ...d, date: plus(i), risk: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'low' : 'unknown' }));
  snapshot.risk_basis = 'humid and mild day by team-set thresholds (not from a source; pathologist review pending)';
  const credential = (recalled: boolean) => ({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `urn:uuid:${RECEIPT_ID}`,
    type: ['VerifiableCredential', 'AdviceReceiptCredential'],
    issuer: 'did:web:localhost',
    validFrom: asOf,
    validUntil: `${plus(7)}T23:59:59Z`,
    credentialSubject: { ...receipt, rule_refs: plan.actions[0].receipt.rule_refs },
    credentialStatus: { id: `http://localhost:8000/status/demo-${SID}#3`, type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '3', statusListCredential: `http://localhost:8000/status/demo-${SID}` },
    proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: asOf, verificationMethod: 'did:web:localhost#key-1', proofPurpose: 'assertionMethod', proofValue: 'zLiveFixtureNotARealSignature' },
    _recalled: recalled,
  });
  const inbox = [
    {
      item_id: 'inbox-0123456789ab',
      field_id: 'KE-SAMPLE-01',
      farmer_display_name: 'demo-farmer-a',
      reason_code: 'low_confidence',
      reason: { en: 'Photo check was not sure. Sent to your officer’s inbox.' },
      photo_attached: false,
      status: 'open',
      created_at: asOf,
      details: { gate: 'uncalibrated', pack_id: 'pack-potato-late-blight', model: { name: 'rice-leaf-mnv4s', version: 'union-v0' } },
      diagnosis_id: 'dx-test-1',
      top_labels: [{ label: 'brown_spot', prob: 0.62 }],
    },
  ];
  return { plan, snapshot, credential, inbox, demo: mock('demo.json') };
}

/** Route every API call of the app to the fixtures. `calls` records what the browser asked for. */
export async function mockApi(page: Page, opts: { recallOnPost?: boolean } = {}): Promise<Calls & { recalled: () => boolean }> {
  const fx = liveFixtures();
  const calls: Calls = { paths: [], headers: [], bodies: [] };
  let recalled = false;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  // only the API paths: Vite also serves modules such as /src/lib/api/client.ts
  await page.route((u) => /^\/(api|status|\.well-known)\//.test(u.pathname), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    calls.paths.push(`${req.method()} ${path}`);
    calls.headers.push(req.headers());
    try {
      calls.bodies.push(req.postDataJSON() ?? {});
    } catch {
      calls.bodies.push({});
    }
    if (path === '/api/demo' && req.method() === 'GET') return json(route, { ...fx.demo, fields: fx.demo.fields.filter((f: { field_id: string }) => f.field_id === 'KE-SAMPLE-01') });
    if (path === '/api/demo/session') return json(route, { session_id: SID, status_list: `http://localhost:8000/status/demo-${SID}`, expires_in_s: 86400, note: 'sandbox: recalls here affect only this session’s receipts' });
    if (path === `/api/demo/${SID}/plan` || path === '/api/plan') {
      const body = req.postDataJSON() as { diagnosis?: unknown };
      if (body?.diagnosis) return json(route, { ...fx.plan, diagnosis_used: false, diagnosis_note: 'uncalibrated' });
      return json(route, fx.plan);
    }
    if (path === `/api/demo/${SID}/recall`) {
      recalled = true;
      return json(route, { recalled_rule_credentials: [RULE_CRED], note: 'receipts that used this rule version now verify as recalled' });
    }
    if (path === `/api/demo/${SID}/inbox`) return json(route, { items: fx.inbox });
    if (path === `/api/demo/${SID}/stats` || path === '/api/stats') return json(route, { rule_versions_recalled: recalled ? 1 : 0, status_entries_used: 4, status_entries_revoked: recalled ? 2 : 0, credentials_stored: 4, inbox_open: 1 });
    if (path.startsWith('/api/snapshots/')) return json(route, fx.snapshot);
    if (path === '/api/packs') return json(route, { packs: [{ pack_id: 'pack-potato-late-blight', crops: ['potato'], rules: 11, review_levels: { pending: 11 }, signatures: 'planned (Knowledge Compiler not built yet)' }] });
    if (path.startsWith('/api/verify/')) {
      const { _recalled, ...credential } = fx.credential(recalled);
      void _recalled;
      if (path.endsWith(RECEIPT_ID)) {
        return json(route, recalled ? { status: 'recalled', reason: 'rule(s) withdrawn: R-PLB-011 v1', rules: ['R-PLB-011 v1'], credential, sandbox: true } : { status: 'authentic', reason: 'issued by KrishiLoop and unaltered (this is not a guarantee of correctness)', expired: false, credential, sandbox: true });
      }
      return json(route, { status: 'invalid', reason: 'unknown credential' });
    }
    if (path.startsWith('/status/')) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'unknown status list' }) });
    if (path === '/.well-known/did.json') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"n/a"}' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not mocked' }) });
  });
  void opts;
  return Object.assign(calls, { recalled: () => recalled });
}
