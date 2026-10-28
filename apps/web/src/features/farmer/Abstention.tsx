import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { registerCase } from '../officer/inboxStore';
import { ArrowRight, Hand, Phone } from 'lucide-react';
import { SampleBadge } from '../../components/ui/Badges';
import { DataAsOf } from './DataAsOf';
import { useI18n, type Key } from '../../lib/i18n';
import { pickText } from '../../lib/format';
import type { DataSource, DemoField, Plan } from '../../lib/api/types';

/**
 * When the AI is not sure it does NOT guess: the case goes to the extension officer. This is the calm,
 * honest state: no red alarm, a clear hand-off, what happens next, and the helpline for Bangladeshi fields.
 * (16123 is the DAE Agriculture Call Centre, fact D5.)
 */
export function Abstention({ plan, field, source }: { plan: Plan; field: DemoField | undefined; source: DataSource | null }) {
  const { t, lang } = useI18n();
  const a = plan.abstention!;
  const reason = pickText(a.reason, lang);
  // the live API already made the case in this session's inbox: only a sample plan needs a local copy of it
  useEffect(() => {
    if (source === 'sample') registerCase(plan, `Demo farmer ${plan.farmer_profile_id.split('-').at(-1)!.toUpperCase()}`);
  }, [plan, source]);
  return (
    <section className="abstain surface" aria-labelledby="abstain-t" data-testid="abstention">
      <div className="abstain-body">
        <div className="abstain-visual" aria-hidden>
          <span className="abstain-ring" />
          <span className="abstain-ring r2" />
          <span className="abstain-core">
            <Hand size={34} strokeWidth={1.6} />
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow !text-chrome">{t('app.question')}</span>
            {source === 'sample' ? <SampleBadge /> : null}
          </div>
          <h2 id="abstain-t" className="display abstain-title">
            {t('abstain.title')}
          </h2>
          <p className="m-0 mt-2 text-chrome">{t('abstain.body')}</p>
          <p className="abstain-reason" lang={reason.lang} data-testid="abstain-reason">
            <span className="eyebrow block">{t('abstain.why')}</span>
            {reason.text}
          </p>
          {reason.fellBack ? (
            <p className="m-0 mt-2 text-sm text-chrome" data-testid="abstain-gloss">
              {t(`abstain.code.${a.reason_code}` as Key)}
            </p>
          ) : null}
          <p className="m-0 mt-3">
            <DataAsOf asOf={plan.data_as_of} mode={plan.data_mode} />
          </p>
          <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-dim">{t('abstain.case')}</span>
            <span className="chip chip-mono" data-testid="case-id">
              {a.inbox_item_id}
            </span>
          </p>
        </div>
      </div>
      <div className="abstain-next">
        <h3 className="eyebrow !text-chrome">{t('abstain.next')}</h3>
        <ol>
          <li>{t('abstain.step1')}</li>
          <li>{t('abstain.step2')}</li>
          <li>{t('abstain.step3')}</li>
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link to={`/officer/${encodeURIComponent(a.inbox_item_id)}`} className="btn btn-primary btn-sm">
            {t('abstain.openInbox')} <ArrowRight size={15} aria-hidden />
          </Link>
          {field?.country === 'BD' ? (
            <a href="tel:16123" className="btn btn-ghost btn-sm">
              <Phone size={15} aria-hidden /> {t('abstain.call')}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
