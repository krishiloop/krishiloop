import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, Inbox, LockOpen, Lock, RefreshCw, ServerOff, WifiOff } from 'lucide-react';
import { AreaMeter } from './AreaMeter';
import { PHOTO_DEMO } from './labels';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { apiStore, useSessionId } from '../../lib/api/client';
import { knownCredential, loadAreaStats, photoErrorKind, useAreaStats } from '../../lib/api/trust';
import { cx } from '../../lib/cx';

type State = 'idle' | 'loading' | 'ready' | 'unavailable' | 'offline';

/**
 * The live meter for this demo session's area: the same gate as the replay, on photos the visitor sends as the farmer and
 * answers as the officer. Nothing is asked of the server until the tab has a session (the page never creates one by
 * itself). No photo model on the server (503) is said calmly, and the replay above still works.
 */
export function LiveArea({ area }: { area: string }) {
  const { t, lang } = useI18n();
  const sid = useSessionId();
  const forced = apiStore.use().forced;
  const stats = useAreaStats(area);
  const [state, setState] = useState<State>('idle');

  const load = useCallback(async () => {
    setState('loading');
    try {
      await loadAreaStats(area);
      setState('ready');
    } catch (e) {
      setState(photoErrorKind(e) === 'unavailable' ? 'unavailable' : 'offline');
    }
  }, [area]);

  useEffect(() => {
    if (sid && !forced) void load();
  }, [sid, forced, load]);

  const cred = stats?.trust_credential_id ?? knownCredential(area);
  const events = [...(stats?.events ?? [])].reverse();
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let body: ReactNode;
  if (forced) body = <Notice icon={<ServerOff size={20} aria-hidden />} text={t('trust.live.sample')} />;
  else if (!sid) body = <Notice icon={<Inbox size={20} aria-hidden />} text={t('trust.live.noSession')} testId="live-nosession" />;
  else if (state === 'unavailable') body = <Notice icon={<ServerOff size={20} aria-hidden />} text={t('trust.live.unavailable')} testId="live-unavailable" />;
  else if (state === 'offline') body = <Notice icon={<WifiOff size={20} aria-hidden />} text={t('trust.live.offline')} testId="live-offline" />;
  else if (state === 'loading' && !stats) body = <p className="tr-note m-0">{t('trust.live.loading')}</p>;
  else if (stats)
    body = (
      <>
        <AreaMeter area={area} stats={stats} />
        <div className="tr-events" data-testid="live-events">
          <h3 className="eyebrow">{t('trust.live.events')}</h3>
          {events.length === 0 ? (
            <p className="m-0 text-sm text-chrome">{t('trust.live.events.none')}</p>
          ) : (
            <ol className="tr-event-list">
              {events.map((e, i) => (
                <li key={`${e.at}-${i}`} data-event={e.event}>
                  {e.event === 'opened' ? <LockOpen size={14} className="text-go" aria-hidden /> : <Lock size={14} className="text-stop" aria-hidden />}
                  <span>
                    {t(e.event === 'opened' ? 'trust.live.event.opened' : 'trust.live.event.closed', { n: fmtNum(e.verdicts, lang), lb: two(e.lower_bound) })}
                    <small className="tabular"> · {fmtDate(e.at, lang, 'datetime')}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {cred ? (
            <Link to={`/verify/${encodeURIComponent(cred)}`} className="link inline-flex items-center gap-1.5 text-sm" data-testid="live-verify">
              {t('trust.meter.credential')} <ArrowRight size={13} aria-hidden />
            </Link>
          ) : null}
        </div>
      </>
    );
  else body = null;

  return (
    <section className="surface surface-pad tr-live" aria-labelledby="tr-live-t" data-testid="live-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tr-live-t" className="tr-h">
          {t('trust.live.title')}
        </h2>
        {sid && !forced ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()} disabled={state === 'loading'} data-testid="live-refresh">
            <RefreshCw size={14} aria-hidden className={cx(state === 'loading' && 'animate-spin')} /> {t('trust.live.refresh')}
          </button>
        ) : null}
      </div>
      <p className="m-0 mt-2 text-sm text-chrome">{t('trust.live.lead')}</p>
      <div className="mt-4">{body}</div>
      <div className="tr-ctas">
        <Link to={`/app?field=${PHOTO_DEMO.field}&profile=${PHOTO_DEMO.profile}#photo`} className="btn btn-ghost btn-sm" data-testid="live-farmer-link">
          <Camera size={15} aria-hidden /> {t('trust.live.farmer')}
        </Link>
        <Link to="/officer" className="btn btn-ghost btn-sm">
          <Inbox size={15} aria-hidden /> {t('trust.live.officer')}
        </Link>
      </div>
    </section>
  );
}

function Notice({ icon, text, testId }: { icon: ReactNode; text: string; testId?: string }) {
  return (
    <div className="tr-notice" data-testid={testId}>
      {icon}
      <p className="m-0">{text}</p>
    </div>
  );
}
