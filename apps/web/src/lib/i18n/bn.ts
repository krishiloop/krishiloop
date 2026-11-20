/**
 * Bangla (বাংলা) UI strings. Machine-written; pending native-speaker review.
 *
 * Written for low-literacy farmers: short sentences, everyday words (স্প্রে, পাতা, অফিসার, ফসল, জমি). Product names
 * (KrishiLoop, AgriSphere AI, Open-Meteo, Sentinel-2, QR, API, SMS, PDF) stay as they are. `en.ts` is the source:
 * every key is here, and every {placeholder} is kept (i18n.test.ts checks both). Words to settle with the reviewer:
 * "বাতিল" for Recalled, "খাঁটি" for Authentic, "কৃষি সম্প্রসারণ অফিসার" for extension officer, "রসিদ" for receipt.
 */
import type { Key } from './index';
import ui from './bn.ui';
import story from './bn.story';
import about from './bn.about';
import farmer from './bn.farmer';
import officer from './bn.officer';
import verify from './bn.verify';
import trust from './bn.trust';
import proof from './bn.proof';
import krishiguard from './bn.krishiguard'; // builder R: climate, radar, calculator, visit
import radartab from './bn.radartab'; // builder R: the officer's radar tab label
import photoai from './bn.photoai'; // builder P: AgriTriage-Lite photo model
import diseaseMap from './bn.map'; // builder M: the Disease map
import tryPage from './bn.try'; // builder I: the /try tools
import tryStrip from './bn.trystrip'; // builder I: the "Try it" strip
import quickTools from './bn.quicktools'; // the home page's "Everything you can do"
import homestory from './bn.homestory'; // builder H: the home hero story
import offices from './bn.offices'; // builder O: nearest agriculture office
import mobile from './bn.mobile'; // builder Mo: the phone app (/m) and Open on your phone

import receipt from './bn.receipt'; // builder Pg: the /receipt walk-through
const d: Record<Key, string> = {
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
  ...quickTools,
  ...homestory,
  ...mobile,
  ...offices,
  ...receipt,
};

export default d;
