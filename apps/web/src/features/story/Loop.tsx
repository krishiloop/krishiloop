import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { pickText } from '../../lib/format';
import { LinkButton } from '../../ui/Button';
import { WeatherStrip } from '../../ui/WeatherStrip';
import { DataAsOf } from '../../ui/DataAsOf';
import { Quote } from '../../ui/Quote';
import { ReceiptCard } from '../../ui/Receipt';
import { Stamp } from '../../ui/Stamp';
import { STORY } from './storyData';
import { SectionHead } from './parts';

const STEPS = ['see', 'decide', 'speak', 'prove', 'learn'] as const;
type Step = (typeof STEPS)[number];
const TRY: Record<Step, string> = {
  see: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d',
  decide: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d',
  speak: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d&tab=ask',
  prove: `/verify/${encodeURIComponent((STORY.calm.action.receipt_credential_id ?? '').replace(/^urn:uuid:/, ''))}`,
  learn: '/officer?tab=recall',
};

/* ------------------------------------------------------------------ the dial: the brand is the method */
const R = 108;
const C = 2 * Math.PI * R;
function Dial({ active }: { active: number }) {
  const { t } = useI18n();
  const angle = (i: number) => -90 + i * 72;
  const at = (i: number) => {
    const a = (angle(i) * Math.PI) / 180;
    return { x: 140 + R * Math.cos(a), y: 140 + R * Math.sin(a) };
  };
  return (
    <svg viewBox="-44 -26 368 332" className="mx-auto block w-[min(100%,340px)] [@media(max-height:860px)]:w-[270px]" aria-hidden>
      <circle cx="140" cy="140" r={R} fill="none" stroke="var(--color-rule)" strokeWidth="2" />
      {/* progress: how far round the loop this step is */}
      <circle
        cx="140"
        cy="140"
        r={R}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - (active + 1) / STEPS.length)}
        transform="rotate(-90 140 140)"
        className="loop-progress"
      />
      {/* a marker that travels to the active step */}
      <g className="loop-marker" style={{ transform: `rotate(${active * 72}deg)` }}>
        <circle cx="140" cy={140 - R} r="15" fill="var(--color-ink)" />
      </g>
      {STEPS.map((s, i) => {
        const p = at(i);
        const on = i === active;
        const lx = 140 + (R + 34) * Math.cos((angle(i) * Math.PI) / 180);
        const ly = 140 + (R + 34) * Math.sin((angle(i) * Math.PI) / 180);
        return (
          <g key={s}>
            <circle cx={p.x} cy={p.y} r={on ? 0 : 6} fill="var(--color-paper)" stroke={i < active ? 'var(--color-ink)' : 'var(--color-rule-2)'} strokeWidth="2" />
            <text x={on ? p.x : lx} y={on ? p.y + 4.5 : ly + 4.5} textAnchor="middle" className={cx('loop-label', on && 'is-on')} fill={on ? 'var(--color-paper)' : 'var(--color-ink-3)'} fontSize={on ? 11 : 13} fontWeight={on ? 700 : 500}>
              {on ? String(i + 1) : t(`story.loop.${s}` as Key)}
            </text>
          </g>
        );
      })}
      <text x="140" y="134" textAnchor="middle" fill="var(--color-ink)" fontSize="26" fontWeight="680" style={{ fontStretch: '82%' }}>
        {t(`story.loop.${STEPS[active]!}` as Key)}
      </text>
      <text x="140" y="158" textAnchor="middle" fill="var(--color-ink-3)" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="1.5">
        {`0${active + 1} / 05`}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ the real artifact for each step */
function Artifact({ step }: { step: Step }) {
  const { t, lang } = useI18n();
  const snap = STORY.snapshot;
  const advice = pickText(STORY.calm.action.title, lang);
  const rule = STORY.calm.action.receipt.rule_refs[0]!;
  const ruleLabel = `${rule.rule_id} v${rule.version}`;
  const ask = STORY.asks.find((a) => a.lang === 'bn' && a.status === 'ok') ?? STORY.asks[0]!;
  switch (step) {
    case 'see':
      return (
        <div className="panel p-5">
          <DataAsOf mode="live" asOf={snap.forecast?.issued_at ?? snap.created_at} source="Open-Meteo" />
          <WeatherStrip days={snap.forecast?.days ?? []} today={snap.forecast?.days[0]?.date} className="mt-4" />
          <p className="m-0 mt-4 text-xs text-ink-3">{t('ui.wx.basis')}</p>
        </div>
      );
    case 'decide':
      return (
        <div className="paper-object">
          <div className="paper p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="mono text-sm font-semibold">{ruleLabel}</span>
              <span className="chip">{t('ui.review.pending')}</span>
            </div>
            {/* code-like in Latin scripts; Bangla and Hindi words keep the sans (mono fonts have no Bengali or Devanagari) */}
            <dl className={cx('mt-4 grid grid-cols-[3.2rem_1fr] gap-x-3 gap-y-2 leading-snug', lang === 'en' || lang === 'sw' ? 'mono text-[0.82rem]' : 'text-[0.95rem]')}>
              <dt className="text-ink-3">{t('story.loop.when')}</dt>
              <dd className="m-0">{t('story.loop.stage')}</dd>
              <dt className="text-ink-3">{t('story.loop.and')}</dt>
              <dd className="m-0">
                {t('story.loop.females')} <span className="text-wait">⚑</span>
              </dd>
              <dt className="text-ink-3">{t('story.loop.and')}</dt>
              <dd className="m-0">
                {t('story.loop.nymphs')} <span className="text-wait">⚑</span>
              </dd>
              <dt className="text-ink-3">{t('story.loop.then')}</dt>
              <dd lang={advice.lang} className="m-0 font-sans text-[0.95rem] font-semibold leading-snug">
                “{advice.text}”
              </dd>
            </dl>
            <p className="m-0 mt-2 text-xs text-wait">⚑ {t('story.loop.setBy')}</p>
            <Quote source={STORY.calm.action.receipt.sources[0]!} lines={3} className="mt-4 border-l-2 border-rule-2 pl-4" />
          </div>
        </div>
      );
    case 'speak':
      return (
        <div className="panel space-y-3 p-5">
          <div className="ml-auto flex max-w-[88%] items-start gap-2 rounded-[16px] rounded-br-[4px] bg-ink px-4 py-3 text-paper">
            <Mic size={16} className="mt-1 flex-none opacity-80" aria-hidden />
            <span lang="bn" className="text-[1.02rem] leading-snug">
              {ask.question}
            </span>
          </div>
          <p className="m-0 text-right text-xs text-ink-3">{t('story.loop.asked')}</p>
          <div className="max-w-[92%] rounded-[16px] rounded-bl-[4px] border border-rule bg-card px-4 py-3">
            <p lang={ask.lang} className="m-0 text-[1.02rem] leading-snug">
              {ask.text}
            </p>
            <p className="mono m-0 mt-2 text-xs text-go">{t('story.loop.answer', { rule: `${ask.rule_id} v1` })}</p>
          </div>
          <ol className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="LangGraph">
            {ask.path.map((p, i) => (
              <li key={`${p}-${i}`} className={cx('mono rounded-[5px] border px-1.5 py-0.5 text-[0.66rem]', p.endsWith(':skipped') ? 'border-dashed border-rule text-ink-3 line-through' : 'border-rule-2 text-ink-2')}>
                {p.replace(':skipped', '').replace('retrieve_', '')}
              </li>
            ))}
          </ol>
        </div>
      );
    case 'prove':
      return <ReceiptCard receipt={STORY.calm.action.receipt} credentialId={STORY.calm.action.receipt_credential_id} status="authentic" compact />;
    case 'learn':
      return (
        <div className="panel relative overflow-hidden p-5">
          <p className="mono m-0 text-sm">
            <span className="text-stop line-through decoration-2">{ruleLabel}</span> <span className="text-ink-3">· {STORY.recalled_verdict.reason}</span>
          </p>
          <div className="mt-5 flex items-center gap-5">
            <Stamp kind="recalled" size="lg" />
          </div>
          <p className="m-0 mt-5 max-w-[40ch] text-[0.98rem] leading-snug text-ink-2">{t('story.loop.after')}</p>
          <p className="m-0 mt-3 border-t border-rule pt-3 text-sm text-ink-3">{t('story.loop.trust')}</p>
        </div>
      );
  }
}

function StepText({ step, index, children }: { step: Step; index: number; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <p className="mono m-0 text-sm text-ink-3">{`0${index + 1}`}</p>
      <h3 className="t-title m-0 mt-2">{t(`story.loop.${step}` as Key)}</h3>
      <p className="t-lead m-0 mt-4 max-w-[34ch]">{t(`story.loop.${step}.line` as Key)}</p>
      <LinkButton to={TRY[step]} variant="secondary" size="sm" arrow className="mt-6 self-start">
        {t('story.loop.try')}
      </LinkButton>
      {children}
    </>
  );
}

/**
 * How it works, as a loop (the brand is the method): on wide screens a sticky stage holds the dial and the REAL artifact
 * of the step in view (weather snapshot, rule as code with its quote, a Bangla Ask, the receipt, the recall); the steps
 * scroll past beside it. The active step comes from an IntersectionObserver band, never a scroll handler.
 * On phones each step shows its artifact inline.
 */
export function Loop() {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: '-48% 0px -48% 0px' },
    );
    items.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section className="section" aria-labelledby="loop-title">
      <div className="wrap">
        <SectionHead eyebrow={t('story.loop.eyebrow')} title={t('story.loop.title')} id="loop-title" />
        <div className="mt-12 grid gap-12 lg:mt-4 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <ol className="m-0 list-none p-0">
            {STEPS.map((s, i) => (
              <li
                key={s}
                ref={(el) => {
                  items.current[i] = el;
                }}
                data-step={i}
                className={cx(
                  'loop-step flex flex-col justify-center border-t border-rule py-10 lg:border-t-0 lg:py-0',
                  i === STEPS.length - 1 ? 'lg:min-h-[56vh]' : 'lg:min-h-[74vh]',
                  i === active && 'is-active',
                )}
              >
                <StepText step={s} index={i}>
                  <div className="mt-8 lg:hidden">
                    <Artifact step={s} />
                  </div>
                </StepText>
              </li>
            ))}
          </ol>
          <div className="hidden lg:block">
            <div className="sticky top-[calc(var(--header-h)+28px)] flex h-[calc(100dvh-var(--header-h)-56px)] flex-col justify-center gap-6">
              <Dial active={active} />
              <div className="grid">
                {STEPS.map((s, i) => (
                  <div key={s} aria-hidden={i !== active} className={cx('loop-artifact [grid-area:1/1]', i === active && 'is-on')}>
                    <Artifact step={s} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
