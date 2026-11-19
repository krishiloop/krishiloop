// Bundle budget (frontend-redesign-brief.md): the JavaScript a first visit to one page downloads, gzipped: the entry,
// the page's chunk, and every chunk they import statically (shared chunks count, lazy imports do not).
// Usage: npm run build && node scripts/bundle-size.mjs   (exits 1 if a page is over its budget)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = join(process.cwd(), 'dist', 'assets');
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const text = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
const gz = Object.fromEntries(files.map((f) => [f, gzipSync(text[f], { level: 9 }).length]));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** static imports only: `from"./x.js"` and `import"./x.js"`, never `import("./x.js")` */
const staticDeps = (f) => [...text[f].matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.js)["']/g)].map((m) => m[1]).filter((d) => d in text);
const closure = (roots) => {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    staticDeps(f).forEach(visit);
  };
  roots.forEach(visit);
  return seen;
};

const entry = files.filter((f) => /^index-/.test(f));
const base = closure(entry);
const sum = (set) => [...set].reduce((s, f) => s + gz[f], 0);
console.log(`startup (entry + its static imports): ${kb(sum(base))}  [${[...base].join(', ')}]`);

// Regression ceilings at the size measured on 29 Oct 2026 plus ~4% headroom. The brief's target was 90 KB for the story
// page and 100 KB for the others; React 19 + react-router alone are ~75 KB gzipped, so meeting it would need Preact or
// server rendering. Until then these numbers may only go down, with one exception, written here:
//   2 Nov 2026: TrustPage 120 -> 121 and ProofPage 123 -> 124. The shared chunk grew ~0.3 KB (receipt short codes and
//   recall notices in the API client, services/reach), and /proof gained the voice credits and the held-out safety
//   numbers. The farmer app's SMS preview moved to a lazy chunk in the same change.
//   19 Nov 2026 (builder P): ProofPage 124 -> 125. /proof gained the AgriTriage-Lite evaluation tile (its numbers, the
//   eight row labels and its four source files: ~0.7 KB gzipped). The photo model itself, its runtime and the photo screens
//   are lazy chunks (AiPhoto, AiCases) and add nothing to any first visit.
//   19 Nov 2026 (builder R): OfficerPage 136 -> 137. The console gained the outbreak radar tab (its label in two
//   languages, its icon and the lazy loader, ~0.4 KB gzipped). The radar itself, the map outlines (Bangladesh 11 KB,
//   Kenya 5 KB) and the KrishiGuard words are lazy chunks; on Today the shield, calculator and booking are one lazy chunk.
//   19 Nov 2026 (builder D, the deck redesign): FarmerApp 145 -> 147, VerifyPage 133 -> 134, TrustPage 121 -> 122. The
//   shared shell grew ~0.4 KB gzipped (the forest footer with its two actions and line art, the page-top art layer, the
//   nav lozenge, the new ui.* strings for the Drawer, the Comparer and the app's site strip); the farmer app's header
//   gained the strip that links back to the website, Verify and the Officer (three icons and the theme toggle, ~1 KB).
//   Fonts and art are not JavaScript and do not count here. Home stays under 190 because the product magazine is lazy.
//   19 Nov 2026 (v4): MapPage 116 (new: the 3-country disease map; its outlines load lazily per country).
//   19 Nov 2026 (v4): TryPage 140 (new: the six real tools; the leaf model loads only when started).
//   19 Nov 2026 (v4): FarmerApp 147 -> 149, OfficerPage 137 -> 139, VerifyPage 134 -> 136, TrustPage 122 -> 123, ProofPage
//   125 -> 127. Shared code grew: the pastel palette tokens (index.css), the header's More menu and two new nav entries,
//   and the lazy tilt loader; the pages' own chunks also gained the photo-model recall control and the plain-word labels.
const PAGES = { HomePage: 190, MapPage: 116, TryPage: 140, ReceiptPage: 133, FarmerApp: 149, OfficerPage: 139, VerifyPage: 136, TrustPage: 123, ProofPage: 127, AboutPage: 110 };
let over = 0;
for (const [page, budget] of Object.entries(PAGES)) {
  const own = files.filter((f) => f.startsWith(`${page}-`));
  const all = closure([...entry, ...own]);
  const extra = [...all].filter((f) => !base.has(f));
  const total = sum(all);
  const ok = total <= budget * 1024;
  if (!ok) over++;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${page.padEnd(12)} first visit ${kb(total).padStart(9)}  (page + its own chunks ${kb(sum(new Set(extra))).padStart(8)}; budget ${budget} KB)`);
}
console.log('\nlargest chunks:');
for (const [f, n] of Object.entries(gz).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${kb(n).padStart(9)}  ${f}`);
process.exit(over ? 1 : 0);
