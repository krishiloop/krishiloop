import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Self-hosted fonts, no third-party requests (DESIGN.md): Geist and Instrument Serif are declared in index.css
   (preloaded); Anek Bangla and Anek Devanagari load only when their letters appear (unicode-range); Tiro Bangla sets
   Bangla source quotes; Geist Mono sets receipt lines, ids and numbers. */
import '@fontsource-variable/anek-bangla/wght.css';
import '@fontsource-variable/anek-devanagari/wght.css';
import '@fontsource/tiro-bangla/bengali-400.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/index.css';

import './lib/theme';
// listen for "install app" from the first moment: the browser fires it once, possibly before the farmer chunk loads
import './features/farmer/install';
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
