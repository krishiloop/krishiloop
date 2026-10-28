import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RotateCcw, ScanLine, ShieldAlert } from 'lucide-react';
import { TicketCard, type TicketStatus } from '../verify/TicketCard';
import { SAMPLE_RECEIPT_IDS } from '../verify/verifyUtil';
import { Reveal } from '../../components/ui/Reveal';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { fmtNum, fmtDate } from '../../lib/format';
import { recallRule, verifyReceipt } from '../../lib/api/client';
import { mockCredential, resetSampleRecalls, sampleRecalls } from '../../lib/api/mocks';
import { fetchStatusList } from '../../lib/api/statusList';
import { useMotionReduced } from '../../lib/motionPref';
import type { Receipt } from '../../lib/api/types';

/**
 * Beat 2 of the pitch, in the page: verify a receipt, withdraw its rule, watch it turn Recalled, see what people are told.
 * It uses the SAMPLE receipt and a simulated recall, so it works offline and never touches the live server.
 */
export function ProveDemo() {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const id = `urn:uuid:${SAMPLE_RECEIPT_IDS[0]}`;
  const receipt = useMemo(() => mockCredential(id)?.credentialSubject as Receipt | undefined, [id]);
  const recalls = sampleRecalls.use();
  const recalledNow = recalls.length > 0;
  const [phase, setPhase] = useState<'idle' | 'checking' | 'done'>('idle');
  const [withdrawn, setWithdrawn] = useState<number | null>(null);
  const [status, setStatus] = useState<TicketStatus>('idle');
  const [play, setPlay] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchStatusList().then((l) => alive && setWithdrawn(l ? l.withdrawn : null));
    return () => {
      alive = false;
    };
  }, []);

  const run = async (afterRecall = false) => {
    setPhase('checking');
    setPlay(false);
    if (!reduced) await new Promise((r) => setTimeout(r, afterRecall ? 700 : 1100));
    const r = await verifyReceipt(id);
    setStatus(r.status);
    setPhase('done');
    setPlay(true);
  };
  const recall = async () => {
    await recallRule('R-PLB-011', 1, { sample: true });
    await run(true);
  };
  const reset = () => {
    resetSampleRecalls();
    setStatus('idle');
    setPhase('idle');
    setPlay(false);
  };

  const shown: TicketStatus = phase === 'done' ? status : 'idle';
  return (
    <section id="prove" className="story-section prove" data-play={play}>
      <div className="story-wrap prove-grid">
        <Reveal className="prove-stage-wrap">
          <div className="prove-stage" data-status={shown}>
            <TicketCard status={shown} receipt={receipt ?? null} play={play} />
            {phase === 'checking' ? (
              <p className="prove-checking" role="status">
                <span className="spinner" aria-hidden /> {t('l.prove.checking')}
              </p>
            ) : null}
          </div>
        </Reveal>

        <Reveal delay={100}>
          <p className="eyebrow flex items-center gap-2">
            {t('l.prove.eyebrow')} <SampleBadge />
          </p>
          <h2 className="display story-title">{t('l.prove.title')}</h2>
          <p className="mt-4 max-w-[52ch] text-lg text-chrome">{t('l.prove.body')}</p>

          <div className="prove-actions">
            <button type="button" className="btn btn-sun" onClick={() => void run()} disabled={phase === 'checking'} data-testid="prove-verify">
              <ScanLine size={17} aria-hidden /> {t('l.prove.verify')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void recall()} disabled={phase === 'checking' || recalledNow} data-testid="prove-recall">
              <ShieldAlert size={17} aria-hidden /> {t('l.prove.recall')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={phase === 'checking'}>
              <RotateCcw size={16} aria-hidden /> {t('l.prove.reset')}
            </button>
          </div>

          <p className="prove-state" aria-live="polite" data-testid="prove-state" data-status={shown}>
            {shown === 'idle' ? t('l.prove.idle') : shown === 'authentic' ? `${t('verify.authentic')}. ${t('verify.authentic.line')}` : shown === 'recalled' ? `${t('verify.recalled')}. ${t('verify.recalled.line')}` : t('verify.invalid')}
          </p>
          {shown === 'recalled' && receipt ? (
            <p className="prove-sms">
              <span className="eyebrow">{t('verify.notif.farmer')}</span>
              {t('verify.notif.sms', { date: fmtDate(receipt.created_at, lang, 'short') })}
            </p>
          ) : null}

          <div className="prove-foot">
            {withdrawn !== null ? (
              <span className="chip" data-tone="go" title={t('l.prove.list')}>
                <span className="size-1.5 rounded-full bg-go" aria-hidden /> {t('data.live')} · {fmtNum(withdrawn, lang)}
              </span>
            ) : null}
            <Link to={`/verify/${SAMPLE_RECEIPT_IDS[0]}`} className="link inline-flex items-center gap-1.5">
              {t('l.prove.live')} <ArrowRight size={15} aria-hidden />
            </Link>
          </div>

          <p className="prove-trust" data-testid="prove-trust">
            <span>{t('l.prove.trust')}</span>
            <Link to="/trust" className="link inline-flex items-center gap-1.5" data-testid="prove-trust-link">
              {t('l.prove.trust.link')} <ArrowRight size={15} aria-hidden />
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
