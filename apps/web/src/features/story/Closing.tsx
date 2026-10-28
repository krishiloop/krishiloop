import { ArrowRight, Check, CircleDashed, Database, FileCheck2, GitBranch, Scale, ShieldCheck, Workflow } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { verifyUrl } from '../../lib/qr';
import { LinkButton } from '../../ui/Button';
import { ReceiptCard } from '../../ui/Receipt';
import { Qr } from '../../ui/Qr';
import { DataMark } from '../../ui/DataMark';
import { RECORDED_AT } from '../../data/recorded';
import { STORY } from './storyData';
import { SectionHead } from './parts';

/* ------------------------------------------------------------------ one engine, two countries */
const DIFF_CMD = 'git diff --stat f90f5a0 c8a0fa2 -- services tools contracts';

/**
 * Global readiness shown, not claimed: the same engine signs a Bangla rice receipt and an English potato receipt, and
 * the real git command over the commit that added the Bangladesh pack prints nothing for engine code. The command
 * types itself once (clip-path steps), then the result appears.
 */
export function Engine() {
  const { t } = useI18n();
  return (
    <section id="engine" className="section cv border-t border-rule" aria-labelledby="engine-title">
      <div className="wrap">
        <SectionHead eyebrow={t('story.engine.eyebrow')} title={t('story.engine.title')} id="engine-title" />
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {[
            { d: STORY.calm, label: t('story.engine.bd'), n: 12 },
            { d: STORY.potato, label: t('story.engine.ke'), n: 11 },
          ].map(({ d, label, n }, i) => (
            <figure key={label} className="m-0" data-reveal style={{ ['--i' as string]: i }}>
              <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{label}</span>
                <span className="mono text-xs text-ink-3">
                  {t('story.engine.rules', { n })} · {t('story.engine.sample')}
                </span>
              </figcaption>
              <ReceiptCard receipt={d.action.receipt} compact mark={<DataMark kind="recorded" date={RECORDED_AT} />} />
            </figure>
          ))}
        </div>

        <div className="band-night mt-10 overflow-hidden rounded-[var(--radius-ui)] p-5 sm:p-7" data-reveal>
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-rule-2" />
            <span className="size-2.5 rounded-full bg-rule-2" />
            <span className="size-2.5 rounded-full bg-rule-2" />
          </div>
          {/* on a phone the command scrolls sideways, so the box takes keyboard focus too */}
          <p className="mono m-0 mt-4 overflow-x-auto whitespace-nowrap text-[0.86rem] text-ink-2" tabIndex={0} role="region" aria-label="git diff">

            <span className="text-go">$</span> <span className="type-cmd inline-block align-bottom" style={{ ['--chars' as string]: DIFF_CMD.length }}>{DIFF_CMD}</span>
          </p>
          <p className="type-out mono m-0 mt-3 text-[0.86rem] text-ink-3">(no output)</p>
          <p className="type-out m-0 mt-5 text-[1.25rem] font-semibold leading-snug text-ink [animation-delay:2.1s]">{t('story.engine.diff')}</p>
          <p className="type-out m-0 mt-2 text-sm text-ink-3 [animation-delay:2.3s]">{t('story.engine.limit')}</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ under the hood */
const HOOD: { key: Key; icon: typeof Database }[] = [
  { key: 'story.hood.s1', icon: Database },
  { key: 'story.hood.s2', icon: GitBranch },
  { key: 'story.hood.s3', icon: Workflow },
  { key: 'story.hood.s4', icon: Scale },
  { key: 'story.hood.s5', icon: FileCheck2 },
  { key: 'story.hood.s6', icon: ShieldCheck },
];

/** The pipeline in one row: each stage a node, each link draws itself in order (scaleX), once. Details live on /proof. */
export function Hood() {
  const { t } = useI18n();
  return (
    <section className="section cv bg-sunk/40" aria-labelledby="hood-title">
      <div className="wrap">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow={t('story.hood.eyebrow')} title={t('story.hood.title')} id="hood-title" />
          <LinkButton to="/proof" variant="secondary" arrow data-reveal>
            {t('story.hood.more')}
          </LinkButton>
        </div>
        <ol className="hood m-0 mt-12 grid list-none gap-3 p-0 sm:grid-cols-3 lg:grid-cols-6" data-reveal>
          {HOOD.map(({ key, icon: Icon }, i) => (
            <li key={key} className="hood-node relative rounded-[var(--radius-ui)] border border-rule bg-card p-4" style={{ ['--k' as string]: i }}>
              <Icon size={20} strokeWidth={1.75} className="text-ink-2" aria-hidden />
              <p className="m-0 mt-3 font-semibold leading-tight">{t(key)}</p>
              <p className="mono m-0 mt-1 text-xs text-ink-3">{t(`${key}.sub` as Key)}</p>
              {i < HOOD.length - 1 && <span className="hood-link hidden lg:block" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ honest status */
export function Status() {
  const { t } = useI18n();
  const now = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `story.status.now${n}` as Key);
  const next = [1, 2, 3, 4, 5, 6].map((n) => `story.status.next${n}` as Key);
  return (
    <section className="section cv" aria-labelledby="status-title">
      <div className="wrap">
        <SectionHead eyebrow={t('story.status.eyebrow')} title={t('story.status.title')} id="status-title" />
        <div className="mt-12 grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div data-reveal>
            <p className="eyebrow m-0 text-go">{t('story.status.now')}</p>
            <ul className="m-0 mt-4 list-none divide-y divide-rule border-y border-rule p-0">
              {now.map((k) => (
                <li key={k} className="flex items-start gap-3 py-3">
                  <Check size={18} strokeWidth={2.5} className="mt-0.5 flex-none text-go" aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
          <div data-reveal style={{ ['--i' as string]: 1 }}>
            <p className="eyebrow m-0">{t('story.status.next')}</p>
            <ul className="m-0 mt-4 list-none divide-y divide-rule border-y border-rule p-0 text-ink-2">
              {next.map((k) => (
                <li key={k} className="flex items-start gap-3 py-3">
                  <CircleDashed size={18} className="mt-0.5 flex-none text-ink-3" aria-hidden />
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

/* ------------------------------------------------------------------ the end: a real QR to scan */
export function EndCta() {
  const { t } = useI18n();
  const id = STORY.calm.action.receipt_credential_id ?? '';
  return (
    <section className="band-night" aria-labelledby="end-title">
      <div className="wrap grid items-center gap-10 py-20 md:grid-cols-[1fr_auto] md:py-28">
        <div>
          <h2 id="end-title" className="t-hero m-0" data-reveal>
            {t('story.end.title')}
          </h2>
          <p className="t-lead mt-6 max-w-[40ch]" data-reveal style={{ ['--i' as string]: 1 }}>
            {t('story.end.line')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3" data-reveal style={{ ['--i' as string]: 2 }}>
            <LinkButton to="/app" variant="primary" size="lg" arrow>
              {t('ui.cta.tryApp')}
            </LinkButton>
            <LinkButton to={`/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`} variant="secondary" size="lg">
              {t('ui.cta.verify')}
            </LinkButton>
          </div>
        </div>
        <div className="paper-object justify-self-start md:justify-self-end" data-reveal style={{ ['--i' as string]: 1 }}>
          <div className="paper rotate-[2deg] p-4">
            <Qr value={verifyUrl(id)} size={188} label={t('ui.receipt.verify')} />
            <p className="mono m-0 mt-3 flex items-center justify-between gap-3 text-xs text-ink-3">
              {t('ui.receipt.scan')} <ArrowRight size={14} aria-hidden />
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
