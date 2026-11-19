import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * "Nearest agriculture office": the card on a hand-off ("not sure"), the sheet with the map and the nearest offices,
 * geolocation (mocked), the Go there and Call links, both themes under axe, and 360 px without sideways scroll.
 * Recorded mode (`?sample=1`) so no backend is needed; map tiles are answered locally so no test calls openstreetmap.org.
 * Run on its own port: E2E_PORT=5301 npx playwright test offices.spec.ts
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const APP = '/app?sample=1&lang=en&tab=ask';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type O = { id: string; lat: number; lon: number; phone: string | null; officer: { mobile: string | null } | null };
const data = JSON.parse(readFileSync(new URL('../../src/data/offices/bd.json', import.meta.url), 'utf8')) as { offices: O[] };
const km = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180;
  const h = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};
const expected = (lat: number, lon: number, n = 5) =>
  data.offices
    .map((o, i) => ({ o, k: km(lat, lon, o.lat, o.lon), i }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .slice(0, n)
    .map((x) => x.o);

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
}
async function settle(page: Page) {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]));
}
async function axe(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
});

/** Ask a question the recorded answers send to the officer: the hand-off shows the card. */
async function handOff(page: Page) {
  await page.getByTestId('fa-ask-input').fill('Can I get a loan to buy fertiliser?');
  await page.getByTestId('fa-ask-send').click();
  await expect(page.getByTestId('fa-ask-abstained')).toBeVisible();
}

test('the card appears when the question goes to the officer, and opens the nearest list for the sample farm', async ({ page }) => {
  await page.goto(APP);
  await handOff(page);
  const card = page.getByTestId('near-card');
  await expect(card).toContainText('Not sure? Talk to your nearest agriculture office');
  await card.getByTestId('near-open').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest agriculture office' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('near-from')).toHaveAttribute('data-kind', 'sample');
  await expect(sheet.getByTestId('near-from')).toContainText('sample farm');
  // the Krishi Call Centre is always there (fact register D5)
  await expect(sheet.getByTestId('near-callcentre')).toContainText('16123');
  await expect(sheet.getByTestId('near-cc-call')).toHaveAttribute('href', 'tel:16123');
  // sorted by distance, nearest first, the same as our own haversine over the data
  const want = expected(24.75, 90.4);
  const items = sheet.getByTestId('near-office');
  await expect(items).toHaveCount(5);
  expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual(want.map((o) => o.id));
  const kms = (await sheet.getByTestId('near-km').allTextContents()).map((s) => parseFloat(s));
  expect([...kms].sort((a, b) => a - b)).toEqual(kms);
  // Go there: Google Maps directions to the office point
  const first = want[0]!;
  await expect(items.first().getByTestId('near-go')).toHaveAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${first.lat},${first.lon}`);
  await expect(items.first().getByRole('link', { name: 'Open in OpenStreetMap' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=/);
  await expect(items.first()).toContainText('Approximate place');
  // the map loads lazily and carries the OpenStreetMap credit
  await expect(sheet.getByTestId('near-leaflet')).toBeVisible();
  await expect(sheet.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await expect(sheet.locator('.leaflet-marker-icon')).toHaveCount(4);
});

test('a phone number is a tel: link, and an officer is shown only with his or her source', async ({ page }) => {
  await page.goto(APP);
  await handOff(page);
  await page.getByTestId('near-open').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest agriculture office' });
  const withPhone = expected(24.75, 90.4).findIndex((o) => o.phone);
  expect(withPhone, 'one of the five nearest has a published phone').toBeGreaterThanOrEqual(0);
  const phone = expected(24.75, 90.4)[withPhone]!.phone!;
  await expect(sheet.getByTestId('near-office').nth(withPhone).getByTestId('near-call')).toHaveAttribute('href', `tel:${phone}`);
  // every office that shows an officer also shows the source line with the portal host
  for (const o of await sheet.getByTestId('near-office').all()) {
    if (await o.getByTestId('near-officer').count()) await expect(o).toContainText('gov.bd');
  }
});

test('geolocation: with permission the list is sorted from the farmer, not the sample farm', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 23.8103, longitude: 90.4125 }); // Dhaka
  await page.goto(APP);
  await handOff(page);
  await page.getByTestId('near-open').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest agriculture office' });
  await expect(sheet.getByTestId('near-locate')).toBeVisible();
  await sheet.getByTestId('near-locate').click();
  await expect(sheet.getByTestId('near-from')).toHaveAttribute('data-kind', 'you');
  const want = expected(23.8103, 90.4125);
  await expect
    .poll(async () => sheet.getByTestId('near-office').evaluateAll((els) => els.map((e) => e.getAttribute('data-id'))))
    .toEqual(want.map((o) => o.id));
});

test('geolocation refused: says so and keeps the sample farm', async ({ page, context }) => {
  await context.clearPermissions();
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  });
  await page.goto(APP);
  await handOff(page);
  await page.getByTestId('near-open').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest agriculture office' });
  await sheet.getByTestId('near-locate').click();
  await expect(sheet.getByTestId('near-denied')).toContainText('sample farm');
  await expect(sheet.getByTestId('near-from')).toHaveAttribute('data-kind', 'sample');
});

test('the entry is in the farmer app and in the phone app Help tab', async ({ page }) => {
  await page.goto(APP);
  await page.getByTestId('near-entry').click();
  await expect(page.getByRole('dialog', { name: 'Nearest agriculture office' })).toBeVisible();
  await page.goto('/m?sample=1&lang=en&welcome=0');
  await page.getByTestId('m-tab-help').click();
  await page.getByTestId('near-entry').click();
  await expect(page.getByRole('dialog', { name: 'Nearest agriculture office' })).toBeVisible();
});

test('Bangla: the card and the sheet read in Bangla with the machine-written note', async ({ page }) => {
  await page.goto('/app?sample=1&lang=bn&tab=ask');
  await page.getByTestId('near-entry').click();
  const sheet = page.getByRole('dialog', { name: 'কাছের কৃষি অফিস' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('near-callcentre')).toContainText('কৃষি কল সেন্টার');
  await expect(sheet.getByTestId('near-go').first()).toContainText('সেখানে যান');
  await expect(sheet).toContainText('মেশিনে লেখা');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: the card and the open sheet`, async ({ page }) => {
    await page.goto(`${APP}&theme=${theme}`);
    await handOff(page);
    await axe(page, `${theme} card`);
    await page.getByTestId('near-open').click();
    await expect(page.getByTestId('near-office')).toHaveCount(5);
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
    await axe(page, `${theme} sheet`);
  });
}

test('360 px: no sideways scroll, and every button and link is at least 48 px tall', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(APP);
  await handOff(page);
  await noOverflow(page);
  await page.getByTestId('near-open').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest agriculture office' });
  await expect(sheet.getByTestId('near-office')).toHaveCount(5);
  await noOverflow(page);
  const sw = await sheet.evaluate((e) => (e.querySelector('.near-body') as HTMLElement).scrollWidth - (e.querySelector('.near-body') as HTMLElement).clientWidth);
  expect(sw, 'the sheet body does not scroll sideways').toBeLessThanOrEqual(1);
  for (const id of ['near-go', 'near-call', 'near-cc-call', 'near-locate']) {
    for (const el of await sheet.getByTestId(id).all()) {
      const box = await el.boundingBox();
      expect(box!.height, `${id} is at least 48 px tall`).toBeGreaterThanOrEqual(47.5);
    }
  }
  // keyboard: Tab reaches the Go there link and Escape closes the sheet
  await sheet.getByTestId('near-go').first().focus();
  await expect(sheet.getByTestId('near-go').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
