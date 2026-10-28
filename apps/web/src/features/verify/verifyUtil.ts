import type { AreaTrustSubject, Credential, Reading, Receipt, VerifyStatus } from '../../lib/api/types';
import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const decode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/**
 * What a visitor pastes or a QR carries, turned into a credential id: a full verify link (any host), `urn:uuid:...`,
 * or a bare UUID. Returns '' for empty input. Anything else is returned trimmed (the verifier then says it does not know it).
 */
export function normalizeId(input: string): string {
  let s = decode(input.trim());
  if (!s) return '';
  if (s.includes('/verify/')) s = s.split('/verify/').pop() ?? '';
  s = decode(s.split(/[?#]/)[0]!.trim()).replace(/\/+$/, '');
  if (s.startsWith('urn:uuid:')) return s;
  if (UUID.test(s)) return `urn:uuid:${s.toLowerCase()}`;
  return s;
}

/** True when the input looks like something KrishiLoop issued (a UUID, with or without its link). */
export const looksLikeReceipt = (input: string) => {
  const id = normalizeId(input);
  return id.startsWith('urn:uuid:') && UUID.test(id.slice(9));
};

/** The path of a credential's verify page: the bare UUID keeps links (and QRs) short. */
export const verifyPath = (id: string) => `/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`;

export const isReceipt = (c: Credential | null | undefined): c is Credential & { credentialSubject: Receipt } => !!c && c.type.includes('AdviceReceiptCredential');

/** An area's earned photo trust (issued when its gate opened, withdrawn when it closed). */
export const isAreaTrust = (c: Credential | null | undefined): c is Credential & { credentialSubject: AreaTrustSubject } => !!c && c.type.includes('AreaTrustCredential');

/** "rice@BD" style area of a credential subject, or ''. */
export const areaOf = (s: AreaTrustSubject | null | undefined) => s?.area ?? '';

/* ------------------------------------------------------------------ readings: one row per signed reading */
const DATED = /^(.*)\[(\d{4}-\d{2}-\d{2})\]$/;

export interface ReadingRow {
  key: string;
  variable: string;
  /** the date in a dated variable name (`relative_humidity_2m_mean[2026-10-28]`), if any */
  day: string | null;
  value: string;
  unit: string;
  source: string;
  observed_at: string;
  retrieved_at: string;
  derived: boolean;
}

const fmtValue = (v: Reading['value']) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)) : String(v));

export function readingRows(data: Reading[]): ReadingRow[] {
  return data.map((r, i) => {
    const m = DATED.exec(r.variable);
    return {
      key: `${i}-${r.variable}`,
      variable: m ? m[1]! : r.variable,
      day: m ? m[2]! : null,
      value: r.variable === 'question_sha256' ? `${String(r.value).slice(0, 16)}…` : fmtValue(r.value),
      unit: r.unit ?? '',
      source: r.source,
      observed_at: r.observed_at,
      retrieved_at: r.retrieved_at,
      derived: r.source === 'krishiloop:derived',
    };
  });
}

/* ------------------------------------------------------------------ receipts this browser checked (local, never sent) */
export type RecentStatus = VerifyStatus | 'expired';
export interface RecentCheck {
  id: string;
  status: RecentStatus;
  /** a short English or Bangla title of the advice, as the receipt carried it */
  title: Record<string, string> | null;
  kind: 'receipt' | 'area' | 'other';
  at: string;
  recorded: boolean;
}

const RECENT_KEY = 'kl.verify.recent';
const MAX_RECENT = 6;
export const recentChecks = createStore<RecentCheck[]>(readJSON<RecentCheck[]>(RECENT_KEY) ?? []);

export function rememberCheck(c: RecentCheck) {
  recentChecks.set((cur) => {
    const next = [c, ...cur.filter((x) => x.id !== c.id)].slice(0, MAX_RECENT);
    writeJSON(RECENT_KEY, next);
    return next;
  });
}

export function clearChecks() {
  writeJSON(RECENT_KEY, []);
  recentChecks.set([]);
}

/* ------------------------------------------------------------------ downloads */
/** The signed credential as a file (exactly the JSON the verifier checked, pretty-printed). */
export function downloadCredential(cred: Credential) {
  const blob = new Blob([`${JSON.stringify(cred, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `krishiloop-${cred.id.replace(/^urn:uuid:/, '').slice(0, 8)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
