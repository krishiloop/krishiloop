import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import { verifyReceipt, type VerifyOutcome } from '../../lib/api/client';
import type { AskResponse } from '../../lib/api/ask';
import type { DataSource, Plan, Receipt } from '../../lib/api/types';
import { logVerify } from './inspector';

/**
 * The receipts this visitor received in this tab (plans and Ask answers), newest first, and what the verifier says about
 * each one now. Kept for the tab (sessionStorage), like the demo sandbox that issued them. A recall in the officer
 * console changes the verdict of exactly these receipts, so the statuses are re-checked when the list is shown.
 */
export interface HeldReceipt {
  id: string;
  receipt: Receipt;
  via: 'plan' | 'ask';
  fieldId: string;
  at: number;
  recorded: boolean;
}
export type LiveStatus = 'checking' | 'authentic' | 'recalled' | 'invalid' | 'unreachable';
export interface StatusInfo {
  s: LiveStatus;
  rules?: string[];
  expired?: boolean;
  at: number;
}
interface Held {
  items: HeldReceipt[];
  status: Record<string, StatusInfo>;
}

const KEY = 'kl.farmer.receipts';
const MAX = 30;
export const held = createStore<Held>(readJSON<Held>(KEY, 'session') ?? { items: [], status: {} });
const save = (h: Held) => writeJSON(KEY, h, 'session');
export const useHeld = () => held.use();

function add(list: HeldReceipt[]) {
  if (!list.length) return;
  held.set((h) => {
    const known = new Set(h.items.map((x) => x.id));
    const fresh = list.filter((x) => !known.has(x.id));
    if (!fresh.length) return h;
    const next = { ...h, items: [...fresh, ...h.items].slice(0, MAX) };
    save(next);
    return next;
  });
}

export function holdPlan(plan: Plan, source: DataSource) {
  const at = Date.now();
  add(
    (plan.actions ?? [])
      .filter((a) => a.receipt_credential_id)
      .map((a) => ({ id: a.receipt_credential_id!, receipt: a.receipt, via: 'plan' as const, fieldId: plan.field_id, at, recorded: source !== 'live' })),
  );
}

export function holdAsk(r: AskResponse, recorded: boolean) {
  if (r.status !== 'ok' || !r.answer) return;
  add([{ id: r.answer.receipt_credential_id, receipt: r.answer.action.receipt, via: 'ask', fieldId: r.field_id, at: Date.now(), recorded }]);
}

export function statusOf(r: VerifyOutcome): StatusInfo {
  if (r.status === 'unreachable') return { s: 'unreachable', at: Date.now() };
  return { s: r.status, rules: r.rules, expired: r.expired, at: Date.now() };
}

export function setStatus(id: string, info: StatusInfo) {
  held.set((h) => {
    const next = { ...h, status: { ...h.status, [id]: info } };
    save(next);
    return next;
  });
}

let running: Promise<void> | null = null;

/**
 * Ask the verifier about every held receipt (four at a time). The inspector gets one entry per receipt whose verdict
 * changed (a recall reaching it), not one per check.
 */
export function refreshStatuses(): Promise<void> {
  running ??= (async () => {
    const items = held.get().items;
    const queue = [...items];
    const changed: { id: string; r: VerifyOutcome }[] = [];
    const work = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        const before = held.get().status[it.id]?.s;
        let r: VerifyOutcome;
        try {
          r = await verifyReceipt(it.id);
        } catch (e) {
          r = { status: 'unreachable', reason: e instanceof Error ? e.message : String(e), source: 'none' };
        }
        const info = statusOf(r);
        if (before && before !== 'checking' && before !== info.s) changed.push({ id: it.id, r });
        setStatus(it.id, info);
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    for (const c of changed) logVerify(c.id, c.r);
  })().finally(() => {
    running = null;
  });
  return running;
}

export function forgetReceipts() {
  const empty = { items: [], status: {} };
  save(empty);
  held.set(empty);
}
