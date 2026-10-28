// Dev helper: walk the photo check and save a frame at chosen moments (for judging motion).
//   node scripts/photo-flow.mjs <outDir> [--w 390] [--h 844] [--engine sample|real] [--scenario needs_view|confident|unsure] [--field KE-SAMPLE-01] [--light] [--reduced] [--lang en|bn]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args[0];
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
mkdirSync(out, { recursive: true });
const w = Number(flag('w', 390));
const h = Number(flag('h', 844));
const scenario = flag('scenario', 'needs_view');
const lang = flag('lang', 'en');
const field = flag('field', 'KE-SAMPLE-01');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: has('reduced') ? 'reduce' : 'no-preference', colorScheme: has('light') ? 'light' : 'dark', hasTouch: w < 700, isMobile: w < 700 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
await page.addInitScript((f) => { try { localStorage.setItem('kl.farmer.sel', JSON.stringify({ fieldId: f, profileId: 'demo-farmer-a' })); } catch {} }, field);
await page.goto(`http://127.0.0.1:5173/app?sample=1&lang=${lang}${has('light') ? '&theme=light' : ''}`, { waitUntil: 'load' });
await page.waitForSelector('[data-testid=photo-card]', { timeout: 15000 });
const card = page.locator('[data-testid=photo-card]');
await card.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
const shot = async (name, el = card) => { await el.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };
await shot('01-start');
if (flag('engine', 'sample') === 'real') await page.getByTestId('photo-engine-real').click();
else if (await page.getByTestId('photo-engine-sample').count()) await page.getByTestId('photo-engine-sample').click();
await page.getByTestId(`photo-scenario-${scenario}`).click();
await page.getByTestId('photo-sample-leaf').click();
await page.waitForTimeout(250);
await shot('02-reading');
await page.waitForSelector('[data-testid=photo-outcome]', { timeout: 10000 });
await page.waitForTimeout(1600);
await shot('03-result-1');
const more = page.getByTestId('photo-sample-view');
if (await more.count()) {
  await shot('04-request');
  await more.click();
  for (const [i, t] of [150, 350, 600, 900, 1400, 2200, 3400].entries()) {
    await page.waitForTimeout(i === 0 ? t : t - [150, 350, 600, 900, 1400, 2200, 3400][i - 1]);
    await shot(`05-step2-t${String(t).padStart(4, '0')}`);
  }
}
if (has('cite')) {
  await page.getByTestId('symptom-water_soaked_tissue').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/06-citation.png` });
  console.log('saved 06-citation');
}
console.log(logs.length ? logs.join('\n') : '(no console errors)');
await browser.close();
