/** Registers the /try words (builder I) when its lazy chunk loads (see index.ts: English loads per screen). */
import { registerStrings } from './index';
import strings from './en.try';
import strip from './en.trystrip';

registerStrings({ ...strings, ...strip });
