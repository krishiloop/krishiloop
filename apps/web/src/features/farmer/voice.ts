import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { pickVoice, speak, stopSpeaking, ttsSupported, voicesReady } from '../../lib/speech';
import type { ReadOutcome, ReadRequest, ReceiptStatus } from '../../lib/speechClips';
import { isFallback, type Key, type Lang } from '../../lib/i18n';
import { verifyReceipt } from '../../lib/api/client';
import { held, setStatus, statusOf } from './receipts';

/** Speech-to-text tags per UI language (the brief: bn-BD for Bangla, en-US for English). */
export const STT_TAG: Record<Lang, string> = { en: 'en-US', bn: 'bn-BD', hi: 'hi-IN', sw: 'sw-KE' };
/** Text-to-speech tags per text language. */
const TTS_TAG: Record<string, string> = { en: 'en-GB', bn: 'bn-BD', hi: 'hi-IN', sw: 'sw-KE' };

export type { ReadOutcome, ReadRequest, ReceiptStatus };

type Clips = typeof import('../../lib/speechClips');
let clips: Clips | null = null;

async function speakBrowser(text: string, lang: string, onEnd: () => void): Promise<'playing' | 'no-voice' | 'unsupported'> {
  if (!ttsSupported()) return 'unsupported';
  await voicesReady();
  const tag = TTS_TAG[lang] ?? lang;
  if (!pickVoice(tag)) return 'no-voice';
  speak(text, tag, onEnd);
  return 'playing';
}

/**
 * Read a receipt's advice aloud in ITS OWN language. Order: our clip for exactly this text (Bangla rule readbacks), else
 * the device's voice for that language, else "no voice". A recalled or unverifiable receipt reads (or shows) the notice
 * instead of its advice. The clip code and manifest load on the first tap, not with the app.
 */
export async function readAloud(req: ReadRequest, onEnd: () => void): Promise<ReadOutcome> {
  stopReading();
  clips ??= await import('../../lib/speechClips');
  return clips.readWith(req, onEnd, speakBrowser);
}

export function stopReading() {
  stopSpeaking();
  clips?.stopClip();
}

const timeout = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

/**
 * What the verifier says about a receipt right now, for "Hear". A recall this tab already knows about wins at once;
 * otherwise the receipt is checked again (2.5 s at most). 'unknown' (offline, not reachable) still reads the advice,
 * like the screen still shows it; a recall is never read as advice.
 */
export async function receiptStatus(credentialId: string | undefined, known?: ReceiptStatus): Promise<ReceiptStatus> {
  if (known === 'recalled' || known === 'invalid') return known;
  if (!credentialId) return known ?? 'unknown';
  const mine = held.get().status[credentialId]?.s;
  if (mine === 'recalled' || mine === 'invalid') return mine;
  const r = await Promise.race([verifyReceipt(credentialId).catch(() => null), timeout(2500, null)]);
  if (!r || r.status === 'unreachable') return known ?? 'unknown';
  setStatus(credentialId, statusOf(r));
  return r.status;
}

/** The read request for a receipt's advice, with the notice that replaces it if the receipt is recalled. */
export function adviceRequest(o: {
  title: { text: string; lang: string };
  lead: string;
  rule?: { rule_id: string; version: number };
  status: ReceiptStatus;
  t: (k: Key) => string;
  uiLang: Lang;
}): ReadRequest {
  const key: Key = o.status === 'invalid' ? 'fa.voice.invalidSay' : 'fa.voice.recalledSay';
  return {
    text: o.title.text,
    textLang: o.title.lang,
    lead: o.lead,
    ruleId: o.rule?.rule_id,
    version: o.rule?.version,
    status: o.status,
    notice: o.t(key),
    noticeLang: isFallback(o.uiLang, key) ? 'en' : o.uiLang,
  };
}

/** One "Hear" button's state: tap to read (the request is built at tap time), tap again to stop. */
export function useReader() {
  const [out, setOut] = useState<ReadOutcome | null>(null);
  const [playing, setPlaying] = useState(false);
  const token = useRef(0);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      token.current++;
      stopReading();
    };
  }, []);
  const toggle = useCallback(
    async (make: () => ReadRequest | Promise<ReadRequest>): Promise<ReadOutcome | null> => {
      if (playing) {
        token.current++;
        stopReading();
        setPlaying(false);
        return null;
      }
      if (pending.current) return null;
      pending.current = true;
      const my = ++token.current;
      try {
        const o = await readAloud(await make(), () => {
          if (token.current === my) setPlaying(false);
        });
        if (!alive.current) {
          stopReading(); // the screen closed while the clip was loading
          return null;
        }
        setOut(o);
        setPlaying(o.state === 'playing');
        return o;
      } finally {
        pending.current = false;
      }
    },
    [playing],
  );
  return { out, playing, toggle };
}

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
