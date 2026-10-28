// WCAG 2.2 contrast checker for the design tokens (docs/design/DESIGN.md lists these results).
// Usage: node scripts/contrast.mjs        (exits 1 if any required pair is below its threshold)
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export const THEMES = {
  dark: {
    void: '#080c09', ink: '#0c110d', panel: '#111712', panel2: '#171e18', line: '#232b24',
    bone: '#eeebe0', chrome: '#a9b1a4', dim: '#8a9285', sun: '#f0c96b', sunInk: '#1a1405',
    go: '#6fd08c', wait: '#f2a93b', stop: '#f58a76', leaf: '#8fc77a',
    paper: '#ece6d3', paperInk: '#1b211b', paperDim: '#555d50', paperAccent: '#7a5200',
  },
  light: {
    void: '#f4f1e8', ink: '#ece7da', panel: '#fbf9f3', panel2: '#f3efe4', line: '#ddd6c5',
    bone: '#1b211b', chrome: '#444d41', dim: '#596254', sun: '#8a5b00', sunInk: '#fff8e6',
    go: '#1b7544', wait: '#8a5200', stop: '#b3261e', leaf: '#3f7a2c',
    paper: '#fffdf7', paperInk: '#1b211b', paperDim: '#555d50', paperAccent: '#7a5200',
  },
};

// [foreground, background, minimum ratio, note]
const PAIRS = [
  ['bone', 'void', 4.5], ['bone', 'panel', 4.5], ['bone', 'panel2', 4.5], ['chrome', 'void', 4.5], ['chrome', 'panel', 4.5],
  ['dim', 'void', 4.5], ['dim', 'panel', 4.5], ['dim', 'panel2', 4.5], ['sun', 'void', 4.5], ['sun', 'panel', 4.5],
  ['go', 'panel', 4.5], ['wait', 'panel', 4.5], ['stop', 'panel', 4.5], ['go', 'void', 4.5], ['wait', 'void', 4.5], ['stop', 'void', 4.5],
  ['sunInk', 'sun', 4.5], ['paperInk', 'paper', 4.5], ['paperDim', 'paper', 4.5], ['paperAccent', 'paper', 4.5],
  ['line', 'void', 1.0], // hairlines are decorative, not required
];

let bad = 0;
if (process.argv[1] && process.argv[1].endsWith('contrast.mjs')) {
  for (const [name, t] of Object.entries(THEMES)) {
    console.log(`\n== ${name}`);
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(t[fg], t[bg]);
      const ok = r >= min;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${fg.padEnd(11)} on ${bg.padEnd(7)} ${r.toFixed(2)}  (min ${min})`);
    }
  }
  console.log(bad ? `\n${bad} pair(s) below threshold` : '\nall pairs pass');
  process.exit(bad ? 1 : 0);
}
