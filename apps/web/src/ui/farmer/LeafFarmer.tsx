import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';
import { clamp01, eo, eob, farmer, fk, ik, phone, seg, sickLeaf, type Pose } from './leafKit';
import './leafFarmer.css';

/**
 * KrishiLoop's farmer: one man built of leaves, rice blades and grains, in his woven mathal hat. He stands on many
 * pages and shows what the page is about with his face and hands (an expression is a `mood`). Leaves fly in and gather
 * into him the first time he comes on screen. Pure SVG; it moves only while on screen, at up to 30 frames a second,
 * and stands still for anyone who asks for reduced motion. An ILLUSTRATION, never data.
 */
export type Mood =
  | 'calm'
  | 'happy'
  | 'worried'
  | 'thinking'
  | 'curious'
  | 'surprised'
  | 'proud'
  | 'waving'
  | 'pointing'
  | 'phone'
  | 'leaf'
  | 'scan';

type Target = Pose & { hd: number; lift: number; knit: number; smile: number; open: number; lid: number; phone: number; leaf: number; wave: number };

const chin = ik('N', 34, -672);
const hip = ik('N', -84, -420);
const wave = ik('F', 190, -880);
const point = ik('F', 340, -585);
const REST = { fu: -5, ff: -8, nu: 7, nf: -10 };
const FACE0 = { hd: 0, lift: 0, knit: 0, smile: 0.35, open: 0, lid: 0, phone: 0, leaf: 0, wave: 0 };

const MOODS: Record<Mood, Target> = {
  calm: { ...REST, ...FACE0 },
  happy: { ...FACE0, fu: -25, ff: -25, nu: 7, nf: -10, hd: -4, lift: 0.3, smile: 1, open: 0.8 },
  worried: { ...FACE0, ...REST, nu: chin.u + 6, nf: chin.f + 10, hd: 7, lift: 0.25, knit: 1, smile: -0.6, lid: 0.15 },
  thinking: { ...FACE0, ...REST, nu: chin.u, nf: chin.f, hd: 5, lift: 0.5, knit: 0.55, smile: -0.15, lid: 0.1 },
  curious: { ...FACE0, fu: -62, ff: -58, nu: 7, nf: -10, hd: 7, lift: 0.7, knit: 0.15, smile: 0.15, open: 0.15, leaf: 1 },
  surprised: { ...FACE0, fu: -18, ff: -40, nu: -14, nf: -30, hd: -6, lift: 1, smile: 0, open: 0.75 },
  proud: { ...FACE0, ...REST, nu: hip.u, nf: hip.f, hd: -6, lift: 0.2, smile: 0.8, open: 0.3 },
  waving: { ...FACE0, fu: wave.u, ff: wave.f, nu: 7, nf: -10, hd: -3, lift: 0.4, smile: 0.9, open: 0.5, wave: 1 },
  pointing: { ...FACE0, fu: point.u, ff: point.f, nu: 7, nf: -10, hd: 2, lift: 0.45, smile: 0.6, open: 0.2 },
  phone: { ...FACE0, ...REST, nu: -50, nf: -80, hd: 4, lift: 0.4, knit: 0.2, smile: 0.25, phone: 1 },
  leaf: { ...FACE0, fu: -62, ff: -58, nu: 7, nf: -10, hd: 7, lift: 0.2, knit: 1, smile: -0.5, lid: 0.15, leaf: 1 },
  scan: { ...FACE0, fu: -62, ff: -58, nu: -50, nf: -80, hd: 4, lift: 0.6, knit: 0.25, smile: 0.1, leaf: 1, phone: 1 },
};
const KEYS = Object.keys(MOODS.calm) as (keyof Target)[];

type Props = {
  mood?: Mood;
  /** moods over time, [seconds, mood]; it starts again whenever `scriptKey` changes */
  script?: [number, Mood][];
  scriptKey?: string | number;
  /** face left instead of right */
  flip?: boolean;
  /** leaves fly in and gather into him the first time he is seen (default on) */
  enter?: boolean;
  /** a still picture, no motion */
  still?: boolean;
  /** describe him for screen readers; without it he is decoration */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

const VB = { x: -170, y: -925, w: 560, h: 945 };

export function LeafFarmer({ mood = 'calm', script, scriptKey, flip = false, enter = true, still = false, label, className, style }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const cls = `lfm${uid}`;
  const host = useRef<SVGSVGElement>(null);
  const live = useRef({ mood, script, key: scriptKey as unknown, since: -1 });
  live.current.mood = mood;
  live.current.script = script;
  if (live.current.key !== scriptKey) {
    live.current.key = scriptKey;
    live.current.since = -1;
  }

  const art = useMemo(() => {
    const man = farmer(cls);
    const leaf = sickLeaf(`${cls}-leaf`, 'blast');
    return {
      man,
      leaf,
      markup: `${man.markup}${leaf.markup}<g class="${cls}-phw">${phone(`${cls}-ph`)}</g>`,
    };
  }, [cls]);

  useEffect(() => {
    const svg = host.current;
    if (!svg) return;
    const { man, leaf } = art;
    man.bind(svg);
    leaf.bind(svg);
    const phw = svg.querySelector(`.${cls}-phw`) as SVGGElement | null;
    const bar = svg.querySelector(`.${cls}-ph-bar`) as SVGElement | null;
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const calm = still || reduced;
    const cur: Target = { ...MOODS[live.current.mood] };
    const blinkAt = 1.2 + (uid.length % 5) * 0.37;
    let raf = 0;
    let visible = false;
    let born = -1;
    let last = 0;
    let prev = 0;

    const target = (now: number): Target => {
      const L = live.current;
      if (L.script && L.script.length) {
        if (L.since < 0) L.since = now;
        const ts = (now - L.since) / 1000;
        let m: Mood = L.script[0]![1];
        for (const [at, mm] of L.script) if (ts >= at) m = mm;
        return MOODS[m];
      }
      return MOODS[L.mood];
    };

    const draw = (now: number, dt: number) => {
      const t = now / 1000;
      const T = target(now);
      const k = calm ? 1 : 1 - Math.exp(-dt * 7);
      for (const key of KEYS) cur[key] += (T[key] - cur[key]) * k;
      const age = born < 0 ? 0 : (now - born) / 1000;
      const g = calm || !enter ? 1 : 0.3 + 0.7 * eo(seg(age, 0.05, 1.15));
      const hat = calm || !enter ? 1 : eob(seg(age, 0.75, 1.3), 1.6);
      const ph = (t + blinkAt) % 3.9;
      const blink = calm ? 0 : clamp01(ph < 0.09 ? ph / 0.09 : ph < 0.2 ? 1 - (ph - 0.09) / 0.11 : 0);
      const p = { fu: cur.fu, ff: cur.ff + (calm ? 0 : Math.sin(t * 7) * 16 * cur.wave), nu: cur.nu, nf: cur.nf };
      man.render({ t: calm ? 0 : t, g, hat, ...p, hd: cur.hd, lift: cur.lift, knit: cur.knit, smile: cur.smile, open: cur.open, lid: Math.max(cur.lid, blink) });
      const hf = fk(p, 'F');
      leaf.render({ x: hf.x, y: hf.y, a: -35 + (calm ? 0 : Math.sin(t * 2.4) * 3), s: cur.leaf, les: 1, heal: 0 });
      if (leaf.el) leaf.el.style.display = cur.leaf < 0.02 ? 'none' : '';
      if (phw) {
        const hn = fk(p, 'N');
        phw.setAttribute('transform', `translate(${hn.x.toFixed(1)} ${hn.y.toFixed(1)}) rotate(-8) scale(${Math.max(0.001, cur.phone).toFixed(3)})`);
        phw.style.display = cur.phone < 0.02 ? 'none' : '';
      }
      bar?.setAttribute('transform', `translate(0 ${calm ? 75 : ((t * 140) % 150).toFixed(1)})`);
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      if (born < 0) born = now;
      if (now - last >= 32) {
        draw(now, Math.min(0.1, (now - (prev || now)) / 1000));
        prev = now;
        last = now;
      }
      if (!calm) raf = requestAnimationFrame(frame);
    };
    draw(performance.now(), 1);
    if (enter && !calm) man.render({ t: 0, g: 0.3, hat: 0, ...REST, hd: 0 });
    const io = new IntersectionObserver(
      (es) => {
        visible = !!es[es.length - 1]?.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(frame);
      },
      { rootMargin: '80px' },
    );
    io.observe(svg);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [art, cls, uid, enter, still]);

  // a still picture still follows a new mood
  useEffect(() => {
    if (!still) return;
    const svg = host.current;
    if (!svg) return;
    const T = MOODS[mood];
    art.man.render({ t: 0, ...T });
  }, [still, mood, art]);

  const vbx = flip ? -(VB.x + VB.w) : VB.x;
  return (
    <svg
      ref={host}
      className={`lf leaf-farmer${className ? ` ${className}` : ''}`}
      viewBox={`${vbx} ${VB.y} ${VB.w} ${VB.h}`}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g transform={flip ? 'scale(-1 1)' : undefined} dangerouslySetInnerHTML={{ __html: art.markup }} />
    </svg>
  );
}
