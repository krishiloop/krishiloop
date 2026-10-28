import type { Credential, DidDocument } from '../../lib/api/types';

/**
 * The in-browser signature check (src/lib/vc/verify.ts, written by another builder against this contract):
 *   verifyInBrowser(credential, did) -> { ok: true, suite: 'eddsa-jcs-2022', keyId } | { ok: false, reason }
 *
 * It is loaded through a glob import, which is a lazy dynamic import that resolves to nothing while the file does not
 * exist yet: the verifier then says the in-browser check is not available here, and never claims a result it did not get.
 * Once the file exists Vite code-splits it into its own chunk, downloaded only when a receipt is checked.
 */
export type LocalCheck = { ok: true; suite: 'eddsa-jcs-2022'; keyId: string } | { ok: false; reason: string };
export type LocalCheckState = { state: 'checking' } | { state: 'unavailable'; reason?: string } | { state: 'done'; result: LocalCheck };

interface VcModule {
  verifyInBrowser?: (credential: Credential, did: DidDocument) => Promise<LocalCheck>;
}

const modules = import.meta.glob<VcModule>('../../lib/vc/verify.ts');

export const localCheckAvailable = () => Object.keys(modules).length > 0;

export async function checkInBrowser(credential: Credential, did: DidDocument | null): Promise<LocalCheckState> {
  const load = Object.values(modules)[0];
  if (!load) return { state: 'unavailable' };
  if (!did) return { state: 'unavailable', reason: 'no-did' };
  let mod: VcModule;
  try {
    mod = await load();
  } catch (e) {
    return { state: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
  }
  if (typeof mod.verifyInBrowser !== 'function') return { state: 'unavailable' };
  try {
    return { state: 'done', result: await mod.verifyInBrowser(credential, did) };
  } catch (e) {
    return { state: 'done', result: { ok: false, reason: e instanceof Error ? e.message : String(e) } };
  }
}
