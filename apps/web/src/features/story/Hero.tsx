import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { LinkButton } from '../../ui/Button';
import { ReceiptCard } from '../../ui/Receipt';
import { DataMark } from '../../ui/DataMark';
import { Segmented } from '../../ui/Segmented';
import { RECORDED_AT } from '../../data/recorded';
import { STORY } from './storyData';

/**
 * The first screen says the whole idea twice: in words (the sentence) and as an object (a real receipt). The receipt
 * prints out of its slot, the AUTHENTIC stamp lands, and one tap recalls its rule: the stamp turns RECALLED and the
 * rule line is struck through. The recall here is a labelled simulation; the real one is in the officer console.
 */
export function Hero() {
  const { t } = useI18n();
  const [state, setState] = useState<'authentic' | 'recalled'>('authentic');
  const [stampKey, setStampKey] = useState(0);
  const paper = useRef<HTMLDivElement>(null);
  const { action } = STORY.calm;

  // the paper gives a little under each new stamp (DESIGN.md "thud"); transform only, skipped with reduced motion
  useEffect(() => {
    if (!stampKey || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    paper.current?.animate([{ transform: 'none' }, { transform: 'translateY(1.5px) scale(0.997)' }, { transform: 'none' }], { duration: 260, delay: 300, easing: 'cubic-bezier(.23,1,.32,1)' });
  }, [stampKey]);
  const rule = action.receipt.rule_refs[0]!;
  const ruleLabel = `${rule.rule_id} v${rule.version}`;

  const choose = (s: 'authentic' | 'recalled') => {
    if (s === state) return;
    setState(s);
    setStampKey((k) => k + 1);
  };

  return (
    <section className="wrap grid items-start gap-x-14 gap-y-12 pb-20 pt-10 sm:pt-14 lg:grid-cols-[1.04fr_1fr] lg:pb-28 lg:pt-20" aria-labelledby="hero-title">
      <div className="lg:sticky lg:top-[calc(var(--header-h)+48px)]">
        <p className="eyebrow hero-rise">{t('story.hero.eyebrow')}</p>
        <h1 id="hero-title" className="t-hero hero-rise mt-5 max-w-[13ch] text-ink" style={{ ['--i' as string]: 1 }}>
          {t('story.hero.title')}
        </h1>
        <p className="t-lead hero-rise mt-6 max-w-[34ch] text-[1.3rem]" style={{ ['--i' as string]: 2 }}>
          {t('story.hero.sub')}
        </p>
        <div className="hero-rise mt-9 flex flex-wrap gap-3" style={{ ['--i' as string]: 3 }}>
          <LinkButton to="/app" variant="primary" size="lg" arrow>
            {t('ui.cta.tryApp')}
          </LinkButton>
          <LinkButton to={`/verify/${encodeURIComponent(action.receipt_credential_id!.replace(/^urn:uuid:/, ''))}`} variant="secondary" size="lg">
            {t('ui.cta.verify')}
          </LinkButton>
        </div>
        <p className="mono hero-rise mt-9 text-xs leading-relaxed text-ink-3" style={{ ['--i' as string]: 4 }}>
          {t('story.hero.facts')}
        </p>
      </div>

      <div className="relative mx-auto w-full max-w-[460px] lg:mt-2">
        {/* the printer slot the receipt feeds out of */}
        <div className="relative z-10 mx-[-12px] h-3 rounded-full bg-ink shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)]" aria-hidden />
        <div ref={paper} className="relative -mt-1.5 lg:rotate-[-1.2deg]">
          <div className="absolute inset-x-3 top-6 h-[96%] rotate-[2.6deg] rounded-[3px] border border-rule bg-card opacity-70 shadow-[var(--shadow-lift)]" aria-hidden />
          <ReceiptCard
            receipt={action.receipt}
            credentialId={action.receipt_credential_id}
            status={state}
            stampKey={stampKey}
            struck={state === 'recalled'}
            print
            stampDelay={stampKey === 0 ? 950 : 0}
            mark={<DataMark kind="recorded" date={RECORDED_AT} />}
          />
        </div>
        <div className="mt-7 flex flex-col items-start gap-3">
          <Segmented
            label={t('story.hero.controls')}
            value={state}
            onChange={choose}
            options={[
              { value: 'authentic', label: t('story.hero.check') },
              { value: 'recalled', label: t('story.hero.recall') },
            ]}
          />
          <p className="m-0 min-h-[4.5em] max-w-[44ch] text-sm leading-relaxed text-ink-2" aria-live="polite">
            {state === 'authentic' ? t('story.hero.caption.authentic') : t('story.hero.caption.recalled', { rule: ruleLabel })}
            {state === 'recalled' && <span className="mt-1 block text-ink-3">{t('story.hero.simNote')}</span>}
          </p>
        </div>
      </div>
    </section>
  );
}
