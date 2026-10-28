import { Check, X } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { ReceiptCard } from '../../ui/Receipt';
import { STORY } from './storyData';
import { SectionHead } from './parts';

type Mark = { key: Key; ok?: boolean };
/** research/llm_bangla_smoke_test.md (25 Oct 2026): what each anonymised model said and what went wrong. Doses left out. */
const MODELS: { said: Key; marks: Mark[] }[] = [
  { said: 'story.bots.m1', marks: [{ key: 'story.bots.wrong' }, { key: 'story.bots.invented' }, { key: 'story.bots.garbled' }, { key: 'story.bots.afterHarvest' }] },
  { said: 'story.bots.m2', marks: [{ key: 'story.bots.wrong' }, { key: 'story.bots.dose' }] },
  { said: 'story.bots.m3', marks: [{ key: 'story.bots.likelyWrong' }, { key: 'story.bots.garbled' }, { key: 'story.bots.noProduct' }] },
  { said: 'story.bots.m4', marks: [{ key: 'story.bots.right', ok: true }, { key: 'story.bots.dose' }, { key: 'story.bots.brand' }] },
];

/**
 * Why receipts: a night band where four chatbots answer one Bangla question and three invent doses. Each answer card
 * slides in and its marks stamp on in turn; then the one-line verdict, and KrishiLoop's answer: a receipt, or "not sure".
 */
export function Chatbots() {
  const { t } = useI18n();
  return (
    <section className="band-night section cv" aria-labelledby="bots-title">
      <div className="wrap">
        <SectionHead eyebrow={t('story.bots.eyebrow')} title={t('story.bots.title')} id="bots-title" />

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[0.9fr_1.4fr] lg:gap-14">
          <figure className="m-0" data-reveal>
            <div className="relative rounded-[18px] rounded-bl-[4px] bg-card px-6 py-5 shadow-[var(--shadow-lift)]">
              <p className="m-0 text-[1.35rem] font-medium leading-snug text-ink">“{t('story.bots.q')}”</p>
            </div>
            <figcaption className="mt-3 flex items-center gap-2 text-sm text-ink-3">
              <span lang="bn" className="text-ink-2">
                আমার আমন ধানের পাতায় চোখের মতো দাগ…
              </span>
              <span aria-hidden>·</span>
              {t('story.bots.qNote')}
            </figcaption>
          </figure>

          <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {MODELS.map((m, i) => (
              <li key={m.said} className="bot-card rounded-[var(--radius-ui)] border border-rule bg-card p-4" data-reveal style={{ ['--i' as string]: i + 1 }}>
                <p className="mono m-0 text-xs text-ink-3">{t('story.bots.model', { n: i + 1 })}</p>
                <p className="m-0 mt-1.5 text-[1.05rem]">
                  <span className="text-ink-3">{t('story.bots.said')}: </span>
                  <span className="font-semibold">{t(m.said)}</span>
                </p>
                <ul className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">
                  {m.marks.map((mk, j) => (
                    <li key={mk.key} className={cx('bot-mark chip', mk.ok ? 'chip-go' : 'chip-stop')} style={{ ['--j' as string]: j }}>
                      {mk.ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <X size={12} strokeWidth={3} aria-hidden />}
                      {t(mk.key)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-16 grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <p className="t-title m-0" data-reveal>
            <span className="block">{t('story.bots.verdict1')}</span>
            <span className="block text-stop">{t('story.bots.verdict2')}</span>
          </p>
          <div data-reveal style={{ ['--i' as string]: 1 }}>
            <p className="m-0 mb-4 text-[1.1rem] font-medium">{t('story.bots.ours')}</p>
            <div className="max-w-[420px] origin-top-left scale-[0.92]">
              <ReceiptCard receipt={STORY.calm.action.receipt} status="authentic" compact />
            </div>
            <p className="m-0 mt-2 text-sm text-ink-2">{t('story.bots.notSure')}</p>
          </div>
        </div>
        <p className="m-0 mt-12 max-w-[70ch] text-xs leading-relaxed text-ink-3">{t('story.bots.footnote')}</p>
      </div>
    </section>
  );
}
