// this page's words (English loads per screen)
import '../../lib/i18n/strings.proof';
import { lazy, Suspense, type ReactNode } from 'react';
import { CircleCheck, CircleDashed, CircleDot, ExternalLink } from 'lucide-react';
import { ExternalButton } from '../../ui/Button';
import { RollNumber } from '../../ui/RollNumber';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { Architecture } from './Architecture';
import { ResultGroup, type GroupId } from './EvalTiles';
import { CheckYourself } from './CheckYourself';
import { REPRO, ACTIONS_URL, MCP_DOC, MCP_SERVERS, MCP_TESTS, PROMPT_LIBRARY, READ_THE_CODE, REGISTER, STANDARDS, TESTS, type StandardState } from './sources';
import './proof.css';

// the terminal sits below the fold: its own chunk, so the first visit does not pay for it
const Terminal = lazy(() => import('../../ui/kit/Terminal').then((m) => ({ default: m.Terminal })));

const SECTIONS = ['architecture', 'check', 'standards', 'mcp', 'tests', 'data', 'prompts'] as const;
type SectionId = (typeof SECTIONS)[number];
/** the page reads in four parts: three groups of results, then how it was built */
const PARTS = ['safety', 'photo', 'speed', 'built'] as const;
const PART_TONE = { safety: 'terracotta', photo: 'moss', speed: 'monsoon', built: 'hyacinth' } as const;

const STATE_ICON: Record<StandardState, ReactNode> = {
  implemented: <CircleCheck size={14} aria-hidden />,
  partial: <CircleDot size={14} aria-hidden />,
  planned: <CircleDashed size={14} aria-hidden />,
};

/**
 * /proof: the evidence hub for technical judges. Every number cites the file it comes from (sources.ts), the bad results
 * stay in, and each claim is marked implemented, partial or planned. The page is scannable: a jump list, then one idea per
 * section, with the long detail living in the linked files.
 */
export default function ProofPage() {
  const { t, lang } = useI18n();
  const num = (n: number) => fmtNum(n, lang);
  const toolCount = MCP_SERVERS.reduce((a, s) => a + s.tools.length, 0);

  return (
    <div className="pf-page botanic-bg pb-10">
      <section className="pf-hero-v5" aria-labelledby="pf-title">
        <div className="wrap pf-hero pt-10 pb-12 sm:pt-14">
          <div>
            <p className="eyebrow hero-rise">{t('proof.eyebrow')}</p>
            <h1 id="pf-title" className="t-title hero-rise mt-4 max-w-[18ch]" style={{ ['--i' as string]: 1 }} data-testid="proof-title">
              {t('proof.title')}
            </h1>
            <p className="t-lead hero-rise mt-5 max-w-[52ch]" style={{ ['--i' as string]: 2 }}>
              {t('proof.lead')}
            </p>
          </div>
          <nav className="pf-parts hero-rise" style={{ ['--i' as string]: 3 }} aria-label={t('proof.jump')}>
            {PARTS.map((id, i) => (
              <a key={id} href={`#part-${id}`} data-tone={PART_TONE[id]}>
                <span className="pf-jump-n mono" aria-hidden>
                  {fmtNum(i + 1, lang, { minimumIntegerDigits: 2 })}
                </span>
                <span>
                  <b>{t(`proof.part.${id}` as Key)}</b>
                  <span className="pf-parts-s">{t(`proof.part.${id}.sub` as Key)}</span>
                </span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      {(['safety', 'photo', 'speed'] as GroupId[]).map((g) => (
        <section key={g} id={`part-${g}`} className="pf-part scroll-mt-20" data-tone={PART_TONE[g]} aria-labelledby={`pf-part-${g}`} data-testid={`part-${g}`}>
          <div className="wrap section">
            <p className="eyebrow">{t(`proof.part.${g}` as Key)}</p>
            <h2 id={`pf-part-${g}`} className="t-title mt-3 max-w-[22ch]">
              {t(`proof.part.${g}.title` as Key)}
            </h2>
            <p className="t-lead mt-4 max-w-[56ch]">{t(`proof.part.${g}.lead` as Key)}</p>
            <div className="mt-10">
              <ResultGroup id={g} />
            </div>
          </div>
        </section>
      ))}

      <section id="part-built" className="pf-part pf-built scroll-mt-20" data-tone="hyacinth" aria-labelledby="pf-part-built">
        <div className="wrap pt-14 sm:pt-20">
          <p className="eyebrow">{t('proof.part.built')}</p>
          <h2 id="pf-part-built" className="t-title mt-3 max-w-[22ch]">
            {t('proof.part.built.title')}
          </h2>
          <p className="t-lead mt-4 max-w-[56ch]">{t('proof.part.built.lead')}</p>
          <nav className="pf-jump mt-8" aria-label={t('proof.part.built')}>
            {SECTIONS.map((id, i) => (
              <a key={id} href={`#${id}`}>
                <span className="pf-jump-n mono" aria-hidden>
                  {fmtNum(i + 1, lang, { minimumIntegerDigits: 2 })}
                </span>
                {t(`proof.nav.${id}` as Key)}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <Section id="architecture" title={t('proof.arch.title')} lead={t('proof.arch.lead')}>
        <Architecture />
      </Section>

      <Section id="check" title={t('proof.check.title')} lead={t('proof.check.lead')} tone="sunk">
        <div className="pf-check-grid">
          <div className="paper p-5 sm:p-7">
            <CheckYourself />
          </div>
          <Suspense fallback={<div className="skeleton h-[320px] rounded-[22px]" aria-hidden />}>
            <Terminal
            title={t('proof.term.title')}
            copyLabel={t('proof.term.copy')}
            copiedLabel={t('proof.term.copied')}
            lines={REPRO.flatMap((r) => [{ cmd: r.cmd }, ...(r.out ? [{ out: t(`proof.term.${r.out}` as Key) }] : [])])}
            />
          </Suspense>
        </div>
      </Section>

      <Section id="standards" title={t('proof.std.title')} lead={t('proof.std.lead')} tone="sunk">
        <ul className="pf-std" data-testid="standards">
          {STANDARDS.map((s, i) => (
            <li key={s.id} data-reveal style={{ ['--i' as string]: i % 6 }} data-state={s.state}>
              <span className="pf-state" data-state={s.state}>
                {STATE_ICON[s.state]}
                {t(`proof.std.state.${s.state}` as Key)}
              </span>
              <span>
                <b className="font-semibold">{s.name}</b>
                <span className="block text-[0.88rem] text-ink-2">{t(`proof.std.${s.id}` as Key)}</span>
                {s.source ? (
                  <a className="link mono mt-1 inline-flex min-h-8 items-center text-[0.72rem]" href={s.source.href} target="_blank" rel="noreferrer">
                    {s.source.path}
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="mcp" title={t('proof.mcp.title', { servers: num(MCP_SERVERS.length), tools: num(toolCount) })} lead={t('proof.mcp.lead')}>
        <div className="pf-servers" data-testid="mcp-servers">
          {MCP_SERVERS.map((s, i) => (
            <div key={s.name} className="pf-server" data-reveal style={{ ['--i' as string]: i }}>
              <a className="link mono text-[0.78rem] font-semibold" href={s.source.href} target="_blank" rel="noreferrer">
                {s.name}
              </a>
              <div className="mt-2">
                {s.tools.map((tool) => (
                  <span key={tool} className="pf-tool">
                    {tool}
                    {s.web?.includes(tool) ? <span className="ml-1.5 text-ink-3">· {t('proof.mcp.web')}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <ul className="tp-facts mt-6 grid list-none gap-2 p-0 text-[0.92rem] text-ink-2 md:grid-cols-2">
          {(['proof.mcp.f1', 'proof.mcp.f2', 'proof.mcp.f3', 'proof.mcp.f4'] as const).map((k) => (
            <li key={k} className="flex gap-2">
              <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
              {t(k, { tests: num(TESTS.mcp) })}
            </li>
          ))}
        </ul>
        <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1">
          <a className="link mono text-[0.78rem]" href={MCP_DOC.href} target="_blank" rel="noreferrer">
            {MCP_DOC.path}
          </a>
          <a className="link mono text-[0.78rem]" href={MCP_TESTS.href} target="_blank" rel="noreferrer">
            {MCP_TESTS.path}
          </a>
        </p>
      </Section>

      <Section id="tests" title={t('proof.tests.title')} lead={t('proof.tests.lead')} tone="sunk">
        <div className="grid gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-3" data-testid="tests">
          <Stat value={num(TESTS.backend)} label={t('proof.tests.backend')} source={TESTS.ci} />
          <Stat value={num(TESTS.browserCrypto)} label={t('proof.tests.browser', { n: num(TESTS.receipts) })} source={TESTS.web} />
          <Stat value={num(TESTS.mcp)} label={t('proof.tests.mcp')} source={MCP_TESTS} />
        </div>
        <ul className="mt-6 grid list-none gap-2 p-0 text-[0.92rem] text-ink-2 md:grid-cols-2">
          {(['proof.tests.f1', 'proof.tests.f2', 'proof.tests.f3', 'proof.tests.f4'] as const).map((k) => (
            <li key={k} className="flex gap-2">
              <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
              {t(k)}
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <ExternalButton href={ACTIONS_URL} variant="secondary">
            {t('proof.tests.actions')}
          </ExternalButton>
        </div>
      </Section>

      <Section id="data" title={t('proof.data.title')} lead={t('proof.data.lead')}>
        <div className="overflow-x-auto">
          <table className="pf-reg" data-testid="register">
            <thead>
              <tr>
                <th scope="col">{t('proof.data.col.what')}</th>
                <th scope="col">{t('proof.data.col.terms')}</th>
                <th scope="col">{t('proof.data.col.file')}</th>
              </tr>
            </thead>
            <tbody>
              {REGISTER.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="font-medium">
                    {r.name}
                    <span className="block text-[0.8rem] font-normal text-ink-3">{t(`proof.data.${r.id}` as Key)}</span>
                  </th>
                  <td className="mono text-[0.78rem]">{r.licence}</td>
                  <td>
                    <a className="link mono text-[0.72rem] [overflow-wrap:anywhere]" href={r.source.href} target="_blank" rel="noreferrer">
                      {r.source.path}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="prompts" title={t('proof.prompts.title')} lead={t('proof.prompts.lead')} tone="sunk">
        <div className="flex flex-wrap gap-3">
          <ExternalButton href={PROMPT_LIBRARY.index.href} variant="primary">
            {t('proof.prompts.open')}
          </ExternalButton>
          <ExternalButton href={PROMPT_LIBRARY.brief.href} variant="secondary">
            {t('proof.prompts.brief')}
          </ExternalButton>
        </div>
        <h3 className="eyebrow mt-10">{t('proof.code.title')}</h3>
        <ul className="m-0 mt-3 grid list-none gap-0 p-0 sm:grid-cols-2 lg:grid-cols-5">
          {READ_THE_CODE.map((s) => (
            <li key={s.path} className="border-t border-rule">
              <a className="link mono flex min-h-12 items-center gap-2 text-[0.8rem]" href={s.href} target="_blank" rel="noreferrer">
                <ExternalLink size={13} aria-hidden /> {s.path}
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ id, title, lead, tone, children }: { id: SectionId; title: string; lead: string; tone?: 'sunk'; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section id={id} className={`rule-t scroll-mt-20 ${tone === 'sunk' ? 'pf-sunk' : ''}`} aria-labelledby={`pf-${id}`} data-testid={`section-${id}`}>
      <div className="wrap section">
        <p className="eyebrow">{t(`proof.nav.${id}` as Key)}</p>
        <h2 id={`pf-${id}`} className="t-title mt-3 max-w-[22ch]">
          {title}
        </h2>
        <p className="t-lead mt-4 max-w-[56ch]">{lead}</p>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function Stat({ value, label, source }: { value: string; label: string; source: { path: string; href: string } }) {
  return (
    <div className="flex flex-col gap-2 bg-card p-5" data-reveal>
      <span className="pf-num">
        <RollNumber value={value} />
      </span>
      <span className="text-[0.92rem] leading-snug">{label}</span>
      <a className="link mono mt-auto text-[0.72rem] [overflow-wrap:anywhere]" href={source.href} target="_blank" rel="noreferrer">
        {source.path}
      </a>
    </div>
  );
}
