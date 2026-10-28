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

const PAGES = { StoryPage: 90, FarmerApp: 100, OfficerPage: 100, VerifyPage: 100, TrustPage: 100, ProofPage: 100, AboutPage: 90 };
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
