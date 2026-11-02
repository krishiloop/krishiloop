import { RotateCcw, Volume2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import type { ReadOutcome } from './voice';

/**
 * Under a "Hear" button: what was read and by whom. Our own clip carries its label (machine voice, svara-tts-v1, Built
 * with Llama, not yet checked by a native speaker); a recalled receipt shows the notice that was read instead of its
 * advice; a device without a voice for the language says so. `toastNoVoice`: the caller already said it in a toast.
 */
export function VoiceLine({ out, className, toastNoVoice = false }: { out: ReadOutcome | null; className?: string; toastNoVoice?: boolean }) {
  const { t } = useI18n();
  if (!out) return null;
  const quiet = out.state === 'no-voice' || out.state === 'unsupported';
  if (!out.notice && out.via !== 'ours' && (!quiet || toastNoVoice)) return null;
  return (
    <div className={cx('grid gap-1.5', className)}>
      {out.notice && (
        <p className="fa-voice-notice" lang={out.lang} data-testid="fa-voice-notice">
          <RotateCcw size={15} aria-hidden className="mt-[3px] flex-none text-stop" />
          <span>{out.notice}</span>
        </p>
      )}
      {out.via === 'ours' && (
        <p className="fa-voice-ours" data-testid="fa-voice-ours">
          <Volume2 size={15} aria-hidden className="mt-[2px] flex-none" />
          <span>{t('fa.voice.ours')}</span>
        </p>
      )}
      {quiet && !toastNoVoice && !out.notice && (
        <p className="text-sm text-ink-2">{out.state === 'no-voice' ? t('fa.voice.noVoice', { lang: out.lang === 'bn' ? 'বাংলা' : out.lang.toUpperCase() }) : t('fa.voice.noTts')}</p>
      )}
    </div>
  );
}
