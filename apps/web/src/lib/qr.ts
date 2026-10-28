import { encode } from 'uqr';

/**
 * QR as one compact SVG path (crisp at any size, prints well). Modules are always dark on a light plate
 * with a 4-module quiet zone, in both themes: a QR must keep its contrast to be scannable.
 */
export interface QrPath {
  size: number;
  d: string;
}

export function qrPath(text: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'M'): QrPath {
  const { data, size } = encode(text, { ecc, border: 0 });
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y]![x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && data[y]![x]) x++;
      d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  }
  return { size, d };
}

/** Public base used for QR targets. Set VITE_PUBLIC_BASE_URL when the app is hosted so printed QRs open on any phone. */
export function publicBase(): string {
  const env = import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined;
  return (env && env.trim() ? env : window.location.origin).replace(/\/$/, '');
}

/** Short on purpose (a smaller QR scans better): the bare UUID; the verifier adds `urn:uuid:` back. */
export const verifyUrl = (credentialId: string) => `${publicBase()}/verify/${encodeURIComponent(credentialId.replace(/^urn:uuid:/, ''))}`;
