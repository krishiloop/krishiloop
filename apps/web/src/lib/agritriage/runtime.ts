/**
 * AgriTriage-Lite in the browser: ONNX Runtime Web 1.31.1 (the demo's own WASM build, copied unchanged into
 * public/models/agritriage/ort/, MIT licence) and the 11.5 MB INT8 student, both loaded only when the Photo tab asks.
 * Single-threaded: the site sends no cross-origin isolation headers, and we do not add them globally.
 * The photo never leaves the phone for this step. Research weights (trained on PlantWild, non-commercial).
 */
import { gate, type GateResult, type TriageConfig } from './gate';
import { GRID, heatFromDrops, maskedBatch, patches } from './occlusion';

export const BASE = '/models/agritriage/';

interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}
interface OrtSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>, fetches?: readonly string[]): Promise<Record<string, OrtTensor>>;
}

/** model_xai.onnx's extra outputs read with every diagnosis (tools/xai_export.py): no extra run. */
export const XAI_FETCH = ['logits', 'xai_cam', 'xai_cam_bias', 'xai_attn3_0', 'xai_attn3_1'] as const;
interface OrtModule {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(url: string, opts: Record<string, unknown>): Promise<OrtSession> };
}
declare global {
  interface Window {
    ort?: OrtModule;
  }
}

export interface Runtime {
  cfg: TriageConfig;
  session: OrtSession;
  ort: OrtModule;
  input: string;
  /** seconds from the first byte asked to a ready session */
  loadS: number;
  threads: number;
  /** the file has the XAI outputs (model_xai.onnx) */
  xai: boolean;
}

let loading: Promise<Runtime> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.ort) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load the photo model runtime'));
    document.head.appendChild(s);
  });
}

/** Load the runtime, the config and the model once; later calls share the same promise. */
export function loadRuntime(): Promise<Runtime> {
  if (!loading) {
    loading = (async () => {
      const t0 = performance.now();
      const [, cfg] = await Promise.all([
        loadScript(`${BASE}ort/ort.wasm.min.js`),
        fetch(`${BASE}config.json`).then((r) => {
          if (!r.ok) throw new Error(`config.json: HTTP ${r.status}`);
          return r.json() as Promise<TriageConfig>;
        }),
      ]);
      const ort = window.ort!;
      ort.env.wasm.wasmPaths = new URL(`${BASE}ort/`, location.href).href;
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(`${BASE}${cfg.model}`, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        extra: { session: { disable_quant_qdq: '1' } }, // fold the INT8 weights to float once, at load (as the demo)
      });
      const xai = XAI_FETCH.every((n) => session.outputNames.includes(n));
      return { cfg, session, ort, input: session.inputNames[0], loadS: (performance.now() - t0) / 1000, threads: 1, xai };
    })();
    loading.catch(() => {
      loading = null; // a failed load may be retried
    });
  }
  return loading;
}

/** Shorter side -> 256, centre crop 224, RGB in [0, 1], CHW: as in training, in the demo and on the server. */
export function preprocess(src: CanvasImageSource & { width: number; height: number }, cfg: TriageConfig): Float32Array {
  const S = cfg.input_size;
  const k = cfg.resize / Math.min(src.width, src.height);
  const w = src.width * k;
  const h = src.height * k;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (S - w) / 2, (S - h) / 2, w, h);
  const d = g.getImageData(0, 0, S, S).data;
  const n = S * S;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    x[i] = d[4 * i] / 255;
    x[n + i] = d[4 * i + 1] / 255;
    x[2 * n + i] = d[4 * i + 2] / 255;
  }
  return x;
}

/** Decode a photo with the camera's rotation applied. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

async function logits(rt: Runtime, x: Float32Array, batch = 1): Promise<Float32Array> {
  const S = rt.cfg.input_size;
  const out = await rt.session.run({ [rt.input]: new rt.ort.Tensor('float32', x, [batch, 3, S, S]) }, ['logits']);
  return out.logits.data;
}

/** What the model's own run gives besides the answer (model_xai.onnx): every class's 49 CAM cells and bias, and the
 *  stage-3 attention of its two blocks ([heads, 49, 49] each). lib/agritriage/xai.ts turns them into views. */
export interface XaiRaw {
  cam: Float32Array;
  camBias: Float32Array;
  attn: Float32Array[];
  heads: number;
  n: number;
}

export interface Reading {
  result: GateResult;
  logits: Float32Array;
  /** model time for this photo on this phone, in ms (the XAI outputs come from the same run) */
  ms: number;
  x: Float32Array;
  xai: XaiRaw | null;
}

/** Read one prepared photo on this phone: the answer and, from the same run, what the CAM and attention views need. */
export async function readPhoto(rt: Runtime, x: Float32Array, crop: string | null): Promise<Reading> {
  const S = rt.cfg.input_size;
  const t0 = performance.now();
  if (!rt.xai) {
    const z = await logits(rt, x);
    return { result: gate(z, rt.cfg, crop), logits: z, ms: performance.now() - t0, x, xai: null };
  }
  const out = await rt.session.run({ [rt.input]: new rt.ort.Tensor('float32', x, [1, 3, S, S]) }, XAI_FETCH);
  const ms = performance.now() - t0;
  const z = out.logits.data;
  const a = out.xai_attn3_0;
  const xai: XaiRaw = { cam: out.xai_cam.data, camBias: out.xai_cam_bias.data, attn: [a.data, out.xai_attn3_1.data], heads: a.dims[1] ?? 14, n: a.dims[3] ?? 49 };
  return { result: gate(z, rt.cfg, crop), logits: z, ms, x, xai };
}

/** The 49 CAM cells of one class, their bias and the logit they add up to. */
export function camOf(r: Reading, target: number): { cells: Float32Array; bias: number; logit: number } | null {
  if (!r.xai) return null;
  const N = 49;
  return { cells: r.xai.cam.subarray(target * N, (target + 1) * N), bias: r.xai.camBias[target]!, logit: r.logits[target]! };
}

export interface HeatMap {
  grid: number;
  heat: number[];
  target: number;
  ms: number;
}

/**
 * Occlusion map for one class on a `grid` x `grid` grid, in batches of `batch` masked copies; `onProgress(done, total)`
 * after each batch. A 4 x 4 pass (16 runs) gives a quick first map; the 7 x 7 pass (49 runs) sharpens it.
 */
export async function occlusionMap(
  rt: Runtime,
  r: Reading,
  crop: string | null,
  target: number,
  onProgress: (done: number, total: number) => void,
  signal?: { cancelled: boolean },
  batch = 7,
  grid = GRID,
): Promise<HeatMap | null> {
  const S = rt.cfg.input_size;
  const C = rt.cfg.classes.length;
  const ps = patches(S, grid);
  const t0 = performance.now();
  const probs: number[] = [];
  onProgress(0, ps.length);
  for (let i = 0; i < ps.length; i += batch) {
    if (signal?.cancelled) return null;
    const chunk = ps.slice(i, i + batch);
    const z = await logits(rt, maskedBatch(r.x, S, chunk), chunk.length);
    for (let k = 0; k < chunk.length; k++) probs.push(gate(z.subarray(k * C, (k + 1) * C), rt.cfg, crop).p[target]);
    onProgress(Math.min(ps.length, i + chunk.length), ps.length);
    await new Promise((res) => setTimeout(res, 0)); // let the progress bar paint between batches
  }
  return { grid, heat: heatFromDrops(r.result.p[target], probs), target, ms: performance.now() - t0 };
}
