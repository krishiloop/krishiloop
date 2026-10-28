import { expect, test } from '@playwright/test';
import { mockApi } from './mockApi';
import { AREA, AREA_CRED, MODEL, PHOTO_FIELD, PHOTO_PROFILE, PHOTO_RECEIPT_ID, SID } from './trustMock';
import { wilsonLowerBound } from '../../src/features/trust/policy';
import { PHOTO_URL, bigPhoto, jpegSize, noOverflow, sendPhoto, withSession } from './trustHelpers';

/**
 * Earned trust for photo diagnosis, against the MOCKED API (tests/e2e/trustMock.ts): the farmer's photo on the server path
 * (officer route and automatic route with the photo practice), the officer's one-tap verdict and the gate event, the area
 * trust panel with its replay (and the 404 state), and the verifier for area credentials and withdrawn photo-informed advice.
 * The photo model is not installed on today's dev server, so these flows are the contract the UI is built against.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('kl.mode', 'lite'); // no WebGL needed
    } catch {
      /* ignore */
    }
  });
});

/* ------------------------------------------------------------------ the farmer */
test.describe('farmer: server photo check', () => {
  test('officer route: "not sure yet", the area meter, never the unverified guess', async ({ page }) => {
    const calls = await mockApi(page, { photo: { route: 'officer', sure: true } });
    await page.goto(PHOTO_URL);
    const card = page.getByTestId('photo-card');
    await expect(card).toHaveAttribute('data-path', 'area');
    await expect(page.getByTestId('area-take')).toBeVisible();
    await expect(page.getByTestId('area-privacy')).toContainText('sent to this server');
    // before any photo: the area's honest state
    await expect(page.getByTestId('area-meter')).toContainText('Gate closed');
    await expect(page.getByTestId('am-verdicts')).toHaveText('12');

    await sendPhoto(page, true);
    await expect(page.getByTestId('area-officer-title')).toHaveText('Not sure yet in your area. Sent to your officer.');
    await expect(card).toContainText('Your officer can see the photo');
    await expect(card).toContainText('Your plan for the week still comes from the weather and the rules');
    await expect(page.getByTestId('area-result')).toHaveAttribute('data-route', 'officer');
    await expect(page.getByTestId('area-meter')).toContainText('Gate closed');
    await expect(page.getByTestId('photo-case')).toContainText(/^pc-[0-9a-f]{16}$/);
    await expect(card).toContainText('you play the officer');

    // the unverified suggestion (blast, 91%) is the officer's to see: it is nowhere in the farmer's card
    const text = await card.innerText();
    expect(text).not.toMatch(/blast/i);
    expect(text).not.toMatch(/brown spot/i);
    expect(text).not.toMatch(/9[01]\s*%/);

    // what went over the wire: a JPEG of at most 1024 px, with the consent the farmer chose
    const i = calls.paths.indexOf(`POST /api/demo/${SID}/photo`);
    expect(i).toBeGreaterThan(-1);
    const body = calls.bodies[i] as { field_id: string; image_b64: string; consent: boolean };
    expect(body.field_id).toBe(PHOTO_FIELD);
    expect(body.consent).toBe(true);
    expect(body.image_b64.startsWith('/9j/')).toBe(true);
    const size = jpegSize(Buffer.from(body.image_b64, 'base64'));
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1024);
    expect(Math.max(size.width, size.height)).toBe(1024);
    expect(body.image_b64.length).toBeLessThan(4_000_000);
    // an officer-route photo does not touch the plan
    expect(calls.bodies.some((b) => 'photo_case_id' in b)).toBe(false);
    expect(calls.headers.every((h) => !('x-admin-token' in h))).toBe(true);
  });

  test('sharing off is the default and is said plainly: the officer gets the case without the photo', async ({ page }) => {
    const calls = await mockApi(page, { photo: { route: 'officer' } });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-take')).toBeVisible();
    await sendPhoto(page, false);
    await expect(page.getByTestId('area-officer-title')).toBeVisible();
    await expect(page.getByTestId('photo-card')).toContainText('without the photo');
    const body = calls.bodies[calls.paths.indexOf(`POST /api/demo/${SID}/photo`)] as { consent: boolean };
    expect(body.consent).toBe(false);
  });

  test('the consent switch explains itself before anything is sent', async ({ page }) => {
    await mockApi(page, { photo: { route: 'officer' } });
    await page.goto(PHOTO_URL);
    await page.getByTestId('area-photo-input').setInputFiles(await bigPhoto(page));
    await expect(page.getByTestId('area-consent-note')).toContainText('thrown away');
    await page.getByTestId('area-consent').check();
    await expect(page.getByTestId('area-consent-note')).toContainText('Your officer can look at the leaf');
    await expect(page.getByTestId('area-consent')).toBeChecked();
  });

  test('automatic route: "Looks like Blast", why it can be trusted here, then the plan with the receipted photo practice', async ({ page }) => {
    const calls = await mockApi(page, { photo: { route: 'auto' } });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-take')).toBeVisible();
    await expect(page.getByTestId('area-meter')).toContainText('Gate open');
    await sendPhoto(page, false);

    await expect(page.getByTestId('area-label')).toHaveText('Looks like Blast');
    const why = page.getByTestId('area-why');
    await expect(why).toBeVisible();
    await expect(page.getByTestId('why-checks')).toHaveText('41');
    await expect(page.getByTestId('why-precision')).toHaveText('97%');
    const lb = wilsonLowerBound(35, 36).toFixed(2);
    await expect(page.getByTestId('why-bound')).toContainText(lb);
    await expect(page.getByTestId('why-bound')).toContainText('bar 0.85');
    const verify = page.getByTestId('area-verify-link');
    await expect(verify).toHaveAttribute('href', `/verify/${encodeURIComponent(AREA_CRED)}`);

    // the plan is refreshed with the server's own case: the photo practice appears, with a receipt that names the trust it used
    const plan = page.getByTestId('area-plan');
    await expect(plan).toBeVisible();
    await expect(page.getByTestId('area-plan-badge')).toHaveText('From your photo');
    await expect(plan.getByTestId('receipt-pass').first()).toContainText('Your photo looks like blast');
    await expect(plan.getByTestId('pass-photo-trust').first()).toContainText(AREA);
    await expect(plan.getByTestId('pass-photo-trust-link').first()).toHaveAttribute('href', `/verify/${encodeURIComponent(AREA_CRED)}`);
    const k = calls.paths.map((p, n) => (p === `POST /api/demo/${SID}/plan` && 'photo_case_id' in calls.bodies[n]! ? n : -1)).find((n) => n >= 0)!;
    const planBody = calls.bodies[k] as { field_id: string; profile_id: string; photo_case_id: string };
    expect(planBody.photo_case_id).toMatch(/^pc-[0-9a-f]{16}$/);
    expect(planBody.field_id).toBe(PHOTO_FIELD);
    expect(planBody.profile_id).toBe(PHOTO_PROFILE);
    // an automatic answer keeps no photo on the server, so it is not offered to any officer
    const sent = calls.bodies[calls.paths.indexOf(`POST /api/demo/${SID}/photo`)] as { consent: boolean };
    expect(sent.consent).toBe(false);
  });

  test('automatic answer when the area credential was withdrawn in between: the photo is not used, and it says so', async ({ page }) => {
    await mockApi(page, { photo: { route: 'auto', area: 'open' } });
    // the gate closes between the photo and the plan
    await page.route(/\/api\/demo\/[0-9a-f]+\/plan$/, async (route) => {
      const body = route.request().postDataJSON() as { photo_case_id?: string };
      if (!body.photo_case_id) return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan_id: 'x', pack_id: 'pack-bd-rice', field_id: PHOTO_FIELD, farmer_profile_id: PHOTO_PROFILE, status: 'ok', crop: 'rice', stage: 'tillering', valid_from: '2026-10-28', valid_to: '2026-11-03', generated_at: new Date().toISOString(), snapshot_id: 'snap-live-1', actions: [], diagnosis_used: false, diagnosis_note: 'uncalibrated' }) });
    });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-take')).toBeVisible();
    await sendPhoto(page, false);
    await expect(page.getByTestId('area-label')).toHaveText('Looks like Blast');
    await expect(page.getByTestId('area-plan')).toHaveAttribute('data-state', 'withdrawn');
    await expect(page.getByTestId('area-plan')).toContainText('your photo was not used');
  });

  test('errors are calm: an unreadable photo and too many photos', async ({ page }) => {
    await mockApi(page, { photo: { route: 'officer', photoError: 422 } });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-take')).toBeVisible();
    await sendPhoto(page, false);
    await expect(page.getByTestId('area-error')).toHaveAttribute('data-error', 'unreadable');
    await expect(page.getByTestId('area-error')).toContainText('We could not read that photo');
  });

  test('too many photos in a minute: a calm message, and the photo can be sent again', async ({ page }) => {
    await mockApi(page, { photo: { route: 'officer', photoError: 429 } });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-take')).toBeVisible();
    await sendPhoto(page, false);
    await expect(page.getByTestId('area-error')).toHaveAttribute('data-error', 'rate');
    await expect(page.getByTestId('area-error')).toContainText('Wait a minute');
    await expect(page.getByTestId('area-composer')).toBeVisible(); // the photo is still there to send again
  });

  test('a server without the photo model: a calm note, and the on-device flow stays', async ({ page }) => {
    await mockApi(page, { photo: { unavailable: true } });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-unavailable')).toBeVisible();
    await expect(page.getByTestId('area-unavailable')).toContainText('not available on this server');
    await expect(page.getByTestId('area-unavailable')).toContainText('photo stays on your phone');
    const card = page.getByTestId('photo-card');
    await expect(card).not.toHaveAttribute('data-path', 'area');
    await expect(page.getByTestId('photo-privacy')).toContainText('never uploaded'); // the on-device promise, unchanged
    await expect(page.getByTestId('area-take')).toHaveCount(0);
  });

  test('the on-device check can be chosen instead, and the way back is there', async ({ page }) => {
    await mockApi(page, { photo: { route: 'officer' } });
    await page.goto(PHOTO_URL);
    await expect(page.getByTestId('area-use-device')).toBeVisible();
    await page.getByTestId('area-use-device').click();
    await expect(page.getByTestId('photo-privacy')).toContainText('never uploaded');
    await page.getByTestId('device-use-area').click();
    await expect(page.getByTestId('area-take')).toBeVisible();
  });
});

/* ------------------------------------------------------------------ the officer */
test.describe('officer: photo cases', () => {
  test('one tap answers, the frozen suggestion is judged, the evidence moves and the gate opens', async ({ page }) => {
    await withSession(page);
    const calls = await mockApi(page, { photo: { area: 'one-away', route: 'officer', cases: [{}] } });
    await page.goto('/officer?mode=lite');
    const row = page.locator('[data-testid=case-row][data-kind=photo]');
    await expect(row).toHaveCount(1);
    await expect(page.getByTestId('area-strip-chip')).toContainText('Gate closed');
    await row.click();

    await expect(page.getByTestId('photo-case-detail')).toBeVisible();
    await expect(page.getByTestId('officer-role')).toHaveText(/You play the officer/);
    await expect(page.getByTestId('pc-demo-note')).toContainText('you are the officer');
    await expect(page.getByTestId('pc-photo-img')).toBeVisible();
    // the frozen top-2 as two big buttons, and the rest behind "something else"
    await expect(page.getByTestId('pc-choice-blast')).toContainText('Blast');
    await expect(page.getByTestId('pc-choice-blast')).toContainText('91%');
    await expect(page.getByTestId('pc-choice-blast')).toContainText('sure');
    await expect(page.getByTestId('pc-choice-brown_spot')).toContainText('5%');
    await expect(page.getByTestId('pc-choice-tungro')).toHaveCount(0);
    await page.getByTestId('pc-else').click();
    for (const l of ['healthy', 'tungro', 'sheath_blight']) await expect(page.getByTestId(`pc-choice-${l}`)).toBeVisible();
    await expect(page.getByTestId('pc-others')).toContainText('Sheath blight');
    // before the answer: 29 of the 30 sure answers the gate needs
    await expect(page.getByTestId('am-sure')).toContainText('29 of 30');
    await expect(page.getByTestId('am-gate')).toContainText('Gate closed');

    await page.getByTestId('pc-choice-blast').click();
    await expect(page.getByTestId('pc-review-result')).toHaveText('The suggestion was right');
    await expect(page.getByTestId('pc-verdict'), 'the keyboard lands on what the answer did').toBeFocused();
    await expect(page.getByTestId('pc-review')).toContainText('That was saved before you answered');
    await expect(page.getByTestId('pc-review-counts')).toContainText('counts toward the gate');
    // the moment: trust earned, with a way to verify the credential
    const moment = page.getByTestId('gate-moment');
    await expect(moment).toBeVisible();
    await expect(page.getByTestId('gate-moment-title')).toHaveText(`Trust earned in ${AREA}`);
    await expect(page.getByTestId('gate-moment-verify')).toHaveAttribute('href', `/verify/${encodeURIComponent(AREA_CRED)}`);
    // the evidence moved: 33 -> 34 answers, 29 -> 30 sure answers, and the gate is open
    await expect(page.getByTestId('pc-moves')).toContainText('33');
    await expect(page.getByTestId('pc-moves')).toContainText('34');
    await expect(page.getByTestId('am-sure')).toContainText('30 of 30');
    await expect(page.getByTestId('am-gate')).toContainText('Gate open');
    await expect(page.getByTestId('pc-status')).toHaveText(/Resolved/);
    // the photo is deleted at the verdict, the case stays in the list as resolved
    await expect(page.getByTestId('pc-photo-empty')).toContainText('deleted');
    const i = calls.paths.findIndex((p) => /POST \/api\/demo\/[0-9a-f]+\/photo\/pc-[0-9a-f]+\/verdict/.test(p));
    expect((calls.bodies[i] as { label: string }).label).toBe('blast');
    expect(calls.paths.some((p) => p.includes('/photo/') && p.includes('/image'))).toBe(true);
  });

  test('a wrong guess is shown as wrong, and when the second guess was right it says so', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'fresh', route: 'officer', cases: [{}, {}] } });
    await page.goto('/officer?mode=lite');
    await page.locator('[data-testid=case-row][data-kind=photo]').first().click();
    await page.getByTestId('pc-choice-brown_spot').click();
    await expect(page.getByTestId('pc-review-result')).toHaveText('The suggestion was wrong, but its second guess was right');
    await expect(page.getByTestId('gate-moment')).toHaveCount(0);
    // the next open case is one tap away
    await page.getByTestId('pc-next').click();
    await expect(page.getByTestId('pc-status')).toHaveText(/Open/);
    await page.getByTestId('pc-else').click();
    await page.getByTestId('pc-choice-tungro').click();
    await expect(page.getByTestId('pc-review-result')).toHaveText('The suggestion was wrong');
  });

  test('a not-sure suggestion does not count toward the gate, and the page says so', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'fresh', route: 'officer', sure: false, cases: [{}] } });
    await page.goto('/officer?mode=lite');
    await page.locator('[data-testid=case-row][data-kind=photo]').click();
    await expect(page.getByTestId('pc-choice-blast')).toContainText('not sure');
    await page.getByTestId('pc-choice-blast').click();
    await expect(page.getByTestId('pc-review-counts')).toContainText('does not count toward the gate');
    await expect(page.getByTestId('am-sure')).toContainText('8 of 30');
  });

  test('drift: a wrong sure answer drops the bound under 0.80, trust is withdrawn, and advice that relied on it is withdrawn', async ({ page }) => {
    await withSession(page);
    const calls = await mockApi(page, { photo: { area: 'drifting', route: 'officer', cases: [{}] } });
    await page.goto('/officer?mode=lite');
    await expect(page.getByTestId('area-strip-chip')).toContainText('Gate open');
    await page.locator('[data-testid=case-row][data-kind=photo]').click();
    await page.getByTestId('pc-else').click();
    await page.getByTestId('pc-choice-tungro').click();
    await expect(page.getByTestId('gate-moment')).toHaveAttribute('data-event', 'closed');
    await expect(page.getByTestId('gate-moment-title')).toHaveText(`Trust withdrawn in ${AREA}`);
    await expect(page.getByTestId('gate-moment')).toContainText('advice that relied on it now shows as withdrawn');
    await expect(page.getByTestId('am-gate')).toContainText('Gate closed');
    expect(calls.photo.state.open).toBe(false);
    // the photo-informed receipt now verifies as withdrawn (not as a rule recall)
    await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite`);
    await expect(page.getByTestId('verdict-word')).toHaveText('Withdrawn');
  });

  test('the officer page links to the area trust panel', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'fresh', cases: [{}] } });
    await page.goto('/officer?mode=lite');
    await page.getByTestId('officer-trust-link').click();
    await expect(page).toHaveURL(/\/trust$/);
    await expect(page.getByTestId('trust-title')).toBeVisible();
  });

  test('a server without the photo model says so calmly', async ({ page }) => {
    await withSession(page);
    await mockApi(page);
    await page.goto('/officer?mode=lite');
    await expect(page.getByTestId('photo-cases-unavailable')).toContainText('not installed here');
  });
});

/* ------------------------------------------------------------------ the area trust panel */
test.describe('area trust panel', () => {
  test('a replay of public datasets: plainly labelled, the bar, the moment the gate opened, and what came after', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { replay: 'ready', area: 'fresh' } });
    await page.goto('/trust?mode=lite');
    await expect(page.getByTestId('trust-title')).toHaveText('A photo check earns trust one area at a time');
    await expect(page.getByTestId('replay-label')).toHaveText('Replay of public datasets: the dataset’s labels stand in for officers. Not real officers, not real farms.');
    await expect(page.getByTestId('replay-sample')).toHaveCount(0);

    // the area with the most automatic answers is where it starts
    await expect(page.getByTestId('replay-panel')).toHaveAttribute('data-area', 'BD-D');
    await expect(page.getByTestId('replay-dataset')).toHaveText('RiceLeafDisease-BD5 (Savar) · CC BY 4.0, Mendeley Data');
    await expect(page.getByTestId('replay-chart')).toBeVisible();
    await expect(page.getByTestId('replay-bar')).toBeAttached();
    await expect(page.getByTestId('replay-bar')).toHaveCSS('stroke-dasharray', /6/);
    await expect(page.getByTestId('replay-curve')).toBeAttached();
    await expect(page.getByTestId('replay-open-band')).toHaveCount(1);
    await expect(page.getByTestId('replay-uncounted')).toHaveCount(1);
    await expect(page.getByTestId('replay-open-marker')).toContainText('Gate opens after 74 answers');
    await expect(page.getByTestId('replay-chart')).toHaveAttribute('data-open-at', '74');
    await expect(page.getByTestId('replay-close-marker')).toHaveCount(0);

    // after it opened: X% of photos answered automatically, Y% of those right
    await page.getByTestId('replay-stats').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('replay-stat-auto')).toContainText('80%');
    await expect(page.getByTestId('replay-stat-right')).toContainText('97.5%');
    await expect(page.getByTestId('replay-stat-opened')).toContainText('74');
    await expect(page.getByTestId('replay-auto-line')).toHaveText('80% of photos answered automatically, 97.5% of those right.');

    // the cursor reads the same numbers the chart draws
    await expect(page.getByTestId('replay-readout')).toContainText('After 170 officer answers (1,000 photos)');
    await expect(page.getByTestId('replay-readout')).toContainText('800 answered automatically, 780 of them right');
    await page.getByTestId('replay-range').fill('0');
    await expect(page.getByTestId('replay-readout')).toContainText('After 1 officer answers');
    await expect(page.getByTestId('replay-readout')).toContainText('does not count yet');

    // the suggestion helps before the gate opens
    await page.getByTestId('replay-stages').locator('summary').click();
    await expect(page.getByTestId('replay-stages')).toContainText('first guess right');

    // another area: the same model, a place where it never earned trust
    await page.getByTestId('replay-area-BD-A').click();
    await expect(page.getByTestId('replay-panel')).toHaveAttribute('data-area', 'BD-A');
    await expect(page.getByTestId('replay-never')).toContainText('The gate never opened here');
    await expect(page.getByTestId('replay-open-marker')).toHaveCount(0);
    await expect(page.getByTestId('replay-open-band')).toHaveCount(0);

    // the live meter of this session, below
    await expect(page.getByTestId('live-panel').getByTestId('area-meter')).toContainText(AREA);
    await expect(page.getByTestId('live-panel').getByTestId('am-gate')).toContainText('Gate closed');
    await expect(page.getByTestId('live-panel').getByTestId('am-verdicts')).toHaveText('12');
    await expect(page.getByTestId('bar-table')).toBeAttached();
    const bar = (await page.getByTestId('bar-table').textContent()) ?? '';
    expect(bar).toContain('30 sure answers: at least 30 right');
    expect(bar).toContain('50 sure answers: at least 48 right');
  });

  test('the replay file is not there yet (404): a calm state, and the live meter still works', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { replay: 'missing', area: 'fresh' } });
    await page.goto('/trust?mode=lite');
    await expect(page.getByTestId('replay-missing')).toContainText('No replay on this server yet');
    await expect(page.getByTestId('replay-chart')).toHaveCount(0);
    await expect(page.getByTestId('live-panel').getByTestId('area-meter')).toBeVisible();
  });

  test('a server without the photo model: no live meter, said calmly', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { unavailable: true, replay: 'ready' } });
    await page.goto('/trust?mode=lite');
    await expect(page.getByTestId('live-unavailable')).toContainText('no photo model installed');
    await expect(page.getByTestId('replay-chart')).toBeVisible();
  });

  test('no session yet: the page does not create one, and says why there is no live meter', async ({ page }) => {
    const calls = await mockApi(page, { photo: { replay: 'ready' } });
    await page.goto('/trust?mode=lite');
    await expect(page.getByTestId('live-nosession')).toBeVisible();
    expect(calls.paths.includes('POST /api/demo/session')).toBe(false);
  });

  test('sample data is on: the invented curves are labelled "Sample" and nothing is asked of the server', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/trust?sample=1&mode=lite');
    await expect(page.getByTestId('replay-sample')).toContainText('invented curves');
    await expect(page.getByTestId('replay-label')).toBeVisible();
    await expect(page.getByTestId('replay-chart')).toBeVisible();
    expect(calls.paths.some((p) => p.includes('/api/replay/'))).toBe(false);
  });

  test('a closing is drawn too, with the cross and the note about drift', async ({ page }) => {
    await mockApi(page);
    await page.goto('/trust?sample=1&mode=lite');
    await page.getByTestId('replay-area-BD-E').click();
    await expect(page.getByTestId('replay-close-marker').first()).toBeVisible();
    await expect(page.getByTestId('replay-closings')).toContainText('The gate closed');
    await expect(page.getByTestId('replay-close-line')).toBeAttached();
  });

  test('reduced motion: the play button is gone, numbers are final at once, and nothing needs to move', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('kl.mode', 'lite'));
    await withSession(page);
    await mockApi(page, { photo: { replay: 'ready', area: 'fresh' } });
    await page.goto('/trust?mode=lite');
    await expect(page.getByTestId('replay-chart')).toBeVisible();
    await expect(page.getByTestId('replay-play')).toHaveCount(0);
    await expect(page.getByTestId('replay-stat-auto')).toContainText('80%');
    const seconds = await page.getByTestId('replay-curve').evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(seconds, 'the curve is drawn at once').toBeLessThan(0.001);
    await ctx.close();
  });

  test('the landing page proof section links to it', async ({ page }) => {
    await mockApi(page);
    await page.goto('/?mode=lite');
    const link = page.getByTestId('prove-trust-link');
    await link.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('prove-trust')).toContainText('Photo answers earn their receipts too');
    await link.click();
    await expect(page).toHaveURL(/\/trust$/);
  });
});

/* ------------------------------------------------------------------ the verifier */
test.describe('verifier: earned photo trust', () => {
  test('an area trust credential: authentic while the gate stands', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'open' } });
    await page.goto(`/verify/${AREA_CRED.replace('urn:uuid:', '')}?mode=lite`);
    await expect(page.getByTestId('verdict-word')).toHaveText('Authentic');
    await expect(page.getByTestId('verdict-line')).toHaveText(`This photo check had earned trust in ${AREA}.`);
    await expect(page.getByTestId('area-ticket-area')).toHaveText(AREA);
    await expect(page.getByTestId('area-details')).toContainText(MODEL);
    await expect(page.getByTestId('area-d-bound')).toContainText('against a bar of 0.85');
    expect(await page.locator('body').innerText()).not.toMatch(/\bcorrect\b/i);
  });

  test('an area trust credential: withdrawn once the gate closed', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'open', withdrawn: true } });
    await page.goto(`/verify/${AREA_CRED.replace('urn:uuid:', '')}?mode=lite`);
    await expect(page.getByTestId('verdict-word')).toHaveText('Withdrawn');
    await expect(page.getByTestId('verdict-line')).toHaveText(`Photo trust in ${AREA} was withdrawn.`);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'recalled');
    await expect(page.getByTestId('area-ticket')).toHaveAttribute('data-status', 'recalled');
    await expect(page.getByTestId('verdict')).toContainText('Photos in this area go to the officer again');
  });

  test('advice whose photo trust was withdrawn: "the photo trust this advice used was withdrawn", not a rule recall', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'open', withdrawn: true } });
    await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite`);
    await expect(page.getByTestId('verdict-word')).toHaveText('Withdrawn');
    await expect(page.getByTestId('verdict-line')).toHaveText('The photo trust this advice used was withdrawn.');
    await expect(page.getByTestId('photo-withdrawn-note')).toContainText(`Officers’ recent answers in ${AREA}`);
    await expect(page.getByTestId('photo-withdrawn-entry')).toContainText(`photo trust for ${MODEL} in ${AREA}`);
    const text = await page.getByTestId('verdict').innerText();
    expect(text).not.toMatch(/rule\(s\) withdrawn/i);
    expect(text).not.toMatch(/\brules?\b/i); // it is photo trust that was withdrawn, not a rule
    expect(text).not.toMatch(/Recalled/i);
    await expect(page.getByTestId('photo-withdrawn-link')).toHaveAttribute('href', `/verify/${encodeURIComponent(AREA_CRED)}`);
    // what people are told is about the photo trust, not a rule
    await expect(page.getByTestId('notification-preview')).toContainText('photo check behind the advice');
    await expect(page.getByTestId('receipt-photo-trust')).toContainText(AREA);
    // the stamp says it as well
    await expect(page.locator('.stamp-text')).toHaveText('WITHDRAWN');
  });

  test('advice that used photo trust that still stands: authentic, with the trust it relied on', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'open' } });
    await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite`);
    await expect(page.getByTestId('verdict-word')).toHaveText('Authentic');
    await expect(page.getByTestId('receipt-photo-trust')).toContainText('had earned trust in rice@BD');
    await expect(page.getByTestId('receipt-photo-trust-link')).toHaveAttribute('href', `/verify/${encodeURIComponent(AREA_CRED)}`);
    // the reading is named for what it is: the server's photo check, not "on-device"
    await expect(page.getByTestId('receipt-details')).toContainText('Server photo check');
    await expect(page.getByTestId('receipt-details')).not.toContainText('on-device-model');
  });
});

/* ------------------------------------------------------------------ Bangla at phone width */
test.describe('Bangla at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the area trust panel with a replay is Bangla and fits', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { replay: 'ready', area: 'fresh' } });
    await page.goto('/trust?mode=lite&lang=bn');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.getByTestId('replay-chart')).toBeVisible();
    await page.waitForTimeout(1200);
    await noOverflow(page);
    const text = await page.locator('main').innerText();
    expect(text).toMatch(/পাবলিক ডেটাসেটের রিপ্লে/);
    expect(text).not.toMatch(/\b(trust|verify|officer|photo)\.[a-z_.]+\b/);
  });

  test('the farmer card, the officer case and the verifier are Bangla and fit', async ({ page }) => {
    await withSession(page);
    await mockApi(page, { photo: { area: 'one-away', route: 'officer', cases: [{}] } });
    await page.goto(`/app?field=${PHOTO_FIELD}&profile=${PHOTO_PROFILE}&mode=lite&lang=bn#photo`);
    await expect(page.getByTestId('area-take')).toBeVisible();
    await noOverflow(page);
    await sendPhoto(page, true);
    await expect(page.getByTestId('area-officer-title')).toContainText('অফিসারের কাছে পাঠানো হয়েছে');
    await noOverflow(page);
    await page.goto('/officer?mode=lite&lang=bn');
    await page.locator('[data-testid=case-row][data-kind=photo]').first().click();
    await expect(page.getByTestId('pc-choice-blast')).toContainText('ব্লাস্ট');
    await noOverflow(page);
    await page.getByTestId('pc-choice-blast').click();
    await expect(page.getByTestId('pc-review-result')).toBeVisible();
    await noOverflow(page);
    await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite&lang=bn`);
    await expect(page.getByTestId('verdict-word')).toBeVisible();
    await page.waitForTimeout(1500);
    await noOverflow(page);
  });
});
