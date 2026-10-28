import { useEffect, useRef, useState } from 'react';
import { Keyboard, Mic, Send, Square } from 'lucide-react';
import { Sheet } from '../../components/ui/Sheet';
import { toast } from '../../components/ui/Toaster';
import { PreviewBadge } from '../../components/ui/Badges';
import { useI18n, type Key } from '../../lib/i18n';
import { listen, sttSupported, type Listener, type SttError } from '../../lib/speech';
import { cx } from '../../lib/cx';

type Phase = 'idle' | 'listening' | 'result' | 'error';
const ERR_KEY: Record<SttError, Key> = {
  'not-allowed': 'voice.blocked',
  'no-speech': 'voice.noSpeech',
  'audio-capture': 'voice.noMic',
  network: 'voice.network',
  aborted: 'voice.error',
  other: 'voice.error',
};

/** Floating "Ask by voice" button: a big thumb-reach target on a phone, a labelled pill on desktop. */
export function VoiceFab({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="voice-fab btn btn-sun" onClick={onClick} aria-label={t('voice.fab')} data-testid="voice-fab">
      <Mic size={22} aria-hidden />
      <span className="voice-fab-label">{t('voice.fab')}</span>
    </button>
  );
}

/**
 * Voice input with the Web Speech API (bn-BD by default, English too so anyone can try it), with graceful fallback:
 * unsupported browser, blocked mic, nothing heard -> a clear message and a typing box. Answering with receipts via the
 * Ask router is PLANNED; for now a question can be sent to the officer (sample).
 */
export function VoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [tag, setTag] = useState<'bn-BD' | 'en-GB'>('bn-BD');
  const [text, setText] = useState('');
  const [err, setErr] = useState<SttError | null>(null);
  const [typing, setTyping] = useState(false);
  const live = useRef<Listener | null>(null);
  const supported = sttSupported();

  useEffect(() => {
    if (!open) {
      live.current?.abort();
      live.current = null;
      setPhase('idle');
      setText('');
      setErr(null);
      setTyping(false);
    }
  }, [open]);

  const start = () => {
    setErr(null);
    setText('');
    setPhase('listening');
    live.current = listen(tag, {
      onText: (txt) => setText(txt),
      onEnd: () => {
        live.current = null;
        setPhase((p) => (p === 'listening' ? 'result' : p));
      },
      onError: (e) => {
        setErr(e);
        setPhase('error');
      },
    });
    if (!live.current) {
      setErr('other');
      setPhase('error');
    }
  };
  const stop = () => live.current?.stop();

  const send = () => {
    toast(t('voice.sent'));
    onClose();
  };

  const showTyping = typing || !supported || phase === 'error';

  return (
    <Sheet open={open} onClose={onClose} title={t('voice.title')}>
      <div className="voice">
        <div className="seg mx-auto" role="group" aria-label={t('lang.label')}>
          <button type="button" aria-pressed={tag === 'bn-BD'} onClick={() => setTag('bn-BD')} disabled={phase === 'listening'} lang="bn">
            বাংলা
          </button>
          <button type="button" aria-pressed={tag === 'en-GB'} onClick={() => setTag('en-GB')} disabled={phase === 'listening'}>
            English
          </button>
        </div>

        {supported ? (
          <button
            type="button"
            className={cx('voice-mic', phase === 'listening' && 'is-on')}
            onClick={phase === 'listening' ? stop : start}
            aria-pressed={phase === 'listening'}
            aria-label={phase === 'listening' ? t('voice.listening') : t('voice.tap')}
            data-testid="voice-mic"
          >
            {phase === 'listening' ? <Square size={26} aria-hidden /> : <Mic size={30} aria-hidden />}
          </button>
        ) : (
          <p className="voice-note" role="status">
            {t('voice.unsupported')}
          </p>
        )}

        <span className="voice-bars" data-on={phase === 'listening'} aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </span>

        <p className="voice-status" aria-live="polite" data-testid="voice-status">
          {phase === 'listening' ? t('voice.listening') : phase === 'idle' && supported ? t('voice.tap') : ''}
          {phase === 'error' && err ? t(ERR_KEY[err]) : ''}
        </p>

        {text ? (
          <figure className="voice-heard" aria-live="polite">
            <figcaption className="eyebrow">{t('voice.heard')}</figcaption>
            <blockquote lang={tag === 'bn-BD' ? 'bn' : 'en'}>“{text}”</blockquote>
          </figure>
        ) : null}

        {showTyping ? (
          <div>
            <label className="field-label" htmlFor="voice-typed">
              {t('voice.placeholder')}
            </label>
            <textarea id="voice-typed" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('voice.placeholder')} />
          </div>
        ) : supported ? (
          <button type="button" className="btn btn-quiet btn-sm mx-auto" onClick={() => setTyping(true)}>
            <Keyboard size={15} aria-hidden /> {t('voice.type')}
          </button>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {phase === 'result' || (showTyping && text.trim()) ? (
            <>
              {supported && phase === 'result' ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={start}>
                  <Mic size={15} aria-hidden /> {t('voice.speakAgain')}
                </button>
              ) : null}
              <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim()}>
                <Send size={15} aria-hidden /> {t('voice.send')}
              </button>
            </>
          ) : null}
        </div>

        <div className="voice-foot">
          <p className="m-0 flex flex-wrap items-center gap-2">
            <PreviewBadge label={t('common.planned')} /> {t('voice.routerNote')}
          </p>
          <p className="m-0">{t('voice.privacy')}</p>
        </div>
      </div>
    </Sheet>
  );
}
