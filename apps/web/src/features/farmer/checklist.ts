import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';

/**
 * "What to try": the six things a visitor can do in the glass-box demo. Each one ticks itself when the visitor really
 * does it (opening a receipt, asking, asking by voice, sending a photo, opening the verifier, a recall reaching this
 * tab). Kept in this browser (lib/storage), with a reset.
 */
export const TRY_IDS = ['receipt', 'ask', 'voice', 'photo', 'verify', 'recall'] as const;
export type TryId = (typeof TRY_IDS)[number];
type Tried = Partial<Record<TryId, number>>;

const KEY = 'kl.farmer.try';
export const tried = createStore<Tried>(readJSON<Tried>(KEY) ?? {});

export function tick(id: TryId) {
  if (tried.get()[id]) return;
  tried.set((s) => {
    const next = { ...s, [id]: Date.now() };
    writeJSON(KEY, next);
    return next;
  });
}

export function resetTried() {
  writeJSON(KEY, {});
  tried.set({});
}

export const useTried = () => tried.use();
