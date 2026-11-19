/**
 * English copy for the /receipt walk-through (builder Pg, v5): how a receipt works, step by step, in plain words.
 * Spread into en.ts; bn.receipt.ts must carry every key (i18n.test.ts).
 */
const receipt = {
  'rw.eyebrow': 'Step by step',
  'rw.title': 'One receipt, step by step.',
  'rw.lead': 'Five steps, one real receipt. Tap a step.',
  'rw.stepsLabel': 'The five steps',
  'rw.stepOf': '{n} of {total}',
  'rw.back': 'Back one step',
  'rw.next': 'Next',
  'rw.play': 'Play',
  'rw.pause': 'Pause',
  'rw.data.name': 'Field data',
  'rw.data.title': 'It starts with your field.',
  'rw.data.body': 'Weather and your crop details. Nothing is guessed.',
  'rw.data.field': 'Field',
  'rw.data.source': 'Open-Meteo.',
  'rw.rule.name': 'The rule',
  'rw.rule.title': 'A written rule decides.',
  'rw.rule.body': 'An expert rule picks the advice. No AI writes it.',
  'rw.rule.from': 'Bangladesh Rice Research Institute.',
  'rw.sign.name': 'Signed receipt',
  'rw.sign.title': 'The advice gets a receipt.',
  'rw.sign.body': 'KrishiLoop signs it. Change one letter and it breaks.',
  'rw.sign.paper': 'Advice receipt',
  'rw.sign.rule': 'Rule',
  'rw.sign.week': 'Week',
  'rw.check.name': 'Anyone checks',
  'rw.check.title': 'Anyone can check it.',
  'rw.check.body': 'Scan the QR. Your browser checks it. No sign-in.',
  'rw.check.line': 'Real, and not changed.',
  'rw.check.try': 'Check this receipt now',
  'rw.recall.name': 'Recall',
  'rw.recall.title': 'A wrong rule is taken back.',
  'rw.recall.body': 'An officer recalls it. Every receipt using it says Recalled.',
  'rw.recall.line': 'All receipts with this rule: Recalled.',
  'rw.recall.try': 'Try a recall on the officer desk',
} as const satisfies Record<string, string>;

export default receipt;
