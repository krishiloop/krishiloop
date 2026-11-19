import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The home hero's scroll story (builder H, v4): a field of leaves on a canvas that morphs through six pictures, each
 * with one line; and the loader that draws the KrishiLoop mark while the app's code loads.
 */
const seriousA11y = async (page: Page) => {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.timeline !== document.timeline || a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`);
};

/** how many pixels of the leaf canvas are painted */
const painted = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.kg-field canvas');
    const g = c?.getContext('2d');
    if (!c || !g || !c.width) return 0;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i]! > 0) n++;
    return n;
  });

test('home story: six pictures with one line each, dots jump between them, and the leaves are their own chunk', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => {
    if (/story\/field|field-[\w-]+\.js/.test(r.url())) chunks.push(r.url());
  });
  await page.goto('/');
  const hero = page.locator('section.kg-hero');
  // the headline, the promise and both actions are there from the start
  await expect(page.getByRole('heading', { level: 1 })).toContainText('KrishiLoop');
  await expect(hero.getByRole('link', { name: /Try the farmer app/ })).toBeVisible();
  // the leaf field loads after the page, in its own chunk, and paints leaves
  await expect(hero.locator('.kg-field[data-live]')).toHaveCount(1);
  expect(chunks.length, 'the leaf field is a separate chunk').toBeGreaterThan(0);
  await expect.poll(() => painted(page), { timeout: 8000 }).toBeGreaterThan(200);
  // every line is in the page for screen readers, and the canvas is hidden from them
  const lines = hero.locator('figcaption ol li');
  await expect(lines).toHaveCount(6);
  await expect(lines.nth(3)).toContainText('Reports from nearby farms warn the whole area.');
  await expect(hero.locator('canvas')).toHaveAttribute('aria-hidden', 'true');
  await expect(hero.locator('.kg-illus')).toBeVisible();
  await expect(hero.locator('.kg-illus')).toContainText('Illustration: drawn leaves, not real data');
  // the first picture, then a dot takes the reader to the weather warning
  await expect(hero.locator('.kg-line')).toContainText('Your field');
  const dot = hero.getByRole('button', { name: 'Go to step 3: Weather warning' });
  await dot.click();
  await expect(dot).toHaveAttribute('aria-current', 'step');
  await expect(hero.locator('.kg-line')).toContainText('Rain on the way?');
  // the headline is still on screen while the story is pinned
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  await expect(hero.getByRole('link', { name: /Try the farmer app/ })).toBeInViewport();
  // back to the first picture, then skip the story: the page lands below the band
  await hero.getByRole('button', { name: 'Go to step 1: Your field' }).click();
  await expect(hero.locator('.kg-line')).toContainText('Your field');
  await hero.getByRole('link', { name: 'Skip the story' }).click();
  await expect(page).toHaveURL(/#home-after$/);
  await expect(page.getByRole('heading', { level: 1 })).not.toBeInViewport({ timeout: 5000 });
});

test('home story: reduced motion draws each picture once, still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.locator('section.kg-hero');
  await expect(hero.locator('.kg-field[data-live]')).toHaveCount(1);
  await expect.poll(() => painted(page), { timeout: 8000 }).toBeGreaterThan(200);
  const a = await painted(page);
  await page.waitForTimeout(700);
  expect(await painted(page), 'nothing moves under reduced motion').toBe(a);
  await expect(hero.locator('.kg-hint')).toHaveCount(0);
  await hero.getByRole('button', { name: 'Go to step 6: The loop' }).click();
  await expect(hero.locator('.kg-line')).toContainText('called back from every farmer');
  await page.waitForTimeout(300);
  expect(await painted(page), 'the still picture changed with the step').not.toBe(a);
});

test('home story: no serious accessibility problems mid-story, Bangla, dark, phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lang=bn&theme=dark');
  const hero = page.locator('section.kg-hero');
  await hero.getByRole('button', { name: /৪ নম্বর ধাপে যান/ }).click();
  await expect(hero.locator('.kg-line')).toContainText('গ্রামের রোগ-মানচিত্র');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
  expect(await seriousA11y(page)).toEqual([]);
});

test('loader: the mark is drawn by the HTML alone, stays out of the way, and shows once per session', async ({ page }) => {
  // hold the app's code back, as on a slow phone, so the loader can be seen
  await page.route((u) => u.pathname.endsWith('/src/main.tsx'), async (r) => {
    await new Promise((res) => setTimeout(res, 900));
    await r.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  const boot = page.locator('#kl-boot');
  await expect(boot).toHaveAttribute('aria-hidden', 'true');
  await expect(boot).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('status').filter({ hasText: 'Loading KrishiLoop' })).toHaveCount(1);
  // gone (removed) once the page has its headline, never more than about 1.2 s
  await expect(boot).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByText('Loading KrishiLoop')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // the next page in the same session: no loader at all
  await page.goto('/about');
  await expect(page.locator('#kl-boot')).toHaveCount(0);
});
