// Renders the PWA icons from public/favicon.svg (needs Chrome via Playwright).  node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}public/favicon.svg`, 'utf-8');
mkdirSync(`${root}public/icons`, { recursive: true });

// the favicon already has its own rounded square; "maskable" needs the artwork inside the central 80% on a full-bleed square
const page = async (browser, size, body) => {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${body}`);
  return p;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const plain = (size) => `<div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`;
const maskable = (size) => {
  const inner = Math.round(size * 0.74);
  return `<div style="width:${size}px;height:${size}px;background:#0c110d;display:grid;place-items:center">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `).replace('rx="16"', 'rx="0"')}</div>`;
};
for (const [file, size, body] of [
  ['public/icons/icon-192.png', 192, plain(192)],
  ['public/icons/icon-512.png', 512, plain(512)],
  ['public/icons/maskable-512.png', 512, maskable(512)],
  ['public/apple-touch-icon.png', 180, maskable(180)],
]) {
  const p = await page(browser, size, body);
  await p.screenshot({ path: `${root}${file}`, omitBackground: true });
  await p.close();
  console.log('wrote', file);
}
await browser.close();
