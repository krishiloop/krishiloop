import { describe, expect, it } from 'vitest';
import fixture from './jcs.fixture.json';
import { canonicalBytes, canonicalize, JcsError } from './jcs';
import { base58btcDecode, base58btcEncode, ed25519KeyFromMultikey, multibaseDecode, MultibaseError } from './multibase';
import did from '../../data/recorded/did.json';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('JCS (RFC 8785) matches the server byte for byte', () => {
  it.each(fixture.cases.map((c, i) => [i, c.input, c.jcs_hex] as const))('case %i', (_i, input, expected) => {
    expect(hex(canonicalBytes(JSON.parse(input)))).toBe(expected);
  });

  it('sorts keys by UTF-16 code units, not by code point (RFC 8785 3.2.3)', () => {
    const keys = Object.keys(JSON.parse(canonicalize({ 'דּ': 1, '\u{1F600}': 2, '€': 3 })) as object);
    expect(keys).toEqual(['€', '\u{1F600}', 'דּ']);
  });

  it('ignores property order', () => {
    expect(canonicalize({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalize({ a: [{ x: 1, y: 2 }], b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('refuses what JSON cannot carry', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(JcsError);
    expect(() => canonicalize(Infinity)).toThrow(JcsError);
    expect(() => canonicalize('\ud800 lone')).toThrow(JcsError);
    expect(() => canonicalize([undefined])).toThrow(JcsError);
    expect(() => canonicalize(new Date(0))).toThrow(JcsError);
    expect(() => canonicalize(BigInt(1))).toThrow(JcsError);
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('multibase base58btc and Ed25519 multikeys', () => {
  it('round-trips, keeping leading zero bytes', () => {
    const bytes = new Uint8Array([0, 0, 1, 2, 255, 0, 58]);
    expect(base58btcEncode(bytes).startsWith('11')).toBe(true);
    expect(Array.from(base58btcDecode(base58btcEncode(bytes)))).toEqual(Array.from(bytes));
    expect(base58btcDecode('')).toHaveLength(0);
  });

  it('decodes the issuer key in did.json to 32 bytes behind the 0xed01 header', () => {
    const mb = did.verificationMethod[0].publicKeyMultibase;
    expect(multibaseDecode(mb).slice(0, 2)).toEqual(new Uint8Array([0xed, 0x01]));
    expect(ed25519KeyFromMultikey(mb)).toHaveLength(32);
  });

  it('is strict', () => {
    expect(() => multibaseDecode('f00')).toThrow(MultibaseError); // base16, not base58btc
    expect(() => base58btcDecode('0OIl')).toThrow(MultibaseError); // not in the alphabet
    expect(() => base58btcDecode('abc ')).toThrow(MultibaseError); // no trailing space
    expect(() => ed25519KeyFromMultikey('z' + base58btcEncode(new Uint8Array(34)))).toThrow(MultibaseError); // no ed01 header
    expect(() => ed25519KeyFromMultikey('z' + base58btcEncode(new Uint8Array([0xed, 0x01, 1, 2])))).toThrow(MultibaseError); // too short
  });
});
