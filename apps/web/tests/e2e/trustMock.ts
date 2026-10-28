/**
 * The earned-trust part of the mocked API (tests only; nothing here is shown to a visitor): demo sessions' photo cases, the
 * area ledger with the real gate rule (Wilson lower bound, 30 sure answers, 0.85 open, 0.80 close), the replay of public
 * datasets, and advice receipts that rely on an area's trust. Shapes follow services/api/main.py and services/vision/*.
 *
 * Every number here is a TEST FIXTURE. They are chosen so one verdict opens the gate (29 sure answers, all right) or
 * closes it (40 sure answers at 37 right), because those moments are what the screens must show.
 */
import type { Route, Request } from '@playwright/test';
import { wilsonLowerBound } from '../../src/features/trust/policy';

export const SID = 'abcdef0123456789';
export const AREA = 'rice@BD';
export const MODEL = 'bioclip2@1';
export const AREA_CRED = 'urn:uuid:aaaaaaaa-1111-4222-8333-444444444444';
export const PHOTO_RECEIPT_ID = '77777777-2222-4333-8444-555555555555';
export const PHOTO_FIELD = 'BD-SAMPLE-02';
export const PHOTO_PROFILE = 'demo-farmer-d';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (n: number) => iso(new Date(Date.now() + n * 86400_000));

export type MockCase = {
  case_id: string;
  area: string;
  model: string;
  field_id: string;
  created_at: string;
  route: 'officer' | 'auto';
  sure: boolean;
  suggestion: { label: string; prob: number }[];
  consent: boolean;
  verdict: string | null;
  photo_available: boolean;
};
type Ev = { event: 'opened' | 'closed'; at: string; verdicts: number; sure_in_window: number; precision: number | null; lower_bound: number; policy_version: number };

export interface PhotoMockOptions {
  /** the photo model is not installed: every photo endpoint answers 503 (a server like today's dev server) */
  unavailable?: boolean;
  /** where new photos go: the officer (gate closed) or an automatic answer (gate open) */
  route?: 'officer' | 'auto';
  /** the top guess is sure (0.91) or not (0.62) */
  sure?: boolean;
  /** the area before the test starts: 'fresh' (a few answers), 'one-away' (the next sure right answer opens the gate), 'open', 'drifting' (the next wrong sure answer closes it) */
  area?: 'fresh' | 'one-away' | 'open' | 'drifting';
  /** GET /api/replay/area-trust: a fixture, or 404 */
  replay?: 'ready' | 'missing';
  /** POST /photo answers with an error */
  photoError?: 422 | 429;
  /** the area credential is withdrawn from the start (advice that relied on it verifies as withdrawn) */
  withdrawn?: boolean;
  /** cases that already exist in the session */
  cases?: Partial<MockCase>[];
}

const PRESETS = {
  fresh: { verdicts: 12, sure: 8, right: 7, open: false },
  'one-away': { verdicts: 33, sure: 29, right: 29, open: false },
  open: { verdicts: 41, sure: 36, right: 35, open: true },
  drifting: { verdicts: 52, sure: 40, right: 37, open: true },
} as const;

/** A small leaf drawing for the officer's photo (the mock "photo"). */
const LEAF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fae52"/><stop offset="1" stop-color="#3d6b2c"/></linearGradient></defs><rect width="400" height="400" fill="#1a2418"/><path d="M40 330 C 70 120, 250 40, 372 52 C 360 190, 280 330, 40 330Z" fill="url(#g)"/><path d="M60 318 C 140 230, 240 140, 356 66" stroke="#cfe3a9" stroke-width="4" fill="none" opacity=".7"/><g fill="#6b4a2a" opacity=".92"><ellipse cx="170" cy="232" rx="26" ry="11" transform="rotate(-38 170 232)"/><ellipse cx="248" cy="170" rx="20" ry="9" transform="rotate(-38 248 170)"/><ellipse cx="116" cy="272" rx="14" ry="7" transform="rotate(-38 116 272)"/></g></svg>`;

export function createPhotoMock(opts: PhotoMockOptions = {}) {
  const asOf = new Date().toISOString();
  const preset = PRESETS[opts.area ?? (opts.route === 'auto' ? 'open' : 'fresh')];
  const st = {
    route: opts.route ?? 'officer',
    sure: opts.sure ?? true,
    verdicts: preset.verdicts,
    sure_n: preset.sure,
    right: preset.right,
    open: preset.open && !opts.withdrawn,
    withdrawn: !!opts.withdrawn,
    events: [] as Ev[],
    cases: [] as MockCase[],
    seq: 0,
    cred: preset.open ? AREA_CRED : (null as string | null),
    openedAt: asOf,
    unavailable: !!opts.unavailable,
  };
  if (opts.withdrawn) st.cred = null;
  const make = (over: Partial<MockCase> = {}): MockCase => {
    const n = ++st.seq;
    const id = `pc-${String(n).padStart(4, '0')}abcdef012345`.slice(0, 19);
    const sure = over.sure ?? st.sure;
    return {
      case_id: id,
      area: AREA,
      model: MODEL,
      field_id: PHOTO_FIELD,
      created_at: new Date(Date.now() - (10 - n) * 60_000).toISOString(),
      route: st.route,
      sure,
      suggestion: sure
        ? [
            { label: 'blast', prob: 0.91 },
            { label: 'brown_spot', prob: 0.05 },
          ]
        : [
            { label: 'blast', prob: 0.62 },
            { label: 'brown_spot', prob: 0.21 },
          ],
      consent: true,
      verdict: null,
      photo_available: true,
      ...over,
    };
  };
  for (const c of opts.cases ?? []) st.cases.push(make(c));
  st.cases.reverse();

  const lb = () => Math.round(wilsonLowerBound(st.right, st.sure_n) * 1e4) / 1e4;
  const stats = () => ({
    area: AREA,
    model: MODEL,
    policy_version: 1,
    verdicts: st.verdicts,
    sure_in_window: st.sure_n,
    sure_right_in_window: st.right,
    precision: st.sure_n ? Math.round((st.right / st.sure_n) * 1e4) / 1e4 : null,
    lower_bound: lb(),
    gate_open: st.open,
    events: st.events,
    trust_credential_id: st.open ? st.cred : null,
  });

  const credentialSubject = () => ({
    area: AREA,
    model: MODEL,
    policy_id: 'photo-trust',
    policy_version: 1,
    verdicts: st.events.find((e) => e.event === 'opened')?.verdicts ?? 34,
    sure_in_window: st.events.find((e) => e.event === 'opened')?.sure_in_window ?? 30,
    sure_right_in_window: st.events.find((e) => e.event === 'opened')?.sure_in_window ?? 30,
    precision: 1,
    lower_bound: st.events.find((e) => e.event === 'opened')?.lower_bound ?? 0.8865,
    opened_at: st.events.find((e) => e.event === 'opened')?.at ?? asOf,
  });
  const areaCredential = () => ({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: AREA_CRED,
    type: ['VerifiableCredential', 'AreaTrustCredential'],
    issuer: 'did:web:localhost',
    validFrom: asOf,
    credentialSubject: credentialSubject(),
    credentialStatus: { id: `http://localhost:8000/status/demo-${SID}#7`, type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '7', statusListCredential: `http://localhost:8000/status/demo-${SID}` },
    proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: asOf, verificationMethod: 'did:web:localhost#key-1', proofPurpose: 'assertionMethod', proofValue: 'zAreaFixtureNotARealSignature' },
  });

  /* ---------------------------------------------------------------- rice plan fixtures (real rule text, test ids) */
  const BRRI = (n: number, page: number, quote: string, sha: string) => ({
    doc_id: `DOC-BRRIKB-00${n}`,
    title: n === 2 ? 'Blast disease (ব্লাস্ট রোগ), Fact Sheet 4, Rice Production Training Manual, Module 10' : 'Bacterial leaf blight (পাতাপোড়া রোগ), Fact Sheet 2, Rice Production Training Manual, Module 10',
    publisher: 'Bangladesh Rice Research Institute (BRRI) — Rice Knowledge Bank',
    url: 'http://knowledgebank-brri.org/Rice_Production_Training_Manual/Day_3/Module_10/',
    page,
    quote,
    quote_sha256: sha,
    licence_status: 'cited_permission_requested',
    acknowledgement: 'Bangladesh Rice Research Institute (BRRI), Rice Knowledge Bank, Rice Production Training Manual, Module 10.',
    language: 'bn',
  });
  const UREA_QUOTE = 'সতর্কতার সাথে পরিমিত ইউরিয়া সার ব্যবহার করা দরকার। তবে ইউরিয়া সারের চাহিদা নির্ধারণের জন্য এলসিসি দিয়ে ধানের পাতার রঙ মিলিয়ে নেয়া উত্তম।';
  const UREA_SHA = 'd7a4c0ebddf509a02f2d8e117c17d45a46c49cf6cae7273c9aa60f225049a480';
  const RULES = {
    'R-BDR-012': { kind: 'practice', light: 'amber', en: 'Your photo looks like blast. Use urea carefully and only in moderate amounts, match your leaf colour with a leaf colour chart to decide how much, and show the photo to your officer.', bn: 'ছবিতে ব্লাস্ট রোগের মতো দেখা যাচ্ছে। ইউরিয়া সাবধানে ও পরিমিত পরিমাণে দিন; কতটুকু দেবেন তা ঠিক করতে এলসিসি (পাতার রঙ মেলানোর চার্ট) দিয়ে পাতার রঙ মিলিয়ে নিন, এবং ছবিটি আপনার কর্মকর্তাকে দেখান।', src: BRRI(2, 2, UREA_QUOTE, UREA_SHA), receipt: PHOTO_RECEIPT_ID },
    'R-BDR-008': { kind: 'practice', light: 'green', en: 'Use urea in moderate amounts, and match your leaf colour with a leaf colour chart to decide how much, to lower the risk of blast.', bn: 'ব্লাস্ট রোগের ঝুঁকি কমাতে পরিমিত ইউরিয়া ব্যবহার করুন; কতটুকু দেবেন তা ঠিক করতে এলসিসি (পাতার রঙ মেলানোর চার্ট) দিয়ে পাতার রঙ মিলিয়ে নিন।', src: BRRI(2, 2, UREA_QUOTE, UREA_SHA), receipt: '33333333-2222-4333-8444-555555555551' },
    'R-BDR-009': { kind: 'practice', light: 'amber', en: 'Do not apply urea after a thunderstorm, and stop top-dressing urea once you see leaf blight.', bn: 'ঝড়বৃষ্টির পর ইউরিয়া সার দেবেন না; পাতাপোড়া রোগ দেখলে ইউরিয়া উপরি প্রয়োগ বন্ধ করুন।', src: BRRI(3, 2, 'ঝড়োবৃষ্টির পর ইউরিয়া সার দেয়া যাবে না', 'c3d209f42251c7aadd18bf849fdbf5fcfad20d2eb5792ae202819f1c832682a4'), receipt: '33333333-2222-4333-8444-555555555552' },
    'R-BDR-010': { kind: 'monitoring', light: 'amber', en: 'Check leaf tips and edges for bluish, water-soaked spots. If you find them, tell your officer.', bn: 'পাতার ডগা ও কিনারায় নীলচে, ভেজা ভেজা দাগ আছে কি না দেখুন। পেলে আপনার কর্মকর্তাকে জানান।', src: BRRI(3, 1, 'প্রথমে পাতার অগ্রভাগ বা কিনারায় নীলাভ পানিচোষা দাগ দেখা যায়।', 'a9614d7baace1e6149318a76ff0f250c4197975f97a78b64a7e725467429dd3f'), receipt: '33333333-2222-4333-8444-555555555553' },
  } as const;
  const today = plus(0);
  const planCtx = (planId: string) => ({ plan_id: planId, pack_id: 'pack-bd-rice', crop: 'rice', stage: 'tillering', valid_from: today, valid_to: plus(6), field_ref: 'abcdef0123456789', data_mode: 'live', data_as_of: asOf });
  const action = (id: keyof typeof RULES, planId: string, photo = false) => {
    const r = RULES[id];
    const receiptId = r.receipt;
    const advice = { action_id: `act-${id}`, kind: r.kind, title: { en: r.en, bn: r.bn }, traffic_light: r.light, phrasing_model: null };
    const data = photo
      ? [
          { source: `on-device-model:${MODEL}`, variable: 'leaf_diagnosis', value: 'blast', unit: 'label', observed_at: asOf, retrieved_at: asOf, location_precision: 'sample_location' },
          { source: `on-device-model:${MODEL}`, variable: 'leaf_diagnosis_prob', value: 0.93, unit: 'probability', observed_at: asOf, retrieved_at: asOf, location_precision: 'sample_location' },
        ]
      : [];
    return {
      action_id: `act-${id}`,
      kind: r.kind,
      traffic_light: r.light,
      title: { en: r.en, bn: r.bn },
      receipt_credential_id: `urn:uuid:${receiptId}`,
      receipt: {
        receipt_id: receiptId,
        claim: `act-${id}`,
        advice,
        plan: planCtx(planId),
        sources: [r.src],
        data,
        ...(photo ? { area_trust_ref: { credential_id: st.cred ?? AREA_CRED, area: AREA, model: MODEL } } : {}),
        rule_refs: [{ rule_id: id, version: 1, credential_id: `urn:uuid:bbbbbbbb-${id.slice(-3)}0-4333-8444-555555555555`, review_level: 'pending' }],
        reviewer_parameters: [],
        confidence: { level: 'high', basis: photo ? 'Photo-informed: this rule can fire only when the photo model has earned trust in the farmer’s area.' : 'Direct practice statement from the cited source.' },
        generated_by: { planner_version: '0.3.0', validator_version: '0.3.0', phrasing_model: null },
        created_at: asOf,
      },
    };
  };
  const planBase = (planId: string) => ({ plan_id: planId, pack_id: 'pack-bd-rice', field_id: PHOTO_FIELD, farmer_profile_id: PHOTO_PROFILE, status: 'ok', crop: 'rice', stage: 'tillering', valid_from: today, valid_to: plus(6), generated_at: asOf, snapshot_id: 'snap-live-1', data_mode: 'live', data_as_of: asOf });
  const ricePlan = (withPhoto: boolean) => {
    const planId = withPhoto ? '88888888-2222-4333-8444-555555555555' : '88888888-2222-4333-8444-555555555500';
    return { ...planBase(planId), actions: withPhoto ? [action('R-BDR-012', planId, true), action('R-BDR-008', planId), action('R-BDR-009', planId)] : [action('R-BDR-008', planId), action('R-BDR-009', planId), action('R-BDR-010', planId)], ...(withPhoto ? { diagnosis_used: true, diagnosis_note: 'ok' } : {}) };
  };
  const photoReceiptCredential = () => {
    const a = action('R-BDR-012', '88888888-2222-4333-8444-555555555555', true);
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: `urn:uuid:${PHOTO_RECEIPT_ID}`,
      type: ['VerifiableCredential', 'AdviceReceiptCredential'],
      issuer: 'did:web:localhost',
      validFrom: asOf,
      validUntil: `${plus(7)}T23:59:59Z`,
      credentialSubject: a.receipt,
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: asOf, verificationMethod: 'did:web:localhost#key-1', proofPurpose: 'assertionMethod', proofValue: 'zPhotoReceiptFixtureNotARealSignature' },
    };
  };

  /* ---------------------------------------------------------------- the replay fixture (TEST NUMBERS) */
  const FIELDS = ['photos_seen', 'officer_verdicts', 'lower_bound_before_this_verdict', 'gate_open', 'auto_answers', 'auto_right'];
  const replay = () => ({
    note: 'Replay of public CC BY rice datasets: the dataset’s labels stand in for an officer’s verdicts. Not real officers, not real farms.',
    settings: { sure: 0.85, window: 50, min_n: 30, open_lb: 0.85, close_lb: 0.8, audit: 0.1, lams: [0.3], headline_lam: 0.3, max_stream: 2000, strict_cosine: null },
    areas: {
      bioclip2: {
        'BD-A': {
          fields: FIELDS,
          points: [[1, 1, null, 0, 0, 0], [20, 20, null, 0, 0, 0], [40, 40, 0.5, 0, 0, 0], [80, 80, 0.62, 0, 0, 0], [120, 120, 0.7, 0, 0, 0], [160, 160, 0.74, 0, 0, 0]],
          summary: { photos: 160, confirmations_until_open: null, officer_confirmations: 160, auto_answers: 0, auto_precision: null, auto_share_of_all_photos: 0, gate_closings: 0, open_at_end: false, suggestion_by_stage: { '0-50': [50, 0.5, 0.7], '50-200': [110, 0.6, 0.85] } },
        },
        'BD-D': {
          fields: FIELDS,
          points: [[1, 1, null, 0, 0, 0], [20, 20, null, 0, 0, 0], [40, 40, 0.61, 0, 0, 0], [60, 60, 0.8, 0, 0, 0], [75, 75, 0.86, 1, 0, 0], [200, 90, 0.9, 1, 110, 108], [600, 130, 0.92, 1, 480, 468], [1000, 170, 0.93, 1, 800, 780]],
          summary: { photos: 1000, confirmations_until_open: 74, officer_confirmations: 170, auto_answers: 800, auto_precision: 0.975, auto_share_of_all_photos: 0.8, gate_closings: 0, open_at_end: true, suggestion_by_stage: { '0-50': [50, 0.78, 0.9], '50-200': [150, 0.9, 0.97], '200-500': [300, 0.94, 0.99], '500-2000': [500, 0.96, 0.99] } },
        },
      },
    },
  });

  /* ---------------------------------------------------------------- the handler */
  const j = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const noModel = (route: Route) => j(route, { detail: 'the photo model is not installed on this server' }, 503);

  /** Answer the earned-trust endpoints; false = not one of ours. */
  async function handle(route: Route, req: Request, rawPath: string): Promise<boolean> {
    const path = decodeURIComponent(rawPath);
    const method = req.method();
    const base = `/api/demo/${SID}`;

    if (path === '/api/replay/area-trust') {
      if (opts.replay === 'missing' || !opts.replay) return j(route, { detail: 'no replay has been generated on this server' }, 404), true;
      return j(route, replay()), true;
    }

    if (path === '/api/verify/' + PHOTO_RECEIPT_ID || path === `/api/verify/urn:uuid:${PHOTO_RECEIPT_ID}`) {
      const credential = photoReceiptCredential();
      return j(route, st.withdrawn ? { status: 'recalled', reason: `rule(s) withdrawn: photo trust for ${MODEL} in ${AREA}`, rules: [`photo trust for ${MODEL} in ${AREA}`], credential, sandbox: true } : { status: 'authentic', reason: 'issued by KrishiLoop and unaltered (this is not a guarantee of correctness)', expired: false, credential, sandbox: true }), true;
    }
    if (path.endsWith(AREA_CRED.replace('urn:uuid:', '')) && path.startsWith('/api/verify/')) {
      const credential = areaCredential();
      return j(route, st.withdrawn || !st.open ? { status: 'recalled', reason: 'photo trust in this area was withdrawn: the officer’s recent verdicts no longer clear the bar', credential, sandbox: true } : { status: 'authentic', reason: 'issued by KrishiLoop and unaltered: this photo model had earned trust in this area when it was issued (this is not a guarantee of correctness)', credential, sandbox: true }), true;
    }

    if (!path.startsWith(base)) return false;
    const sub = path.slice(base.length);

    if (sub === '/plan' && method === 'POST') {
      const body = req.postDataJSON() as { field_id?: string; photo_case_id?: string };
      if (body.field_id !== PHOTO_FIELD) return false;
      if (body.photo_case_id) {
        const c = st.cases.find((x) => x.case_id === body.photo_case_id);
        if (!c || c.route !== 'auto') return j(route, { detail: 'this photo case was not answered automatically here' }, 409), true;
        if (!st.open) return j(route, { ...ricePlan(false), diagnosis_used: false, diagnosis_note: 'uncalibrated' }), true;
        return j(route, ricePlan(true)), true;
      }
      return j(route, ricePlan(false)), true;
    }

    if (!sub.startsWith('/photo') && !sub.startsWith('/areas/')) return false;
    if (st.unavailable) return noModel(route), true;

    if (sub.startsWith('/areas/')) return j(route, stats()), true;

    if (sub === '/photo' && method === 'POST') {
      if (opts.photoError === 422) return j(route, { detail: 'not a readable image' }, 422), true;
      if (opts.photoError === 429) return j(route, { detail: 'too many requests; try again in a minute' }, 429), true;
      const body = req.postDataJSON() as { consent?: boolean };
      const c = make({ consent: !!body.consent, photo_available: !!body.consent && st.route === 'officer' });
      st.cases.unshift(c);
      return j(route, c), true;
    }
    if (sub === '/photo/cases') return j(route, { cases: st.cases }), true;

    const image = /^\/photo\/(pc-[0-9a-f]+)\/image$/.exec(sub);
    if (image) {
      const c = st.cases.find((x) => x.case_id === image[1]);
      if (!c || !c.photo_available) return j(route, { detail: 'no photo for this case' }, 404), true;
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'cache-control': 'no-store' }, body: LEAF_SVG }), true;
    }

    const verdict = /^\/photo\/(pc-[0-9a-f]+)\/verdict$/.exec(sub);
    if (verdict && method === 'POST') {
      const c = st.cases.find((x) => x.case_id === verdict[1]);
      if (!c) return j(route, { detail: 'unknown photo case' }, 409), true;
      if (c.verdict) return j(route, { detail: 'case already judged' }, 409), true;
      const { label } = req.postDataJSON() as { label: string };
      c.verdict = label;
      c.photo_available = false;
      st.verdicts += 1;
      if (c.sure) {
        st.sure_n += 1;
        if (c.suggestion[0]!.label === label) st.right += 1;
      }
      let event: Ev | null = null;
      if (st.sure_n >= 30) {
        const bound = lb();
        if (!st.open && bound >= 0.85) {
          st.open = true;
          st.cred = AREA_CRED;
          event = { event: 'opened', at: new Date().toISOString(), verdicts: st.verdicts, sure_in_window: st.sure_n, precision: Math.round((st.right / st.sure_n) * 1e4) / 1e4, lower_bound: bound, policy_version: 1 };
        } else if (st.open && bound < 0.8) {
          st.open = false;
          st.withdrawn = true;
          event = { event: 'closed', at: new Date().toISOString(), verdicts: st.verdicts, sure_in_window: st.sure_n, precision: Math.round((st.right / st.sure_n) * 1e4) / 1e4, lower_bound: bound, policy_version: 1 };
        }
      }
      if (event) st.events.push(event);
      return j(route, { case: c, event, area: stats() }), true;
    }
    return false;
  }

  return { handle, state: st, stats, ricePlan };
}

export type PhotoMock = ReturnType<typeof createPhotoMock>;

/** The /api/demo answer with the photo demo's rice field and farmer D first (the app selects the first of each). */
export function demoWithRice(base: { fields: Record<string, unknown>[]; profiles: Record<string, unknown>[] }) {
  return {
    ...base,
    fields: [
      { field_id: PHOTO_FIELD, lat: 24.75, lon: 90.4, country: 'BD', precision: 'sample_location', label: 'Sample Bangladesh aman rice location at tillering (no farmer)', crop: 'rice', stage: 'tillering', pack_id: 'pack-bd-rice' },
      ...base.fields,
    ],
    profiles: [{ farmer_profile_id: PHOTO_PROFILE, bph_females_per_hill: 0, bph_nymphs_per_hill: 1, soil_drainage: 'good', crop_protected: false }, ...base.profiles],
  };
}

