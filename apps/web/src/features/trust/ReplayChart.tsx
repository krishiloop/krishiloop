import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { buildChart, nearestIndex, type ReplayModel } from './replay';
import type { Policy } from './policy';

/** The curve draws itself in this long when an area is chosen; markers fade in as the line passes them. */
const DRAW_MS = 900;

function useWidth<T extends Element>(ref: RefObject<T | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * The replay as hand-rolled SVG: the lower bound on the officer's verdicts against officer answers, the dashed bar the
 * gate waits for, the moment it opened (and any moment it closed again), the stretch before the bound counts, and a
 * cursor that reads the same numbers as the text below it. No chart library: the geometry is `buildChart` (replay.ts),
 * which is unit-tested; this only draws it.
 *
 * It measures its own width, so the type stays readable at 390 px instead of shrinking with a fixed viewBox. A drag on
 * the chart (or the range input under it) moves the cursor; the page scrolls vertically as usual (touch-action: pan-y).
 */
export function ReplayChart({ model, policy, cursor, onCursor }: { model: ReplayModel; policy: Policy; cursor: number; onCursor: (i: number) => void }) {
  const { t, lang } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const measured = useWidth(wrap);
  const width = Math.max(260, measured || 340);
  const height = width < 520 ? 250 : 300;
  const g = useMemo(() => buildChart(model, policy, { width, height, left: 40, right: 14, top: 20, bottom: 32 }), [model, policy, width, height]);
  const uid = useId().replace(/:/g, '');
  const hatch = `h${uid}`;
  const grad = `g${uid}`;
  const clip = `c${uid}`;
  const dragging = useRef(false);

  const num = (n: number) => fmtNum(n, lang, { maximumFractionDigits: 2 });
  const { box } = g;
  const baseY = box.top + g.plotH;
  const cur = g.at(cursor);
  const label = `${t('trust.replay.chart', { bar: num(policy.openLb) })} ${model.openAt !== null ? t('trust.replay.opens', { n: fmtNum(model.openAt, lang) }) : t('trust.replay.never')}`;

  const pick = (e: ReactPointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / Math.max(1, r.width)) * width;
    onCursor(nearestIndex(model, ((px - box.left) / g.plotW) * model.maxVerdicts));
  };

  // where along the drawn line a point sits, to time its marker
  const delayFor = (x: number) => Math.round(Math.min(1, Math.max(0, (x - box.left) / g.plotW)) * DRAW_MS * 0.9);

  const first = g.closeMarkers[0];
  const open = g.openMarker;
  const labelLeft = open ? open.x - box.left > 168 : false;

  return (
    <div ref={wrap} className="rc-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="rc" role="img" aria-label={label} data-testid="replay-chart" data-area={model.key} data-open-at={model.openAt ?? ''}>
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" className="rc-hatch" />
          </pattern>
          <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-sun)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--color-sun)" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clip}>
            <rect x={box.left} y={box.top} width={g.plotW} height={g.plotH} />
          </clipPath>
        </defs>

        {/* the stretches where the gate stood */}
        {g.windows.map((w, i) => (
          <g key={`w${i}`}>
            <rect className="rc-open" x={w.x} y={box.top} width={w.w} height={g.plotH} data-testid="replay-open-band" />
            {w.w > 74 ? (
              <text className="rc-open-label" x={w.x + 7} y={baseY - 8}>
                {t('trust.replay.open')}
              </text>
            ) : null}
          </g>
        ))}
        {/* before the bound counts */}
        {g.uncounted ? <rect className="rc-uncounted" x={g.uncounted.x} y={box.top} width={g.uncounted.w} height={g.plotH} fill={`url(#${hatch})`} data-testid="replay-uncounted" /> : null}

        {/* grid and axes */}
        {g.yTicks.map((v) => (
          <line key={v} className="rc-grid" x1={box.left} x2={box.left + g.plotW} y1={g.y(v)} y2={g.y(v)} />
        ))}
        {[0, 0.5, 1].map((v) => (
          <text key={v} className="rc-tick" x={box.left - 8} y={g.y(v) + 3.5} textAnchor="end">
            {num(v)}
          </text>
        ))}
        <text className="rc-tick rc-tick-bar" x={box.left - 8} y={g.bar.y + 3.5} textAnchor="end">
          {num(policy.openLb)}
        </text>
        {g.xTicks.map((v) => (
          <text key={v} className="rc-tick" x={g.x(v)} y={baseY + 16} textAnchor={v === 0 ? 'start' : 'middle'}>
            {fmtNum(v, lang)}
          </text>
        ))}
        <text className="rc-axis" x={box.left + g.plotW} y={height - 3} textAnchor="end">
          {t('trust.replay.xAxis')}
        </text>
        <text className="rc-axis" x={box.left} y={11} textAnchor="start">
          {t('trust.replay.yAxis')}
        </text>

        {/* the lines the gate waits for */}
        {g.windows.length ? <line className="rc-close" x1={box.left} x2={box.left + g.plotW} y1={g.closeBar.y} y2={g.closeBar.y} data-testid="replay-close-line" /> : null}
        <line className="rc-bar" x1={box.left} x2={box.left + g.plotW} y1={g.bar.y} y2={g.bar.y} data-testid="replay-bar" />

        {/* the lower bound, drawn once per area */}
        <g clipPath={`url(#${clip})`} key={model.key}>
          {g.fill ? <path className="rc-fill" d={g.fill} fill={`url(#${grad})`} /> : null}
          {g.curve ? <path className="rc-curve" d={g.curve} pathLength={1} data-testid="replay-curve" /> : null}
        </g>

        {/* the moment it opened */}
        {open ? (
          <g className="rc-marker" key={`o${model.key}`} style={{ ['--d' as string]: `${delayFor(open.x) + 120}ms` }} data-testid="replay-open-marker">
            <circle className="rc-ping" cx={open.x} cy={open.y} r="10" />
            <circle className="rc-ring" cx={open.x} cy={open.y} r="10" />
            <circle className="rc-dot" cx={open.x} cy={open.y} r="4.6" />
            <text className="rc-flag" x={labelLeft ? open.x - 12 : open.x + 12} y={labelLeft ? open.y - 9 : open.y + 17} textAnchor={labelLeft ? 'end' : 'start'}>
              {t('trust.replay.opens', { n: fmtNum(model.openAt ?? 0, lang) })}
            </text>
          </g>
        ) : null}
        {/* and any moment it closed again */}
        {g.closeMarkers.map((c, i) => (
          <g className="rc-marker rc-marker-stop" key={`c${model.key}${i}`} style={{ ['--d' as string]: `${delayFor(c.x) + 120}ms` }} data-testid="replay-close-marker">
            <circle className="rc-ring" cx={c.x} cy={c.y} r="9" />
            <path className="rc-x" d={`M${c.x - 3.5} ${c.y - 3.5}L${c.x + 3.5} ${c.y + 3.5}M${c.x + 3.5} ${c.y - 3.5}L${c.x - 3.5} ${c.y + 3.5}`} />
            {c === first ? (
              <text className="rc-flag rc-flag-stop" x={c.x > box.left + g.plotW - 120 ? c.x - 12 : c.x + 12} y={c.y + 20} textAnchor={c.x > box.left + g.plotW - 120 ? 'end' : 'start'}>
                {t('trust.replay.closes')}
              </text>
            ) : null}
          </g>
        ))}

        {/* the cursor reads the same point as the text below */}
        <g className="rc-cursor" data-testid="replay-cursor" aria-hidden>
          <line x1={cur.x} x2={cur.x} y1={box.top} y2={baseY} />
          {cur.y !== null ? <circle cx={cur.x} cy={cur.y} r="4.2" /> : <circle className="rc-cursor-off" cx={cur.x} cy={baseY} r="3.6" />}
        </g>

        <rect
          className="rc-hit"
          x={box.left}
          y={box.top}
          width={g.plotW}
          height={g.plotH}
          fill="transparent"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => dragging.current && pick(e)}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        />
      </svg>
    </div>
  );
}
