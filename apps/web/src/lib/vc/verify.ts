/**
 * Check a KrishiLoop credential's signature in the browser: W3C Data Integrity, cryptosuite eddsa-jcs-2022.
 *
 * This mirrors the server, services/trust/vc.py `verify_signature()` with store.py `resolve_key()`, step by step
 * (vc-di-eddsa §3.3.2):
 *   1. the proof is one DataIntegrityProof, cryptosuite eddsa-jcs-2022, proofPurpose assertionMethod;
 *      `proofValue` is multibase base58btc ("z…") and `created` is an XML Schema dateTime;
 *   2. proofOptions = the proof without `proofValue` (it KEEPS its `@context`); unsecured = the credential without `proof`;
 *   3. if the proof has an `@context`, the credential's `@context` must start with it, and unsecured.@context is set to it;
 *   4. hashData = SHA-256(JCS(proofOptions)) followed by SHA-256(JCS(unsecured)): the proof hash comes FIRST;
 *   5. Ed25519-verify the 64-byte signature over those 64 bytes with the key named by `verificationMethod`, an
 *      Ed25519 multikey ("z" + base58btc(0xed01 + 32 bytes)).
 * Looking the key up in the DID document adds what store.resolve_key() knows implicitly: the key belongs to that DID,
 * the DID authorises it for assertionMethod, and the credential's issuer is that DID.
 *
 * A signature that checks out means "issued by this key and not altered since". It says nothing about recall or expiry
 * (those come from the server's Bitstring Status List) and never that the advice is right.
 *
 * No dependencies: JCS, base58btc and multikey decoding are in this folder; SHA-256 and Ed25519 are WebCrypto.
 * A browser without WebCrypto Ed25519 (or a page not served from a secure context) gets `reason: 'unsupported'`.
 */
import type { Credential, DidDocument } from '../api/types';
import { canonicalBytes, canonicalize } from './jcs';
import { ed25519KeyFromMultikey, multibaseDecode } from './multibase';

export type LocalCheck = { ok: true; suite: 'eddsa-jcs-2022'; keyId: string } | { ok: false; reason: string };

/** Every `reason` a failed check can give (the type stays `string` in `LocalCheck` so callers can show it as is). */
export const LOCAL_CHECK_REASONS = [
  /** this browser cannot run SHA-256 + Ed25519 here (no WebCrypto Ed25519, or not a secure context): the server check still applies */
  'unsupported',
  /** no DID document was given */
  'no-did-document',
  /** the credential has no single proof object */
  'no-proof',
  /** the proof is not a DataIntegrityProof with cryptosuite eddsa-jcs-2022 */
  'wrong-suite',
  /** the proof's purpose is not assertionMethod */
  'wrong-purpose',
  /** proof.created is not an XML Schema dateTime */
  'bad-created',
  /** proofValue is not multibase base58btc of a 64-byte signature */
  'bad-proof-value',
  /** the credential's @context does not start with the proof's @context */
  'context-mismatch',
  /** the proof names no verification method */
  'missing-verification-method',
  /** the verification method is not in the DID document */
  'unknown-verification-method',
  /** the DID document does not authorise that key for assertionMethod */
  'not-assertion-method',
  /** the key is controlled by someone other than the DID */
  'controller-mismatch',
  /** the credential's issuer is not the DID that holds the key */
  'issuer-mismatch',
  /** the key is not an Ed25519 multikey */
  'bad-key',
  /** the content cannot be canonicalised (not I-JSON) */
  'not-canonicalizable',
  /** the Ed25519 signature does not match: the content was altered, or another key signed it */
  'signature-mismatch',
] as const;
export type LocalCheckReason = (typeof LOCAL_CHECK_REASONS)[number];

/** What each step found, for a page that shows the check as it runs. */
export type ProofStep =
  | { step: 'key'; keyId: string; publicKeyHex: string }
  | { step: 'canonical'; proofConfig: string; document: string; proofBytes: number; documentBytes: number }
  | { step: 'hash'; proofHash: string; documentHash: string }
  | { step: 'signature'; valid: boolean };

export interface CheckOptions {
  /** called after each step completes, in order: key, canonical, hash, signature */
  onStep?: (step: ProofStep) => void;
}

const SUITE = 'eddsa-jcs-2022';
/** services/trust/vc.py XSD_DATETIME */
const XSD_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const fail = (reason: LocalCheckReason): LocalCheck => ({ ok: false, reason });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/* ------------------------------------------------------------------ can this browser do it? */
// RFC 8032 §7.1 test 1: a known key, the empty message and its signature. Importing AND verifying it proves real support.
const PROBE_KEY = fromHex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
const PROBE_SIG = fromHex('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');

const subtleCrypto = (): SubtleCrypto | null => (typeof globalThis.crypto === 'object' && globalThis.crypto?.subtle) || null;

let support: Promise<boolean> | null = null;
/** True when this browser can verify Ed25519 with WebCrypto here (checked once, with the RFC 8032 test vector). */
export function ed25519Supported(): Promise<boolean> {
  support ??= (async () => {
    const subtle = subtleCrypto();
    if (!subtle) return false;
    try {
      const key = await subtle.importKey('raw', PROBE_KEY, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, key, PROBE_SIG, new Uint8Array(0));
    } catch {
      return false;
    }
  })();
  return support;
}

/* ------------------------------------------------------------------ the key, from the DID document */
type KeyLookup = { ok: true; keyId: string; publicKey: Uint8Array<ArrayBuffer> } | { ok: false; reason: LocalCheckReason };

function lookUpKey(did: DidDocument, vmId: string, issuer: unknown): KeyLookup {
  const docId = did.id;
  const absolute = (ref: string) => (ref.startsWith('#') ? `${docId}${ref}` : ref);
  const hash = vmId.indexOf('#');
  // the key must belong to this DID document: did:web:host#key-1 -> did:web:host
  if (typeof docId !== 'string' || hash <= 0 || vmId.slice(0, hash) !== docId) return { ok: false, reason: 'unknown-verification-method' };

  const listed = Array.isArray(did.verificationMethod) ? did.verificationMethod : [];
  const assertion: unknown[] = Array.isArray(did.assertionMethod) ? did.assertionMethod : [];
  const embedded = assertion.filter(isRecord) as unknown as NonNullable<DidDocument['verificationMethod']>;
  const vm = [...listed, ...embedded].find((m) => isRecord(m) && typeof m.id === 'string' && absolute(m.id) === vmId);
  if (!vm) return { ok: false, reason: 'unknown-verification-method' };

  const authorised = assertion.some((ref) => (typeof ref === 'string' ? absolute(ref) : isRecord(ref) && typeof ref.id === 'string' ? absolute(ref.id) : null) === vmId);
  if (!authorised) return { ok: false, reason: 'not-assertion-method' };
  if (vm.controller !== undefined && vm.controller !== docId) return { ok: false, reason: 'controller-mismatch' };

  const issuerId = typeof issuer === 'string' ? issuer : isRecord(issuer) ? issuer.id : undefined;
  if (issuerId !== docId) return { ok: false, reason: 'issuer-mismatch' };

  try {
    return { ok: true, keyId: vmId, publicKey: ed25519KeyFromMultikey(vm.publicKeyMultibase) };
  } catch {
    return { ok: false, reason: 'bad-key' };
  }
}

/* ------------------------------------------------------------------ the check */
/** Finds the key a proof names (vc.py's `resolve_key`), given the credential so it can bind the issuer. */
type KeyResolver = (verificationMethod: string, credential: Record<string, unknown>) => KeyLookup;

/**
 * The full check against the issuer's DID document, reporting each step as it completes (see `ProofStep`).
 * `verifyInBrowser` is this without the steps. It never throws and never changes its inputs.
 */
export async function checkProof(credential: unknown, did: unknown, opts: CheckOptions = {}): Promise<LocalCheck> {
  if (!subtleCrypto() || !(await ed25519Supported())) return fail('unsupported');
  if (!isRecord(did)) return fail('no-did-document');
  return run(credential, (vm, c) => lookUpKey(did as unknown as DidDocument, vm, c.issuer), opts);
}

/**
 * The Data Integrity check against an Ed25519 multikey the caller already trusts: no DID document and no issuer binding.
 * For test vectors (W3C vc-di-eddsa B.3 uses a did:key and a non-DID issuer). The app uses `verifyInBrowser`.
 */
export async function verifyWithKey(credential: unknown, publicKeyMultibase: string, opts: CheckOptions = {}): Promise<LocalCheck> {
  if (!subtleCrypto() || !(await ed25519Supported())) return fail('unsupported');
  return run(
    credential,
    (vm) => {
      try {
        return { ok: true, keyId: vm, publicKey: ed25519KeyFromMultikey(publicKeyMultibase) };
      } catch {
        return { ok: false, reason: 'bad-key' };
      }
    },
    opts,
  );
}

async function run(credential: unknown, resolveKey: KeyResolver, opts: CheckOptions): Promise<LocalCheck> {
  const subtle = subtleCrypto();
  if (!subtle) return fail('unsupported');
  if (!isRecord(credential)) return fail('no-proof');

  // 1. the proof itself (vc.py: dict, type, cryptosuite, proofPurpose, then proofValue and created)
  const proof = credential.proof;
  if (!isRecord(proof)) return fail('no-proof');
  if (proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== SUITE) return fail('wrong-suite');
  if (proof.proofPurpose !== 'assertionMethod') return fail('wrong-purpose');
  const proofValue = proof.proofValue;
  if (typeof proofValue !== 'string' || !proofValue.startsWith('z')) return fail('bad-proof-value');
  if (typeof proof.created !== 'string' || !XSD_DATETIME.test(proof.created)) return fail('bad-created');

  // 2. what was signed: the credential without its proof, the proof without its value
  const unsecured: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(credential)) if (k !== 'proof') unsecured[k] = v;
  const proofOptions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(proof)) if (k !== 'proofValue') proofOptions[k] = v;

  // 3. the proof's @context must lead the credential's; then the credential is hashed under the proof's @context
  if ('@context' in proofOptions) {
    const ctx = Array.isArray(proofOptions['@context']) ? (proofOptions['@context'] as unknown[]) : [proofOptions['@context']];
    const docCtx = Array.isArray(unsecured['@context']) ? (unsecured['@context'] as unknown[]) : [unsecured['@context']];
    let same: boolean;
    try {
      same = docCtx.length >= ctx.length && ctx.every((c, i) => canonicalize(c) === canonicalize(docCtx[i]));
    } catch {
      same = false;
    }
    if (!same) return fail('context-mismatch');
    unsecured['@context'] = proofOptions['@context'];
  }

  // the key named by the proof, from the DID document
  const vmId = proof.verificationMethod;
  if (typeof vmId !== 'string' || vmId === '') return fail('missing-verification-method');
  const key = resolveKey(vmId, credential);
  if (!key.ok) return fail(key.reason);
  opts.onStep?.({ step: 'key', keyId: key.keyId, publicKeyHex: toHex(key.publicKey) });

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = multibaseDecode(proofValue);
  } catch {
    return fail('bad-proof-value');
  }
  if (signature.length !== 64) return fail('bad-proof-value');

  // 4. canonicalise (RFC 8785) and hash: SHA-256(proof options) then SHA-256(credential)
  let proofBytes: Uint8Array<ArrayBuffer>;
  let documentBytes: Uint8Array<ArrayBuffer>;
  try {
    proofBytes = canonicalBytes(proofOptions);
    documentBytes = canonicalBytes(unsecured);
  } catch {
    // a JcsError (not I-JSON), or a cyclic / absurdly deep object: neither is canonical JSON
    return fail('not-canonicalizable');
  }
  const decoder = new TextDecoder();
  opts.onStep?.({ step: 'canonical', proofConfig: decoder.decode(proofBytes), document: decoder.decode(documentBytes), proofBytes: proofBytes.length, documentBytes: documentBytes.length });

  let proofHash: Uint8Array;
  let documentHash: Uint8Array;
  try {
    proofHash = new Uint8Array(await subtle.digest('SHA-256', proofBytes));
    documentHash = new Uint8Array(await subtle.digest('SHA-256', documentBytes));
  } catch {
    return fail('unsupported');
  }
  opts.onStep?.({ step: 'hash', proofHash: toHex(proofHash), documentHash: toHex(documentHash) });
  const hashData = new Uint8Array(64);
  hashData.set(proofHash, 0);
  hashData.set(documentHash, 32);

  // 5. Ed25519
  let publicKey: CryptoKey;
  try {
    publicKey = await subtle.importKey('raw', key.publicKey, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return fail('bad-key');
  }
  let valid = false;
  try {
    valid = await subtle.verify({ name: 'Ed25519' }, publicKey, signature, hashData);
  } catch {
    valid = false;
  }
  opts.onStep?.({ step: 'signature', valid });
  return valid ? { ok: true, suite: SUITE, keyId: key.keyId } : fail('signature-mismatch');
}

/** Verify a credential's eddsa-jcs-2022 proof in this browser against the issuer's DID document. Never throws. */
export async function verifyInBrowser(credential: Credential, did: DidDocument): Promise<LocalCheck> {
  try {
    return await checkProof(credential, did);
  } catch {
    // only a WebCrypto failure can land here (digest on a broken implementation): we could not run the check
    return fail('unsupported');
  }
}
