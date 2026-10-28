import { createStore } from '../../lib/store';
import { fetchStats } from '../../lib/api/client';
import type { Stats } from '../../lib/api/types';

/**
 * The console's counters from the API (GET /api/demo/{sid}/stats once the tab has a sandbox). `none`: no counters came back
 * (recorded mode, or the API did not answer); the strip then counts what is on screen and says it is recorded.
 */
interface StatsState {
  load: 'idle' | 'loading' | 'ready' | 'none';
  stats: Stats | null;
  scope: 'session' | 'official' | null;
}
export const statsStore = createStore<StatsState>({ load: 'idle', stats: null, scope: null });
export const useConsoleStats = () => statsStore.use();

export async function loadStats() {
  statsStore.set((s) => ({ ...s, load: s.stats ? s.load : 'loading' }));
  const r = await fetchStats();
  statsStore.set(r ? { load: 'ready', stats: r.stats, scope: r.scope } : { load: 'none', stats: null, scope: null });
}

/** Advice receipts signed in the sandbox: every stored credential, less the rule and area credentials (each of those holds a status-list entry). */
export const receiptsSigned = (s: Stats) => Math.max(0, s.credentials_stored - s.status_entries_used);
