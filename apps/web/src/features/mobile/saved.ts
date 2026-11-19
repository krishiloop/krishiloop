import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import { verifyReceipt } from '../../lib/api/client';
import { held, type HeldReceipt, type StatusInfo } from '../farmer/receipts';

/**
 * Receipts saved ON THIS PHONE for the mobile app (/m). The farmer app keeps its receipts for one browser tab
 * (sessionStorage, like the demo sandbox that issued them); a phone app must still show them tomorrow and with no
 * internet. So every receipt the app receives is copied here (localStorage) with the last verdict the checker gave and
 * when. Offline the list shows that last verdict and says plainly that it is old: a receipt may have been withdrawn
 * since, and only a fresh check can say so. Nothing here is ever shown as checked when it was not.
 */
export type Verdict = 'authentic' | 'recalled' | 'invalid';
export interface LastCheck {
  s: Verdict;
  at: number;
  rules?: string[];
}
export interface SavedReceipt extends HeldReceipt {
  last?: LastCheck;
}

export const SAVED_KEY = 'kl.m.saved';
export const SAVED_MAX = 50;

const isVerdict = (s: string | undefined): s is Verdict => s === 'authentic' || s === 'recalled' || s === 'invalid';

/**
 * Pure merge (tested): new receipts first (newest first), a final verdict ("authentic", "recalled", "invalid") replaces
 * the saved one only when it is newer; "checking" and "unreachable" never overwrite a real verdict. At most SAVED_MAX.
 */
export function mergeSaved(saved: SavedReceipt[], items: HeldReceipt[], status: Record<string, StatusInfo>, max = SAVED_MAX): SavedReceipt[] {
  const byId = new Map(saved.map((x) => [x.id, x]));
  const fresh: SavedReceipt[] = [];
  for (const it of items) {
    if (!byId.has(it.id)) {
      const copy: SavedReceipt = { ...it };
      byId.set(it.id, copy);
      fresh.push(copy);
    }
  }
  const all = [...fresh, ...saved.map((x) => byId.get(x.id)!)];
  let changed = fresh.length > 0;
  const out = all.map((x) => {
    const st = status[x.id];
    if (!st || !isVerdict(st.s)) return x;
    if (x.last && x.last.at >= st.at && x.last.s === st.s) return x;
    if (x.last && x.last.at > st.at) return x;
    changed = true;
    return { ...x, last: { s: st.s, at: st.at, rules: st.rules } };
  });
  out.sort((a, b) => b.at - a.at);
  const capped = out.slice(0, max);
  return changed || capped.length !== saved.length ? capped : saved;
}

/** One saved receipt's verdict now: a fresh one from this visit if there is one, else the saved last check. */
export function shownVerdict(x: SavedReceipt, now: StatusInfo | undefined): { s: Verdict | 'checking' | 'unknown'; at?: number; fresh: boolean; rules?: string[] } {
  if (now && isVerdict(now.s)) return { s: now.s, at: now.at, fresh: true, rules: now.rules };
  if (now?.s === 'checking') return { s: 'checking', fresh: false };
  if (x.last) return { s: x.last.s, at: x.last.at, fresh: false, rules: x.last.rules };
  return { s: 'unknown', fresh: false };
}

export const savedStore = createStore<SavedReceipt[]>(readJSON<SavedReceipt[]>(SAVED_KEY) ?? []);
export const useSaved = () => savedStore.use();

function sync() {
  const h = held.get();
  const next = mergeSaved(savedStore.get(), h.items, h.status);
  if (next !== savedStore.get()) {
    savedStore.set(next);
    writeJSON(SAVED_KEY, next);
  }
}

let started = false;
/** Start copying every receipt the app receives (from Home, Ask or the leaf check) to this phone. Idempotent. */
export function startSaving(): void {
  if (started) return;
  started = true;
  sync();
  held.subscribe(sync);
}

/** Set a verdict for a saved receipt that is not part of this visit (checked from the list). */
function setLast(id: string, last: LastCheck) {
  const next = savedStore.get().map((x) => (x.id === id ? { ...x, last } : x));
  savedStore.set(next);
  writeJSON(SAVED_KEY, next);
}

let checking: Promise<void> | null = null;
/**
 * Check again the saved receipts that this visit does not hold (receipts from an earlier day). The visit's own receipts
 * are checked by the farmer app (refreshStatuses). An unreachable checker changes nothing.
 */
export function checkOlder(): Promise<void> {
  checking ??= (async () => {
    const mine = new Set(held.get().items.map((x) => x.id));
    for (const x of savedStore.get().filter((s) => !mine.has(s.id))) {
      try {
        const r = await verifyReceipt(x.id);
        if (r.status !== 'unreachable' && isVerdict(r.status)) setLast(x.id, { s: r.status, at: Date.now(), rules: r.rules });
      } catch {
        /* a real error answer is shown when the receipt is opened; the list keeps its last check */
      }
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** Remove every receipt saved on this phone (Help: "Start again"). */
export function forgetSaved() {
  savedStore.set([]);
  writeJSON(SAVED_KEY, []);
}
