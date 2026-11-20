/**
 * Spanish (Español): a machine-translated PREVIEW (written by the AI assistant, 20 Nov 2026), labelled in the UI. Partial: the farmer app, the verifier and the
 * shared shell; every other key shows English. Spread from the per-screen files.
 */
import type { Key } from './index';
import ui from './es.ui';
import farmer from './es.farmer';
import verify from './es.verify';

const d: Partial<Record<Key, string>> = {
  ...ui,
  ...farmer,
  ...verify,
};

export default d;
