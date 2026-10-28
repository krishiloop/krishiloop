import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Mic } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { DecisionPictogram } from '../../ui/Pictogram';
import { Stamp } from '../../ui/Stamp';
import { Qr } from '../../ui/Qr';
import { STORY } from './storyData';
import { SectionHead } from './parts';

const VERIFY = `/verify/${encodeURIComponent((STORY.calm.action.receipt_credential_id ?? '').replace(/^urn:uuid:/, ''))}`;

/* tiny live-looking visuals, all real shapes of the product, no decoration */
const Bars = () => (
  <span className="flex h-9 items-end gap-1" aria-hidden>
    {(STORY.snapshot.forecast?.days ?? []).slice(0, 7).map((d, i) => (
      <span key={d.date} className="feat-bar w-2 rounded-full bg-[#4f7fb8]" style={{ height: `${Math.max(12, Math.min(100, ((d.precip_mm ?? 0) / 12) * 100))}%`, ['--k' as string]: i }} />
    ))}
  </span>
);
const Rows = () => (
  <span className="grid w-28 gap-1.5" aria-hidden>
    {[0.9, 0.7, 0.8].map((w, i) => (
      <span key={i} className="flex items-center gap-1.5">
        <span className={cx('size-2 rounded-full', i === 0 ? 'bg-stop' : 'bg-rule-2')} />
        <span className="h-1.5 rounded-full bg-rule-2" style={{ width: `${w * 100}%` }} />
      </span>
    ))}
  </span>
);
const Gate = () => (
  <svg viewBox="0 0 120 48" className="h-12 w-28" aria-hidden>
    <path d="M2 40 C 22 38, 32 30, 48 22 S 80 8, 118 6" fill="none" stroke="var(--color-go)" strokeWidth="2.5" className="feat-line" pathLength={1} />
    <path d="M2 14 H118" stroke="var(--color-ink-3)" strokeWidth="1" strokeDasharray="3 3" />
  </svg>
);
const Phone = () => (
  <span className="flex h-14 w-10 flex-col items-center rounded-[7px] border-2 border-ink-2 p-1" aria-hidden>
    <span className="w-full flex-1 rounded-[2px] bg-sunk p-0.5">
      <span className="block h-0.5 w-4/5 rounded bg-ink-3" />
      <span className="mt-0.5 block h-0.5 w-3/5 rounded bg-ink-3" />
      <span className="mt-0.5 block h-0.5 w-2/3 rounded bg-go" />
    </span>
    <span className="mt-1 grid grid-cols-3 gap-0.5">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="size-1 rounded-full bg-ink-3" />
      ))}
    </span>
  </span>
);

interface Tile {
  key: Key;
  to: string;
  visual: ReactNode;
  span?: string;
}

/**
 * "I don't see any features": here they all are, each a door into the real thing. A bento of twelve tiles, each with a
 * tiny visual made of the product's own shapes. Tiles lift on hover and reveal in a stagger.
 */
export function Features() {
  const { t } = useI18n();
  const tiles: Tile[] = [
    {
      key: 'story.feat.ask',
      to: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d&tab=ask',
      span: 'sm:col-span-2',
      visual: (
        <span className="flex items-center gap-3" aria-hidden>
          <span className="grid size-11 place-items-center rounded-full bg-ink text-paper">
            <Mic size={20} />
          </span>
          <span lang="bn" className="rounded-[14px] rounded-bl-[4px] border border-rule bg-paper px-3 py-1.5 text-[0.95rem]">
            এখন কি স্প্রে করব?
          </span>
        </span>
      ),
    },
    {
      key: 'story.feat.decision',
      to: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d',
      visual: (
        <span className="grid size-12 place-items-center rounded-[12px] bg-go-wash text-go" style={{ ['--pict-bg' as string]: 'var(--color-go-wash)' }} aria-hidden>
          <DecisionPictogram decision="dont_spray" size={36} />
        </span>
      ),
    },
    {
      key: 'story.feat.scan',
      to: VERIFY,
      visual: (
        <span className="relative flex items-center" aria-hidden>
          <Qr value="https://krishiloop.vercel.app/verify" size={52} label="" />
          <Stamp kind="authentic" size="sm" className="-ml-5 mt-6" />
        </span>
      ),
    },
    { key: 'story.feat.recall', to: '/officer?tab=recall', visual: <Stamp kind="recalled" size="sm" /> },
    { key: 'story.feat.inbox', to: '/officer', visual: <Rows /> },
    { key: 'story.feat.photo', to: '/trust', span: 'sm:col-span-2', visual: <Gate /> },
    {
      key: 'story.feat.engine',
      to: '#engine',
      visual: (
        <span className="mono flex items-center gap-2 text-sm" aria-hidden>
          <span className="rounded-[5px] border border-rule-2 px-1.5 py-0.5">BD</span>
          <span className="h-px w-6 bg-ink-3" />
          <span className="rounded-[5px] bg-ink px-1.5 py-0.5 text-paper">engine</span>
          <span className="h-px w-6 bg-ink-3" />
          <span className="rounded-[5px] border border-rule-2 px-1.5 py-0.5">KE</span>
        </span>
      ),
    },
    {
      key: 'story.feat.sig',
      to: '/proof#check',
      visual: (
        <span className="mono text-sm text-go" aria-hidden>
          Ed25519 ✓
        </span>
      ),
    },
    { key: 'story.feat.sms', to: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d&tab=receipts', visual: <Phone /> },
    {
      key: 'story.feat.lang',
      to: '/app',
      visual: (
        <span className="flex flex-wrap gap-1.5 text-sm" aria-hidden>
          <span lang="bn">বাংলা</span>
          <span className="text-ink-3">·</span>EN<span className="text-ink-3">·</span>
          <span lang="hi">हिं</span>
          <span className="text-ink-3">·</span>SW
        </span>
      ),
    },
    {
      key: 'story.feat.mcp',
      to: '/proof#mcp',
      visual: (
        <span className="mono text-sm" aria-hidden>
          5 × MCP · 14 tools
        </span>
      ),
    },
    { key: 'story.feat.weather', to: '/app?field=BD-SAMPLE-02&profile=demo-farmer-d', visual: <Bars /> },
  ];

  return (
    <section className="section cv border-t border-rule" aria-labelledby="feat-title">
      <div className="wrap">
        <SectionHead eyebrow={t('story.feat.eyebrow')} title={t('story.feat.title')} id="feat-title" />
        <ul className="m-0 mt-12 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => {
            const inner = (
              <>
                <span className="flex min-h-14 items-start">{tile.visual}</span>
                <span className="mt-auto block pt-6">
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-[1.08rem] font-semibold leading-snug">{t(tile.key)}</span>
                    <ArrowUpRight size={18} className="feat-arrow mt-0.5 flex-none text-ink-3" aria-hidden />
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-ink-3">{t(`${tile.key}.sub` as Key)}</span>
                </span>
              </>
            );
            const cls = 'feat-tile lift flex h-full min-h-[190px] flex-col rounded-[var(--radius-ui)] border border-rule bg-card p-5 text-ink no-underline';
            return (
              <li key={tile.key} className={tile.span} data-reveal style={{ ['--i' as string]: i % 4 }}>
                {tile.to.startsWith('#') ? (
                  <a href={tile.to} className={cls}>
                    {inner}
                  </a>
                ) : (
                  <Link to={tile.to} className={cls}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
