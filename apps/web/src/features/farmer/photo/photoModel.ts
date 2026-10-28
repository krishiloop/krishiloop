/**
 * On-device leaf photo model (MobileNetV4-small, "union" v0, ONNX, WASM execution provider).
 * Everything here is lazy: onnxruntime-web, its ~15 MB wasm and the 5.3 MB model are fetched only when the farmer
 * asks for the photo check, and the photo itself NEVER leaves the phone (no upload code exists on this path; what the
 * app may send onward is a Diagnosis: labels, probabilities, model name + hash, time. Never pixels).
 *
 * Contract (ml/vision/MODEL_CARD.md):
 *   input  "image" float32 [1,3,224,224]: resize short side to 256, centre-crop 224, RGB 0..1,
 *          normalise mean (0.485,0.456,0.406) std (0.229,0.224,0.225), NCHW
 *   output "probs" float32 [1,21], already softmaxed; classes in label_map_union.json order
 *
 * What a reading is worth is the model card's job (photoModelCard.ts), printed on the diagnosis receipt. Whether it
 * acts is a threshold on the (averaged) probability: diagnosis.ts.
 */
import { readStore, writeStore } from '../../../lib/storage';
import { PHOTO_MODEL_CARD } from './photoModelCard';
import type { PhotoOverlay } from './overlay';
import { PHOTO_LABELS, topOf, type LabelProb } from './labels';

export { PHOTO_LABELS, topOf, type LabelProb, type PhotoLabel } from './labels';

export const PHOTO_MODEL_URL = '/models/mnv4_union_fp16w.onnx';
/** ml/vision/artifacts/onnx_pack_report.json: fp16-weight file, 5.28 MB */
export const PHOTO_MODEL_BYTES = PHOTO_MODEL_CARD.sizeBytes;
/** onnxruntime-web 1.31.1 ort-wasm-simd-threaded.wasm, uncompressed. A compressed transfer is roughly a third of this. */
export const WASM_BYTES = 14_848_852;
export const DOWNLOAD_MB = Math.round((PHOTO_MODEL_BYTES + WASM_BYTES) / 1_000_000);

const FLAG = 'kl.photoModel';
const SIZE = 224;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded {
  ort: Ort;
  session: import('onnxruntime-web/wasm').InferenceSession;
}

let loading: Promise<Loaded> | null = null;
let loaded: Loaded | null = null;

export interface LoadProgress {
  phase: 'runtime' | 'model' | 'starting';
  loaded: number;
  total: number;
}

/** What this phone found when it hashed the model file it downloaded. */
export interface ModelSha {
  hex: string;
  /** true when the hash was computed here, from the downloaded bytes (needs a secure page: https or localhost) */
  checked: boolean;
  /** the hash equals the one in the model card */
  matches: boolean;
}
let sha: ModelSha | null = null;
/** null until the model has been loaded once in this page. */
export const getModelSha = (): ModelSha | null => sha;

/** True when this browser has already downloaded the model once (so no new consent step is needed). */
export const wasDownloadedBefore = () => readStore(FLAG) === '1';
export const isModelLoaded = () => loaded !== null;

async function download(url: string, expected: number, onBytes: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const len = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(Math.min(got, Math.max(expected, len)));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Fetch the runtime and the model (with progress), hash the model, start a WASM session, run one warm-up pass. Single flight. */
export function loadModel(onProgress?: (p: LoadProgress) => void): Promise<void> {
  loading ??= (async () => {
    const [ort, wasmUrl] = await Promise.all([import('onnxruntime-web/wasm'), import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url').then((m) => m.default)]);
    const wasm = await download(wasmUrl, WASM_BYTES, (n) => onProgress?.({ phase: 'runtime', loaded: n, total: WASM_BYTES }));
    ort.env.wasm.wasmBinary = wasm;
    // one thread, no worker: works without cross-origin isolation, and the model is tiny (milliseconds per photo)
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    const model = await download(PHOTO_MODEL_URL, PHOTO_MODEL_BYTES, (n) => onProgress?.({ phase: 'model', loaded: n, total: PHOTO_MODEL_BYTES }));
    onProgress?.({ phase: 'starting', loaded: 1, total: 1 });
    await nextFrame();
    const hex = await sha256Hex(model);
    sha = hex ? { hex, checked: true, matches: hex === PHOTO_MODEL_CARD.sha256 } : { hex: PHOTO_MODEL_CARD.sha256, checked: false, matches: true };
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    // warm-up, so the first real photo is not charged for one-time setup
    await session.run({ image: new ort.Tensor('float32', new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]) });
    loaded = { ort, session };
    writeStore(FLAG, '1');
    return loaded;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading.then(() => undefined);
}

/** Short side to 256, centre crop 224, RGB 0..1, ImageNet normalisation, NCHW float32. */
export async function preprocess(file: Blob): Promise<Float32Array> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = 256 / Math.min(bmp.width, bmp.height);
    const crop = SIZE / scale; // side of the centre crop, in source pixels
    const sx = (bmp.width - crop) / 2;
    const sy = (bmp.height - crop) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d canvas');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, crop, crop, 0, 0, SIZE, SIZE);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE;
    const out = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      out[i] = (px[i * 4]! / 255 - MEAN[0]) / STD[0];
      out[plane + i] = (px[i * 4 + 1]! / 255 - MEAN[1]) / STD[1];
      out[2 * plane + i] = (px[i * 4 + 2]! / 255 - MEAN[2]) / STD[2];
    }
    return out;
  } finally {
    bmp.close();
  }
}

export interface PhotoResult {
  /** all 21 probabilities, in PHOTO_LABELS order (kept so several photos can be averaged) */
  probs: number[];
  top: LabelProb[];
  /** model run on this device, milliseconds (excludes reading and resizing the photo) */
  ms: number;
  /** reading, resizing and normalising the photo, milliseconds */
  prepMs: number;
  /** leaf mask / lesions / heat. The v0 model has no such head, so this is undefined; the v1 student fills it. */
  overlay?: PhotoOverlay;
}

export async function classify(file: Blob): Promise<PhotoResult> {
  if (!loaded) await loadModel();
  const { ort, session } = loaded!;
  const t0 = performance.now();
  const data = await preprocess(file);
  const t1 = performance.now();
  const out = await session.run({ image: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
  const t2 = performance.now();
  const raw = out.probs?.data as Float32Array | undefined;
  if (!raw || raw.length !== PHOTO_LABELS.length) throw new Error('unexpected model output');
  const probs = Array.from(raw);
  return { probs, top: topOf(probs), ms: t2 - t1, prepMs: t1 - t0 };
}
