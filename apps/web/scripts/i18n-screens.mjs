// Which English dictionaries each page needs: follows each page's static imports through src/ and maps every key it
// uses (literals and template prefixes) to the en.<screen>.ts file that defines it.   node scripts/i18n-screens.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const src = resolve('src');
const i18n = join(src, 'lib', 'i18n');
const PAGES = {
  story: 'features/story/StoryPage.tsx',
  about: 'features/about/AboutPage.tsx',
  farmer: 'features/farmer/FarmerApp.tsx',
  officer: 'features/officer/OfficerPage.tsx',
  verify: 'features/verify/VerifyPage.tsx',
  trust: 'features/trust/TrustPage.tsx',
  proof: 'features/proof/ProofPage.tsx',
  shell: 'shell/SiteLayout.tsx',
};

const owner = {};
for (const f of readdirSync(i18n).filter((f) => /^en\.[a-z]+\.ts$/.test(f))) {
  for (const m of readFileSync(join(i18n, f), 'utf8').matchAll(/^\s*'([^']+)':/gm)) owner[m[1]] = f;
}
const keys = Object.keys(owner);

const resolveImport = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && !c.endsWith('.json') && /\.(tsx?)$/.test(c)) return c;
  return null;
};

for (const [page, entry] of Object.entries(PAGES)) {
  const seen = new Set();
  const stack = [join(src, entry)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || f.startsWith(i18n)) continue;
    seen.add(f);
    const text = readFileSync(f, 'utf8');
    // static imports only (lazy `import()` chunks are other pages)
    for (const m of text.matchAll(/^\s*import\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]/gm)) {
      const r = resolveImport(f, m[1]);
      if (r) stack.push(r);
    }
    for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const r = resolveImport(f, m[1]);
      if (r) stack.push(r);
    }
  }
  const text = [...seen].map((f) => readFileSync(f, 'utf8')).join('\n');
  const lits = new Set([...text.matchAll(/['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g)].map((m) => m[1]));
  const prefixes = [...text.matchAll(/`([a-z][\w-]*(?:\.[\w-]*)*)\$\{/g)].map((m) => m[1]).filter((p) => p.includes('.'));
  const files = new Set();
  for (const k of keys) {
    if (lits.has(k) || prefixes.some((p) => k.startsWith(p))) files.add(owner[k]);
  }
  console.log(`${page.padEnd(8)} ${[...files].sort().join(', ')}`);
}
