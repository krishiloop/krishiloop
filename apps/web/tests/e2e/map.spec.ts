import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The Disease map (builder M), /map in RECORDED mode (`?sample=1`, no backend). Open-Meteo is MOCKED with page.route,
 * so no test calls the real forecast:
 *  - switch country (and all three), choose a pest, narrow the years;
 *  - open an area's panel by keyboard (arrow keys, Enter): counts per pest, the 7-day forecast from ONE request (cached),
 *    the CSS rain only when rain is forecast, and "what to watch" (sourced rules, or a plain "none yet");
 *  - the simulated outbreak: its own toggle, labelled, stamped, never added to the recorded counts;
 *  - axe (WCAG 2.2 A + AA) in both themes; 360 px: no sideways scroll, the panel is a bottom sheet.
 * Run on its own port: E2E_PORT=5252 npx playwright test map.
 */
test.describe.configure({ retries: 1 }); // the dev server is shared with other builders: one retry for an HMR reload

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MAP = '/map?sample=1&lang=en';
const sightings = JSON.parse(readFileSync(new URL('../../src/data/map/sightings.json', import.meta.url), 'utf8'));

const WET = {
  latitude: 24.47,
  longitude: 88.68,
  timezone: 'Asia/Dhaka',
  daily: {
    time: ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'],
    precipitation_sum: [17.8, 29.9, 0, 2.9, 0, 1, 0],
    precipitation_probability_max: [100, 98, 10, 42, 5, 19, 0],
    temperature_2m_max: [25, 23.4, 23.5, 28.2, 27.8, 27.2, 26.7],
    temperature_2m_min: [22.5, 21.7, 22.2, 22, 22.1, 21, 19.2],
    relative_humidity_2m_mean: [89, 96, 97, 87, 89, 86, 81],
  },
};
const DRY = { ...WET, daily: { ...WET.daily, precipitation_sum: [0, 0, 0, 0.2, 0, 0, 0] } };

/** Mock Open-Meteo; returns a counter of the requests it answered. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/** NASA POWER, mocked: 16 days to 2026-11-19, the last two days -999 (not made yet), one day in the middle with no sun. */
const POWER_BODY = (() => {
  const days = Array.from({ length: 16 }, (_, i) => `202611${String(4 + i).padStart(2, '0')}`);
  const mk = (f: (i: number) => number) => Object.fromEntries(days.map((d, i) => [d, i >= 14 ? -999 : f(i)]));
  return {
    properties: {
      parameter: {
        T2M_MAX: mk((i) => 30 + (i % 3)),
        T2M_MIN: mk((i) => 18 + (i % 2)),
        RH2M: mk(() => 64),
        ALLSKY_SFC_SW_DWN: mk((i) => (i === 5 ? -999 : 15)),
      },
    },
  };
})();
/** Mock Open-Meteo, NASA POWER and NASA GIBS; returns a counter of the Open-Meteo requests it answered. */
async function mockWeather(page: Page, body: object | 'fail' = WET) {
  const calls: string[] = [];
  await page.route('https://power.larc.nasa.gov/**', (route) => route.fulfill({ json: POWER_BODY, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://gibs.earthdata.nasa.gov/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('https://api.open-meteo.com/**', (route) => {
    calls.push(route.request().url());
    return body === 'fail' ? route.fulfill({ status: 500, body: 'no' }) : route.fulfill({ json: body });
  });
  return calls;
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().filter((a) => (a.effect?.getTiming().iterations ?? 1) !== Infinity).map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
}
async function axe(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')} :: ${(v.nodes[0]?.failureSummary ?? '').split('\n').slice(0, 3).join(' | ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
}
const country = (page: Page, c: string) => page.getByTestId(`map-country-${c}`);
const filled = (page: Page, c: string) => country(page, c).locator('path[data-code]:not([data-count="0"])');
async function firstMap(page: Page) {
  await expect(country(page, 'BD').locator('path[data-code]').first()).toBeVisible({ timeout: 30_000 });
}

test('country switch: Bangladesh districts first, then India, Kenya and all three side by side', async ({ page }) => {
  await page.goto(MAP);
  await firstMap(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where pests and diseases have been recorded');
  await expect(country(page, 'BD')).toHaveAttribute('data-level', sightings.countries.BD.default_level);
  await expect(country(page, 'BD').locator('path[data-code]')).toHaveCount(64);
  // the exact label on the recorded layer
  await expect(page.getByTestId('map-label-sightings')).toContainText('GBIF sightings, years');
  await expect(page.getByTestId('map-label-sightings')).toContainText('not how much disease there is now');

  const countries = page.getByRole('radiogroup', { name: 'Country' });
  await countries.getByRole('radio', { name: 'India' }).click();
  await expect(country(page, 'IN').locator('path[data-code]')).toHaveCount(36);
  await expect(country(page, 'IN')).toContainText('disputed');
  await expect(country(page, 'BD')).toHaveCount(0);
  await countries.getByRole('radio', { name: 'Kenya' }).click();
  await expect(country(page, 'KE').locator('path[data-code]')).toHaveCount(47);
  await countries.getByRole('radio', { name: 'All three' }).click();
  for (const c of ['BD', 'IN', 'KE']) await expect(country(page, c).locator('path[data-code]').first()).toBeVisible();
  // side by side on a desktop screen
  const [a, b] = await Promise.all([country(page, 'BD').boundingBox(), country(page, 'IN').boundingBox()]);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(5);
  expect(b!.x).toBeGreaterThan(a!.x + 100);

  // Bangladesh divisions: 8 areas
  await page.getByRole('radiogroup', { name: 'Bangladesh areas' }).getByRole('radio', { name: 'Divisions' }).click();
  await expect(country(page, 'BD').locator('path[data-code]')).toHaveCount(8);
});

test('choosing a pest recolours the map from the GBIF counts; the years narrow it', async ({ page }) => {
  await page.goto(MAP);
  await firstMap(page);
  await page.getByRole('radiogroup', { name: 'Country' }).getByRole('radio', { name: 'Kenya' }).click();
  const pests = page.getByTestId('map-pests');
  await pests.getByRole('radio', { name: /Desert locust/ }).click();
  await expect(pests.getByRole('radio', { name: /Desert locust/ })).toHaveAttribute('aria-checked', 'true');
  const loc = sightings.countries.KE.taxa.locust;
  const areas = Object.keys(loc.levels.county.areas).length;
  await expect(filled(page, 'KE')).toHaveCount(areas);
  await expect(page.getByTestId('map-totals-KE')).toContainText(`${loc.levels.county.placed.toLocaleString('en-GB')} of ${loc.total.toLocaleString('en-GB')} records`);
  // the legend says numbers, not only colours
  await expect(page.getByTestId('map-legend')).toContainText('100 or more');

  // a pest with no placed records in Kenya: nothing filled, said in words
  await pests.getByRole('radio', { name: /Brown planthopper/ }).click();
  await expect(filled(page, 'KE')).toHaveCount(0);
  await expect(page.getByTestId('map-empty-KE')).toContainText('GBIF has no placed records');

  // years: "Last 10 years" drops older records
  await pests.getByRole('radio', { name: /All pests/ }).click();
  const all = await filled(page, 'KE').count();
  await page.getByTestId('map-years').getByRole('button', { name: 'Last 10 years' }).click();
  await expect(page.getByTestId('map-years-out')).toContainText('to');
  await expect.poll(() => filled(page, 'KE').count()).toBeLessThanOrEqual(all);
  // the "from" thumb by keyboard: End moves it to the last year
  await page.getByTestId('map-year-from').focus();
  await page.keyboard.press('End');
  const [, hi] = [0, Math.max(...Object.values(sightings.countries).flatMap((c: any) => Object.values(c.taxa).map((t: any) => t.years?.[1] ?? 0)))];
  await expect(page.getByTestId('map-years-out')).toHaveText(`${hi} to ${hi}`);
  await expect(page.getByTestId('map-label-sightings')).toContainText(`years ${hi} to ${hi}`);
});

test('keyboard: arrows move between areas, Enter opens the panel with counts, ONE forecast request, rain, and rules', async ({ page }) => {
  const calls = await mockWeather(page, WET);
  await page.goto(MAP);
  await firstMap(page);
  const stop = country(page, 'BD').locator('path[tabindex="0"]');
  await expect(stop).toHaveCount(1); // one tab stop per map
  await stop.focus();
  await expect(page.getByTestId('map-tip')).toBeVisible(); // focus shows the tooltip too
  const before = await stop.getAttribute('data-code');
  await page.keyboard.press('ArrowRight');
  const now = page.locator('path[data-code]:focus');
  await expect(now).toHaveCount(1);
  expect(await now.getAttribute('data-code')).not.toBe(before);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('map-panel');
  await expect(panel).toBeVisible();
  const code = await panel.getAttribute('data-area');
  expect(code).toBeTruthy();
  // counts per pest: all seven, the area's own numbers
  await expect(panel.getByTestId('map-panel-pests').locator('li')).toHaveCount(7);
  const bph = sightings.countries.BD.taxa.bph.levels.district.areas[code!]?.n ?? 0;
  await expect(panel.locator('li[data-pest="bph"] .mp-bar-n')).toHaveText(String(bph));
  // weather: one request, 7 days, rain forecast -> the CSS rain
  const wx = page.getByTestId('map-weather');
  await expect(wx.getByTestId('map-wx-days').locator('li')).toHaveCount(7);
  await expect(wx).toHaveAttribute('data-rain', 'yes');
  await expect(wx.getByTestId('map-rain')).toBeAttached();
  await expect(wx).toContainText('Open-Meteo.com');
  await expect(wx).toContainText('about 51.6 mm over the week');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('forecast_days=7');
  // what to watch: Bangladesh rice rules with their source
  await expect(panel.getByTestId('map-watch')).toContainText('R-BDR-');
  await expect(panel.getByTestId('map-watch')).toContainText('Bangladesh Rice Research Institute');
  await expect(panel.getByTestId('map-watch-none')).toContainText('no sourced rule yet');
  // close and reopen the same area: the forecast is cached, no second request
  await page.getByTestId('map-side').getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await country(page, 'BD').locator(`path[data-code="${code}"]`).click();
  await expect(page.getByTestId('map-wx-days').locator('li')).toHaveCount(7);
  expect(calls).toHaveLength(1);
});

test('weather: no rain forecast means no rain effect; a failed forecast says so and can retry', async ({ page }) => {
  await mockWeather(page, DRY);
  await page.goto(MAP);
  await firstMap(page);
  await country(page, 'BD').locator('path[data-code]:not([data-count="0"])').first().click();
  const wx = page.getByTestId('map-weather');
  await expect(wx.getByTestId('map-wx-days').locator('li')).toHaveCount(7);
  await expect(wx).toHaveAttribute('data-rain', 'no');
  await expect(wx.getByTestId('map-rain')).toHaveCount(0);

  await page.unroute('https://api.open-meteo.com/**');
  await mockWeather(page, 'fail');
  await page.getByRole('radiogroup', { name: 'Country' }).getByRole('radio', { name: 'India' }).click();
  await country(page, 'IN').locator('path[data-code]:not([data-count="0"])').first().click();
  await expect(page.getByTestId('map-weather').getByRole('alert')).toContainText('The forecast could not load.');
  // India: no farmer reports and no sourced rules, said plainly
  await expect(page.getByTestId('map-panel')).toContainText('KrishiLoop has no farmer reports from India yet.');
  await expect(page.getByTestId('map-watch-none')).toContainText('We have no sourced rule for India yet.');
});

test('the simulated outbreak: its own toggle, labelled and stamped, never added to the recorded counts', async ({ page }) => {
  await mockWeather(page);
  await page.goto(MAP);
  await firstMap(page);
  await expect(page.getByTestId('map-label-reports')).toContainText('Farmer reports need the live service');
  const counts = async () => country(page, 'BD').locator('path[data-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-count')).join(','));
  const before = await counts();
  await expect(page.getByTestId('map-label-sim')).toHaveCount(0);
  await page.getByTestId('map-layer-sim').check();
  await expect(page.getByTestId('map-label-sim')).toContainText('Simulated');
  await expect(page.getByTestId('map-label-sim')).toContainText('Never added to real counts');
  await expect(page.getByTestId('map-sim-stamp')).toHaveText('Simulated');
  await expect(country(page, 'BD').locator('.mp-sim circle').first()).toBeVisible();
  expect(await counts()).toBe(before);
  // the simulated scenario's district shows in its panel, in its own labelled box
  await country(page, 'BD').locator('path[data-code="BD-mymensingh"]').click();
  await expect(page.getByTestId('map-panel-sim')).toContainText('Simulated outbreak: practice data');
  await expect(page.getByTestId('map-panel-sim')).toContainText('farmers reported Rice bacterial blight');
  await page.getByTestId('map-layer-sim').uncheck();
  await expect(page.getByTestId('map-sim-stamp')).toHaveCount(0);
  await expect(page.getByTestId('map-panel-sim')).toHaveCount(0);
});

test('Bangla: the map in Bangla', async ({ page }) => {
  await page.goto(MAP.replace('lang=en', 'lang=bn'));
  await firstMap(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('কোথায় কোথায় পোকা ও রোগ দেখা গেছে');
  await expect(page.getByRole('radiogroup', { name: 'দেশ', exact: true })).toBeVisible();
  await expect(page.getByTestId('map-pests')).toContainText('বাদামি গাছফড়িং');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: the map, the simulated layer and an open panel`, async ({ page }) => {
    await mockWeather(page);
    await page.goto(`${MAP}&theme=${theme}`);
    await firstMap(page);
    await axe(page, `map ${theme}`);
    await page.getByTestId('map-layer-sim').check();
    await country(page, 'BD').locator('path[data-code="BD-mymensingh"]').click();
    await expect(page.getByTestId('map-wx-days').locator('li')).toHaveCount(7);
    await axe(page, `map + panel ${theme}`);
  });
}

test('360 px: no sideways scroll; tapping an area opens a bottom sheet with the weather', async ({ page }) => {
  await mockWeather(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(MAP);
  await firstMap(page);
  await noOverflow(page);
  await page.getByRole('radiogroup', { name: 'Country' }).getByRole('radio', { name: 'All three' }).click();
  await expect(country(page, 'KE').locator('path[data-code]').first()).toBeVisible();
  await noOverflow(page);
  await page.getByRole('radiogroup', { name: 'Country' }).getByRole('radio', { name: 'Bangladesh' }).click();
  await country(page, 'BD').locator('path[data-code="BD-rajshahi"]').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('map-wx-days').locator('li')).toHaveCount(7);
  await noOverflow(page);
  await axe(page, 'map sheet 360');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('NASA section of the panel: a GIBS picture with its date, and NASA POWER with -999 shown as no data', async ({ page }) => {
  await mockWeather(page, WET);
  const gibs: string[] = [];
  page.on('request', (r) => r.url().includes('gibs.earthdata.nasa.gov') && gibs.push(r.url()));
  await page.goto(MAP);
  await firstMap(page);
  await country(page, 'BD').locator('path[data-code]').first().focus();
  await page.keyboard.press('Enter');
  const nasa = page.getByTestId('map-nasa');
  await expect(nasa).toBeVisible();
  await expect(nasa.getByRole('heading', { name: 'NASA, from space' })).toBeVisible();
  await expect(page.getByTestId('map-nasa-credit')).toContainText(/NASA EOSDIS GIBS, MODIS Terra, \d+ \w+ 20\d\d/);
  await expect(page.getByTestId('map-nasa-img')).toBeVisible();
  // crop health: another layer, the credit says so
  await nasa.getByRole('button', { name: /Crop health/ }).click();
  await expect(page.getByTestId('map-nasa-credit')).toContainText('MODIS Terra NDVI, 8-day');
  await expect.poll(() => gibs.some((u) => u.includes('MODIS_Terra_NDVI_8Day') && /TIME=\d{4}-\d{2}-\d{2}/.test(u))).toBe(true);
  // POWER: the two newest days (-999) are dropped, 14 days shown, the day with no sunshine says "no data", never -999
  await expect(page.getByTestId('map-power-days').locator('li')).toHaveCount(14);
  await expect(page.getByTestId('map-power-credit')).toContainText('NASA POWER Project, 4 November 2026 to 17 November 2026');
  await expect(page.getByTestId('map-power-days').locator('li').nth(5)).toHaveAttribute('aria-label', /sunshine no data/);
  await expect(nasa).not.toContainText('999');
  await expect(page.getByTestId('map-power-tiles')).toContainText('°C');
});
