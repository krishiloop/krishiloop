import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Bug, ChevronDown, CloudRain, ExternalLink, ThermometerSun, Waves, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum, pickText } from '../../lib/format';
import { cx } from '../../lib/cx';
import { sampleRecalls } from '../../lib/api/mocks';
import { addDays, DATA, localToday, practiceRiver, shield, type Check, type CheckKind } from './engine';
import { CASES, type CaseId } from './SprayTool';
import { Choice, Peek, Slider } from './parts';

type River = 'none' | 'rising' | 'stable' | 'falling';
interface DayIn {
  rain: number;
  heat: number;
}
const PRESETS: Record<'calm' | 'storm' | 'heat', { days: DayIn[]; hum: number; low: number; river: River }> = {
  calm: { days: [2, 0, 0, 4, 1, 0, 0].map((rain, i) => ({ rain, heat: [29, 30, 31, 30, 29, 30, 31][i]! })), hum: 65, low: 20, river: 'stable' },
  storm: { days: [6, 48, 31, 12, 4, 0, 2].map((rain, i) => ({ rain, heat: [31, 29, 28, 29, 30, 31, 31][i]! })), hum: 92, low: 24, river: 'rising' },
  heat: { days: [0, 0, 1, 0, 0, 0, 3].map((rain, i) => ({ rain, heat: [34, 36, 37, 38, 37, 35, 33][i]! })), hum: 60, low: 27, river: 'falling' },
};
const ICON: Record<CheckKind, LucideIcon> = { heavy_rain: CloudRain, heat: ThermometerSun, flood: Waves, disease: Bug };
const RAIN_MAX = 80;
/** "Bangladesh Rice Research Institute (BRRI) ..." -> "BRRI" */
const shortPub = (p: string) => /\(([A-Z]{2,})\)/.exec(p)?.[1] ?? p;
const HEAT_MIN = 15;
const HEAT_MAX = 45;

/**
 * "Weather warnings": the visitor drags a PRACTICE week (rain and the day's high per day, humidity and the night low
 * for the week, a river trend) and the Climate-Smart Shield (engine.ts shield(), a port of services/engine/climate.py,
 * checked against it in engine.test.ts) shows its four checks and the sourced rule each warning cites.
 */
export function WeatherTool() {
  const { t, lang } = useI18n();
  const [c, setC] = useState<CaseId>('rice-tillering');
  const [prot, setProt] = useState<'yes' | 'no'>('no');
  const [days, setDays] = useState<DayIn[]>(PRESETS.storm.days);
  const [hum, setHum] = useState(PRESETS.storm.hum);
  const [low, setLow] = useState(PRESETS.storm.low);
  const [river, setRiver] = useState<River>(PRESETS.storm.river);
  const recalled = sampleRecalls.use();
  const today = useMemo(() => localToday(), []);
  const { pack, stage, country } = CASES[c];
  const n = (v: number) => fmtNum(v, lang, { maximumFractionDigits: 1 });
  const heavyMm = Number(DATA.packs[pack].params.heavy_rain_mm ?? 10);
  const heatC = DATA.shield.team_params.heat_tmax_c!.value;

  const report = useMemo(() => {
    const week = days.map((d, i) => ({ date: addDays(today, i), precip_mm: d.rain, tmax_c: d.heat, tmin_c: Math.min(low, d.heat), rh_mean_pct: hum }));
    const profile = pack === 'pack-potato-late-blight' ? { crop_protected: prot === 'yes' } : {};
    const gone = new Set(recalled);
    return shield(pack, stage, country, profile, week, practiceRiver(river, today), today, (r, v) => gone.has(`${r}@${v}`));
  }, [days, hum, low, river, pack, stage, country, prot, recalled, today]);

  const count = report.warnings === 0 ? t('try.w.none') : report.warnings === 1 ? t('try.w.one') : t('try.w.some', { n: fmtNum(report.warnings, lang) });
  const setDay = (i: number, k: keyof DayIn, v: number) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const preset = (p: keyof typeof PRESETS) => {
    setDays(PRESETS[p].days);
    setHum(PRESETS[p].hum);
    setLow(PRESETS[p].low);
    setRiver(PRESETS[p].river);
  };
  const dayNo = (iso: string) => {
    const i = Array.from({ length: 7 }, (_, k) => addDays(today, k)).indexOf(iso);
    return fmtNum(i + 1, lang);
  };
  const dayList = (isoDays: string[]) => isoDays.map(dayNo).join(', ');

  return (
    <div className="try-split">
      <div className="try-controls">
        <p className="chip chip-carbon w-fit" data-testid="weather-practice">
          {t('try.practice')}
        </p>
        <Choice label={t('try.crop')} value={c} onChange={setC} testId="weather-case" options={(Object.keys(CASES) as CaseId[]).map((k) => ({ value: k, label: t(`try.case.${k}` as Key) }))} />
        {pack === 'pack-potato-late-blight' && (
          <Choice label={t('try.protected')} value={prot} onChange={setProt} options={[{ value: 'no', label: t('try.no') }, { value: 'yes', label: t('try.yes') }]} />
        )}
        <div className="try-presets" role="group" aria-label={t('try.preset')}>
          <span className="try-slider-label">{t('try.preset')}</span>
          {(['calm', 'storm', 'heat'] as const).map((p) => (
            <button key={p} type="button" className="try-chipbtn" onClick={() => preset(p)} data-testid={`weather-preset-${p}`}>
              {t(`try.preset.${p}`)}
            </button>
          ))}
        </div>

        <Bars
          title={t('try.w.rain')}
          kind="rain"
          values={days.map((d) => d.rain)}
          min={0}
          max={RAIN_MAX}
          step={1}
          line={heavyMm}
          lineText={t('try.w.line', { value: t('try.unit.mm', { n: n(heavyMm) }) })}
          say={(v) => t('try.unit.mm', { n: n(v) })}
          name={(i) => t('try.w.dayRain', { n: fmtNum(i + 1, lang) })}
          onChange={(i, v) => setDay(i, 'rain', v)}
        />
        <Bars
          title={t('try.w.heat')}
          kind="heat"
          values={days.map((d) => d.heat)}
          min={HEAT_MIN}
          max={HEAT_MAX}
          step={0.5}
          line={heatC}
          lineText={t('try.w.line', { value: t('try.unit.c', { n: n(heatC) }) })}
          say={(v) => t('try.unit.c', { n: n(v) })}
          name={(i) => t('try.w.dayHeat', { n: fmtNum(i + 1, lang) })}
          onChange={(i, v) => setDay(i, 'heat', v)}
        />
        <p className="try-slider-hint">{t('try.w.dragHint')}</p>
        <div className="try-two">
          <Slider label={t('try.w.humidity')} value={hum} min={40} max={100} step={1} onChange={setHum} say={(v) => t('try.unit.pct', { n: n(v) })} testId="weather-humidity" />
          <Slider label={t('try.w.low')} value={low} min={4} max={30} onChange={setLow} say={(v) => t('try.unit.c', { n: n(v) })} testId="weather-low" />
        </div>
        <Choice
          label={t('try.w.river')}
          value={river}
          onChange={setRiver}
          testId="weather-river"
          options={(['none', 'rising', 'stable', 'falling'] as const).map((r) => ({ value: r, label: t(`try.river.${r}`) }))}
        />
        <Peek to="weather-answer" label={t('try.answer')} word={count} tone={report.warnings ? 'is-stop' : 'is-go'} flipKey={String(report.warnings)} />
      </div>

      <div id="weather-answer" className="try-result" aria-live="polite" data-testid="weather-result">
        <p className="try-wcount" data-testid="weather-count" key={report.warnings}>
          {count}
        </p>
        <ul className="try-checks">
          {report.checks.map((ch) => (
            <CheckTile key={ch.kind} c={ch} dayList={dayList} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CheckTile({ c, dayList }: { c: Check; dayList: (d: string[]) => string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const Icon = ICON[c.kind];
  const n = (v: number) => fmtNum(v, lang, { maximumFractionDigits: 1 });
  const th = c.thresholds[0];
  let line = '';
  if (c.kind === 'heavy_rain') line = c.level === 'warn' ? t('try.line.rain.warn', { days: dayList(c.days), mm: n(c.peak?.value ?? 0) }) : t('try.line.rain.clear', { mm: n(Number(th?.value ?? 0)) });
  if (c.kind === 'heat') line = c.level === 'warn' ? t('try.line.heat.warn', { days: dayList(c.days), c: n(c.peak?.value ?? 0) }) : t('try.line.heat.clear', { c: n(Number(th?.value ?? 0)) });
  if (c.kind === 'flood')
    line = c.level === 'unknown' ? t('try.line.flood.unknown') : c.level === 'warn' ? t('try.line.flood.warn', { q: n(c.peak?.value ?? 0) }) : t('try.line.flood.clear', { trend: t(`try.river.${c.peak?.trend === 'falling' ? 'falling' : 'stable'}`) });
  if (c.kind === 'disease') {
    const p = { n: fmtNum(c.peak?.value ?? 0, lang), min: fmtNum(c.peak?.min ?? 0, lang) };
    line = c.level === 'warn' ? t('try.line.disease.warn', p) : t('try.line.disease.clear', p);
  }
  const title = c.rule?.title ? pickText(c.rule.title, lang) : null;
  const more = c.level === 'warn';
  return (
    <li className={cx('try-check', `is-${c.level}`)} data-testid={`weather-${c.kind}`} data-level={c.level} data-rule={c.rule?.rule_id ?? ''}>
      <div className="try-check-row">
        <span className="try-check-icon" aria-hidden key={c.level}>
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{t(`try.k.${c.kind}`)}</span>
            <span className={cx('chip', c.level === 'warn' ? 'chip-stop' : c.level === 'clear' ? 'chip-go' : 'chip-wait')}>{t(`try.l.${c.level}`)}</span>
          </p>
          <p className="try-check-line">{line}</p>
          {c.rule && (
            <p className="try-check-cite" data-testid={`weather-cite-${c.kind}`}>
              {t('try.cites')} <span className="mono font-semibold">{t('try.rule', { id: c.rule.rule_id, v: c.rule.version })}</span> · {t('try.page', { doc: shortPub(c.rule.source.publisher), page: fmtNum(c.rule.source.page, lang) })}
            </p>
          )}
          {c.rule_withdrawn && <p className="try-check-cite text-stop">{t('try.withdrawn', { rule: c.rule_withdrawn })}</p>}
        </div>
        {more && (
          <button type="button" className="try-more" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={t(`try.k.${c.kind}`)}>
            <ChevronDown size={18} aria-hidden className={cx('try-chev', open && 'is-open')} />
          </button>
        )}
      </div>
      {more && open && (
        <div className="try-check-body">
          {c.rule ? (
            <>
              {title ? (
                <p className="try-rule-says">
                  <span className="eyebrow block">{t('try.ruleSays')}</span>
                  <span lang={title.lang}>{title.text}</span>
                </p>
              ) : (
                <p className="text-sm text-ink-2">{t('try.quoteOnly')}</p>
              )}
              <blockquote className="try-quote" lang={c.rule.source.language}>
                <span className="eyebrow block" lang={lang}>
                  {t('try.sourceSays')}
                </span>
                “{c.rule.source.quote}”
              </blockquote>
              <p className="try-src">
                <a href={c.rule.source.url} target="_blank" rel="noreferrer">
                  {t('try.page', { doc: c.rule.source.publisher, page: fmtNum(c.rule.source.page, lang) })}
                  <ExternalLink size={12} aria-hidden className="ml-1 inline" />
                </a>
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-2">{t('try.noRule')}</p>
          )}
          <p className="try-team">{t('try.team')}</p>
          {c.context && (
            <p className="try-context">
              <span className="eyebrow block">{t('try.whyMatters')}</span>
              <span lang={pickText(c.context.text, lang).lang}>{pickText(c.context.text, lang).text}</span>{' '}
              <a href={c.context.url} target="_blank" rel="noreferrer">
                {c.context.source}
              </a>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Seven draggable bars (one per day). Each bar is a slider: drag it, tap a height, or use the keys (arrows one step,
 * Page Up and Page Down ten, Home and End). A dashed line marks where a warning starts.
 */
function Bars({
  title,
  kind,
  values,
  min,
  max,
  step,
  line,
  lineText,
  say,
  name,
  onChange,
}: {
  title: string;
  kind: 'rain' | 'heat';
  values: number[];
  min: number;
  max: number;
  step: number;
  line: number;
  lineText: string;
  say: (v: number) => string;
  name: (i: number) => string;
  onChange: (i: number, v: number) => void;
}) {
  const { lang } = useI18n();
  const drag = useRef<number | null>(null);
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const fromY = (e: RPointerEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.height) return;
    onChange(i, snap(max - ((e.clientY - r.top) / r.height) * (max - min)));
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const v = values[i]!;
    const big = step * 10;
    const next =
      e.key === 'ArrowUp' || e.key === 'ArrowRight' ? v + step
      : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? v - step
      : e.key === 'PageUp' ? v + big
      : e.key === 'PageDown' ? v - big
      : e.key === 'Home' ? min
      : e.key === 'End' ? max
      : null;
    if (next == null) return;
    e.preventDefault();
    onChange(i, snap(next));
  };
  return (
    <div className={cx('try-bars', `is-${kind}`)} data-testid={`weather-bars-${kind}`}>
      <p className="try-slider-label">{title}</p>
      <div className="try-bars-plot" style={{ ['--line' as string]: `${frac(line) * 100}%` }}>
        {values.map((v, i) => (
          <div key={i} className="try-bar-col">
            <div
              className={cx('try-bar', v >= line && 'is-over')}
              role="slider"
              tabIndex={0}
              aria-label={name(i)}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={v}
              aria-valuetext={say(v)}
              aria-orientation="vertical"
              data-testid={`weather-${kind}-${i}`}
              onKeyDown={(e) => onKey(e, i)}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                drag.current = i;
                e.currentTarget.setPointerCapture(e.pointerId);
                fromY(e, i);
              }}
              onPointerMove={(e) => drag.current === i && fromY(e, i)}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <span className="try-bar-fill" style={{ transform: `scaleY(${Math.max(0.02, frac(v))})` }} />
            </div>
            <span className="try-bar-val" aria-hidden>
              {fmtNum(v, lang, { maximumFractionDigits: 0 })}
            </span>
            <span className="try-bar-day" aria-hidden>
              {fmtNum(i + 1, lang)}
            </span>
          </div>
        ))}
      </div>
      <p className="try-bars-legend" aria-hidden>
        <span className="try-bars-dash" /> {lineText}
      </p>
    </div>
  );
}
