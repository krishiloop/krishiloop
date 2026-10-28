import { Check, Minus, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { requiredRight, type Policy } from './policy';
import { blob } from '../proof/sources';

const POLICY_URL = blob('rules/policy/photo-trust.yaml');

/**
 * The photo-trust policy (rules/policy/photo-trust.yaml v1) as five numbers, the three tiers of what a photo answer may
 * do, and what "0.85" asks for in right answers (computed here with the same Wilson bound as the server, not typed in).
 */
export function PolicyBar({ policy, version }: { policy: Policy; version: number }) {
  const { t, lang } = useI18n();
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tiles = [
    { big: two(policy.sure), label: t('tp.policy.sure') },
    { big: `${fmtNum(policy.minSure, lang)}/${fmtNum(policy.window, lang)}`, label: t('tp.policy.window', { window: fmtNum(policy.window, lang) }) },
    { big: `≥ ${two(policy.openLb)}`, label: t('tp.policy.open') },
    { big: `< ${two(policy.closeLb)}`, label: t('tp.policy.close'), tone: 'text-stop' },
    { big: `${fmtNum(Math.round(policy.audit * 100), lang)}%`, label: t('tp.policy.audit') },
  ];
  const tiers = [
    { n: 0, what: t('tp.tier.0'), state: t('tp.tier.0.state'), icon: <Check size={16} aria-hidden />, tone: 'text-go' },
    { n: 1, what: t('tp.tier.1'), state: t('tp.tier.1.state'), icon: <Minus size={16} aria-hidden />, tone: 'text-wait' },
    { n: 2, what: t('tp.tier.2'), state: t('tp.tier.2.state'), icon: <X size={16} aria-hidden />, tone: 'text-stop' },
  ];
  const strict = [policy.minSure, 40, policy.window]
    .filter((n, i, all) => n >= policy.minSure && n <= policy.window && all.indexOf(n) === i)
    .map((n) => ({ n, k: requiredRight(n, policy.openLb) }))
    .filter((r): r is { n: number; k: number } => r.k !== null);

  return (
    <div>
      <div className="tp-tiles" data-testid="policy-tiles">
        {tiles.map((tile, i) => (
          <div key={i} className="tp-tile" data-reveal style={{ ['--i' as string]: i }}>
            <div className={`tp-big ${tile.tone ?? ''}`}>{tile.big}</div>
            <p className="m-0 mt-2 max-w-[24ch] text-[0.9rem] leading-snug text-ink-2">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
        <div>
          <h3 className="eyebrow">{t('tp.tier.title')}</h3>
          <ol className="m-0 mt-3 list-none p-0" data-testid="tiers">
            {tiers.map((tier) => (
              <li key={tier.n} className="tp-tier">
                <span className="mono text-[0.8rem] text-ink-3">{t('tp.tier.n', { n: tier.n })}</span>
                <span className="font-medium">{tier.what}</span>
                <span className={`col-start-2 inline-flex items-center gap-1.5 text-[0.88rem] font-semibold sm:col-start-auto ${tier.tone}`}>
                  {tier.icon}
                  {tier.state}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="eyebrow">{t('tp.strict.title', { bar: two(policy.openLb) })}</h3>
          <ul className="m-0 mt-4 grid list-none gap-4 p-0" data-testid="strictness">
            {strict.map(({ n, k }) => (
              <li key={n}>
                <p className="m-0 mb-1.5 text-[0.9rem]">
                  <b className="mono font-semibold">{t('tp.strict.row', { k: fmtNum(k, lang), n: fmtNum(n, lang) })}</b>
                  {n - k > 0 ? <span className="text-ink-3"> · {t('tp.strict.miss', { m: fmtNum(n - k, lang) })}</span> : <span className="text-ink-3"> · {t('tp.strict.none')}</span>}
                </p>
                <div className="tp-dots" aria-hidden>
                  {Array.from({ length: n }, (_, i) => (
                    <i key={i} data-miss={i >= k} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="m-0 mt-8 text-[0.85rem] text-ink-3">
        {t('tp.policy.note', { v: fmtNum(version, lang) })}{' '}
        <a className="link mono text-[0.8rem]" href={POLICY_URL} target="_blank" rel="noreferrer">
          rules/policy/photo-trust.yaml
        </a>
      </p>
    </div>
  );
}
