import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Self-hosted fonts (same families as Google Fonts, no third-party request: works offline, nothing to leak).
   Geist for the interface, Instrument Serif for accents, Geist Mono for ids and numbers,
   Hind Siliguri for Bangla (Bengali glyphs fall through to it automatically). */
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/hind-siliguri/bengali-400.css';
import '@fontsource/hind-siliguri/bengali-500.css';
import '@fontsource/hind-siliguri/bengali-600.css';
import '@fontsource/hind-siliguri/bengali-700.css';
import './styles/index.css';

import './lib/theme';
import './lib/device';
import './lib/motionPref';
import { bootLang } from './lib/i18n';
import App from './App';

// load the starting language first so a Bangla visitor never sees a flash of English
void bootLang().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
