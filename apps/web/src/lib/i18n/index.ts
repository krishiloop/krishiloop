import { useCallback } from 'react';
import { createStore } from '../store';
import { queryParam, readStore, writeStore } from '../storage';
import en from './en';

export type Lang = 'en' | 'bn' | 'hi' | 'sw';
export type Key = keyof typeof en;
type Dict = Partial<Record<Key, string>>;

export const LANGS: { code: Lang; native: string; english: string; preview: boolean }[] = [
  { code: 'en', native: 'English', english: 'English', preview: false },
  { code: 'bn', native: 'বাংলা', english: 'Bangla', preview: false },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', preview: true },
  { code: 'sw', native: 'Kiswahili', english: 'Swahili', preview: true },
];

const dicts: Record<Lang, Dict | undefined> = { en, bn: undefined, hi: undefined, sw: undefined };

async function load(lang: Lang): Promise<Dict> {
  const hit = dicts[lang];
  if (hit) return hit;
  // each language is its own chunk: the English app never downloads the others
  const mod = lang === 'bn' ? await import('./bn') : lang === 'hi' ? await import('./hi') : await import('./sw');
  dicts[lang] = mod.default as Dict;
  return mod.default as Dict;
}

function initialLang(): Lang {
  const q = queryParam('lang');
  const stored = readStore('kl.lang');
  const pick = q ?? stored;
  if (pick === 'en' || pick === 'bn' || pick === 'hi' || pick === 'sw') return pick;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}

export const langStore = createStore<Lang>(typeof window === 'undefined' ? 'en' : 'en');

function applyDocLang(l: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/** Load the starting language before the first render so Bangla visitors never see a flash of English. */
export async function bootLang(): Promise<void> {
  const l = initialLang();
  if (l !== 'en') await load(l);
  langStore.set(l);
  applyDocLang(l);
}

export async function setLang(l: Lang): Promise<void> {
  await load(l);
  if (queryParam('lang') == null) writeStore('kl.lang', l);
  langStore.set(l);
  applyDocLang(l);
}

export type Params = Record<string, string | number>;

function interpolate(s: string, params?: Params): string {
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : s;
}

export function translate(lang: Lang, key: Key, params?: Params): string {
  const s = dicts[lang]?.[key] ?? en[key] ?? key; // a key the dictionaries lack shows as itself, never crashes
  return interpolate(s, params);
}

/** True when this key has no translation in `lang` (so the English text is shown). */
export const isFallback = (lang: Lang, key: Key) => lang !== 'en' && !dicts[lang]?.[key];

export const t = (key: Key, params?: Params) => translate(langStore.get(), key, params);

export function useLang(): Lang {
  return langStore.use();
}

/** `const { t, lang } = useI18n()`: re-renders when the language changes. */
export function useI18n() {
  const lang = langStore.use();
  const tt = useCallback((key: Key, params?: Params) => translate(lang, key, params), [lang]);
  return { t: tt, lang };
}
