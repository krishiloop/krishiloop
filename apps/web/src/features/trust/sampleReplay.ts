import type { ReplayArea, ReplayPayload, ReplaySummary } from '../../lib/api/types';
import { POLICY_V1, wilsonLowerBound } from './policy';

/**
 * INVENTED curves in the shape of GET /api/replay/area-trust, for mock mode (the API is unreachable or sample data is on)
 * and for tests. Nothing here was measured: a seeded random stream stands in for the classifier, and the gate rule is the
 * real one (policy v1, Wilson lower bound). The trust page labels it "Sample" wherever it is shown, and the real replay
 * replaces it as soon as the server has generated one.
 */

interface Spec {
  photos: number;
  /** how fast the share of sure suggestions grows, and how right the sure ones are at the start and at the end */
  sureTau: number;
  accStart: number;
  accEnd: number;
  accTau: number;
  /** after this many photos the sure answers get worse (drift), 0 = never */
  driftAt?: number;
  driftAcc?: number;
}

const SPECS: Record<string, Spec> = {
  'BD-A': { photos: 300, sureTau: 160, accStart: 0.62, accEnd: 0.93, accTau: 110 },
  'BD-C': { photos: 800, sureTau: 90, accStart: 0.7, accEnd: 0.97, accTau: 60 },
  'BD-D': { photos: 1200, sureTau: 60, accStart: 0.78, accEnd: 0.995, accTau: 40 },
  'BD-E': { photos: 1500, sureTau: 150, accStart: 0.6, accEnd: 0.96, accTau: 120, driftAt: 1100, driftAcc: 0.6 },
};

/** mulberry32: a tiny seeded generator, so the sample never changes between runs */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(spec: Spec, seed: number): ReplayArea {
  const rand = rng(seed);
  const p = POLICY_V1;
  const ledger: boolean[] = [];
  const rows: (number | null)[][] = [];
  let open = false;
  let openedAt: number | null = null;
  let closings = 0;
  let officer = 0;
  let auto = 0;
  let autoRight = 0;
  const stage: Record<string, [number, number, number]> = { '0-50': [0, 0, 0], '50-200': [0, 0, 0], '200-500': [0, 0, 0], '500-2000': [0, 0, 0] };
  const stageOf = (t: number) => (t < 50 ? '0-50' : t < 200 ? '50-200' : t < 500 ? '200-500' : '500-2000');
  for (let t = 0; t < spec.photos; t++) {
    const sure = rand() < Math.min(0.9, 0.12 + 0.8 * (1 - Math.exp(-t / spec.sureTau)));
    const drifted = !!spec.driftAt && t >= spec.driftAt;
    const acc = drifted ? (spec.driftAcc ?? 0.6) : spec.accEnd - (spec.accEnd - spec.accStart) * Math.exp(-t / spec.accTau);
    const right = rand() < acc;
    const top2 = right || rand() < 0.55;
    const s = stage[stageOf(t)]!;
    s[0] += 1;
    s[1] += right ? 1 : 0;
    s[2] += top2 ? 1 : 0;
    let confirm = true;
    if (open && sure) {
      auto += 1;
      autoRight += right ? 1 : 0;
      confirm = rand() < p.audit;
    }
    if (!confirm) continue;
    officer += 1;
    const w = ledger.slice(-p.window);
    rows.push([t + 1, officer, w.length >= p.minSure ? Math.round(wilsonLowerBound(w.filter(Boolean).length, w.length) * 1e4) / 1e4 : null, open ? 1 : 0, auto, autoRight]);
    if (sure) {
      ledger.push(right);
      const last = ledger.slice(-p.window);
      const lb = wilsonLowerBound(last.filter(Boolean).length, last.length);
      if (!open && last.length >= p.minSure && lb >= p.openLb) {
        open = true;
        openedAt ??= officer;
      } else if (open && last.length >= p.minSure && lb < p.closeLb) {
        open = false;
        closings += 1;
      }
    }
  }
  const step = Math.max(1, Math.ceil(rows.length / 300));
  const points = rows.filter((_, i) => i % step === 0);
  if (rows.length && points.at(-1) !== rows.at(-1)) points.push(rows.at(-1)!);
  const summary: ReplaySummary = {
    photos: spec.photos,
    confirmations_until_open: openedAt,
    officer_confirmations: officer,
    auto_answers: auto,
    auto_precision: auto ? Math.round((autoRight / auto) * 1e4) / 1e4 : null,
    auto_share_of_all_photos: Math.round((auto / spec.photos) * 1e4) / 1e4,
    gate_closings: closings,
    open_at_end: open,
    suggestion_by_stage: Object.fromEntries(
      Object.entries(stage).map(([k, v]) => [k, [v[0], v[0] ? Math.round((v[1] / v[0]) * 1e3) / 1e3 : null, v[0] ? Math.round((v[2] / v[0]) * 1e3) / 1e3 : null] as [number, number | null, number | null]]),
    ),
  };
  return { fields: ['photos_seen', 'officer_verdicts', 'lower_bound_before_this_verdict', 'gate_open', 'auto_answers', 'auto_right'], points, summary };
}

/** Four invented areas under the backbone key the real replay will use. BD-E drifts late, so the closing is drawn too. */
export function buildSampleReplay(): ReplayPayload {
  const areas: Record<string, ReplayArea> = {};
  Object.entries(SPECS).forEach(([key, spec], i) => {
    areas[key] = run(spec, 1000 + i * 17);
  });
  return {
    note: 'SAMPLE: invented curves that show the layout. Not measured, not from the datasets.',
    settings: { sure: POLICY_V1.sure, window: POLICY_V1.window, min_n: POLICY_V1.minSure, open_lb: POLICY_V1.openLb, close_lb: POLICY_V1.closeLb, audit: POLICY_V1.audit },
    areas: { bioclip2: areas },
  };
}
