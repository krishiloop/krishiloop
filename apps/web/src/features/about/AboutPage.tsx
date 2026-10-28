// this page's words (English loads per screen)
import '../../lib/i18n/strings.about';
import '../../lib/i18n/strings.story';
import { ArrowRight, BotOff, Building2, ClipboardList, Eye, HeartHandshake, LockOpen, ReceiptText, Scale, ScanSearch, Sprout, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { LinkButton } from '../../ui/Button';
import { LogoMark } from '../../ui/Logo';
import { SectionHead } from '../story/parts';
import { TEAM } from './team';
import './about.css';

/** A round rubber seal: the brand's promise set on a circle, stamped once when the page opens. */
function Seal() {
  const { t } = useI18n();
  const ring = `${t('about.seal.top')} · ${t('about.seal.bottom')} · `;
  return (
    <div className="seal-wrap relative mx-auto aspect-square w-[min(78vw,340px)]" aria-hidden>
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

/**
 * /about: why we built it, what we will not bend on, who it serves, how it pays (labelled hypotheses), the road so far
 * (done vs planned, never blurred), the team, and an invitation to pilot. Visual first: icons, a seal, a drawn timeline.
 */
export default function AboutPage() {
  const { t } = useI18n();
  return (
    <>
      {/* hero */}
      <section className="wrap grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.2fr_1fr] lg:pb-24 lg:pt-24" aria-labelledby="about-title">
        <div>
          <p className="eyebrow hero-rise">{t('about.eyebrow')}</p>
          <h1 id="about-title" className="t-hero hero-rise mt-5 max-w-[15ch]" style={{ ['--i' as string]: 1 }}>
            {t('about.title')}
          </h1>
          <p className="t-lead hero-rise mt-6 max-w-[42ch]" style={{ ['--i' as string]: 2 }}>
            {t('about.lead')}
          </p>
        </div>
        <Seal />
      </section>

      {/* why */}
      <section className="band-night" aria-labelledby="why-title">
        <div className="wrap grid gap-10 py-20 md:py-28 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <p className="eyebrow m-0" data-reveal>
              {t('about.why.eyebrow')}
            </p>
            <h2 id="why-title" className="t-title m-0 mt-4" data-reveal style={{ ['--i' as string]: 1 }}>
              {t('about.why.title')}
            </h2>
          </div>
          <p className="t-lead m-0 max-w-[44ch]" data-reveal style={{ ['--i' as string]: 2 }}>
            {t('about.why.line')}
          </p>
        </div>
      </section>

      {/* principles */}
      <section className="section" aria-labelledby="principles-title">
        <div className="wrap">
          <SectionHead eyebrow={t('about.principles.eyebrow')} title={t('about.principles.title')} id="principles-title" />
          <ul className="m-0 mt-12 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map(({ key, icon: Icon }, i) => (
              <li key={key} className="panel flex flex-col p-6" data-reveal style={{ ['--i' as string]: i % 3 }}>
                <span className="grid size-11 place-items-center rounded-[10px] bg-sunk text-ink">
                  <Icon size={22} strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="m-0 mt-5 text-[1.2rem] font-semibold leading-snug">{t(key)}</h3>
                <p className="m-0 mt-2 text-[0.97rem] leading-snug text-ink-2">{t(`${key}.sub` as Key)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* who */}
      <section className="section border-t border-rule bg-sunk/40" aria-labelledby="who-title">
        <div className="wrap">
          <SectionHead eyebrow={t('about.who.eyebrow')} title={t('about.who.title')} id="who-title" />
          <ul className="m-0 mt-12 grid list-none gap-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {WHO.map(({ key, icon: Icon }, i) => (
              <li key={key} className="border-t-2 border-ink pt-5" data-reveal style={{ ['--i' as string]: i }}>
                <Icon size={26} strokeWidth={1.6} className="text-ink" aria-hidden />
                <h3 className="m-0 mt-4 text-[1.15rem] font-semibold">{t(key)}</h3>
                <p className="m-0 mt-2 text-[0.97rem] leading-snug text-ink-2">{t(`${key}.sub` as Key)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* how it pays */}
      <section className="section" aria-labelledby="money-title">
        <div className="wrap">
          <SectionHead eyebrow={t('about.money.eyebrow')} title={t('about.money.title')} id="money-title" />
          <ol className="money m-0 mt-12 grid list-none items-stretch gap-3 p-0 md:grid-cols-[1fr_auto_1fr_auto_1fr]" data-reveal>
            {(['about.money.s1', 'about.money.s2', 'about.money.s3'] as Key[]).map((k, i) => (
              <li key={k} className="contents">
                {i > 0 && (
                  <span className="money-arrow hidden items-center justify-center text-ink-3 md:flex" style={{ ['--k' as string]: i }} aria-hidden>
                    <ArrowRight size={22} />
                  </span>
                )}
                <div className={cx('money-step rounded-[var(--radius-ui)] border p-6', i === 0 ? 'border-go bg-go-wash' : 'border-rule bg-card')} style={{ ['--k' as string]: i }}>
                  <p className="mono m-0 text-xs text-ink-3">{`0${i + 1}`}</p>
                  <p className="m-0 mt-3 text-[1.25rem] font-semibold leading-tight">{t(k)}</p>
                  <p className={cx('m-0 mt-1.5 text-[0.97rem] leading-snug', i === 0 ? 'font-semibold text-go' : 'text-ink-2')}>{t(`${k}.sub` as Key)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-5 text-sm text-ink-3">{t('about.money.note')}</p>
        </div>
      </section>

      {/* timeline */}
      <section className="section border-t border-rule" aria-labelledby="time-title">
        <div className="wrap grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <SectionHead eyebrow={t('about.time.eyebrow')} title={t('about.time.title')} id="time-title" className="lg:sticky lg:top-[calc(var(--header-h)+40px)] lg:self-start" />
          <ol className="timeline relative m-0 list-none p-0">
            {TIMELINE.map(({ n, done }) => (
              <li key={n} className={cx('timeline-item relative grid grid-cols-[2.5rem_1fr] gap-4 pb-10 last:pb-0', done && 'is-done')} data-reveal>
                <span className={cx('relative z-10 mt-1 grid size-6 place-items-center rounded-full border-2', done ? 'border-ink bg-ink' : 'border-dashed border-ink-3 bg-paper')} aria-hidden>
                  {done && <span className="size-2 rounded-full bg-paper" />}
                </span>
                <div>
                  <p className="mono m-0 flex items-center gap-2 text-sm text-ink-3">
                    {t(`about.t${n}.date` as Key)}
                    <span className={cx('chip', done ? 'chip-go' : '')}>{done ? t('about.time.done') : t('about.time.plan')}</span>
                  </p>
                  <p className={cx('m-0 mt-2 text-[1.12rem] leading-snug', done ? 'text-ink' : 'text-ink-2')}>{t(`about.t${n}` as Key)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* team */}
      <section className="section border-t border-rule bg-sunk/40" aria-labelledby="team-title">
        <div className="wrap">
          <SectionHead eyebrow={t('about.team.eyebrow')} title={t('about.team.title')} lead={t('about.team.line')} id="team-title" />
          {TEAM.length > 0 && (
            <ul className="m-0 mt-12 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-5">
              {TEAM.map((m, i) => (
                <li key={m.name} className="panel p-5" data-reveal style={{ ['--i' as string]: i }}>
                  <span className="grid size-14 place-items-center rounded-full bg-ink text-[1.1rem] font-semibold text-paper" aria-hidden>
                    {m.initials}
                  </span>
                  <p className="m-0 mt-4 font-semibold">{m.name}</p>
                  <p className="m-0 mt-1 text-sm text-ink-3">{m.role}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* invitation */}
      <section className="band-night" aria-labelledby="cta-title">
        <div className="wrap py-20 md:py-28">
          <h2 id="cta-title" className="t-hero m-0 max-w-[14ch]" data-reveal>
            {t('about.cta.title')}
          </h2>
          <p className="t-lead mt-6 max-w-[46ch]" data-reveal style={{ ['--i' as string]: 1 }}>
            {t('about.cta.line')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3" data-reveal style={{ ['--i' as string]: 2 }}>
            <LinkButton to="/app" variant="primary" size="lg" arrow>
              {t('ui.cta.tryApp')}
            </LinkButton>
            <LinkButton to="/proof" variant="secondary" size="lg">
              {t('story.hood.more')}
            </LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}
