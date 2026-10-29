import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Lock, LockOpen, Pause, Play, RotateCcw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { buildChart, readoutAt, type ReplayModel } from './replay';
import type { Policy } from './policy';

/** One replay takes this long, whatever the area: long enough to read the bound climbing, short enough to watch twice. */
const PLAY_MS = 6000;
/** The counted bounds of the real replay sit between 0.6 and 0.95: the axis starts at 0.5 (and says so). */
const Y_MIN = 0.5;

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

type Phase = 'ready' | 'playing' | 'paused' | 'done';

/**
 * The real replay as a chart you can play: the cautious lower bound on how often the officers agreed with the model, one
 * officer answer at a time, against the bar (0.85) and the close line (0.80). The line draws in behind a playhead, the
 * gate marker pops once when the bound reaches the bar, and the readout counts what happened after: the share of photos
 * answered automatically and how many of those were right.
 *
 * Per-frame work never goes through React: the playhead, the reveal and the readout numbers are written to the DOM
 * directly, so a cheap phone keeps up. The playback is finite (6 s), starts by itself once when the chart scrolls into
 * view (not with reduced motion), and has a pause button. The range input moves through it by hand or by keyboard.
 */
export function ReplayStage({ model, policy, autoPlay }: { model: ReplayModel; policy: Policy; autoPlay: boolean }) {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const wrap = useRef<HTMLDivElement>(null);
  const measured = useWidth(wrap);
  const width = Math.max(280, measured || 640);
  const height = width < 560 ? 250 : 330;
  const box = useMemo(() => ({ width, height, left: 40, right: 14, top: 26, bottom: 30 }), [width, height]);
  const g = useMemo(() => buildChart(model, policy, box, Y_MIN), [model, policy, box]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const n = model.points.length;
  const last = n - 1;
  const openAt = model.openAt;
  const s = model.summary;

  const num = (v: number) => fmtNum(v, lang);
  const two = (v: number) => fmtNum(v, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v: number, d = 0) => `${fmtNum(v * 100, lang, { minimumFractionDigits: d, maximumFractionDigits: d })}%`;

  // ------------------------------------------------------------------ DOM refs written per frame
  const clip = useRef<SVGRectElement>(null);
  const head = useRef<SVGLineElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const out = {
    answers: useRef<HTMLElement>(null),
    photos: useRef<HTMLElement>(null),
    bound: useRef<HTMLElement>(null),
    auto: useRef<HTMLElement>(null),
    right: useRef<HTMLElement>(null),
  };
  const pos = useRef(0);
  const raf = useRef(0);
  const openedRef = useRef(false);
  const gateRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('ready');
  /** the playhead has passed the moment the gate first opened (the marker stays, even if a later drift closed it) */
  const [opened, setOpened] = useState(false);
  /** the gate stands at the playhead */
  const [gateNow, setGateNow] = useState(false);
  const [pop, setPop] = useState(false);
  const [say, setSay] = useState('');

  /** What the readout says at point i (the last point shows the file's own summary, which also counts the final photos). */
  const values = useCallback(
    (i: number) => {
      const r = readoutAt(model, i);
      const end = r.index >= last;
      const photos = end ? s.photos : r.photos;
      const auto = end ? s.auto_answers : r.autoAnswers;
      const share = end ? s.auto_share_of_all_photos : r.autoShare;
      const precision = end ? s.auto_precision : r.autoPrecision;
      return {
        r,
        answers: num(r.verdicts),
        photos: num(photos),
        bound: r.lowerBound === null ? t('tp.ro.notCounted') : two(r.lowerBound),
        auto: auto > 0 && share !== null ? `${pct(share)} · ${num(auto)}` : '—',
        right: auto > 0 && precision !== null ? pct(precision, 1) : '—',
      };
    },
    [model, lang, t],
  );

  const paint = useCallback(
    (f: number, live: boolean) => {
      const i0 = Math.max(0, Math.min(last, Math.floor(f)));
      const i1 = Math.min(last, i0 + 1);
      const k = f - i0;
      const p0 = model.points[i0]!;
      const p1 = model.points[i1]!;
      const x = g.x(p0.verdicts) + (g.x(p1.verdicts) - g.x(p0.verdicts)) * k;
      const lb = p0.lb !== null && p1.lb !== null ? p0.lb + (p1.lb - p0.lb) * k : p0.lb;
      clip.current?.setAttribute('width', String(Math.max(0, x - box.left + 1)));
      head.current?.setAttribute('transform', `translate(${x} 0)`);
      if (dot.current) {
        dot.current.setAttribute('transform', `translate(${x} ${lb === null ? g.y(Y_MIN) : g.y(lb)})`);
        dot.current.style.opacity = lb === null ? '0' : '1';
      }
      const v = values(Math.round(f));
      if (range.current) {
        range.current.value = String(Math.round(f));
        range.current.setAttribute('aria-valuetext', t('tp.replay.valueText', { n: v.answers, bound: v.bound }));
      }
      if (out.answers.current) out.answers.current.textContent = v.answers;
      if (out.photos.current) out.photos.current.textContent = v.photos;
      if (out.bound.current) out.bound.current.textContent = v.bound;
      if (out.auto.current) out.auto.current.textContent = v.auto;
      if (out.right.current) out.right.current.textContent = v.right;
      if (p0.open !== gateRef.current) {
        gateRef.current = p0.open;
        setGateNow(p0.open);
      }
      const isOpen = openAt !== null && (p0.open || p0.verdicts > openAt);
      if (isOpen !== openedRef.current) {
        openedRef.current = isOpen;
        setOpened(isOpen);
        setPop(isOpen && live);
        if (isOpen && live) setSay(t('tp.replay.sr.opened', { n: num(openAt!) }));
      }
    },
    [model, g, box, values, openAt, last, t],
  );

  const stop = () => cancelAnimationFrame(raf.current);

  const play = useCallback(() => {
    stop();
    if (pos.current >= last) {
      pos.current = 0;
      paint(0, false);
    }
    setPhase('playing');
    setSay('');
    let prev = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - prev); // a background tab or a long task never makes it jump
      prev = now;
      pos.current = Math.min(last, pos.current + (dt / PLAY_MS) * last);
      paint(pos.current, true);
      if (pos.current >= last) {
        setPhase('done');
        setSay((was) => (was ? `${was} ${t('tp.replay.sr.done')}` : t('tp.replay.sr.done')));
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [last, paint, t]);

  const pause = () => {
    stop();
    setPhase('paused');
  };

  // a new area starts from the beginning, or shows the whole replay when motion is reduced
  useLayoutEffect(() => {
    stop();
    openedRef.current = false;
    gateRef.current = false;
    setOpened(false);
    setGateNow(false);
    setPop(false);
    if (reduced || !autoPlay) {
      pos.current = last;
      paint(last, false);
      setPhase('done');
    } else {
      pos.current = 0;
      paint(0, false);
      setPhase('ready');
    }
    return stop;
  }, [model.key, reduced]);

  // keep the drawn state when the chart is resized
  useEffect(() => {
    paint(pos.current, false);
  }, [width, lang]);

  // play by itself once, when the chart scrolls into view
  useEffect(() => {
    if (!autoPlay || reduced || phase !== 'ready') return;
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          io.disconnect();
          play();
        }
      },
      { rootMargin: '0px 0px -25% 0px', threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoPlay, reduced, phase, play]);

  const onScrub = (value: number) => {
    stop();
    pos.current = value;
    paint(value, false);
    setPhase(value >= last ? 'done' : 'paused');
  };

  const first = values(reduced || !autoPlay ? last : 0);
  const plotBottom = box.top + g.plotH;
  const plotRight = box.left + g.plotW;
  const yLabel = (v: number) => fmtNum(v, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const label = t('tp.replay.chart', {
    area: model.key,
    bar: two(policy.openLb),
    close: two(policy.closeLb),
    result: openAt !== null ? t('tp.replay.result.opened', { n: num(openAt) }) : t('tp.replay.result.never'),
  });
  const uncountedW = g.uncounted ? g.uncounted.w : 0;
  const openX = openAt !== null ? g.x(openAt) : null;
  const markerLabelLeft = openX !== null && plotRight - openX < 130;

  const button =
    phase === 'playing' ? (
      <button type="button" className="btn btn-secondary btn-icon" onClick={pause} aria-label={t('tp.replay.pause')} data-testid="replay-pause">
        <Pause size={18} aria-hidden />
      </button>
    ) : (
      <button type="button" className="btn btn-primary btn-icon" onClick={play} aria-label={phase === 'done' ? t('tp.replay.again') : t('tp.replay.play')} data-testid="replay-play">
        {phase === 'done' ? <RotateCcw size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
    );

  return (
    <div className="tp-stage">
      <div className="tp-chart-wrap" ref={wrap}>
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="tp-chart" role="img" aria-label={label} data-testid="replay-chart" data-area={model.key} data-open-at={openAt ?? ''}>
          <defs>
            <pattern id={`h${uid}`} className="tp-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" />
            </pattern>
            <clipPath id={`c${uid}`}>
              <rect ref={clip} x={box.left - 1} y={0} width={reduced || !autoPlay ? g.plotW + 2 : 0} height={height} />
            </clipPath>
          </defs>

          {/* grid and y labels (the axis starts at 0.5) */}
          {g.yTicks.map((v) => (
            <g key={v}>
              <line className="tp-grid" x1={box.left} x2={plotRight} y1={g.y(v)} y2={g.y(v)} />
              <text x={box.left - 8} y={g.y(v) + 4} textAnchor="end">
                {yLabel(v)}
              </text>
            </g>
          ))}
          <text x={box.left} y={box.top - 12} textAnchor="start" className="tp-zone-label">
            {t('tp.axis.y')}
          </text>

          {/* before 30 sure answers the bound does not count */}
          {g.uncounted && uncountedW > 0 ? (
            <g>
              <rect x={g.uncounted.x} y={box.top} width={uncountedW} height={g.plotH} fill={`url(#h${uid})`} opacity={0.7} />
            </g>
          ) : null}

          {/* the stretch where the gate stood, revealed with the line */}
          <g clipPath={`url(#c${uid})`}>
            {g.windows.map((w, i) => (
              <rect key={i} className="tp-open-zone" x={w.x} y={box.top} width={w.w} height={g.plotH} />
            ))}
            {g.windows[0] && g.windows[0].w > 80 ? (
              <text x={g.windows[0].x + 8} y={box.top + 14} className="tp-open-label">
                {t('tp.zone.open')}
              </text>
            ) : null}
            {g.fill ? <path className="tp-area" d={g.fill} /> : null}
            <path className="tp-curve" d={g.curve} />
          </g>

          {/* the bar and the close line */}
          <line className="tp-bar" x1={box.left} x2={plotRight} y1={g.bar.y} y2={g.bar.y} />
          <text x={plotRight} y={g.bar.y - 6} textAnchor="end" className="tp-bar-label">
            {t('tp.line.open', { v: two(policy.openLb) })}
          </text>
          <line className="tp-close" x1={box.left} x2={plotRight} y1={g.closeBar.y} y2={g.closeBar.y} />
          <text x={plotRight} y={g.closeBar.y + 14} textAnchor="end" className="tp-close-label">
            {t('tp.line.close', { v: two(policy.closeLb) })}
          </text>

          {/* x axis */}
          <line className="tp-axis" x1={box.left} x2={plotRight} y1={plotBottom} y2={plotBottom} />
          {g.xTicks.map((v) => (
            <text key={v} x={g.x(v)} y={plotBottom + 16} textAnchor={v === 0 ? 'start' : 'middle'}>
              {num(v)}
            </text>
          ))}
          <text x={plotRight} y={height - 1} textAnchor="end" className="tp-zone-label">
            {t('tp.axis.x')}
          </text>

          {/* drawn on top, short when the hatched stretch is narrow */}
          {g.uncounted && uncountedW > 70 ? (
            <text x={g.uncounted.x + 6} y={plotBottom - 10} className="tp-zone-label">
              {uncountedW > 230 ? t('tp.zone.uncounted', { n: num(policy.minSure) }) : t('tp.ro.notCounted')}
            </text>
          ) : null}

          {/* the playhead */}
          <line ref={head} className="tp-head" x1={0} x2={0} y1={box.top} y2={plotBottom} transform={`translate(${g.x(model.points[reduced || !autoPlay ? last : 0]!.verdicts)} 0)`} />
          <circle ref={dot} className="tp-dot" r={4.5} cx={0} cy={0} style={{ opacity: 0 }} />

          {/* the moment the gate opened */}
          {openX !== null ? (
            <g>
              <g className="tp-marker" data-on={opened} data-pop={pop} transform={`translate(${openX} ${g.bar.y})`} data-testid="gate-marker">
                {/* the gate-opening moment: two sprout rings spread from the marker, once, while the replay plays */}
                <circle className="wave" r={9} />
                <circle className="wave w2" r={9} />
                <circle className="ring" r={9} />
                <circle className="core" r={4} />
              </g>
              <text className="tp-marker-label tp-open-label" data-on={opened} x={markerLabelLeft ? openX - 14 : openX + 14} y={g.bar.y - 14} textAnchor={markerLabelLeft ? 'end' : 'start'}>
                {t('tp.marker.open', { n: num(openAt!) })}
              </text>
            </g>
          ) : null}
        </svg>

        <div className="tp-controls">
          {button}
          <input
            ref={range}
            type="range"
            className="tp-range"
            min={0}
            max={last}
            step={1}
            defaultValue={reduced || !autoPlay ? last : 0}
            aria-label={t('tp.replay.scrub')}
            onChange={(e) => onScrub(Number(e.currentTarget.value))}
            data-testid="replay-scrub"
          />
        </div>
      </div>

      <div className="tp-readout" data-testid="replay-readout">
        <span className="tp-gate" data-open={gateNow} data-pop={pop && gateNow ? 'true' : undefined} data-testid="replay-gate">
          {gateNow ? <LockOpen size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
          {gateNow ? t('trust.meter.gate.open') : t('trust.meter.gate.closed')}
        </span>
        <dl className="mt-4">
          <div>
            <dt>{t('tp.ro.answers')}</dt>
            <dd ref={out.answers} data-testid="ro-answers">
              {first.answers}
            </dd>
          </div>
          <div>
            <dt>{t('tp.ro.photos')}</dt>
            <dd ref={out.photos}>{first.photos}</dd>
          </div>
          <div>
            <dt>{t('tp.ro.bound')}</dt>
            <dd ref={out.bound} data-testid="ro-bound">
              {first.bound}
            </dd>
          </div>
          <div>
            <dt>{t('tp.ro.auto')}</dt>
            <dd ref={out.auto} data-testid="ro-auto">
              {first.auto}
            </dd>
          </div>
          <div>
            <dt>{t('tp.ro.right')}</dt>
            <dd ref={out.right} data-testid="ro-right">
              {first.right}
            </dd>
          </div>
        </dl>
        <p className="sr-only-live" aria-live="polite" data-testid="replay-live">
          {say}
        </p>
      </div>
    </div>
  );
}
