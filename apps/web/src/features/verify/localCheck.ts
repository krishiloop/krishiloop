import type { Credential, DidDocument } from '../../lib/api/types';
import type { ProofStep } from '../../lib/vc/verify';

/**
 * The in-browser signature check (src/lib/vc/verify.ts):
 *   checkProof(credential, did, { onStep }) -> { ok: true, suite: 'eddsa-jcs-2022', keyId } | { ok: false, reason }
 * reporting each step as it completes (key from the DID document, JCS canonical bytes, the two SHA-256 hashes, the
 * Ed25519 verdict). The verifier page shows those steps as they run.
 *
 * It is loaded through a glob import, a lazy dynamic import: Vite code-splits it into its own chunk, downloaded only
 * when a receipt is checked. If the module were missing, the verifier says the in-browser check is not available here,
 * and never claims a result it did not get.
 */
export type LocalCheck = { ok: true; suite: 'eddsa-jcs-2022'; keyId: string } | { ok: false; reason: string };
export type LocalCheckState = { state: 'checking' } | { state: 'unavailable'; reason?: string } | { state: 'done'; result: LocalCheck };
export type { ProofStep };

interface VcModule {
  verifyInBrowser?: (credential: Credential, did: DidDocument) => Promise<LocalCheck>;
  checkProof?: (credential: unknown, did: unknown, opts?: { onStep?: (s: ProofStep) => void }) => Promise<LocalCheck>;
}

const modules = import.meta.glob<VcModule>('../../lib/vc/verify.ts');

export const localCheckAvailable = () => Object.keys(modules).length > 0;

/** Run the check in this browser; `onStep` hears each step the moment it completes. Never throws. */
export async function checkInBrowser(credential: Credential, did: DidDocument | null, onStep?: (s: ProofStep) => void): Promise<LocalCheckState> {
  const load = Object.values(modules)[0];
  if (!load) return { state: 'unavailable' };
  if (!did) return { state: 'unavailable', reason: 'no-did' };
  let mod: VcModule;
  try {
    mod = await load();
  } catch (e) {
    return { state: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (typeof mod.checkProof === 'function') return { state: 'done', result: await mod.checkProof(credential, did, { onStep }) };
    if (typeof mod.verifyInBrowser === 'function') return { state: 'done', result: await mod.verifyInBrowser(credential, did) };
    return { state: 'unavailable' };
  } catch {
    // only a WebCrypto failure can land here (as verifyInBrowser does): we could not run the check
    return { state: 'done', result: { ok: false, reason: 'unsupported' } };
  }
}
