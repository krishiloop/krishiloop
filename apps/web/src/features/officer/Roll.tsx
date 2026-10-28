import { useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx';
import { motionReduced } from '../../lib/motionPref';
import { RollNumber } from '../../ui/RollNumber';

/**
 * A counter that rolls in when its value arrives and again when it changes (the digit columns slide up, ui.css `.roll`),
 * so a recall visibly moves "rule versions recalled" from 0 to 1. The final value is always the text in the DOM: nothing
 * renders "0" first. It reuses the shared RollNumber, remounted with the roll class on (RollNumber alone only rolls
 * numbers that scroll into view, and these sit at the top of the page).
 */
export function Roll({ value, className }: { value: string; className?: string }) {
  const first = useRef(true);
  const [rolling, setRolling] = useState(() => !motionReduced());
  const [gen, setGen] = useState(0);
  useEffect(() => {
    if (first.current) first.current = false;
    else if (!motionReduced()) {
      setRolling(true);
      setGen((g) => g + 1);
    }
    const id = window.setTimeout(() => setRolling(false), 760 + value.length * 45);
    return () => window.clearTimeout(id);
  }, [value]);
  return <RollNumber key={gen} value={value} className={cx(rolling && 'is-rolling', className)} />;
}
