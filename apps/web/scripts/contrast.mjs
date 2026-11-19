// WCAG 2.2 contrast checker for the "Field Guide" tokens (apps/web/DESIGN.md, src/styles/index.css).
// Usage: node scripts/contrast.mjs        (exits 1 if any required pair is below its threshold)
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// "Field Guide" (DESIGN.md, from the KrishiGuard AI deck): Cream (light, the default), Forest (dark), the forest band
// inside a cream page, the deepest band inside a forest page, and the paper object (receipts, both themes).
// Keep in step with src/styles/index.css.
const meaning = { go: '#9bd18a', goWash: '#1b3a26', wait: '#f0b158', waitWash: '#33301a', stop: '#f39478', stopWash: '#3a2a20', carbon: '#b9c3f2', carbonWash: '#1f2c3a', water: '#a8d1df', waterWash: '#18333a' };
export const THEMES = {
  cream: {
    paper: '#f3eee2', sunk: '#ebe4d3', card: '#fffdf8', ink: '#14261c', ink2: '#46524a', ink3: '#5a645c',
    go: '#2f6b3a', goWash: '#e2edd9', wait: '#8a4e00', waitWash: '#f6e7ca', stop: '#a83a21', stopWash: '#f7e2d9',
    carbon: '#35428f', carbonWash: '#e3e5f3', water: '#2b6476', waterWash: '#dcebee', accent: '#e2a93b', accentInk: '#14261c',
    accentText: '#8a5a0e', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
  forest: {
    paper: '#14261c', sunk: '#0e2419', card: '#173a29', ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', ...meaning,
    accent: '#e2a93b', accentInk: '#14261c', accentText: '#e2a93b', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
  deepestBand: {
    paper: '#0e2419', sunk: '#0a1c13', card: '#14301f', ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', ...meaning,
    accent: '#e2a93b', accentInk: '#14261c', accentText: '#e2a93b', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
  paperObject: {
    paper: '#fbf8f1', sunk: '#f0eadc', card: '#fffdf8', ink: '#1b1a16', ink2: '#4a463e', ink3: '#66625a',
    go: '#1e6b45', goWash: '#e1ede2', wait: '#8f5600', waitWash: '#f6eacc', stop: '#b9321a', stopWash: '#f8e4dd',
    carbon: '#3646a6', carbonWash: '#e2e5f4', water: '#2b6476', waterWash: '#dcebee', accent: '#e2a93b', accentInk: '#14261c',
    accentText: '#8a5a0e', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
};

// [foreground, background, minimum ratio]. Text pairs need 4.5 (AA). Buttons: paper text on ink, white on go/stop.
const PAIRS = [
  ['ink', 'paper', 4.5], ['ink', 'sunk', 4.5], ['ink', 'card', 4.5],
  ['ink2', 'paper', 4.5], ['ink2', 'sunk', 4.5], ['ink2', 'card', 4.5],
  ['ink3', 'paper', 4.5], ['ink3', 'sunk', 4.5], ['ink3', 'card', 4.5],
  ['go', 'paper', 4.5], ['go', 'card', 4.5], ['go', 'goWash', 4.5],
  ['wait', 'paper', 4.5], ['wait', 'card', 4.5], ['wait', 'waitWash', 4.5],
  ['stop', 'paper', 4.5], ['stop', 'card', 4.5], ['stop', 'stopWash', 4.5],
  ['carbon', 'paper', 4.5], ['carbon', 'card', 4.5], ['carbon', 'carbonWash', 4.5],
  ['water', 'paper', 4.5], ['water', 'card', 4.5], ['water', 'waterWash', 4.5],
  ['accentText', 'paper', 4.5], ['accentText', 'card', 4.5],
  ['accentInk', 'accent', 4.5], ['sproutInk', 'sprout', 4.5],
  ['paper', 'ink', 4.5],
];
// buttons in a meaning colour: white text on paper, dark ink (#14130f) on the lighter lantern / night tones
const BUTTONS = { cream: [['white', 'go', 4.5], ['white', 'stop', 4.5]], paperObject: [['white', 'go', 4.5], ['white', 'stop', 4.5]], forest: [['btnInk', 'go', 4.5], ['btnInk', 'stop', 4.5]], deepestBand: [['btnInk', 'go', 4.5], ['btnInk', 'stop', 4.5]] };
for (const t of Object.values(THEMES)) t.btnInk = '#14130f';

let bad = 0;
if (process.argv[1] && process.argv[1].endsWith('contrast.mjs')) {
  for (const [name, t] of Object.entries(THEMES)) {
    console.log(`\n== ${name}`);
    for (const [fg, bg, min] of [...PAIRS, ...BUTTONS[name]]) {
      const r = ratio(t[fg], t[bg]);
      const ok = r >= min;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${fg.padEnd(10)} on ${bg.padEnd(10)} ${r.toFixed(2)}  (min ${min})`);
    }
  }
  console.log(bad ? `\n${bad} pair(s) below threshold` : '\nall pairs pass');
  process.exit(bad ? 1 : 0);
}
