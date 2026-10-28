import { useEffect, useState } from 'react';
import { apiStore, fetchPacks, fetchStats, useSessionId } from './client';
import type { PackInfo, Stats } from './types';

/** Counters from the API: this tab's demo session when it has one, otherwise the official ones. `null` until known (or in sample mode). */
export function useStats(refreshKey: unknown = 0): { stats: Stats; scope: 'session' | 'official' } | null {
  const [data, setData] = useState<{ stats: Stats; scope: 'session' | 'official' } | null>(null);
  const sid = useSessionId();
  const forced = apiStore.use().forced;
  useEffect(() => {
    let alive = true;
    void fetchStats().then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [refreshKey, sid, forced]);
  return data;
}

let packsCall: Promise<PackInfo[] | null> | null = null;

/** Which crops have a rule pack (GET /api/packs). `null` when unknown. */
export function usePacks(): PackInfo[] | null {
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const forced = apiStore.use().forced;
  useEffect(() => {
    let alive = true;
    packsCall ??= fetchPacks();
    void packsCall.then((p) => alive && setPacks(forced ? null : p));
    return () => {
      alive = false;
    };
  }, [forced]);
  return packs;
}
