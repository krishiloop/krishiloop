import type { Lang } from './i18n/index';

/** Intl locales per UI language. Bangla uses Bangla digits (bn-BD); English uses day-month order (en-GB). */
export const LOCALES: Record<Lang, string> = { en: 'en-GB', bn: 'bn-BD', hi: 'hi-IN', sw: 'sw-KE' };

export function fmtNum(n: number, lang: Lang, opts?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(LOCALES[lang], opts).format(n);
  } catch {
    return String(n);
  }
}

/** "2026-10-27" is a calendar date, not an instant: parse it at local midnight so it never slides a day. */
export function parseDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
}

export type DateStyle = 'short' | 'long' | 'weekday' | 'dayNum' | 'time' | 'datetime';

export function fmtDate(iso: string | Date, lang: Lang, style: DateStyle = 'short'): string {
  const d = typeof iso === 'string' ? parseDate(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const opt: Record<DateStyle, Intl.DateTimeFormatOptions> = {
    short: { day: 'numeric', month: 'short' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    weekday: { weekday: 'short' },
    dayNum: { day: 'numeric' },
    time: { hour: '2-digit', minute: '2-digit' },
    datetime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
  };
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], opt[style]).format(d);
  } catch {
    return d.toDateString();
  }
}

const SYMBOL: Record<string, Partial<Record<Lang, string>> & { _?: string }> = {
  BDT: { en: 'Tk', bn: '৳', hi: 'Tk', sw: 'Tk' },
  KES: { en: 'KSh', bn: 'KSh', hi: 'KSh', sw: 'KSh' },
  INR: { _: '₹' },
  USD: { _: '$' },
};

export function currencySymbol(code: string, lang: Lang): string {
  const s = SYMBOL[code];
  return (s && (s[lang] ?? s._)) || code;
}

export function fmtMoneyRange(min: number, max: number, currency: string, lang: Lang): string {
  const sym = currencySymbol(currency, lang);
  const f = (n: number) => fmtNum(Math.round(n), lang);
  return min === max ? `${sym} ${f(min)}` : `${sym} ${f(min)}–${f(max)}`;
}

/** Last n characters of a credential id, for compact display. */
export const shortId = (id: string, n = 8) => id.replace(/^urn:uuid:/, '').slice(-n);

/** BCP-47 text picker: prefers the UI language, falls back to English, then anything. */
export function pickText(map: Record<string, string> | undefined, lang: Lang): { text: string; lang: string; fellBack: boolean } {
  if (!map) return { text: '', lang: 'en', fellBack: false };
  if (map[lang]) return { text: map[lang]!, lang, fellBack: false };
  if (map.en) return { text: map.en, lang: 'en', fellBack: lang !== 'en' };
  const first = Object.entries(map)[0];
  return first ? { text: first[1], lang: first[0], fellBack: true } : { text: '', lang: 'en', fellBack: false };
}

export function humanize(snake: string): string {
  return snake.replace(/_/g, ' ');
}
