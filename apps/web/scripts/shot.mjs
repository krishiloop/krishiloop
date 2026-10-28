// Dev helper: take a screenshot of one URL so the UI can be looked at while iterating.
//   node scripts/shot.mjs "/app?sample=1&mode=lite" out.png --w 390 --h 844 --full --wait 1200 --click "text=Sample"
// Flags: --w --h --dsf --full --wait <ms> --scroll <px> --click <selector> (repeatable) --reduced --dark|--light --base <url> --logs
//        --slices <n>  take n consecutive viewport-sized screenshots (out-1.png, out-2.png ...) for long pages
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const [path, out] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const all = (name) => args.reduce((acc, a, i) => (a === `--${name}` ? [...acc, args[i + 1]] : acc), []);

const base = flag('base', 'http://127.0.0.1:5173');
const w = Number(flag('w', 1440));
const h = Number(flag('h', 900));
const dsf = Number(flag('dsf', 1));
const wait = Number(flag('wait', 1200));
const scroll = Number(flag('scroll', 0));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: dsf,
  reducedMotion: has('reduced') ? 'reduce' : 'no-preference',
  colorScheme: has('light') ? 'light' : 'dark',
  hasTouch: w < 700,
  isMobile: w < 700,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
await page.goto(base + path, { waitUntil: 'load' });
await page.waitForTimeout(wait);
for (const sel of all('click')) {
  await page.locator(sel).first().click({ timeout: 5000 });
  await page.waitForTimeout(Number(flag('after', 500)));
}
if (scroll) {
  await page.evaluate((y) => window.scrollTo(0, y), scroll);
  await page.waitForTimeout(900);
}
const to = flag('to', '');
if (to) {
  await page.locator(to).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate((o) => window.scrollBy(0, -o), Number(flag('offset', 70)));
  await page.waitForTimeout(1600);
}
const slices = Number(flag('slices', 0));
if (slices) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('page height', total);
  for (let i = 0; i < slices; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(i * h * 0.92));
    await page.waitForTimeout(700);
    await page.screenshot({ path: out.replace(/\.png$/, `-${i + 1}.png`) });
  }
} else {
  await page.screenshot({ path: out, fullPage: has('full') });
}
if (has('logs') || logs.length) console.log(logs.join('\n') || '(no console errors)');
await browser.close();
console.log('saved', out);
