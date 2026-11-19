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
import krishiguard from './en.krishiguard'; // builder R: climate, radar, calculator, visit
import radartab from './en.radartab'; // builder R: the officer's radar tab label
import photoai from './en.photoai'; // builder P: AgriTriage-Lite photo model
import diseaseMap from './en.map'; // builder M: the Disease map
import tryPage from './en.try'; // builder I: the /try tools
import tryStrip from './en.trystrip'; // builder I: the "Try it" strip
import homestory from './en.homestory'; // builder H: the home hero story
import offices from './en.offices'; // builder O: nearest agriculture office
import mobile from './en.mobile'; // builder Mo: the phone app (/m) and Open on your phone

import receipt from './en.receipt'; // builder Pg: the /receipt walk-through
const en = {
  ...ui,
  ...story,
  ...about,
  ...farmer,
  ...officer,
  ...verify,
  ...trust,
  ...proof,
  ...krishiguard,
  ...radartab,
  ...photoai,
  ...diseaseMap,
  ...tryPage,
  ...tryStrip,
  ...homestory,
  ...mobile,
  ...offices,
  ...receipt,
} as const satisfies Record<string, string>;

export default en;
