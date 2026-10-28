// node axe_nodes.mjs <url> [width] â€” print the serious/critical axe violations with their node targets
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const [url, width = '390'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 844 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
  console.log(v.id, v.impact, v.help);
  for (const n of v.nodes) console.log('   ', n.target.join(' '), '|', n.failureSummary?.split('\n').slice(0, 2).join(' / '), '|', n.html.slice(0, 160));
}
await browser.close();
