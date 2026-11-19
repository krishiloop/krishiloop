import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The phone app (/m, builder Mo) on a phone: 390 × 844, touch, a mobile browser. Recorded mode (`?sample=1`): real
 * answers of our own API recorded on 2 Nov 2026, so every test is deterministic and needs no backend.
 *  - the first-run welcome (language, a sample farm, what the app does), remembered after;
 *  - every tab: Home (advice, Why, Listen, receipt, weather warnings, near you), Check a leaf (the camera input, the model
 *    reading a drawn leaf on the phone), Ask, My receipts (stamps, the QR for an officer), Help (booking, language);
 *  - offline: receipts saved on the phone still show, and the list says the check is old;
 *  - axe (WCAG 2.2 A + AA) in both themes, and no sideways scroll at 360 px.
 * Run on its own port: `E2E_PORT=5282 npx playwright test mobile`.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const APP = '/m?sample=1&lang=en&welcome=0';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

async function settle(page: Page) {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]));
}

async function axe(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')} :: ${(v.nodes[0]?.failureSummary ?? '').split('\n').slice(0, 3).join(' | ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

/** Nothing scrolls sideways: not the page, and not the app's own scrolling area. */
async function noSideways(page: Page, label: string) {
  const over = await page.evaluate(() => {
    const s = document.querySelector('.m-scroll');
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, s ? s.scrollWidth - s.clientWidth : 0);
  });
  expect(over, `${label}: no sideways scroll`).toBeLessThanOrEqual(1);
}

const tab = (page: Page, id: string) => page.getByTestId(`m-tab-${id}`);

/** A leaf drawn on a canvas (green blade, midrib, brown lesions), as a JPEG: no licence question. */
async function leaf(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d6ccaa';
    g.fillRect(0, 0, 1200, 900);
    g.fillStyle = '#3a8034';
    g.beginPath();
    g.ellipse(600, 450, 520, 230, -0.15, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#78aa5a';
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(110, 520);
    g.lineTo(1090, 380);
    g.stroke();
    g.fillStyle = '#825c32';
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      g.ellipse(300 + ((i * 137) % 620), 330 + ((i * 89) % 260), 26, 14, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

test('first run: language, a sample farm, what the app does; then remembered', async ({ page }) => {
  await page.goto('/m?sample=1&lang=en');
  const welcome = page.getByTestId('m-welcome');
  await expect(welcome).toHaveAttribute('data-step', '1');
  // no website header or footer: an app shell
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible();
  await page.getByTestId('m-ob-lang-bn').click();
  await expect(page.getByRole('heading', { name: 'আপনার ভাষা বেছে নিন' })).toBeVisible();
  await page.getByTestId('m-ob-lang-en').click();
  await expect(page.getByTestId('m-ob-lang-en')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('m-ob-next').click();

  // a sample farm, said plainly
  await expect(page.getByRole('heading', { name: 'Choose a farm to try' })).toBeVisible();
  await expect(welcome).toContainText('These are sample farms, not real farmers.');
  await expect(welcome.locator('.m-ob-farm')).toHaveCount(5);
  await page.getByTestId('m-ob-farm-bd-pests').click();
  await expect(page.getByTestId('m-ob-farm-bd-pests').locator('input')).toBeChecked();
  await page.getByTestId('m-ob-next').click();

  // what the app does, in three lines
  await expect(page.getByRole('heading', { name: 'What this app does' })).toBeVisible();
  await expect(welcome.locator('.m-ob-what li')).toHaveCount(3);
  await page.getByTestId('m-ob-start').click();

  // the chosen farm's advice on Home
  await expect(page.getByTestId('fa-decision')).toContainText('Re-check');
  await expect(page.getByTestId('m-head')).toContainText('Sample farm');
  await page.reload();
  await expect(page.getByTestId('m-welcome')).toHaveCount(0);
  await expect(page.getByTestId('fa-decision')).toBeVisible();
});

test('Home: one big answer with Why, Listen and the receipt, weather warnings and near you', async ({ page }) => {
  await page.goto(APP);
  await expect(tab(page, 'home')).toHaveAttribute('aria-selected', 'true');
  const decision = page.getByTestId('fa-decision');
  await expect(decision).toContainText('No spray needed');
  await expect(page.getByTestId('m-head')).toContainText('Recorded 2 Nov');
  await page.getByRole('button', { name: 'Why this?' }).click();
  await expect(page.getByTestId('fa-why')).toContainText('R-BDR-002 v1');
  await expect(page.getByTestId('fa-hear')).toHaveText(/Listen/);
  await expect(page.getByTestId('kg-root')).toBeVisible(); // weather warnings
  await expect(page.getByTestId('kg-near')).toBeVisible(); // near you
  // the receipt opens as a sheet with its stamp
  await decision.getByRole('button', { name: 'Open the receipt' }).click();
  const sheet = page.getByRole('dialog', { name: 'Advice receipt' });
  await expect(sheet.locator('.stamp')).toHaveText(/authentic/i);
  await sheet.getByRole('button', { name: 'Close' }).click();
  // every tab button is a big target
  for (const id of ['home', 'leaf', 'ask', 'receipts', 'help']) {
    const box = await tab(page, id).boundingBox();
    expect(box!.height, `${id} tab is at least 48 px tall`).toBeGreaterThanOrEqual(48);
  }
});

test('Check a leaf: the camera opens directly, and the model reads a leaf on the phone', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(APP);
  await tab(page, 'leaf').click();
  await expect(tab(page, 'leaf')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('m-leaf')).toContainText('One leaf, close up');
  await expect(page.getByTestId('fa-ai-weights')).toContainText('Research weights (trained on PlantWild, non-commercial)');
  const cam = page.getByTestId('fa-ai-camera-input');
  await expect(cam).toHaveAttribute('capture', 'environment');
  await expect(cam).toHaveAttribute('accept', 'image/*');
  const api: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
  });
  await cam.setInputFiles({ name: 'leaf.jpg', mimeType: 'image/jpeg', buffer: await leaf(page) });
  await expect(page.getByTestId('fa-ai-card')).toBeVisible({ timeout: 180_000 }); // the 11.5 MB model loads once
  await expect(page.getByTestId('fa-ai-outcome')).toBeVisible();
  expect(api, 'the photo never left the phone').toEqual([]);
});

test('Ask: a big microphone, a text box, and an answer with its receipt', async ({ page }) => {
  await page.goto(APP);
  await tab(page, 'ask').click();
  await expect(page.getByTestId('fa-mic')).toBeVisible();
  const mic = await page.getByTestId('fa-mic').boundingBox();
  expect(mic!.width).toBeGreaterThanOrEqual(64);
  await expect(page.getByTestId('fa-ask-input')).toBeVisible();
  await page.getByTestId('fa-ask-chip').first().click();
  await expect(page.getByTestId('fa-answer')).toContainText('No spray needed');
});

test('My receipts: stamps, then the QR for an officer, with the short code', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('fa-decision')).toBeVisible();
  await tab(page, 'receipts').click();
  const rows = page.getByTestId('m-receipt');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toHaveAttribute('data-status', 'authentic');
  await expect(rows.first().locator('.stamp')).toHaveText(/authentic/i);
  await expect(page.getByTestId('m-receipts')).toContainText('saved on this phone');
  await rows.first().getByTestId('m-rc-qr').click();
  const qr = page.getByRole('dialog', { name: 'Show this to your officer' });
  await expect(qr.getByRole('img', { name: 'QR code to check this receipt' })).toBeVisible();
  await expect(qr.getByTestId('m-qr-code')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(qr.getByTestId('m-qr-url')).toContainText('/v/');
  await qr.getByRole('button', { name: 'Done' }).click();
  await expect(qr).toBeHidden();
  // tap a row: the receipt itself
  await rows.first().getByRole('button', { name: /^Open receipt/ }).click();
  await expect(page.getByRole('dialog', { name: 'Advice receipt' }).locator('.stamp')).toHaveText(/authentic/i);
});

test('Help: call my officer (the booking), the language switch, the sample farm', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('fa-decision')).toBeVisible();
  await tab(page, 'help').click();
  await expect(page.getByTestId('m-help')).toContainText('The leaf check uses research weights (trained on PlantWild, non-commercial).');
  await page.getByTestId('m-call-officer').click();
  const drawer = page.getByRole('dialog', { name: 'Ask an officer to visit or call' });
  await expect(drawer.getByTestId('kg-visit-form')).toBeVisible();
  await drawer.getByTestId('kg-day-1').check();
  await drawer.getByRole('radio', { name: 'Morning' }).check();
  await drawer.getByTestId('kg-visit-send').click();
  const done = page.getByTestId('kg-visit-done');
  await expect(done).toContainText('Request kept on this phone'); // recorded mode: not sent, and said so
  await expect(done.getByTestId('kg-visit-case')).not.toBeEmpty();
  await done.getByRole('button', { name: 'Done' }).click();
  // language: the whole app switches
  await page.getByTestId('m-help-lang-bn').click();
  await expect(tab(page, 'help')).toContainText('সাহায্য');
  await page.getByTestId('m-help-lang-en').click();
  // another sample field rebuilds Home's advice
  await page.getByTestId('m-field-KE-SAMPLE-01').check({ force: true });
  await expect(page.getByTestId('m-farm')).toContainText('Potato');
  await expect(page.getByRole('link', { name: 'Open the KrishiLoop website' })).toHaveAttribute('href', '/');
});

test('offline: the saved receipts still show, and the list says the check is old', async ({ page, context }) => {
  await page.goto(APP);
  await expect(page.getByTestId('fa-decision')).toBeVisible();
  await tab(page, 'receipts').click();
  await expect(page.getByTestId('m-receipt').first()).toHaveAttribute('data-status', 'authentic');
  const n = await page.getByTestId('m-receipt').count();

  await context.setOffline(true);
  await expect(page.getByTestId('m-offline')).toContainText('No internet');
  await tab(page, 'home').click();
  await tab(page, 'receipts').click();
  await expect(page.getByTestId('m-receipt')).toHaveCount(n);
  await expect(page.getByTestId('m-rc-old')).toContainText('You see the last check');
  await expect(page.getByTestId('m-receipt').first().getByTestId('m-rc-when')).toBeVisible();
  await context.setOffline(false);

  // a new visit with no server and no recorded data: the receipts come from this phone alone
  const page2 = await context.newPage();
  await page2.route((u) => u.pathname.startsWith('/api/') || u.pathname.startsWith('/status/'), (r) => r.abort()); // no server
  await page2.route(/\/data\/recorded\/(plans|asks|verify-before|verify-after|snapshots)\.json/, (r) => r.abort()); // the recorded answers
  await page2.goto('/m?lang=en&welcome=0&tab=receipts');
  await expect(page2.getByTestId('m-receipt')).toHaveCount(n);
  await expect(page2.getByTestId('m-receipt').first()).toHaveAttribute('data-status', 'authentic');
  await expect(page2.getByTestId('m-receipt').first().getByTestId('m-rc-when')).toContainText('Last checked');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: welcome, every tab, the QR`, async ({ page }) => {
    test.setTimeout(240_000); // eight axe passes; slow when the whole suite shares the machine
    await page.goto(`/m?sample=1&lang=en&theme=${theme}`);
    await expect(page.getByTestId('m-welcome')).toBeVisible();
    await axe(page, `${theme} welcome 1`);
    await page.getByTestId('m-ob-next').click();
    await expect(page.locator('.m-ob-farm').first()).toBeVisible();
    await axe(page, `${theme} welcome 2`);
    await page.getByTestId('m-ob-next').click();
    await page.getByTestId('m-ob-start').click();
    await expect(page.getByTestId('fa-decision')).toBeVisible();
    await expect(page.getByTestId('kg-near')).toBeVisible();
    await axe(page, `${theme} home`);
    for (const id of ['leaf', 'ask', 'receipts', 'help']) {
      await tab(page, id).click();
      await expect(page.getByTestId(`m-panel-${id}`)).toBeVisible();
      if (id === 'leaf') await expect(page.getByTestId('fa-ai')).toBeVisible();
      if (id === 'receipts') await expect(page.getByTestId('m-receipt').first()).toBeVisible();
      await axe(page, `${theme} ${id}`);
    }
    await tab(page, 'receipts').click();
    await page.getByTestId('m-rc-qr').first().click();
    await expect(page.getByTestId('m-qr-code')).toBeVisible();
    await axe(page, `${theme} QR`);
  });
}

test('no sideways scroll at 360 px, in English and Bangla, on every tab', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  for (const lang of ['en', 'bn']) {
    await page.goto(`/m?sample=1&lang=${lang}`);
    await expect(page.getByTestId('m-welcome')).toBeVisible();
    await noSideways(page, `${lang} welcome`);
    await page.getByTestId('m-ob-next').click();
    await expect(page.locator('.m-ob-farm').first()).toBeVisible();
    await noSideways(page, `${lang} farms`);
    await page.getByTestId('m-ob-next').click();
    await page.getByTestId('m-ob-start').click();
    await expect(page.getByTestId('fa-decision')).toBeVisible();
    for (const id of ['home', 'leaf', 'ask', 'receipts', 'help']) {
      await tab(page, id).click();
      await expect(page.getByTestId(`m-panel-${id}`)).toBeVisible();
      await noSideways(page, `${lang} ${id}`);
    }
    await page.evaluate(() => localStorage.clear());
  }
});

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  test('Open on your phone: on /app, a QR to /m and Copy link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/app?sample=1&lang=en');
  const card = page.getByTestId('open-on-phone');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Scan with your phone’s camera');
  await expect(card.getByRole('img', { name: 'QR code that opens the KrishiLoop phone app' })).toBeVisible();
  await expect(card.getByTestId('open-on-phone-url')).toHaveValue(/\/m$/);
  await card.getByTestId('open-on-phone-copy').click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https?:\/\/[^/]+\/m$/);
});
});
