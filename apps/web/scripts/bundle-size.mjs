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
//   20 Nov 2026 (v5, builder Mo): MobileApp 155 (new: the phone app at /m, measured 152.1 on HEAD + this change alone).
//   It reuses the farmer app's screens and stores (Today, Ask, the receipt sheet) and adds the welcome screens, receipts
//   saved on the phone with their QR, and Help; the leaf model (AiPhoto) and the booking drawer stay lazy. FarmerApp 149 ->
//   153 (measured 151.8 with this change alone, 152.1 with the other v5 builders' shared growth): the farmer screens are now shared by two pages, so the bundler moves them out of FarmerApp's own chunk into
//   shared chunks (measured +3.0 KB gzipped, mostly gzip losing context across the split; the plain-word copy itself is
//   +0.1 KB). The startup chunk is unchanged by this (+0.3 KB: one route); a lazy Leaf or Help tab would have split the
//   i18n module out of the entry (+0.8 KB on every page), so both come with /m.
//   20 Nov 2026 (v5, builder Pg, premium pages): OfficerPage 139 -> 142 (measured 141.0): the desk's "today" tiles that
//   count up (five pastel tiles), the case queue's search and priority chips, the case drawer's answer / call / visit
//   actions and the rules table head. VerifyPage 136 -> 137 (measured 136.2): the scan / paste / code cards with the drawn
//   QR and the folded details (the kit's Motion-based Magnetic was replaced by a 0.3 KB local magnet to stay near 136).
//   TrustPage 123 -> 125 (measured 124.0): the interactive gate picture over the real replay. MapPage 116 -> 117
//   (measured 116.1): the v5 visual polish (pastel mesh, card edges). All CSS and copy; no new dependency.
//   20 Nov 2026 (builder O, nearest agriculture office): FarmerApp 153 -> 156 (measured 154.4): the small always-loaded part of
//   the new card (the card and entry row, its 50 English words, ~1.4 KB gzipped; the farmer app and the phone app share it).
//   The sheet, the map, Leaflet (41.8 KB) and the office data (28.7 KB) are lazy chunks, loaded only when the card is opened.
//   20 Nov 2026, round 8 (owner: the leaf farmer on every page; nearest officer when unsure; /m in the site's theme):
//   FarmerApp 156 -> 160 (measured 158.9) and MobileApp 155 -> 160 (measured 159.2): the officer finder's search, district
//   list and "not sure" card logic (~3.5 KB) plus the farmer cameo's shell. Map 117 -> 118, Officer 142 -> 143, Verify
//   137 -> 138, Trust 125 -> 126, Proof 127 -> 128, About 110 -> 111 (each measured 0.1-0.3 KB over): the cameo's tiny
//   always-loaded shell and its CSS (it holds the space). The farmer's drawing code itself (6.1 KB) is a lazy chunk.
//   20 Nov 2026 (NASA data): MapPage 118 -> 119 (measured 118.3: the NASA section's 17 English words; the picture and POWER code is a
//   lazy chunk), ProofPage 128 -> 129 (measured 128.5: two register rows and their words), FarmerApp 160 -> 161 and MobileApp 160 -> 162
//   (measured 160.6 and 161.0: four layer-switch words for the office map in en.offices, ~0.2 KB; the rest is shared-chunk growth
//   from other edits, since TrustPage and AboutPage, which hold none of this code, are also 0.2-0.3 KB over). The GIBS tile layer
//   code is inside the lazy OfficeMap chunk.
//   20 Nov 2026 (v9, findable features): VerifyPage 138 -> 139 (measured 138.3), TrustPage 126 -> 127 (126.2), AboutPage
//   111 -> 112 (111.2). The shared top bar now carries "Krishi officer" and the "Phone app" button on every page (two
//   icons, the button and five words, ~0.8 KB gzipped); the QR code itself loads only when the panel opens.
//   20 Nov 2026 (NASA rainfall): MapPage 119 -> 120 (measured 119.0): the rainfall layer's switch, its colour steps in MapView and 22 English
//   words; the layer's note and legend (RainNote) and the 7-day file are lazy chunks.
//   20 Nov 2026 (more countries): MapPage 120 -> 121 (measured 120.4): the big country switch (cards, arrow keys, hint) and six country
//   names, three levels' words and the switch's and thin-data lines in English; the three new outlines are lazy chunks like the others.
//   Try, Farmer, Officer and Proof were 0.1-0.7 KB over at the same time with no change from this work: the entry grew 0.6 KB
//   (101.2 -> 101.8) from edits made elsewhere, so their ceilings are left as they are for whoever made those edits.
//   20 Nov 2026 (v10): TryPage 140 -> 141 (measured 140.7), FarmerApp 161 -> 162 (161.3), OfficerPage 143 -> 144 (143.4),
//   ProofPage 129 -> 130 (129.3). The startup chunk grew 0.6 KB: the page guard (never a white screen: a page whose code is
//   gone after a deploy reloads once, any other error shows Reload) and Spanish as a fifth language in the language list.
const PAGES = { HomePage: 190, MapPage: 121, TryPage: 141, ReceiptPage: 133, FarmerApp: 162, MobileApp: 162, OfficerPage: 144, VerifyPage: 139, TrustPage: 127, ProofPage: 130, AboutPage: 112 };
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
