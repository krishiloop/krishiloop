/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findNoticeClip, findRuleClip, normaliseSpoken, parseManifest, planRead, sha256Hex, type ClipManifest, type ReadRequest } from './speechClips';
import en from './i18n/en';
import bn from './i18n/bn';
import plans from '../data/recorded/plans.json';

const AUDIO = new URL('../../public/audio/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('manifest.json', AUDIO), 'utf8')) as unknown;
const manifest = parseManifest(raw)!;

// R-BDR-002 v1 action.title.bn, as the rule file and the recorded plan carry it
const R002 = 'এখন স্প্রে দরকার নেই: পোকার সংখ্যা সীমার নিচে। কয\u09BCেক দিন পর আবার গুনে দেখুন।';
const req = (over: Partial<ReadRequest> = {}): ReadRequest => ({
  text: R002,
  textLang: 'bn',
  lead: 'স্প্রে নয\u09BC',
  ruleId: 'R-BDR-002',
  version: 1,
  status: 'authentic',
  notice: bn['fa.voice.recalledSay'],
  noticeLang: 'bn',
  ...over,
});

describe('the spoken-text key (same rules as ml/voice/readbacks.py)', () => {
  it('unifies the nukta letters (precomposed য\u09BC and য + nukta) through NFC', () => {
    expect(normaliseSpoken('\u09DF')).toBe(normaliseSpoken('য\u09BC'));
    expect(normaliseSpoken('জমিতে পানি জমে')).toBe('জমিতে পানি জমে');
  });
  it('collapses whitespace (NBSP, tabs, newlines) and drops invisible no-ops, but keeps punctuation and ZWJ', () => {
    expect(normaliseSpoken('  এখন\u00A0স্প্রে \n\t দরকার\u200B নেই।  ')).toBe('এখন স্প্রে দরকার নেই।');
    expect(normaliseSpoken('a\u00ADb\uFEFF')).toBe('ab');
    expect(normaliseSpoken('র\u200D্য')).toContain('\u200D');
    expect(normaliseSpoken('নেই।')).not.toBe(normaliseSpoken('নেই'));
  });
});

describe('the shipped manifest (apps/web/public/audio)', () => {
  const voiceOf = (raw as { voice: { fallback?: { model?: string; attribution?: string } } }).voice;
  const GEMINI = 'gemini:gemini-3.8-flash-tts:Kore';
  const SVARA = 'svara:kenpath/svara-tts-v1';
  // every voice a clip may carry, and its file prefix (ml/voice/gemini_readbacks.py MODELS; the svara stand-ins)
  const PREFIX: Record<string, string> = {
    [GEMINI]: 'gemini38',
    'gemini:gemini-3.8-flash-lite-tts:Kore': 'gemini38l',
    'gemini:gemini-3.1-flash-tts-preview:Kore': 'gemini31',
    [SVARA]: 'svara-m',
  };
  const isGemini = (v?: string) => !!v && v.startsWith('gemini:');

  it('is well formed: Gemini 3.8 Flash TTS, the earlier svara voice credited "Built with Llama", pending a native listen', () => {
    expect(manifest.clips.length).toBe((raw as { clips: unknown[] }).clips.length);
    expect(manifest.voice.model).toBe('Google gemini-3.8-flash-tts');
    expect(manifest.voice.review).toMatch(/pending/);
    expect(voiceOf.fallback?.attribution).toBe('Built with Llama');
    for (const c of manifest.clips) expect(Object.keys(PREFIX)).toContain(c.voice);
    expect(manifest.clips.filter((c) => isGemini(c.voice)).length).toBeGreaterThan(manifest.clips.length / 2);
  });

  it('every hash is the TypeScript hash of its text (the Python build and the app agree)', async () => {
    for (const c of manifest.clips) {
      expect(c.text).toBe(normaliseSpoken(c.text));
      expect(await sha256Hex(c.text)).toBe(c.text_sha256);
      expect(c.file).toBe(`${c.lang}/${PREFIX[c.voice!]}-${c.text_sha256.slice(0, 16)}.ogg`);
    }
  });

  it('a svara clip only stands in: a Bangla rule with no passing Gemini clip', () => {
    const key = (c: { kind: string; rule_id?: string; notice_id?: string; version?: number; lang: string }) => `${c.kind} ${c.rule_id ?? c.notice_id} ${c.version} ${c.lang}`;
    const gem = new Set(manifest.clips.filter((c) => isGemini(c.voice)).map(key));
    for (const c of manifest.clips.filter((c) => c.voice === SVARA)) {
      expect([c.kind, c.lang]).toEqual(['rule', 'bn']);
      expect(gem.has(key(c))).toBe(false);
    }
  });

  it('the recall and cannot-check notices have a clip in Bangla and English, word for word the app’s notice', async () => {
    for (const [id, k] of [['recalled', 'fa.voice.recalledSay'], ['invalid', 'fa.voice.invalidSay']] as const) {
      expect((await findNoticeClip(manifest, { id, lang: 'bn', text: bn[k] }))?.voice).toBe(GEMINI);
      expect((await findNoticeClip(manifest, { id, lang: 'en', text: en[k] }))?.voice).toBe(GEMINI);
    }
  });

  it('ships only files it lists, each the size it says, and stays small', () => {
    // a clip downloads only when someone taps Hear (the service worker never precaches audio), so the budget is per clip
    const files = new Set(manifest.clips.map((c) => c.file));
    let total = 0;
    for (const f of files) {
      const size = statSync(new URL(f, AUDIO)).size;
      expect(size).toBe(manifest.clips.find((c) => c.file === f)!.bytes);
      expect(size).toBeLessThan(80 * 1024);
      total += size;
    }
    expect(total).toBeLessThan(2.5 * 1024 * 1024);
  });

  it('ships no clip whose round trip was worse than 10 % CER', () => {
    for (const c of manifest.clips) expect(c.roundtrip_cer_pct ?? 100).toBeLessThanOrEqual(10);
  });

  it('holds back R-PLB-009 in Bangla: its round trip was 14 % CER, so it gets no clip', async () => {
    expect(manifest.clips.some((c) => c.rule_id === 'R-PLB-009' && c.lang === 'bn')).toBe(false);
  });

  it('rejects a wrong schema and any file outside /audio/<lang>/', () => {
    expect(parseManifest({ ...(raw as object), schema: 'other' })).toBeNull();
    const bad = { ...(raw as ClipManifest), clips: [{ ...manifest.clips[0]!, file: '../../secret.ogg' }, { ...manifest.clips[0]!, file: 'https://x.example/a.ogg' }] };
    expect(parseManifest(bad)!.clips).toEqual([]);
  });
});

describe('a clip plays only for its exact text', () => {
  it('finds R-BDR-002 v1 for its exact sentence, also with stray spaces or a decomposed nukta', async () => {
    const hit = await findRuleClip(manifest, { ruleId: 'R-BDR-002', version: 1, lang: 'bn', text: R002 });
    expect(hit?.file).toBe('bn/gemini38-cd8e51c6c42c4a3a.ogg');
    const messy = ` ${R002.replace(' ', '\u00A0 ').normalize('NFD')}\n`;
    expect((await findRuleClip(manifest, { ruleId: 'R-BDR-002', version: 1, lang: 'bn', text: messy }))?.file).toBe(hit?.file);
  });

  it('never for another text, version, rule or language', async () => {
    const k = { ruleId: 'R-BDR-002', version: 1, lang: 'bn', text: R002 };
    expect(await findRuleClip(manifest, { ...k, text: R002.replace('কয\u09BCেক', 'দুই') })).toBeNull();
    expect(await findRuleClip(manifest, { ...k, text: R002.slice(0, -1) })).toBeNull(); // only the danda differs
    expect(await findRuleClip(manifest, { ...k, version: 2 })).toBeNull();
    expect(await findRuleClip(manifest, { ...k, ruleId: 'R-BDR-001' })).toBeNull();
    expect(await findRuleClip(manifest, { ...k, lang: 'en' })).toBeNull();
    expect(await findRuleClip(manifest, { ...k, text: `স্প্রে নয\u09BC. ${R002}` })).toBeNull(); // the decision word is not in the clip
  });

  it('matches what the recorded Bangla plans really read: every rule they use has a checked clip', async () => {
    const found: Record<string, boolean> = {};
    for (const plan of Object.values(plans as Record<string, { actions?: { title: { bn?: string }; receipt: { rule_refs: { rule_id: string; version: number }[] } }[] }>)) {
      for (const a of plan.actions ?? []) {
        const ref = a.receipt.rule_refs[0]!;
        if (a.title.bn) found[`${ref.rule_id} v${ref.version}`] = !!(await findRuleClip(manifest, { ruleId: ref.rule_id, version: ref.version, lang: 'bn', text: a.title.bn }));
      }
    }
    expect(found).toEqual({
      'R-BDR-001 v1': true, 'R-BDR-002 v1': true, 'R-BDR-005 v1': true, 'R-BDR-006 v1': true, 'R-BDR-009 v1': true, 'R-BDR-010 v1': true,
      'R-PLB-006 v1': true, 'R-PLB-010 v1': true, 'R-PLB-011 v2': true,
    });
  });
});

describe('recall safety: what "Hear" plans to do', () => {
  it('a RECALLED receipt plans the recall notice, never its advice, although a clip for that advice exists', async () => {
    const p = await planRead(req({ status: 'recalled' }), manifest);
    expect(p.kind).toBe('notice');
    if (p.kind !== 'notice') return;
    expect(p.text).toBe(bn['fa.voice.recalledSay']);
    expect(p.text).not.toContain(R002);
    expect(p.clip?.kind ?? 'notice').toBe('notice'); // if a clip is ever found here it is the notice's, never the rule's
  });

  it('a receipt that cannot be verified is not read either', async () => {
    const p = await planRead(req({ status: 'invalid', notice: bn['fa.voice.invalidSay'] }), manifest);
    expect(p).toMatchObject({ kind: 'notice', text: bn['fa.voice.invalidSay'], clip: null });
  });

  it('an authentic (or not yet checkable) receipt plays our clip; without one, the browser reads word and sentence', async () => {
    expect((await planRead(req(), manifest)).kind).toBe('clip');
    expect((await planRead(req({ status: 'unknown' }), manifest)).kind).toBe('clip');
    expect(await planRead(req(), null)).toEqual({ kind: 'browser', text: `স্প্রে নয\u09BC. ${R002}`, lang: 'bn' });
    expect(await planRead(req({ version: 2 }), manifest)).toEqual({ kind: 'browser', text: `স্প্রে নয\u09BC. ${R002}`, lang: 'bn' });
  });

  it('the fixed recall notice for the next GPU run is word for word the app’s notice', () => {
    const notices = JSON.parse(readFileSync(new URL('../../../../ml/voice/readback_notices.json', import.meta.url), 'utf8')) as { notices: { key: string; text: string }[] };
    for (const n of notices.notices) expect(n.text).toBe(bn[n.key as keyof typeof bn]);
  });
});
