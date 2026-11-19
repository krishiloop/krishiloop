import { createStore } from './store';
import { queryParam, readStore, writeStore } from './storage';

/** Cream (light, the deck's pages) is the default; Forest (dark) reads best in sunlight and is one tap away. Receipts stay paper in both. */
export type Theme = 'dark' | 'light';

function initial(): Theme {
  const forced = queryParam('theme');
  if (forced === 'light' || forced === 'dark') return forced;
  const stored = readStore('kl.theme');
  return stored === 'dark' ? 'dark' : 'light';
}

export const themeStore = createStore<Theme>(typeof window === 'undefined' ? 'light' : initial());

function apply(t: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', t === 'dark' ? '#0e2419' : '#faf6ee'));
}
apply(themeStore.get());
themeStore.subscribe(() => apply(themeStore.get()));

export function setTheme(t: Theme) {
  if (queryParam('theme') == null) writeStore('kl.theme', t);
  themeStore.set(t);
}
export const toggleTheme = () => setTheme(themeStore.get() === 'dark' ? 'light' : 'dark');
export const useTheme = () => themeStore.use();
