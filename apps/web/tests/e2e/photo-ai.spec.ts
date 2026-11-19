import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * AgriTriage-Lite in the farmer app (builder P): the owner's TinyViT-11M student runs IN THE BROWSER (ONNX Runtime Web,
 * lazy), the conformal gate answers diagnose / shortlist / refer, "Why this answer?" shows the exact CAM, the attention and
 * a labelled colour estimate of the spots at once (same model run), the hide-and-check (occlusion) test on request, each
 * in a drag-to-compare slider, and the signed answer is the server's own reading. The test leaf is drawn here on a canvas (no licence question).
 * Recorded mode (`?sample=1`) has no API at all: the on-device step must still work. The last test needs the live API
 * behind the dev server's proxy (KRISHILOOP_API) and is skipped without it.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const REC = '/app?sample=1&lang=en&tab=photo';

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

/** A leaf drawn on a canvas: green blade, a midrib and brown lesions, as a JPEG. */
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

async function readLeaf(page: Page) {
  await page.getByTestId('fa-ai-input').setInputFiles({ name: 'leaf.jpg', mimeType: 'image/jpeg', buffer: await leaf(page) });
  const card = page.getByTestId('fa-ai-card');
  await expect(card).toBeVisible({ timeout: 180_000 }); // the 11.5 MB model loads once; slow when the whole suite runs
  return card;
}

test('/proof: the AgriTriage-Lite tile, with its numbers and every file they come from', async ({ page }) => {
  await page.goto('/proof?lang=en');
  const tile = page.getByTestId('new-agritriage');
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toContainText('77.4%');
  await expect(tile).toContainText('64% · 91%');
  await expect(tile).toContainText('88% · 92%');
  await expect(tile).toContainText('80.4% → 90.4%');
  await expect(tile).toContainText('22.6% → 38.3%');
  await expect(tile).toContainText('Research weights (trained on PlantWild, non-commercial)');
  await expect(tile).toContainText('earlier MobileNetV3-S student');
  await tile.locator('summary').first().click(); // v6: the source files sit under Show more
  await expect(tile.getByRole('link')).toHaveCount(4);
  await expect(tile.getByRole('link', { name: /poster_numbers\.json$/ })).toHaveAttribute('href', /evidence\/poster_numbers\.json$/);
});

test.describe('AgriTriage-Lite on the phone', () => {
  test.describe.configure({ timeout: 480_000 }); // one CPU thread in the browser, while other specs share the machine

  test('recorded mode, no API: upload a leaf, get a result card with the gate, the time and the label', async ({ page }) => {
    const api: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/demo\/[^/]+\/agritriage/.test(r.url())) api.push(r.url());
    });
    await page.goto(REC);
    await expect(page.getByTestId('fa-ai-weights')).toHaveText('Research weights (trained on PlantWild, non-commercial)');
    await expect(page.getByTestId('fa-ai-crop-field')).toHaveAttribute('aria-pressed', 'true');
    const card = await readLeaf(page);
    await expect(card).toHaveAttribute('data-outcome', /^(diagnose|shortlist|refer)$/);
    await expect(page.getByTestId('fa-ai-outcome')).toHaveText(/Diagnosis|Take a clearer photo|Ask your officer/);
    await expect(page.getByTestId('fa-ai-top').locator('li')).not.toHaveCount(0);
    for (const li of await page.getByTestId('fa-ai-top').locator('li').all()) await expect(li).toContainText(/^Rice /); // crop known: rice only
    await expect(page.getByTestId('fa-ai-time')).toContainText(/Model time on this phone: [\d,]+ ms/);
    await expect(page.getByTestId('fa-ai-offline')).toContainText('needs the live server');
    expect(api, 'the photo never left the phone').toEqual([]);

    // any crop: the same logits gated again, no second read
    await page.getByTestId('fa-ai-crop-any').click();
    await expect(page.getByTestId('fa-ai-crop-any')).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toBeVisible();
    await axe(page, 'photo AI result, light');
  });

  test('"Why this answer?": CAM and attention at once, the spots estimate labelled, views switch by keyboard', async ({ page }) => {
    await page.goto(REC);
    const card = await readLeaf(page);
    const xai = page.getByTestId('fa-ai-xai');
    // the CAM comes from the same model run as the answer: it is on screen with the card, no extra run
    await expect(page.getByTestId('fa-ai-xai-cmp')).toBeVisible({ timeout: 2_000 });
    await expect(xai).toHaveAttribute('data-view', 'cam');
    for (const name of ['Where the AI looked', 'What the AI paid attention to', 'Spots on the leaf', 'Hide-and-check test']) {
      await expect(xai.getByRole('tab', { name })).toBeVisible();
    }
    await expect(xai.getByRole('tab', { name: 'Where the AI looked' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('fa-ai-xai-say')).toContainText('pushed the AI most towards');
    await expect(xai).toContainText('Ready at once: the same model run as the answer.');
    // exact: the 49 squares plus the fixed part rebuild the model's score in the browser too
    await xai.getByText('What this can and cannot tell you').click();
    const err = Number(await page.getByTestId('fa-ai-xai-check').getAttribute('data-cam-error'));
    expect(err, 'CAM reconstruction error in the browser').toBeLessThan(1e-3);
    await expect(page.getByTestId('fa-ai-xai-check')).toContainText('add up to the model’s score');
    await expect(xai.getByRole('slider', { name: 'Compare the photo with where the AI looked' })).toHaveAttribute('aria-valuenow', '50');

    // keyboard: arrows move between the views (roving focus), as in any tab list
    await xai.getByRole('tab', { name: 'Where the AI looked' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(xai).toHaveAttribute('data-view', 'attention');
    await expect(xai.getByRole('tab', { name: 'What the AI paid attention to' })).toBeFocused();
    await expect(page.getByTestId('fa-ai-xai-say')).toContainText('attention went most');
    await expect(xai).toContainText('Ring: a square that soaks up attention');
    await expect(xai.getByRole('slider', { name: 'Compare the photo with what the AI paid attention to' })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(xai).toHaveAttribute('data-view', 'spots');
    await expect(page.getByTestId('fa-ai-xai-lesion-label')).toHaveText('Lesion area: a colour estimate, not the AI model');
    await expect(page.getByTestId('fa-ai-xai-severity')).toContainText(/Spots cover about [\d.]+% of the leaf\./);
    const sev = Number(await page.getByTestId('fa-ai-xai-severity').getAttribute('data-pct'));
    expect(sev, 'the drawn leaf has brown spots').toBeGreaterThan(1);
    expect(sev).toBeLessThan(30);
    await expect(page.getByTestId('fa-ai-xai-overlap')).toHaveAttribute('data-verdict', /^(mostly_spots|more_on_spots|other_leaf|outside_leaf)$/);
    await expect(page.getByTestId('fa-ai-xai-overlap')).toContainText(/The AI looked/);
    await axe(page, 'XAI spots view, light');

    await page.keyboard.press('End');
    await expect(xai).toHaveAttribute('data-view', 'occlusion');
    await expect(page.getByTestId('fa-ai-where')).toHaveText('Run the hide-and-check test');
    await expect(card).toBeVisible();
  });

  test('hide-and-check test: occlusion map with a progress bar, compared by keyboard', async ({ page }) => {
    await page.goto(REC);
    await readLeaf(page);
    await page.getByTestId('fa-ai-xai-tab-occlusion').click();
    await page.getByTestId('fa-ai-where').click();
    const cmp = page.locator('[data-testid="fa-ai-xai-cmp"][data-view="occlusion"]');
    await expect(page.getByTestId('fa-ai-where-progress').or(cmp).first()).toBeVisible(); // both, while it sharpens
    await expect(cmp).toBeVisible({ timeout: 300_000 }); // the quick 4 x 4 map comes first
    await expect(cmp).toHaveAttribute('data-where', 'phone');
    await expect(page.getByTestId('fa-ai-xai-say')).toContainText('We hid one square at a time');
    await expect(page.getByTestId('fa-ai-where-time')).toContainText(/Computed on this phone: [47] × [47] squares in [\d.]+ s/);
    const slider = cmp.getByRole('slider', { name: 'Compare the photo with the hide-and-check test' });
    await expect(slider).toHaveAttribute('aria-valuenow', '50');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '48');
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '100');
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    // the 7 x 7 pass sharpens the same comparer (the slider keeps its place)
    await expect(cmp).toHaveAttribute('data-grid', '7', { timeout: 300_000 });
    await expect(page.getByTestId('fa-ai-where-time')).toContainText('Computed on this phone: 7 × 7 squares');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${REC}&theme=dark`);
    await readLeaf(page);
    await expect(page.getByTestId('fa-ai-xai-cmp')).toBeVisible();
    await axe(page, 'photo AI result with the CAM view, dark');
    await page.getByTestId('fa-ai-xai-tab-attention').click();
    await axe(page, 'XAI attention view, dark');
    await page.getByTestId('fa-ai-xai-tab-spots').click();
    await axe(page, 'XAI spots view, dark');
  });

  test.describe('phone, 390 px, Bangla', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('no sideways scroll, Bangla answer and views, axe clean', async ({ page }) => {
      await page.goto('/app?sample=1&lang=bn&tab=photo');
      await readLeaf(page);
      await expect(page.getByTestId('fa-ai-outcome')).toHaveText(/রোগ নির্ণয়|আরও পরিষ্কার ছবি তুলুন|আপনার কর্মকর্তাকে জিজ্ঞেস করুন/);
      const xai = page.getByTestId('fa-ai-xai');
      await expect(xai.getByRole('tab', { name: 'এআই কোথায় দেখেছে' })).toHaveAttribute('aria-selected', 'true');
      await xai.getByRole('tab', { name: 'পাতার দাগ' }).click();
      await expect(page.getByTestId('fa-ai-xai-lesion-label')).toHaveText('দাগের এলাকা: রং দেখে অনুমান, এআই মডেল নয়');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
      await axe(page, 'photo AI, 390 px, bn');
    });
  });

  test('/try: the leaf tool shows the same views at once', async ({ page }) => {
    await page.goto('/try?lang=en');
    await page.getByTestId('try-leaf').scrollIntoViewIfNeeded();
    await page.getByTestId('leaf-test').click();
    await expect(page.getByTestId('leaf-result')).toBeVisible({ timeout: 180_000 });
    const xai = page.getByTestId('leaf-xai');
    await expect(page.getByTestId('leaf-xai-cmp')).toBeVisible({ timeout: 2_000 });
    await expect(xai).toHaveAttribute('data-view', 'cam');
    await xai.getByRole('tab', { name: 'Spots on the leaf' }).click();
    await expect(page.getByTestId('leaf-xai-lesion-label')).toHaveText('Lesion area: a colour estimate, not the AI model');
    await xai.getByRole('tab', { name: 'Hide-and-check test' }).click();
    await expect(page.getByTestId('leaf-map-state')).toHaveText('Warm squares: hiding them lowered the answer the most.', { timeout: 60_000 });
    await expect(page.locator('[data-testid="leaf-xai-cmp"][data-view="occlusion"]')).toBeVisible();
    await axe(page, '/try leaf tool with the views');
  });

  test('live API: the server reads the same photo, and the gate decides the route', async ({ page, request }) => {
    const demo = await request.get('/api/demo').catch(() => null); // proxied to the API (vite.config.ts); /health is not
    const live = !!demo && demo.ok() && (demo.headers()['content-type'] ?? '').includes('json');
    test.skip(!live, 'needs the live API behind the dev server (KRISHILOOP_API)');
    await page.goto('/app?lang=en&field=BD-SAMPLE-02&profile=demo-farmer-d&tab=photo');
    const card = await readLeaf(page);
    const outcome = await card.getAttribute('data-outcome');
    await page.getByTestId(outcome === 'diagnose' ? 'fa-ai-signed' : 'fa-ai-officer').click();
    const server = page.getByTestId('fa-ai-server');
    await expect(server).toBeVisible({ timeout: 60_000 });
    await expect(server).toHaveAttribute('data-route', /^(receipt|officer|retake)$/);
    await expect(page.getByTestId('fa-ai-case')).toHaveText(/^pc-[0-9a-f]{16}$/);
    // the same top disease on the phone and on the server (measured on 16 photos x 2 modes: top-1 32/32, outcome 32/32)
    await expect(page.getByTestId('fa-ai-agree')).toHaveAttribute('data-same-top', 'true');
    await expect(page.getByTestId('fa-ai-crop-field')).toHaveAttribute('aria-pressed', 'true');

    // the hide-and-check test on our server, because the farmer chose it: one call, labelled as computed there
    await page.getByTestId('fa-ai-xai-tab-occlusion').click();
    await page.getByTestId('fa-ai-where-server').click();
    await expect(page.getByTestId('fa-ai-where-server')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('fa-ai-where').click();
    const cmp = page.getByTestId('fa-ai-xai-cmp');
    await expect(cmp).toHaveAttribute('data-where', 'server', { timeout: 120_000 });
    await expect(page.getByTestId('fa-ai-where-time')).toContainText(/Computed on our server: 7 × 7 squares in [\d.]+ s/);
    await expect(page.getByTestId('fa-ai-where-time')).toContainText('The photo was not kept.');

    // the officer sees the server's own CAM and attention at once (stored with the case, same run as its reading)
    const route = await server.getAttribute('data-route');
    test.skip(route === 'receipt', 'a receipted photo is not kept, so the officer has no photo to draw on');
    await page.goto('/officer?tab=photos&lang=en');
    const offXai = page.getByTestId('off-ai-xai').first();
    await expect(offXai).toBeVisible({ timeout: 60_000 });
    await expect(offXai).toHaveAttribute('data-view', 'cam');
    await expect(page.getByTestId('off-ai-xai-cmp').first()).toBeVisible();
    await offXai.getByRole('tab', { name: 'Spots on the leaf' }).click();
    await expect(page.getByTestId('off-ai-xai-lesion-label').first()).toHaveText('Lesion area: a colour estimate, not the AI model');
    await offXai.getByRole('tab', { name: 'Hide-and-check test' }).click();
    await page.getByTestId('off-ai-where').first().click();
    await expect(page.locator('[data-testid="off-ai-xai-cmp"][data-view="occlusion"]').first()).toHaveAttribute('data-where', 'server', { timeout: 120_000 });
    await axe(page, 'officer photo case with the views');
  });
});
