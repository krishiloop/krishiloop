/** Registers the "Everything you can do" words wherever QuickTools is mounted (see index.ts: English loads per screen). */
import { registerStrings } from './index';
import quickTools from './en.quicktools';

registerStrings(quickTools);
