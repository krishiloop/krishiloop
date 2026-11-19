import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpenCheck, CloudRain, FileSignature, Pause, Play, ShieldCheck, Undo2 } from 'lucide-react';
import { useI18n, type Key, type Lang } from '../../lib/i18n';
import { fmtDate, pickText, shortId } from '../../lib/format';
import { cx } from '../../lib/cx';
import { useMotionReduced } from '../../lib/motionPref';
import { Stamp } from '../../ui/Stamp';
import { DataMark } from '../../ui/DataMark';
import { WeatherStrip } from '../../ui/WeatherStrip';
import { RECORDED_AT } from '../../data/recorded';
import { STORY } from '../story/storyData';

const STEPS = ['data', 'rule', 'sign', 'check', 'recall'] as const;
type Step = (typeof STEPS)[number];
const TONE: Record<Step, string> = { data: 'monsoon', rule: 'moss', sign: 'butter', check: 'hyacinth', recall: 'terracotta' };
const ICON: Record<Step, ReactNode> = {
  data: <CloudRain size={18} aria-hidden />,
  rule: <BookOpenCheck size={18} aria-hidden />,
  sign: <FileSignature size={18} aria-hidden />,
  check: <ShieldCheck size={18} aria-hidden />,
  recall: <Undo2 size={18} aria-hidden />,
};
/** how long each step holds when the walk-through plays by itself */
const HOLD_MS = 5200;

/**
 * How a receipt works, as a walk-through you can play or step through: field data, then the rule, then the signed
 * receipt, then anyone's check, then a recall. Every picture is the recorded "no spray needed" receipt of the story
 * (its real forecast, rule, id and verdicts), labelled as recorded. It plays by itself while on screen (not with
 * reduced motion), stops when you take over, and each step slides in from the side it came from (transform, opacity).
 */
export function Walkthrough() {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [playing, setPlaying] = useState(!reduced);
  const [seen, setSeen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const step = STEPS[i]!;

  useEffect(() => setPlaying((p) => p && !reduced), [reduced]);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setSeen(!!e?.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !seen) return;
    const id = window.setTimeout(() => {
      setDir(1);
      setI((n) => (n + 1) % STEPS.length);
    }, HOLD_MS);
    return () => window.clearTimeout(id);
  }, [playing, seen, i]);

  const go = (n: number) => {
    setPlaying(false);
    setDir(n >= i ? 1 : -1);
    setI((n + STEPS.length) % STEPS.length);
  };

  return (
    <section ref={root} className="rw" aria-labelledby="rw-title" data-testid="walkthrough">
      <div className="wrap section">
        <div className="rw-head">
          <div>
            <p className="eyebrow">{t('rw.eyebrow')}</p>
            <h2 id="rw-title" className="t-title mt-3 max-w-[20ch]">
              {t('rw.title')}
            </h2>
          </div>
          <DataMark kind="recorded" date={RECORDED_AT} />
        </div>

        <ol className="rw-steps" aria-label={t('rw.stepsLabel')}>
          {STEPS.map((s, n) => (
            <li key={s}>
              <button
                type="button"
                className={cx('rw-step', n === i && 'is-on', n < i && 'is-past')}
                data-tone={TONE[s]}
                aria-current={n === i ? 'step' : undefined}
                onClick={() => go(n)}
                data-testid={`rw-step-${s}`}
              >
                <span className="rw-step-n" aria-hidden>
                  {n + 1}
                </span>
                <span className="rw-step-t">{t(`rw.${s}.name` as Key)}</span>
                {n === i && playing && seen && <span className="rw-step-bar" aria-hidden key={`bar-${i}`} style={{ animationDuration: `${HOLD_MS}ms` }} />}
              </button>
            </li>
          ))}
        </ol>

        <div className="rw-stage" data-tone={TONE[step]}>
          <div className="rw-copy" key={`c-${step}`} data-dir={dir} aria-live="polite">
            <p className="rw-kicker">
              <span className="rw-ic">{ICON[step]}</span>
              {t('rw.stepOf', { n: i + 1, total: STEPS.length })}
            </p>
            <h3 className="rw-h">{t(`rw.${step}.title` as Key)}</h3>
            <p className="rw-p">{t(`rw.${step}.body` as Key)}</p>
            <div className="rw-nav">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(i - 1)} aria-label={t('rw.back')}>
                <ArrowLeft size={16} aria-hidden />
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(i + 1)} data-testid="rw-next">
                {t('rw.next')}
                <ArrowRight size={16} aria-hidden />
              </button>
              {!reduced && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
                  {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
                  {playing ? t('rw.pause') : t('rw.play')}
                </button>
              )}
            </div>
          </div>
          <div className="rw-art" key={`a-${step}`} data-dir={dir}>
            <Picture step={step} lang={lang} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The real thing for each step, from the recorded story receipt. */
function Picture({ step, lang }: { step: Step; lang: Lang }) {
  const { t } = useI18n();
  const { action, plan } = STORY.calm;
  const snap = STORY.snapshot;
  const rule = action.receipt.rule_refs[0]!;
  const ruleLabel = `${rule.rule_id} v${rule.version}`;
  const advice = pickText(action.title, lang);
  const id = action.receipt_credential_id ?? '';
  const verifyHref = `/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`;
  switch (step) {
    case 'data':
      return (
        <div className="rw-card">
          <p className="rw-card-k">
            {t('rw.data.field')} <span className="mono">{plan.field_id}</span> · {plan.crop}
          </p>
          <WeatherStrip days={(snap.forecast?.days ?? []).slice(0, 4)} today={snap.forecast?.days[0]?.date} className="mt-3" />
          <p className="m-0 mt-3 text-xs text-ink-3">{t('rw.data.source')}</p>
        </div>
      );
    case 'rule':
      return (
        <div className="rw-card paper-object">
          <p className="rw-card-k">
            <span className="mono font-semibold text-ink">{ruleLabel}</span>
          </p>
          <p className="m-0 mt-3 text-[1.05rem] font-semibold leading-snug" lang={advice.lang}>
            “{advice.text}”
          </p>
          <p className="m-0 mt-3 text-sm text-ink-2">{t('rw.rule.from')}</p>
        </div>
      );
    case 'sign':
      return (
        <div className="rw-card paper-object rw-receipt">
          <p className="rw-card-k">{t('rw.sign.paper')}</p>
          <p className="m-0 mt-2 font-semibold leading-snug" lang={advice.lang}>
            {advice.text}
          </p>
          <dl className="rw-kv">
            <dt>{t('rw.sign.rule')}</dt>
            <dd className="mono">{ruleLabel}</dd>
            <dt>{t('rw.sign.week')}</dt>
            <dd>
              {fmtDate(plan.valid_from, lang)} – {fmtDate(plan.valid_to, lang)}
            </dd>
            <dt>№</dt>
            <dd className="mono">…{shortId(id, 10)}</dd>
          </dl>
          <span className="rw-seal" aria-hidden>
            <FileSignature size={20} />
          </span>
        </div>
      );
    case 'check':
      return (
        <div className="rw-card rw-center">
          <Stamp kind="authentic" size="lg" land />
          <p className="m-0 mt-4 text-sm text-ink-2">{t('rw.check.line')}</p>
          <Link className="link mt-2 inline-block text-sm" to={verifyHref}>
            {t('rw.check.try')}
          </Link>
        </div>
      );
    default:
      return (
        <div className="rw-card rw-center">
          <p className="m-0 mono text-sm text-stop line-through decoration-2">{ruleLabel}</p>
          <div className="mt-3">
            <Stamp kind="recalled" size="lg" land />
          </div>
          <p className="m-0 mt-4 text-sm text-ink-2">{t('rw.recall.line')}</p>
          <Link className="link mt-2 inline-block text-sm" to="/officer?tab=recall">
            {t('rw.recall.try')}
          </Link>
        </div>
      );
  }
}
