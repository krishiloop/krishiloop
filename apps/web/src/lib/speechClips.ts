/**
 * Our own Bangla voice: readbacks synthesised ahead of time on our GPU (svara-tts-v1, male voice, Llama 3.2 Community
 * License, "Built with Llama"), one clip per rule version, listed in /audio/manifest.json (ml/voice/readbacks.py build).
 *
 * The one promise: a clip plays ONLY for the exact text it speaks. A clip is found by rule id + rule version + the
 * sha256 of the normalised text; any other text (a changed rule, another version, another language) gets no clip and
 * falls back to the browser's voice. A receipt that is Recalled (or cannot be verified) never plays its advice: the
 * plan is a notice instead (planRead). This module is loaded lazily, on the first "Hear".
 */

export const CLIP_SCHEMA = 'krishiloop.readback-clips/1';

export interface ClipEntry {
  kind: 'rule' | 'notice';
  rule_id?: string;
  version?: number;
  notice_id?: string;
  lang: string;
  /** the exact text the clip speaks, normalised */
  text: string;
  text_sha256: string;
  /** under /audio/, e.g. bn/svara-m-cd8e51c6c42c4a3a.ogg */
  file: string;
  bytes: number;
  audio_s: number;
  roundtrip_cer_pct?: number | null;
}

export interface ClipManifest {
  schema: string;
  voice: { model: string; speaker: string; licence: string; attribution: string; review: string };
  clips: ClipEntry[];
}

/* ------------------------------------------------------------------ the text key (same as ml/voice/readbacks.py norm_spoken) */
const chars = (codes: number[]) => String.fromCharCode(...codes);
// ZWSP, word joiner, BOM, soft hyphen (built from code points: a literal U+2028 would end a regex literal)
const DROP = new RegExp(`[${chars([0x200b, 0x2060, 0xfeff, 0xad])}]`, 'g');
// ASCII whitespace, NEL, NBSP, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
const WS = new RegExp(`[${chars([9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680])}${chars([0x2000])}-${chars([0x200a])}${chars([0x2028, 0x2029, 0x202f, 0x205f, 0x3000])}]+`, 'g');

/** NFC; drop invisible no-ops (ZWSP, word joiner, BOM, soft hyphen); whitespace runs to one space; trim; NFC. */
export function normaliseSpoken(s: string): string {
  return s.normalize('NFC').replace(DROP, '').replace(WS, ' ').replace(/^ +| +$/g, '').normalize('NFC');
}

/** sha256 hex of a string's UTF-8 bytes, or null where Web Crypto is missing (plain http on a LAN address). */
export async function sha256Hex(s: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const FILE_RE = /^[a-z]{2,3}\/[a-z0-9-]+\.ogg$/;

/** Accept only a well-formed manifest; anything else means "no clips" (never a crash, never a guessed file). */
export function parseManifest(raw: unknown): ClipManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<ClipManifest>;
  if (m.schema !== CLIP_SCHEMA || !Array.isArray(m.clips) || !m.voice) return null;
  const clips = m.clips.filter(
    (c): c is ClipEntry =>
      !!c &&
      (c.kind === 'rule' || c.kind === 'notice') &&
      typeof c.lang === 'string' &&
      typeof c.text === 'string' &&
      /^[0-9a-f]{64}$/.test(c.text_sha256 ?? '') &&
      FILE_RE.test(c.file ?? '') &&
      (c.kind === 'notice' ? typeof c.notice_id === 'string' : typeof c.rule_id === 'string' && Number.isInteger(c.version)),
  );
  return { schema: m.schema, voice: m.voice, clips };
}

/** The clip that speaks exactly this rule version's text, or null. */
export async function findRuleClip(m: ClipManifest, k: { ruleId: string; version: number; lang: string; text: string }): Promise<ClipEntry | null> {
  const norm = normaliseSpoken(k.text);
  const sha = await sha256Hex(norm);
  if (!sha) return null;
  return m.clips.find((c) => c.kind === 'rule' && c.rule_id === k.ruleId && c.version === k.version && c.lang === k.lang && c.text_sha256 === sha && normaliseSpoken(c.text) === norm) ?? null;
}

/** The clip of a fixed notice (e.g. "recalled") in exactly this wording, or null. */
export async function findNoticeClip(m: ClipManifest, k: { id: string; lang: string; text: string }): Promise<ClipEntry | null> {
  const norm = normaliseSpoken(k.text);
  const sha = await sha256Hex(norm);
  if (!sha) return null;
  return m.clips.find((c) => c.kind === 'notice' && c.notice_id === k.id && c.lang === k.lang && c.text_sha256 === sha && normaliseSpoken(c.text) === norm) ?? null;
}

/* ------------------------------------------------------------------ what to read */
export type ReceiptStatus = 'authentic' | 'recalled' | 'invalid' | 'unknown';

export interface ReadRequest {
  /** the rule's own sentence, exactly as the receipt carries it */
  text: string;
  textLang: string;
  /** the decision word; the browser voice reads it first ("Don't spray. …"); our clips speak the sentence only */
  lead?: string;
  ruleId?: string;
  version?: number;
  /** what the verifier says about this receipt now ('unknown': not checked or not reachable) */
  status: ReceiptStatus;
  /** read or shown INSTEAD of the advice when the receipt is recalled or cannot be verified (UI language) */
  notice: string;
  noticeLang: string;
}

export type ReadPlan =
  | { kind: 'notice'; text: string; lang: string; clip: ClipEntry | null }
  | { kind: 'clip'; clip: ClipEntry; fallback: { text: string; lang: string } }
  | { kind: 'browser'; text: string; lang: string };

/**
 * Decide what "Hear" does. Recalled or not verifiable: the notice, never the advice (and no advice clip, whatever the
 * manifest holds). Otherwise our clip when one speaks exactly this text, else the browser voice.
 */
export async function planRead(req: ReadRequest, manifest: ClipManifest | null): Promise<ReadPlan> {
  if (req.status === 'recalled' || req.status === 'invalid') {
    const clip = manifest && req.status === 'recalled' ? await findNoticeClip(manifest, { id: 'recalled', lang: req.noticeLang, text: req.notice }) : null;
    return { kind: 'notice', text: req.notice, lang: req.noticeLang, clip };
  }
  const spoken = req.lead ? `${req.lead}. ${req.text}` : req.text;
  if (manifest && req.ruleId && req.version != null) {
    const clip = await findRuleClip(manifest, { ruleId: req.ruleId, version: req.version, lang: req.textLang, text: req.text });
    if (clip) return { kind: 'clip', clip, fallback: { text: spoken, lang: req.textLang } };
  }
  return { kind: 'browser', text: spoken, lang: req.textLang };
}

/**
 * What one tap on "Hear" did.
 *  - state: 'playing' (audio started; onEnd follows), 'shown' (a notice we could not speak: the UI shows it),
 *    'no-voice' (no voice for this language on this device: we never read it in a wrong one), 'unsupported'.
 *  - via: 'ours' = our own pre-made clip (svara-tts-v1, Built with Llama), 'browser' = the device's voice.
 *  - notice: set when the receipt is recalled or cannot be verified: this was read INSTEAD of the advice.
 */
export interface ReadOutcome {
  state: 'playing' | 'shown' | 'no-voice' | 'unsupported';
  via: 'ours' | 'browser' | null;
  notice: string | null;
  lang: string;
}

/** The device's own voice for a language (passed in, so this lazy chunk imports nothing from the app). */
export type Speaker = (text: string, lang: string, onEnd: () => void) => Promise<'playing' | 'no-voice' | 'unsupported'>;

/** Carry out planRead: our clip, else the device voice, else say so. A notice replaces recalled advice. */
export async function readWith(req: ReadRequest, onEnd: () => void, speak: Speaker): Promise<ReadOutcome> {
  const manifest = req.textLang === 'bn' || req.noticeLang === 'bn' ? await loadClipManifest() : null;
  const plan = await planRead(req, manifest);
  if (plan.kind === 'notice') {
    if (plan.clip && (await playClip(plan.clip, onEnd))) return { state: 'playing', via: 'ours', notice: plan.text, lang: plan.lang };
    const s = await speak(plan.text, plan.lang, onEnd);
    return { state: s === 'playing' ? 'playing' : 'shown', via: s === 'playing' ? 'browser' : null, notice: plan.text, lang: plan.lang };
  }
  if (plan.kind === 'clip' && (await playClip(plan.clip, onEnd))) return { state: 'playing', via: 'ours', notice: null, lang: plan.clip.lang };
  const { text, lang } = plan.kind === 'clip' ? plan.fallback : plan;
  const s = await speak(text, lang, onEnd);
  return { state: s, via: s === 'playing' ? 'browser' : null, notice: null, lang };
}

/* ------------------------------------------------------------------ loading and playing */
let manifestCall: Promise<ClipManifest | null> | null = null;

/** /audio/manifest.json once per page; a failure (offline) is not remembered, so the next "Hear" tries again. */
export function loadClipManifest(url = '/audio/manifest.json'): Promise<ClipManifest | null> {
  manifestCall ??= fetch(url, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseManifest)
    .catch(() => null)
    .then((m) => {
      if (!m) manifestCall = null;
      return m;
    });
  return manifestCall;
}

let current: { el: HTMLAudioElement; onEnd: () => void } | null = null;

/** Can this browser play Ogg Opus at all? (Older iPhone Safari cannot: it then gets the browser voice.) */
export function canPlayClips(): boolean {
  if (typeof Audio === 'undefined') return false;
  try {
    return new Audio().canPlayType('audio/ogg; codecs="opus"') !== '';
  } catch {
    return false;
  }
}

/** Play one clip; false when the browser refuses (unsupported codec, autoplay rules), so the caller can fall back. */
export async function playClip(clip: ClipEntry, onEnd: () => void): Promise<boolean> {
  stopClip();
  if (!canPlayClips()) return false;
  const el = new Audio(`/audio/${clip.file}`);
  const mine = { el, onEnd };
  current = mine;
  const end = () => {
    if (current !== mine) return;
    current = null;
    onEnd();
  };
  el.addEventListener('ended', end);
  el.addEventListener('error', end);
  try {
    await el.play();
    return true;
  } catch {
    if (current === mine) current = null;
    return false;
  }
}

/** Stop the clip that is playing; its owner hears about it (like speechSynthesis.cancel() ends an utterance). */
export function stopClip() {
  const c = current;
  if (!c) return;
  current = null;
  c.el.pause();
  c.onEnd();
}
