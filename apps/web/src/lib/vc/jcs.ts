/**
 * JSON Canonicalization Scheme (RFC 8785), exactly as the server's `rfc8785` package (services/trust/vc.py) produces it.
 *
 *  - Object keys sort by their UTF-16 code units. That is JavaScript's default string sort, so `keys().sort()` is right
 *    (an emoji key, a surrogate pair, sorts before U+FB33).
 *  - Numbers use ECMAScript's Number::toString, which `JSON.stringify` implements (-0 prints as 0). NaN and Infinity are
 *    not JSON and are refused.
 *  - Strings escape `"`, `\` and U+0000–U+001F (\b \t \n \f \r short forms, the rest as \u00xx), and nothing else:
 *    `JSON.stringify` again. A lone surrogate is refused (the server cannot encode it either, so it never signed one).
 *  - No whitespace. The caller encodes the result as UTF-8.
 *
 * Values that JSON cannot carry (undefined in an array, functions, symbols, bigints, class instances) are refused.
 * An object property whose value is `undefined` is left out, as it would be on the wire.
 */

export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JcsError';
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function quote(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new JcsError('a string holds a lone surrogate (not I-JSON)');
  return JSON.stringify(s);
}

function isPlainObject(v: object): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function write(v: unknown, out: string[]): void {
  if (v === null) {
    out.push('null');
    return;
  }
  switch (typeof v) {
    case 'boolean':
      out.push(v ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(v)) throw new JcsError('NaN and Infinity are not JSON');
      out.push(JSON.stringify(v));
      return;
    case 'string':
      out.push(quote(v));
      return;
    case 'object': {
      if (Array.isArray(v)) {
        out.push('[');
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out.push(',');
          const item: unknown = v[i];
          if (item === undefined) throw new JcsError('an array holds undefined');
          write(item, out);
        }
        out.push(']');
        return;
      }
      if (!isPlainObject(v)) throw new JcsError('only plain objects are JSON');
      const keys = Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort();
      out.push('{');
      keys.forEach((k, i) => {
        if (i > 0) out.push(',');
        out.push(quote(k), ':');
        write(v[k], out);
      });
      out.push('}');
      return;
    }
    default:
      throw new JcsError(`a ${typeof v} is not JSON`);
  }
}

/** The RFC 8785 canonical form of a JSON value, as a string (encode it as UTF-8 before hashing). Throws `JcsError`. */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join('');
}

const encoder = new TextEncoder();

/** The canonical form as UTF-8 bytes: what eddsa-jcs-2022 hashes. */
export function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(canonicalize(value));
  // a fresh ArrayBuffer-backed copy, so WebCrypto's BufferSource type accepts it everywhere
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
