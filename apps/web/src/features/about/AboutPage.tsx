// this page's words (English loads per screen)
import '../../lib/i18n/strings.about';
import type { CSSProperties } from 'react';
import { ArrowRight, BotOff, Building2, ClipboardList, Eye, HeartHandshake, LockOpen, ReceiptText, Scale, ScanSearch, Sprout, UserRound, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { LinkButton } from '../../ui/Button';
import { LogoMark } from '../../ui/Logo';
import { Heading } from '../../ui/kit/Heading';
import { Timeline } from '../../ui/kit/Timeline';
import { spotlight } from '../../ui/kit/hooks';
import { TEAM } from './team';
import './about.css';

/** A round rubber seal: the brand's promise set on a circle, stamped once when the page opens. */
function Seal() {
  const { t } = useI18n();
  const ring = `${t('about.seal.top')} · ${t('about.seal.bottom')} · `;
  return (
    <div className="seal-wrap relative mx-auto aspect-square w-[min(72vw,340px)]" aria-hidden>
      <svg viewBox="0 0 200 200" className="seal stamp-ink h-full w-full text-ink">
        <defs>
          <path id="seal-ring" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
        </defs>
        <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="100" cy="100" r="56" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text fontSize="12" fontWeight="700" fill="currentColor" style={{ textTransform: 'uppercase', fontStretch: '80%' }}>
          {/* one pass round the ring, spaced to close the circle exactly (2πr ≈ 465) */}
          <textPath href="#seal-ring" startOffset="0" textLength="462" lengthAdjust="spacing">
            {ring}
          </textPath>
        </text>
        <text x="100" y="128" textAnchor="middle" fontSize="15" fontWeight="760" letterSpacing="1.5" fill="currentColor" style={{ textTransform: 'uppercase', fontStretch: '75%' }}>
          {t('about.seal.mid')}
        </text>
      </svg>
      <span className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 text-ink">
        <LogoMark size={46} />
      </span>
    </div>
  );
}

const PRINCIPLES: { key: Key; icon: LucideIcon }[] = [
  { key: 'about.p1', icon: ReceiptText },
  { key: 'about.p2', icon: BotOff },
  { key: 'about.p3', icon: HeartHandshake },
  { key: 'about.p4', icon: Scale },
  { key: 'about.p5', icon: LockOpen },
  { key: 'about.p6', icon: Eye },
];
const WHO: { key: Key; icon: LucideIcon }[] = [
  { key: 'about.who.farmer', icon: Sprout },
  { key: 'about.who.officer', icon: ClipboardList },
  { key: 'about.who.programme', icon: Building2 },
  { key: 'about.who.auditor', icon: ScanSearch },
];
const TIMELINE: { n: number; done: boolean }[] = [
  { n: 1, done: true },
  { n: 2, done: true },
  { n: 3, done: true },
  { n: 4, done: false },
  { n: 5, done: false },
  { n: 6, done: false },
  { n: 7, done: false },
];
const SEATS = [1, 2, 3, 4, 5];
const iv = (i: number) => ({ '--i': i }) as CSSProperties;

/**
 * /about: why we built it, what we will not bend on, who it serves, how it pays (labelled hypotheses), the road so far
 * (done vs planned, never blurred: the traced rail stops at "now"), the team (names come from the team, never guessed),
 * and an invitation to pilot.
 */
export default function AboutPage() {
  const { t } = useI18n();
  return (
    <div className="ab-page">
      {/* hero */}
      <section className="relative overflow-hidden" aria-labelledby="about-title">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="wrap relative grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.25fr_1fr] lg:pb-24 lg:pt-24">
          <div>
            <p className="label hero-rise m-0 flex items-center gap-2.5">
              <span className="h-px w-8 bg-ink-3" aria-hidden />
              {t('about.eyebrow')}
            </p>
            <h1 id="about-title" className="t-hero hero-rise mt-6 max-w-[15ch]" style={iv(1)}>
              {t('about.title')}
            </h1>
            <p className="t-lead hero-rise mt-6 max-w-[42ch]" style={iv(2)}>
              {t('about.lead')}
            </p>
          </div>
          <Seal />
        </div>
      </section>

      {/* why */}
      <section className="sheet-band band-night" aria-labelledby="why-title">
        <div className="bg-dots pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div className="wrap relative grid gap-10 py-20 md:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="label m-0 flex items-center gap-2.5" data-reveal>
              <span className="h-px w-8 bg-ink-3" aria-hidden />
              {t('about.why.eyebrow')}
            </p>
            <h2 id="why-title" className="t-title m-0 mt-5" data-reveal style={iv(1)}>
              {t('about.why.title')}
            </h2>
          </div>
          <p className="ab-why-line m-0 max-w-[44ch]" data-reveal style={iv(2)}>
            {t('about.why.line')}
          </p>
        </div>
      </section>

      {/* principles: a bento of six rules */}
      <section className="section" aria-labelledby="principles-title">
        <div className="wrap">
          <Heading eyebrow={t('about.principles.eyebrow')} title={t('about.principles.title')} id="principles-title" />
          <ul className="ab-bento m-0 mt-14 list-none p-0">
            {PRINCIPLES.map(({ key, icon: Icon }, i) => (
              <li key={key} className="ab-rule surface" data-k={i + 1} data-reveal style={iv(i % 3)} {...spotlight()}>
                <span className="ab-rule-n" aria-hidden>
                  {`0${i + 1}`}
                </span>
                <span className="ab-rule-icon" aria-hidden>
                  <Icon size={i === 0 ? 26 : 21} strokeWidth={1.7} />
                </span>
                <h3 className="ab-rule-title">{t(key)}</h3>
                <p className="ab-rule-sub">{t(`${key}.sub` as Key)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* who */}
      <section className="section border-t border-rule" aria-labelledby="who-title">
        <div className="wrap">
          <Heading eyebrow={t('about.who.eyebrow')} title={t('about.who.title')} id="who-title" />
          <ul className="ab-who m-0 mt-14 list-none p-0">
            {WHO.map(({ key, icon: Icon }, i) => (
              <li key={key} data-reveal style={iv(i)}>
                <span className="ab-who-icon" aria-hidden>
                  <Icon size={22} strokeWidth={1.6} />
                </span>
                <h3 className="m-0 mt-5 text-[1.15rem] font-[580] tracking-[-0.02em]">{t(key)}</h3>
                <p className="m-0 mt-2 text-[0.97rem] leading-snug text-ink-2">{t(`${key}.sub` as Key)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* how it pays */}
      <section className="section border-t border-rule" aria-labelledby="money-title">
        <div className="wrap">
          <Heading eyebrow={t('about.money.eyebrow')} title={t('about.money.title')} id="money-title" />
          <ol className="money m-0 mt-14 grid list-none items-stretch gap-3 p-0 md:grid-cols-[1fr_auto_1fr_auto_1fr]" data-reveal>
            {(['about.money.s1', 'about.money.s2', 'about.money.s3'] as Key[]).map((k, i) => (
              <li key={k} className="contents">
                {i > 0 && (
                  <span className="money-arrow hidden items-center justify-center text-ink-3 md:flex" style={{ ['--k' as string]: i }} aria-hidden>
                    <ArrowRight size={22} />
                  </span>
                )}
                <div className={cx('money-step', i === 0 && 'is-free')} style={{ ['--k' as string]: i }}>
                  <p className="mono m-0 text-xs text-ink-3">{`0${i + 1}`}</p>
                  <p className="m-0 mt-6 text-[1.3rem] font-[580] leading-tight tracking-[-0.02em]">{t(k)}</p>
                  <p className={cx('m-0 mt-2 text-[0.97rem] leading-snug', i === 0 ? 'font-semibold text-go' : 'text-ink-2')}>{t(`${k}.sub` as Key)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <span className="chip">{t('about.money.hyp')}</span>
            {t('about.money.note')}
          </p>
        </div>
      </section>

      {/* timeline */}
      <section className="section border-t border-rule" aria-labelledby="time-title">
        <div className="wrap">
          <Heading eyebrow={t('about.time.eyebrow')} title={t('about.time.title')} id="time-title" />
          <Timeline
            className="mt-20"
            doneLabel={t('about.time.done')}
            plannedLabel={t('about.time.plan')}
            nowLabel={t('about.time.now')}
            items={TIMELINE.map(({ n, done }) => ({ date: t(`about.t${n}.date` as Key), body: t(`about.t${n}` as Key), done }))}
          />
        </div>
      </section>

      {/* team: names come from the team itself, so until then the seats say so */}
      <section className="section border-t border-rule" aria-labelledby="team-title">
        <div className="wrap">
          <Heading eyebrow={t('about.team.eyebrow')} title={t('about.team.title')} lead={t('about.team.line')} id="team-title" />
          {TEAM.length > 0 ? (
            <ul className="ab-team m-0 mt-14 list-none p-0">
              {TEAM.map((m, i) => (
                <li key={m.name} className="surface p-5" data-reveal style={iv(i)} {...spotlight()}>
                  <span className="grid size-14 place-items-center rounded-full bg-ink text-[1.1rem] font-semibold text-paper" aria-hidden>
                    {m.initials}
                  </span>
                  <p className="m-0 mt-4 font-semibold">{m.name}</p>
                  <p className="m-0 mt-1 text-sm text-ink-3">{m.role}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-14" data-testid="team-soon">
              <ul className="ab-team m-0 list-none p-0" aria-hidden>
                {SEATS.map((n, i) => (
                  <li key={n} className="ab-seat" data-reveal style={iv(i)}>
                    <span className="ab-seat-face">
                      <UserRound size={22} strokeWidth={1.5} />
                    </span>
                    <span className="mono mt-5 block text-[0.72rem] text-ink-3">{`0${n}`}</span>
                    <span className="ab-seat-line" />
                    <span className="ab-seat-line is-short" />
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <span className="chip">{t('about.team.soonChip')}</span>
                {t('about.team.soon')}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* invitation */}
      <section className="sheet-band band-night mb-6" aria-labelledby="cta-title">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="wrap relative py-20 md:py-28">
          <h2 id="cta-title" className="t-hero m-0 max-w-[14ch]" data-reveal>
            {t('about.cta.title')}
          </h2>
          <p className="t-lead mt-6 max-w-[46ch]" data-reveal style={iv(1)}>
            {t('about.cta.line')}
          </p>
          <div className="mt-9 flex flex-wrap gap-3" data-reveal style={iv(2)}>
            <LinkButton to="/app" variant="primary" size="lg" arrow>
              {t('ui.cta.tryApp')}
            </LinkButton>
            <LinkButton to="/proof" variant="secondary" size="lg">
              {t('about.cta.proof')}
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
