import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import { MOCK_INBOX } from '../../lib/api/mocks';
import { fetchDemoInbox } from '../../lib/api/client';
import type { InboxItem, Plan } from '../../lib/api/types';

/**
 * Officer inbox state.
 *  - live: the cases of this tab's demo sandbox (GET /api/demo/{sid}/inbox, no token), plus photo cases the phone kept
 *    for itself. The real officer inbox (GET /api/inbox) needs an officer account, which is planned.
 *  - sample (API unreachable, or ?sample=1): the SAMPLE cases plus any abstention the farmer app produced on this device.
 * Resolutions are kept in this browser only: the sandbox has no resolve endpoint.
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

interface Remote {
  /** the sandbox's cases; null while sample data is what is shown */
  items: InboxItem[] | null;
  loading: boolean;
}
const remote = createStore<Remote>({ items: null, loading: false });

/** Fetch this session's cases. On any failure (or sample mode) the sample cases stay on screen. */
export async function loadInbox(): Promise<void> {
  remote.set((r) => ({ ...r, loading: true }));
  try {
    const res = await fetchDemoInbox();
    remote.set({ items: res.source === 'live' ? res.data : null, loading: false });
  } catch {
    remote.set({ items: null, loading: false });
  }
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
 * A photo reading that went to the officer: the model was not sure enough to act (`low_confidence`), or the farmer asked
 * for a second opinion (`farmer_requested`). The photo itself is NOT sent (it never leaves the phone): the case carries
 * the labels, the probabilities and the diagnosis id, which is what the diagnosis receipt names.
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
        ? {
            en: 'The farmer asked for a second opinion on a photo reading from the on-device model.',
            bn: 'কৃষক ফোনের মডেলের ছবির ফলাফলে দ্বিতীয় মতামত চেয়েছেন।',
          }
        : {
            en: 'Low-confidence photo reading: the on-device model was not sure, so it did not guess.',
            bn: 'ছবির ফলাফলে আত্মবিশ্বাস কম: ফোনের মডেল নিশ্চিত ছিল না, তাই অনুমান করেনি।',
          },
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
  overlay.set({
    ...cur,
    resolved: { ...cur.resolved, [id]: { note, at: new Date().toISOString(), by: 'Farmer app' } },
    reopened: cur.reopened.filter((x) => x !== id),
  });
}

export function resolveCase(id: string, note: string) {
  const cur = overlay.get();
  overlay.set({
    ...cur,
    resolved: { ...cur.resolved, [id]: { note, at: new Date().toISOString(), by: 'Sample officer' } },
    reopened: cur.reopened.filter((x) => x !== id),
  });
}

export function reopenCase(id: string) {
  const cur = overlay.get();
  const { [id]: _drop, ...rest } = cur.resolved;
  void _drop;
  overlay.set({ ...cur, resolved: rest, reopened: cur.reopened.includes(id) ? cur.reopened : [...cur.reopened, id] });
}

/** A case the phone made for itself (never sent): its id starts `inbox-photo-`. */
const isLocalPhotoCase = (id: string) => id.startsWith('inbox-photo-');

function merge(o: Overlay, live: InboxItem[] | null): InboxItem[] {
  const base = live ? [...o.fromPlans.filter((c) => isLocalPhotoCase(c.item_id)), ...live] : [...o.fromPlans, ...MOCK_INBOX];
  return base
    .map((it): InboxItem => {
      const r = o.resolved[it.item_id];
      if (r) return { ...it, status: 'resolved', resolution_note: r.note, resolved_at: r.at, resolved_by: r.by };
      if (o.reopened.includes(it.item_id)) return { ...it, status: 'open', resolution_note: null, resolved_at: null, resolved_by: null };
      return it;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const useInbox = (): InboxItem[] => {
  const o = overlay.use();
  const r = remote.use();
  return merge(o, r.items);
};

/** `live`: the cases come from the demo sandbox; otherwise they are sample cases. */
export const useInboxMeta = (): { live: boolean; loading: boolean } => {
  const r = remote.use();
  return { live: r.items !== null, loading: r.loading };
};

export const isSampleCase = (id: string) => MOCK_INBOX.some((c) => c.item_id === id);
export const isLocalCase = isLocalPhotoCase;
