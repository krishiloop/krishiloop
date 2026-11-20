import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Self-hosted fonts, no third-party requests (DESIGN.md): Inter, Fraunces and Hind Siliguri (Bangla) are declared in
   index.css (Inter and Fraunces preloaded); Hind Siliguri and Anek Devanagari load only when their letters appear (unicode-range); Tiro Bangla sets
   Bangla source quotes; Geist Mono sets receipt lines, ids and numbers. */
import '@fontsource-variable/anek-devanagari/wght.css';
import '@fontsource/tiro-bangla/bengali-400.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/index.css';

import './lib/theme';
// listen for "install app" from the first moment: the browser fires it once, possibly before the farmer chunk loads
import './features/farmer/install';
import { bootLang } from './lib/i18n';
import App from './App';

// The offline cache must never keep showing an old site after a deploy (owner, 20 Nov: the 19 Nov site with its old
// hero kept appearing). registerSW in autoUpdate mode reloads the page once, as soon as a new version takes over. It is
// loaded after the page, so it adds nothing to the first visit.
window.addEventListener('load', () => {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
});

// load the starting language first so a Bangla visitor never sees a flash of English
void bootLang().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
