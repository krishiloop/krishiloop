import { CalendarClock, Ban } from 'lucide-react';
import { ReceiptPass } from './ReceiptPass';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, pickText } from '../../lib/format';
import type { Action, DataSource, TrafficLight } from '../../lib/api/types';

const TONE: Record<TrafficLight, 'go' | 'wait' | 'stop'> = { green: 'go', amber: 'wait', red: 'stop' };
const LIGHT_WORD: Record<TrafficLight, Key> = { green: 'light.green', amber: 'light.amber', red: 'light.red' };

/** Up to three actions, each with its boarding-pass receipt. */
export function ActionList({ actions, source }: { actions: Action[]; source: DataSource | null }) {
  const { t, lang } = useI18n();
  if (!actions.length) return <p className="text-chrome">{t('actions.empty')}</p>;
  return (
    <ol className="m-0 grid list-none gap-8 p-0">
      {actions.map((a, i) => {
        const detail = a.detail ? pickText(a.detail, lang) : null;
        return (
          <li key={a.action_id} className="action">
            <div className="action-head">
              <span className="eyebrow !text-chrome tabular">{t('actions.count', { n: i + 1, total: actions.length })}</span>
              <span className="chip" data-tone={a.traffic_light ? TONE[a.traffic_light] : undefined}>
                {a.kind === 'input_decision' ? t('actions.decision') : t(`actions.kind.${a.kind}` as Key)}
              </span>
              {a.traffic_light ? (
                <span className="sr-only">{t(LIGHT_WORD[a.traffic_light])}</span>
              ) : null}
              {a.when ? (
                <span className="chip chip-mono">
                  <CalendarClock size={12} aria-hidden />
                  {t('actions.when', { from: fmtDate(a.when.window_start, lang), to: fmtDate(a.when.window_end, lang) })}
                </span>
              ) : null}
            </div>
            {detail?.text ? (
              <p className="mt-0 mb-3 text-chrome" lang={detail.lang}>
                {detail.text}
              </p>
            ) : null}
            {a.do_not?.length ? (
              <ul className="mb-3 grid list-none gap-1 p-0 text-sm text-chrome">
                {a.do_not.map((d, k) => (
                  <li key={k} className="flex items-start gap-2">
                    <Ban size={15} className="mt-0.5 flex-none text-stop" aria-hidden />
                    <span>
                      <span className="sr-only">{t('actions.doNot')}: </span>
                      {pickText(d, lang).text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ReceiptPass action={a} source={source} index={i} total={actions.length} />
          </li>
        );
      })}
    </ol>
  );
}
