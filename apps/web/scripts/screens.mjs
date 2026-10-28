// Screenshots of every page, phone and laptop, light and dark, for review and for the portal.
//   node scripts/screens.mjs [outDir] [--base http://127.0.0.1:5173] [--sample]
// --sample forces recorded mode (?sample=1), so the shots do not depend on a running API.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import recordedIds from '../src/data/recorded/ids.json' with { type: 'json' };

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'test-results/screens';
const base = flag('base', 'http://127.0.0.1:5173');
const sample = args.includes('--sample');
mkdirSync(out, { recursive: true });

const receipt = recordedIds[0].replace(/^urn:uuid:/, '');
const PAGES = [
  ['story', '/'],
  ['app', '/app?field=BD-SAMPLE-02&profile=demo-farmer-d'],
  ['officer', '/officer'],
  ['verify', `/verify/${receipt}`],
  ['trust', '/trust'],
  ['proof', '/proof'],
  ['about', '/about'],
];
const SIZES = [
  ['phone', 390, 844],
  ['laptop', 1440, 900],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const theme of ['light', 'dark']) {
  for (const [size, w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}theme=${theme}${sample ? '&sample=1' : ''}`;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(2600);
      const file = join(out, `${name}-${size}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log('wrote', file);
    }
    await ctx.close();
  }
}
await browser.close();
