// Dev helper: run the REAL on-device model through the photo check with local images and save frames.
//   node scripts/photo-real.mjs <outDir> <image1> [image2 image3] [--w 390] [--h 844] [--live] [--field BD-DEMO-01]
// Without --live the API is forced to sample mode (no credentials are minted); with --live the planner call goes to the real API.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args[0];
const images = args.slice(1).filter((a) => !a.startsWith('--') && /\.(jpe?g|png|webp)$/i.test(a));
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const has = (n) => args.includes(`--${n}`);
mkdirSync(out, { recursive: true });
const w = Number(flag('w', 390));
const h = Number(flag('h', 844));
const field = flag('field', 'BD-DEMO-01');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: has('light') ? 'light' : 'dark', hasTouch: w < 700, isMobile: w < 700 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
const posts = [];
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().includes('/api/plan')) posts.push(r.postData());
});
await page.addInitScript((f) => {
  try {
    localStorage.setItem('kl.farmer.sel', JSON.stringify({ fieldId: f, profileId: 'demo-farmer-a' }));
  } catch {
    /* private mode */
  }
}, field);
await page.goto(`http://127.0.0.1:5173/app${has('live') ? '' : '?sample=1'}`, { waitUntil: 'load' });
await page.waitForSelector('[data-testid=photo-card]', { timeout: 20000 });
const card = page.locator('[data-testid=photo-card]');
await card.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const shot = async (name) => {
  await card.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};
await shot('01-start');
if (await page.getByTestId('photo-engine-real').count()) await page.getByTestId('photo-engine-real').click();
if (await page.getByTestId('photo-download').count()) {
  await page.getByTestId('photo-download').click();
  await page.waitForSelector('[data-testid=photo-take]:not([disabled])', { timeout: 120000 });
  await shot('02-downloaded');
}
let n = 0;
for (const img of images) {
  n += 1;
  const t0 = Date.now();
  await page.getByTestId('photo-input').setInputFiles(img);
  await page.waitForSelector('[data-testid=photo-outcome]', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid=photo-analyzing]'), null, { timeout: 60000 });
  console.log(`photo ${n} read in ${Date.now() - t0} ms (wall clock, includes UI)`);
  await page.waitForTimeout(1800);
  console.log('  headline:', (await page.getByTestId('photo-outcome').innerText()).split(/\s*\n+\s*/).join(' | '));
  await shot(`03-photo-${n}`);
}
console.log('plan posts', posts.length, posts.map((p) => (p ? JSON.stringify(Object.keys(JSON.parse(p))) : '')).join(' '));
console.log(logs.length ? logs.join('\n') : '(no console errors)');
await browser.close();
