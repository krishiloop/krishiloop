// WCAG 2.2 contrast checker for the "Field Receipt" tokens (apps/web/DESIGN.md, src/styles/index.css).
// Usage: node scripts/contrast.mjs        (exits 1 if any required pair is below its threshold)
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Paper (light, default), Lantern (dark), and the night band inside the paper page. Keep in step with index.css.
export const THEMES = {
  paper: {
    paper: '#f4f0e6', sunk: '#ebe5d6', card: '#fcfaf4', ink: '#1b1a16', ink2: '#4a463e', ink3: '#66625a',
    go: '#1e6b45', goWash: '#e1ede2', wait: '#8f5600', waitWash: '#f6eacc', stop: '#b9321a', stopWash: '#f8e4dd',
    carbon: '#3646a6', carbonWash: '#e2e5f4', white: '#ffffff',
  },
  lantern: {
    paper: '#121110', sunk: '#0c0b0a', card: '#1b1a17', ink: '#f0eadc', ink2: '#c4bdae', ink3: '#9a9385',
    go: '#6cc596', goWash: '#16261c', wait: '#f0b54a', waitWash: '#2a2111', stop: '#ff7a5c', stopWash: '#2e1711',
    carbon: '#9aa8ff', carbonWash: '#1a1e37', white: '#ffffff',
  },
  night: {
    paper: '#161511', sunk: '#0f0e0c', card: '#201e19', ink: '#efe9db', ink2: '#c3bcab', ink3: '#9b9481',
    go: '#6cc596', goWash: '#16261c', wait: '#f0b54a', waitWash: '#2a2111', stop: '#ff7a5c', stopWash: '#2e1711',
    carbon: '#9aa8ff', carbonWash: '#1a1e37', white: '#ffffff',
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
  ['paper', 'ink', 4.5],
];
// buttons in a meaning colour: white text on paper, dark ink (#14130f) on the lighter lantern / night tones
const BUTTONS = { paper: [['white', 'go', 4.5], ['white', 'stop', 4.5]], lantern: [['btnInk', 'go', 4.5], ['btnInk', 'stop', 4.5]], night: [['btnInk', 'go', 4.5], ['btnInk', 'stop', 4.5]] };
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
