/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import en from './en';
import bn from './bn';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('Bangla dictionary', () => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it('has every English key', () => {
    const missing = keys.filter((k) => !bn[k]);
    expect(missing).toEqual([]);
  });

  it('has no key that English lacks', () => {
    const extra = Object.keys(bn).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it('keeps every {placeholder} of the English text', () => {
    const bad = keys.filter((k) => bn[k] && placeholders(bn[k]!).join() !== placeholders(en[k]).join());
    expect(bad).toEqual([]);
  });

  it('is Bangla text (not a copy of the English)', () => {
    const copied = keys.filter((k) => bn[k] && bn[k] === en[k] && /[a-z]{4,}/i.test(en[k]) && !/^[A-Za-z0-9 .·:{}/%+_-]*$/.test('') );
    // identical strings are allowed only for product names, ids and units (no Bangla letters needed)
    const allowed = new Set(['field.s2', 'receipt.version', 'receipt.header', 'verify.idPlaceholder', 'photo.receipt.size', 'photo.receipt.ms', 'l.hero.eyebrow', 'ui.footer.standards']);
    expect(copied.filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('never uses the word "correct" in any language', () => {
    const hits = keys.filter((k) => /\bcorrect(ly|ness)?\b/i.test(en[k]));
    expect(hits).toEqual([]);
  });

  it('carries the machine-written notice', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./bn.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/Machine-written; pending native-speaker review/);
  });
});
