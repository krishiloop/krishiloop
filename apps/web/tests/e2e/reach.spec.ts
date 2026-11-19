import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Short codes from an SMS (services/reach): /v/:code and the "Code from an SMS" box on /verify.
 * GET /api/code/{code} is mocked with page.route; the code resolves to the story's RECORDED receipt, so the verdict that
 * follows is the recorded one (deterministic, no backend). The code only finds the receipt: the page then runs the same
 * check as any /verify/:id.
 */
test.describe.configure({ retries: 1 });

const HERO = '84942e4a-2ce9-4497-92ca-11f478f9e259'; // the story's "no spray needed" receipt (recorded)
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answer GET /api/code/<code>: 7KQ2MX4P is the recorded receipt, anything else is unknown. Records what was asked. */
async function mockCodes(page: Page, opts: { down?: boolean } = {}) {
  const asked: string[] = [];
  await page.route(
    (u) => u.pathname.startsWith('/api/code/'),
    (route) => {
      const code = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      asked.push(code);
      if (opts.down) return route.fulfill({ status: 502, body: 'Bad Gateway' });
      return code === '7KQ2MX4P' ? json(route, { code: '7KQ2-MX4P', credential_id: `urn:uuid:${HERO}`, verify_path: `/verify/${HERO}` }) : json(route, { detail: 'unknown code' }, 404);
    },
  );
  return asked;
}

async function axeOk(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getTiming().iterations ?? 1) === Infinity));
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('typing the code from an SMS opens the receipt, and the page says the code is not the proof', async ({ page }) => {
  const asked = await mockCodes(page);
  await page.goto('/verify');
  const box = page.getByLabel('Code from an SMS');
  await expect(page.getByTestId('vf-code-form')).toContainText('Eight letters and digits');
  // not a code: said plainly, nothing is asked
  await box.fill('hello');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toContainText('That is not a code');
  expect(asked).toEqual([]);
  // lower case, a space instead of the dash, and O for 0 all read as the same code
  await box.fill('7kq2 mx4p');
  await box.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/verify/${HERO}$`));
  expect([...new Set(asked)]).toEqual(['7KQ2MX4P']); // the dev server's StrictMode may ask twice
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
  await expect(page.getByTestId('vf-from-code')).toHaveText('Opened from SMS code 7KQ2-MX4P. The code only finds the receipt. The signature check is the proof.');
  await axeOk(page);
});

test('/v/:code from an SMS link lands on the verifier for that receipt', async ({ page }) => {
  const asked = await mockCodes(page);
  await page.goto('/v/7kq2-mx4p');
  await expect(page).toHaveURL(new RegExp(`/verify/${HERO}$`));
  expect([...new Set(asked)]).toEqual(['7KQ2MX4P']); // the dev server's StrictMode may ask twice
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic');
  await expect(page.getByTestId('vf-from-code')).toContainText('7KQ2-MX4P');
  // back goes to where the visitor came from, not to the lookup page again
  await page.goBack();
  await expect(page).not.toHaveURL(/\/v\//);
});

test('an unknown code says so and nothing more, in English and Bangla, at phone width', async ({ page }) => {
  await mockCodes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/v/ZZZZ-ZZZZ');
  const open = page.getByTestId('vf-code-open');
  await expect(open).toHaveAttribute('data-state', 'unknown');
  await expect(open).toContainText('No receipt has the code ZZZZ-ZZZZ.');
  await expect(page.getByRole('link', { name: 'Check another receipt' })).toBeVisible();
  await noOverflow(page);
  await axeOk(page);
  await page.goto('/v/ZZZZ-ZZZZ?lang=bn');
  await expect(page.getByTestId('vf-code-open')).toContainText('ZZZZ-ZZZZ কোডের কোনো রসিদ নেই।');
  await noOverflow(page);
  await axeOk(page);
  // not a code at all (U is not a code letter): the same answer, and nothing is asked
  await page.goto('/v/UUUU-UUUU');
  await expect(page.getByTestId('vf-code-open')).toHaveAttribute('data-state', 'unknown');
});

test('when the verifier cannot be reached, the page says so and offers to try again', async ({ page }) => {
  const asked = await mockCodes(page, { down: true });
  await page.goto('/v/7KQ2-MX4P');
  await expect(page.getByTestId('vf-code-open')).toHaveAttribute('data-state', 'unreachable');
  await expect(page.getByTestId('vf-code-open')).toContainText('We could not reach the checker');
  const before = asked.length;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => asked.length).toBeGreaterThan(before);
  await expect(page.getByTestId('vf-code-open')).toHaveAttribute('data-state', 'unreachable');
  await axeOk(page);
});

test('light theme: the code box and the lookup page pass axe', async ({ page }) => {
  await mockCodes(page);
  await page.goto('/verify?theme=light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('vf-code-form')).toBeVisible();
  await axeOk(page);
  await page.goto('/v/ZZZZ-ZZZZ?theme=light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('vf-code-open')).toHaveAttribute('data-state', 'unknown');
  await axeOk(page);
});
