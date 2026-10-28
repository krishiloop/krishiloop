import type { ReplayArea, ReplaySummary } from '../../lib/api/types';
import { policyFromSettings, type Policy } from './policy';

/**
 * From the replay payload (GET /api/replay/area-trust) to what the chart draws. Pure functions, no React, so the
 * shaping can be tested without a browser. The replay is a precomputed run of the same gate over public rice datasets
 * (ml/vision/analysis/earned_trust_sim_v2.py --curves): the dataset's labels stand in for officers.
 */

/** The public datasets behind the replay's areas. All four are CC BY 4.0 on Mendeley Data. */
export const REPLAY_DATASETS: Record<string, string> = {
  'BD-A': 'Dhan-Shomadhan field photos',
  'BD-C': 'RiceyLeafDisease',
  'BD-D': 'RiceLeafDisease-BD5 (Savar)',
  'BD-E': 'RiceLeafDiseaseBD (Gazipur)',
};
const AREA_ORDER = Object.keys(REPLAY_DATASETS);
const PREFERRED_BACKBONE = 'bioclip2';

/** One point of a curve: the evidence the gate saw right before an officer verdict was counted. */
export interface ReplayPoint {
  photos: number;
  /** officer verdicts so far (the x axis) */
  verdicts: number;
  /** Wilson lower bound on the last sure verdicts; null until there are enough of them to count */
  lb: number | null;
  /** the gate stood when this photo arrived */
  open: boolean;
  auto: number;
  autoRight: number;
}

/** A stretch of the x axis (officer verdicts) during which the gate stood. `to` null = until the end of the replay. */
export interface GateWindow {
  from: number;
  to: number | null;
}

export interface ReplayModel {
  key: string;
  points: ReplayPoint[];
  summary: ReplaySummary;
  /** officer verdicts counted when the gate first opened; null = it never opened */
  openAt: number | null;
  windows: GateWindow[];
  /** officer verdict counts at which the gate closed again (drift) */
  closings: number[];
  /** first x with a lower bound that counts */
  firstBound: number | null;
  maxVerdicts: number;
}

const DEFAULT_FIELDS = ['photos_seen', 'officer_verdicts', 'lower_bound_before_this_verdict', 'gate_open', 'auto_answers', 'auto_right'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Read the point rows by the field names the payload declares (column order is not assumed). */
export function parsePoints(area: Pick<ReplayArea, 'fields' | 'points'>): ReplayPoint[] {
  const fields = area.fields?.length ? area.fields : DEFAULT_FIELDS;
  const col = (name: string) => {
    const i = fields.indexOf(name);
    return i >= 0 ? i : DEFAULT_FIELDS.indexOf(name);
  };
  const c = { photos: col('photos_seen'), verdicts: col('officer_verdicts'), lb: col('lower_bound_before_this_verdict'), open: col('gate_open'), auto: col('auto_answers'), right: col('auto_right') };
  const out: ReplayPoint[] = [];
  for (const row of area.points ?? []) {
    if (!Array.isArray(row)) continue;
    const photos = row[c.photos];
    const verdicts = row[c.verdicts];
    if (!isNum(photos) || !isNum(verdicts)) continue;
    const lb = row[c.lb];
    out.push({
      photos,
      verdicts,
      lb: isNum(lb) ? lb : null,
      open: row[c.open] === 1 || (row[c.open] as unknown) === true,
      auto: isNum(row[c.auto]) ? (row[c.auto] as number) : 0,
      autoRight: isNum(row[c.right]) ? (row[c.right] as number) : 0,
    });
  }
  return out;
}

/** Gate-open stretches and closings, from the `gate_open` flag of each point (the exact opening moment comes from the summary). */
export function gateWindows(points: readonly ReplayPoint[], openAt: number | null): { windows: GateWindow[]; closings: number[] } {
  const windows: GateWindow[] = [];
  const closings: number[] = [];
  let was = false;
  for (const p of points) {
    if (p.open && !was) windows.push({ from: windows.length === 0 && openAt !== null ? Math.min(openAt, p.verdicts) : p.verdicts, to: null });
    if (!p.open && was) {
      windows[windows.length - 1]!.to = p.verdicts;
      closings.push(p.verdicts);
    }
    was = p.open;
  }
  if (!windows.length && openAt !== null && points.length) windows.push({ from: openAt, to: null });
  return { windows, closings };
}

/** One dataset's replay, ready to draw. null when it has no usable points. */
export function shapeArea(key: string, area: ReplayArea | undefined): ReplayModel | null {
  if (!area?.summary || !Array.isArray(area.points)) return null;
  const points = parsePoints(area);
  if (!points.length) return null;
  const given = area.summary.confirmations_until_open;
  const derivedOpen = points.find((p) => p.open)?.verdicts ?? null;
  const openAt = isNum(given) ? given : derivedOpen;
  const { windows, closings } = gateWindows(points, openAt);
  return {
    key,
    points,
    summary: area.summary,
    openAt,
    windows,
    closings,
    firstBound: points.find((p) => p.lb !== null)?.verdicts ?? null,
    maxVerdicts: Math.max(...points.map((p) => p.verdicts), 1),
  };
}

export interface ShapedReplay {
  policy: Policy;
  note: string | null;
  backbone: string;
  backbones: string[];
  areas: ReplayModel[];
}

/** The whole payload. Unknown shapes give null (the page then says the replay cannot be shown), never a half-drawn chart. */
export function shapeReplay(raw: unknown, backbone: string = PREFERRED_BACKBONE): ShapedReplay | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { note?: unknown; settings?: Parameters<typeof policyFromSettings>[0]; areas?: Record<string, Record<string, ReplayArea>> };
  if (!r.areas || typeof r.areas !== 'object') return null;
  const backbones = Object.keys(r.areas);
  if (!backbones.length) return null;
  const chosen = backbones.includes(backbone) ? backbone : backbones[0]!;
  const byKey = r.areas[chosen] ?? {};
  const keys = Object.keys(byKey).sort((a, b) => {
    const ia = AREA_ORDER.indexOf(a);
    const ib = AREA_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const areas = keys.map((k) => shapeArea(k, byKey[k])).filter((m): m is ReplayModel => m !== null);
  if (!areas.length) return null;
  return { policy: policyFromSettings(r.settings), note: typeof r.note === 'string' ? r.note : null, backbone: chosen, backbones, areas };
}

/* ------------------------------------------------------------------ numbers under the chart */

export interface ReplayStats {
  photos: number;
  officerChecks: number;
  autoAnswers: number;
  autoRight: number;
  /** share of ALL photos answered automatically (0..1), null when the replay has no photos */
  autoShare: number | null;
  /** share of those automatic answers that were right (0..1), null when there were none */
  autoPrecision: number | null;
  openedAfter: number | null;
  closings: number;
  openAtEnd: boolean;
  neverOpened: boolean;
}

export function replayStats(m: ReplayModel): ReplayStats {
  const s = m.summary;
  const auto = s.auto_answers ?? 0;
  return {
    photos: s.photos,
    officerChecks: s.officer_confirmations,
    autoAnswers: auto,
    autoRight: s.auto_precision == null ? 0 : Math.round(s.auto_precision * auto),
    autoShare: s.photos > 0 ? (isNum(s.auto_share_of_all_photos) ? s.auto_share_of_all_photos : auto / s.photos) : null,
    autoPrecision: s.auto_precision ?? null,
    openedAfter: m.openAt,
    closings: Math.max(s.gate_closings ?? 0, m.closings.length),
    openAtEnd: !!s.open_at_end,
    neverOpened: m.openAt === null,
  };
}

/** How good the officer's suggestion was while the gate was still closed, by stage of the stream. */
export interface StageRow {
  from: number;
  to: number;
  photos: number;
  top1: number | null;
  top2: number | null;
}
export function stageRows(s: ReplaySummary): StageRow[] {
  return Object.entries(s.suggestion_by_stage ?? {})
    .map(([k, v]) => {
      const [from, to] = k.split('-').map(Number);
      return { from: from ?? 0, to: to ?? 0, photos: v[0] ?? 0, top1: v[1] ?? null, top2: v[2] ?? null };
    })
    .filter((r) => r.photos > 0)
    .sort((a, b) => a.from - b.from);
}

/** What the cursor reads at one point of the replay. */
export interface Readout {
  index: number;
  photos: number;
  verdicts: number;
  lowerBound: number | null;
  gateOpen: boolean;
  autoAnswers: number;
  autoRight: number;
  autoShare: number | null;
  autoPrecision: number | null;
}
export function readoutAt(m: ReplayModel, index: number): Readout {
  const i = Math.min(m.points.length - 1, Math.max(0, Math.round(index)));
  const p = m.points[i]!;
  return {
    index: i,
    photos: p.photos,
    verdicts: p.verdicts,
    lowerBound: p.lb,
    gateOpen: p.open,
    autoAnswers: p.auto,
    autoRight: p.autoRight,
    autoShare: p.photos > 0 ? p.auto / p.photos : null,
    autoPrecision: p.auto > 0 ? p.autoRight / p.auto : null,
  };
}

/* ------------------------------------------------------------------ chart geometry */

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartGeometry {
  box: ChartBox;
  plotW: number;
  plotH: number;
  x: (verdicts: number) => number;
  y: (lowerBound: number) => number;
  xTicks: number[];
  yTicks: number[];
  /** the lower-bound curve (broken where it is not counted yet) */
  curve: string;
  /** the same curve closed down to the axis, for a faint fill */
  fill: string;
  bar: { y: number; value: number };
  closeBar: { y: number; value: number };
  /** gate-open stretches as rectangles of the plot */
  windows: { x: number; w: number }[];
  /** the stretch before the first counted bound */
  uncounted: { x: number; w: number } | null;
  openMarker: { x: number; y: number } | null;
  closeMarkers: { x: number; y: number }[];
  /** x of a point and y of its bound (null when not counted) */
  at: (index: number) => { x: number; y: number | null };
}

/** Round tick positions for 0..max (1, 2, 5 times a power of ten). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * `yMin` (default 0) is the bottom of the y axis. The counted bounds of the real replay sit between 0.6 and 0.95, so the
 * trust page draws 0.5..1 to keep the bar (0.85) and the close line (0.80) apart; the axis labels say where it starts.
 */
export function buildChart(m: ReplayModel, policy: Policy, box: ChartBox, yMin = 0): ChartGeometry {
  const plotW = Math.max(1, box.width - box.left - box.right);
  const plotH = Math.max(1, box.height - box.top - box.bottom);
  const xMax = Math.max(1, m.maxVerdicts);
  const lo = Math.min(Math.max(yMin, 0), 0.95);
  const x = (v: number) => r1(box.left + (Math.min(Math.max(v, 0), xMax) / xMax) * plotW);
  const y = (lb: number) => r1(box.top + (1 - (Math.min(Math.max(lb, lo), 1) - lo) / (1 - lo)) * plotH);

  let curve = '';
  let pen = false;
  for (const p of m.points) {
    if (p.lb === null) {
      pen = false;
      continue;
    }
    curve += `${pen ? 'L' : 'M'}${x(p.verdicts)} ${y(p.lb)}`;
    pen = true;
  }
  const counted = m.points.filter((p) => p.lb !== null);
  const fill = counted.length > 1 ? `${counted.map((p, i) => `${i ? 'L' : 'M'}${x(p.verdicts)} ${y(p.lb!)}`).join('')}L${x(counted.at(-1)!.verdicts)} ${y(lo)}L${x(counted[0]!.verdicts)} ${y(lo)}Z` : '';

  const windows = m.windows.map((w) => {
    const x0 = x(w.from);
    const x1 = x(w.to ?? xMax);
    return { x: x0, w: Math.max(1, r1(x1 - x0)) };
  });
  const uncounted = m.firstBound !== null ? (m.firstBound > 0 ? { x: x(0), w: Math.max(1, r1(x(m.firstBound) - x(0))) } : null) : { x: x(0), w: plotW };

  return {
    box,
    plotW,
    plotH,
    x,
    y,
    xTicks: niceTicks(xMax),
    yTicks: lo === 0 ? [0, 0.25, 0.5, 0.75, 1] : Array.from({ length: Math.round((1 - lo) / 0.1) + 1 }, (_, i) => Math.round((lo + i * 0.1) * 100) / 100).filter((v) => v <= 1),
    curve,
    fill,
    bar: { y: y(policy.openLb), value: policy.openLb },
    closeBar: { y: y(policy.closeLb), value: policy.closeLb },
    windows,
    uncounted,
    openMarker: m.openAt !== null ? { x: x(m.openAt), y: y(policy.openLb) } : null,
    closeMarkers: m.closings.map((c) => ({ x: x(c), y: y(policy.closeLb) })),
    at: (i) => {
      const p = m.points[Math.min(m.points.length - 1, Math.max(0, Math.round(i)))]!;
      return { x: x(p.verdicts), y: p.lb === null ? null : y(p.lb) };
    },
  };
}

/** The index of the point nearest to a position on the x axis (for pointer scrubbing). */
export function nearestIndex(m: ReplayModel, verdicts: number): number {
  let best = 0;
  let gap = Infinity;
  m.points.forEach((p, i) => {
    const d = Math.abs(p.verdicts - verdicts);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}
