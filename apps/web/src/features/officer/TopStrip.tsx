import { useApiState } from '../../lib/api/client';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { DataMark } from '../../ui/DataMark';
import { Roll } from './Roll';

export interface Counters {
  open: number | null;
  receipts: number | null;
  recalled: number | null;
  /** where the numbers come from: the sandbox's API counters, or a count of the recorded data on screen */
  source: 'live' | 'recorded' | null;
}

/**
 * Who you are here and what your sandbox holds: "Demo officer · your sandbox", the one-line sandbox rule, three counters
 * that roll into place (never "0" first: a skeleton until the API answers), and the live or recorded mark.
 */
export function TopStrip({ counters }: { counters: Counters }) {
  const { t, lang } = useI18n();
  const api = useApiState();
  const items = [
    { key: 'open', value: counters.open, label: t('off.count.open'), title: t('off.count.open.title') },
    { key: 'receipts', value: counters.receipts, label: t('off.count.receipts'), title: t(counters.source === 'live' ? 'off.count.receipts.title' : 'off.count.receipts.recorded') },
    { key: 'recalled', value: counters.recalled, label: t('off.count.recalled'), title: t(counters.source === 'live' ? 'off.count.recalled.title' : 'off.count.recalled.recorded') },
  ] as const;
  return (
    <header className="off-top">
      <div className="min-w-0">
        <p className="eyebrow hero-rise">{t('off.eyebrow')}</p>
        <h1 className="off-title hero-rise" style={{ ['--i' as string]: 1 }}>
          {t('off.title')}
        </h1>
        <p className="hero-rise mt-3 max-w-[54ch] text-[1.02rem] leading-relaxed text-ink-2" style={{ ['--i' as string]: 2 }}>
          {t('off.sandbox')}
        </p>
      </div>
      <div className="off-counters hero-rise" style={{ ['--i' as string]: 2 }}>
        <dl className="off-counter-list" data-testid="counters">
          {items.map((c) => (
            <div key={c.key} className="off-counter" title={c.title} data-testid={`count-${c.key}`}>
              <dt>{c.label}</dt>
              <dd>
                {c.value == null ? (
                  <>
                    <span className="skeleton inline-block h-[0.9em] w-[1.6ch] align-middle" aria-hidden />
                    <span className="sr-only-live">{t('ui.loading')}</span>
                  </>
                ) : (
                  <Roll value={fmtNum(c.value, lang)} />
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="off-mode" data-testid="data-mode">
          {api.mode === 'unknown' ? (
            <span className="skeleton inline-block h-6 w-24" aria-hidden />
          ) : api.mode === 'live' ? (
            <>
              <DataMark kind="live" />
              <span>{t('off.mode.live')}</span>
            </>
          ) : (
            <>
              <DataMark kind="recorded" date={RECORDED_AT} />
              <span>{t('off.mode.recorded')}</span>
            </>
          )}
        </p>
      </div>
    </header>
  );
}
