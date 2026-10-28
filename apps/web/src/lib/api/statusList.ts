import { apiStore, isUnreachable } from './client';

/**
 * The public Bitstring Status List (GET /status/1) is a signed VC whose `encodedList` is a multibase
 * ('u' = base64url) gzip-compressed bitstring. A set bit means "withdrawn". Reading it in the browser gives us
 * a REAL live counter of withdrawn credentials, and lets the verifier show the bit it checked.
 */
export interface StatusList {
  /** number of withdrawn entries (set bits) */
  withdrawn: number;
  /** capacity in bits */
  size: number;
  bit: (index: number) => boolean;
  issuer?: string;
  validFrom?: string;
}

function b64urlToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function popcount(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    let v = b;
    while (v) {
      n += v & 1;
      v >>= 1;
    }
  }
  return n;
}

export function decodeBitstring(encodedList: string): Promise<Uint8Array> {
  const raw = encodedList.startsWith('u') ? encodedList.slice(1) : encodedList;
  return gunzip(b64urlToBytes(raw));
}

/**
 * The path of the status list a credential points at (`credentialStatus.statusListCredential`). Only a same-origin
 * `/status/<id>` path is ever fetched: the URL inside a credential is data, not an instruction. Demo sandboxes have
 * their own list (`/status/demo-<sid>`); everything else falls back to the official `/status/1`.
 */
export function statusPathOf(statusListCredential: string | undefined): string {
  try {
    const path = new URL(statusListCredential ?? '', window.location.origin).pathname;
    return /^\/status\/[A-Za-z0-9_-]{1,64}$/.test(path) ? path : '/status/1';
  } catch {
    return '/status/1';
  }
}

export async function fetchStatusList(path = '/status/1'): Promise<StatusList | null> {
  if (apiStore.get().forced) return null;
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const vc = (await res.json()) as { issuer?: string; validFrom?: string; credentialSubject?: { encodedList?: string } };
    const enc = vc.credentialSubject?.encodedList;
    if (!enc) return null;
    const bits = await decodeBitstring(enc);
    return {
      withdrawn: popcount(bits),
      size: bits.length * 8,
      // index 0 is the most significant bit of byte 0 (W3C Bitstring Status List)
      bit: (i) => (i >= 0 && i < bits.length * 8 ? ((bits[i >> 3]! >> (7 - (i & 7))) & 1) === 1 : false),
      issuer: vc.issuer,
      validFrom: vc.validFrom,
    };
  } catch (e) {
    if (isUnreachable(e) || e instanceof Error) return null;
    return null;
  }
}
