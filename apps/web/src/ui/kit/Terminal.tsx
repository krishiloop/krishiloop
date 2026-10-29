/** Magic UI Terminal (TypingAnimation + AnimatedSpan), rebuilt: plays once when first seen, CSS + one timer chain, no Motion. */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn as cx } from './cn';
import { useSeenOnce } from './hooks';
import './terminal.css';

export interface TermLine {
  /** a command, typed character by character after the prompt */
  cmd?: string;
  /** an output or comment line, which fades in once the command above it is typed */
  out?: string;
  tone?: 'go' | 'muted';
}

const CPS = 55; // characters per second while typing

/**
 * A terminal window whose commands type themselves once, the first time it scrolls into view; outputs fade in after
 * their command. The whole text is a real <pre> for screen readers and copying (the typed copy is aria-hidden), and
 * reduced motion shows everything at once. One Copy button copies only the commands.
 */
export function Terminal({ title, lines, copyLabel, copiedLabel, className }: { title: string; lines: TermLine[]; copyLabel: string; copiedLabel: string; className?: string }) {
  const [ref, seen] = useSeenOnce<HTMLDivElement>();
  const [step, setStep] = useState(-1); // index of the line being typed
  const [chars, setChars] = useState(0);
  const [copied, setCopied] = useState(false);
  const still = useRef(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const done = still.current || step >= lines.length;

  useEffect(() => {
    if (seen && step === -1 && !still.current) setStep(0);
  }, [seen, step]);

  useEffect(() => {
    if (done || step < 0) return;
    const line = lines[step]!;
    if (line.cmd && chars < line.cmd.length) {
      const id = window.setTimeout(() => setChars((c) => c + 1), 1000 / CPS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(
      () => {
        setStep((s) => s + 1);
        setChars(0);
      },
      line.cmd ? 260 : 120,
    );
    return () => window.clearTimeout(id);
  }, [step, chars, done, lines]);

  const text = lines.map((l) => (l.cmd ? `$ ${l.cmd}` : `  ${l.out ?? ''}`)).join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        lines
          .filter((l) => l.cmd)
          .map((l) => l.cmd)
          .join('\n'),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused: the text is still selectable */
    }
  };

  return (
    <div ref={ref} className={cx('term', className)}>
      <div className="term-bar">
        <span className="term-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="term-title">{title}</span>
        <button type="button" className="term-copy" onClick={copy}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <pre className="sr-only-live">{text}</pre>
      <div className="term-body" aria-hidden>
        {lines.map((l, i) => {
          const shown = done || i < step || (i === step && !l.cmd);
          const typing = !done && i === step && !!l.cmd;
          if (!shown && !typing) return <div key={i} className="term-line is-pending" />;
          return (
            <div key={i} className={cx('term-line', l.cmd ? 'is-cmd' : 'is-out', l.tone && `is-${l.tone}`, !l.cmd && !done && 'is-fresh')}>
              {l.cmd ? (
                <>
                  <span className="term-prompt">$</span>
                  <span>{typing ? l.cmd.slice(0, chars) : l.cmd}</span>
                  {typing ? <span className="term-caret" /> : null}
                </>
              ) : (
                <span>{l.out}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
