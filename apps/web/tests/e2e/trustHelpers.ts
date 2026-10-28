import { expect, type Page } from '@playwright/test';
import { PHOTO_FIELD, PHOTO_PROFILE, SID } from './trustMock';

/** Shared by the earned-trust flows (trust.spec.ts) and their screenshots (trust-screens.spec.ts). */
export const PHOTO_URL = `/app?field=${PHOTO_FIELD}&profile=${PHOTO_PROFILE}&mode=lite#photo`;
/** The same link with extra query (e.g. `&lang=bn`) placed BEFORE the hash, where it belongs. */
export const photoUrl = (extra = '') => `/app?field=${PHOTO_FIELD}&profile=${PHOTO_PROFILE}&mode=lite${extra}#photo`;

export const noOverflow = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
};
export const withSession = (page: Page) => page.addInitScript((sid) => sessionStorage.setItem('kl.demo.sid', sid), SID);

/** A 2400 x 1800 "phone photo" drawn in the page and encoded as a JPEG, so the client-side downscale is really exercised. */
export async function bigPhoto(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1800;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 2400, 1800);
    grad.addColorStop(0, '#6a9a3a');
    grad.addColorStop(1, '#2f5a1f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2400, 1800);
    g.fillStyle = '#6b4a2a';
    for (let i = 0; i < 80; i++) {
      g.beginPath();
      g.ellipse(200 + ((i * 379) % 2000), 150 + ((i * 211) % 1500), 26, 11, 0.6, 0, 7);
      g.fill();
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return { name: 'leaf.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/** Width and height from a JPEG's start-of-frame marker. */
export function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('not a JPEG');
    const marker = buf[i + 1]!;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no frame header');
}

/** Pick the big photo on the area card, switch sharing on or off, and send it. */
export async function sendPhoto(page: Page, share: boolean) {
  await page.getByTestId('area-photo-input').setInputFiles(await bigPhoto(page));
  await expect(page.getByTestId('area-composer')).toBeVisible();
  const consent = page.getByTestId('area-consent');
  await expect(consent, 'sharing is off until the farmer turns it on').not.toBeChecked();
  if (share) await consent.check();
  await page.getByTestId('area-send').click();
}

