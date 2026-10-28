// Find i18n keys that no code references any more.   node scripts/i18n-unused.mjs [--files en.trust.ts,...] [--list] [--prune]
// A key counts as used when the source has it as a string literal, when a template literal builds it from a prefix
// (`ui.kind.${kind}`), or when one of its parent keys is referenced (`${key}.sub` patterns). Conservative on purpose.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(process.cwd(), 'src');
const i18nDir = join(root, 'lib', 'i18n');
const arg = process.argv.indexOf('--files');
const only = arg > -1 ? process.argv[arg + 1].split(',') : null;

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const code = walk(root).filter((p) => /\.(tsx?|mjs)$/.test(p) && !p.startsWith(i18nDir));
const src = code.map((p) => readFileSync(p, 'utf8')).join('\n');

const literals = new Set([...src.matchAll(/['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g)].map((m) => m[1]));
// `about.t${n}.date`, `ui.kind.${kind}`: everything before the first ${ is a prefix the key must start with
const prefixes = new Set([...src.matchAll(/`([a-z][\w-]*(?:\.[\w-]*)*)\$\{/g)].map((m) => m[1]).filter((p) => p.includes('.')));

const used = (k) => {
  if (literals.has(k)) return true;
  for (const p of prefixes) if (k.startsWith(p)) return true;
  const parts = k.split('.');
  for (let i = parts.length - 1; i > 1; i--) if (literals.has(parts.slice(0, i).join('.'))) return true;
  return false;
};

const files = readdirSync(i18nDir).filter((f) => /^en(\.[a-z]+)?\.ts$/.test(f) && (!only || only.includes(f)));
let total = 0;
const dead = new Set();
for (const f of files) {
  const keys = [...readFileSync(join(i18nDir, f), 'utf8').matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
  const unused = keys.filter((k) => !used(k));
  unused.forEach((k) => dead.add(k));
  total += unused.length;
  console.log(`${relative(process.cwd(), join(i18nDir, f))}: ${unused.length} of ${keys.length} keys unused`);
  if (process.argv.includes('--list')) for (const k of unused) console.log('   ', k);
}
console.log(`\n${total} unused key(s)`);

// --prune: delete those keys' single-line entries from every language file of the same screens (en, bn, hi, sw)
if (process.argv.includes('--prune') && dead.size) {
  const screens = files.map((f) => f.replace(/^en/, ''));
  const targets = readdirSync(i18nDir).filter((f) => screens.some((s) => f.endsWith(s) && /^(en|bn|hi|sw)\./.test(f)));
  for (const f of targets) {
    const p = join(i18nDir, f);
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    let removed = 0;
    const multi = [];
    const kept = lines.filter((line) => {
      const m = /^\s*'([^']+)':\s*(.*)$/.exec(line);
      if (!m || !dead.has(m[1])) return true;
      if (!/,\s*$/.test(m[2])) {
        multi.push(m[1]);
        return true;
      }
      removed++;
      return false;
    });
    writeFileSync(p, kept.join('\n'));
    console.log(`pruned ${removed} from ${f}${multi.length ? `; multi-line, left for a person: ${multi.join(', ')}` : ''}`);
  }
}
