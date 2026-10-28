import { useSyncExternalStore } from 'react';

/** A tiny external store (no library): `get`, `set`, `subscribe` and a `use()` hook. */
export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  const get = () => state;
  const subscribe = (fn: () => void) => {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  };
  const set = (next: T | ((prev: T) => T)) => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
    if (Object.is(value, state)) return;
    state = value;
    subs.forEach((fn) => fn());
  };
  const use = () => useSyncExternalStore(subscribe, get, get);
  const useSelector = <S,>(select: (s: T) => S) => useSyncExternalStore(subscribe, () => select(state), () => select(state));
  return { get, set, subscribe, use, useSelector };
}
