import { useSyncExternalStore } from 'react';
import { pickVoice, speak, stopSpeaking, ttsSupported, voicesReady } from '../../lib/speech';
import type { Lang } from '../../lib/i18n';

/** Speech-to-text tags per UI language (the brief: bn-BD for Bangla, en-US for English). */
export const STT_TAG: Record<Lang, string> = { en: 'en-US', bn: 'bn-BD', hi: 'hi-IN', sw: 'sw-KE' };
/** Text-to-speech tags per text language. */
const TTS_TAG: Record<string, string> = { en: 'en-GB', bn: 'bn-BD', hi: 'hi-IN', sw: 'sw-KE' };

export type ReadResult = 'speaking' | 'no-voice' | 'unsupported';

/**
 * Read a text aloud in ITS OWN language (a Bangla advice with a bn voice, an English one with an en voice). If this device
 * has no voice for that language we say so instead of reading it in the wrong voice.
 */
export async function readAloud(text: string, textLang: string, onEnd: () => void): Promise<ReadResult> {
  if (!ttsSupported()) return 'unsupported';
  await voicesReady();
  const tag = TTS_TAG[textLang] ?? textLang;
  if (!pickVoice(tag)) return 'no-voice';
  speak(text, tag, onEnd);
  return 'speaking';
}

export const stopReading = () => stopSpeaking();

/** A CSS media query as React state (no resize handler). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
