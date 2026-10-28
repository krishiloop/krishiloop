import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Self-hosted fonts, no third-party requests. One family across scripts (DESIGN.md):
   Anek Latin is declared in index.css (preloaded); Anek Bangla and Anek Devanagari load only when their letters appear
   (unicode-range). Newsreader and Tiro Bangla set verbatim source quotes; JetBrains Mono sets receipt lines and ids. */
import '@fontsource-variable/anek-bangla/wght.css';
import '@fontsource-variable/anek-devanagari/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource/tiro-bangla/bengali-400.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
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
