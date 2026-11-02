/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../lib/i18n/en';
import bn from '../../lib/i18n/bn';
import { buildSms, smsInfo } from '../farmer/sms';
import { codePath, displayCode, normalizeCode } from './code';

/**
 * Parity with the server (services/reach/): the SMS a receipt becomes, and the short-code typing rules. The fixtures are
 * shared with tests/test_reach.py, so the web preview and the server's SMS give the same text for the same receipt.
 */
interface Fixture {
  templates: Record<'en' | 'bn', string>;
  decision_words: Record<'en' | 'bn', Record<string, string>>;
  kind_words: Record<'en' | 'bn', Record<string, string>>;
  receipts: {
    lang: 'en' | 'bn';
    advice: { decision?: string; kind?: string };
    rule: { rule_id: string; version: number };
    code: string;
    public_base: string;
    expected: { text: string; units: number; unicode: boolean; limit: number; segments: number };
  }[];
  raw: { template: string; parts: { decision: string; rule: string; code: string; url: string }; expected: { text: string; units: number; unicode: boolean; limit: number; segments: number } }[];
  codes: { typed: string; code: string }[];
}
const fx = JSON.parse(readFileSync(new URL('../../../../../services/reach/fixtures/sms_parity.json', import.meta.url), 'utf8')) as Fixture;
const dicts = { en: en as Record<string, string>, bn: bn as Record<string, string> };

describe('the receipt SMS: web preview and server give the same text', () => {
  it('the server uses the web dictionaries’ template and words', () => {
    for (const lang of ['en', 'bn'] as const) {
      expect(fx.templates[lang]).toBe(dicts[lang]['fa.sms.template']);
      for (const [k, v] of Object.entries(fx.decision_words[lang])) expect(v).toBe(dicts[lang][`ui.decision.${k}`]);
      for (const [k, v] of Object.entries(fx.kind_words[lang])) expect(v).toBe(dicts[lang][`ui.kind.${k}`]);
    }
  });

  it('builds each fixture receipt’s SMS exactly as the server does, with the short code and its /v/ link', () => {
    for (const c of fx.receipts) {
      const d = dicts[c.lang];
      const decision = c.advice.decision ? d[`ui.decision.${c.advice.decision}`]! : d[`ui.kind.${c.advice.kind ?? 'other'}`]!;
      const code = displayCode(c.code);
      const text = buildSms(d['fa.sms.template']!, { decision, rule: `${c.rule.rule_id} v${c.rule.version}`, code, url: `${c.public_base}${codePath(c.code)}` });
      expect({ text, ...smsInfo(text) }).toEqual(c.expected);
    }
  });

  it('fills, collapses and counts exactly as the server for edge cases (GSM extension, Bangla, emoji)', () => {
    for (const c of fx.raw) {
      const text = buildSms(c.template, c.parts);
      expect({ text, ...smsInfo(text) }).toEqual(c.expected);
    }
  });
});

describe('short codes: typed on the web as on the server', () => {
  it('reads any case, any dash, O as 0 and I/L as 1, and nothing else', () => {
    for (const c of fx.codes) expect([c.typed, normalizeCode(c.typed)]).toEqual([c.typed, c.code]);
  });

  it('takes a whole /v/ link too, and shows codes in two groups', () => {
    expect(normalizeCode('https://krishiloop.example/v/7kq2-mx4p?x=1')).toBe('7KQ2MX4P');
    expect(displayCode('7KQ2MX4P')).toBe('7KQ2-MX4P');
    expect(codePath('7KQ2MX4P')).toBe('/v/7KQ2-MX4P');
  });
});
