import { useSyncExternalStore } from 'react';
import { readStore, writeStore } from '../../lib/storage';

/** Small facts about the phone the app runs on: is it online, and has it seen the welcome screens. */
const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
/** navigator.onLine, live. "Online" only means a network is there; the server may still be down (the app says so). */
export const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

/* ------------------------------------------------------------------ first run */
const OB_KEY = 'kl.m.welcomed';
export const welcomed = () => readStore(OB_KEY) === '1';
export const setWelcomed = (on: boolean) => writeStore(OB_KEY, on ? '1' : null);

