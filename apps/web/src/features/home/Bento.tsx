import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Headset } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Qr } from '../../ui/Qr';
import { ReceiptCard } from '../../ui/Receipt';
import { DataMark } from '../../ui/DataMark';
import { BorderBeam } from '../../ui/kit/BorderBeam';
import { NumberTicker } from '../../ui/kit/NumberTicker';
import { spotlight, useOnScreen, useSeenOnce } from '../../ui/kit/hooks';
import { STORY } from '../story/storyData';
import { Head } from './Bands';

function Tile({ className, children, title, sub, to }: { className?: string; children?: ReactNode; title: string; sub: string; to?: string }) {
  const body = (
    <>
      <div className="relative">{children}</div>
      <div className="relative mt-auto pt-6">
        <h3 className="m-0 flex items-start justify-between gap-3 text-[1.2rem] font-[560] leading-tight tracking-[-0.025em] text-ink">
          {title}
          {to && <ArrowUpRight size={18} className="mt-0.5 flex-none text-ink-3 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />}
        </h3>
        <p className="m-0 mt-1.5 text-[0.95rem] leading-snug text-ink-2">{sub}</p>
      </div>
    </>
  );
  const cls = cx('surface group flex min-h-[260px] flex-col overflow-hidden p-6 sm:p-7', className);
  return to ? (
    <Link to={to} className={cx(cls, 'press no-underline')} data-reveal {...spotlight()}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-reveal {...spotlight()}>
      {body}
    </div>
  );
}

/** A wave of receipts turning Recalled, then back: what one recall does, at a glance. */
function RecallWave() {
  const [ref, seen] = useSeenOnce<HTMLDivElement>();
  const cols = 12;
  return (
    <div ref={ref} className="bento-recall grid grid-cols-12 gap-1.5" data-play={seen ? '' : undefined} aria-hidden>
      {Array.from({ length: cols * 3 }, (_, i) => {
        const x = i % cols;
        const y = Math.floor(i / cols);
        return <span key={i} className="wave-tile" style={{ '--w': x + y * 2 } as CSSProperties} />;
      })}
    </div>
  );
}

/** A calm voice line. */
function Waveform() {
  return (
    <div className="flex h-16 items-center gap-[5px]" aria-hidden>
      {Array.from({ length: 28 }, (_, b) => (
        <span key={b} className="wave-bar" style={{ '--b': b, height: `${30 + ((b * 37) % 70)}%` } as CSSProperties} />
      ))}
    </div>
  );
}

/** "Not sure" cases stacking into the officer inbox. */
function InboxStack() {
  const { t } = useI18n();
  const rows: Key[] = ['story.recall.r001', 'story.recall.r010', 'story.recall.r002'];
  return (
    <ul className="m-0 list-none space-y-2 p-0" aria-hidden>
      {rows.map((k, i) => (
        <li key={k} className="flex items-center gap-3 rounded-[12px] border border-rule bg-paper/70 px-3 py-2.5 text-[0.82rem] text-ink-2" style={{ opacity: 1 - i * 0.22, transform: `scale(${1 - i * 0.03})` }}>
          <Headset size={15} className="flex-none text-wait" />
          <span className="truncate">{t(k)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two bars, drawn to scale: the same photo reading on the GPU and on a laptop CPU (ml/sovereign/REPORT.md, p50). */
function SpeedBars() {
  const { t, lang } = useI18n();
  const [ref, seen] = useSeenOnce<HTMLDivElement>();
  const gpu = 23.8;
  const cpu = 931.9;
  return (
    <div ref={ref} className="space-y-4">
      {(
        [
          ['RTX 5090', gpu, 'bg-sprout'],
          [t('home.sov.laptop'), cpu, 'bg-ink-3'],
        ] as const
      ).map(([label, ms, cls], i) => (
        <div key={label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[0.85rem] text-ink-2">{label}</span>
            <NumberTicker value={ms} format={(v) => `${fmtNum(Math.round(v), lang)} ms`} delay={i * 0.15} className="mono text-[0.95rem] text-ink" />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/[0.07]">
            <div
              className={cx('h-full origin-left rounded-full transition-transform duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)]', cls)}
              style={{ transform: `scaleX(${seen ? Math.max(ms / cpu, 0.02) : 0})`, transitionDelay: `${i * 150}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Everything that works today, as tiles you can feel: each carries its own small live picture, not a paragraph.
 * The big tile is the receipt (it links to the page where one prints).
 */
export function Bento() {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const on = useOnScreen(box);
  const credential = STORY.calm.action.receipt_credential_id ?? '';
  return (
    <section className="section mesh mesh-garden cv" aria-labelledby="bento-title">
      <div className="wrap">
        <Head eyebrow={t('story.feat.eyebrow')} title={t('story.feat.title')} id="bento-title" />
        <div ref={box} className="mt-14 grid gap-4 md:grid-cols-6" data-offscreen={on ? undefined : ''}>
          <Tile to="/receipt" className="md:col-span-6 lg:col-span-3 lg:row-span-2" title={t('home.bento.receipt')} sub={t('home.bento.receipt.sub')}>
            <BorderBeam size={160} duration={11} radius={22} />
            <div className="bg-grid absolute -inset-6 opacity-70" aria-hidden />
            <div className="relative mx-auto max-w-[400px] rotate-[-2deg] pt-2 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-0">
              <ReceiptCard receipt={STORY.calm.action.receipt} status="authentic" compact />
            </div>
          </Tile>

          <Tile className="md:col-span-3" title={t('story.feat.recall')} sub={t('story.feat.recall.sub')}>
            <RecallWave />
          </Tile>

          <Tile className="md:col-span-3" title={t('story.feat.photo')} sub={t('home.trust.src')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <NumberTicker value={99.4} format={(v) => `${fmtNum(v, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} className="block text-[3.2rem] font-[520] leading-none tracking-[-0.05em] text-ink" />
                <p className="m-0 mt-2 max-w-[30ch] text-[0.85rem] leading-snug text-ink-2">
                  {t('home.trust.stat', { auto: `${fmtNum(86.5, lang)}%`, prec: `${fmtNum(99.4, lang)}%` })}
                </p>
                <p className="m-0 mt-1.5 max-w-[30ch] text-[0.8rem] leading-snug text-ink-3">{t('home.trust.gate', { n: fmtNum(100, lang), lo: fmtNum(70, lang), hi: fmtNum(126, lang) })}</p>
              </div>
              <DataMark kind="replay" />
            </div>
          </Tile>

          <Tile className="md:col-span-2" title={t('story.feat.ask')} sub={t('story.feat.ask.sub')}>
            <Waveform />
            <p lang="bn" className="m-0 mt-3 text-[0.95rem] text-ink-2">
              আমার ধানের পাতায় দাগ…
            </p>
          </Tile>

          <Tile className="md:col-span-2" title={t('story.feat.inbox')} sub={t('story.feat.inbox.sub')}>
            <InboxStack />
          </Tile>

          <Tile to={`/verify/${encodeURIComponent(credential.replace(/^urn:uuid:/, ''))}`} className="md:col-span-2" title={t('story.feat.scan')} sub={t('story.feat.scan.sub')}>
            <div className="paper-object w-fit rounded-[10px] bg-card p-2.5">
              <Qr value={verifyUrl(credential)} size={92} label={t('ui.receipt.verify')} />
            </div>
          </Tile>

          <Tile className="md:col-span-3" title={t('home.sov.title')} sub={t('home.sov.note')}>
            <p className="m-0 mb-5 text-[0.9rem] text-ink-2">
              {t('home.sov.sub')} <span className="text-ink-3">· {t('home.sov.photo')}, p50</span>
            </p>
            <SpeedBars />
          </Tile>

          <Tile className="md:col-span-3" title={t('story.feat.engine')} sub={t('story.engine.limit')}>
            <div className="flex flex-wrap gap-2">
              <span className="chip chip-go">{t('story.engine.bd')}</span>
              <span className="chip">{t('story.engine.ke')}</span>
            </div>
            <p className="m-0 mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[1.25rem] tracking-[-0.02em] text-ink">
              <span lang="bn">বাংলা</span>
              <span>English</span>
              <span lang="hi" className="text-ink-3">
                हिन्दी
              </span>
              <span lang="sw" className="text-ink-3">
                Kiswahili
              </span>
            </p>
          </Tile>
        </div>
      </div>
    </section>
  );
}
