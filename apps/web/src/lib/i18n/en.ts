/**
 * English UI strings: the source of truth. Each screen keeps its own file (en.<screen>.ts); this file joins them.
 * Other languages are maps over these keys (a missing key shows the English text). Copy rule: we never say a receipt
 * is "correct". "Authentic" means issued by KrishiLoop and unaltered, nothing more.
 */
import ui from './en.ui';
import story from './en.story';
import about from './en.about';
import farmer from './en.farmer';
import officer from './en.officer';
import verify from './en.verify';
import trust from './en.trust';
import proof from './en.proof';

const en = {
  ...ui,
  ...story,
  ...about,
  ...farmer,
  ...officer,
  ...verify,
  ...trust,
  ...proof,
} as const satisfies Record<string, string>;

export default en;
