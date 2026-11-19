/** English copy for the home hero's scroll story and the loader (builder H). Spread into en.ts; bn.homestory.ts carries every key. */
const homestory = {
  'home.story.label': 'The KrishiLoop story in six pictures',
  'home.story.go': 'Go to step {n}: {name}',
  'home.story.skip': 'Skip the story',
  'home.story.hint': 'Touch the leaves to stir them',
  'home.story.s1': 'Your field',
  'home.story.s1.line': 'It starts with your field and one question.',
  'home.story.s2': 'Crop doctor',
  'home.story.s2.line': 'Snap a sick leaf. It names the disease, or says it is not sure.',
  'home.story.s3': 'Weather warning',
  'home.story.s3.line': 'Rain on the way? You are warned before you spray.',
  'home.story.s4': 'Village disease map',
  'home.story.s4.line': 'Reports from nearby farms warn the whole area.',
  'home.story.s5': 'A receipt',
  'home.story.s5.line': 'Every answer comes with a receipt anyone can check.',
  'home.story.s6': 'The loop',
  'home.story.s6.line': 'If a rule turns out wrong, it is called back from every farmer who got it.',
  'home.story.illus': 'Illustration: drawn leaves, not real data',
} as const satisfies Record<string, string>;

export default homestory;
