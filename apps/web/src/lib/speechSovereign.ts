/**
 * Sovereign speech input (off by default): the microphone records with MediaRecorder and the audio goes to OUR server,
 * POST /api/voice/asr, which passes it to our own Omnilingual CTC-1B service on the same machine (services/voice_proxy).
 * The browser's speech service is not involved. The server offers this only when it runs the voice service
 * (KRISHILOOP_VOICE_URL); GET /api/voice/health says so. Loaded lazily by the Ask tab, with no imports of its own (a
 * lazy chunk that imported the app's shared modules would split them out of the entry chunk).
 */

export interface VoiceHealth {
  available: boolean;
  reason: string | null;
  model: string | null;
}

export const recorderSupported = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

/** HTTP error from our voice endpoints: 503 off or unreachable, 400 too short or unreadable, 413 too long. */
export class VoiceHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } });
    const body = (await res.json().catch(() => null)) as (T & { detail?: unknown }) | null;
    if (!res.ok || !body) throw new VoiceHttpError(res.status, typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

let health: Promise<boolean> | null = null;

/** Is our own speech-to-text there? Never in sample mode (`forced`), never without MediaRecorder. Asked once per page. */
export function ownAsrAvailable(forced: boolean): Promise<boolean> {
  if (forced || !recorderSupported()) return Promise.resolve(false);
  health ??= call<VoiceHealth>('/api/voice/health', {}, 4000)
    .then((h) => h.available === true)
    .catch(() => false);
  return health;
}

export type RecordError = 'not-allowed' | 'audio-capture' | 'other';

export interface Recording {
  /** stop and get the audio */
  stop: () => Promise<Blob>;
  /** stop and throw the audio away */
  abort: () => void;
}

const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

/** Start recording (asks for the microphone). Stops by itself after `maxMs` and calls `onLimit`. Throws a RecordError. */
export async function startRecording(opts: { maxMs?: number; onLimit?: () => void } = {}): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    throw new Error(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : name === 'NotFoundError' || name === 'NotReadableError' ? 'audio-capture' : 'other');
  }
  const mimeType = TYPES.find((t) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
  const chunks: Blob[] = [];
  rec.addEventListener('dataavailable', (e) => {
    if (e.data.size) chunks.push(e.data);
  });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const finished = new Promise<Blob>((resolve) => {
    rec.addEventListener('stop', () => {
      release();
      resolve(new Blob(chunks, { type: (rec.mimeType || mimeType || 'audio/webm').split(';')[0] }));
    });
  });
  rec.start();
  const limit = setTimeout(() => opts.onLimit?.(), opts.maxMs ?? 15_000);
  const stop = () => {
    clearTimeout(limit);
    if (rec.state !== 'inactive') rec.stop();
  };
  return {
    stop: () => {
      stop();
      return finished;
    },
    abort: () => {
      stop();
      chunks.length = 0;
    },
  };
}

export type MicError = 'not-allowed' | 'audio-capture' | 'no-speech' | 'server' | 'other';

export interface OwnMic {
  start: () => Promise<void>;
  /** stop, send, and hand the text to onText */
  stop: () => void;
  abort: () => void;
}

/** The sovereign microphone for one question: record, then our server's text (or why there is none). */
export function ownMic(cb: { onListening: (on: boolean) => void; onBusy: (on: boolean) => void; onText: (text: string) => void; onError: (e: MicError) => void }): OwnMic {
  let rec: Recording | null = null;
  const finish = async () => {
    const r = rec;
    if (!r) return;
    rec = null;
    cb.onListening(false);
    cb.onBusy(true);
    try {
      const text = (await transcribe(await r.stop())).text.trim();
      if (text) cb.onText(text);
      else cb.onError('no-speech');
    } catch (e) {
      cb.onError(e instanceof VoiceHttpError && e.status === 400 ? 'no-speech' : 'server');
    } finally {
      cb.onBusy(false);
    }
  };
  return {
    start: async () => {
      try {
        rec = await startRecording({ maxMs: 15_000, onLimit: () => void finish() });
        cb.onListening(true);
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        cb.onError(code === 'not-allowed' || code === 'audio-capture' ? code : 'other');
      }
    },
    stop: () => void finish(),
    abort: () => {
      rec?.abort();
      rec = null;
    },
  };
}

export interface Transcript {
  text: string;
  model: string;
}

/** POST the recording to our server; the text comes back (or a VoiceHttpError: 503 off, 400 too short, 413 too long). */
export function transcribe(audio: Blob): Promise<Transcript> {
  return call<Transcript>('/api/voice/asr', { method: 'POST', body: audio, headers: { 'Content-Type': audio.type || 'audio/webm' } }, 30_000);
}
