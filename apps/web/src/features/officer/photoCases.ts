import { createStore } from '../../lib/store';
import { apiStore, sessionStore } from '../../lib/api/client';
import { areaCache, judgePhotoCase, listPhotoCases, loadAreaStats, photoErrorKind, type PhotoErrorKind } from '../../lib/api/trust';
import type { AreaStats, GateEvent, PhotoCase } from '../../lib/api/types';

/**
 * The officer's photo cases (server path): this demo session's cases, newest first, and what each verdict moved.
 * In the demo the visitor plays the officer; a real officer's verdicts will need the officer's sign-in (backend: planned).
 *
 *  idle         not asked yet (or sample data is on: there is no server to ask)
 *  loading      asking
 *  ready        the cases are here (maybe none)
 *  unavailable  503: this server has no photo model, so there are no photo cases
 *  offline      the API did not answer
 */
export type PhotoLoad = 'idle' | 'loading' | 'ready' | 'unavailable' | 'offline';

/** What one verdict did: the area's numbers before and after it, and the gate event it caused, if any. */
export interface VerdictOutcome {
  before: AreaStats | null;
  after: AreaStats;
  event: GateEvent | null;
}

interface PhotoState {
  cases: PhotoCase[];
  load: PhotoLoad;
  outcomes: Record<string, VerdictOutcome>;
}

const empty: PhotoState = { cases: [], load: 'idle', outcomes: {} };
export const photoCases = createStore<PhotoState>(empty);
export const usePhotoCases = () => photoCases.use();

// a new sandbox is a new ledger and a new set of cases
sessionStore.subscribe(() => {
  if (sessionStore.get() === null) photoCases.set(empty);
});

/** Fetch this session's photo cases and the numbers of the areas they belong to. */
export async function loadPhotoCases(): Promise<void> {
  if (apiStore.get().forced) {
    photoCases.set((s) => ({ ...s, cases: [], load: 'idle' }));
    return;
  }
  photoCases.set((s) => ({ ...s, load: s.load === 'ready' ? 'ready' : 'loading' }));
  try {
    const cases = await listPhotoCases();
    photoCases.set((s) => ({ ...s, cases, load: 'ready' }));
    const areas = [...new Set(cases.map((c) => c.area))];
    await Promise.all(areas.map((a) => loadAreaStats(a).catch(() => null)));
  } catch (e) {
    const kind = photoErrorKind(e);
    photoCases.set((s) => ({ ...s, load: kind === 'unavailable' ? 'unavailable' : 'offline' }));
  }
}

export type JudgeResult = { ok: true; outcome: VerdictOutcome } | { ok: false; error: PhotoErrorKind };

/** The officer's verdict on one case. The area's numbers from just before it are kept, so the screen can show them move. */
export async function judge(caseId: string, label: string): Promise<JudgeResult> {
  const c = photoCases.get().cases.find((x) => x.case_id === caseId);
  const before = c ? (areaCache.get().areas[c.area] ?? null) : null;
  try {
    const r = await judgePhotoCase(caseId, label);
    const outcome: VerdictOutcome = { before, after: r.area, event: r.event };
    photoCases.set((s) => ({
      ...s,
      cases: s.cases.some((x) => x.case_id === caseId) ? s.cases.map((x) => (x.case_id === caseId ? r.case : x)) : [r.case, ...s.cases],
      outcomes: { ...s.outcomes, [caseId]: outcome },
    }));
    return { ok: true, outcome };
  } catch (e) {
    const error = photoErrorKind(e);
    if (error === 'judged') void loadPhotoCases(); // someone answered it already: show what the server says
    return { ok: false, error };
  }
}
