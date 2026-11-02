import { afterEach, describe, expect, it, vi } from 'vitest';
import before from '../../data/recorded/verify-before.json';
import didJson from '../../data/recorded/did.json';
import type { Credential, DidDocument, VerifyResponse } from '../api/types';
import { canonicalBytes } from './jcs';
import { base58btcEncode } from './multibase';
import { checkProof, LOCAL_CHECK_REASONS, toHex, verifyInBrowser, verifyWithKey, type ProofStep } from './verify';

const did = didJson as unknown as DidDocument;
const KEY_ID = 'did:web:127.0.0.1%3A5173#key-1';
const recorded: Credential[] = Object.values(before as unknown as Record<string, VerifyResponse>).map((v) => v.credential as Credential);
const first = recorded[0];
const copy = <T,>(v: T): T => structuredClone(v);

type Loose = Record<string, unknown> & { proof: Record<string, unknown>; credentialSubject: Record<string, unknown> };
const loose = (c: Credential) => copy(c) as unknown as Loose;
const asCred = (c: Loose) => c as unknown as Credential;

/** A fresh Ed25519 key pair and its DID document entry (the "different key"). */
async function newKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const multikey = 'z' + base58btcEncode(new Uint8Array([0xed, 0x01, ...raw]));
  return { pair, multikey };
}

/** Sign exactly as services/trust/vc.py sign() does (proof config keeps @context; hash = sha(proof) || sha(doc)). */
async function signLikeServer(doc: Record<string, unknown>, privateKey: CryptoKey, vm: string, order: 'proof-first' | 'doc-first' = 'proof-first') {
  const proofConfig = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-29T08:00:00Z', verificationMethod: vm, proofPurpose: 'assertionMethod', '@context': doc['@context'] };
  const p = new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalBytes(proofConfig)));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalBytes(doc)));
  const data = new Uint8Array(64);
  data.set(order === 'proof-first' ? p : d, 0);
  data.set(order === 'proof-first' ? d : p, 32);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data));
  return { ...doc, proof: { ...proofConfig, proofValue: 'z' + base58btcEncode(sig) } } as unknown as Credential;
}

describe('the 20 recorded receipts verify in the browser, as on the server', () => {
  it('there are 20 of them, all from the recorded issuer', () => {
    expect(recorded).toHaveLength(20);
    for (const c of recorded) expect(c.proof.verificationMethod).toBe(KEY_ID);
  });

  it.each(recorded.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    expect(await verifyInBrowser(c, did)).toEqual({ ok: true, suite: 'eddsa-jcs-2022', keyId: KEY_ID });
  });

  it('hashes exactly what the server hashes (vc.py _hash_data of the first receipt, proof hash first)', async () => {
    // produced by services/trust/vc.py _hash_data() over the same credential, with the server's own rfc8785
    const server = 'f107e8f99bbff49695da8767ee46991e47f0e44be4a11002c5b495d339c468a92ea489a5784e430ee07ce6abcfbcc0ae1deccd871672d94f44f53609ed78b7f3';
    expect(first.id).toBe('urn:uuid:84942e4a-2ce9-4497-92ca-11f478f9e259');
    const steps: ProofStep[] = [];
    await checkProof(first, did, { onStep: (s) => steps.push(s) });
    const hash = steps.find((s) => s.step === 'hash');
    expect(hash && hash.step === 'hash' ? hash.proofHash + hash.documentHash : '').toBe(server);
  });

  it('reports the steps in order: key, canonical, hash, signature', async () => {
    const steps: ProofStep[] = [];
    await checkProof(first, did, { onStep: (s) => steps.push(s) });
    expect(steps.map((s) => s.step)).toEqual(['key', 'canonical', 'hash', 'signature']);
    const canonical = steps[1];
    expect(canonical.step === 'canonical' && canonical.document.startsWith('{"@context":["https://www.w3.org/ns/credentials/v2"]')).toBe(true);
    expect(steps[3]).toEqual({ step: 'signature', valid: true });
  });

  it('does not depend on property order and does not change its input', async () => {
    const c = loose(first);
    const reordered = Object.fromEntries(Object.entries(c).reverse()) as Loose;
    reordered.proof = Object.fromEntries(Object.entries(c.proof).reverse());
    const snapshot = JSON.stringify(reordered);
    expect((await verifyInBrowser(asCred(reordered), did)).ok).toBe(true);
    expect(JSON.stringify(reordered)).toBe(snapshot);
  });
});

describe('tampering fails', () => {
  it('one character of the advice title', async () => {
    const c = loose(first);
    const advice = c.credentialSubject.advice as { title: { en: string } };
    const was = advice.title.en;
    advice.title.en = was.replace('No spray', 'No sprav');
    expect(advice.title.en).not.toBe(was);
    expect(advice.title.en).toHaveLength(was.length);
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('one character of the Bangla title', async () => {
    const c = loose(first);
    const advice = c.credentialSubject.advice as { title: { bn: string } };
    const was = advice.title.bn;
    advice.title.bn = was.replace('স্প্রে', 'স্প্রা');
    expect(advice.title.bn).not.toBe(was);
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('a number, a date, an added field', async () => {
    const a = loose(first);
    ((a.credentialSubject.rule_refs as { version: number }[])[0]).version = 2;
    expect((await verifyInBrowser(asCred(a), did)).ok).toBe(false);
    const b = loose(first);
    b.validUntil = '2027-11-04T23:59:59Z';
    expect((await verifyInBrowser(asCred(b), did)).ok).toBe(false);
    const c = loose(first);
    c.extra = true;
    expect((await verifyInBrowser(asCred(c), did)).ok).toBe(false);
  });

  it('the signed proof options (created is part of what was signed)', async () => {
    const c = loose(first);
    c.proof.created = '2026-10-28T17:27:50Z';
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('a signature copied from another receipt', async () => {
    const c = loose(first);
    c.proof.proofValue = recorded[1].proof.proofValue;
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'signature-mismatch' });
  });
});

describe('the key', () => {
  it('a different key fails', async () => {
    const { multikey } = await newKey();
    const other = copy(did);
    other.verificationMethod![0].publicKeyMultibase = multikey;
    expect(await verifyInBrowser(first, other)).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('a missing verification method fails with a clear reason', async () => {
    const c = loose(first);
    delete c.proof.verificationMethod;
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'missing-verification-method' });
  });

  it('an unknown verification method fails with a clear reason', async () => {
    const c = loose(first);
    c.proof.verificationMethod = 'did:web:127.0.0.1%3A5173#key-2';
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'unknown-verification-method' });
    const d = loose(first);
    d.proof.verificationMethod = 'did:web:example.org#key-1';
    expect(await verifyInBrowser(asCred(d), did)).toEqual({ ok: false, reason: 'unknown-verification-method' });
    const noKeys = { ...copy(did), verificationMethod: [] };
    expect(await verifyInBrowser(first, noKeys)).toEqual({ ok: false, reason: 'unknown-verification-method' });
  });

  it('a key the DID does not authorise for assertions fails', async () => {
    expect(await verifyInBrowser(first, { ...copy(did), assertionMethod: [] })).toEqual({ ok: false, reason: 'not-assertion-method' });
  });

  it('a credential whose issuer is not the DID fails', async () => {
    const c = loose(first);
    c.issuer = 'did:web:example.org';
    expect(await verifyInBrowser(asCred(c), did)).toEqual({ ok: false, reason: 'issuer-mismatch' });
  });

  it('a key that is not an Ed25519 multikey fails', async () => {
    const bad = copy(did);
    bad.verificationMethod![0].publicKeyMultibase = 'z' + base58btcEncode(new Uint8Array([0x12, 0x00, ...new Uint8Array(32)]));
    expect(await verifyInBrowser(first, bad)).toEqual({ ok: false, reason: 'bad-key' });
  });

  it('accepts relative ids in the DID document', async () => {
    const rel = copy(did);
    rel.verificationMethod![0].id = '#key-1';
    rel.assertionMethod = ['#key-1'];
    expect(await verifyInBrowser(first, rel)).toEqual({ ok: true, suite: 'eddsa-jcs-2022', keyId: KEY_ID });
  });
});

describe('the proof', () => {
  const variant = async (change: (c: Loose) => void) => {
    const c = loose(first);
    change(c);
    return verifyInBrowser(asCred(c), did);
  };

  it('must be one eddsa-jcs-2022 DataIntegrityProof for assertionMethod', async () => {
    expect(await variant((c) => delete (c as Partial<Loose>).proof)).toEqual({ ok: false, reason: 'no-proof' });
    expect(await variant((c) => ((c as Record<string, unknown>).proof = [c.proof]))).toEqual({ ok: false, reason: 'no-proof' });
    expect(await variant((c) => (c.proof.cryptosuite = 'eddsa-rdfc-2022'))).toEqual({ ok: false, reason: 'wrong-suite' });
    expect(await variant((c) => (c.proof.type = 'Ed25519Signature2020'))).toEqual({ ok: false, reason: 'wrong-suite' });
    expect(await variant((c) => (c.proof.proofPurpose = 'authentication'))).toEqual({ ok: false, reason: 'wrong-purpose' });
  });

  it('needs a base58btc 64-byte proofValue and an XML Schema created', async () => {
    expect(await variant((c) => (c.proof.proofValue = 'u' + String(c.proof.proofValue).slice(1)))).toEqual({ ok: false, reason: 'bad-proof-value' });
    expect(await variant((c) => (c.proof.proofValue = String(c.proof.proofValue).slice(0, -1) + '0'))).toEqual({ ok: false, reason: 'bad-proof-value' });
    expect(await variant((c) => (c.proof.proofValue = 'z' + base58btcEncode(new Uint8Array(63).fill(7))))).toEqual({ ok: false, reason: 'bad-proof-value' });
    expect(await variant((c) => (c.proof.created = '28 Oct 2026'))).toEqual({ ok: false, reason: 'bad-created' });
    expect(await variant((c) => (c.proof.created = ['2026-10-28T17:27:49Z']))).toEqual({ ok: false, reason: 'bad-created' });
  });

  it("needs the credential's @context to start with the proof's", async () => {
    expect(await variant((c) => (c['@context'] = ['https://example.org/other']))).toEqual({ ok: false, reason: 'context-mismatch' });
    expect(await variant((c) => delete c['@context'])).toEqual({ ok: false, reason: 'context-mismatch' });
  });

  it('fails cleanly on garbage', async () => {
    expect(await verifyInBrowser(null as unknown as Credential, did)).toEqual({ ok: false, reason: 'no-proof' });
    expect(await verifyInBrowser(first, null as unknown as DidDocument)).toEqual({ ok: false, reason: 'no-did-document' });
  });

  it('every reason it gives is a documented one', () => {
    expect(new Set(LOCAL_CHECK_REASONS).size).toBe(LOCAL_CHECK_REASONS.length);
  });
});

describe('a credential signed like the server, with a fresh key', () => {
  const doc = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    type: ['VerifiableCredential', 'AdviceReceiptCredential'],
    issuer: 'did:web:test.example',
    validFrom: '2026-10-29T08:00:00Z',
    credentialSubject: { claim: 'test', n: [0.85, 1e-7, 30, -0], text: 'বাংলা "quoted" \n 🌾' },
  };
  const didFor = (multikey: string): DidDocument => ({
    id: 'did:web:test.example',
    verificationMethod: [{ id: 'did:web:test.example#key-1', type: 'Multikey', controller: 'did:web:test.example', publicKeyMultibase: multikey }],
    assertionMethod: ['did:web:test.example#key-1'],
  });

  it('verifies, and the hash order matters (proof hash first)', async () => {
    const { pair, multikey } = await newKey();
    const signed = await signLikeServer(doc, pair.privateKey, 'did:web:test.example#key-1');
    expect(await verifyInBrowser(signed, didFor(multikey))).toEqual({ ok: true, suite: 'eddsa-jcs-2022', keyId: 'did:web:test.example#key-1' });
    const swapped = await signLikeServer(doc, pair.privateKey, 'did:web:test.example#key-1', 'doc-first');
    expect(await verifyInBrowser(swapped, didFor(multikey))).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('gives the public key it used', async () => {
    const { pair, multikey } = await newKey();
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const steps: ProofStep[] = [];
    await checkProof(await signLikeServer(doc, pair.privateKey, 'did:web:test.example#key-1'), didFor(multikey), { onStep: (s) => steps.push(s) });
    expect(steps[0]).toEqual({ step: 'key', keyId: 'did:web:test.example#key-1', publicKeyHex: toHex(raw) });
  });
});

describe('W3C vc-di-eddsa test vector B.3 (eddsa-jcs-2022), the same one tests/test_vc.py checks on the server', () => {
  const TV_PUB = 'z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2';
  const signed = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    id: 'urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33',
    type: ['VerifiableCredential', 'AlumniCredential'],
    name: 'Alumni Credential',
    description: 'A minimum viable example of an Alumni Credential.',
    issuer: 'https://vc.example/issuers/5678',
    validFrom: '2023-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:abcdefgh', alumniOf: 'The School of Examples' },
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: '2023-02-24T23:36:38Z',
      verificationMethod: `did:key:${TV_PUB}#${TV_PUB}`,
      proofPurpose: 'assertionMethod',
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
      proofValue: 'z2HnFSSPPBzR36zdDgK8PbEHeXbR56YF24jwMpt3R1eHXQzJDMWS93FCzpvJpwTWd3GAVFuUfjoJdcnTMuVor51aX',
    },
  };

  it('verifies', async () => {
    expect(await verifyWithKey(signed, TV_PUB)).toEqual({ ok: true, suite: 'eddsa-jcs-2022', keyId: `did:key:${TV_PUB}#${TV_PUB}` });
  });

  it('fails when altered, or when the document context no longer starts with the proof context', async () => {
    expect(await verifyWithKey({ ...signed, name: 'Alumni CredentiaI' }, TV_PUB)).toEqual({ ok: false, reason: 'signature-mismatch' });
    expect(await verifyWithKey({ ...signed, '@context': ['https://www.w3.org/ns/credentials/v2'] }, TV_PUB)).toEqual({ ok: false, reason: 'context-mismatch' });
    expect(await verifyWithKey({ ...signed, proof: { ...signed.proof, proofValue: 'Q' + signed.proof.proofValue.slice(1) } }, TV_PUB)).toEqual({ ok: false, reason: 'bad-proof-value' });
  });
});

describe('a browser without Ed25519', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('says "unsupported" instead of guessing', async () => {
    vi.stubGlobal('crypto', { subtle: undefined, getRandomValues: crypto.getRandomValues.bind(crypto) });
    vi.resetModules();
    const fresh = await import('./verify');
    expect(await fresh.ed25519Supported()).toBe(false);
    expect(await fresh.verifyInBrowser(first, did)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('says "unsupported" when importKey refuses Ed25519', async () => {
    const real = crypto.subtle;
    const subtle = {
      digest: real.digest.bind(real),
      verify: real.verify.bind(real),
      importKey: () => Promise.reject(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError')),
    };
    vi.stubGlobal('crypto', { subtle });
    vi.resetModules();
    const fresh = await import('./verify');
    expect(await fresh.verifyInBrowser(first, did)).toEqual({ ok: false, reason: 'unsupported' });
  });
});
