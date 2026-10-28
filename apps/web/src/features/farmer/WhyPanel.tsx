import { Database, Fingerprint, ListChecks, Package, UserRound } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, humanize, pickText } from '../../lib/format';
import type { PersonalizationFactor } from '../../lib/api/types';
import type { FieldSnapshot, Plan } from '../../lib/api/types';

/** The planner sends raw values like "crop_protected=False": show them as words a farmer can read. */
function factorValue(f: PersonalizationFactor, t: (k: Key) => string): string {
  const m = /^crop_protected=(true|false)$/i.exec(f.value);
  if (m) return m[1]!.toLowerCase() === 'true' ? t('app.protectedYes') : t('app.protectedNo');
  if (f.name === 'crop_protected' && /^(true|false)$/i.test(f.value)) return f.value.toLowerCase() === 'true' ? t('app.protectedYes') : t('app.protectedNo');
  return humanize(f.value);
}

/** "Why this plan for you": the personal facts that changed the plan, and the data and rules behind it. */
export function WhyPanel({ plan, snapshot }: { plan: Plan; snapshot: FieldSnapshot | null }) {
  const { t, lang } = useI18n();
  const factors = plan.personalization?.factors ?? [];
  const rules = [...new Map((plan.actions ?? []).flatMap((a) => a.receipt.rule_refs).map((r) => [`${r.rule_id}@${r.version}`, r])).values()];
  return (
    <section className="why surface surface-pad" aria-labelledby="why-t" data-testid="why-panel">
      <h2 id="why-t" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <UserRound size={18} className="text-sun" aria-hidden /> {t('why.title')}
      </h2>
      <p className="mt-1 mb-4 text-sm text-chrome">{t('why.lead')}</p>

      {factors.length ? (
        <ul className="why-list">
          {factors.map((f) => {
            const eff = pickText(f.effect, lang);
            return (
              <li key={f.name}>
                <div className="why-factor">
                  <span className="why-name">{t(`why.factor.${f.name}` as Key)}</span>
                  <span className="chip">{factorValue(f, t)}</span>
                </div>
                <p className="m-0 mt-1 text-sm text-chrome" lang={eff.lang}>
                  {eff.text}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-sm text-chrome">{t('why.empty')}</p>
      )}

      <div className="hairline mt-5 pt-4">
        <h3 className="eyebrow !text-chrome mb-3">{t('why.data')}</h3>
        <dl className="why-data">
          <div>
            <dt>
              <Database size={13} aria-hidden /> {t('why.snapshot')}
            </dt>
            <dd className="mono">{plan.snapshot_id}</dd>
          </div>
          <div>
            <dt>
              <Package size={13} aria-hidden /> {t('why.pack')}
            </dt>
            <dd className="mono">{plan.pack_id}</dd>
          </div>
          <div>
            <dt>
              <ListChecks size={13} aria-hidden /> {t('why.rules')}
            </dt>
            <dd className="flex flex-wrap gap-1.5">
              {rules.map((r) => (
                <span key={`${r.rule_id}${r.version}`} className="chip chip-mono">
                  {r.rule_id} v{r.version}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>
              <Fingerprint size={13} aria-hidden /> {t('why.generated')}
            </dt>
            <dd className="mono">{fmtDate(plan.generated_at, lang, 'datetime')}</dd>
          </div>
        </dl>
        {snapshot ? null : null}
      </div>
    </section>
  );
}
