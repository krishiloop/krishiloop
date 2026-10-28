/**
 * Swahili (Kiswahili): a machine-translated PREVIEW, labelled in the UI. Partial: the farmer app, the verifier and the
 * shared shell; every other key shows English. Spread from the per-screen files.
 */
import type { Key } from './index';
import ui from './sw.ui';
import farmer from './sw.farmer';
import verify from './sw.verify';

const d: Partial<Record<Key, string>> = {
  ...ui,
  ...farmer,
  ...verify,
};

export default d;
