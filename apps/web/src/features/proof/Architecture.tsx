import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX, type RefObject } from 'react';
import {
  BadgeCheck,
  Binary,
  Camera,
  CloudSun,
  DoorOpen,
  FileBadge,
  GitBranch,
  Inbox,
  MessageCircleQuestion,
  QrCode,
  Save,
  ShieldCheck,
  Signature,
  Undo2,
  UserCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { useMotionReduced } from '../../lib/motionPref';
import { cx } from '../../lib/cx';
import { blob } from './sources';

type NodeId =
  | 'weather'
  | 'snapshot'
  | 'rules'
  | 'planner'
  | 'validator'
  | 'signer'
  | 'receipt'
  | 'verifier'
  | 'status'
  | 'recall'
  | 'router'
  | 'inbox'
  | 'photo'
  | 'verdicts'
  | 'gate'
  | 'areacred';
type Lane = 'main' | 'trust' | 'stop' | 'go';

interface ArchNode {
  id: NodeId;
  row: number;
  col: number;
  icon: LucideIcon;
  lane: Lane;
  src: string;
}

/** One request's path, left to right, with the side paths above (ask, recall) and below (photo trust). */
const NODES: ArchNode[] = [
  { id: 'weather', row: 2, col: 1, icon: CloudSun, lane: 'main', src: 'services/engine/snapshot.py' },
  { id: 'snapshot', row: 2, col: 2, icon: Save, lane: 'main', src: 'services/engine/snapshot.py' },
  { id: 'rules', row: 2, col: 3, icon: GitBranch, lane: 'main', src: 'tools/check_quotes.py' },
  { id: 'planner', row: 2, col: 4, icon: Workflow, lane: 'main', src: 'services/engine/planner.py' },
  { id: 'validator', row: 2, col: 5, icon: ShieldCheck, lane: 'main', src: 'services/engine/validator.py' },
  { id: 'signer', row: 2, col: 6, icon: Signature, lane: 'trust', src: 'services/trust/vc.py' },
  { id: 'receipt', row: 2, col: 7, icon: QrCode, lane: 'trust', src: 'contracts/schemas/receipt.schema.json' },
  { id: 'verifier', row: 2, col: 8, icon: BadgeCheck, lane: 'trust', src: 'services/trust/vc.py' },
  { id: 'inbox', row: 1, col: 2, icon: Inbox, lane: 'main', src: 'services/engine/inbox.py' },
  { id: 'router', row: 1, col: 3, icon: MessageCircleQuestion, lane: 'main', src: 'services/ask/graph.py' },
  { id: 'recall', row: 1, col: 7, icon: Undo2, lane: 'stop', src: 'services/trust/store.py' },
  { id: 'status', row: 1, col: 8, icon: Binary, lane: 'stop', src: 'services/trust/vc.py' },
  { id: 'photo', row: 3, col: 3, icon: Camera, lane: 'go', src: 'services/vision/service.py' },
  { id: 'verdicts', row: 3, col: 4, icon: UserCheck, lane: 'go', src: 'services/vision/ledger.py' },
  { id: 'gate', row: 3, col: 5, icon: DoorOpen, lane: 'go', src: 'rules/policy/photo-trust.yaml' },
  { id: 'areacred', row: 3, col: 6, icon: FileBadge, lane: 'go', src: 'services/trust/vc.py' },
];
const BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<NodeId, ArchNode>;

interface Edge {
  from: NodeId;
  to: NodeId;
  lane: 'main' | 'stop' | 'go';
  /** when the intro pulse passes, in ms */
  at: number;
}
const EDGES: Edge[] = [
  { from: 'weather', to: 'snapshot', lane: 'main', at: 0 },
  { from: 'snapshot', to: 'rules', lane: 'main', at: 160 },
  { from: 'rules', to: 'planner', lane: 'main', at: 320 },
  { from: 'planner', to: 'validator', lane: 'main', at: 480 },
  { from: 'validator', to: 'signer', lane: 'main', at: 640 },
  { from: 'signer', to: 'receipt', lane: 'main', at: 800 },
  { from: 'receipt', to: 'verifier', lane: 'main', at: 960 },
  { from: 'rules', to: 'router', lane: 'main', at: 400 },
  { from: 'router', to: 'inbox', lane: 'main', at: 720 },
  { from: 'router', to: 'validator', lane: 'main', at: 720 },
  { from: 'recall', to: 'status', lane: 'stop', at: 1300 },
  { from: 'status', to: 'verifier', lane: 'stop', at: 1460 },
  { from: 'photo', to: 'verdicts', lane: 'go', at: 1500 },
  { from: 'verdicts', to: 'gate', lane: 'go', at: 1660 },
  { from: 'gate', to: 'areacred', lane: 'go', at: 1820 },
  { from: 'signer', to: 'areacred', lane: 'go', at: 1100 },
  { from: 'areacred', to: 'verifier', lane: 'go', at: 1980 },
];
const edgeId = (e: Edge) => `${e.from}-${e.to}`;

const label = (id: NodeId) => `proof.arch.${id}` as Key;
const explain = (id: NodeId) => `proof.arch.${id}.exp` as Key;

/* ------------------------------------------------------------------ helpers */
const wide = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      wide?.addEventListener('change', cb);
      return () => wide?.removeEventListener('change', cb);
    },
    () => !!wide?.matches,
    () => true,
  );
}

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
  cx: number;
  cy: number;
}

/** An orthogonal connector: straight along a row or a column, else out sideways and down/up into the target (8 px corner). */
function route(a: Box, b: Box): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  if (Math.abs(a.cy - b.cy) < 6) {
    const right = b.cx > a.cx;
    return `M${f(right ? a.r : a.l)} ${f(a.cy)}H${f(right ? b.l : b.r)}`;
  }
  if (Math.abs(a.cx - b.cx) < 6) {
    const down = b.cy > a.cy;
    return `M${f(a.cx)} ${f(down ? a.b : a.t)}V${f(down ? b.t : b.b)}`;
  }
  const right = b.cx > a.cx;
  const down = b.cy > a.cy;
  const r = 8;
  const sx = right ? 1 : -1;
  const sy = down ? 1 : -1;
  return `M${f(right ? a.r : a.l)} ${f(a.cy)}H${f(b.cx - sx * r)}Q${f(b.cx)} ${f(a.cy)} ${f(b.cx)} ${f(a.cy + sy * r)}V${f(down ? b.t : b.b)}`;
}

/* ------------------------------------------------------------------ the diagram */
/**
 * The architecture of one request, as a diagram you can read and press. Every step is a real button; pressing it shows
 * its one-line explanation and the file that implements it. On wide screens the steps sit on a grid and the connectors are
 * measured from the DOM into one SVG; on phones the paths become four vertical lanes.
 *
 * Motion explains the flow and stops: one pulse travels the paths when the diagram first scrolls into view (about 3 s,
 * once), and hovering or focusing a step pulses its own connections. Nothing loops; reduced motion shows no pulses.
 */
export function Architecture() {
  const { t } = useI18n();
  const isWide = useWide();
  const reduced = useMotionReduced();
  const [selected, setSelected] = useState<NodeId>('signer');
  const [runs, setRuns] = useState<Record<string, { n: number; d: number }>>({});
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<NodeId, HTMLButtonElement | null>>>({});

  // the intro pulse, once, when the diagram scrolls into view
  useEffect(() => {
    if (reduced) return;
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        setRuns(Object.fromEntries(EDGES.map((edge) => [edgeId(edge), { n: 1, d: edge.at }])));
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, isWide]);

  const pulse = useCallback(
    (id: NodeId) => {
      if (reduced) return;
      setRuns((was) => {
        const next = { ...was };
        for (const e of EDGES) {
          if (e.to === id) next[edgeId(e)] = { n: (was[edgeId(e)]?.n ?? 0) + 1, d: 0 };
          if (e.from === id) next[edgeId(e)] = { n: (was[edgeId(e)]?.n ?? 0) + 1, d: 260 };
        }
        return next;
      });
    },
    [reduced],
  );

  const node = (n: ArchNode, className?: string, style?: CSSProperties) => {
    const Icon = n.icon;
    return (
      <button
        key={n.id}
        type="button"
        className={cx('pa-node', className)}
        style={style}
        data-lane={n.lane}
        aria-pressed={selected === n.id}
        aria-controls="pa-caption"
        onClick={() => setSelected(n.id)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && pulse(n.id)}
        onFocus={() => pulse(n.id)}
        data-testid={`arch-${n.id}`}
        ref={(el) => {
          refs.current[n.id] = el;
        }}
      >
        <Icon size={16} className="pa-ico shrink-0" aria-hidden />
        <span>
          <b>{t(label(n.id))}</b>
        </span>
      </button>
    );
  };
  const cur = BY_ID[selected];

  return (
    <div className="pa" ref={wrap} data-testid="architecture">
      {isWide ? <Desktop node={node} refs={refs} runs={runs} /> : <Phones node={node} reduced={reduced} />}

      <div className="pa-cap mt-6" id="pa-caption" aria-live="polite" data-testid="arch-caption">
        <span className="mt-1 text-ink-2" aria-hidden>
          <cur.icon size={20} />
        </span>
        <div className="pa-cap-in" key={selected}>
          <p className="m-0 font-semibold">{t(label(selected))}</p>
          <p className="m-0 mt-1 max-w-[70ch] text-ink-2">{t(explain(selected))}</p>
          <a className="link mono mt-2 inline-flex min-h-11 items-center text-[0.78rem]" href={blob(cur.src)} target="_blank" rel="noreferrer">
            {cur.src}
          </a>
        </div>
      </div>

      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[0.82rem] text-ink-2" aria-label={t('proof.arch.legend')}>
        <li className="inline-flex items-center gap-2">
          <i className="inline-block h-[3px] w-6 rounded bg-ink" aria-hidden /> {t('proof.arch.legend.advice')}
        </li>
        <li className="inline-flex items-center gap-2">
          <i className="inline-block h-[3px] w-6 rounded bg-stop" aria-hidden /> {t('proof.arch.legend.recall')}
        </li>
        <li className="inline-flex items-center gap-2">
          <i className="inline-block h-[3px] w-6 rounded bg-go" aria-hidden /> {t('proof.arch.legend.photo')}
        </li>
      </ul>
    </div>
  );
}

type NodeRender = (n: ArchNode, className?: string, style?: CSSProperties) => JSX.Element;

function Desktop({ node, refs, runs }: { node: NodeRender; refs: RefObject<Partial<Record<NodeId, HTMLButtonElement | null>>>; runs: Record<string, { n: number; d: number }> }) {
  const grid = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ id: string; d: string; lane: Edge['lane'] }[]>([]);

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const g = el.getBoundingClientRect();
      const box = (id: NodeId): Box | null => {
        const r = refs.current[id]?.getBoundingClientRect();
        if (!r) return null;
        const l = r.left - g.left;
        const t = r.top - g.top;
        return { l, r: l + r.width, t, b: t + r.height, cx: l + r.width / 2, cy: t + r.height / 2 };
      };
      const next: { id: string; d: string; lane: Edge['lane'] }[] = [];
      for (const e of EDGES) {
        const a = box(e.from);
        const b = box(e.to);
        if (a && b) next.push({ id: edgeId(e), d: route(a, b), lane: e.lane });
      }
      setLines(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [refs]);

  return (
    <div className="pa-grid" ref={grid}>
      <svg className="pa-lines" aria-hidden>
        <defs>
          <marker id="pa-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8z" className="pa-arrow" />
          </marker>
        </defs>
        {lines.map((l) => (
          <path key={`b-${l.id}`} className="pa-base" data-lane={l.lane === 'main' ? undefined : 'trust'} d={l.d} markerEnd="url(#pa-arrow)" />
        ))}
        {lines.map((l) => {
          const run = runs[l.id];
          return <path key={`p-${l.id}-${run?.n ?? 0}`} className={cx('pa-pulse', run && 'is-run')} data-lane={l.lane} d={l.d} pathLength={100} style={{ ['--d' as string]: `${run?.d ?? 0}ms` }} />;
        })}
      </svg>
      {NODES.map((n) => node(n, undefined, { gridRow: n.row, gridColumn: n.col }))}
    </div>
  );
}

const LANES: { key: Key; ids: NodeId[]; join?: Key }[] = [
  { key: 'proof.arch.lane.advice', ids: ['weather', 'snapshot', 'rules', 'planner', 'validator', 'signer', 'receipt', 'verifier'] },
  { key: 'proof.arch.lane.recall', ids: ['recall', 'status'], join: 'proof.arch.join.verifier' },
  { key: 'proof.arch.lane.ask', ids: ['router', 'inbox'], join: 'proof.arch.join.validator' },
  { key: 'proof.arch.lane.photo', ids: ['photo', 'verdicts', 'gate', 'areacred'], join: 'proof.arch.join.verifier' },
];

function Phones({ node, reduced }: { node: NodeRender; reduced: boolean }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setRun(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return (
    <div className="grid gap-8" ref={box}>
      {LANES.map((lane, i) => (
        <div key={lane.key}>
          <h3 className="eyebrow mb-3">{t(lane.key)}</h3>
          <ol className={cx('pm-lane', run && 'is-run')} style={{ ['--d' as string]: `${i * 260}ms` }}>
            {lane.ids.map((id) => (
              <li key={id}>{node(BY_ID[id])}</li>
            ))}
          </ol>
          {lane.join ? <p className="pm-join pl-[26px]">{t(lane.join)}</p> : null}
        </div>
      ))}
    </div>
  );
}
