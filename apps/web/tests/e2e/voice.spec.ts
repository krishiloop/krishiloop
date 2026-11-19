import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Our pre-made voice in the farmer app, in RECORDED mode (`?sample=1`, deterministic, no backend):
 *  - "Hear" on a Bangla receipt whose exact text has a pre-made clip plays OUR clip, labelled (Google Gemini, made ahead
 *    of time, not yet checked by a native speaker); HTMLMediaElement.play is stubbed, so nothing is really played;
 *  - a RECALLED receipt never plays its withdrawn advice: it plays (or shows) the recall notice instead;
 *  - a text without a clip falls back to the browser voice, and to "no voice" when there is none;
 *  - the sovereign microphone: MediaRecorder -> POST /api/voice/asr -> the normal Ask flow (fake recorder, fake API).
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const CLIP_002 = '/audio/bn/gemini38-cd8e51c6c42c4a3a.ogg'; // R-BDR-002 v1, "এখন স্প্রে দরকার নেই: …"
const RECALL_BN = '/audio/bn/gemini38-dd54c5fc770ce6d8.ogg'; // the Bangla recall notice (fa.voice.recalledSay)
const Q_BN = 'ধানে বাদামি গাছফড়িং দেখছি, এখন কি স্প্রে করব?'; // the recorded Bangla Ask question

type W = Window & { __played: string[]; __spoken: string[] };

/** No Bangla voice on this "device"; play() and speak() only record what they were given. */
async function stubAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as W;
    w.__played = [];
    w.__spoken = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__played.push(new URL(this.src).pathname);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = () => undefined;
    Object.defineProperty(window.speechSynthesis, 'getVoices', { value: () => [] });
    Object.defineProperty(window.speechSynthesis, 'speak', { value: (u: SpeechSynthesisUtterance) => w.__spoken.push(u.text) });
  });
}
const played = (page: Page) => page.evaluate(() => (window as unknown as W).__played);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as W).__spoken);

async function settle(page: Page) {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]));
}
async function axe(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

test.describe('our own Bangla voice (recorded mode)', () => {
  test.beforeEach(async ({ page }) => stubAudio(page));

  test('Hear on Today plays our clip for the exact R-BDR-002 v1 sentence, labelled, and Stop stops it', async ({ page }) => {
    await page.goto('/app?sample=1&lang=bn');
    await expect(page.getByTestId('fa-decision')).toContainText('স্প্রে দরকার নেই');
    await page.getByTestId('fa-hear').click();
    await expect.poll(() => played(page)).toEqual([CLIP_002]);
    const label = page.getByTestId('fa-why').getByTestId('fa-voice-ours');
    await expect(label).toContainText('জেমিনি');
    await expect(label).toContainText('বাংলাভাষী');
    await expect(page.getByTestId('fa-hear')).toHaveAttribute('aria-pressed', 'true');
    expect(await spoken(page)).toEqual([]); // the browser voice was not used
    await page.getByTestId('fa-hear').click();
    await expect(page.getByTestId('fa-hear')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the receipt sheet and the Ask answer play the same clip', async ({ page }) => {
    await page.goto('/app?sample=1&lang=bn');
    await page.getByTestId('fa-decision').getByRole('button', { name: 'রসিদ খুলুন' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('.stamp')).toHaveText(/খাঁটি/);
    await sheet.getByTestId('fa-rc-read').click();
    await expect.poll(() => played(page)).toEqual([CLIP_002]);
    await expect(sheet.getByTestId('fa-rc-voice').getByTestId('fa-voice-ours')).toContainText('জেমিনি');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await page.getByRole('tab', { name: 'প্রশ্ন' }).click();
    await page.getByTestId('fa-ask-chip').first().click();
    await expect(page.getByTestId('fa-answer')).toContainText('R-BDR-002 v1');
    await page.getByTestId('fa-answer-read').click();
    await expect.poll(() => played(page)).toEqual([CLIP_002, CLIP_002]);
    await expect(page.getByTestId('fa-answer-voice').getByTestId('fa-voice-ours')).toBeVisible();
  });

  test('RECALLED: the withdrawn advice is never played; the recall notice is played and shown instead', async ({ page }) => {
    await page.goto('/app?sample=1&lang=bn');
    await expect(page.getByTestId('fa-decision')).toBeVisible();
    await page.getByRole('tab', { name: 'রসিদ' }).click();
    await expect(page.getByTestId('fa-receipt-row').first()).toHaveAttribute('data-status', 'authentic');
    await page.evaluate("import('/src/lib/api/mocks.ts').then((m) => m.simulateRecall('R-BDR-002', 1))");
    const row = page.locator('[data-testid="fa-receipt-row"][data-status="recalled"]');
    await expect(row).toHaveCount(1);
    await row.getByRole('button').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('.stamp')).toHaveText(/বাতিল/);
    await sheet.getByTestId('fa-rc-read').click();
    const notice = sheet.getByTestId('fa-voice-notice');
    await expect(notice).toContainText('এই পরামর্শ বাতিল হয়েছে');
    await expect(notice).not.toContainText('স্প্রে দরকার নেই');
    await expect.poll(() => played(page)).toEqual([RECALL_BN]); // the notice's own clip, never CLIP_002
    expect(await spoken(page)).toEqual([]);
  });

  test('a text without a shipped clip gets no clip: no Bangla voice here, so it says so', async ({ page }) => {
    // R-BDR-006's clips are taken out of the manifest here, so this is the "no clip" path whatever today's build ships
    await page.route('**/audio/manifest.json', async (r) => {
      const m = (await (await r.fetch()).json()) as { clips: { rule_id?: string }[] };
      await r.fulfill({ json: { ...m, clips: m.clips.filter((c) => c.rule_id !== 'R-BDR-006') } });
    });
    await page.goto('/app?sample=1&lang=bn&field=BD-SAMPLE-01&profile=demo-farmer-d');
    await page.getByTestId('fa-action-row').filter({ hasText: 'জমিতে পানি জমে থাকতে দেবেন না' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('.stamp')).toHaveText(/খাঁটি/);
    await sheet.getByTestId('fa-rc-read').click();
    await expect(sheet.getByTestId('fa-rc-voice')).toContainText('বাংলা কণ্ঠ নেই');
    expect(await played(page)).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe: our voice label and the recall notice, ${theme} theme`, async ({ page }) => {
      await page.goto(`/app?sample=1&lang=bn&theme=${theme}`);
      await page.getByTestId('fa-hear').click();
      await expect(page.getByTestId('fa-voice-ours')).toBeVisible();
      await axe(page, 'Today with our voice label');
      await page.getByRole('tab', { name: 'রসিদ' }).click();
      await page.evaluate("import('/src/lib/api/mocks.ts').then((m) => m.simulateRecall('R-BDR-002', 1))");
      await page.locator('[data-testid="fa-receipt-row"][data-status="recalled"]').getByRole('button').first().click();
      await page.getByRole('dialog').getByTestId('fa-rc-read').click();
      await expect(page.getByTestId('fa-voice-notice')).toBeVisible();
      await page.waitForTimeout(1200);
      await axe(page, 'recalled receipt with the notice');
    });
  }
});

test.describe('sovereign microphone (fake recorder, fake API)', () => {
  test('records with MediaRecorder, posts the audio to /api/voice/asr, and the text goes into the normal Ask flow', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => ({ getTracks: () => [{ stop: () => undefined }] }) });
      class FakeRecorder extends EventTarget {
        static isTypeSupported(t: string) {
          return t.startsWith('audio/webm');
        }
        state = 'inactive';
        mimeType: string;
        constructor(_s: unknown, o?: { mimeType?: string }) {
          super();
          this.mimeType = o?.mimeType ?? 'audio/webm';
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          const e = new Event('dataavailable');
          Object.defineProperty(e, 'data', { value: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], { type: 'audio/webm' }) });
          this.dispatchEvent(e);
          this.dispatchEvent(new Event('stop'));
        }
      }
      (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
    });
    const posted: { type: string; bytes: number }[] = [];
    // no live API (only /api/..., not the dev server's /src/lib/api/ modules): the app answers from its recordings
    await page.route(/^https?:\/\/[^/]+\/api\/(?!voice\/)/, (r) => r.abort());
    await page.route('**/api/voice/health', (r) => r.fulfill({ json: { available: true, reason: null, model: 'omni-ctc-1b', where: 'our own voice service on this server (loopback only)' } }));
    await page.route('**/api/voice/asr', async (r) => {
      posted.push({ type: r.request().headers()['content-type'] ?? '', bytes: r.request().postDataBuffer()?.length ?? 0 });
      await r.fulfill({ json: { text: Q_BN, language: 'bn', model: 'omniASR_CTC_1B_v2 (native PyTorch port)', audio_s: 2.1, processing_ms: 41, where: 'x' } });
    });

    await page.goto('/app?lang=bn&tab=ask');
    const mic = page.getByTestId('fa-mic');
    await expect(mic).toHaveAttribute('data-via', 'own');
    await expect(page.getByTestId('fa-stt-via')).toContainText('Omnilingual CTC-1B');
    await mic.click();
    await expect(page.getByTestId('fa-voice-consent')).toContainText('আমাদের নিজের সার্ভারে');
    await page.getByTestId('fa-voice-allow').click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await mic.click(); // stop: the recording goes to our server
    await expect(page.getByTestId('fa-answer')).toContainText('R-BDR-002 v1');
    await expect(page.getByTestId('fa-ask-input')).toHaveValue(Q_BN);
    expect(posted).toEqual([{ type: 'audio/webm', bytes: 8 }]);
    await expect(page.getByTestId('fa-try-voice')).toHaveAttribute('data-done', 'true');
  });

  test('without our voice service the microphone stays with the browser, and says where the audio goes', async ({ page }) => {
    await page.route('**/api/voice/health', (r) => r.fulfill({ json: { available: false, reason: 'not configured', model: null, where: 'x' } }));
    await page.goto('/app?sample=1&lang=bn&tab=ask');
    await expect(page.getByTestId('fa-mic')).toHaveAttribute('data-via', 'browser');
    await expect(page.getByTestId('fa-stt-via')).toContainText('ব্রাউজার');
  });
});
