import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';

/**
 * The recalls this browser tab made from the officer console: rule version, the officer's reason and the time. The API's
 * verify answer says WHICH rule was withdrawn but not why or when, so the verifier's timeline reads them from here when the
 * recall was made in this tab. Kept in sessionStorage (one sandbox per tab), never sent anywhere.
 */
export interface RecallEntry {
  rule_id: string;
  version: number;
  reason: string;
  at: string;
  /** `sandbox`: a real recall in this tab's demo sandbox; `sample`: simulated in the browser on recorded receipts */
  mode: 'sandbox' | 'sample';
  /** the sandbox it was made in (null for a simulation) */
  sid: string | null;
}

const KEY = 'kl.officer.recalls';
export const recallLog = createStore<RecallEntry[]>(readJSON<RecallEntry[]>(KEY, 'session') ?? []);

export function logRecall(e: RecallEntry) {
  recallLog.set((cur) => {
    const next = [...cur.filter((x) => !(x.rule_id === e.rule_id && x.version === e.version && x.mode === e.mode && x.sid === e.sid)), e];
    writeJSON(KEY, next, 'session');
    return next;
  });
}

/** Forget the simulated recalls (the visitor reset the recorded sandbox) or one sandbox's recalls (a fresh sandbox). */
export function forgetRecalls(match: (e: RecallEntry) => boolean) {
  recallLog.set((cur) => {
    const next = cur.filter((e) => !match(e));
    writeJSON(KEY, next, 'session');
    return next;
  });
}

/** "R-BDR-002 v1" -> the entry this tab logged for it, if any. */
export function recallOf(label: string, mode: RecallEntry['mode'], sid: string | null): RecallEntry | null {
  const m = /^(R-[A-Z]{2,8}-\d{3}) v(\d+)$/.exec(label.trim());
  if (!m) return null;
  return recallLog.get().find((e) => e.rule_id === m[1] && e.version === Number(m[2]) && e.mode === mode && (mode === 'sample' || e.sid === sid)) ?? null;
}
