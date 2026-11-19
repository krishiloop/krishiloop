import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Database, FileCheck2, GitBranch, Headset, ScanLine, Scale, ShieldCheck, Smartphone } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { AnimatedBeam } from '../../ui/kit/AnimatedBeam';
import { spotlight, useOnScreen } from '../../ui/kit/hooks';
import { Head } from './Bands';

function Node({ nodeRef, icon, label, sub, tone }: { nodeRef: RefObject<HTMLDivElement | null>; icon: ReactNode; label: string; sub: string; tone?: 'sprout' | 'wait' | 'ember' }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div ref={nodeRef} className="flow-node" data-tone={tone}>
        {icon}
      </div>
      <div>
        <p className="m-0 text-[0.95rem] font-[560] leading-tight text-ink">{label}</p>
        <p className="m-0 mt-1 max-w-[16ch] text-[0.8rem] leading-snug text-ink-3">{sub}</p>
      </div>
    </div>
  );
}

const LEGEND: { cls: string; key: 'home.flow.k.data' | 'home.flow.k.receipt' | 'home.flow.k.unsure' | 'home.flow.k.verify' | 'home.flow.k.recall' }[] = [
  { cls: 'bg-sprout', key: 'home.flow.k.data' },
  { cls: 'bg-sprout', key: 'home.flow.k.receipt' },
  { cls: 'bg-wait', key: 'home.flow.k.unsure' },
  { cls: 'bg-carbon', key: 'home.flow.k.verify' },
  { cls: 'bg-ember', key: 'home.flow.k.recall' },
];

/**
 * The whole system in one picture (Magic UI AnimatedBeam pattern): lights travel the real paths. Open data and the
 * rules flow into a deterministic engine; a signed receipt goes to the farmer; doubtful cases go to the officer;
 * anyone can check a receipt against the engine's status list; a recall travels back to the farmer. Colour = meaning.
 */
export function FlowBeams() {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const on = useOnScreen(box);
  const data = useRef<HTMLDivElement>(null);
  const rules = useRef<HTMLDivElement>(null);
  const engine = useRef<HTMLDivElement>(null);
  const farmer = useRef<HTMLDivElement>(null);
  const anyone = useRef<HTMLDivElement>(null);
  const officer = useRef<HTMLDivElement>(null);

  return (
    <section className="section mesh cv" aria-labelledby="flow-title">
      <div className="wrap">
        <Head eyebrow={t('home.flow.eyebrow')} title={t('home.flow.title')} id="flow-title" lead={t('home.flow.note')} />

        <div ref={box} className="relative mt-16 rounded-[var(--radius-frame)] border border-rule px-3 py-12 sm:px-8 sm:py-16" data-offscreen={on ? undefined : ''} data-reveal>
          <div className="bg-dots pointer-events-none absolute inset-0 rounded-[inherit] opacity-50" aria-hidden />
          <div className="relative grid grid-cols-[1fr_1.35fr_1fr] items-center gap-y-14 sm:gap-x-6">
            <div className="flex flex-col gap-12">
              <Node nodeRef={data} icon={<Database size={24} aria-hidden />} label={t('story.hood.s1')} sub={t('story.hood.s1.sub')} />
              <Node nodeRef={rules} icon={<GitBranch size={24} aria-hidden />} label={t('story.hood.s2')} sub={t('story.hood.s2.sub')} />
            </div>

            <div ref={engine} className="surface relative z-[2] mx-auto w-full max-w-[300px] p-4 sm:p-6" {...spotlight()}>
              <p className="label m-0 text-center">{t('home.flow.engine')}</p>
              <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
                {(
                  [
                    [<Scale key="a" size={16} aria-hidden />, 'story.hood.s3', 'story.hood.s3.sub'],
                    [<ShieldCheck key="b" size={16} aria-hidden />, 'story.hood.s4', 'story.hood.s4.sub'],
                    [<FileCheck2 key="c" size={16} aria-hidden />, 'story.hood.s5', 'story.hood.s5.sub'],
                  ] as const
                ).map(([icon, k, sub]) => (
                  <li key={k} className="flex items-center gap-3 rounded-[12px] border border-rule bg-paper/60 px-3 py-2.5">
                    <span className="text-go">{icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-[560] text-ink">{t(k)}</span>
                      <span className="block truncate text-[0.74rem] text-ink-3">{t(sub)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-12">
              <Node nodeRef={farmer} icon={<Smartphone size={24} aria-hidden />} label={t('home.flow.farmer')} sub={t('home.flow.farmer.sub')} tone="sprout" />
              <Node nodeRef={anyone} icon={<ScanLine size={24} aria-hidden />} label={t('home.flow.anyone')} sub={t('home.flow.anyone.sub')} />
            </div>

            <div className="col-start-2">
              <Node nodeRef={officer} icon={<Headset size={24} aria-hidden />} label={t('home.flow.officer')} sub={t('home.flow.officer.sub')} tone="wait" />
            </div>
          </div>

          <AnimatedBeam containerRef={box} fromRef={data} toRef={engine} curvature={-30} delay={0} />
          <AnimatedBeam containerRef={box} fromRef={rules} toRef={engine} curvature={30} delay={0.5} />
          <AnimatedBeam containerRef={box} fromRef={engine} toRef={farmer} curvature={-30} delay={1.2} />
          <AnimatedBeam containerRef={box} fromRef={engine} toRef={officer} delay={1.8} color="var(--color-wait)" />
          <AnimatedBeam containerRef={box} fromRef={anyone} toRef={engine} curvature={30} delay={2.4} color="var(--color-carbon)" />
          <AnimatedBeam containerRef={box} fromRef={engine} toRef={farmer} curvature={40} delay={3.1} duration={3.4} color="var(--color-ember)" />
        </div>

        <ul className="m-0 mt-6 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[0.85rem] text-ink-2">
          {LEGEND.map((l, i) => (
            <li key={l.key} className="flex items-center gap-2" style={{ '--i': i } as CSSProperties}>
              <span className={`h-[3px] w-5 rounded-full ${l.cls}`} aria-hidden />
              {t(l.key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
