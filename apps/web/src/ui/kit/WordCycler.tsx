import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from './cn';
import { EASE_OUT } from './hooks';

/** One phrase at a time, rising in with a light blur. Pauses when `play` is false (off-screen, or before the intro). */
export function WordCycler({ words, interval = 2800, play = true, className }: { words: string[]; interval?: number; play?: boolean; className?: string }) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!play || words.length < 2) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % words.length), interval);
    return () => window.clearInterval(id);
  }, [play, interval, words.length]);
  const word = words[i % words.length] ?? '';
  return (
    <span className={cn('relative inline-grid align-bottom', className)}>
      <span className="sr-only">{words.join(' · ')}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={word}
          aria-hidden
          className="col-start-1 row-start-1 whitespace-nowrap"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: '55%', filter: 'blur(6px)' }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: '-55%', filter: 'blur(6px)' }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
