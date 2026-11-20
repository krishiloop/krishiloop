import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

/**
 * The receipt verifier (/verify, /verify/:id).
 *  - recorded mode (?sample=1, or any recorded receipt id): deterministic, the real answers our server gave on 2 Nov;
 *  - mocked live answers (page.route on /api/verify) for the verdicts a recording cannot show: recalled, expired,
 *    cannot verify, unreachable, area trust credentials and advice whose photo trust was withdrawn;
 *  - one live smoke against the local API (skipped when it is not running).
 * Every page is checked with axe: no serious or critical violations.
 */

// The dev server is shared with other builders: a Vite full reload (HMR) mid-test is environmental, so one retry.
test.describe.configure({ retries: 1 });

const HERO = '84942e4a-2ce9-4497-92ca-11f478f9e259'; // the story's "no spray needed" receipt (recorded)
const recorded = JSON.parse(readFileSync(new URL('../../src/data/recorded/verify-before.json', import.meta.url), 'utf8')) as Record<string, { credential: Record<string, unknown> }>;
const did = JSON.parse(readFileSync(new URL('../../src/data/recorded/did.json', import.meta.url), 'utf8'));

/** A recorded signed credential under a new id (not a recorded id), so the app treats the mocked answer as live. */
function liveCredential(id: string, patch: (subject: Record<string, unknown>) => Record<string, unknown> = (s) => s) {
  const base = structuredClone(recorded[`urn:uuid:${HERO}`]!.credential) as Record<string, unknown> & { credentialSubject: Record<string, unknown> };
  return { ...base, id: `urn:uuid:${id}`, credentialSubject: patch(base.credentialSubject) };
}

/** axe once every entrance animation has finished (a half-faded element would read as low contrast). */
async function axeOk(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getTiming().iterations ?? 1) === Infinity));
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answer GET /api/verify/<id> with `answer` (and the issuer key with the recorded DID). */
async function mockVerify(page: Page, answers: Record<string, unknown>) {
  await page.route((u) => u.pathname.startsWith('/api/verify/'), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '').replace(/^urn:uuid:/, '');
    const a = answers[id];
    return a ? json(route, a) : json(route, { status: 'invalid', reason: 'unknown credential' });
  });
  await page.route((u) => u.pathname === '/.well-known/did.json', (route) => json(route, did));
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

/* ------------------------------------------------------------------ /verify */
test.describe('entry', () => {
  test('paste, check, the four answers, and a recorded receipt one tap away', async ({ page }) => {
    await page.goto('/verify?sample=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Is this receipt real?' })).toBeVisible();
    const legend = page.getByTestId('vf-legend');
    for (const word of ['Authentic', 'Recalled', 'Expired', 'Cannot verify']) await expect(legend).toContainText(word);
    // not a receipt id: said plainly, nothing is fetched
    await page.getByLabel('Receipt link or number').fill('hello');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('alert')).toContainText('That is not a receipt link');
    await expect(page).toHaveURL(/\/verify\?sample=1$/);
    // a full link from any host works
    await page.getByLabel('Receipt link or number').fill(`https://krishiloop.example/verify/${HERO}?utm=qr`);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page).toHaveURL(new RegExp(`/verify/${HERO}$`));
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
    // the recent list remembers it (this browser only)
    await page.goto('/verify?sample=1');
    await expect(page.getByTestId('vf-recent')).toContainText('No spray needed now');
    await page.getByTestId('vf-try').click();
    await expect(page).toHaveURL(new RegExp(`/verify/${HERO}`));
    await expect(page.getByTestId('verdict-line')).toHaveText('This advice is real and unchanged.');
  });

  test('camera scanning is offered only where the browser can read QR codes, and says so otherwise', async ({ page }) => {
    await page.goto('/verify?sample=1');
    // desktop Chrome on this machine has no BarcodeDetector: the button is hidden, with one line instead
    const hasDetector = await page.evaluate(() => 'BarcodeDetector' in window);
    if (hasDetector) await expect(page.getByTestId('vf-scan')).toBeVisible();
    else {
      await expect(page.getByTestId('vf-scan')).toHaveCount(0);
      await expect(page.getByTestId('vf-noscan')).toContainText('cannot read QR codes');
    }
  });

  test('axe: the entry page', async ({ page }) => {
    await page.goto('/verify?sample=1');
    await expect(page.getByTestId('vf-legend')).toBeVisible();
    await axeOk(page);
  });
});

/* ------------------------------------------------------------------ recorded verdicts */
test.describe('recorded receipt', () => {
  test('authentic: the stamp, what it means (never "correct"), and the receipt as a document', async ({ page }) => {
    await page.goto(`/verify/${HERO}?sample=1`);
    await expect(page.getByTestId('checking')).toBeVisible();
    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveAttribute('data-status', 'authentic');
    await expect(verdict.locator('.stamp')).toContainText('Authentic');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This advice is real and unchanged.');
    await expect(verdict).toContainText('Real does not mean it fits every field');
    await expect(verdict).toContainText('Saved 2 Nov');
    await expect(page.getByTestId('note-sandbox')).toContainText('practice copy');
    // the document: sources with quotes, readings, numbers people set, confidence, signature, timeline
    await expect(page.getByTestId('doc-sources')).toContainText('Bangladesh Rice Research Institute');
    await expect(page.getByTestId('doc-params')).toContainText('not from the source');
    await expect(page.getByTestId('doc-signature')).toContainText('eddsa-jcs-2022');
    await expect(page.getByTestId('doc-signature')).toContainText('did:web:');
    await expect(page.getByTestId('doc-timeline')).toContainText('Issued and signed');
    await expect(page.getByTestId('doc-timeline')).toContainText('Valid for the week');
    const more = page.getByTestId('doc-confidence').getByRole('button', { name: 'Show more' });
    await more.click();
    await expect(page.locator('#vf-conf-basis')).toBeVisible();
    // the in-browser signature check finishes (valid with the recorded issuer key, or plainly "not in this build")
    await expect(page.getByTestId('local-check')).not.toHaveAttribute('data-state', 'checking');
    const state = await page.getByTestId('local-check').getAttribute('data-state');
    if (state === 'ok') await expect(page.getByTestId('local-check')).toContainText('valid (Ed25519, eddsa-jcs-2022)');
    else expect(state).toBe('unavailable');
    expect(await page.locator('main').innerText()).not.toMatch(/\bcorrect\b/i);
  });

  test('copy link, download the signed JSON, check again', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
    await page.goto(`/verify/${HERO}?sample=1`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/verify/${HERO}$`));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download signed JSON' }).click()]);
    expect(dl.suggestedFilename()).toBe('krishiloop-84942e4a.json');
    const saved = JSON.parse(readFileSync((await dl.path())!, 'utf8')) as { id: string; proof: { cryptosuite: string } };
    expect(saved.id).toBe(`urn:uuid:${HERO}`);
    expect(saved.proof.cryptosuite).toBe('eddsa-jcs-2022');
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
  });

  test('Bangla, at phone width, fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/verify/${HERO}?sample=1&lang=bn`);
    await expect(page.getByTestId('verdict-line')).toHaveText('এই পরামর্শ আসল, কিছু বদলানো হয়নি।');
    await expect(page.getByTestId('receipt-doc')).toBeVisible();
    await noOverflow(page);
  });

  test('axe: a verdict and its document, light and dark', async ({ page }) => {
    await page.goto(`/verify/${HERO}?sample=1`);
    await expect(page.getByTestId('local-check')).not.toHaveAttribute('data-state', 'checking');
    await axeOk(page);
    await page.goto(`/verify/${HERO}?sample=1&theme=dark`);
    await expect(page.getByTestId('local-check')).not.toHaveAttribute('data-state', 'checking');
    await axeOk(page);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the verdict is there at once, and nothing travels', async ({ page }) => {
    await page.goto(`/verify/${HERO}?sample=1`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic', { timeout: 3000 });
    const anim = await page.locator('.vf-stamp').evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('vf-fade');
  });
});

/* ------------------------------------------------------------------ verdicts a recording cannot show (mocked answers) */
test.describe('other verdicts', () => {
  const ID = '22222222-3333-4444-8555-666666666666';

  test('recalled: which rule was withdrawn and what to do now', async ({ page }) => {
    await mockVerify(page, { [ID]: { status: 'recalled', reason: 'rule(s) withdrawn: R-BDR-002 v1', rules: ['R-BDR-002 v1'], credential: liveCredential(ID), sandbox: true, status_list: 'http://127.0.0.1:5173/status/demo-x' } });
    await page.goto(`/verify/${ID}`);
    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveAttribute('data-status', 'recalled');
    await expect(verdict.locator('.stamp')).toContainText('Recalled');
    await expect(page.getByTestId('verdict-line')).toHaveText(/^This advice was taken back( on .+)?\. Do not follow it\.$/);
    await expect(page.getByTestId('withdrawn-rules')).toContainText('R-BDR-002 v1');
    await expect(verdict).toContainText('Ask your officer');
    await expect(page.getByTestId('doc-timeline')).toContainText('Recalled: R-BDR-002 v1');
    await axeOk(page);
  });

  test('expired: genuine, but for an earlier week', async ({ page }) => {
    await mockVerify(page, { [ID]: { status: 'authentic', reason: 'issued by KrishiLoop and unaltered', expired: true, credential: liveCredential(ID), sandbox: true } });
    await page.goto(`/verify/${ID}`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'expired');
    await expect(page.getByTestId('verdict').locator('.stamp')).toContainText('Expired');
    await expect(page.getByTestId('verdict-line')).toHaveText('This advice is real, but it was for an earlier week.');
  });

  test('cannot verify: an id KrishiLoop never issued', async ({ page }) => {
    await mockVerify(page, {});
    await page.goto(`/verify/${ID}`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'invalid');
    await expect(page.getByTestId('verdict-line')).toHaveText('We could not check this receipt.');
    await expect(page.getByTestId('verdict')).toContainText('We have no receipt with this number');
    await expect(page.getByTestId('no-doc')).toContainText('unknown credential');
    await axeOk(page);
  });

  test('unreachable: says nothing about the receipt, and no stamp is pressed', async ({ page }) => {
    await page.route((u) => u.pathname.startsWith('/api/verify/'), (route) => route.fulfill({ status: 502, body: 'Bad gateway' }));
    await page.goto(`/verify/${ID}`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'unreachable');
    await expect(page.getByTestId('verdict-line')).toHaveText('We could not reach the checker.');
    await expect(page.getByTestId('verdict')).toContainText('This says nothing about the receipt');
    await expect(page.getByTestId('verdict').locator('.stamp')).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ earned photo trust (re-covers the old trust spec) */
test.describe('earned photo trust', () => {
  const AREA_CRED = 'aaaaaaaa-1111-4222-8333-444444444444';
  const PHOTO_RECEIPT = '77777777-2222-4333-8444-555555555555';
  const now = new Date().toISOString();
  const areaCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `urn:uuid:${AREA_CRED}`,
    type: ['VerifiableCredential', 'AreaTrustCredential'],
    issuer: 'did:web:127.0.0.1%3A5173',
    validFrom: now,
    credentialSubject: { area: 'rice@BD', model: 'bioclip2@1', policy_id: 'photo-trust', policy_version: 1, verdicts: 34, sure_in_window: 30, sure_right_in_window: 30, precision: 1, lower_bound: 0.8865, opened_at: now },
    credentialStatus: { id: 'http://127.0.0.1:5173/status/demo-x#7', type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '7', statusListCredential: 'http://127.0.0.1:5173/status/demo-x' },
    proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: now, verificationMethod: 'did:web:127.0.0.1%3A5173#key-1', proofPurpose: 'assertionMethod', proofValue: 'zFixture' },
  };

  test('an area trust credential while the gate stands', async ({ page }) => {
    await mockVerify(page, { [AREA_CRED]: { status: 'authentic', reason: 'issued by KrishiLoop and unaltered', credential: areaCredential, sandbox: true } });
    await page.goto(`/verify/${AREA_CRED}`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
    await expect(page.getByTestId('verdict-line')).toHaveText('Officers had checked the photo AI in rice@BD, and it passed.');
    await expect(page.getByTestId('area-ticket-area')).toHaveText('rice@BD');
    await expect(page.getByTestId('area-details')).toContainText('30 right of 30');
    await expect(page.getByTestId('area-d-bound')).toContainText('against a bar of 0.85');
    await expect(page.getByTestId('doc-signature')).toContainText('index 7');
    await axeOk(page);
  });

  test('an area trust credential after the gate closed', async ({ page }) => {
    await mockVerify(page, { [AREA_CRED]: { status: 'recalled', reason: 'withdrawn', rules: [], credential: areaCredential, sandbox: true } });
    await page.goto(`/verify/${AREA_CRED}`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'recalled');
    await expect(page.getByTestId('verdict-line')).toHaveText('The photo AI in rice@BD was stopped.');
    await expect(page.getByTestId('verdict')).toContainText('Photos in this area go to the officer again');
  });

  test('advice whose photo trust was withdrawn says so, not a rule recall', async ({ page }) => {
    const cred = liveCredential(PHOTO_RECEIPT, (s) => ({ ...s, area_trust_ref: { credential_id: `urn:uuid:${AREA_CRED}`, area: 'rice@BD', model: 'bioclip2@1' } }));
    await mockVerify(page, { [PHOTO_RECEIPT]: { status: 'recalled', reason: 'withdrawn: photo trust for bioclip2@1 in rice@BD', rules: ['photo trust for bioclip2@1 in rice@BD'], credential: cred, sandbox: true } });
    await page.goto(`/verify/${PHOTO_RECEIPT}`);
    await expect(page.getByTestId('verdict-line')).toHaveText('The photo AI this advice used was stopped.');
    await expect(page.getByTestId('photo-withdrawn-entry')).toContainText('photo trust for bioclip2@1 in rice@BD');
    await expect(page.getByTestId('receipt-photo-trust')).toContainText('rice@BD');
    await expect(page.getByTestId('receipt-photo-trust-link')).toHaveAttribute('href', `/verify/${AREA_CRED}`);
  });
});

/* ------------------------------------------------------------------ live smoke (the local API) */
test('live: a receipt made in a sandbox right now verifies as authentic', async ({ page, request }) => {
  const demo = await request.get('/api/demo').catch(() => null);
  test.skip(!demo || !demo.ok(), 'the local API is not running');
  const { session_id: sid } = (await (await request.post('/api/demo/session')).json()) as { session_id: string };
  const plan = (await (await request.post(`/api/demo/${sid}/plan`, { data: { field_id: 'BD-SAMPLE-02', profile_id: 'demo-farmer-d' } })).json()) as { actions: { receipt_credential_id: string }[] };
  const id = plan.actions[0]!.receipt_credential_id.replace(/^urn:uuid:/, '');
  await page.goto(`/verify/${id}`);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
  await expect(page.getByTestId('note-sandbox')).toBeVisible();
  await expect(page.getByTestId('verdict')).not.toContainText('Saved');
  await expect(page.getByTestId('local-check')).not.toHaveAttribute('data-state', 'checking');
});
