import { useRef, type CSSProperties } from 'react';
import { ArrowRight, Check, CircleDashed, X } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { LinkButton } from '../../ui/Button';
import { Qr } from '../../ui/Qr';
import { ReceiptCard } from '../../ui/Receipt';
import { Marquee } from '../../ui/kit/Marquee';
import { NumberTicker } from '../../ui/kit/NumberTicker';
import { BorderBeam } from '../../ui/kit/BorderBeam';
import { Magnetic } from '../../ui/kit/Magnetic';
import { spotlight, useOnScreen } from '../../ui/kit/hooks';
import { STORY } from '../story/storyData';

/** A section heading in the house style: mono label, big tight title, one optional line. */
export function Head({ eyebrow, title, lead, id, className }: { eyebrow: string; title: React.ReactNode; lead?: React.ReactNode; id?: string; className?: string }) {
  return (
    <header className={cx('max-w-3xl', className)}>
      <p className="label flex items-center gap-2.5" data-reveal>
        <span className="h-px w-8 bg-ink-3" aria-hidden />
        {eyebrow}
      </p>
      <h2 id={id} className="t-title mt-5 text-ink" data-reveal style={{ '--i': 1 } as CSSProperties}>
        {title}
      </h2>
      {lead && (
        <p className="t-lead mt-5 max-w-[48ch]" data-reveal style={{ '--i': 2 } as CSSProperties}>
          {lead}
        </p>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ the ticker: what works today, endlessly */
const FEATS: Key[] = [
  'story.feat.ask',
  'story.feat.decision',
  'story.feat.scan',
  'story.feat.recall',
  'story.feat.inbox',
  'story.feat.photo',
  'story.feat.engine',
  'story.feat.sig',
  'story.feat.sms',
  'story.feat.lang',
  'story.feat.mcp',
  'story.feat.weather',
];
export function FactTicker() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const on = useOnScreen(ref);
  return (
    <div ref={ref} className="border-y border-rule py-6" data-offscreen={on ? undefined : ''}>
      <Marquee duration={55} label={t('story.feat.title')}>
        {FEATS.map((k) => (
          <span key={k} className="flex items-center gap-[var(--gap)] whitespace-nowrap text-[clamp(1.1rem,1rem+0.9vw,1.7rem)] font-[480] tracking-[-0.03em] text-ink-2">
            {t(k)}
            <span className="size-1.5 rounded-full bg-sprout" aria-hidden />
          </span>
        ))}
      </Marquee>
    </div>
  );
}

/* ------------------------------------------------------------------ the problem, in six counted numbers */
const NUMS: { key: Key; label: Key; src: Key; value: number; fmt: (n: number, l: Parameters<typeof fmtNum>[1]) => string }[] = [
  { key: 'story.problem.n.farms', label: 'story.problem.farms', src: 'story.problem.src.farms', value: 608, fmt: (n, l) => `${fmtNum(Math.round(n), l)}M+` },
  { key: 'story.problem.n.small', label: 'story.problem.small', src: 'story.problem.src.small', value: 84, fmt: (n, l) => `${fmtNum(Math.round(n), l)}%` },
  { key: 'story.problem.n.loss', label: 'story.problem.loss', src: 'story.problem.src.loss', value: 30, fmt: (n, l) => `${fmtNum(Math.round(n), l)}%` },
  { key: 'story.problem.n.households', label: 'story.problem.households', src: 'story.problem.src.households', value: 16.88, fmt: (n, l) => `${fmtNum(n, l, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M` },
  { key: 'story.problem.n.calls', label: 'story.problem.calls', src: 'story.problem.src.calls', value: 92094, fmt: (n, l) => fmtNum(Math.round(n), l) },
  { key: 'story.problem.n.phones', label: 'story.problem.phones', src: 'story.problem.src.phones', value: 26, fmt: (n, l) => `${fmtNum(Math.round(n), l)}%` },
];
export function ProblemBand() {
  const { t, lang } = useI18n();
  return (
    <section className="section cv" aria-labelledby="problem-title">
      <div className="wrap">
        <Head eyebrow={t('story.problem.eyebrow')} title={t('story.problem.title')} id="problem-title" />
        <div className="m-0 mt-16 grid grid-cols-1 gap-x-10 border-t border-rule sm:grid-cols-2 lg:grid-cols-3">
          {NUMS.map((n, i) => (
            <div key={n.key} className="contents">
              {i === 3 && (
                <p className="label col-span-full m-0 flex items-center gap-2.5 pt-10 text-go" data-reveal>
                  <span className="ping" aria-hidden />
                  {t('story.problem.bd')}
                </p>
              )}
              <div className="border-b border-rule py-8" data-reveal style={{ '--i': i % 3 } as CSSProperties}>
                <p className="m-0">
                  <NumberTicker value={n.value} format={(v) => n.fmt(v, lang)} className="block text-[clamp(3rem,2rem+3.4vw,5.2rem)] font-[520] leading-none tracking-[-0.05em] text-ink" />
                  <span className="mt-4 block max-w-[26ch] text-[1.02rem] leading-snug text-ink-2">{t(n.label)}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
        <details className="group mt-8 max-w-[90ch] text-[0.85rem] text-ink-3">
          <summary className="label cursor-pointer list-none hover:text-ink-2">
            {t('story.problem.sources')} <span className="inline-block transition-transform duration-200 group-open:rotate-90">›</span>
          </summary>
          <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
            {NUMS.map((n) => (
              <li key={n.src}>{t(n.src)}</li>
            ))}
            <li className="pt-2">{t('story.problem.note')}</li>
          </ul>
        </details>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ we asked chatbots first */
type Mark = { key: Key; ok?: boolean };
/** research/llm_bangla_smoke_test.md (25 Oct 2026): what each anonymised model said and what went wrong. Doses left out. */
const MODELS: { said: Key; marks: Mark[] }[] = [
  { said: 'story.bots.m1', marks: [{ key: 'story.bots.wrong' }, { key: 'story.bots.invented' }, { key: 'story.bots.garbled' }, { key: 'story.bots.afterHarvest' }] },
  { said: 'story.bots.m2', marks: [{ key: 'story.bots.wrong' }, { key: 'story.bots.dose' }] },
  { said: 'story.bots.m3', marks: [{ key: 'story.bots.likelyWrong' }, { key: 'story.bots.garbled' }, { key: 'story.bots.noProduct' }] },
  { said: 'story.bots.m4', marks: [{ key: 'story.bots.right', ok: true }, { key: 'story.bots.dose' }, { key: 'story.bots.brand' }] },
];
export function BotsBand() {
  const { t } = useI18n();
  return (
    <section className="sheet-band band-night section cv" aria-labelledby="bots-title">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="wrap relative">
        <Head eyebrow={t('home.bots.eyebrow')} title={t('story.bots.title')} id="bots-title" />
        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[0.85fr_1.4fr] lg:gap-14">
          <figure className="m-0" data-reveal>
            <div className="glass relative rounded-[22px] rounded-bl-[6px] px-6 py-6">
              <p className="m-0 text-[1.3rem] font-[500] leading-snug tracking-[-0.02em] text-ink">“{t('story.bots.q')}”</p>
            </div>
            <figcaption className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-3">
              <span lang="bn" className="text-ink-2">
                আমার আমন ধানের পাতায় চোখের মতো দাগ…
              </span>
              <span aria-hidden>·</span>
              {t('story.bots.qNote')}
            </figcaption>
          </figure>
          <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {MODELS.map((m, i) => (
              <li key={m.said} className="surface p-5" data-reveal style={{ '--i': i + 1 } as CSSProperties} {...spotlight()}>
                <p className="mono m-0 text-[0.72rem] text-ink-3">{t('story.bots.model', { n: i + 1 })}</p>
                <p className="m-0 mt-2 text-[1.08rem]">
                  <span className="text-ink-3">{t('story.bots.said')}: </span>
                  <span className="font-[560] text-ink">{t(m.said)}</span>
                </p>
                <ul className="m-0 mt-4 flex list-none flex-wrap gap-1.5 p-0">
                  {m.marks.map((mk) => (
                    <li key={mk.key} className={cx('chip', mk.ok ? 'chip-go' : 'chip-stop')}>
                      {mk.ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <X size={12} strokeWidth={3} aria-hidden />}
                      {t(mk.key)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-20 grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <p className="t-title m-0" data-reveal>
            <span className="block text-ink">{t('story.bots.verdict1')}</span>
            <span className="serif-i block text-stop">{t('story.bots.verdict2')}</span>
          </p>
          <div data-reveal style={{ '--i': 1 } as CSSProperties}>
            <p className="m-0 mb-5 text-[1.1rem] font-[500] text-ink">{t('story.bots.ours')}</p>
            <div className="max-w-[420px] -rotate-1">
              <ReceiptCard receipt={STORY.calm.action.receipt} status="authentic" compact />
            </div>
            <p className="m-0 mt-4 text-sm text-ink-2">{t('story.bots.notSure')}</p>
          </div>
        </div>
        <p className="m-0 mt-14 max-w-[70ch] text-xs leading-relaxed text-ink-3">{t('story.bots.footnote')}</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ honest status */
const NOW: Key[] = ['story.status.now1', 'story.status.now2', 'story.status.now3', 'story.status.now4', 'story.status.now5', 'story.status.now6', 'story.status.now7', 'story.status.now8'];
const NEXT: Key[] = ['story.status.next1', 'story.status.next2', 'story.status.next3', 'story.status.next4', 'story.status.next5', 'story.status.next6'];
export function StatusBand() {
  const { t } = useI18n();
  return (
    <section className="section mesh botanic-bg botanic-bg--corner cv" aria-labelledby="status-title">
      <div className="wrap">
        <Head eyebrow={t('story.status.eyebrow')} title={t('story.status.title')} id="status-title" />
        <div className="mt-14 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <div className="surface p-7 sm:p-9" data-reveal {...spotlight()}>
            <p className="label text-go">{t('story.status.now')}</p>
            <ul className="m-0 mt-6 grid list-none gap-x-8 gap-y-4 p-0 sm:grid-cols-2">
              {NOW.map((k) => (
                <li key={k} className="flex gap-3 text-[1rem] leading-snug text-ink">
                  <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-sprout text-sprout-ink">
                    <Check size={12} strokeWidth={3} aria-hidden />
                  </span>
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[var(--radius-frame)] border border-dashed border-rule-2 p-7 sm:p-9" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <p className="label">{t('story.status.next')}</p>
            <ul className="m-0 mt-6 list-none space-y-4 p-0">
              {NEXT.map((k) => (
                <li key={k} className="flex gap-3 text-[1rem] leading-snug text-ink-2">
                  <CircleDashed size={20} className="flex-none text-ink-3" aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the end: scan one receipt */
export function EndBand() {
  const { t } = useI18n();
  const id = STORY.calm.action.receipt_credential_id ?? '';
  return (
    <section className="section" aria-labelledby="end-title">
      <div className="wrap">
        <div className="surface relative grid items-center gap-10 overflow-hidden p-8 sm:p-12 md:grid-cols-[1fr_auto] md:p-16" {...spotlight()}>
          <BorderBeam size={180} duration={10} radius={22} />
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
          <div className="relative">
            <h2 id="end-title" className="t-hero m-0 text-ink" data-reveal>
              {t('story.end.title')}
            </h2>
            <p className="t-lead mt-6 max-w-[40ch]" data-reveal style={{ '--i': 1 } as CSSProperties}>
              {t('story.end.line')}
            </p>
            <div className="mt-9 flex flex-wrap gap-3" data-reveal style={{ '--i': 2 } as CSSProperties}>
              <Magnetic>
                <LinkButton to="/app" variant="primary" size="lg" arrow>
                  {t('ui.cta.tryApp')}
                </LinkButton>
              </Magnetic>
              <LinkButton to={`/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`} variant="secondary" size="lg">
                {t('ui.cta.verify')}
              </LinkButton>
            </div>
          </div>
          <div className="paper-object relative justify-self-start md:justify-self-end" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <div className="paper rotate-[2deg] p-4">
              <Qr value={verifyUrl(id)} size={188} label={t('ui.receipt.verify')} />
              <p className="mono m-0 mt-3 flex items-center justify-between gap-3 text-xs text-ink-3">
                {t('ui.receipt.scan')} <ArrowRight size={14} aria-hidden />
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
