import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import { MOCK_INBOX } from '../../lib/api/mocks';
import { fetchDemoInbox } from '../../lib/api/client';
import type { InboxItem, Plan } from '../../lib/api/types';

/**
 * The officer inbox.
 *  - live: this tab's demo-sandbox cases (GET /api/demo/{sid}/inbox, no token), plus photo cases the phone kept for itself.
 *  - recorded (API unreachable, or ?sample=1): the recorded inbox of our server, plus abstentions the farmer app showed here.
 * Resolving is kept in THIS browser only: the official resolve endpoint (POST /api/inbox/{id}/resolve) needs an officer's
 * admin token, which a public demo never holds. The screens say so.
 *
 * `registerCase`, `registerPhotoCase`, `updatePhotoCase` and `withdrawPhotoCase` are called by the farmer app.
 */
interface Overlay {
  resolved: Record<string, { note: string; at: string; by: string }>;
  reopened: string[];
  fromPlans: InboxItem[];
}

const KEY = 'kl.inbox.v1';
const empty: Overlay = { resolved: {}, reopened: [], fromPlans: [] };
const overlay = createStore<Overlay>(readJSON<Overlay>(KEY) ?? empty);
overlay.subscribe(() => writeJSON(KEY, overlay.get()));

export type InboxLoad = 'idle' | 'loading' | 'ready' | 'error';
interface Remote {
  /** the sandbox's cases; null while the recorded cases are what is shown */
  items: InboxItem[] | null;
  load: InboxLoad;
  /** live: from the sandbox; recorded: the recorded inbox */
  source: 'live' | 'recorded' | null;
}
const remote = createStore<Remote>({ items: null, load: 'idle', source: null });

/** Fetch this session's cases. Any failure leaves the recorded cases on screen, labelled. */
export async function loadInbox(): Promise<void> {
  remote.set((r) => ({ ...r, load: r.load === 'ready' ? 'ready' : 'loading' }));
  try {
    const res = await fetchDemoInbox();
    remote.set({ items: res.source === 'live' ? res.data : null, load: 'ready', source: res.source === 'live' ? 'live' : 'recorded' });
  } catch {
    remote.set({ items: null, load: 'error', source: 'recorded' });
  }
}

/**
 * A case the farmer app made in recorded mode, where there is no server to send it to (builder R: "ask an officer to
 * visit or call"). Kept in this browser like the others; the farmer screen says it was not sent.
 */
export function registerLocalCase(item: InboxItem) {
  const cur = overlay.get();
  if (cur.fromPlans.some((c) => c.item_id === item.item_id)) return;
  overlay.set({ ...cur, fromPlans: [item, ...cur.fromPlans].slice(0, 20) });
}

/** Called when the farmer app shows an abstention, so the officer inbox has the case to open. */
export function registerCase(plan: Plan, farmerLabel: string) {
  const a = plan.abstention;
  if (!a) return;
  const cur = overlay.get();
  if (cur.fromPlans.some((c) => c.item_id === a.inbox_item_id) || MOCK_INBOX.some((c) => c.item_id === a.inbox_item_id)) return;
  const item: InboxItem = {
    item_id: a.inbox_item_id,
    field_id: plan.field_id,
    farmer_display_name: farmerLabel,
    reason_code: a.reason_code,
    reason: a.reason,
    diagnosis_id: null,
    top_labels: [],
    question: null,
    photo_attached: false,
    status: 'open',
    resolution_note: null,
    created_at: plan.generated_at,
    resolved_at: null,
    resolved_by: null,
  };
  overlay.set({ ...cur, fromPlans: [item, ...cur.fromPlans].slice(0, 20) });
}

/**
 * A photo reading that went to the officer from the on-device check: not sure enough (`low_confidence`), or the farmer
 * asked for a second opinion (`farmer_requested`). The photo never leaves the phone: the case carries the labels, the
 * probabilities and the diagnosis id.
 */
export function registerPhotoCase(opts: {
  fieldId: string;
  farmerLabel: string;
  top: { label: string; prob: number }[];
  diagnosisId?: string;
  reason?: 'low_confidence' | 'farmer_requested';
  /** the reading came from the sample engine (a scripted example), not a model */
  sample?: boolean;
}): string {
  const id = `inbox-photo-${Math.random().toString(16).slice(2, 10)}`;
  const asked = opts.reason === 'farmer_requested';
  const item: InboxItem = {
    item_id: id,
    field_id: opts.fieldId,
    farmer_display_name: opts.farmerLabel,
    reason_code: asked ? 'farmer_requested' : 'low_confidence',
    reason: opts.sample
      ? {
          en: `Sample photo reading (a scripted example, not a model output): ${asked ? 'the farmer asked for a second opinion.' : 'it was not sure, so it did not guess.'}`,
          bn: `নমুনা ছবির ফলাফল (স্ক্রিপ্ট করা উদাহরণ, মডেলের ফল নয়): ${asked ? 'কৃষক দ্বিতীয় মতামত চেয়েছেন।' : 'নিশ্চিত ছিল না, তাই অনুমান করেনি।'}`,
        }
      : asked
        ? { en: 'The farmer asked for a second opinion on a photo reading from the on-device model.', bn: 'কৃষক ফোনের মডেলের ছবির ফলাফলে দ্বিতীয় মতামত চেয়েছেন।' }
        : { en: 'Low-confidence photo reading: the on-device model was not sure, so it did not guess.', bn: 'ছবির ফলাফলে আত্মবিশ্বাস কম: ফোনের মডেল নিশ্চিত ছিল না, তাই অনুমান করেনি।' },
    diagnosis_id: opts.diagnosisId ?? `dx-local-${id.slice(-8)}`,
    top_labels: opts.top.slice(0, 3),
    question: null,
    photo_attached: false,
    status: 'open',
    resolution_note: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
  };
  const cur = overlay.get();
  overlay.set({ ...cur, fromPlans: [item, ...cur.fromPlans].slice(0, 20) });
  return id;
}

/** The farmer added photos: the same case now carries the newer (averaged) labels. */
export function updatePhotoCase(id: string, patch: { top: { label: string; prob: number }[]; diagnosisId?: string }) {
  const cur = overlay.get();
  if (!cur.fromPlans.some((c) => c.item_id === id)) return;
  overlay.set({
    ...cur,
    fromPlans: cur.fromPlans.map((c) => (c.item_id === id ? { ...c, top_labels: patch.top.slice(0, 3), diagnosis_id: patch.diagnosisId ?? c.diagnosis_id } : c)),
  });
}

/** More photos gave a surer answer, so the case is closed by the farmer's own app (and says so). */
export function withdrawPhotoCase(id: string, note: string) {
  const cur = overlay.get();
  if (!cur.fromPlans.some((c) => c.item_id === id)) return;
  overlay.set({ ...cur, resolved: { ...cur.resolved, [id]: { note, at: new Date().toISOString(), by: 'farmer-app' } }, reopened: cur.reopened.filter((x) => x !== id) });
}

/** Resolve in this browser only (`by: 'demo-officer'`; the screens say who in their own words). */
export function resolveCase(id: string, note: string) {
  const cur = overlay.get();
  overlay.set({ ...cur, resolved: { ...cur.resolved, [id]: { note, at: new Date().toISOString(), by: 'demo-officer' } }, reopened: cur.reopened.filter((x) => x !== id) });
}

export function reopenCase(id: string) {
  const cur = overlay.get();
  const { [id]: _drop, ...rest } = cur.resolved;
  void _drop;
  overlay.set({ ...cur, resolved: rest, reopened: cur.reopened.includes(id) ? cur.reopened : [...cur.reopened, id] });
}

/** A case the phone made for itself (never sent): its id starts `inbox-photo-`. */
export const isLocalCase = (id: string) => id.startsWith('inbox-photo-');
export const isRecordedCase = (id: string) => MOCK_INBOX.some((c) => c.item_id === id);
/** Resolved here, in this browser (not on the server). */
export const isResolvedHere = (id: string) => id in overlay.get().resolved;

function merge(o: Overlay, live: InboxItem[] | null): InboxItem[] {
  const base = live ? [...o.fromPlans.filter((c) => isLocalCase(c.item_id)), ...live] : [...o.fromPlans, ...MOCK_INBOX];
  return base
    .map((it): InboxItem => {
      const r = o.resolved[it.item_id];
      if (r) return { ...it, status: 'resolved', resolution_note: r.note, resolved_at: r.at, resolved_by: r.by };
      if (o.reopened.includes(it.item_id)) return { ...it, status: 'open', resolution_note: null, resolved_at: null, resolved_by: null };
      return it;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

let cache: { o: Overlay; r: InboxItem[] | null; out: InboxItem[] } | null = null;
const merged = (o: Overlay, r: InboxItem[] | null) => {
  if (cache && cache.o === o && cache.r === r) return cache.out;
  cache = { o, r, out: merge(o, r) };
  return cache.out;
};

export const useInbox = (): InboxItem[] => {
  const o = overlay.use();
  const r = remote.use();
  return merged(o, r.items);
};

export const useInboxMeta = (): { live: boolean; load: InboxLoad; source: Remote['source'] } => {
  const r = remote.use();
  return { live: r.items !== null, load: r.load, source: r.source };
};
