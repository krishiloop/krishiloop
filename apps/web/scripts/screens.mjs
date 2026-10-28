// Screenshots of every experience at 390x844 (phone) and 1440x900 (desktop) into docs/design/screens/.
//   npm run dev   (another terminal)   then   node scripts/screens.mjs [--base http://127.0.0.1:5173] [--only landing,farmer,verify,officer]
// Everything runs on sample data (?sample=1): nothing is minted on the live API.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const base = flag('base', 'http://127.0.0.1:5173');
const only = (flag('only', 'landing,farmer,verify,officer') || '').split(',');
const out = fileURLToPath(new URL('../../../docs/design/screens/', import.meta.url));
mkdirSync(out, { recursive: true });

const SAMPLE_ID = '534d504c-0000-4000-8000-000000000001';
const sizes = [
  { tag: '390', w: 390, h: 844, dsf: 2 },
  { tag: '1440', w: 1440, h: 900, dsf: 1 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
for (const { tag, w, h, dsf } of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: w < 700, isMobile: w < 700, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebGL|GPU|GL Driver/i.test(m.text())) logs.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => logs.push(String(e).slice(0, 200)));
  const snap = async (name, opts = {}) => {
    await page.screenshot({ path: `${out}${name}-${tag}.png`, ...opts });
    console.log('saved', `${name}-${tag}.png`);
  };
  const goto = async (path, wait = 1500) => {
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(wait);
  };

  if (only.includes('landing')) {
    await goto('/?sample=1', 2500);
    await snap('landing-hero');
    // scroll through slowly so every reveal fires, then shoot the sections
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += Math.round(h * 0.6)) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(250);
    }
    for (const id of ['problem', 'chapters', 'prove', 'world', 'status', 'start']) {
      await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'start' }), id);
      await page.waitForTimeout(1300);
      await snap(`landing-${id}`);
    }
    // the verify + recall beat, in the page
    await page.evaluate(() => document.getElementById('prove')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    await page.getByTestId('prove-verify').click();
    await page.waitForTimeout(3200);
    await snap('landing-prove-authentic');
    await page.getByTestId('prove-recall').click();
    await page.waitForTimeout(3600);
    await snap('landing-prove-recalled');
  }

  if (only.includes('verify')) {
    // the sample recall made above lives in sessionStorage, so this tab sees the receipt as Recalled
    await goto(`/verify/${SAMPLE_ID}`, 4500);
    await snap('verify-recalled');
    await page.evaluate(() => sessionStorage.clear());
    await goto(`/verify/${SAMPLE_ID}`, 4500);
    await snap('verify-authentic');
    await goto('/verify/not-a-real-receipt', 3500);
    await snap('verify-invalid');
    await goto('/verify', 1200);
    await snap('verify-entry');
  }

  if (only.includes('farmer')) {
    await goto('/app?sample=1', 2500);
    await snap('farmer-top');
    await snap('farmer-full', { fullPage: true });
    const card = page.locator('[data-testid=photo-card]');
    await card.scrollIntoViewIfNeeded();
    await page.getByTestId('photo-sample-leaf').click();
    await page.waitForSelector('[data-testid=photo-view-request]', { timeout: 10000 });
    await page.waitForTimeout(1500);
    await card.screenshot({ path: `${out}photo-ask-${tag}.png` });
    console.log('saved', `photo-ask-${tag}.png`);
    await page.getByTestId('photo-sample-view').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=photo-card]')?.getAttribute('data-verdict') === 'confident', null, { timeout: 10000 });
    await page.waitForTimeout(3000);
    await card.screenshot({ path: `${out}photo-answer-${tag}.png` });
    console.log('saved', `photo-answer-${tag}.png`);
    // light theme and Lite mode of the same screen
    await goto('/app?sample=1&theme=light', 2200);
    await snap('farmer-light');
    await goto('/app?sample=1&mode=lite', 2200);
    await snap('farmer-lite');
  }

  if (only.includes('officer')) {
    await goto('/officer?sample=1', 1800);
    await snap('officer-inbox');
  }
  console.log(tag, logs.length ? `console errors: ${[...new Set(logs)].join(' | ')}` : 'no console errors');
  await ctx.close();
}
await browser.close();
