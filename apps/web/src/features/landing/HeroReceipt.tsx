import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ShieldAlert, WifiOff } from 'lucide-react';
import { TrafficLight } from '../farmer/TrafficLight';
import { signalOf } from '../farmer/Signal';
import { Qr } from '../farmer/Qr';
import { SampleBadge } from '../../components/ui/Badges';
import { ensureDemoPlan } from '../farmer/farmerStore';
import { useI18n } from '../../lib/i18n';
import { pickText, shortId } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { verifyReceipt, type VerifyOutcome } from '../../lib/api/client';
import type { Action, DataSource } from '../../lib/api/types';

/**
 * The hero's receipt: a REAL plan from the API (or the labelled sample) with its QR, verified in front of the visitor.
 * It lands after the scan sweeps the field: field -> decision -> receipt -> "Authentic".
 */
export function HeroReceipt() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<{ action: Action; source: DataSource } | null>(null);
  const [verdict, setVerdict] = useState<VerifyOutcome | null>(null);

  useEffect(() => {
    let alive = true;
    void ensureDemoPlan()
      .then((p) => {
        const a = p.data.actions?.find((x) => x.kind === 'input_decision') ?? p.data.actions?.[0];
        if (alive && a) setState({ action: a, source: p.source });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = state?.action.receipt_credential_id;
    if (!id) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void verifyReceipt(id).then((o) => alive && setVerdict(o));
    }, 1300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [state]);

  if (!state) return <div className="hero-card hero-card-skeleton" aria-hidden />;
  const { action, source } = state;
  const { light } = signalOf(action);
  const title = pickText(action.title, lang);
  const src = action.receipt.sources[0];
  const credId = action.receipt_credential_id;
  const status = verdict?.status;

  return (
    <aside className="hero-card" aria-label={t('receipt.title')} data-testid="hero-receipt">
      <div className="hero-card-top">
        <span className="hero-card-kicker">{source === 'live' ? t('l.hero.card.live') : t('l.hero.card.sample')}</span>
        {source === 'sample' ? <SampleBadge className="hero-card-sample" /> : <span className="hero-card-dot" aria-hidden />}
      </div>
      <div className="hero-card-body">
        <TrafficLight light={light} size="sm" label={t(`light.${light}` as 'light.green')} />
        <div className="min-w-0">
          <p className="hero-card-title" lang={title.lang}>
            {title.text}
          </p>
          {src ? (
            <p className="hero-card-quote">
              “{src.quote.length > 92 ? `${src.quote.slice(0, 90)}…` : src.quote}”
              <span className="hero-card-cite">
                {src.publisher} · {t('common.page', { n: src.page })}
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="hero-card-foot">
        {credId ? <Qr value={verifyUrl(credId)} size={64} label={t('receipt.qrAlt')} className="hero-card-qr" /> : null}
        <div className="min-w-0 flex-1" aria-live="polite">
          {status === 'authentic' ? (
            <p className="hero-card-status" data-s="ok">
              <Check size={15} strokeWidth={3} aria-hidden /> {t('l.hero.card.authentic')}
              <span>{t('l.hero.card.authenticSub')}</span>
            </p>
          ) : status === 'recalled' ? (
            <p className="hero-card-status" data-s="bad">
              <ShieldAlert size={15} aria-hidden /> {t('verify.recalled')}
              <span>{t('verify.recalled.line')}</span>
            </p>
          ) : status === 'unreachable' || status === 'invalid' ? (
            <p className="hero-card-status" data-s="warn">
              <WifiOff size={15} aria-hidden /> {t('l.hero.card.unreachable')}
            </p>
          ) : (
            <p className="hero-card-status" data-s="wait">
              <span className="spinner" aria-hidden /> {t('l.hero.card.verifying')}
            </p>
          )}
          {credId ? (
            <Link to={`/verify/${encodeURIComponent(credId.replace(/^urn:uuid:/, ''))}`} className="hero-card-link">
              {t('l.hero.card.open')} <ArrowRight size={13} aria-hidden /> <span className="mono">…{shortId(credId, 6)}</span>
            </Link>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
