import { createStore } from './store';
import { queryParam, readStore, writeStore } from './storage';

/**
 * Device profile + the Lite / Rich switch.
 *
 * Lite = no WebGL, no grain, no blur, no smooth-scroll, CSS-only motion: it must run smoothly on a mid-range
 * Android. We pick it automatically when the device clearly needs it (no WebGL, Data Saver, <= 2 GB, 2G),
 * and OFFER it with one tap when the device is borderline. The visitor's choice always wins and is remembered.
 */

let webgl: boolean | null = null;
let renderer: string | null = null;

/** Renderer names browsers report when WebGL runs on the CPU instead of a graphics chip. */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Whether this browser can create a WebGL context (checked once). */
export function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas');
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
      webgl = !!gl;
      if (gl) {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

export const isSoftwareGL = () => {
  hasWebGL();
  return !!renderer && SOFTWARE_GL.test(renderer);
};

interface NetInfo {
  saveData?: boolean;
  effectiveType?: string;
}

export interface DeviceProfile {
  webgl: boolean;
  software: boolean;
  memory: number | null;
  cores: number | null;
  saveData: boolean;
  net: string | null;
  coarse: boolean;
}

export function profileDevice(): DeviceProfile {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: NetInfo };
  const c = nav.connection;
  return {
    webgl: hasWebGL(),
    software: isSoftwareGL(),
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    saveData: !!c?.saveData,
    net: c?.effectiveType ?? null,
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  };
}

export type ModePref = 'auto' | 'lite' | 'rich';
export interface ModeState {
  pref: ModePref;
  resolved: 'lite' | 'rich';
  /** why Lite was chosen automatically, or why it is suggested */
  reason: 'no-webgl' | 'data-saver' | 'low-memory' | 'slow-network' | 'borderline' | null;
  suggestLite: boolean;
}

export function assess(p: DeviceProfile): { auto: 'lite' | 'rich'; reason: ModeState['reason']; suggest: boolean } {
  if (!p.webgl) return { auto: 'lite', reason: 'no-webgl', suggest: false };
  if (p.saveData) return { auto: 'lite', reason: 'data-saver', suggest: false };
  if (p.memory !== null && p.memory <= 2) return { auto: 'lite', reason: 'low-memory', suggest: false };
  if (p.net && /(^|-)2g$/.test(p.net)) return { auto: 'lite', reason: 'slow-network', suggest: false };
  const borderline = (p.memory !== null && p.memory <= 4 && (p.cores ?? 8) <= 6) || p.net === '3g' || (p.software && p.coarse);
  return { auto: 'rich', reason: borderline ? 'borderline' : null, suggest: borderline };
}

function initial(): ModeState {
  const stored = readStore('kl.mode');
  const forced = queryParam('mode');
  const pref: ModePref = forced === 'lite' || forced === 'rich' ? forced : stored === 'lite' || stored === 'rich' ? stored : 'auto';
  return resolve(pref);
}

function resolve(pref: ModePref): ModeState {
  const a = assess(profileDevice());
  if (pref === 'lite') return { pref, resolved: 'lite', reason: null, suggestLite: false };
  // "rich" is honoured unless there is literally no WebGL
  if (pref === 'rich') return { pref, resolved: a.reason === 'no-webgl' ? 'lite' : 'rich', reason: a.reason === 'no-webgl' ? 'no-webgl' : null, suggestLite: false };
  return { pref, resolved: a.auto, reason: a.reason, suggestLite: a.suggest && readStore('kl.liteHint') !== 'dismissed' };
}

export const modeStore = createStore<ModeState>(typeof window === 'undefined' ? { pref: 'auto', resolved: 'rich', reason: null, suggestLite: false } : initial());

function applyClass(s: ModeState) {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('lite', s.resolved === 'lite');
}
applyClass(modeStore.get());
modeStore.subscribe(() => applyClass(modeStore.get()));

export function setModePref(pref: ModePref) {
  if (queryParam('mode') == null) writeStore('kl.mode', pref === 'auto' ? null : pref);
  modeStore.set(resolve(pref));
}

export function dismissLiteHint() {
  writeStore('kl.liteHint', 'dismissed');
  modeStore.set((s) => ({ ...s, suggestLite: false }));
}

export const useMode = () => modeStore.use();
export const useIsLite = () => modeStore.useSelector((s) => s.resolved === 'lite');
export const isLite = () => modeStore.get().resolved === 'lite';
