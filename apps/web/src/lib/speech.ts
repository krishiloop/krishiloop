/**
 * Voice in and out with the Web Speech API (bn-BD), with graceful fallbacks everywhere.
 *  - Speech to text: Chrome/Edge/Safari (webkit prefix). Firefox has none: the UI then offers typing.
 *    NOTE: in Chrome the browser sends the audio to its own speech service. The voice sheet says so.
 *  - Text to speech: uses an installed Bangla voice if there is one; otherwise we say so (a natural bn-BD
 *    neural voice is planned, see PRODUCT_CONCEPT W3).
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const sttSupported = () => ctor() !== null;

export type SttError = 'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'aborted' | 'other';

export interface Listener {
  stop: () => void;
  abort: () => void;
}

export function listen(
  lang: string,
  cb: { onStart?: () => void; onText: (text: string, final: boolean) => void; onEnd: () => void; onError: (e: SttError) => void },
): Listener | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  r.onstart = () => cb.onStart?.();
  r.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      text += res[0].transcript;
      final = final || res.isFinal;
    }
    cb.onText(text.trim(), final);
  };
  r.onerror = (e) => {
    const code = e.error;
    cb.onError(code === 'not-allowed' || code === 'service-not-allowed' ? 'not-allowed' : code === 'no-speech' ? 'no-speech' : code === 'audio-capture' ? 'audio-capture' : code === 'network' ? 'network' : code === 'aborted' ? 'aborted' : 'other');
  };
  r.onend = () => cb.onEnd();
  try {
    r.start();
  } catch {
    cb.onError('other');
    return null;
  }
  return { stop: () => r.stop(), abort: () => r.abort() };
}

/* ------------------------------------------------------------------ text to speech */
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** The best installed voice for a language tag ("bn-BD" -> any bn voice), or null. Voices load asynchronously. */
export function pickVoice(tag: string): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = tag.split('-')[0]!.toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === tag.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null;
}

export function hasVoiceFor(tag: string): boolean {
  return pickVoice(tag) !== null;
}

/** Resolves when voices are available (some browsers fire voiceschanged late), or after a short timeout. */
export function voicesReady(): Promise<void> {
  if (!ttsSupported()) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done);
      resolve();
    };
    window.speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, 800);
  });
}

export function speak(text: string, tag: string, onEnd?: () => void): boolean {
  if (!ttsSupported()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  const v = pickVoice(tag);
  if (v) u.voice = v;
  u.rate = 0.95;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/** BCP-47 tags for speech per UI language. */
export const SPEECH_TAG = { en: 'en-GB', bn: 'bn-BD', hi: 'hi-IN', sw: 'sw-KE' } as const;
