import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayArea } from '../../lib/api/types';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { fmtNum } from '../../lib/format';
import { LinkButton } from '../../ui/Button';
import { DataMark } from '../../ui/DataMark';
import { RollNumber } from '../../ui/RollNumber';
import { SectionHead, useNear, useSeen } from './parts';

const W = 560;
const H = 260;
const PAD = { l: 40, r: 16, t: 16, b: 34 };
const Y0 = 0.5;
const Y1 = 1;

/**
 * Earned trust, in one chart: the real replay (public Bangladeshi rice dataset D; its labels stand in for officers).
 * The Wilson lower bound of "the sure suggestions are right" climbs with every officer answer; when it clears the 0.85
 * bar the gate opens and later photos may answer themselves. The line draws itself once, then the gate marker lands.
 */
export function TrustMini() {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const [area, setArea] = useState<ReplayArea | null>(null);
  const [chart, seen] = useSeen<SVGSVGElement>();

  useEffect(() => {
    if (!near || area) return;
    let off = false;
    void import('../../data/recorded').then(async (m) => {
      const r = await m.recordedReplay();
      const pick = r.areas.bioclip2?.['BD-D'] ?? Object.values(Object.values(r.areas)[0] ?? {})[0] ?? null;
      if (!off) setArea(pick);
    });
    return () => {
      off = true;
    };
  }, [near, area]);

  const geo = useMemo(() => {
    if (!area) return null;
    const pts = area.points.filter((p) => p[2] != null) as number[][];
    const maxX = Math.max(...area.points.map((p) => p[1] ?? 0));
    const x = (v: number) => PAD.l + (v / maxX) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (Math.max(Y0, Math.min(Y1, v)) - Y0) / (Y1 - Y0)) * (H - PAD.t - PAD.b);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[1]!).toFixed(1)} ${y(p[2]!).toFixed(1)}`).join(' ');
    const open = area.points.find((p) => p[3] === 1);
    return { d, x, y, maxX, open: open ? { x: x(open[1]!), y: y(open[2] ?? 0.85) } : null };
  }, [area]);

  const s = area?.summary;

  return (
    <section className="section cv" aria-labelledby="trust-title">
      <div className="wrap grid items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div>
          <SectionHead eyebrow={t('story.trust.eyebrow')} title={t('story.trust.title')} lead={t('story.trust.line')} id="trust-title" />
          {s && (
            <ul className="m-0 mt-10 grid list-none grid-cols-3 gap-6 p-0">
              <li>
                <RollNumber value={fmtNum(s.confirmations_until_open ?? 0, lang)} className="t-title tabular-nums" />
                <p className="m-0 mt-1.5 text-sm leading-snug text-ink-2">{t('story.trust.untilOpen')}</p>
              </li>
              <li>
                <RollNumber value={`${fmtNum(Math.round(s.auto_share_of_all_photos * 100), lang)}%`} className="t-title tabular-nums text-go" />
                <p className="m-0 mt-1.5 text-sm leading-snug text-ink-2">{t('story.trust.auto')}</p>
              </li>
              <li>
                <RollNumber value={`${fmtNum((s.auto_precision ?? 0) * 100, lang, { maximumFractionDigits: 1 })}%`} className="t-title tabular-nums" />
                <p className="m-0 mt-1.5 text-sm leading-snug text-ink-2">{t('story.trust.precision')}</p>
              </li>
            </ul>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton to="/trust" variant="secondary" arrow>
              {t('story.trust.more')}
            </LinkButton>
            <DataMark kind="replay" />
          </div>
        </div>

        <div ref={box} className="panel p-4 sm:p-6" data-reveal>
          <p className="mono m-0 text-xs text-ink-3">{t('story.trust.dataset')}</p>
          <svg ref={chart} viewBox={`0 0 ${W} ${H}`} className={cx('mt-3 block w-full', seen && 'is-drawn')} role="img" aria-label={s ? `${t('story.trust.opened', { n: s.confirmations_until_open ?? 0 })}` : t('story.trust.title')}>
            {/* axes */}
            {[0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={geo?.y(v) ?? 0} y2={geo?.y(v) ?? 0} stroke="var(--color-rule)" strokeWidth="1" />
                <text x={PAD.l - 8} y={(geo?.y(v) ?? 0) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {geo && (
              <>
                <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(0.85)} y2={geo.y(0.85)} stroke="var(--color-ink)" strokeWidth="1.25" strokeDasharray="5 4" />
                <text x={W - PAD.r} y={geo.y(0.85) - 7} textAnchor="end" fontSize="11" fill="var(--color-ink)" fontFamily="var(--font-mono)">
                  {t('story.trust.bar')}
                </text>
                <path d={geo.d} fill="none" stroke="var(--color-go)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="trust-line" />
                {geo.open && (
                  <g className="trust-gate" style={{ transformOrigin: `${geo.open.x}px ${geo.open.y}px` }}>
                    <line x1={geo.open.x} x2={geo.open.x} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-go)" strokeWidth="1" strokeDasharray="2 3" />
                    <circle cx={geo.open.x} cy={geo.open.y} r="7" fill="var(--color-card)" stroke="var(--color-go)" strokeWidth="3" />
                  </g>
                )}
                <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="11" fill="var(--color-ink-3)">
                  {t('story.trust.axis')} {fmtNum(geo.maxX, lang)}
                </text>
              </>
            )}
          </svg>
          {s && <p className="m-0 mt-2 text-sm font-medium text-go">{t('story.trust.opened', { n: fmtNum(s.confirmations_until_open ?? 0, lang) })}</p>}
        </div>
      </div>
    </section>
  );
}
