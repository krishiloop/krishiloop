import { memo, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { TipLayer, type TipApi } from './TipLayer';
import { cx } from '../../lib/cx';
import { neighbour, reportStep, stepOf, type Dir, type GeoFile } from './model';

export interface Tip {
  code: string;
  x: number;
  y: number;
}

const KEYS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/**
 * One country as inline SVG (no map library): areas filled by recorded sightings on a pastel step scale with the
 * number written on the area (never colour alone), farmer reports as solid rings, and the simulated outbreak as
 * dashed, hatched rings. Areas are buttons with names: one tab stop per map, arrow keys move to the nearest area in
 * that direction, Enter or Space opens the area's panel. Hover, tap or focus shows a tooltip with the name and count.
 */
export const MapView = memo(function MapView({
  geo,
  values,
  reports,
  sim,
  selected,
  onOpen,
  describe,
  tipText,
  label,
  compact,
}: {
  geo: GeoFile;
  /** recorded sightings per area, or null when that layer is off */
  values: Map<string, number> | null;
  reports: Map<string, number> | null;
  sim: Map<string, number> | null;
  selected: string | null;
  onOpen: (code: string) => void;
  /** the accessible name of an area: its name and every number on it */
  describe: (code: string, name: string) => string;
  tipText: (code: string, name: string) => string;
  label: string;
  compact?: boolean;
}) {
  const [, , w, h] = geo.viewBox;
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const refs = useRef(new Map<string, SVGPathElement>());
  const firstWithData = geo.areas.find((a) => values?.get(a.code))?.code ?? geo.areas[0]?.code ?? null;
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const rover = focusCode ?? selected ?? firstWithData;
  // the tooltip keeps its own state, so moving the pointer never re-renders the areas
  const tipApi = useRef<TipApi | null>(null);
  const setTip = (t: Tip | null) => tipApi.current?.(t);
  const byCode = useMemo(() => new Map(geo.areas.map((a) => [a.code, a])), [geo]);

  const tipAtLabel = (code: string) => {
    const a = byCode.get(code);
    const r = svg.current?.getBoundingClientRect();
    const box = wrap.current?.getBoundingClientRect();
    if (!a || !r || !box) return;
    setTip({ code, x: r.left - box.left + (a.label[0] / w) * r.width, y: r.top - box.top + (a.label[1] / h) * r.height });
  };
  const tipAtPointer = (code: string, e: PointerEvent) => {
    const box = wrap.current?.getBoundingClientRect();
    if (box) setTip({ code, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const onKey = (e: KeyboardEvent, code: string) => {
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      const next = neighbour(geo.areas, code, dir);
      if (next) {
        setFocusCode(next);
        refs.current.get(next)?.focus();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(code);
    } else if (e.key === 'Escape') setTip(null);
  };

  const fontSize = compact ? w / 26 : w / 34;
  const ring = w / (compact ? 42 : 55);
  const hatch = `mp-hatch-${geo.country}`;
  const sel = selected ? byCode.get(selected) : undefined;

  return (
    <div ref={wrap} className={cx('mp-svgwrap', compact && 'is-compact')} onPointerLeave={() => setTip(null)}>
      <svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="group" aria-label={label} className="mp-svg" style={{ aspectRatio: `${w} / ${h}` }}>
        <defs>
          <pattern id={hatch} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="16" className="mp-hatch-line" />
          </pattern>
        </defs>
        <g className="mp-areas">
          {geo.areas.map((a) => {
            const n = values?.get(a.code) ?? 0;
            return (
              <path
                key={a.code}
                ref={(el) => {
                  if (el) refs.current.set(a.code, el);
                  else refs.current.delete(a.code);
                }}
                d={a.d}
                vectorEffect="non-scaling-stroke"
                className={cx('mp-area', `s-${values ? stepOf(n) : 0}`, a.code === selected && 'is-sel')}
                data-code={a.code}
                data-count={n}
                role="button"
                tabIndex={a.code === rover ? 0 : -1}
                aria-label={describe(a.code, a.name)}
                aria-pressed={a.code === selected}
                onClick={() => onOpen(a.code)}
                onKeyDown={(e) => onKey(e, a.code)}
                onFocus={() => {
                  setFocusCode(a.code);
                  tipAtLabel(a.code);
                }}
                onBlur={() => setTip(null)}
                onPointerMove={(e) => tipAtPointer(a.code, e)}
                onPointerDown={(e) => tipAtPointer(a.code, e)}
              />
            );
          })}
        </g>
        {sim && (
          <g className="mp-simfill" aria-hidden>
            {geo.areas
              .filter((a) => sim.has(a.code))
              .map((a) => (
                <path key={a.code} d={a.d} fill={`url(#${hatch})`} />
              ))}
          </g>
        )}
        {sel && <path d={sel.d} vectorEffect="non-scaling-stroke" className="mp-selline" aria-hidden />}
        {values && (
          <g className="mp-counts" aria-hidden style={{ fontSize }}>
            {geo.areas
              .filter((a) => values.get(a.code))
              .map((a) => (
                <text key={a.code} x={a.label[0]} y={a.label[1]} className={`ink-${stepOf(values.get(a.code)!)}`} dominantBaseline="middle" textAnchor="middle">
                  {values.get(a.code)}
                </text>
              ))}
          </g>
        )}
        {reports && (
          <g className="mp-reports" aria-hidden style={{ fontSize: fontSize * 0.8 }}>
            {geo.areas
              .filter((a) => reports.has(a.code))
              .map((a) => {
                const r = ring * (1 + 0.3 * (reportStep(reports.get(a.code)!) - 1));
                return (
                  <g key={a.code} transform={`translate(${a.label[0] + ring * 1.6} ${a.label[1] - ring * 1.6})`}>
                    <circle r={r} />
                    <text dominantBaseline="middle" textAnchor="middle">
                      {reports.get(a.code)}
                    </text>
                  </g>
                );
              })}
          </g>
        )}
        {sim && (
          <g className="mp-sim" aria-hidden style={{ fontSize: fontSize * 0.8 }}>
            {geo.areas
              .filter((a) => sim.has(a.code))
              .map((a) => {
                const r = ring * (1 + 0.3 * (reportStep(sim.get(a.code)!) - 1));
                return (
                  <g key={a.code} transform={`translate(${a.label[0] - ring * 1.6} ${a.label[1] + ring * 1.6})`}>
                    <circle r={r} />
                    <text dominantBaseline="middle" textAnchor="middle">
                      {sim.get(a.code)}
                    </text>
                  </g>
                );
              })}
          </g>
        )}
      </svg>
      <TipLayer apiRef={tipApi} text={(code) => (byCode.get(code) ? tipText(code, byCode.get(code)!.name) : null)} />
    </div>
  );
});
