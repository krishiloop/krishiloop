import { useRef, type ReactNode } from 'react';
import { Inbox, MapPin, ReceiptText, Siren, Undo2 } from 'lucide-react';
import { useApiState } from '../../lib/api/client';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { DataMark } from '../../ui/DataMark';
import { CountUp } from '../../ui/kit/CountUp';

export interface Counters {
  open: number | null;
  receipts: number | null;
  recalled: number | null;
  /** open cases marked urgent (a count of the cases on screen) */
  urgent: number | null;
  /** open visit or call requests (a count of the cases on screen) */
  visits: number | null;
  /** where the numbers come from: the sandbox's API counters, or a count of the recorded data on screen */
  source: 'live' | 'recorded' | null;
}

type TileKey = 'open' | 'urgent' | 'visits' | 'recalled' | 'receipts';
const TILES: { key: TileKey; tone: string; icon: ReactNode; label: Key; hint: Key }[] = [
  { key: 'open', tone: 'butter', icon: <Inbox size={18} aria-hidden />, label: 'off.count.open', hint: 'off.count.open.title' },
  { key: 'urgent', tone: 'terracotta', icon: <Siren size={18} aria-hidden />, label: 'off.count.urgent', hint: 'off.count.urgent.title' },
  { key: 'visits', tone: 'monsoon', icon: <MapPin size={18} aria-hidden />, label: 'off.count.visits', hint: 'off.count.visits.title' },
  { key: 'recalled', tone: 'hyacinth', icon: <Undo2 size={18} aria-hidden />, label: 'off.count.recalled', hint: 'off.count.recalled.title' },
  { key: 'receipts', tone: 'moss', icon: <ReceiptText size={18} aria-hidden />, label: 'off.count.receipts', hint: 'off.count.receipts.title' },
];

/** A number that counts up from where it was (never "0" first: a skeleton until the value arrives). */
function TileNumber({ value }: { value: number }) {
  const { lang } = useI18n();
  const prev = useRef<number | null>(null);
  const from = prev.current ?? 0;
  prev.current = value;
  return <CountUp value={value} from={from} when="mount" duration={from === 0 ? 1100 : 700} format={(n) => fmtNum(Math.round(n), lang)} />;
}

/**
 * The officer's "today": who you are here (a practice desk, your own copy), and five pastel tiles that count up: open
 * cases, urgent ones, visit requests, recalls and receipts. The numbers are the API's counters, or a count of the
 * recorded cases on screen (the mark says which).
 */
export function TopStrip({ counters }: { counters: Counters }) {
  const { t } = useI18n();
  const api = useApiState();
  const hint = (k: TileKey, key: Key): string => {
    if (k === 'receipts') return t(counters.source === 'live' ? 'off.count.receipts.title' : 'off.count.receipts.recorded');
    if (k === 'recalled') return t(counters.source === 'live' ? 'off.count.recalled.title' : 'off.count.recalled.recorded');
    return t(key);
  };
  return (
    <header className="off-hero">
      <div className="off-hero-copy">
        <p className="eyebrow hero-rise">{t('off.eyebrow')}</p>
        <h1 className="off-title hero-rise" style={{ ['--i' as string]: 1 }}>
          {t('off.title')}
        </h1>
        <p className="off-hero-lead hero-rise" style={{ ['--i' as string]: 2 }}>
          {t('off.sandbox')}
        </p>
        <p className="off-mode hero-rise" style={{ ['--i' as string]: 2 }} data-testid="data-mode">
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
      <section className="off-today hero-rise" style={{ ['--i' as string]: 3 }} aria-labelledby="off-today-h">
        <h2 id="off-today-h" className="off-today-h">
          {t('off.today')}
        </h2>
        <dl className="off-tiles" data-testid="counters">
          {TILES.map((c) => {
            const value = counters[c.key];
            return (
              <div key={c.key} className="off-tile-stat" data-tone={c.tone} title={hint(c.key, c.hint)} data-testid={`count-${c.key}`}>
                <dt>
                  <span className="off-tile-ic">{c.icon}</span>
                  <span>{t(c.label)}</span>
                </dt>
                <dd>
                  {value == null ? (
                    <>
                      <span className="skeleton inline-block h-[0.9em] w-[1.6ch] align-middle" aria-hidden />
                      <span className="sr-only-live">{t('ui.loading')}</span>
                    </>
                  ) : (
                    <TileNumber value={value} />
                  )}
                </dd>
                <p className="off-tile-hint" aria-hidden>
                  {hint(c.key, c.hint)}
                </p>
              </div>
            );
          })}
        </dl>
      </section>
    </header>
  );
}
