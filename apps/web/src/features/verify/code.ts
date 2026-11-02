import { HttpError, isUnreachable, request } from '../../lib/api/client';
import { recordedIdForCode } from '../../data/recorded';

/**
 * Short verify codes (services/reach/codes.py): 8 Crockford base32 characters, shown as 7KQ2-MX4P, printed in the SMS and
 * on the receipt. A code is a LOOKUP HANDLE, not a proof: it only finds the receipt's id. The verifier then checks the
 * signature in this browser, exactly as for a scanned QR.
 *
 * Typing rules, as on the server: any case, dashes and spaces ignored, O reads as 0, I and L read as 1. U is not a code
 * letter.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VALID = new RegExp(`^[${ALPHABET}]{8}$`);

/** What a person typed (or a /v/ link) -> the canonical code (8 characters, no dash), or '' when it cannot be a code. */
export function normalizeCode(input: string): string {
  let s = input.trim();
  if (s.length > 64) return '';
  const link = /\/v\/([^/?#]+)/.exec(s);
  if (link) s = link[1]!;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep it as typed */
  }
  s = s
    .replace(/[\s\-‐-―_.]+/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return VALID.test(s) ? s : '';
}

/** 7KQ2MX4P -> 7KQ2-MX4P */
export const displayCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const codePath = (code: string) => `/v/${displayCode(code)}`;

export type CodeLookup = { kind: 'found'; credentialId: string } | { kind: 'unknown' } | { kind: 'busy' } | { kind: 'unreachable' };

/**
 * GET /api/code/{code}: the receipt's credential id, 'unknown' (404), 'busy' (429: the server limits lookups per
 * minute, so codes cannot be guessed in bulk) or 'unreachable' (the API did not answer).
 */
export async function lookupCode(code: string): Promise<CodeLookup> {
  // a recorded receipt's code resolves without the server (sample mode), like the recorded receipt itself
  const recorded = await recordedIdForCode(code);
  if (recorded) return { kind: 'found', credentialId: recorded };
  try {
    const r = await request<{ credential_id: string }>(`/api/code/${encodeURIComponent(code)}`);
    return typeof r.credential_id === 'string' && r.credential_id ? { kind: 'found', credentialId: r.credential_id } : { kind: 'unknown' };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { kind: 'unknown' };
    if (e instanceof HttpError && e.status === 429) return { kind: 'busy' };
    if (isUnreachable(e) || e instanceof HttpError) return { kind: 'unreachable' };
    throw e;
  }
}
