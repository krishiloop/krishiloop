/**
 * The farmer's place and the office list, shared by every "Nearest Krishi officer" card and the finder, so the
 * farmer answers "where are you?" once per visit. The place stays in this tab's memory only: it is sent nowhere and
 * is gone when the page closes.
 */
import { useEffect } from 'react';
import { createStore } from '../../lib/store';
import type { OfficeData, Place } from './nearest';

export type LocStatus = 'idle' | 'asking' | 'denied';
export const placeStore = createStore<{ place: Place | null; status: LocStatus }>({ place: null, status: 'idle' });

export function locate(): void {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    placeStore.set((s) => ({ ...s, status: 'denied' }));
    return;
  }
  placeStore.set((s) => ({ ...s, status: 'asking' }));
  navigator.geolocation.getCurrentPosition(
    (p) => placeStore.set({ place: { kind: 'gps', lat: p.coords.latitude, lon: p.coords.longitude }, status: 'idle' }),
    () => placeStore.set((s) => ({ place: s.place?.kind === 'district' ? s.place : null, status: 'denied' })),
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
  );
}

export const pickDistrict = (district: string) => placeStore.set({ place: district ? { kind: 'district', district } : null, status: 'idle' });
export const clearPlace = () => placeStore.set({ place: null, status: 'idle' });

/** The office list (about 300 KB) is its own chunk and loads once, on the first need. */
const dataStore = createStore<OfficeData | null>(null);
let loading: Promise<void> | null = null;
export function loadOffices(): Promise<void> {
  loading ??= import('../../data/offices/bd.json').then((m) => dataStore.set((m.default ?? m) as unknown as OfficeData)).catch(() => {
    loading = null;
  });
  return loading;
}
export function useOffices(want: boolean): OfficeData | null {
  const data = dataStore.use();
  useEffect(() => {
    if (want && !data) void loadOffices();
  }, [want, data]);
  return data;
}
