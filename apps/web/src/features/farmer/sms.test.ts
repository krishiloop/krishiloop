import { describe, expect, it } from 'vitest';
import { buildSms, smsInfo, verifyCode } from './sms';

describe('the SMS preview counter', () => {
  it('counts plain English as GSM 7-bit: 160 per message, 153 per part', () => {
    expect(smsInfo('a'.repeat(160))).toEqual({ units: 160, unicode: false, limit: 160, segments: 1 });
    expect(smsInfo('a'.repeat(161)).segments).toBe(2);
    expect(smsInfo('a'.repeat(306)).segments).toBe(2);
    expect(smsInfo('a'.repeat(307)).segments).toBe(3);
  });

  it('counts the GSM extension characters twice', () => {
    expect(smsInfo('{x}').units).toBe(5);
    expect(smsInfo('€').units).toBe(2);
  });

  it('treats Bangla as Unicode: 70 per message, 67 per part', () => {
    const bn = 'এখন স্প্রে দরকার নেই';
    const i = smsInfo(bn);
    expect(i.unicode).toBe(true);
    expect(i.limit).toBe(70);
    expect(i.units).toBe(bn.length);
    expect(smsInfo('ক'.repeat(71)).segments).toBe(2);
    expect(smsInfo('ক'.repeat(134)).segments).toBe(2);
    expect(smsInfo('ক'.repeat(135)).segments).toBe(3);
  });

  it('builds the text from the receipt: decision, rule, short code, link', () => {
    const id = 'urn:uuid:9cece385-0039-4350-91a6-1bf84ade5d81';
    expect(verifyCode(id)).toBe('4ADE5D81');
    const text = buildSms('KrishiLoop: {decision}. Rule {rule}. Check receipt {code}: {url}', {
      decision: 'No spray needed',
      rule: 'R-BDR-002 v1',
      code: verifyCode(id),
      url: 'https://example.org/verify/9cece385-0039-4350-91a6-1bf84ade5d81',
    });
    expect(text).toBe('KrishiLoop: No spray needed. Rule R-BDR-002 v1. Check receipt 4ADE5D81: https://example.org/verify/9cece385-0039-4350-91a6-1bf84ade5d81');
    expect(smsInfo(text)).toMatchObject({ unicode: false, segments: 1 });
  });
});
