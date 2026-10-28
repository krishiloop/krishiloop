import { useEffect, useState } from 'react';
import { ArrowDown, CalendarRange, Volume2, VolumeX } from 'lucide-react';
import { TrafficLight } from './TrafficLight';
import { SampleBadge } from '../../components/ui/Badges';
import { DataAsOf } from './DataAsOf';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, pickText } from '../../lib/format';
import { hasVoiceFor, speak, SPEECH_TAG, stopSpeaking, ttsSupported, voicesReady } from '../../lib/speech';
import type { Action, DataSource, Plan, TrafficLight as Light } from '../../lib/api/types';

export function signalOf(action: Action): { light: Light; word: Key; sub: Key } {
  const light: Light = action.traffic_light ?? (action.decision === 'dont_spray' ? 'green' : action.decision === 'spray' ? 'red' : 'amber');
  const word: Key =
    action.decision === 'dont_spray' ? 'signal.go' : action.decision === 'spray' ? 'signal.spray' : action.decision === 'recheck' ? (light === 'red' ? 'signal.act' : 'signal.wait') : light === 'green' ? 'signal.go' : light === 'amber' ? 'signal.wait' : 'signal.act';
  const sub: Key = light === 'green' ? 'signal.goSub' : light === 'amber' ? 'signal.waitSub' : 'signal.actSub';
  return { light, word, sub };
}

const LIGHT_KEY: Record<Light, Key> = { green: 'light.green', amber: 'light.amber', red: 'light.red' };

/** The "Should I spray this week?" card: the traffic light, the answer in one word, the sentence, read-aloud. */
export function Signal({ plan, action, source }: { plan: Plan; action: Action; source: DataSource | null }) {
  const { t, lang } = useI18n();
  const { light, word, sub } = signalOf(action);
  const title = pickText(action.title, lang);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOk, setVoiceOk] = useState(true);
  const speechTag = title.fellBack ? SPEECH_TAG.en : SPEECH_TAG[lang];

  useEffect(() => {
    let alive = true;
    void voicesReady().then(() => alive && setVoiceOk(ttsSupported() && (speechTag === 'en-GB' ? true : hasVoiceFor(speechTag))));
    return () => {
      alive = false;
      stopSpeaking();
    };
  }, [speechTag]);

  const read = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const wordText = speechTag === SPEECH_TAG.en && lang !== 'en' ? t('signal.go') : t(word);
    setSpeaking(speak(`${wordText}. ${title.text}`, speechTag, () => setSpeaking(false)));
  };

  const readLabel = speaking ? t('signal.stopReading') : t('signal.readAloud');
  const readNote = !ttsSupported() ? t('signal.noSpeech') : !voiceOk ? t('signal.noVoice') : null;

  return (
    <section className="signal surface" data-light={light} aria-labelledby="signal-q">
      <div className="signal-glow" aria-hidden />
      <header className="signal-head">
        <h2 id="signal-q" className="eyebrow !text-chrome">
          {t('app.question')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-mono" title={`${plan.valid_from} – ${plan.valid_to}`}>
            <CalendarRange size={13} aria-hidden />
            {t('signal.valid', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) })}
          </span>
          {source === 'sample' ? <SampleBadge /> : null}
        </div>
      </header>

      <div className="signal-body">
        <TrafficLight light={light} label={t('signal.lightsLabel', { state: t(LIGHT_KEY[light]) })} />
        <div className="min-w-0">
          <p className="signal-word display" data-testid="signal-word">
            {t(word)}
          </p>
          <p className="signal-sub" data-tone={light === 'green' ? 'go' : light === 'amber' ? 'wait' : 'stop'}>
            {t(sub)}
          </p>
          <p className="signal-title" lang={title.lang}>
            {title.text}
          </p>
          {title.fellBack ? <p className="m-0 mt-1 text-xs text-dim">{t('common.englishOnly')}</p> : null}
          <p className="m-0 mt-3">
            <DataAsOf asOf={plan.data_as_of} mode={plan.data_mode} />
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={read} disabled={!ttsSupported() || !voiceOk} aria-pressed={speaking} title={readLabel}>
              {speaking ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
              {readLabel}
            </button>
            <a href="#receipts" className="btn btn-quiet btn-sm">
              <ArrowDown size={15} aria-hidden />
              {t('signal.showReceipt')}
            </a>
          </div>
          {readNote ? <p className="m-0 mt-2 text-xs text-dim">{readNote}</p> : null}
        </div>
      </div>
    </section>
  );
}
