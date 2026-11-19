import { useMemo, useState } from 'react';
import { ExternalLink, Lock, ReceiptText, ShieldQuestionMark, Sprout, TimerReset, UserRound, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum, pickText } from '../../lib/format';
import { cx } from '../../lib/cx';
import { Fold } from '../../ui/Fold';
import { sampleRecalls } from '../../lib/api/mocks';
import { DATA, localToday, parseRange, plan, receiptPreview, sprayWeek, type PackId, type PlanOutcome } from './engine';
import { Choice, Peek, Slider } from './parts';

export type CaseId = 'rice-tillering' | 'rice-booting' | 'potato-vegetative';
export const CASES: Record<CaseId, { pack: PackId; stage: string; country: 'BD' | 'KE' }> = {
  'rice-tillering': { pack: 'pack-bd-rice', stage: 'tillering', country: 'BD' },
  'rice-booting': { pack: 'pack-bd-rice', stage: 'booting', country: 'BD' },
  'potato-vegetative': { pack: 'pack-potato-late-blight', stage: 'vegetative', country: 'KE' },
};

type Word = 'spray' | 'dont_spray' | 'recheck' | 'officer';
const WORDS: { w: Word; icon: LucideIcon }[] = [
  { w: 'spray', icon: Lock },
  { w: 'dont_spray', icon: Sprout },
  { w: 'recheck', icon: TimerReset },
  { w: 'officer', icon: UserRound },
];
const TONE: Record<Word, string> = { spray: 'is-stop', dont_spray: 'is-go', recheck: 'is-stop', officer: 'is-wait' };

/**
 * "Should I spray?": the planner's own decision step (engine.ts plan(), a port of services/engine/planner.py, checked
 * against it in engine.test.ts) over the real rule packs. A rule taken back in the recall tool on this page is never
 * served here either: the plan then hands the decision to the officer, as the server does.
 */
export function SprayTool() {
  const { t, lang } = useI18n();
  const [c, setC] = useState<CaseId>('rice-tillering');
  const [females, setFemales] = useState(1);
  const [nymphs, setNymphs] = useState(4);
  const [prot, setProt] = useState<'yes' | 'no'>('no');
  const [hum, setHum] = useState(85);
  const [low, setLow] = useState(18);
  const [high, setHigh] = useState(28);
  const [rain, setRain] = useState(0);
  const recalled = sampleRecalls.use();
  const today = useMemo(() => localToday(), []);
  const { pack, stage } = CASES[c];
  const isRice = pack === 'pack-bd-rice';
  const params = DATA.packs[pack].params;

  const out = useMemo(() => {
    const profile = isRice ? { bph_females_per_hill: females, bph_nymphs_per_hill: nymphs } : { crop_protected: prot === 'yes' };
    return plan(pack, stage, profile, sprayWeek(hum, low, high, rain, today), today, new Set(recalled));
  }, [pack, stage, isRice, females, nymphs, prot, hum, low, high, rain, today, recalled]);

  const word: Word = out.status === 'ok' ? ((out.decision.action.decision ?? 'recheck') as Word) : 'officer';
  const n = (v: number) => fmtNum(v, lang);
  const [lo, hi] = parseRange(params.mild_temp_c_range ?? '10-25');
  const humid = out.facts.forecast_humid_mild_days as number | null;
  const heavy = out.facts.forecast_heavy_rain_days as number | null;
  const wordKey = `${word}|${out.status === 'ok' ? out.decision.rule_id : out.reason}`;

  return (
    <div className="try-split">
      <div className="try-controls">
        <Choice
          label={t('try.crop')}
          value={c}
          onChange={setC}
          testId="spray-case"
          options={(Object.keys(CASES) as CaseId[]).map((k) => ({ value: k, label: t(`try.case.${k}` as Key) }))}
        />
        <p className="try-pack">{t(`try.pack.${pack}` as Key)}</p>

        {isRice ? (
          <fieldset className="try-group">
            <legend className="try-group-title">{t('try.insects')}</legend>
            <Slider label={t('try.females')} value={females} min={0} max={6} onChange={setFemales} say={(v) => t('try.perHill', { n: n(v) })} testId="spray-females" />
            <Slider label={t('try.nymphs')} value={nymphs} min={0} max={20} onChange={setNymphs} say={(v) => t('try.perHill', { n: n(v) })} testId="spray-nymphs" />
          </fieldset>
        ) : (
          <Choice
            label={t('try.protected')}
            value={prot}
            onChange={setProt}
            testId="spray-protected"
            options={[
              { value: 'no', label: t('try.no') },
              { value: 'yes', label: t('try.yes') },
            ]}
          />
        )}

        <fieldset className="try-group">
          <legend className="try-group-title">{t('try.week')}</legend>
          <Slider label={t('try.humidity')} value={hum} min={40} max={100} step={5} onChange={setHum} say={(v) => t('try.unit.pct', { n: n(v) })} testId="spray-humidity" />
          <div className="try-two">
            <Slider label={t('try.low')} value={low} min={4} max={30} onChange={(v) => { setLow(v); if (v > high) setHigh(v); }} say={(v) => t('try.unit.c', { n: n(v) })} testId="spray-low" />
            <Slider label={t('try.high')} value={high} min={10} max={42} onChange={(v) => { setHigh(v); if (v < low) setLow(v); }} say={(v) => t('try.unit.c', { n: n(v) })} testId="spray-high" />
          </div>
          <Slider label={t('try.rain')} value={rain} min={0} max={60} onChange={setRain} say={(v) => t('try.unit.mm', { n: n(v) })} testId="spray-rain" />
        </fieldset>
        <Peek to="spray-answer" label={t('try.answer')} word={t(`try.word.${word}` as Key)} tone={TONE[word]} flipKey={wordKey} />
      </div>

      <div id="spray-answer" className="try-result" aria-live="polite" data-testid="spray-result" data-word={word} data-rule={out.status === 'ok' ? out.decision.rule_id : ''} data-reason={out.status === 'ok' ? '' : out.reason}>
        <p className="eyebrow">{t('try.answer')}</p>
        <ol className="try-scale" aria-hidden>
          {WORDS.map(({ w, icon: Icon }) => (
            <li key={w} className={cx('try-scale-step', w === word && cx('is-on', TONE[w]), w === 'spray' && 'is-locked')}>
              <Icon size={14} strokeWidth={2} />
              {t(`try.word.${w}` as Key)}
            </li>
          ))}
        </ol>
        <p className={cx('try-word', TONE[word])} key={wordKey} data-testid="spray-word">
          {t(`try.word.${word}` as Key)}
        </p>

        {out.status === 'ok' ? <RuleBlock rule={out.decision} /> : <Abstain out={out} />}

        <Fold>
        <dl className="try-facts">
          <div>
            <dt>{t('try.facts.humid', { n: humid == null ? '?' : n(humid) })}</dt>
            <dd>{t('try.facts.humidRule', { rh: n(Number(params.humid_rh_pct_min ?? 90)), lo: n(lo), hi: n(hi) })}</dd>
          </div>
          <div>
            <dt>{t('try.facts.rain', { n: heavy == null ? '?' : n(heavy) })}</dt>
            <dd>{t('try.facts.rainRule', { mm: n(Number(params.heavy_rain_mm ?? 10)) })}</dd>
          </div>
        </dl>
        <p className="try-team mt-2">{t('try.team')}</p>

        {out.status === 'ok' && out.others.length > 0 && (
          <div className="try-also">
            <p className="eyebrow">{t('try.also')}</p>
            <ul>
              {out.others.map((r) => {
                const title = pickText(r.action.title, lang);
                return (
                  <li key={r.rule_id}>
                    <span lang={title.lang}>{title.text}</span> <span className="mono text-ink-3">{r.rule_id}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        </Fold>

        <p className="try-never">
          <Lock size={14} aria-hidden /> {t('try.neverSpray')}
        </p>

        {out.status === 'ok' && <Preview pack={pack} out={out} />}
      </div>
    </div>
  );
}

function RuleBlock({ rule }: { rule: Extract<PlanOutcome, { status: 'ok' }>['decision'] }) {
  const { t, lang } = useI18n();
  const title = pickText(rule.action.title, lang);
  const src = rule.sources[0]!;
  const doc = DATA.docs[src.doc_id]!;
  return (
    <div className="try-rule" data-testid="spray-rule">
      <p className="try-rule-id">
        <span className="mono">{t('try.rule', { id: rule.rule_id, v: rule.version })}</span>
        <span className="chip">{t(`ui.review.${rule.review_level}` as Key)}</span>
      </p>
      <p className="try-rule-says">
        <span className="eyebrow block">{t('try.ruleSays')}</span>
        <span lang={title.lang}>{title.text}</span>
      </p>
      <Fold label={t('try.sourceSays')}>
        <blockquote className="try-quote" lang={doc.language}>
          “{src.quote}”
        </blockquote>
        <p className="try-src">
          <a href={doc.url} target="_blank" rel="noreferrer">
            {t('try.page', { doc: doc.publisher, page: fmtNum(src.page, lang) })}
            <ExternalLink size={12} aria-hidden className="ml-1 inline" />
          </a>
        </p>
      </Fold>
    </div>
  );
}

function Abstain({ out }: { out: Extract<PlanOutcome, { status: 'abstained' }> }) {
  const { t } = useI18n();
  return (
    <div className="try-abstain" data-testid="spray-abstain">
      <ShieldQuestionMark size={20} aria-hidden className="flex-none" />
      <div>
        <p className="font-semibold">{t(`try.abstain.${out.reason}` as Key, { rules: out.rules.join(', ') })}</p>
        {out.reason === 'rule_recalled' && <p className="mt-1 text-sm text-ink-2">{t('try.recalledHere')}</p>}
      </div>
    </div>
  );
}

/** What the server's receipt would carry, clearly NOT signed (planner._receipt, without the signature). */
function Preview({ pack, out }: { pack: PackId; out: Extract<PlanOutcome, { status: 'ok' }> }) {
  const { t, lang } = useI18n();
  const p = receiptPreview(pack, out.decision, out.facts);
  const title = pickText(p.rule.action.title, lang);
  return (
    <details className="try-preview" data-testid="spray-preview">
      <summary>
        <ReceiptText size={16} aria-hidden /> {t('try.rcpt.show')}
      </summary>
      <div className="try-paper">
        <header className="try-paper-head">
          <span className="eyebrow">{t('try.rcpt.title')}</span>
          <span className="chip chip-carbon" data-testid="spray-unsigned">
            {t('try.rcpt.unsigned')}
          </span>
        </header>
        <dl className="try-paper-rows">
          <dt>{t('try.rcpt.advice')}</dt>
          <dd>
            <strong>{t(`try.word.${p.rule.action.decision ?? 'recheck'}` as Key)}</strong> · <span lang={title.lang}>{title.text}</span>
          </dd>
          <dt>{t('try.rcpt.rule')}</dt>
          <dd className="mono">
            {p.rule.rule_id} v{p.rule.version} · {t(`ui.review.${p.rule.review_level}` as Key)}
          </dd>
          {p.sources.map((s, i) => (
            <div key={i} className="contents">
              <dt>{t('try.rcpt.source')}</dt>
              <dd>
                <span lang={s.language}>“{s.quote}”</span>
                <span className="block text-ink-3">{t('try.page', { doc: s.publisher, page: fmtNum(s.page, lang) })}</span>
              </dd>
            </div>
          ))}
          {p.params.length > 0 && (
            <>
              <dt>{t('try.rcpt.set')}</dt>
              <dd>
                {p.params.map((x) => (
                  <span key={x.name} className="block">
                    <span className="mono">
                      {x.name} = {String(x.value)}
                      {x.unit ? ` ${x.unit}` : ''}
                    </span>{' '}
                    <span className="text-wait">· {t('try.rcpt.notSource')}</span>
                  </span>
                ))}
              </dd>
            </>
          )}
          {p.data.length > 0 && (
            <>
              <dt>{t('try.rcpt.data')}</dt>
              <dd>
                {p.data.map((d) => (
                  <span key={d.variable} className="block">
                    {t(`try.rcpt.var.${d.variable}` as Key)}: <span className="mono">{t('try.rcpt.days', { n: fmtNum(d.value ?? 0, lang) })}</span>
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt>{t('try.rcpt.confidence')}</dt>
          <dd>{t(`try.rcpt.conf.${p.confidence}`)}</dd>
          <dt>{t('try.rcpt.engine')}</dt>
          <dd className="mono">planner v{DATA.planner_version}</dd>
        </dl>
        <p className="try-paper-note">{t('try.rcpt.note')}</p>
      </div>
    </details>
  );
}

