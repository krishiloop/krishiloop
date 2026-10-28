import { useI18n, type Key } from '../../lib/i18n';
import { RollNumber } from '../../ui/RollNumber';
import { SectionHead } from './parts';

/** Five facts about the build, each a real count from the repo (packs, i18n, CI, MCP). Numbers roll in once. */
export function ProofStrip() {
  const { t } = useI18n();
  const items: [Key, Key][] = [
    ['story.strip.n.countries', 'story.strip.countries'],
    ['story.strip.n.rules', 'story.strip.rules'],
    ['story.strip.n.langs', 'story.strip.langs'],
    ['story.strip.n.tests', 'story.strip.tests'],
    ['story.strip.n.mcp', 'story.strip.mcp'],
  ];
  return (
    <section aria-label={t('story.strip.label')} className="border-y border-rule bg-sunk/40">
      <ul className="wrap m-0 grid list-none grid-cols-2 gap-x-6 gap-y-8 py-10 sm:grid-cols-3 lg:grid-cols-5 lg:py-12">
        {items.map(([n, label], i) => (
          <li key={n} className="flex flex-col" data-reveal style={{ ['--i' as string]: i }}>
            <RollNumber value={t(n)} className="t-title tabular-nums" />
            <span className="mt-2 text-sm leading-snug text-ink-2">{t(label)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 100 dots, `filled` of them ink: a share you can see at a glance. */
function Dots({ filled, total = 100 }: { filled: number; total?: number }) {
  return (
    <span className="mt-4 grid w-full max-w-[220px] grid-cols-[repeat(20,1fr)] gap-[3px]" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`aspect-square rounded-full ${i < filled ? 'bg-ink' : 'bg-rule'}`} />
      ))}
    </span>
  );
}

/**
 * The problem in six verified numbers (fact register rows GL-01, GL-02, GL-14, A3, D4, D1), big and short. Sources sit
 * in one disclosure, not under every line. Households and calls are shown side by side, never as a ratio.
 */
export function Problem() {
  const { t } = useI18n();
  const global: [Key, Key, number][] = [
    ['story.problem.n.farms', 'story.problem.farms', 1],
    ['story.problem.n.small', 'story.problem.small', 2],
    ['story.problem.n.loss', 'story.problem.loss', 3],
  ];
  const bd: [Key, Key, number][] = [
    ['story.problem.n.households', 'story.problem.households', 4],
    ['story.problem.n.calls', 'story.problem.calls', 5],
    ['story.problem.n.phones', 'story.problem.phones', 6],
  ];
  const sources: Key[] = ['story.problem.src.farms', 'story.problem.src.small', 'story.problem.src.loss', 'story.problem.src.households', 'story.problem.src.calls', 'story.problem.src.phones'];

  return (
    <section className="section cv" aria-labelledby="problem-title">
      <div className="wrap">
        <SectionHead eyebrow={t('story.problem.eyebrow')} title={t('story.problem.title')} id="problem-title" />
        <ul className="m-0 mt-14 grid list-none gap-x-10 gap-y-12 p-0 md:grid-cols-3">
          {global.map(([n, label, ref], i) => (
            <li key={n} className="border-t border-ink pt-5" data-reveal style={{ ['--i' as string]: i }}>
              <RollNumber value={t(n)} className="text-[clamp(3.4rem,2rem+5vw,6rem)] font-[680] leading-none tracking-[-0.03em] [font-stretch:80%]" />
              <p className="mt-3 max-w-[22ch] text-[1.08rem] leading-snug text-ink-2">
                {t(label)}
                <sup className="mono ml-1 text-[0.65em] text-ink-3">{ref}</sup>
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-16 rounded-[var(--radius-ui)] border border-rule bg-card p-6 sm:p-8" data-reveal>
          <p className="eyebrow">{t('story.problem.bd')}</p>
          <ul className="m-0 mt-5 grid list-none gap-8 p-0 md:grid-cols-3">
            {bd.map(([n, label, ref]) => (
              <li key={n}>
                <RollNumber value={t(n)} className="t-head tabular-nums" />
                <p className="mt-1.5 max-w-[26ch] text-sm leading-snug text-ink-2">
                  {t(label)}
                  <sup className="mono ml-1 text-[0.7em] text-ink-3">{ref}</sup>
                </p>
                {n === 'story.problem.n.phones' && <Dots filled={26} />}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-ink-3">{t('story.problem.note')}</p>
        </div>

        <details className="group mt-6 text-sm text-ink-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md py-2 font-medium text-ink-2 hover:text-ink">
            <span className="inline-block transition-transform duration-200 group-open:rotate-90" aria-hidden>
              ›
            </span>
            {t('story.problem.sources')}
          </summary>
          <ol className="mt-2 grid gap-1.5 pl-5">
            {sources.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ol>
        </details>
      </div>
    </section>
  );
}
