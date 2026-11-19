import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DataMark } from '../../ui/DataMark';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { REPLAY_DATASETS, type ReplayModel } from './replay';
import type { Policy } from './policy';
import type { CiArea } from './CiPanel';

const Y_MIN = 0.5;
const toTrack = (lb: number) => Math.min(1, Math.max(0, (lb - Y_MIN) / (1 - Y_MIN)));
/** one slow pass from the first photo to a little past the opening, once, when the picture first comes into view */
const PLAY_MS = 3600;

/**
 * The idea of /trust as one picture you can move: a slider over how many photos officers have checked in one area,
 * and a field gate that swings open once the safe estimate of how often the AI is right reaches the bar (and shuts
 * again if it falls). Every value is the real replay's (ml/vision/artifacts/area_trust_replay.json): the point at the
 * slider's position. Labelled as a replay of public photos, not real farms.
 */
export function GatePicture({
  areas,
  initial,
  policy,
  play,
  ci,
  ciRuns,
}: {
  areas: ReplayModel[];
  initial: string;
  policy: Policy;
  play: boolean;
  ci: Record<string, CiArea> | null;
  ciRuns: number;
}) {
  const { t, lang } = useI18n();
  const [key, setKey] = useState(initial);
  const m = areas.find((a) => a.key === key) ?? areas[0]!;
  const n = m.points.length;
  const [i, setI] = useState(n - 1);
  const played = useRef(false);
  const root = useRef<HTMLElement>(null);

  // the last point at or before which the gate first opened, for the autoplay's end and the "after N" line
  const openIdx = useMemo(() => (m.openAt == null ? -1 : m.points.findIndex((p) => p.verdicts >= m.openAt!)), [m]);

  useEffect(() => {
    setI(m.points.length - 1);
  }, [m]);

  // autoplay once on first view: the slider walks from the first photo to just past the opening
  useEffect(() => {
    const el = root.current;
    if (!el || !play || played.current || typeof IntersectionObserver === 'undefined') return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || played.current) return;
        played.current = true;
        io.disconnect();
        const end = openIdx >= 0 ? Math.min(n - 1, openIdx + Math.round(n * 0.12)) : n - 1;
        let t0 = 0;
        const tick = (now: number) => {
          if (!t0) t0 = now;
          const p = Math.min(1, (now - t0) / PLAY_MS);
          const eased = 1 - Math.pow(1 - p, 2);
          setI(Math.round(eased * end));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        setI(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [play, n, openIdx]);

  const p = m.points[Math.min(i, n - 1)]!;
  const open = p.open;
  const two = (v: number) => fmtNum(v, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v: number) => `${fmtNum(v * 100, lang, { maximumFractionDigits: 0 })}%`;
  const c = ci?.[m.key] ?? null;
  const lbText = p.lb == null ? t('tp.gp.notYet') : pct(p.lb);

  return (
    <figure ref={root} className="tp-gp m-0" data-testid="hero-meter" data-open={open}>
      <figcaption className="tp-gp-cap">
        <span className="mono text-[0.75rem] text-ink-3">
          {m.key} · {REPLAY_DATASETS[m.key] ?? m.key}
        </span>
        <DataMark kind="replay" />
      </figcaption>

      <div className="tp-gp-areas" role="group" aria-label={t('tp.areas.pick')}>
        {areas.map((a) => (
          <button key={a.key} type="button" className="tp-gp-area" aria-pressed={a.key === m.key} onClick={() => setKey(a.key)}>
            {a.key}
          </button>
        ))}
      </div>

      <div className="tp-gp-stage">
        <svg viewBox="0 0 320 170" className="tp-gp-svg" role="img" aria-label={t(open ? 'tp.gp.ariaOpen' : 'tp.gp.ariaClosed', { n: fmtNum(p.verdicts, lang), lb: lbText })}>
          {/* the field beyond the gate */}
          <path d="M0 132 C60 120 120 126 160 122 C210 118 260 124 320 116 V170 H0 Z" fill="var(--color-moss)" />
          {[40, 70, 100, 220, 250, 280].map((x, k) => (
            <path key={x} d={`M${x} 128 c-2 -14 -6 -22 -12 -30 M${x} 128 c1 -16 4 -24 9 -32 M${x} 128 c0 -12 0 -18 1 -26`} fill="none" stroke="var(--color-moss-ink)" strokeWidth="1.4" strokeLinecap="round" opacity={0.55 + (k % 2) * 0.2} />
          ))}
          {/* posts */}
          <rect x="70" y="52" width="10" height="86" rx="2" fill="var(--color-butter-ink)" />
          <rect x="240" y="52" width="10" height="86" rx="2" fill="var(--color-butter-ink)" />
          {/* two doors that swing on their hinges (transform only) */}
          <g className="tp-gp-door is-left" style={{ transformOrigin: '80px 95px' } as CSSProperties}>
            <rect x="80" y="62" width="80" height="66" rx="3" fill="var(--color-butter)" stroke="var(--color-butter-ink)" strokeWidth="2" />
            {[96, 112, 128, 144].map((x) => (
              <line key={x} x1={x} y1="64" x2={x} y2="126" stroke="var(--color-butter-ink)" strokeWidth="1.5" />
            ))}
            <line x1="82" y1="124" x2="158" y2="66" stroke="var(--color-butter-ink)" strokeWidth="2" />
          </g>
          <g className="tp-gp-door is-right" style={{ transformOrigin: '240px 95px' } as CSSProperties}>
            <rect x="160" y="62" width="80" height="66" rx="3" fill="var(--color-butter)" stroke="var(--color-butter-ink)" strokeWidth="2" />
            {[176, 192, 208, 224].map((x) => (
              <line key={x} x1={x} y1="64" x2={x} y2="126" stroke="var(--color-butter-ink)" strokeWidth="1.5" />
            ))}
            <line x1="162" y1="66" x2="238" y2="124" stroke="var(--color-butter-ink)" strokeWidth="2" />
          </g>
          {/* the sign over the gate */}
          <g className="tp-gp-sign">
            <rect x="118" y="18" width="84" height="26" rx="13" fill={open ? 'var(--color-moss)' : 'var(--color-terracotta)'} stroke={open ? 'var(--color-moss-ink)' : 'var(--color-terracotta-ink)'} strokeWidth="1.5" />
            <text x="160" y="35.5" textAnchor="middle" fontSize="12" fontWeight="700" fill={open ? 'var(--color-moss-ink)' : 'var(--color-terracotta-ink)'}>
              {open ? t('trust.meter.gate.open') : t('trust.meter.gate.closed')}
            </text>
          </g>
        </svg>
      </div>

      <dl className="tp-gp-read">
        <div>
          <dt>{t('tp.gp.checked')}</dt>
          <dd className="tp-gp-num">{fmtNum(p.verdicts, lang)}</dd>
        </div>
        <div>
          <dt>{t('tp.gp.right')}</dt>
          <dd className="tp-gp-num">{lbText}</dd>
        </div>
        <div>
          <dt>{t('tp.gp.bar')}</dt>
          <dd className="tp-gp-num">{pct(policy.openLb)}</dd>
        </div>
      </dl>

      <div className="tp-meter mt-3" aria-hidden>
        <div className="tp-track">
          <span className="tp-fill tp-gp-fill" data-open={open} style={{ transform: `scaleX(${p.lb == null ? 0 : toTrack(p.lb)})` }} />
        </div>
        <span className="tp-notch" style={{ ['--x' as string]: toTrack(policy.openLb) } as CSSProperties} />
        <span className="tp-notch" data-kind="close" style={{ ['--x' as string]: toTrack(policy.closeLb) } as CSSProperties} />
      </div>

      <label className="tp-gp-slider">
        <span className="tp-gp-slabel">{t('tp.gp.slider')}</span>
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={Math.min(i, n - 1)}
          onChange={(e) => {
            played.current = true;
            setI(Number(e.target.value));
          }}
          aria-valuetext={t('tp.gp.valueText', { n: fmtNum(p.verdicts, lang), lb: lbText })}
          data-testid="gate-slider"
          style={{ ['--p' as string]: n > 1 ? i / (n - 1) : 1 } as CSSProperties}
        />
      </label>

      <p className={`m-0 mt-3 font-semibold ${m.openAt !== null ? 'text-go' : 'text-ink-2'}`}>{m.openAt !== null ? t('tp.hero.open', { n: fmtNum(m.openAt, lang) }) : t('tp.hero.never')}</p>
      {c && c.answers_to_open[1] !== null && c.answers_to_open[0] !== null && c.answers_to_open[2] !== null ? (
        <p className="tp-hero-ci m-0 mt-1.5 text-[0.85rem] text-ink-2" data-testid="hero-ci">
          {t('tp.hero.ci', { n: fmtNum(ciRuns, lang), med: fmtNum(c.answers_to_open[1], lang), lo: fmtNum(c.answers_to_open[0], lang), hi: fmtNum(c.answers_to_open[2], lang) })}{' '}
          <a className="link" href="#tp-ci-h">
            {t('tp.hero.ciLink')}
          </a>
        </p>
      ) : null}
      <p className="sr-only-live">{t('tp.hero.aria', { lb: p.lb == null ? '—' : two(p.lb), bar: two(policy.openLb), n: fmtNum(m.openAt ?? 0, lang) })}</p>
    </figure>
  );
}
