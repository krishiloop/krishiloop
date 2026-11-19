import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The home hero's story (builder H v4; v5 builder Ho: it plays by itself): a field of leaves on a canvas that morphs
 * through eight pictures, each with one line and its own pastel; the phone band and the team strip; and the loader that
 * draws the KrishiLoop mark while the app's code loads.
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

/** the line on screen now (the one leaving, if any, is .is-out) */
const lineNow = (page: Page) => page.locator('section.kg-hero .kg-line:not(.is-out)');

test('home story: eight pictures that play by themselves, a pause button, dots that jump, and the leaves in their own chunk', async ({ page }) => {
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
  await expect(lines).toHaveCount(8);
  await expect(lines.nth(5)).toContainText('Nearby farms report. The area is warned.');
  await expect(hero.locator('canvas')).toHaveAttribute('aria-hidden', 'true');
  await expect(hero.locator('.kg-illus')).toBeVisible();
  await expect(hero.locator('.kg-illus')).toContainText('Illustration: drawn leaves, not real data');
  // it plays by itself: the first picture, then the crop doctor a few seconds later, each with its own pastel
  await expect(lineNow(page)).toContainText('Your field');
  await expect(hero).toHaveAttribute('data-tone', 'butter');
  await expect(lineNow(page)).toContainText('Potato', { timeout: 9000 });
  await expect(hero).toHaveAttribute('data-tone', 'moss');
  // a dot jumps to the weather warning; while the mouse rests on the story, it waits
  const dot = hero.getByRole('button', { name: 'Go to step 5: Weather warning' });
  await dot.click();
  await expect(dot).toHaveAttribute('aria-current', 'step');
  await expect(lineNow(page)).toContainText('Rain coming?');
  await expect(hero).toHaveAttribute('data-paused', '');
  await page.waitForTimeout(5600);
  await expect(dot).toHaveAttribute('aria-current', 'step');
  // the mouse leaves: after a moment it plays on to the next picture
  await page.mouse.move(4, 4);
  await expect(hero.getByRole('button', { name: 'Go to step 6: Disease map' })).toHaveAttribute('aria-current', 'step', { timeout: 9000 });
  // the visible pause button stops it for good (WCAG 2.2.2), and play starts it again
  const pause = hero.getByRole('button', { name: 'Pause the story' });
  await expect(pause).toBeVisible();
  await pause.click();
  await page.mouse.move(4, 4);
  const play = hero.getByRole('button', { name: 'Play the story' });
  await expect(play).toBeVisible();
  const at = await hero.locator('.kg-dot[aria-current]').getAttribute('aria-label');
  await page.waitForTimeout(6000);
  expect(await hero.locator('.kg-dot[aria-current]').getAttribute('aria-label'), 'paused: the picture stays').toBe(at);
  await play.click();
  await expect(hero.getByRole('button', { name: 'Pause the story' })).toBeVisible();
  // the headline stays on screen the whole time, and the hero is one screen tall (nothing pinned)
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  const h = await hero.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThanOrEqual((await page.evaluate(() => window.innerHeight)) + 2);
});

test('home story: reduced motion starts paused and draws each picture once, still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.locator('section.kg-hero');
  await expect(hero.locator('.kg-field[data-live]')).toHaveCount(1);
  await expect.poll(() => painted(page), { timeout: 8000 }).toBeGreaterThan(200);
  await expect(hero.getByRole('button', { name: 'Play the story' })).toBeVisible();
  const a = await painted(page);
  await page.waitForTimeout(700);
  expect(await painted(page), 'nothing moves under reduced motion').toBe(a);
  await expect(hero.locator('.kg-hint')).toHaveCount(0);
  await hero.getByRole('button', { name: 'Go to step 8: The loop' }).click();
  await expect(lineNow(page)).toContainText('Wrong advice is taken back from everyone');
  await page.waitForTimeout(300);
  expect(await painted(page), 'the still picture changed with the step').not.toBe(a);
});

test('home story: no serious accessibility problems mid-story, Bangla, dark, phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lang=bn&theme=dark');
  const hero = page.locator('section.kg-hero');
  await hero.getByRole('button', { name: /৬ নম্বর ধাপে যান/ }).click();
  await expect(lineNow(page)).toContainText('রোগের মানচিত্র');
  await expect(hero.getByRole('button', { name: 'গল্প থামান' })).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
  expect(await seriousA11y(page)).toEqual([]);
});

test('home: "Use it on your phone" (QR and copy link to /m) and the team strip, in both themes, at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const theme of ['light', 'dark']) {
    await page.goto(`/?theme=${theme}`);
    const band = page.getByTestId('phone-band');
    await band.scrollIntoViewIfNeeded();
    await expect(band.getByRole('heading', { level: 2, name: 'Use it on your phone.' })).toBeVisible();
    await expect(band.getByTestId('open-on-phone-url')).toHaveValue(/\/m$/);
    await expect(band.getByRole('link', { name: /Open the phone app/ })).toHaveAttribute('href', '/m');
    const strip = page.getByTestId('team-strip');
    await strip.scrollIntoViewIfNeeded();
    await expect(strip.getByRole('img')).toHaveCount(5);
    await expect(strip.getByRole('img', { name: 'Abdullah Rubab' })).toBeVisible();
    await expect(strip).toContainText('Team lead');
    await expect(strip.getByRole('link', { name: /Meet the team/ })).toHaveAttribute('href', '/about#team');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `no horizontal page scroll (${theme})`).toBeLessThanOrEqual(1);
    expect(await seriousA11y(page), theme).toEqual([]);
  }
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
