/**
 * The Ask router's LangGraph path (`pipeline.path`, e.g. normalise > retrieve_bm25 > ... > receipt) read as a fixed row of
 * stages, so the app can draw "how this was answered": what ran, what was skipped, and where an abstention left the path.
 * Pure: no React, no fetching. Unknown nodes are kept (shown as they are), never dropped.
 */

export const STAGES = ['normalise', 'bm25', 'dense', 'fuse', 'rerank', 'match', 'decide', 'render', 'validate', 'receipt'] as const;
export type StageId = (typeof STAGES)[number] | 'abstain';

/**
 *  ran       the node is in the path
 *  skipped   the path names it as skipped (`rerank:skipped`) or jumps over it before the end
 *  unused    after an abstention: the rest of the answer path never runs
 */
export type StageState = 'ran' | 'skipped' | 'unused';

export interface StageView {
  id: StageId | string;
  state: StageState;
  /** a node this app does not know (its raw name is shown) */
  unknown?: boolean;
}

const NODE: Record<string, StageId> = {
  normalise: 'normalise',
  normalize: 'normalise',
  retrieve_bm25: 'bm25',
  bm25: 'bm25',
  retrieve_dense: 'dense',
  dense: 'dense',
  fuse: 'fuse',
  rerank: 'rerank',
  match_rules: 'match',
  match: 'match',
  decide: 'decide',
  render: 'render',
  validate: 'validate',
  receipt: 'receipt',
  abstain: 'abstain',
};

export function readPipeline(path: readonly string[] | undefined): StageView[] {
  const ran = new Set<StageId>();
  const skipped = new Set<StageId>();
  const unknown: string[] = [];
  let abstained = false;
  for (const raw of path ?? []) {
    const [name = '', flag] = raw.split(':');
    const id = NODE[name];
    if (!id) {
      unknown.push(raw);
      continue;
    }
    if (id === 'abstain') abstained = true;
    else if (flag === 'skipped') skipped.add(id);
    else ran.add(id);
  }
  // the last known stage that ran: anything before it that did not run was jumped over
  const lastRan = STAGES.reduce((acc, s, i) => (ran.has(s) ? i : acc), -1);
  const out: StageView[] = STAGES.map((s, i) => {
    if (ran.has(s)) return { id: s, state: 'ran' };
    if (skipped.has(s) || i < lastRan) return { id: s, state: 'skipped' };
    return { id: s, state: 'unused' };
  });
  if (abstained) {
    // an abstention ends the path after "decide": render, validate and receipt never ran
    const cut = out.findIndex((v) => v.id === 'render');
    out.splice(cut === -1 ? out.length : cut, 0, { id: 'abstain', state: 'ran' });
  }
  for (const u of unknown) out.push({ id: u, state: 'ran', unknown: true });
  return out;
}
