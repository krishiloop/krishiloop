// WCAG 2.2 contrast checker for the "Field Guide" tokens (apps/web/DESIGN.md, src/styles/index.css).
// Usage: node scripts/contrast.mjs        (exits 1 if any required pair is below its threshold)
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// "Field Guide" (DESIGN.md, from the KrishiGuard AI deck): Cream (light, the default), Dusk (dark, v5), the forest band
// (.band-night, the deep accent in both themes), and the paper object (receipts, both themes).
// Keep in step with src/styles/index.css.
const meaning = { go: '#9bd18a', goWash: '#1b3a26', wait: '#f2b59a', waitWash: '#3a2a22', stop: '#f39478', stopWash: '#3a2a20', carbon: '#b9c3f2', carbonWash: '#1f2c3a', water: '#a8d1df', waterWash: '#18333a' };
export const THEMES = {
  cream: {
    paper: '#faf6ee', sunk: '#f1ebe0', card: '#fffdf8', ink: '#14261c', ink2: '#46524a', ink3: '#5a645c',
    go: '#2f6b3a', goWash: '#e2edd9', wait: '#7a4a1e', waitWash: '#f8e4d8', stop: '#a83a21', stopWash: '#f7e2d9',
    carbon: '#35428f', carbonWash: '#e3e5f3', water: '#2b6476', waterWash: '#dcebee', accent: '#1f3d2c', accentInk: '#faf6ee',
    accentText: '#2f5a35', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
  forest: {
    paper: '#14261c', sunk: '#0e2419', card: '#173a29', ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', ...meaning,
    accent: '#c9dcbc', accentInk: '#14261c', accentText: '#c9dcbc', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
  // 20 Nov (owner): the dark theme is the deck's forest again (deepest #0e2419), with pale sage actions; no yellow
  dusk: {
    paper: '#0e2419', sunk: '#0a1c13', card: '#173a29', ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', ...meaning,
    accent: '#c9dcbc', accentInk: '#14261c', accentText: '#c9dcbc', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
  },
  paperObject: {
    paper: '#fbf8f1', sunk: '#f0eadc', card: '#fffdf8', ink: '#1b1a16', ink2: '#4a463e', ink3: '#66625a',
    go: '#1e6b45', goWash: '#e1ede2', wait: '#7a4a1e', waitWash: '#f8e4d8', stop: '#b9321a', stopWash: '#f8e4dd',
    carbon: '#3646a6', carbonWash: '#e2e5f4', water: '#2b6476', waterWash: '#dcebee', accent: '#1f3d2c', accentInk: '#faf6ee',
    accentText: '#2f5a35', sprout: '#b7d98a', sproutInk: '#102006', white: '#ffffff',
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
const BUTTONS = { cream: [['white', 'go', 4.5], ['white', 'stop', 4.5]], paperObject: [['white', 'go', 4.5], ['white', 'stop', 4.5]], forest: [['btnInk', 'go', 4.5], ['btnInk', 'stop', 4.5]], dusk: [['btnInk', 'go', 4.5], ['btnInk', 'stop', 4.5]] };
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
  // the palette pairs below run too; the exit code covers both
}

// ---- The painter's palette (builder H, 19 Nov v4; index.css). Every text colour a section or tile may put on a pastel
// wash, in both themes; the aubergine band; and the disease map scale (--map-0..5 with --map-ink-0..5).
const PALETTE = {
  cream: {
    washes: { butter: ['#f3eee4', '#5b4a36'], lotus: ['#f7e1dd', '#8a2f3c'], monsoon: ['#deebf2', '#22506a'], hyacinth: ['#e8e1f2', '#553f86'], moss: ['#e2ebd9', '#2f5a35'], terracotta: ['#f6dfd1', '#8a3a1c'] },
    text: { ink: '#14261c', ink2: '#46524a', ink3: '#5a645c', accentText: '#2f5a35', go: '#2f6b3a', wait: '#7a4a1e', stop: '#a83a21', water: '#2b6476', carbon: '#35428f' },
  },
  dusk: {
    washes: { butter: ['#2d2b25', '#e9e2d2'], lotus: ['#45263a', '#f0b9b4'], monsoon: ['#193d50', '#a8d1df'], hyacinth: ['#2f2954', '#c6b7e4'], moss: ['#18311f', '#b9cfa8'], terracotta: ['#4a2b1d', '#ef9e80'] },
    text: { ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', accentText: '#c9dcbc', go: '#9bd18a', wait: '#f2b59a', stop: '#f39478', water: '#a8d1df', carbon: '#b9c3f2' },
  },
  forest: {
    washes: { butter: ['#2d2b25', '#e9e2d2'], lotus: ['#45263a', '#f0b9b4'], monsoon: ['#193d50', '#a8d1df'], hyacinth: ['#2f2954', '#c6b7e4'], moss: ['#18311f', '#b9cfa8'], terracotta: ['#4a2b1d', '#ef9e80'] },
    text: { ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', accentText: '#c9dcbc', go: '#9bd18a', wait: '#f2b59a', stop: '#f39478', water: '#a8d1df', carbon: '#b9c3f2' },
  },
};
// the aubergine band ("we asked AI first"): forest-band ink on aubergine paper and card, both themes
const AUBERGINE = { paper: ['#3a2340', '#2b1a30'], card: ['#472c4f', '#3a2340'] };
const BAND_TEXT = { ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', accent: '#c9dcbc', go: '#9bd18a', stop: '#f39478' };
// the map: forest ink on the light steps, cream on the darkest (labels on a filled area)
const MAP = [['#e6ecdf', '#14261c'], ['#f3e4d6', '#14261c'], ['#f2c3a4', '#14261c'], ['#eda383', '#14261c'], ['#cf6f66', '#14261c'], ['#8c3550', '#fffdf8']];
// the gate fills and the leaf pastels take forest ink (chips, legend swatches with words on them)
const LEAVES = { butter: '#ece4d4', lotus: '#f0b9b4', monsoon: '#a8d1df', hyacinth: '#c6b7e4', moss: '#b9cfa8', terracotta: '#ef9e80', sage: '#c9dcbc' };

if (process.argv[1] && process.argv[1].endsWith('contrast.mjs')) {
  let badP = 0;
  const check = (label, fg, bg, min = 4.5) => {
    const r = ratio(fg, bg);
    if (r < min) badP++;
    console.log(`${r >= min ? 'ok  ' : 'FAIL'} ${label.padEnd(38)} ${r.toFixed(2)}  (min ${min})`);
  };
  for (const [theme, { washes, text }] of Object.entries(PALETTE)) {
    console.log(`\n== palette washes, ${theme}`);
    for (const [name, [wash, own]] of Object.entries(washes)) {
      check(`${name}-ink on ${name}`, own, wash);
      for (const [k, c] of Object.entries(text)) check(`${k} on ${name}`, c, wash);
    }
  }
  console.log('\n== aubergine band');
  for (const [surf, pair] of Object.entries(AUBERGINE)) pair.forEach((bg, i) => Object.entries(BAND_TEXT).forEach(([k, c]) => check(`${k} on aubergine ${surf} (${i ? 'dark' : 'cream'} theme)`, c, bg)));
  console.log('\n== map scale');
  MAP.forEach(([fill, ink], i) => check(`--map-ink-${i} on --map-${i}`, ink, fill));
  console.log('\n== leaf pastels with forest ink');
  for (const [k, c] of Object.entries(LEAVES)) check(`forest ink on ${k} leaf`, '#14261c', c);
  // v5 (builder Ho): text on the pastel meshes (kit.css .mesh, the hero's washes) at each blob's strongest point: a leaf
  // mixed into the page colour (40 % in .mesh, 48 % in the hero; on dusk a third of that). On a cream mesh the quiet
  // grey and the gold-brown run a shade deeper (kit.css: ink-3 #4f5952, accent-text #7a4f0b).
  const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
  console.log('\n== pastel meshes, strongest point');
  for (const [leafName, leaf] of Object.entries(LEAVES)) {
    if (leafName === 'mustard') continue;
    for (const [where, base, t, texts] of [
      ['cream mesh', '#f3eee2', 0.4, { ink: '#14261c', ink2: '#46524a', ink3: '#4f5952', accentText: '#7a4f0b' }],
      ['cream hero', '#f3eee2', 0.48, { ink: '#14261c', ink2: '#46524a', ink3: '#4f5952', accentText: '#7a4f0b' }],
      ['dusk mesh', '#0e2419', 0.4 * 0.32, { ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', accentText: '#c9dcbc' }],
      ['dusk hero', '#0e2419', 0.48 * 0.34, { ink: '#f3eee2', ink2: '#c9d3c8', ink3: '#a3b2a6', accentText: '#c9dcbc' }],
    ]) {
      const bg = mix(leaf, base, t);
      for (const [k, c] of Object.entries(texts)) check(`${k} on ${where} (${leafName} ${bg})`, c, bg);
    }
  }
  // the team cards: the name in ink and the roles in the pastel's own ink, on the card's wash (both themes)
  console.log('\n== team cards');
  for (const [theme, { washes, text }] of [['cream', PALETTE.cream], ['dusk', PALETTE.dusk]])
    for (const [name, [wash, own]] of Object.entries(washes)) {
      check(`${theme} team name on ${name}`, text.ink, wash);
      check(`${theme} team role on ${name}`, own, wash);
    }
  console.log(badP ? `\n${badP} palette pair(s) below threshold` : '\nall palette pairs pass');
  process.exit(bad || badP ? 1 : 0);
}
