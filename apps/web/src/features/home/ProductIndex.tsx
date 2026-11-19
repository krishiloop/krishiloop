import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Camera, CloudRain, Headset, Mic, Pause, Play, Radar, ReceiptText, Sprout, Thermometer, Waves, Wheat } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Qr } from '../../ui/Qr';
import { ReceiptCard } from '../../ui/Receipt';
import { DataMark } from '../../ui/DataMark';
import { WeatherStrip } from '../../ui/WeatherStrip';
import { Comparer } from '../../ui/kit/Comparer';
import { TiltCard } from '../../ui/kit/TiltCard';
import { LiquidLink } from '../../ui/kit/LiquidButton';
import { spotlight, useOnScreen } from '../../ui/kit/hooks';
import { STORY } from '../story/storyData';
import radarRaw from '../officer/radar/simulated.json';
import { LeafArt } from './LeafArt';

/* Measured numbers, each with its file:
   - the photo gate: public/models/agritriage/config.json -> test_report.any_crop (PlantWild test split, 3,663 photos;
     the size from evidence/poster_numbers.json -> data.per_dataset[plantwild].test), 89 classes, 11.5 MB;
   - the radar: src/features/officer/radar/simulated.json (services/engine/radar.py on a SIMULATED village scenario);
   - the forecast: src/data/recorded/story.json -> snapshot.forecast (Open-Meteo, recorded 2 Nov 2026);
   - the voice: public/audio/manifest.json, clip R-BDR-002__male (our own svara-tts voice, review pending). */
const GATE = { act: 63.6, actRight: 91.3, shortlist: 17.8, refer: 18.6, testN: 3663, classes: 89 };
const VOICE = { src: '/audio/bn/svara-m-cd8e51c6c42c4a3a.ogg', text: 'এখন স্প্রে দরকার নেই: পোকার সংখ্যা সীমার নিচে। কয়েক দিন পর আবার গুনে দেখুন।', rule: 'R-BDR-002' };

type Cell = { area_name: string; country: string; problem: string; reports: number; reporters: number };
const RADAR = (() => {
  const s = (radarRaw as { simulated?: { k?: number; cells?: Cell[] } }).simulated;
  return { k: s?.k ?? 3, cells: (s?.cells ?? []).filter((c) => c && typeof c.reports === 'number').slice(0, 4) };
})();
const PROBLEM_BN: Record<string, string> = {
  bacterial_leaf_blight: 'ব্যাকটেরিয়াজনিত পাতা পোড়া',
  late_blight: 'নাবি ধসা',
  blast: 'ব্লাস্ট',
  brown_planthopper: 'বাদামি গাছফড়িং',
  unidentified: 'অজানা',
};
const problemName = (p: string, lang: string) => (lang === 'bn' && PROBLEM_BN[p]) || p.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const ITEMS: { id: string; key: Key; icon: typeof Camera }[] = [
  { id: 'pi-guardian', key: 'home.pi.guardian', icon: Camera },
  { id: 'pi-climate', key: 'home.pi.climate', icon: CloudRain },
  { id: 'pi-radar', key: 'home.pi.radar', icon: Radar },
  { id: 'pi-calc', key: 'home.pi.calc', icon: Wheat },
  { id: 'pi-voice', key: 'home.pi.voice', icon: Mic },
  { id: 'pi-officer', key: 'home.pi.officer', icon: Headset },
  { id: 'pi-receipt', key: 'home.pi.receipt', icon: ReceiptText },
];

const pct = (v: number, lang: Parameters<typeof fmtNum>[1]) => `${fmtNum(v, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** One plate of the magazine: a big number, a title, one line, the artifact. Plates alternate sides on wide screens. */
function Plate({ id, n, title, sub, to, flip, art, children }: { id: string; n: number; title: string; sub: string; to: string; flip?: boolean; art: ReactNode; children?: ReactNode }) {
  const { t, lang } = useI18n();
  return (
    <article id={id} className={cx('pi-plate surface', flip && 'is-flip')} data-reveal {...spotlight()} aria-labelledby={`${id}-t`}>
      <div className="pi-art">{art}</div>
      <div className="pi-copy">
        <p className="pi-num figure" aria-hidden>
          {fmtNum(n, lang, { minimumIntegerDigits: 2 })}
        </p>
        <h3 id={`${id}-t`} className="t-head m-0 text-ink">
          {title}
        </h3>
        <p className="m-0 mt-3 max-w-[40ch] text-[1rem] leading-relaxed text-ink-2">{sub}</p>
        {children}
        <Link to={to} className="pi-open group">
          {t('home.pi.open')}
          <ArrowUpRight size={16} aria-hidden className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </article>
  );
}

function VoicePlayer() {
  const { t } = useI18n();
  const ref = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setOn(false));
    else a.pause();
  };
  return (
    <div className="pi-voice" data-playing={on ? '' : undefined}>
      <button type="button" className="pi-play liquid btn-primary" onClick={toggle} aria-label={on ? t('home.pi.voice.pause') : t('home.pi.voice.play')}>
        {on ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden className="translate-x-[1px]" />}
      </button>
      <div className="flex h-14 flex-1 items-center gap-[4px]" aria-hidden>
        {Array.from({ length: 32 }, (_, b) => (
          <span key={b} className="pi-bar" style={{ '--b': b, height: `${24 + ((b * 37) % 76)}%` } as CSSProperties} />
        ))}
      </div>
      <audio ref={ref} src={VOICE.src} preload="none" onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => setOn(false)} />
    </div>
  );
}

/**
 * "What is inside": the seven tools of the merged product as a magazine. A sticky index on the left lights the plate in
 * view; each plate carries one real artifact (or a labelled illustration where the site may not show a photo).
 */
export function ProductIndex() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState(ITEMS[0]!.id);
  const box = useRef<HTMLDivElement>(null);
  const on = useOnScreen(box);
  const credential = STORY.calm.action.receipt_credential_id ?? '';
  const maxReports = Math.max(1, ...RADAR.cells.map((c) => c.reports));

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-42% 0px -52% 0px' },
    );
    ITEMS.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <section className="section relative" aria-labelledby="pi-title" ref={box} data-offscreen={on ? undefined : ''}>
      <div className="wrap grid gap-12 lg:grid-cols-[minmax(260px,0.72fr)_2fr] lg:gap-16">
        <aside className="pi-side">
          <p className="label flex items-center gap-2.5" data-reveal>
            <span className="h-px w-8 bg-accent" aria-hidden />
            {t('home.pi.eyebrow')}
          </p>
          <h2 id="pi-title" className="t-title mt-5 text-ink lg:[font-size:clamp(2rem,1.1rem+1.9vw,3.2rem)]" data-reveal style={{ '--i': 1 } as CSSProperties}>
            {t('home.pi.title')} <span className="serif-i text-accent-text">{t('home.pi.title2')}</span>
          </h2>
          <nav aria-label={t('home.pi.nav')} className="mt-9 hidden lg:block">
            <ol className="m-0 list-none space-y-0.5 p-0">
              {ITEMS.map((it, i) => {
                const Icon = it.icon;
                return (
                  <li key={it.id}>
                    <a href={`#${it.id}`} className="pi-idx" aria-current={active === it.id ? 'true' : undefined}>
                      <span className="mono w-7 text-[0.72rem] text-ink-3">{fmtNum(i + 1, lang, { minimumIntegerDigits: 2 })}</span>
                      <span className="icon-tile icon-tile-sm" aria-hidden>
                        <Icon size={14} />
                      </span>
                      <span className="py-1.5 leading-tight">{t(it.key)}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="mt-9 hidden lg:block">
            <LiquidLink to="/app" arrow magnetic>
              {t('ui.cta.tryApp')}
            </LiquidLink>
          </div>
        </aside>

        <div className="grid gap-6 lg:gap-8">
          {/* 01 Crop Guardian */}
          <Plate
            id="pi-guardian"
            n={1}
            title={t('home.pi.guardian')}
            sub={t('home.pi.guardian.sub')}
            to="/app?tab=photo"
            art={
              <div className="relative">
                <Comparer
                  className="aspect-[4/3] w-full"
                  initial={46}
                  label={t('home.pi.guardian.cmp')}
                  before={<LeafArt />}
                  after={<LeafArt map />}
                  beforeLabel={t('home.pi.guardian.leaf')}
                  afterLabel={t('home.pi.guardian.map')}
                />
                <span className="chip chip-carbon absolute bottom-3 left-3 z-10" title={t('home.illus.title')}>
                  {t('home.illus')}
                  <span className="sr-only-live">. {t('home.illus.title')}</span>
                </span>
              </div>
            }
          >
            <p className="m-0 mt-4 flex flex-wrap gap-2">
              <span className="chip">{t('home.pi.guardian.offline')}</span>
              <span className="chip">{t('home.pi.guardian.size', { n: fmtNum(GATE.classes, lang), mb: fmtNum(11.5, lang) })}</span>
            </p>
            <ul className="pi-gate3 m-0 mt-5 list-none p-0" data-stagger aria-label={t('home.pi.guardian.gate')}>
              {(
                [
                  ['sure', 'home.pi.guardian.sure', 'home.pi.guardian.sure.do', GATE.act],
                  ['unsure', 'home.pi.guardian.unsure', 'home.pi.guardian.unsure.do', GATE.shortlist],
                  ['risky', 'home.pi.guardian.risky', 'home.pi.guardian.risky.do', GATE.refer],
                ] as const
              ).map(([g, k, d, v]) => (
                <li key={g} data-g={g}>
                  <span className="pi-gate3-pill">{t(k)}</span>
                  <span className="pi-gate3-do">{t(d)}</span>
                  <span className="pi-gate3-v figure">{pct(v, lang)}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-3 text-[0.92rem] font-[560] text-ink">{t('home.pi.guardian.right', { pct: pct(GATE.actRight, lang) })}</p>
            <p className="m-0 mt-1.5 text-[0.8rem] leading-snug text-ink-3">{t('home.pi.guardian.src', { n: fmtNum(GATE.testN, lang) })}</p>
          </Plate>

          {/* 02 Climate Shield */}
          <Plate
            id="pi-climate"
            n={2}
            flip
            title={t('home.pi.climate')}
            sub={t('home.pi.climate.sub')}
            to="/app?tab=today"
            art={
              <div className="pi-climate">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    <Thermometer size={13} aria-hidden /> {t('home.hero.climate')}
                  </span>
                  <DataMark kind="recorded" date={STORY.snapshot.forecast?.issued_at ?? STORY.snapshot.created_at} />
                </div>
                <WeatherStrip days={STORY.snapshot.forecast?.days ?? []} className="mt-6" />
                <p className="m-0 mt-5 flex items-center gap-2 text-[0.8rem] text-ink-3">
                  <Waves size={14} aria-hidden className="text-water" />
                  {t('home.pi.climate.src')}
                </p>
              </div>
            }
          />

          {/* 03 Outbreak radar */}
          <Plate
            id="pi-radar"
            n={3}
            title={t('home.pi.radar')}
            sub={t('home.pi.radar.sub')}
            to="/officer"
            art={
              <div className="pi-radar">
                <div className="pi-radar-scope" aria-hidden>
                  <span className="pi-sweep" />
                  {RADAR.cells.map((c, i) => (
                    <span key={`${c.area_name}-${c.problem}`} className="pi-blip" style={{ '--x': `${[62, 30, 70, 44][i] ?? 50}%`, '--y': `${[36, 58, 66, 28][i] ?? 50}%`, '--s': 0.6 + c.reports / maxReports } as CSSProperties} />
                  ))}
                </div>
                <ul className="m-0 mt-5 list-none space-y-3 p-0" data-stagger>
                  {RADAR.cells.map((c) => (
                    <li key={`${c.area_name}-${c.problem}`}>
                      <div className="flex items-baseline justify-between gap-3 text-[0.86rem]">
                        <span className="min-w-0 truncate text-ink">
                          {c.area_name} <span className="text-ink-3">· {problemName(c.problem, lang)}</span>
                        </span>
                        <span className="mono flex-none text-[0.75rem] text-ink-2">{t('home.pi.radar.row', { reports: fmtNum(c.reports, lang), farmers: fmtNum(c.reporters, lang) })}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
                        <span className="pi-radar-bar block h-full origin-left rounded-full" style={{ transform: `scaleX(${c.reports / maxReports})` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <DataMark kind="simulation" />
                  <span className="text-[0.78rem] text-ink-3">{t('home.pi.radar.k', { k: fmtNum(RADAR.k, lang) })}</span>
                </div>
              </div>
            }
          />

          {/* 04 Precision savings */}
          <Plate
            id="pi-calc"
            n={4}
            flip
            title={t('home.pi.calc')}
            sub={t('home.pi.calc.sub')}
            to="/app?tab=today"
            art={
              <ol className="pi-calc" data-stagger>
                {(
                  [
                    ['home.pi.calc.a', Sprout],
                    ['home.pi.calc.b', Wheat],
                    ['home.pi.calc.c', ReceiptText],
                  ] as const
                ).map(([k, Icon], i) => (
                  <li key={k} className={cx('pi-calc-step', i === 2 && 'is-out')}>
                    <span className="pi-calc-ic">
                      <Icon size={20} aria-hidden />
                    </span>
                    <span>{t(k)}</span>
                  </li>
                ))}
              </ol>
            }
          />

          {/* 05 Bangla voice */}
          <Plate
            id="pi-voice"
            n={5}
            title={t('home.pi.voice')}
            sub={t('home.pi.voice.sub')}
            to="/app?tab=ask"
            art={
              <div className="pi-voicebox">
                <p lang="bn" className="m-0 text-[clamp(1.2rem,1rem+0.8vw,1.55rem)] leading-[1.6] text-ink">
                  “{VOICE.text}”
                </p>
                <p className="mono m-0 mt-2 text-[0.72rem] text-ink-3">{VOICE.rule}</p>
                <div className="mt-6">
                  <VoicePlayer />
                </div>
                <p className="m-0 mt-4 text-[0.78rem] leading-snug text-ink-3">{t('home.pi.voice.note')}</p>
              </div>
            }
          />

          {/* 06 The officer */}
          <Plate
            id="pi-officer"
            n={6}
            flip
            title={t('home.pi.officer')}
            sub={t('home.pi.officer.sub')}
            to="/officer"
            art={
              <ul className="pi-inbox m-0 list-none p-0" aria-hidden data-stagger>
                {(['story.recall.r001', 'story.recall.r010', 'story.recall.r002'] as Key[]).map((k, i) => (
                  <li key={k} style={{ '--k': i } as CSSProperties}>
                    <Headset size={16} className="flex-none text-wait" />
                    <span className="truncate">{t(k)}</span>
                  </li>
                ))}
              </ul>
            }
          />
          {/* 07 The receipt, and recall */}
          <Plate
            id="pi-receipt"
            n={7}
            title={t('home.pi.receipt')}
            sub={t('home.pi.receipt.sub')}
            to={`/verify/${encodeURIComponent(credential.replace(/^urn:uuid:/, ''))}`}
            art={
              <div className="pi-receipts">
                <TiltCard className="pi-r-back" max={5} glare={false}>
                  <ReceiptCard receipt={STORY.calm.action.receipt} status="recalled" compact />
                </TiltCard>
                <TiltCard className="pi-r-front" max={6}>
                  <ReceiptCard receipt={STORY.calm.action.receipt} status="authentic" compact />
                </TiltCard>
                <span className="chip chip-stop pi-r-tag">{t('home.pi.receipt.after')}</span>
              </div>
            }
          >
            <div className="paper-object mt-6 w-fit rounded-[14px] bg-card p-2.5 shadow-[var(--shadow-lift)]">
              <Qr value={verifyUrl(credential)} size={96} label={t('ui.receipt.verify')} />
            </div>
          </Plate>

                  </div>
      </div>
    </section>
  );
}
