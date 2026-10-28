import { createStore } from '../../lib/store';

/**
 * "Install app": shown only when the browser offers it (`beforeinstallprompt`, Chromium with the service worker in a
 * production build). Hidden everywhere else, never faked.
 */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;
export const installStore = createStore<'none' | 'ready' | 'installed'>('none');

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    installStore.set('ready');
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installStore.set('installed');
  });
}

export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installStore.set(outcome === 'accepted' ? 'installed' : 'none');
}

export const useInstall = () => installStore.use();
