import { useId, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';

export type Tone = 'butter' | 'moss' | 'monsoon' | 'terracotta' | 'hyacinth' | 'lotus';

/**
 * One tool on /try: a pastel card with its number, a short plain title, one line of help, honest tags, then the tool.
 * The pastel frames the tool; what you read and touch sits on the theme's own card colour (try.css).
 */
export function ToolCard({
  id,
  n,
  tone,
  title,
  help,
  tags,
  wide,
  children,
}: {
  id: string;
  n: number;
  tone: Tone;
  title: string;
  help: string;
  tags?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t, lang } = useI18n();
  const head = useId();
  return (
    <section id={id} className={cx('try-card', `tone-${tone}`, wide && 'is-wide')} aria-labelledby={head} data-testid={`try-${id}`} data-reveal>
      <header className="try-card-head">
        <span className="try-num" aria-hidden>
          {fmtNum(n, lang, { minimumIntegerDigits: 2 })}
        </span>
        <div className="min-w-0">
          <h2 id={head} className="try-card-title">
            <span className="sr-only">{t('try.toolNo', { n: fmtNum(n, lang) })}: </span>
            {title}
          </h2>
          <p className="try-card-help">{help}</p>
          {tags && <div className="try-tags">{tags}</div>}
        </div>
      </header>
      <div className="try-card-body">{children}</div>
    </section>
  );
}

/** A thumb-sized range slider with its value said in words (aria-valuetext) and shown beside the label. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  say,
  testId,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** the value in words, e.g. "24 °C" */
  say: (v: number) => string;
  testId?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="try-slider">
      <div className="try-slider-top">
        <label htmlFor={id} className="try-slider-label">
          {label}
        </label>
        <output htmlFor={id} className="try-slider-value" aria-hidden>
          {say(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={say(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        data-testid={testId}
      />
      {hint && <p className="try-slider-hint">{hint}</p>}
    </div>
  );
}

/** Choose one of a few options: big pills, a radio group underneath (arrow keys move the choice). */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  hideLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  testId?: string;
  hideLabel?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="try-choice" data-testid={testId}>
      <legend className={cx('try-slider-label', hideLabel && 'sr-only')}>{label}</legend>
      <div className="try-choice-row">
        {options.map((o) => (
          <label key={o.value} className={cx('try-pill', o.value === value && 'is-on')}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Phones only: the answer stays in sight while the thumb moves the sliders. A small pill sticks to the bottom of the
 * controls (never past them) and jumps to the full answer; the word flips when it changes (try.css).
 */
export function Peek({ to, label, word, tone, flipKey }: { to: string; label: string; word: string; tone: string; flipKey: string }) {
  return (
    <a href={`#${to}`} className={cx('try-peek', tone)} data-testid={`${to}-peek`}>
      <span className="try-peek-label">{label}</span>
      <span className="try-peek-word" key={flipKey}>
        {word}
      </span>
    </a>
  );
}
