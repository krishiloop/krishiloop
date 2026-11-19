/**
 * English copy for the /receipt walk-through (builder Pg, v5): how a receipt works, step by step, in plain words.
 * Spread into en.ts; bn.receipt.ts must carry every key (i18n.test.ts).
 */
const receipt = {
  'rw.eyebrow': 'Step by step',
  'rw.title': 'How one receipt is made, checked and taken back.',
  'rw.lead': 'Five steps, using one real receipt from our server. It plays by itself, or tap a step.',
  'rw.stepsLabel': 'The five steps',
  'rw.stepOf': 'Step {n} of {total}',
  'rw.back': 'Back one step',
  'rw.next': 'Next step',
  'rw.play': 'Play',
  'rw.pause': 'Pause',
  'rw.data.name': 'Field data',
  'rw.data.title': 'It starts with your field.',
  'rw.data.body': 'The app reads the weather forecast and what you told it about your crop. Nothing is guessed.',
  'rw.data.field': 'Field',
  'rw.data.source': 'Forecast from Open-Meteo, as recorded.',
  'rw.rule.name': 'The rule',
  'rw.rule.title': 'A written rule decides.',
  'rw.rule.body': 'An expert rule from a trusted source picks the advice. No AI writes it, so it cannot make up a dose.',
  'rw.rule.from': 'From the Bangladesh Rice Research Institute.',
  'rw.sign.name': 'Signed receipt',
  'rw.sign.title': 'The advice comes with a receipt.',
  'rw.sign.body': 'KrishiLoop signs the advice, the rule and the week. Change one letter and the signature breaks.',
  'rw.sign.paper': 'Advice receipt',
  'rw.sign.rule': 'Rule',
  'rw.sign.week': 'Week',
  'rw.check.name': 'Anyone checks',
  'rw.check.title': 'Anyone can check it.',
  'rw.check.body': 'Scan the QR or open the link. Your own browser checks the signature, with no sign-in.',
  'rw.check.line': 'Real, and not changed.',
  'rw.check.try': 'Check this receipt now',
  'rw.recall.name': 'Recall',
  'rw.recall.title': 'A wrong rule is taken back everywhere.',
  'rw.recall.body': 'If a rule turns out wrong, an officer recalls it. Every receipt that used it now says Recalled.',
  'rw.recall.line': 'Every receipt with this rule now says Recalled.',
  'rw.recall.try': 'Try a recall on the officer desk',
} as const satisfies Record<string, string>;

export default receipt;
