import type { AreaTrustSubject, Credential, Plan, Receipt } from '../../lib/api/types';
import { readJSON } from '../../lib/storage';
import { PLAN_CACHE_PREFIX } from '../../lib/api/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts a pasted link, `urn:uuid:...`, or a bare UUID (what the QR carries) and returns the credential id. */
export function normalizeId(input: string): string {
  let s = input.trim();
  const tryDecode = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  s = tryDecode(s);
  if (s.includes('/verify/')) s = s.split('/verify/').pop()!;
  s = tryDecode(s.split(/[?#]/)[0]!.trim());
  if (s.startsWith('urn:uuid:')) return s;
  if (UUID.test(s)) return `urn:uuid:${s}`;
  return s;
}

export const isReceipt = (c: Credential | null): c is Credential & { credentialSubject: Receipt } => !!c && c.type.includes('AdviceReceiptCredential');

/** An area's earned photo trust (issued when its gate opened, withdrawn when it closed). */
export const isAreaTrust = (c: Credential | null): c is Credential & { credentialSubject: AreaTrustSubject } => !!c && c.type.includes('AreaTrustCredential');

/** Receipts the visitor already has in this tab's demo sandbox (from saved farmer plans), so the verifier can offer them. */
export function receiptsOnDevice(): { id: string; title: string; rule: string; sample: boolean }[] {
  const out: { id: string; title: string; rule: string; sample: boolean }[] = [];
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith(PLAN_CACHE_PREFIX)) continue;
      const hit = readJSON<{ plan: Plan }>(key, 'session');
      for (const a of hit?.plan.actions ?? []) {
        if (a.receipt_credential_id && !out.some((o) => o.id === a.receipt_credential_id)) {
          out.push({ id: a.receipt_credential_id, title: a.title.en ?? Object.values(a.title)[0] ?? a.action_id, rule: `${a.receipt.rule_refs[0]?.rule_id ?? ''} v${a.receipt.rule_refs[0]?.version ?? 1}`, sample: a.receipt_credential_id.startsWith('urn:uuid:534d504c-') });
        }
      }
    }
  } catch {
    /* storage unavailable */
  }
  return out.slice(0, 4);
}

export const SAMPLE_RECEIPT_IDS = ['534d504c-0000-4000-8000-000000000001', '534d504c-0000-4000-8000-000000000002'];
