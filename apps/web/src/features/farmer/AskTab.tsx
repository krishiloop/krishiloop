import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Mic, MicOff, ReceiptText, Square, UserRound, Volume2, WifiOff } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { createStore } from '../../lib/store';
import { readStore, writeStore } from '../../lib/storage';
import { cx } from '../../lib/cx';
import { motionReduced } from '../../lib/motionPref';
import { listen, sttSupported, type Listener, type SttError } from '../../lib/speech';
import { askQuestion, recordedQuestions, type AskOutcome, type AskResponse } from '../../lib/api/ask';
import { apiStore, HttpError } from '../../lib/api/client';
import type { OwnMic } from '../../lib/speechSovereign';
import type { RecordedAsk } from '../../data/recorded';
import { RECORDED_AT } from '../../data/recorded';
import { DataMark } from '../../ui/DataMark';
import { DecisionPictogram, KindIcon } from '../../ui/Pictogram';
import { toneOfLight } from '../../ui/Chip';
import { TONE_TEXT, TONE_TILE } from '../../ui/Receipt';
import { useFarmer } from './farmerStore';
import { logAsk, logError, setWorking } from './inspector';
import { holdAsk } from './receipts';
import { tick } from './checklist';
import { adviceRequest, receiptStatus, STT_TAG, useReader } from './voice';
import { VoiceLine } from './VoiceLine';
import { reasonText } from './words';
import { Pipeline } from './Pipeline';
import { Handoff } from './Handoff';
import { NearestOffice } from '../offices/NearestOffice';
import { askNeedsOfficer } from '../offices/unsure';
import { ClickSpark } from '../../ui/kit/ClickSpark';
import type { ReceiptRef } from './ReceiptSheet';
import { FarmerCameo } from '../../ui/farmer/FarmerCameo';

type AskState =
  | { phase: 'idle' }
  | { phase: 'asking'; question: string }
  | { phase: 'done'; question: string; outcome: AskOutcome }
  | { phase: 'error'; question: string; message: string };

/** The last question and its answer stay while the visitor switches tabs. */
const askStore = createStore<AskState>({ phase: 'idle' });
const CONSENT_KEY = 'kl.farmer.voiceOk';
/** consent for the sovereign path is asked separately: the audio goes somewhere else (our own server) */
const OWN_CONSENT_KEY = 'kl.farmer.voiceOk.own';
type VoiceErr = SttError | 'server';
const sovereign = () => import('../../lib/speechSovereign');

async function ask(question: string, fieldId: string, profileId: string, lang: string, via: 'text' | 'voice') {
  const q = question.trim();
  if (!q) return;
  askStore.set({ phase: 'asking', question: q });
  setWorking('ask');
  try {
    const outcome = await askQuestion(q, fieldId, profileId, lang);
    askStore.set({ phase: 'done', question: q, outcome });
    logAsk(outcome, via);
    if (outcome.source !== 'offline') {
      tick('ask');
      if (via === 'voice') tick('voice');
      holdAsk(outcome.data, outcome.source === 'recorded');
    }
  } catch (e) {
    const message = e instanceof HttpError ? `HTTP ${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
    logError('POST /api/demo/‹sid›/ask', message);
    askStore.set({ phase: 'error', question: q, message });
  } finally {
    setWorking(null);
  }
}

/**
 * Ask: by voice (with a consent step first) or by text. The answer is always the validated text of ONE sourced rule with
 * its receipt, or an honest hand-off to the officer. With recorded data only recorded questions can be answered, and the
 * app says so instead of pretending.
 */
export function AskTab({ onOpenReceipt }: { onOpenReceipt: (r: ReceiptRef) => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const state = askStore.use();
  const [q, setQ] = useState('');
  const [examples, setExamples] = useState<RecordedAsk[]>([]);
  const [listening, setListening] = useState(false);
  const [consent, setConsent] = useState(() => readStore(CONSENT_KEY) === '1');
  const [showConsent, setShowConsent] = useState(false);
  const [consentOwn, setConsentOwn] = useState(() => readStore(OWN_CONSENT_KEY) === '1');
  const [voiceErr, setVoiceErr] = useState<VoiceErr | null>(null);
  // our own speech-to-text (Bangla only: that is what we measured), when the server runs it; else the browser's
  const [own, setOwn] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const listener = useRef<Listener | null>(null);
  const mic = useRef<OwnMic | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const lastPhase = useRef(state.phase);
  const sentByVoice = useRef(false);
  const inputId = useId();
  const supported = own || (typeof window !== 'undefined' && sttSupported());
  const agreed = own ? consentOwn : consent;
  const fieldId = st.fieldId;
  const profileId = st.profileId;

  useEffect(() => {
    let alive = true;
    void recordedQuestions(fieldId ?? undefined).then((list) => alive && setExamples(list));
    return () => {
      alive = false;
    };
  }, [fieldId]);

  useEffect(() => {
    if (lang !== 'bn') {
      setOwn(false);
      return;
    }
    let alive = true;
    void sovereign()
      .then((m) => m.ownAsrAvailable(apiStore.get().forced))
      .then((ok) => alive && setOwn(ok));
    return () => {
      alive = false;
    };
  }, [lang]);

  useEffect(
    () => () => {
      listener.current?.abort();
      mic.current?.abort();
    },
    [],
  );

  // when an answer arrives (not when the tab is reopened), bring it into view
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = state.phase;
    if (was === 'asking' && state.phase !== 'asking') resultRef.current?.scrollIntoView({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
  }, [state.phase]);

  const submit = (text: string, via: 'text' | 'voice') => {
    if (!fieldId || !profileId || !text.trim()) return;
    void ask(text, fieldId, profileId, lang, via);
  };

  /** sovereign path: record, send the audio to our server, put the text into the normal Ask flow */
  const startOwn = async () => {
    setVoiceErr(null);
    const m = await sovereign();
    mic.current = m.ownMic({
      onListening: setListening,
      onBusy: setTranscribing,
      onText: (text) => {
        setQ(text);
        submit(text, 'voice');
      },
      onError: setVoiceErr,
    });
    await mic.current.start();
  };

  const startListening = (consented = agreed) => {
    if (listening) {
      if (own) mic.current?.stop();
      else listener.current?.stop();
      return;
    }
    if (!consented) {
      setShowConsent(true);
      return;
    }
    if (own) {
      void startOwn();
      return;
    }
    setVoiceErr(null);
    sentByVoice.current = false;
    const l = listen(STT_TAG[lang], {
      onStart: () => setListening(true),
      onText: (text, final) => {
        setQ(text);
        if (final && !sentByVoice.current) {
          sentByVoice.current = true;
          submit(text, 'voice');
        }
      },
      onEnd: () => setListening(false),
      onError: (e) => {
        setListening(false);
        if (e !== 'aborted') setVoiceErr(e);
      },
    });
    if (!l) setVoiceErr('other');
    listener.current = l;
  };

  const allow = () => {
    writeStore(own ? OWN_CONSENT_KEY : CONSENT_KEY, '1');
    if (own) setConsentOwn(true);
    else setConsent(true);
    setShowConsent(false);
    // start right away: the visitor tapped the mic to get here
    startListening(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(q, 'text');
  };

  const mine = examples.filter((x) => x.lang === lang);
  const chips = (mine.length ? mine : examples).slice(0, 4);
  const asking = state.phase === 'asking';

  return (
    <div className="grid gap-6" data-testid="fa-ask">
      <div className="flow-root">
        <FarmerCameo mood="thinking" />
        <h2 className="t-head">{t('fa.ask.title')}</h2>
        <p className="mt-1.5 text-ink-2">{t('fa.ask.sub')}</p>
      </div>
      <NearestOffice variant="entry" />

      {supported ? (
        <div className="grid justify-items-center gap-3">
          {showConsent && !agreed && (
            <div className="panel w-full p-4" role="region" aria-labelledby="fa-consent-title" data-testid="fa-voice-consent">
              <p id="fa-consent-title" className="font-semibold">
                {t('fa.ask.consentTitle')}
              </p>
              <p className="mt-1 text-sm text-ink-2">{own ? t('fa.ask.consentOwnBody') : t('fa.ask.consentBody')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary fa-hit" onClick={allow} data-testid="fa-voice-allow">
                  {t('fa.ask.consentYes')}
                </button>
                <button type="button" className="btn btn-ghost fa-hit" onClick={() => setShowConsent(false)}>
                  {t('fa.ask.consentNo')}
                </button>
              </div>
            </div>
          )}
          <ClickSpark>
            <button type="button" className="fa-mic" data-listening={listening} aria-pressed={listening} onClick={() => startListening()} disabled={asking || transcribing} data-testid="fa-mic" data-via={own ? 'own' : 'browser'}>
              {listening ? <Square size={30} aria-hidden /> : <Mic size={36} aria-hidden />}
              <span className="sr-only-live">{listening ? t('fa.ask.micStop') : t('fa.ask.mic')}</span>
            </button>
          </ClickSpark>
          <p className="text-center text-sm text-ink-2" aria-live="polite">
            {listening
              ? t('fa.ask.listening')
              : transcribing
                ? t('fa.ask.transcribing')
                : voiceErr
                  ? t(`fa.ask.err.${voiceErr === 'not-allowed' ? 'blocked' : voiceErr === 'no-speech' ? 'silent' : voiceErr === 'server' ? 'server' : 'other'}`)
                  : t('fa.ask.micHint', { lang: lang === 'bn' ? 'বাংলা' : lang === 'en' ? 'English' : lang.toUpperCase() })}
          </p>
          <p className="fa-voice-ours max-w-[34ch] justify-center text-center" data-testid="fa-stt-via">
            {own ? t('fa.ask.viaOwn') : t('fa.ask.viaBrowser')}
          </p>
        </div>
      ) : (
        <p className="fa-note" data-testid="fa-no-stt">
          <MicOff size={16} aria-hidden className="flex-none" />
          {t('fa.ask.noStt')}
        </p>
      )}

      <form onSubmit={onSubmit} className="grid gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold">
          {t('fa.ask.label')}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            className="fa-input"
            value={q}
            maxLength={500}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('fa.ask.placeholder')}
            autoComplete="off"
            enterKeyHint="send"
            data-testid="fa-ask-input"
          />
          <ClickSpark className="flex-none">
            <button type="submit" className="btn btn-primary btn-icon fa-hit" disabled={!q.trim() || asking} aria-label={t('fa.ask.send')} data-testid="fa-ask-send">
              <ArrowUp size={20} aria-hidden />
            </button>
          </ClickSpark>
        </div>
      </form>

      {chips.length > 0 && (
        <div>
          <p className="eyebrow">{t('fa.ask.try')}</p>
          <ul className="m-0 mt-2 grid list-none gap-2 p-0">
            {chips.map((x) => (
              <li key={x.question}>
                <button
                  type="button"
                  lang={x.lang}
                  className="fa-qchip"
                  disabled={asking}
                  onClick={() => {
                    setQ(x.question);
                    submit(x.question, 'text');
                  }}
                  data-testid="fa-ask-chip"
                >
                  {x.question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={resultRef} className="scroll-mt-4" aria-live="polite" aria-busy={asking} data-testid="fa-ask-result">
        {state.phase === 'asking' && (
          <p className="fa-note">
            <span className="fa-dots" aria-hidden />
            {t('fa.ask.asking')}
          </p>
        )}
        {state.phase === 'error' && (
          <div className="panel p-4" role="alert">
            <p className="font-semibold">{t('fa.ask.errTitle')}</p>
            <p className="mono mt-2 break-all text-xs text-ink-3">{state.message}</p>
          </div>
        )}
        {state.phase === 'done' && state.outcome.source === 'offline' && (
          <Offline examples={state.outcome.examples} onPick={(x) => submit(x, 'text')} />
        )}
        {state.phase === 'done' && state.outcome.source !== 'offline' && (
          <Answer r={state.outcome.data} recorded={state.outcome.source === 'recorded'} onOpenReceipt={onOpenReceipt} />
        )}
      </div>
    </div>
  );
}

function Answer({ r, recorded, onOpenReceipt }: { r: AskResponse; recorded: boolean; onOpenReceipt: (x: ReceiptRef) => void }) {
  const { t, lang } = useI18n();
  const reader = useReader();
  const mark = recorded ? <DataMark kind="recorded" date={RECORDED_AT} /> : null;

  if (r.status !== 'ok' || !r.answer) {
    const ab = r.abstention;
    return (
      <div className="grid gap-5">
        <section className="fa-wait fa-arrive" data-testid="fa-ask-abstained">
          <div className="flex items-start gap-4 p-5">
            <span className="fa-wait-tile">
              <UserRound size={28} strokeWidth={1.7} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="t-head">{t('fa.ask.sent')}</p>
              <p className="mt-1.5 leading-snug">{reasonText(ab?.reason_code, t)}</p>
            </div>
          </div>
          <Handoff />
          <NearestOffice className="m-4" />
          <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 border-t border-rule px-5 py-4 text-sm">
            {ab?.why && (
              <>
                <dt className="eyebrow pt-[3px]">{t('fa.abs.why')}</dt>
                <dd className="m-0">{reasonText(ab.why, t)}</dd>
              </>
            )}
            <dt className="eyebrow pt-[3px]">{t('fa.abs.case')}</dt>
            <dd className="mono m-0 break-all text-ink-2" data-testid="fa-ask-case">
              {ab?.inbox_item_id ?? '–'}
            </dd>
          </dl>
          {mark && <div className="border-t border-rule px-5 py-3">{mark}</div>}
        </section>
        <Pipeline path={r.pipeline.path} />
      </div>
    );
  }

  const a = r.answer;
  const action = a.action;
  const tone = toneOfLight(action.traffic_light);
  const word = action.decision ? t(`ui.decision.${action.decision}`) : t(`ui.kind.${action.kind}`);
  const read = () =>
    reader.toggle(async () =>
      adviceRequest({
        title: { text: a.text, lang: a.text_lang },
        lead: word,
        rule: { rule_id: a.rule_id, version: a.rule_version },
        status: await receiptStatus(a.receipt_credential_id),
        t,
        uiLang: lang,
      }),
    );

  return (
    <div className="grid gap-5">
      <p className="text-sm text-ink-3">
        {t('fa.ask.youAsked')} <q lang={r.lang} className="text-ink-2">{r.question}</q>
      </p>
      <section className="panel fa-arrive overflow-hidden" data-testid="fa-answer">
        <div className="flex items-start gap-4 p-5">
          <span className={cx('fa-pop grid size-[4.5rem] flex-none place-items-center rounded-[14px]', TONE_TILE[tone])} style={{ ['--pict-bg' as string]: `var(--color-${tone === 'neutral' ? 'sunk' : `${tone}-wash`})` }}>
            {action.decision ? <DecisionPictogram decision={action.decision} size={52} /> : <KindIcon kind={action.kind} size={30} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cx('t-head', TONE_TEXT[tone])}>{word}</p>
              {mark}
            </div>
            <p lang={a.text_lang} className="mt-2 text-[1.06rem] leading-snug" data-testid="fa-answer-text">
              {a.text}
            </p>
            {a.lang_fallback && <p className="mt-1.5 text-xs text-ink-3">{t('fa.ask.fallback')}</p>}
            <p className="mono mt-2 text-xs text-ink-3">
              {a.rule_id} v{a.rule_version}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-rule p-3">
          <button type="button" className="btn btn-secondary fa-hit" onClick={() => onOpenReceipt({ receipt: action.receipt, credentialId: a.receipt_credential_id, recorded })} data-testid="fa-answer-receipt">
            <ReceiptText size={18} aria-hidden />
            {t('ui.receipt.open')}
          </button>
          <button type="button" className="btn btn-secondary fa-hit" onClick={() => void read()} aria-pressed={reader.playing} data-testid="fa-answer-read">
            {reader.playing ? <Square size={17} aria-hidden /> : <Volume2 size={18} aria-hidden />}
            {reader.playing ? t('fa.rc.stop') : t('fa.rc.read')}
          </button>
        </div>
      </section>
      <div aria-live="polite" data-testid="fa-answer-voice">
        <VoiceLine out={reader.out} />
      </div>
      {askNeedsOfficer(r) && <NearestOffice />}
      <Pipeline path={r.pipeline.path} />
      <p className="text-xs leading-relaxed text-ink-3">{t('fa.ask.fingerprint')}</p>
    </div>
  );
}

function Offline({ examples, onPick }: { examples: RecordedAsk[]; onPick: (q: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="panel p-5" data-testid="fa-ask-offline">
      <p className="flex items-center gap-2 font-semibold">
        <WifiOff size={18} aria-hidden />
        {t('fa.ask.offlineTitle')}
      </p>
      <p className="mt-1.5 text-sm text-ink-2">{t('fa.ask.offlineBody')}</p>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {examples.map((x) => (
          <li key={x.question}>
            <button type="button" lang={x.lang} className="fa-qchip" onClick={() => onPick(x.question)}>
              {x.question}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
