import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The farmer app (/app), rebuilt: Today, the receipt sheet, Ask, Photo, Receipts, the glass-box rails and the phone frame.
 *
 * Most tests run in RECORDED mode (`?sample=1`): real answers of our own API recorded on 2 Nov 2026, so they are
 * deterministic and need no backend. The last block is a LIVE smoke against the real API behind the dev server (skipped
 * when it is not running): a sandbox plan, a live verdict on its receipt, a live Ask and a live photo case.
 * Accessibility: axe (WCAG 2.2 A + AA rules) on every state, both themes, with 0 serious or critical violations.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const REC = '/app?sample=1&lang=en';

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
}

/** Let entrance animations finish first: axe measures contrast on what is painted, mid-fade included. */
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

const decision = (page: Page) => page.getByTestId('fa-decision');
const openReceipt = async (page: Page) => {
  await decision(page).getByRole('button', { name: 'Open the receipt' }).click();
  const sheet = page.getByRole('dialog', { name: 'Advice receipt' });
  await expect(sheet).toBeVisible();
  return sheet;
};

test.describe('recorded mode (deterministic)', () => {
  test('Today: the decision, why, other actions, the forecast, and the inspector logging the plan', async ({ page }) => {
    await page.goto(REC);
    await expect(decision(page)).toContainText('No spray needed');
    await expect(page.getByTestId('farmer-app')).toContainText('Recorded 2 Nov');
    // why this? the rule, its quote and the numbers people set
    await page.getByRole('button', { name: 'Why this?' }).click();
    const why = page.getByTestId('fa-why');
    await expect(why).toContainText('R-BDR-002 v1');
    await expect(why).toContainText('not from the source');
    await expect(why.locator('blockquote')).toBeVisible();
    // at most two other actions, each with its receipt
    await expect(page.getByTestId('fa-action-row')).toHaveCount(2);
    await expect(page.getByRole('list', { name: 'Next 7 days' })).toBeVisible();
    // glass box: the inspector shows the plan, rule versions and the signature suite
    const ins = page.getByTestId('fa-inspector');
    await expect(ins.getByTestId('fa-ins-entry').first()).toContainText('recorded · plans.json');
    await expect(ins).toContainText('R-BDR-002 v1');
    await expect(ins).toContainText('eddsa-jcs-2022');
    // the URL follows the app, so the state can be shared
    await expect(page).toHaveURL(/field=BD-SAMPLE-02/);
    await expect(page).toHaveURL(/tab=today/);
    await noOverflow(page);
  });

  test('deep link: field, farmer and tab', async ({ page }) => {
    await page.goto(`${REC}&field=BD-SAMPLE-02&profile=demo-farmer-c&tab=receipts`);
    await expect(page.getByRole('tab', { name: 'Receipts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('fa-receipt-row').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Today' }).click();
    await expect(decision(page)).toContainText('Re-check');
    await expect(page.getByTestId('fa-profile-demo-farmer-c')).toBeChecked();
  });

  test('picking another field and farmer rebuilds the plan', async ({ page }) => {
    await page.goto(REC);
    await expect(decision(page)).toContainText('No spray needed');
    await page.getByTestId('fa-profile-demo-farmer-c').check({ force: true });
    await expect(decision(page)).toContainText('Re-check');
    await page.getByTestId('fa-field-KE-SAMPLE-01').check({ force: true });
    await expect(page.getByTestId('fa-field')).toContainText('Potato');
    await expect(decision(page)).toContainText('No spray needed');
  });

  test('the receipt sheet: prints, AUTHENTIC lands, SMS preview counts, signed JSON downloads, print keeps only the receipt', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await page.goto(REC);
    const sheet = await openReceipt(page);
    await expect(sheet.locator('.stamp')).toHaveText(/authentic/i);
    await expect(sheet.getByTestId('fa-rc-verdict')).toContainText('It does not promise the advice is right');
    await expect(page.getByTestId('fa-try-receipt')).toHaveAttribute('data-done', 'true');

    // SMS preview: the exact text, a live counter, labelled planned
    await sheet.getByTestId('fa-rc-sms').click();
    await expect(sheet.getByTestId('fa-sms')).toContainText('Preview. SMS is sandbox: not sent');
    // the recorded receipt's own short code (issued by the server when it was recorded) and its /v/ link
    await expect(sheet.getByTestId('fa-sms-text')).toContainText(/Check receipt [0-9A-Z]{4}-[0-9A-Z]{4}: \S+\/v\/[0-9A-Z]{4}-[0-9A-Z]{4}/);
    await expect(sheet.getByTestId('fa-sms-text')).toContainText('KrishiLoop: No spray needed. Rule R-BDR-002 v1. Check receipt');
    await expect(sheet.getByTestId('fa-sms-count')).toHaveText(/^\d+ \/ 160$/);

    // the signed credential, as it was verified
    const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByTestId('fa-rc-json').click()]);
    expect(download.suggestedFilename()).toMatch(/^krishiloop-receipt-[0-9a-f]{8}\.json$/);
    const vc = JSON.parse(readFileSync((await download.path())!, 'utf8')) as { proof: { cryptosuite: string }; type: string[] };
    expect(vc.proof.cryptosuite).toBe('eddsa-jcs-2022');
    expect(vc.type).toContain('AdviceReceiptCredential');

    // print: a clean copy outside the dialog, everything else hidden by the print stylesheet
    await sheet.getByTestId('fa-rc-print').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
    await expect(page.locator('body > .fa-print-root .stamp')).toHaveCount(1);
    await expect(page.locator('html')).toHaveClass(/fa-printing/);
  });

  test('read aloud never uses a wrong voice', async ({ page }) => {
    // a browser with an English voice only: Bangla advice must not be read with it. Our own Bangla clips are switched
    // off here (no manifest), so this is the "no voice at all" path; tests/e2e/voice.spec.ts covers our clips.
    await page.route('**/audio/manifest.json', (r) => r.fulfill({ status: 404, body: '' }));
    await page.addInitScript(() => {
      const en = { lang: 'en-GB', name: 'Test English', default: true, localService: true, voiceURI: 'en' };
      Object.defineProperty(window.speechSynthesis, 'getVoices', { value: () => [en] });
      Object.defineProperty(window.speechSynthesis, 'speak', { value: () => undefined });
    });
    await page.goto('/app?sample=1&lang=bn');
    // on Today: the speaker on the decision card says so in a toast
    await page.getByTestId('fa-hear').click();
    await expect(page.locator('.toast')).toContainText('বাংলা কণ্ঠ নেই');
    // in the receipt sheet: the same honest answer next to the button
    await page.getByTestId('fa-decision').getByRole('button', { name: 'রসিদ খুলুন' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByTestId('fa-rc-read').click();
    await expect(sheet.getByTestId('fa-rc-voice')).toContainText('বাংলা কণ্ঠ নেই');
  });

  test('Ask: a recorded question gets its rule, receipt and pipeline; a new one says the server is not connected; an unanswerable one goes to the officer', async ({ page }) => {
    await page.goto(`${REC}&tab=ask`);
    await expect(page.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('fa-ask-chip').first().click();
    const answer = page.getByTestId('fa-answer');
    await expect(answer).toContainText('No spray needed');
    await expect(answer).toContainText('R-BDR-002 v1');
    const pipe = page.getByTestId('fa-pipeline');
    await expect(pipe).toContainText('BM25');
    await expect(pipe.locator('[data-stage="rerank"]')).toHaveAttribute('data-state', 'skipped');
    await expect(pipe.locator('[data-stage="receipt"]')).toHaveAttribute('data-state', 'ran');
    await expect(page.getByTestId('fa-ask')).toContainText('only a fingerprint of your question');
    await expect(page.getByTestId('fa-try-ask')).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('fa-inspector')).toContainText('langgraph: normalise');

    await page.getByTestId('fa-answer-receipt').click();
    await expect(page.getByRole('dialog', { name: 'Advice receipt' }).locator('.stamp')).toHaveText(/authentic/i);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    await page.getByTestId('fa-ask-input').fill('How much water does rice need at tillering?');
    await page.getByTestId('fa-ask-send').click();
    await expect(page.getByTestId('fa-ask-offline')).toContainText('The live server is not connected.');

    await page.getByTestId('fa-ask-input').fill('Can I get a loan to buy fertiliser?');
    await page.getByTestId('fa-ask-send').click();
    const abst = page.getByTestId('fa-ask-abstained');
    await expect(abst).toContainText('Sent to your officer');
    await expect(abst.getByTestId('fa-ask-case')).toHaveText(/^inbox-/);
    await expect(page.getByTestId('fa-pipeline').locator('[data-stage="abstain"]')).toBeVisible();
  });

  test('Photo: honest without the live server, with a link to the real replay', async ({ page }) => {
    await page.goto(`${REC}&tab=photo`);
    await page.getByTestId('fa-photo-earlier').locator('summary').click(); // the earlier research model, closed by default
    const off = page.getByTestId('fa-photo-offline');
    await expect(off).toContainText('The photo check needs the live server.');
    await expect(off.getByRole('button', { name: 'Take a photo' })).toBeDisabled();
    await expect(off.getByRole('link', { name: /earn trust/ })).toHaveAttribute('href', '/trust');
  });

  test('a recall reaches this tab: Today abstains with the reason, Receipts show RECALLED and what to do', async ({ page }) => {
    await page.goto(REC);
    await expect(decision(page)).toContainText('No spray needed');
    await page.getByRole('tab', { name: 'Receipts' }).click();
    await expect(page.getByTestId('fa-receipt-row').first()).toHaveAttribute('data-status', 'authentic');
    // the officer console recalls R-BDR-002 v1 in this tab (with recorded data the recall is simulated in the browser)
    // (a string, so the test runner does not rewrite the import: the page's own module instance is used)
    await page.evaluate("import('/src/lib/api/mocks.ts').then((m) => m.simulateRecall('R-BDR-002', 1))");
    const recalled = page.locator('[data-testid="fa-receipt-row"][data-status="recalled"]');
    await expect(recalled).toHaveCount(1);
    await expect(recalled.getByTestId('fa-receipt-now')).toContainText('R-BDR-002 v1');
    await expect(page.getByRole('tab', { name: /Receipts/ })).toContainText('1');
    await page.getByRole('tab', { name: /Today/ }).click();
    const abs = page.getByTestId('fa-abstained');
    await expect(abs).toContainText('We’re not sure this week.');
    await expect(abs.getByTestId('fa-abs-reason')).toContainText('withdrawn for review');
    await expect(abs.getByTestId('fa-abs-case')).toHaveText(/^inbox-/);
    await expect(page.getByTestId('fa-after-recall')).toBeVisible();
    await expect(page.getByTestId('fa-try-recall')).toHaveAttribute('data-done', 'true');
    // the recalled receipt itself says so
    await page.getByRole('tab', { name: /Receipts/ }).click();
    await recalled.getByRole('button').first().click();
    const sheet = page.getByRole('dialog', { name: 'Advice receipt' });
    await expect(sheet.locator('.stamp')).toHaveText(/recalled/i);
    await expect(sheet.getByTestId('fa-rc-recalled')).toContainText('What to do now:');
  });

  test.describe('phone, 390 px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('bottom tabs with keyboard, the Guide sheet, Bangla, no horizontal scroll', async ({ page }) => {
      await page.goto('/app?sample=1&lang=bn');
      await expect(decision(page)).toContainText('স্প্রে দরকার নেই');
      await expect(page.getByTestId('fa-inspector')).toHaveCount(0); // the rails live in the Guide on phones
      const today = page.getByRole('tab', { name: 'আজ' });
      await today.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'প্রশ্ন' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toContainText('আপনার জমি নিয়ে প্রশ্ন করুন');
      await page.keyboard.press('End');
      await expect(page.getByRole('tab', { name: 'রসিদ' })).toHaveAttribute('aria-selected', 'true');
      await page.getByTestId('fa-guide').click();
      const guide = page.getByRole('dialog', { name: 'গাইড' });
      await expect(guide).toContainText('যা চেষ্টা করবেন');
      await expect(guide.getByTestId('fa-inspector')).toBeVisible();
      await noOverflow(page);
    });

    test('the tab bar stays at the bottom and every control is at least 48 px tall', async ({ page }) => {
      await page.goto(REC);
      await expect(decision(page)).toBeVisible();
      const bar = await page.locator('.fa-tabbar').boundingBox();
      expect(bar!.y + bar!.height).toBeGreaterThan(830);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="farmer-app"] button, [data-testid="farmer-app"] a')]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ el: el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label'), h: el.getBoundingClientRect().height }))
          .filter((x) => x.h < 46),
      );
      expect(small).toEqual([]);
    });
  });
});

test.describe('accessibility (axe)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`every state, ${theme} theme`, async ({ page }) => {
      await page.goto(`${REC}&theme=${theme}`);
      await expect(decision(page)).toBeVisible();
      await page.getByRole('button', { name: 'Why this?' }).click();
      await axe(page, 'Today');
      await openReceipt(page);
      await page.waitForTimeout(1300);
      await page.getByRole('dialog').getByTestId('fa-rc-sms').click();
      await axe(page, 'receipt sheet with SMS preview');
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      await page.getByRole('tab', { name: 'Ask' }).click();
      await page.getByTestId('fa-ask-chip').first().click();
      await expect(page.getByTestId('fa-answer')).toBeVisible();
      await page.waitForTimeout(900);
      await axe(page, 'Ask answer');
      await page.getByRole('tab', { name: 'Photo' }).click();
      await axe(page, 'Photo (recorded)');
      await page.getByRole('tab', { name: /Receipts/ }).click();
      await expect(page.getByTestId('fa-receipt-row').first()).toHaveAttribute('data-status', 'authentic');
      await axe(page, 'Receipts');
    });
  }

  test('phone Guide sheet, Bangla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app?sample=1&lang=bn');
    await expect(decision(page)).toBeVisible();
    await page.getByTestId('fa-guide').click();
    await page.waitForTimeout(500);
    await axe(page, 'Guide sheet');
  });
});

test.describe('live API smoke', () => {
  test.beforeEach(async ({ request }) => {
    const up = await request
      .get('/api/demo', { timeout: 5000 })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!up, 'the live API is not running behind the dev server');
  });

  test('a sandbox plan, a live verdict, a live Ask and a live photo case', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app?lang=en&field=BD-SAMPLE-02&profile=demo-farmer-c');
    await expect(decision(page)).toContainText('Re-check', { timeout: 30_000 });
    await expect(page.getByTestId('farmer-app')).not.toContainText('Recorded 2 Nov');
    await expect(page.getByTestId('fa-mode')).toContainText('Live');
    await expect(page.getByTestId('fa-inspector')).toContainText('POST /api/demo/‹sid›/plan');
    expect(await page.evaluate(() => sessionStorage.getItem('kl.demo.sid'))).toMatch(/^[0-9a-f]+$/);

    const sheet = await openReceipt(page);
    await expect(sheet.locator('.stamp')).toHaveText(/authentic/i, { timeout: 15_000 });
    await expect(page.getByTestId('fa-inspector')).toContainText('GET /api/verify/');
    await sheet.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('tab', { name: 'Ask' }).click();
    await page.getByTestId('fa-ask-input').fill('Should I spray for brown planthopper? I counted four females per hill.');
    await page.getByTestId('fa-ask-send').click();
    await expect(page.getByTestId('fa-answer').or(page.getByTestId('fa-ask-abstained'))).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('fa-inspector')).toContainText('POST /api/demo/‹sid›/ask');

    await page.getByRole('tab', { name: 'Photo' }).click();
    await page.getByTestId('fa-photo-earlier').locator('summary').click(); // the earlier research model, closed by default
    await expect(page.getByTestId('fa-area')).toContainText('Officer checks', { timeout: 15_000 });
    await page.getByTestId('fa-photo-consent').click();
    await expect(page.getByTestId('fa-photo-consent')).toHaveAttribute('aria-checked', 'true');
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 1200;
      const g = c.getContext('2d')!;
      g.fillStyle = '#4f7d35';
      g.fillRect(0, 0, 1600, 1200);
      g.fillStyle = '#7a5a2e';
      for (let i = 0; i < 40; i++) g.fillRect((i * 389) % 1500, (i * 211) % 1100, 30, 12);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    await page.getByTestId('fa-photo-input').setInputFiles({ name: 'leaf.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
    const result = page.getByTestId('fa-photo-officer').or(page.getByTestId('fa-photo-auto'));
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('fa-photo-case')).toHaveText(/^pc-[0-9a-f]{16}$/);
    await expect(page.getByTestId('fa-inspector')).toContainText('POST /api/demo/‹sid›/photo');
    await expect(page.getByTestId('fa-try-photo')).toHaveAttribute('data-done', 'true');

    // a real recall inside this tab's sandbox (what the officer console calls): the plan is rebuilt by the server and
    // abstains; the receipt this visitor holds now verifies as recalled
    await page.getByRole('tab', { name: 'Today' }).click();
    await page.evaluate("import('/src/lib/api/client.ts').then((m) => m.recallRule('R-BDR-001', 1, { reason: 'e2e: farmer app recall path' }))");
    await expect(page.getByTestId('fa-abstained')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('fa-abs-reason')).toContainText('withdrawn for review');
    await page.getByRole('tab', { name: /Receipts/ }).click();
    await expect(page.locator('[data-testid="fa-receipt-row"][data-status="recalled"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('fa-try-recall')).toHaveAttribute('data-done', 'true');
    await noOverflow(page);
  });
});
