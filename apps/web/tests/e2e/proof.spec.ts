import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * /proof, the evidence hub. The headline test runs the in-browser signature check (src/lib/vc) on the recorded hero
 * receipt, then changes one letter and checks that the same check fails. `?sample=1` keeps it deterministic; recorded
 * receipts are always checked against the recorded issuer key, so the live smoke can check the same receipt.
 */
const HERO = 'urn:uuid:84942e4a-2ce9-4497-92ca-11f478f9e259';

const errors = (page: Page) => {
  const list: string[] = [];
  page.on('pageerror', (e) => list.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && list.push(m.text()));
  return list;
};

async function noSeriousAxe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

async function checkHero(page: Page) {
  const box = page.getByTestId('check-yourself');
  await expect(box.getByTestId('check-input')).toHaveValue(HERO);
  await box.getByRole('button', { name: 'Check in my browser' }).click();
  const verdict = box.getByTestId('check-verdict');
  await expect(verdict).toHaveAttribute('data-ok', 'true', { timeout: 15_000 });
  return { box, verdict };
}

test.describe('/proof in recorded mode', () => {
  test('check it yourself: the recorded hero receipt verifies in this browser, and one changed letter fails', async ({ page }) => {
    const errs = errors(page);
    await page.goto('/proof?sample=1');
    const { box, verdict } = await checkHero(page);
    for (const step of ['key', 'canonical', 'hash', 'signature']) await expect(box.getByTestId(`step-${step}`)).toHaveAttribute('data-state', 'done');
    await expect(box.getByTestId('step-key')).toContainText('did:web:127.0.0.1%3A5173#key-1');
    // the same bytes the server hashes (services/trust/vc.py _hash_data of this receipt)
    await expect(box.getByTestId('step-hash')).toContainText('f107e8f99bbff496');
    await expect(verdict).toContainText('Signature valid in your browser: issued by did:web:127.0.0.1%3A5173#key-1 and not altered.');
    await expect(verdict).toContainText('Authentic');

    await box.getByRole('button', { name: 'Change one letter, check again' }).click();
    await expect(box.getByTestId('check-tampered')).toContainText('credentialSubject.advice.title.en');
    await expect(box.getByTestId('check-verdict')).toHaveAttribute('data-ok', 'false');
    await expect(box.getByTestId('step-signature')).toHaveAttribute('data-state', 'fail');
    await expect(box.getByTestId('check-verdict')).toContainText('One letter changed, and the signature no longer matches.');
    expect(errs).toEqual([]);
  });

  test('a receipt id the recordings do not have is not checked in sample mode, and says why', async ({ page }) => {
    await page.goto('/proof?sample=1');
    const box = page.getByTestId('check-yourself');
    await box.getByTestId('check-input').fill('http://127.0.0.1:5173/verify/urn:uuid:00000000-0000-4000-8000-000000000000');
    await box.getByRole('button', { name: 'Check in my browser' }).click();
    await expect(box.getByTestId('check-nocred')).toHaveText('Sample mode is on: only recorded receipts can be checked here.');
  });

  test('the architecture: every step is a button with its one-line explanation and file', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/proof?sample=1');
    const arch = page.getByTestId('architecture');
    await expect(arch.getByRole('button')).toHaveCount(16);
    await expect(arch.getByTestId('arch-signer')).toHaveAttribute('aria-pressed', 'true');
    await arch.getByTestId('arch-router').click();
    await expect(arch.getByTestId('arch-router')).toHaveAttribute('aria-pressed', 'true');
    const cap = page.getByTestId('arch-caption');
    await expect(cap).toContainText('Ask router');
    await expect(cap).toContainText('No model writes the answer');
    await expect(cap.getByRole('link', { name: 'services/ask/graph.py' })).toHaveAttribute('href', /github\.com\/krishiloop\/krishiloop\/blob\/.+\/services\/ask\/graph\.py$/);
    // the connectors are drawn (17 edges, each with a hairline and a pulse path)
    await expect(arch.locator('svg.pa-lines path.pa-base')).toHaveCount(17);
  });

  test('evaluations show the numbers, the honest labels and their files', async ({ page }) => {
    await page.goto('/proof?sample=1');
    const tiles = page.getByTestId('eval-tiles');
    await expect(tiles.locator('article')).toHaveCount(6);
    await expect(page.getByTestId('eval-v1')).toContainText('0.267');
    await expect(page.getByTestId('eval-v1')).toContainText('Bad result, kept');
    await expect(page.getByTestId('eval-ask')).toContainText('0.89');
    await expect(page.getByTestId('eval-ask')).toContainText('Synthetic');
    await expect(page.getByTestId('eval-trust')).toContainText('70–126'); // the 95% range over 200 random orders (earned_trust_ci.json), was 89–109 over 3
    await expect(page.getByTestId('eval-trust')).toContainText('Replay');
    await expect(page.getByTestId('eval-ask').getByRole('link', { name: 'ml/ask/eval_report.json' })).toHaveAttribute('href', /eval_report\.json$/);
    // the three results of 29 Oct, each with its report; the safety eval says it is not final
    await expect(page.getByTestId('eval-new').locator('article')).toHaveCount(4); // + AgriTriage-Lite (photo-ai.spec.ts)
    await expect(page.getByTestId('new-safety')).toContainText('Not final');
    await expect(page.getByTestId('new-speech')).toContainText('Not yet wired into the app');
    await expect(page.getByTestId('new-sovereign').getByRole('link', { name: 'ml/sovereign/REPORT.md' })).toHaveAttribute('href', /ml\/sovereign\/REPORT\.md$/);
  });

  test('standards, MCP servers, tests and the register', async ({ page }) => {
    await page.goto('/proof?sample=1');
    const std = page.getByTestId('standards');
    await expect(std.locator('li[data-state="implemented"]')).toHaveCount(6);
    await expect(std.locator('li[data-state="implemented"]').first()).toContainText('W3C Verifiable Credentials 2.0');
    await expect(std.locator('li[data-state="planned"]', { hasText: 'FAO AGROVOC' })).toHaveCount(1);
    const mcp = page.getByTestId('mcp-servers');
    await expect(mcp.locator('.pf-server')).toHaveCount(5);
    await expect(mcp.locator('.pf-tool')).toHaveCount(14);
    await expect(page.getByTestId('section-mcp').getByRole('heading', { level: 2 })).toHaveText('5 MCP servers, 14 tools, all read-only.');
    await expect(page.getByTestId('tests')).toContainText('176');
    await expect(page.getByRole('link', { name: 'Open GitHub Actions' })).toHaveAttribute('href', 'https://github.com/krishiloop/krishiloop/actions');
    await expect(page.getByTestId('register')).toContainText('permitted (not CC BY)');
  });

  test('a phone gets the four lanes, and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/proof?sample=1');
    const arch = page.getByTestId('architecture');
    await expect(arch.locator('ol.pm-lane')).toHaveCount(4);
    await arch.getByTestId('arch-gate').click();
    await expect(page.getByTestId('arch-caption')).toContainText('Area gate');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe, ${theme} theme, after a check`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/proof?sample=1&theme=${theme}`);
      await checkHero(page);
      await noSeriousAxe(page, `/proof ${theme}`);
    });
  }
});

test('/proof live smoke: the page renders and the recorded hero receipt still verifies in the browser', async ({ page }) => {
  const errs = errors(page);
  await page.goto('/proof');
  await expect(page.getByTestId('proof-title')).toBeVisible();
  await checkHero(page);
  expect(errs.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
