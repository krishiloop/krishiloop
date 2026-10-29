import type { CSSProperties } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useI18n, type Key } from '../../lib/i18n';
import { STORY } from '../story/storyData';

/** The five steps, clockwise from the top. The light takes 2 s per step, so step k lights at k × 2 s (one clock). */
const STEPS: { key: Key; n: string }[] = [
  { key: 'story.loop.see', n: '01' },
  { key: 'story.loop.decide', n: '02' },
  { key: 'story.loop.speak', n: '03' },
  { key: 'story.loop.prove', n: '04' },
  { key: 'story.loop.learn', n: '05' },
];
const R = 41; // track radius, % of the stage
const TICKS_MINOR = 120;
const TICKS_MAJOR = 20;

/**
 * The hero's picture of the product: the loop. A light travels the ring through See, Decide, Speak, Prove and
 * Learn. At Prove a real receipt is stamped Authentic; at Learn its rule is withdrawn, the stamp turns Recalled and
 * an ember ring goes out (the recall reaching everyone who got that receipt). CSS loops on one 10 s clock keep every
 * part in step; a mouse adds a little depth (Motion springs on pointer events, no animation loop of our own).
 */
export function LoopStage({ play }: { play: boolean }) {
  const { t, lang } = useI18n();
  const reduce = useReducedMotion();
  const ref = STORY.calm.action.receipt.rule_refs[0];
  const title = (lang === 'bn' ? STORY.calm.action.title.bn : undefined) ?? STORY.calm.action.title.en;

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 18, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 60, damping: 18, mass: 0.6 });
  const farX = useTransform(sx, [-0.5, 0.5], [-6, 6]);
  const farY = useTransform(sy, [-0.5, 0.5], [-4, 4]);
  const nearX = useTransform(sx, [-0.5, 0.5], [12, -12]);
  const nearY = useTransform(sy, [-0.5, 0.5], [8, -8]);

  return (
    <div
      className="loop-stage relative aspect-square w-[var(--stage)] select-none [--stage:min(86vw,520px)]"
      data-play={play ? '' : undefined}
      role="img"
      aria-label={t('home.ring.label')}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      {/* far: a slow dial of tick marks */}
      <motion.div style={{ x: farX, y: farY }} className="absolute inset-0" aria-hidden>
        <div className="loop-in absolute inset-0" style={{ '--d': '0.5s' } as CSSProperties}>
          <svg viewBox="0 0 100 100" className="spin-slow size-full" style={{ '--spin': '140s' } as CSSProperties} fill="none">
            <circle cx="50" cy="50" r="49" stroke="currentColor" className="text-ink/25" strokeWidth="0.6" strokeDasharray={`0.18 ${(2 * Math.PI * 49) / TICKS_MINOR - 0.18}`} />
            <circle cx="50" cy="50" r="48.6" stroke="currentColor" className="text-ink/55" strokeWidth="1.3" strokeDasharray={`0.3 ${(2 * Math.PI * 48.6) / TICKS_MAJOR - 0.3}`} />
          </svg>
        </div>
      </motion.div>

      {/* the track, its light and the five steps */}
      <div className="absolute inset-0" aria-hidden>
        <svg viewBox="0 0 100 100" className="loop-in absolute inset-0 size-full" style={{ '--d': '0.3s' } as CSSProperties} fill="none">
          <circle cx="50" cy="50" r={R} stroke="currentColor" className="text-ink/20" strokeWidth="0.4" />
        </svg>
        <div className="loop-orbit absolute inset-0">
          <span className="loop-dot" style={{ left: '50%', top: `${50 - R}%` }} />
        </div>
        {STEPS.map((s, k) => {
          const a = ((-90 + k * 72) * Math.PI) / 180;
          return (
            <span
              key={s.key}
              className="loop-step"
              style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%`, '--k': k, '--d': `${0.6 + k * 0.08}s` } as CSSProperties}
            >
              <span className="mono text-[0.62rem] text-ink-3">{s.n}</span>
              <span>{t(s.key)}</span>
            </span>
          );
        })}
      </div>

      {/* near: the receipt, stamped at Prove, recalled at Learn */}
      <motion.div style={{ x: nearX, y: nearY }} className="absolute inset-0 grid place-items-center" aria-hidden>
        <span className="loop-ripple" />
        <div className="loop-in" style={{ '--d': '0.9s' } as CSSProperties}>
          <div className="paper-object loop-receipt">
            <p className="mono m-0 text-[0.6rem] uppercase tracking-[0.12em] text-ink-3">{t('home.ring.receipt')}</p>
            <p className="m-0 mt-1.5 line-clamp-3 text-[0.72rem] font-[560] leading-snug text-ink sm:text-[0.8rem]" lang={lang === 'bn' ? 'bn' : 'en'}>
              {title}
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-dashed border-rule-2 pt-2">
              <span className="mono text-[0.62rem] text-ink-2">
                {ref?.rule_id} · v{ref?.version}
              </span>
              <span className="mono text-[0.62rem] text-ink-3">{STORY.calm.plan.crop}</span>
            </div>
            <span className="loop-stamp loop-stamp-a stamp stamp-go">{t('home.ring.authentic')}</span>
            <span className="loop-stamp loop-stamp-r stamp stamp-stop">{t('home.ring.recalled')}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
