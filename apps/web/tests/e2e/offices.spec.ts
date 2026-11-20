import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * "Nearest Krishi officer": the card right where an answer is not sure (it asks for the place with one button, never
 * guesses; a district list when location is refused), the officer as the data has it, Call / Go there / Call 16123,
 * and the finder (map of every office, search in Bangla and English, list by distance, choosing an office flies the
 * map to it). Recorded mode (`?sample=1`) so no backend is needed; map tiles are answered locally.
 * Run on its own port: E2E_PORT=5291 npx playwright test offices.spec.ts
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const APP = '/app?sample=1&lang=en&tab=ask';
const M = '/m?sample=1&lang=en&welcome=0&tab=ask';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DHAKA = { latitude: 23.8103, longitude: 90.4125 };

type O = { id: string; lat: number; lon: number; district_en: string; phone: string | null; officer: { name_bn: string; mobile: string | null } | null };
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
async function denyLocation(page: Page) {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  });
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

test('not sure: the card asks for the place with one button, then names the nearest office and its officer', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(DHAKA);
  await page.goto(APP);
  await handOff(page);
  const card = page.getByTestId('near-card');
  await expect(card).toContainText('Nearest Krishi officer');
  await expect(card).toHaveAttribute('data-state', 'ask');
  await expect(card.getByRole('button')).toHaveCount(1); // one button, no guessed place
  await card.getByTestId('near-card-locate').click();
  const want = expected(DHAKA.latitude, DHAKA.longitude)[0]!;
  await expect(card.getByTestId('near-card-office')).toHaveAttribute('data-id', want.id);
  await expect(card.getByTestId('near-km')).toContainText('km away');
  if (want.officer) {
    await expect(card.getByTestId('near-officer')).toContainText(want.officer.name_bn);
    await expect(card).toContainText('As published on the DAE website');
  }
  const ring = want.officer?.mobile ?? want.phone;
  if (ring) await expect(card.getByTestId('near-card-call')).toHaveAttribute('href', `tel:${ring}`);
  else await expect(card.getByTestId('near-card-call')).toHaveCount(0);
  if (!want.officer?.mobile) await expect(card.getByTestId('near-card-helpline')).toHaveAttribute('href', 'tel:16123');
  else await expect(card.getByTestId('near-card-helpline')).toHaveCount(0);

  // Go there: the map, centred on that office, with Open directions to Google Maps in a new tab
  await card.getByTestId('near-card-go').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest Krishi officer' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('near-office')).toHaveAttribute('data-id', want.id);
  await expect(sheet.getByTestId('near-leaflet')).toHaveAttribute('data-selected', want.id);
  await expect(sheet.locator('.near-pin-on')).toHaveCount(1);
  await expect(sheet.locator('.near-pin-you')).toHaveCount(1);
  const dir = sheet.getByTestId('near-directions');
  await expect(dir).toHaveAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${want.lat},${want.lon}`);
  await expect(dir).toHaveAttribute('target', '_blank');
  await expect(sheet.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
});

test('location refused: the card offers a district list, then shows an office in that district without a distance', async ({ page }) => {
  await denyLocation(page);
  await page.goto(APP);
  await handOff(page);
  const card = page.getByTestId('near-card');
  await card.getByTestId('near-card-locate').click();
  await expect(card.getByTestId('near-card-denied')).toBeVisible();
  await card.getByTestId('near-card-district').selectOption('Mymensingh');
  const office = card.getByTestId('near-card-office');
  await expect(office).toHaveAttribute('data-id', /^bd-mymensingh-/);
  await expect(office).toContainText('In your district');
  await expect(office.getByTestId('near-km')).toHaveCount(0);
});

test('the finder: search in English and Bangla, choose an office, the map flies to it', async ({ page }) => {
  await page.goto(APP);
  await page.getByTestId('near-entry').first().click();
  const sheet = page.getByRole('dialog', { name: 'Nearest Krishi officer' });
  await expect(sheet.getByTestId('near-leaflet')).toBeVisible();
  // every office is on the map (canvas dots), with nothing chosen yet
  await expect(sheet.getByTestId('near-from')).toHaveAttribute('data-kind', 'none');
  await sheet.getByTestId('near-search').fill('Trishal');
  const rows = sheet.getByTestId('near-row');
  await expect(rows.first()).toHaveAttribute('data-id', 'bd-mymensingh-trishal');
  await rows.first().click();
  await expect(sheet.getByTestId('near-office')).toHaveAttribute('data-id', 'bd-mymensingh-trishal');
  await expect(sheet.getByTestId('near-leaflet')).toHaveAttribute('data-selected', 'bd-mymensingh-trishal');
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  // Bangla district name
  await sheet.getByTestId('near-search').fill('ময়মনসিংহ');
  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  expect(ids.length).toBeGreaterThan(5);
  expect(ids.every((id) => id!.startsWith('bd-mymensingh-'))).toBe(true);
  // a newer English spelling
  await sheet.getByTestId('near-search').fill('Bogura');
  await expect(rows.first()).toHaveAttribute('data-id', /^bd-bogra-/);
  await sheet.getByTestId('near-search').fill('Nairobi');
  await expect(sheet.getByTestId('near-none')).toBeVisible();
});

test('the finder with location: the list is sorted by distance from the farmer and the nearest is chosen', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(DHAKA);
  await page.goto(APP);
  await page.getByTestId('near-entry').first().click();
  const sheet = page.getByRole('dialog', { name: 'Nearest Krishi officer' });
  await sheet.getByTestId('near-locate').click();
  await expect(sheet.getByTestId('near-from')).toHaveAttribute('data-kind', 'gps');
  const want = expected(DHAKA.latitude, DHAKA.longitude, 10);
  await expect.poll(async () => sheet.getByTestId('near-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual(want.map((o) => o.id));
  const kms = (await sheet.getByTestId('near-row-km').allTextContents()).map((s) => parseFloat(s));
  expect([...kms].sort((a, b) => a - b)).toEqual(kms);
  await expect(sheet.getByTestId('near-office')).toHaveAttribute('data-id', want[0]!.id);
  await expect(sheet.getByTestId('near-callcentre')).toContainText('16123');
  await expect(sheet.getByTestId('near-cc-call')).toHaveAttribute('href', 'tel:16123');
});

test('the finder: location refused falls back to the district list', async ({ page }) => {
  await denyLocation(page);
  await page.goto(APP);
  await page.getByTestId('near-entry').first().click();
  const sheet = page.getByRole('dialog', { name: 'Nearest Krishi officer' });
  await sheet.getByTestId('near-locate').click();
  await expect(sheet.getByTestId('near-denied')).toBeVisible();
  await sheet.getByTestId('near-district').selectOption('Bogra');
  await expect(sheet.getByTestId('near-from')).toHaveAttribute('data-kind', 'district');
  await expect(sheet.getByTestId('near-row').first()).toHaveAttribute('data-id', /^bd-bogra-/);
  await expect(sheet.getByTestId('near-office')).toHaveAttribute('data-id', /^bd-bogra-/);
});

test('an officer is shown only with the "as published" label and the government source', async ({ page }) => {
  await page.goto(APP);
  await page.getByTestId('near-entry').first().click();
  const sheet = page.getByRole('dialog', { name: 'Nearest Krishi officer' });
  const withOfficer = data.offices.find((o) => o.officer?.mobile)!;
  await sheet.getByTestId('near-search').fill(withOfficer.id.split('-').slice(2).join(' '));
  await sheet.locator(`[data-testid="near-row"][data-id="${withOfficer.id}"]`).click();
  const card = sheet.getByTestId('near-office');
  await expect(card.getByTestId('near-officer')).toContainText(withOfficer.officer!.name_bn);
  await expect(card).toContainText('As published on the DAE website');
  await expect(card).toContainText('gov.bd');
  await expect(card.getByTestId('near-call')).toHaveAttribute('href', `tel:${withOfficer.officer!.mobile}`);
});

test('the entry is on the farmer app Ask and Today tabs, and in the phone app; the card shows on /m Ask too', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('near-entry').first()).toContainText('Find your nearest Krishi officer');
  await page.goto('/app?sample=1&lang=en&tab=today');
  await expect(page.getByTestId('near-entry').first()).toBeVisible();
  await page.goto('/m?sample=1&lang=en&welcome=0');
  await page.getByTestId('m-tab-help').click();
  await page.getByTestId('near-entry').first().click();
  await expect(page.getByRole('dialog', { name: 'Nearest Krishi officer' })).toBeVisible();
  await page.goto(M);
  await handOff(page);
  await expect(page.getByTestId('near-card')).toBeVisible();
});

test('Bangla: the card and the finder read in Bangla with the machine-written note', async ({ page }) => {
  await page.goto('/app?sample=1&lang=bn&tab=ask');
  await expect(page.getByTestId('near-entry').first()).toContainText('কাছের কৃষি কর্মকর্তা খুঁজুন');
  await page.getByTestId('near-entry').first().click();
  const sheet = page.getByRole('dialog', { name: 'কাছের কৃষি কর্মকর্তা' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('near-callcentre')).toContainText('কৃষি কল সেন্টার');
  await sheet.getByTestId('near-search').fill('বগুড়া');
  await expect(sheet.getByTestId('near-row').first()).toContainText('বগুড়া');
  await expect(sheet).toContainText('মেশিনে লেখা');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: the card and the open finder`, async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(DHAKA);
    await page.goto(`${APP}&theme=${theme}`);
    await handOff(page);
    await axe(page, `${theme} card, asking`);
    await page.getByTestId('near-card-locate').click();
    await expect(page.getByTestId('near-card-office')).toBeVisible();
    await axe(page, `${theme} card, office`);
    await page.getByTestId('near-card-go').click();
    await expect(page.getByTestId('near-office')).toBeVisible();
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
    await axe(page, `${theme} finder`);
  });
}

test('390 px: no sideways scroll, and every button and link is at least 44 px tall', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(DHAKA);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(M);
  await handOff(page);
  await noOverflow(page);
  await page.getByTestId('near-card-locate').click();
  const card = page.getByTestId('near-card');
  await expect(card.getByTestId('near-card-office')).toBeVisible();
  await noOverflow(page);
  for (const el of await card.locator('a.btn, button.btn, .near-link').all()) {
    const box = await el.boundingBox();
    expect(box!.height, 'card targets are at least 44 px tall').toBeGreaterThanOrEqual(43.5);
  }
  await card.getByTestId('near-card-go').click();
  const sheet = page.getByRole('dialog', { name: 'Nearest Krishi officer' });
  await expect(sheet.getByTestId('near-office')).toBeVisible();
  await noOverflow(page);
  const sw = await sheet.evaluate((e) => (e.querySelector('.near-body') as HTMLElement).scrollWidth - (e.querySelector('.near-body') as HTMLElement).clientWidth);
  expect(sw, 'the sheet body does not scroll sideways').toBeLessThanOrEqual(1);
  for (const id of ['near-directions', 'near-call', 'near-cc-call', 'near-locate', 'near-district', 'near-search', 'near-row']) {
    for (const el of await sheet.getByTestId(id).all()) {
      const box = await el.boundingBox();
      expect(box!.height, `${id} is at least 44 px tall`).toBeGreaterThanOrEqual(43.5);
    }
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
