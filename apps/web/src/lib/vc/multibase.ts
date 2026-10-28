/**
 * Multibase base58btc ("z" + Bitcoin alphabet) and Ed25519 multikeys, as services/trust/vc.py encodes them:
 *  - `proofValue` = "z" + base58btc(64-byte signature)
 *  - `publicKeyMultibase` = "z" + base58btc(0xed 0x01 + 32-byte Ed25519 public key)
 *
 * The decoder is strict: any character outside the alphabet (spaces included) is refused.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

/** The multicodec header of an Ed25519 public key (varint 0xed). */
export const ED25519_PUB_HEADER = [0xed, 0x01] as const;

export class MultibaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultibaseError';
  }
}

/** Decode plain base58btc (no multibase prefix). Leading "1"s are leading zero bytes. */
export function base58btcDecode(s: string): Uint8Array<ArrayBuffer> {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  // little-endian base-256 digits of the number
  const digits: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const value = INDEX[s[i]];
    if (value === undefined) throw new MultibaseError(`"${s[i]}" is not a base58btc character`);
    let carry = value;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 58;
      digits[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      digits.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + digits.length);
  for (let i = 0; i < digits.length; i++) out[zeros + i] = digits[digits.length - 1 - i];
  return out;
}

/** Decode a multibase string; only base58btc ("z") is used by eddsa-jcs-2022. */
export function multibaseDecode(mb: string): Uint8Array<ArrayBuffer> {
  if (typeof mb !== 'string' || !mb.startsWith('z')) throw new MultibaseError('not multibase base58btc (it must start with "z")');
  return base58btcDecode(mb.slice(1));
}

/** The raw 32-byte Ed25519 key inside a `publicKeyMultibase` multikey (0xed01 header). */
export function ed25519KeyFromMultikey(mb: string): Uint8Array<ArrayBuffer> {
  const raw = multibaseDecode(mb);
  if (raw.length < 2 || raw[0] !== ED25519_PUB_HEADER[0] || raw[1] !== ED25519_PUB_HEADER[1]) throw new MultibaseError('not an Ed25519 multikey (no 0xed01 header)');
  if (raw.length !== 34) throw new MultibaseError(`an Ed25519 key has 32 bytes, this one has ${raw.length - 2}`);
  return raw.slice(2);
}

/** Encode bytes as base58btc (used by the tests to build keys and signatures; the app only decodes). */
export function base58btcEncode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = []; // little-endian base-58 digits
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join('');
}
