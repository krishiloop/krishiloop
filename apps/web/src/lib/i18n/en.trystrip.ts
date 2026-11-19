/**
 * English copy for the "Try it" strip (builder I, features/try/TryTeaser.tsx), kept apart from en.try.ts so a page
 * that shows only the strip (the home page) loads these few words and not the whole /try dictionary.
 */
const tryStrip = {
  'try.strip.eyebrow': 'Try it yourself',
  'try.strip.title': 'Use the real tools',
  'try.strip.all': 'All six tools',
  'try.strip.spray': 'Should I spray?',
  'try.strip.spraySub': 'Move the sliders, see the sourced rule',
  'try.strip.leaf': 'Check a leaf photo',
  'try.strip.leafSub': 'The model runs in your browser',
  'try.strip.weather': 'Weather warnings',
  'try.strip.weatherSub': 'Drag a practice week',
  'try.strip.recall': 'Take advice back',
  'try.strip.recallSub': 'Watch receipts turn Recalled',
} as const satisfies Record<string, string>;

export default tryStrip;
