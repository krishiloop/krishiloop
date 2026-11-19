import { PlantSpot } from '../../ui/PlantSpot';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, Inbox, Lock, LockOpen, RefreshCw, ServerOff, WifiOff } from 'lucide-react';
import { LinkButton } from '../../ui/Button';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { apiStore, useSessionId } from '../../lib/api/client';
import { knownCredential, loadAreaStats, photoErrorKind, useAreaStats } from '../../lib/api/trust';
import { AreaMeter } from './AreaMeter';
import { PHOTO_DEMO } from './labels';

type State = 'idle' | 'loading' | 'ready' | 'unavailable' | 'offline';

/**
 * This visitor's own area meter: the same gate as the replay, on photos they send as the farmer and answer as the officer,
 * inside their demo sandbox. Nothing is asked of the server until the tab has a sandbox (the page never makes one by
 * itself). Every empty state says why it is empty, and what to do next.
 */
export function SandboxMeter() {
  const { t, lang } = useI18n();
  const area = PHOTO_DEMO.area;
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
  if (forced) body = <Notice icon={<ServerOff size={20} aria-hidden />} text={t('tp.sb.sample')} testId="sb-sample" />;
  else if (!sid) body = <Notice icon={<Inbox size={20} aria-hidden />} text={t('tp.sb.none')} testId="sb-none" />;
  else if (state === 'unavailable') body = <Notice icon={<ServerOff size={20} aria-hidden />} text={t('tp.sb.unavailable')} testId="sb-unavailable" />;
  else if (state === 'offline') body = <Notice icon={<WifiOff size={20} aria-hidden />} text={t('tp.sb.offline')} testId="sb-offline" />;
  else if (!stats) body = <AreaMeter area={area} stats={null} />;
  else
    body = (
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:gap-10">
        <AreaMeter area={area} stats={stats} />
        <div data-testid="sb-events">
          <h3 className="eyebrow">{t('tp.sb.events')}</h3>
          {events.length === 0 ? (
            <p className="m-0 mt-2 text-[0.92rem] text-ink-2">{t('tp.sb.noEvents')}</p>
          ) : (
            <ol className="m-0 mt-2 grid list-none gap-2 p-0">
              {events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex items-start gap-2 text-[0.92rem]">
                  {e.event === 'opened' ? <LockOpen size={16} className="mt-1 shrink-0 text-go" aria-hidden /> : <Lock size={16} className="mt-1 shrink-0 text-stop" aria-hidden />}
                  <span>
                    {t(e.event === 'opened' ? 'tp.sb.event.opened' : 'tp.sb.event.closed', { n: fmtNum(e.verdicts, lang), lb: two(e.lower_bound) })}
                    <span className="mono block text-[0.75rem] text-ink-3">{fmtDate(e.at, lang, 'datetime')}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {cred ? (
            <Link to={`/verify/${encodeURIComponent(cred)}`} className="link mt-3 inline-flex min-h-11 items-center gap-1.5 text-[0.92rem]" data-testid="sb-verify">
              {t('tp.sb.credential')} <ArrowRight size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    );

  return (
    <div data-testid="sandbox">
      <div aria-live="polite">{body}</div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <LinkButton to={`/app?field=${PHOTO_DEMO.field}&profile=${PHOTO_DEMO.profile}#photo`} variant="primary" data-testid="sb-farmer">
          <Camera size={17} aria-hidden /> {t('tp.sb.send')}
        </LinkButton>
        <LinkButton to="/officer" variant="secondary" data-testid="sb-officer">
          <Inbox size={17} aria-hidden /> {t('tp.sb.answer')}
        </LinkButton>
        {sid && !forced ? (
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={state === 'loading'} data-testid="sb-refresh">
            <RefreshCw size={16} aria-hidden /> {t('tp.sb.refresh')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Notice({ icon, text, testId }: { icon: ReactNode; text: string; testId?: string }) {
  return (
    <div className="tp-notice" data-testid={testId}>
      <PlantSpot name="tomato" size={40} className="shrink-0" />
      <span className="mt-0.5 shrink-0 text-ink-3">{icon}</span>
      <p className="m-0">{text}</p>
    </div>
  );
}
