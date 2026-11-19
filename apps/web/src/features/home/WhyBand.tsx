import type { CSSProperties } from 'react';
import { MessageSquareText, Smartphone, WifiOff } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useSeenOnce } from '../../ui/kit/hooks';

/* Facts, each a VERIFIED row of the fact register (D:\AI_congress\research):
   - A2 (fact_register.md): agriculture employs 44.74% of Bangladesh's workforce (World Bank WDI SL.AGR.EMPL.ZS, ILO
     modelled estimate, 2024). The deck's "45%" cites the BBS Labour Force Survey 2022, which is not in the register, so
     the site shows the verified 44.74%.
   - A3 (fact_register.md): 16.88 million agriculture-based households, Agriculture Census 2019.
   - GL-14 (fact_register_global.md): pathogen and pest yield losses, Savary et al. 2019: rice 30.0%, maize 22.5%,
     wheat 21.5%, potato 17.2%.
   The deck's lab-versus-field accuracy pair (Mohanty et al.) is not in the register, so it is left out. */
const WORK = 44.74;
const HOUSEHOLDS = 16.88;
const LOSS: { crop: Key; v: number }[] = [
  { crop: 'home.why.rice', v: 30.0 },
  { crop: 'home.why.maize', v: 22.5 },
  { crop: 'home.why.wheat', v: 21.5 },
  { crop: 'home.why.potato', v: 17.2 },
];
const WAYS: { t: Key; d: Key; tag: Key; icon: typeof Smartphone }[] = [
  { t: 'home.why.w1', d: 'home.why.w1.d', tag: 'home.why.w1.tag', icon: Smartphone },
  { t: 'home.why.w2', d: 'home.why.w2.d', tag: 'home.why.w2.tag', icon: WifiOff },
  { t: 'home.why.w3', d: 'home.why.w3.d', tag: 'home.why.w3.tag', icon: MessageSquareText },
];

/**
 * Who it is for (deck slide 3), as a forest band: the share of work that is farming, the harvest lost to pests and
 * diseases (bars drawn to scale once in view), and the ways to use it, from a smartphone to a basic phone.
 */
export function WhyBand() {
  const { t, lang } = useI18n();
  const [ref, seen] = useSeenOnce<HTMLDivElement>();
  const pct = (v: number) => `${fmtNum(v, lang, { minimumFractionDigits: v % 1 ? 1 : 1, maximumFractionDigits: 2 })}%`;
  return (
    <section className="band-night sheet-band section relative cv" aria-labelledby="why-title">
      <img src="/art/dark-leaf.webp" alt="" aria-hidden className="botanic right-0 top-0 w-[min(40vw,420px)]" loading="lazy" decoding="async" />
      <div className="wrap relative">
        <p className="eyebrow m-0" data-reveal>
          {t('home.why.eyebrow')}
        </p>
        <h2 id="why-title" className="t-title m-0 mt-4 max-w-[22ch] text-ink" data-reveal style={{ '--i': 1 } as CSSProperties}>
          {t('home.why.title')}
        </h2>

        <div className="mt-14 grid gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <div ref={ref}>
            <p className="eyebrow m-0">{t('home.why.matters')}</p>
            <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
              <p className="figure m-0 text-[clamp(4rem,2.6rem+4.4vw,6.6rem)] text-accent">{pct(WORK)}</p>
              <p className="m-0 max-w-[26ch] pb-3 text-[1.05rem] leading-snug text-ink-2">{t('home.why.work')}</p>
            </div>
            <p className="m-0 mt-10 text-[1.05rem] font-[650] text-ink">{t('home.why.lost')}</p>
            <ul className="why-bars m-0 mt-4 list-none p-0" data-seen={seen ? '' : undefined}>
              {LOSS.map((l, i) => (
                <li key={l.crop}>
                  <span className="text-ink-2">{t(l.crop)}</span>
                  <span className="why-track">
                    <span className="why-fill" data-first={i === 0 ? '' : undefined} style={{ '--w': l.v / 30, '--d': `${i * 90}ms` } as CSSProperties} />
                  </span>
                  <span className="mono text-ink">{pct(l.v)}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-4 text-[0.82rem] leading-snug text-ink-3">{t('home.why.src')}</p>
          </div>

          <div>
            <p className="eyebrow m-0">{t('home.why.ways')}</p>
            <ol className="why-ways m-0 mt-6 list-none p-0" data-stagger>
              {WAYS.map((w, i) => {
                const Icon = w.icon;
                return (
                  <li key={w.t}>
                    <span className="why-n figure" aria-hidden>
                      {fmtNum(i + 1, lang)}
                    </span>
                    <span className="icon-tile" aria-hidden>
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[1.05rem] font-[650] text-[#14261c]">{t(w.t)}</b>
                      <span className="block text-[0.9rem] leading-snug text-[#46524a]">{t(w.d)}</span>
                    </span>
                    <span className="why-tag">{t(w.tag)}</span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-10 grid grid-cols-[auto_1fr] items-end gap-x-5 border-t border-rule pt-8">
              <p className="figure m-0 text-[clamp(3rem,2rem+3vw,4.6rem)] text-accent">{t('home.why.hh', { n: fmtNum(HOUSEHOLDS, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</p>
              <p className="m-0 pb-2 text-[0.98rem] leading-snug text-ink-2">{t('home.why.hh.sub')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
