import { createStore } from './store';
import { queryParam, readStore, writeStore } from './storage';

/** Paper (light) is the default: it is the product's own material and reads best in sunlight. Lantern is the dark theme. */
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
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', t === 'dark' ? '#121110' : '#f4f0e6'));
}
apply(themeStore.get());
themeStore.subscribe(() => apply(themeStore.get()));

export function setTheme(t: Theme) {
  if (queryParam('theme') == null) writeStore('kl.theme', t);
  themeStore.set(t);
}
export const toggleTheme = () => setTheme(themeStore.get() === 'dark' ? 'light' : 'dark');
export const useTheme = () => themeStore.use();
