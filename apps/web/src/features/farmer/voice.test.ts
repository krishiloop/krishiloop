/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bn from '../../lib/i18n/bn';
import { readAloud, receiptStatus, stopReading } from './voice';
import { setStatus } from './receipts';
import type { ReadRequest } from '../../lib/speechClips';

/**
 * readAloud end to end with a fake <audio> (no browser voice exists in Node): the recall case must never construct an
 * audio element for the withdrawn advice.
 */
const manifest = readFileSync(new URL('../../../public/audio/manifest.json', import.meta.url), 'utf8');
const clips = (JSON.parse(manifest) as { clips: { kind: string; notice_id?: string; lang: string; file: string }[] }).clips;
const RECALL_BN = `/audio/${clips.find((c) => c.kind === 'notice' && c.notice_id === 'recalled' && c.lang === 'bn')!.file}`;
const GEMINI = 'gemini:gemini-3.8-flash-tts:Kore';
const R002 = 'এখন স্প্রে দরকার নেই: পোকার সংখ্যা সীমার নিচে। কয়েক দিন পর আবার গুনে দেখুন।';
const req = (over: Partial<ReadRequest> = {}): ReadRequest => ({
  text: R002,
  textLang: 'bn',
  lead: 'স্প্রে নয়',
  ruleId: 'R-BDR-002',
  version: 1,
  status: 'authentic',
  notice: bn['fa.voice.recalledSay'],
  noticeLang: 'bn',
  ...over,
});

let played: string[];

beforeEach(() => {
  played = [];
  class FakeAudio {
    src: string;
    constructor(src = '') {
      this.src = src;
    }
    canPlayType() {
      return 'probably';
    }
    addEventListener() {}
    pause() {}
    play() {
      played.push(this.src);
      return Promise.resolve();
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/audio/manifest.json' ? new Response(manifest, { status: 200 }) : new Response('', { status: 404 }))));
});

afterEach(() => {
  stopReading();
  vi.unstubAllGlobals();
});

describe('readAloud', () => {
  it('plays our clip for the exact R-BDR-002 v1 sentence and labels it ours', async () => {
    const o = await readAloud(req(), () => undefined);
    expect(o).toEqual({ state: 'playing', via: 'ours', notice: null, lang: 'bn', clipVoice: GEMINI });
    expect(played).toEqual(['/audio/bn/gemini38-cd8e51c6c42c4a3a.ogg']);
  });

  it('RECALLED: no audio of the withdrawn advice; our recall-notice clip is read instead', async () => {
    const o = await readAloud(req({ status: 'recalled' }), () => undefined);
    expect(played).toEqual([RECALL_BN]);
    expect(played.join()).not.toContain('cd8e51c6c42c4a3a'); // never the advice's clip
    expect(o).toEqual({ state: 'playing', via: 'ours', notice: bn['fa.voice.recalledSay'], lang: 'bn', clipVoice: GEMINI });
  });

  it('RECALLED with a notice we have no clip for: nothing is played, the notice is shown (no Bangla voice here)', async () => {
    const o = await readAloud(req({ status: 'recalled', notice: 'এই পরামর্শ আর চলবে না।' }), () => undefined);
    expect(played).toEqual([]);
    expect(o).toEqual({ state: 'shown', via: null, notice: 'এই পরামর্শ আর চলবে না।', lang: 'bn' });
  });

  it('a changed text gets no clip and falls back (here: no browser voice at all)', async () => {
    const o = await readAloud(req({ text: R002.replace('কয়েক', 'দুই') }), () => undefined);
    expect(played).toEqual([]);
    expect(o).toEqual({ state: 'unsupported', via: null, notice: null, lang: 'bn' });
  });

  it('a browser that cannot play Ogg Opus falls back instead of failing silently', async () => {
    vi.stubGlobal(
      'Audio',
      class {
        canPlayType() {
          return '';
        }
      },
    );
    expect((await readAloud(req(), () => undefined)).via).toBeNull();
  });
});

describe('receiptStatus', () => {
  it('a recall this tab already knows about wins without asking the network', async () => {
    const id = 'urn:uuid:00000000-0000-4000-8000-00000000abcd';
    setStatus(id, { s: 'recalled', rules: ['R-BDR-002 v1'], at: 0 });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await receiptStatus(id)).toBe('recalled');
    expect(f).not.toHaveBeenCalled();
    expect(await receiptStatus(undefined, 'recalled')).toBe('recalled');
  });
});
