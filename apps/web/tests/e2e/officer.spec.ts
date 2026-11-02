import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { wilsonLowerBound } from '../../src/features/trust/policy';

/**
 * The officer console (/officer, /officer/:id).
 *  - recorded mode (?sample=1): the recorded inbox, plans and receipts of our server; the recall is simulated in the
 *    browser and the recorded receipts then verify as Recalled;
 *  - photo cases against a MOCKED sandbox API (page.route): the frozen top-2 as one-tap verdicts, the evidence moving,
 *    the gate opening and closing (the dev server has no photo cases until a farmer sends photos);
 *  - one live smoke against the local API (skipped when it is not running): plans -> recall -> Recalled -> plan abstains.
 * Every screen is checked with axe: no serious or critical violations.
 */

// The dev server is shared with other builders: a Vite full reload (HMR) mid-test is environmental, so one retry.
test.describe.configure({ retries: 1 });

async function axeOk(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getTiming().iterations ?? 1) === Infinity));
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const count = (page: Page, key: 'open' | 'receipts' | 'recalled') => page.getByTestId(`count-${key}`).locator('dd .sr-only-live');

/* ------------------------------------------------------------------ recorded mode */
test.describe('recorded console', () => {
  test('who you are, the counters, the tabs, and the recorded inbox', async ({ page }) => {
    await page.goto('/officer?sample=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Demo officer · your sandbox' })).toBeVisible();
    await expect(page.getByText('Your recall changes only your own demo receipts')).toBeVisible();
    await expect(page.getByTestId('data-mode')).toContainText('Recorded 2 Nov');
    await expect(count(page, 'receipts')).toHaveText('20');
    await expect(count(page, 'recalled')).toHaveText('0');
    await expect(count(page, 'open')).toHaveText('2');
    for (const name of ['Inbox', 'Photo cases', 'Rules & recall', 'Area trust']) await expect(page.getByRole('tab', { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Inbox/ })).toHaveAttribute('aria-selected', 'true');
    // the newest open case is already open beside the list on a wide screen
    const rows = page.getByTestId('case-row');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('case-detail')).toBeVisible();
    // reasons in plain words, the farmer's question, and the details as key/values
    await rows.filter({ hasText: 'A question with no sourced answer' }).click();
    await expect(page).toHaveURL(/\/officer\/inbox-11894d644055#case$/);
    await expect(page.getByTestId('case-question')).toHaveText('Can I get a loan to buy fertiliser?');
    await expect(page.getByTestId('case-retrieved')).toContainText('R-BDR-003');
    await expect(page.getByTestId('case-retrieved')).toContainText('None reached the bar');
    await rows.filter({ hasText: 'A rule it needed was withdrawn' }).click();
    await expect(page.getByTestId('case-recalled')).toContainText('R-BDR-002 v1');
    await expect(page.getByTestId('case-details')).toContainText('pack-bd-rice');
  });

  test('resolve with a note (in this browser), then reopen', async ({ page }) => {
    await page.goto('/officer/inbox-11894d644055?sample=1');
    const detail = page.getByTestId('case-detail');
    await expect(detail).toContainText(/saved in this browser only/i);
    await expect(page.getByText('the official resolve needs an officer’s admin token')).toBeVisible();
    await detail.getByLabel('Your note to the farmer').fill('Loans are outside the advice. Called the farmer.');
    await detail.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByTestId('case-resolved')).toContainText('Resolved by you');
    await expect(page.getByTestId('case-resolved')).toBeFocused();
    await expect(detail).toContainText('Loans are outside the advice');
    await expect(count(page, 'open')).toHaveText('1');
    await page.getByRole('radio', { name: /Resolved/ }).click();
    await expect(page.getByTestId('case-row')).toHaveCount(1);
    await detail.getByRole('button', { name: 'Reopen' }).click();
    await expect(count(page, 'open')).toHaveText('2');
  });

  test('photo cases and area trust need the live server, and say so', async ({ page }) => {
    await page.goto('/officer?tab=photos&sample=1');
    await expect(page.getByTestId('photo-recorded')).toContainText('Photo cases need the live server');
    await page.getByRole('tab', { name: /Area trust/ }).click();
    await expect(page).toHaveURL(/tab=trust/);
    await expect(page.getByTestId('area-recorded')).toContainText('Area trust needs the live server');
  });

  test('tabs: arrow keys move between them, and each tab names its panel', async ({ page }) => {
    await page.goto('/officer?sample=1');
    const inbox = page.getByRole('tab', { name: /Inbox/ });
    await inbox.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Photo cases/ })).toBeFocused();
    await expect(page.getByRole('tab', { name: /Photo cases/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'off-tab-photos');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: /Area trust/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('recall: confirm with a reason, the ripple, the count, the farmer notice, and the receipt verifies as Recalled', async ({ page }) => {
    await page.goto('/officer?tab=recall&sample=1');
    await expect(page.getByText('Recall is simulated in your browser on the recorded receipts.')).toBeVisible();
    const tiles = page.getByTestId('receipt-tile');
    await expect(tiles).toHaveCount(20);
    await expect(page.locator('[data-testid=receipt-tile][data-state=recalled]')).toHaveCount(0);
    await page.getByTestId('recall-R-BDR-002@1').click();
    const dialog = page.getByRole('dialog', { name: 'Recall R-BDR-002 v1?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('4 receipts in your sandbox cite it');
    await dialog.getByRole('button', { name: 'Recall' }).click(); // no reason yet
    await expect(dialog).toContainText('Write a short reason first.');
    await dialog.getByRole('button', { name: 'Threshold under review' }).click();
    // a recall is deliberate: press and hold (about 1.7 s) until the fill completes
    await dialog.getByRole('button', { name: 'Recall' }).click({ delay: 2200 });
    await expect(dialog).toBeHidden();
    const result = page.getByTestId('recall-result');
    await expect(result).toBeVisible();
    await expect(page.getByTestId('recall-line')).toContainText('receipts now verify as Recalled; the planner stops using R-BDR-002 v1.');
    await expect(page.getByTestId('recall-line').locator('.sr-only-live')).toHaveText('4');
    await expect(page.locator('[data-testid=receipt-tile][data-state=recalled]')).toHaveCount(4);
    await expect(count(page, 'recalled')).toHaveText('1');
    // the farmer plans that used it now abstain, each with an inbox case
    await expect(page.getByTestId('replans')).toContainText('plan now abstains');
    await expect(page.getByTestId('notification-preview')).toContainText('Preview. SMS is sandbox: not sent');
    await expect(page.getByTestId('notification-preview')).toContainText('R-BDR-002 v1');
    await expect(page.locator('[data-rule="R-BDR-002@1"]')).toHaveAttribute('data-state', 'recalled');
    // re-check one: the verifier now says Recalled, and its timeline carries the officer's reason
    await page.getByRole('link', { name: 'Re-check one' }).click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'recalled');
    await expect(page.getByTestId('withdrawn-rules')).toContainText('R-BDR-002 v1');
    await expect(page.getByTestId('doc-timeline')).toContainText('Reason given: “Threshold under review”');
    await expect(page.getByTestId('doc-timeline')).toContainText('by you, in the officer console');
    // undo the simulation: everything is Authentic again
    await page.goto('/officer?tab=recall&sample=1');
    await page.getByRole('button', { name: 'Undo simulated recalls' }).click();
    await expect(page.locator('[data-testid=receipt-tile][data-state=recalled]')).toHaveCount(0);
    await expect(count(page, 'recalled')).toHaveText('0');
  });

  test('phone: a case opens in a sheet, and nothing overflows', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/officer?sample=1');
    await expect(page.getByTestId('case-row').first()).toBeVisible();
    await expect(page.getByTestId('case-detail')).toHaveCount(0);
    await page.getByTestId('case-row').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('case-detail')).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/officer\?tab=inbox/);
    await page.getByRole('tab', { name: /Recall/ }).click();
    await expect(page.getByTestId('receipt-wall')).toBeVisible();
    await noOverflow(page);
  });

  test('Bangla', async ({ page }) => {
    await page.goto('/officer?sample=1&lang=bn');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ডেমো অফিসার · আপনার স্যান্ডবক্স');
    await expect(page.getByRole('tab', { name: /নিয়ম ও প্রত্যাহার/ })).toBeVisible();
  });

  test('axe: inbox, recall with the dialog open, light and dark', async ({ page }) => {
    await page.goto('/officer?sample=1');
    await expect(page.getByTestId('case-detail')).toBeVisible();
    await axeOk(page);
    await page.goto('/officer?tab=recall&sample=1&theme=dark');
    await expect(page.getByTestId('receipt-wall')).toBeVisible();
    await axeOk(page);
    await page.getByTestId('recall-R-BDR-001@1').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // the keyboard path: a short click does nothing, Enter arms the button, a second Enter would recall
    await dialog.getByRole('button', { name: 'Source page changed' }).click();
    const hold = dialog.getByTestId('recall-confirm');
    await hold.click();
    await expect(dialog).toBeVisible();
    await hold.press('Enter');
    await expect(hold).toHaveAccessibleName('Press again to recall');
    await axeOk(page);
  });
});

/* ------------------------------------------------------------------ photo cases against a mocked sandbox */
const SID = 'abcdef0123456789';
const AREA = 'rice@BD';
const AREA_CRED = 'urn:uuid:aaaaaaaa-1111-4222-8333-444444444444';
const PRESETS = {
  /** 29 sure answers, all right: the next sure right answer opens the gate */
  'one-away': { verdicts: 33, sure: 29, right: 29, open: false },
  /** gate open at 37 right of 40 sure: one wrong sure answer drops the bound under 0.80 and closes it */
  drifting: { verdicts: 52, sure: 40, right: 37, open: true },
  /** an area with no photo model */
  none: { verdicts: 0, sure: 0, right: 0, open: false },
} as const;

async function mockSandbox(page: Page, opts: { area: keyof typeof PRESETS; sure?: boolean; cases?: number; photoModel?: boolean }) {
  const demo = JSON.parse(readFileSync(new URL('../../src/data/recorded/demo.json', import.meta.url), 'utf8'));
  const plans = JSON.parse(readFileSync(new URL('../../src/data/recorded/plans.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const p = PRESETS[opts.area];
  // the presets are `as const`; the mocked area's state changes, so widen `open` back to boolean
  const st = { ...p, open: p.open as boolean, events: [] as Record<string, unknown>[], verdictBodies: [] as string[] };
  const now = Date.now();
  const sure = opts.sure ?? true;
  const cases = Array.from({ length: opts.cases ?? 1 }, (_, i) => ({
    case_id: `pc-${String(i + 1).padStart(4, '0')}abcdef0123`,
    area: AREA,
    model: 'bioclip2@1',
    field_id: 'BD-SAMPLE-02',
    created_at: new Date(now - (i + 1) * 60_000).toISOString(),
    route: 'officer',
    sure,
    suggestion: sure ? [{ label: 'blast', prob: 0.91 }, { label: 'brown_spot', prob: 0.05 }] : [{ label: 'blast', prob: 0.62 }, { label: 'brown_spot', prob: 0.21 }],
    consent: true,
    verdict: null as string | null,
    photo_available: true,
  }));
  const lb = () => Math.round(wilsonLowerBound(st.right, st.sure) * 1e4) / 1e4;
  const stats = () => ({ area: AREA, model: 'bioclip2@1', policy_version: 1, verdicts: st.verdicts, sure_in_window: st.sure, sure_right_in_window: st.right, precision: st.sure ? Math.round((st.right / st.sure) * 1e4) / 1e4 : null, lower_bound: lb(), gate_open: st.open, events: st.events, trust_credential_id: st.open ? AREA_CRED : null });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route((u) => /^\/(api|status|\.well-known)\//.test(u.pathname), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/demo') return json(route, demo);
    if (path === '/api/demo/session') return json(route, { session_id: SID });
    if (path === `/api/demo/${SID}/plan`) {
      const body = req.postDataJSON() as { field_id: string; profile_id: string };
      return json(route, plans[`${body.field_id}|${body.profile_id}`] ?? Object.values(plans)[0]);
    }
    if (path === `/api/demo/${SID}/inbox`) return json(route, { items: [] });
    if (path === `/api/demo/${SID}/stats`) return json(route, { rule_versions_recalled: 0, status_entries_used: 9, status_entries_revoked: 0, credentials_stored: 26, inbox_open: 0 });
    if (path === `/api/demo/${SID}/photo/cases`) return opts.photoModel === false ? json(route, { detail: 'the photo model is not installed on this server' }, 503) : json(route, { cases });
    if (path.startsWith(`/api/demo/${SID}/areas/`)) return opts.photoModel === false ? json(route, { detail: 'the photo model is not installed on this server' }, 503) : json(route, { ...stats(), area: decodeURIComponent(path.split('/').pop()!) === AREA ? AREA : decodeURIComponent(path.split('/').pop()!) });
    const img = /\/photo\/(pc-[0-9a-f]+)\/image$/.exec(path);
    if (img) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#4a7a35"/></svg>' });
    const verdict = /\/photo\/(pc-[0-9a-f]+)\/verdict$/.exec(path);
    if (verdict) {
      const c = cases.find((x) => x.case_id === verdict[1]);
      if (!c) return json(route, { detail: 'unknown case' }, 404);
      if (c.verdict) return json(route, { detail: 'already judged' }, 409);
      const { label } = req.postDataJSON() as { label: string };
      st.verdictBodies.push(label);
      c.verdict = label;
      c.photo_available = false;
      st.verdicts += 1;
      if (c.sure) {
        st.sure += 1;
        if (label === c.suggestion[0]!.label) st.right += 1;
      }
      let event = null;
      if (!st.open && st.sure >= 30 && lb() >= 0.85) {
        st.open = true;
        event = { event: 'opened', at: new Date().toISOString(), verdicts: st.verdicts, sure_in_window: st.sure, precision: st.right / st.sure, lower_bound: lb(), policy_version: 1 };
      } else if (st.open && lb() < 0.8) {
        st.open = false;
        event = { event: 'closed', at: new Date().toISOString(), verdicts: st.verdicts, sure_in_window: st.sure, precision: st.right / st.sure, lower_bound: lb(), policy_version: 1 };
      }
      if (event) st.events.push(event);
      return json(route, { case: c, event, area: stats() });
    }
    return json(route, { detail: 'not mocked' }, 404);
  });
  return st;
}

test.describe('photo cases (mocked sandbox)', () => {
  test('one tap answers the frozen guess, the evidence moves, and the gate opens', async ({ page }) => {
    const st = await mockSandbox(page, { area: 'one-away', cases: 2 });
    await page.goto('/officer?tab=photos');
    await expect(page.getByTestId('photo-card')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: /Photo cases/ })).toContainText('2');
    const detail = page.getByTestId('photo-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('pc-photo-img')).toBeVisible();
    await expect(page.getByTestId('pc-choice-blast')).toContainText('Blast');
    await expect(page.getByTestId('pc-choice-blast')).toContainText('91%');
    await expect(page.getByTestId('pc-choice-blast')).toContainText('sure');
    await expect(page.getByTestId('pc-choice-brown_spot')).toContainText('5%');
    await expect(page.getByTestId('pc-choice-tungro')).toHaveCount(0);
    await page.getByTestId('pc-else').click();
    for (const l of ['healthy', 'tungro', 'sheath_blight']) await expect(page.getByTestId(`pc-choice-${l}`)).toBeVisible();
    await expect(page.getByTestId('gauge-sure')).toHaveText('29 of 30');
    await expect(page.getByTestId('gate-state')).toContainText('Gate closed');

    await page.getByTestId('pc-choice-blast').click();
    await expect(page.getByTestId('pc-review-result')).toHaveText('The suggestion was right');
    await expect(page.getByTestId('pc-review')).toBeFocused();
    await expect(page.getByTestId('pc-review-counts')).toContainText('counts toward the gate');
    await expect(page.getByTestId('gauge-sure')).toHaveText('30 (enough)');
    await expect(page.getByTestId('gauge-verdicts')).toHaveText('33 → 34');
    await expect(page.getByTestId('gate-state')).toContainText('Gate open');
    const moment = page.getByTestId('gate-moment');
    await expect(moment).toHaveAttribute('data-event', 'opened');
    await expect(moment).toContainText('Trust earned in rice@BD');
    await expect(page.getByTestId('gate-moment-verify')).toHaveAttribute('href', `/verify/${AREA_CRED.replace('urn:uuid:', '')}`);
    await expect(page.getByTestId('pc-status')).toHaveText('Judged');
    await expect(page.getByTestId('pc-photo-empty')).toContainText('deleted after the verdict');
    expect(st.verdictBodies).toEqual(['blast']);
    // the next waiting photo is one tap away
    await page.getByTestId('pc-next').click();
    await expect(page.getByTestId('pc-status')).toHaveText('Waiting');
    await axeOk(page);
  });

  test('a wrong guess is shown as wrong, and a not-sure guess does not count', async ({ page }) => {
    await mockSandbox(page, { area: 'one-away', sure: false, cases: 1 });
    await page.goto('/officer?tab=photos');
    await expect(page.getByTestId('pc-choice-blast')).toContainText('not sure');
    await page.getByTestId('pc-choice-brown_spot').click();
    await expect(page.getByTestId('pc-review-result')).toHaveText('Wrong, but its second guess was right');
    await expect(page.getByTestId('pc-review-counts')).toContainText('does not count toward the gate');
    await expect(page.getByTestId('gate-moment')).toHaveCount(0);
  });

  test('drift: a wrong sure answer closes the gate, and says what that withdraws', async ({ page }) => {
    await mockSandbox(page, { area: 'drifting', cases: 1 });
    await page.goto('/officer?tab=photos');
    await expect(page.getByTestId('gate-state')).toContainText('Gate open');
    await page.getByTestId('pc-else').click();
    await page.getByTestId('pc-choice-tungro').click();
    await expect(page.getByTestId('pc-review-result')).toHaveText('The suggestion was wrong');
    await expect(page.getByTestId('gate-moment')).toHaveAttribute('data-event', 'closed');
    await expect(page.getByTestId('gate-moment')).toContainText('Trust withdrawn in rice@BD');
    await expect(page.getByTestId('gate-moment')).toContainText('verifies as withdrawn');
    await expect(page.getByTestId('gate-state')).toContainText('Gate closed');
  });

  test('area trust: one row per area with its gate, bound and events', async ({ page }) => {
    await mockSandbox(page, { area: 'drifting', cases: 1 });
    await page.goto('/officer?tab=trust');
    const row = page.locator('[data-testid=area-row][data-area="rice@BD"]');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('gate-state')).toContainText('Gate open');
    await expect(row.getByTestId('gauge-sure')).toHaveText('40 (enough)');
    await expect(row).toContainText('No gate events yet.');
    await expect(page.getByTestId('officer-trust-link')).toHaveAttribute('href', '/trust');
    await axeOk(page);
  });

  test('a server without the photo model says so calmly', async ({ page }) => {
    await mockSandbox(page, { area: 'none', photoModel: false });
    await page.goto('/officer?tab=photos');
    await expect(page.getByTestId('photo-cases-unavailable')).toContainText('No photo model on this server');
  });
});

/* ------------------------------------------------------------------ live smoke: the whole loop against the local API */
test('live: plans -> recall -> Recalled -> the farmer plan abstains', async ({ page, request }) => {
  const demo = await request.get('/api/demo').catch(() => null);
  test.skip(!demo || !demo.ok(), 'the local API is not running');
  test.setTimeout(90_000);
  await page.goto('/officer?tab=recall');
  await expect(page.getByTestId('data-mode')).toContainText('Live');
  await expect(page.getByTestId('rule-list').first()).toBeVisible({ timeout: 30_000 });
  await expect(count(page, 'recalled')).toHaveText('0');
  await page.getByTestId('recall-R-BDR-002@1').click();
  const dialog = page.getByRole('dialog', { name: 'Recall R-BDR-002 v1?' });
  await dialog.getByLabel(/Reason/).fill('e2e: threshold under review');
  await dialog.getByRole('button', { name: 'Recall' }).click({ delay: 2200 });
  await expect(page.getByTestId('recall-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('recall-line').locator('.sr-only-live')).toHaveText('2');
  await expect(page.locator('[data-testid=receipt-tile][data-state=recalled]')).toHaveCount(2);
  await expect(page.getByTestId('replans')).toContainText('plan now abstains');
  await expect(count(page, 'recalled')).toHaveText('1');
  await page.getByRole('link', { name: 'Re-check one' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'recalled');
  await expect(page.getByTestId('verdict')).toContainText('It is yours');
  await page.goto('/officer?tab=inbox');
  await expect(page.getByTestId('case-row').filter({ hasText: 'A rule it needed was withdrawn' }).first()).toBeVisible({ timeout: 20_000 });
});
