/**
 * The officer console's radar tab label (builder R), split from en.krishiguard.ts so the console's first visit carries
 * two words, not the whole KrishiGuard dictionary (that loads with the radar's own chunk). Spread into en.ts.
 */
const radartab = {
  'off.radar.tab': 'Disease reports map',
  'off.radar.tabShort': 'Map',
} as const satisfies Record<string, string>;

export default radartab;
