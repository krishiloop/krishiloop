import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import type { Key, Params } from '../../lib/i18n';
import type { AreaStats, DataSource, PhotoCase, Plan, Receipt } from '../../lib/api/types';
import type { AskOutcome } from '../../lib/api/ask';
import type { VerifyOutcome } from '../../lib/api/client';
import { meterView } from '../trust/gate';
import { readPipeline } from './askPath';

/**
 * The inspector: a real log of what this tab's farmer app did, newest first, for technical judges ("is this real?").
 * Every entry is written from the answer the app actually received: the plan id and its data mode and time, each
 * action's rule id and version, the receipt credential and its signature suite, the Ask router's LangGraph path and
 * retrieval stages, abstention codes, the photo case route and the area gate. Kept for this tab (sessionStorage).
 * Values are data (ids, codes, versions) and are shown as they came; only the labels are translated.
 */
export type InsKind = 'boot' | 'plan' | 'ask' | 'photo' | 'verify' | 'recall' | 'error';
export type InsTone = 'go' | 'wait' | 'stop' | 'carbon';
/** a value part: raw data, or a dictionary key (so it follows the language) */
export type Part = string | [Key, Params?];
export interface InsLine {
  k: Key;
  v: Part[];
  tone?: InsTone;
}
/**
 * "Behind the tap": the same event read as a path of steps (retrieval, rule, validator, receipt; or the officer). Built
 * only from what the answer itself says (the Ask router's own path, the receipt's rule and validator version, the
 * verifier's verdict). `ok` ran; `skip` was skipped; `wait` went to the officer; `stop` stopped there.
 */
export type TraceState = 'ok' | 'skip' | 'wait' | 'stop';
export type TraceStep = 'data' | 'retrieval' | 'rule' | 'validator' | 'receipt' | 'officer' | 'model' | 'gate' | 'route' | 'sig' | 'issuer' | 'list' | 'verdict' | 'recall' | 'rebuilt' | 'request';
export interface TraceNode {
  step: TraceStep;
  v: Part[];
  s: TraceState;
}
export interface InsEntry {
  id: string;
  at: number;
  kind: InsKind;
  /** the request as it went out (the session id is never shown), or where a recorded answer came from */
  req: string;
  recorded: boolean;
  lines: InsLine[];
  trace?: TraceNode[];
}

const KEY = 'kl.farmer.ins';
const MAX = 40;
let seq = 0;
export const inspector = createStore<InsEntry[]>(readJSON<InsEntry[]>(KEY, 'session') ?? []);
export const useInspector = () => inspector.use();

function push(e: Omit<InsEntry, 'id' | 'at'>) {
  const entry: InsEntry = { ...e, id: `${Date.now().toString(36)}-${++seq}`, at: Date.now() };
  inspector.set((l) => {
    const next = [entry, ...l].slice(0, MAX);
    writeJSON(KEY, next, 'session');
    return next;
  });
}

export function clearInspector() {
  writeJSON(KEY, [], 'session');
  inspector.set([]);
}

/** What the app is waiting for right now (a plan, an answer, a photo, a verdict), for the rail's "working" state. */
export const working = createStore<InsKind | null>(null);
export const useWorking = () => working.use();
export const setWorking = (k: InsKind | null) => working.set(k);

const SID = '‹sid›';
const short = (id: string | undefined | null, n = 8) => (id ? `…${id.replace(/^urn:uuid:/, '').slice(-n)}` : '–');
const hhmm = (iso: string | undefined | null) => (iso ? iso.replace(/^.*T(\d{2}:\d{2}).*$/, '$1 UTC') : '–');
const day = (iso: string | undefined | null) => (iso ? iso.slice(0, 10) : '–');
const onOff = (stage: string, b: boolean | undefined): Part => [b ? 'fa.ins.stageOn' : 'fa.ins.stageOff', { s: stage }];
const yesNo = (b: boolean | undefined): Part => [b ? 'fa.ins.yes' : 'fa.ins.no'];
const SUITE = 'eddsa-jcs-2022';

function receiptLines(r: Receipt, credentialId: string | undefined): InsLine[] {
  const lines: InsLine[] = r.rule_refs.map((ref) => ({ k: 'fa.ins.rule', v: [`${ref.rule_id} v${ref.version}`, ref.review_level] }));
  lines.push({ k: 'fa.ins.receipt', v: [short(credentialId, 10), SUITE], tone: 'go' });
  return lines;
}

function receiptTrace(r: Receipt, credentialId: string | undefined, data: TraceNode): TraceNode[] {
  const rule = r.rule_refs[0];
  return [
    data,
    { step: 'rule', v: rule ? [`${rule.rule_id} v${rule.version}`, rule.review_level] : ['–'], s: 'ok' },
    { step: 'validator', v: [r.generated_by.validator_version], s: 'ok' },
    { step: 'receipt', v: [short(credentialId, 10), SUITE], s: credentialId ? 'ok' : 'skip' },
  ];
}

/* ------------------------------------------------------------------ entries */

export function logBoot(source: DataSource, fields: number, profiles: number) {
  push({
    kind: 'boot',
    req: source === 'live' ? 'GET /api/demo' : 'recorded · demo.json',
    recorded: source !== 'live',
    lines: [{ k: 'fa.ins.fields', v: [String(fields), ['fa.ins.profiles', { n: profiles }]] }],
  });
}

export function logPlan(plan: Plan, source: DataSource, opts: { cached?: boolean; photoCaseId?: string } = {}) {
  const lines: InsLine[] = [
    { k: 'fa.ins.plan', v: [short(plan.plan_id), plan.pack_id] },
    { k: 'fa.ins.data', v: [plan.data_mode ?? '–', `${day(plan.data_as_of)} ${hhmm(plan.data_as_of)}`], tone: plan.data_mode === 'live' ? undefined : 'wait' },
    { k: 'fa.ins.window', v: [`${plan.valid_from} → ${plan.valid_to}`] },
  ];
  if (plan.status === 'abstained' && plan.abstention) {
    lines.push({ k: 'fa.ins.abstain', v: [plan.abstention.reason_code, `→ ${plan.abstention.inbox_item_id}`], tone: 'wait' });
  }
  for (const a of (plan.actions ?? []).slice(0, 3)) lines.push(...receiptLines(a.receipt, a.receipt_credential_id));
  if (opts.photoCaseId) lines.push({ k: 'fa.ins.case', v: [opts.photoCaseId, plan.diagnosis_used ? ['fa.ins.used'] : plan.diagnosis_note ?? '–'] });
  lines.push({ k: 'fa.ins.snapshot', v: [plan.snapshot_id] });
  const decision = plan.actions?.find((a) => a.kind === 'input_decision') ?? plan.actions?.[0];
  const data: TraceNode = { step: 'data', v: [plan.data_mode ?? '–', `${day(plan.data_as_of)} ${hhmm(plan.data_as_of)}`, plan.snapshot_id], s: 'ok' };
  const trace: TraceNode[] =
    plan.status === 'abstained' && plan.abstention
      ? [data, { step: 'rule', v: [plan.abstention.reason_code], s: 'skip' }, { step: 'officer', v: [plan.abstention.inbox_item_id], s: 'wait' }]
      : decision
        ? receiptTrace(decision.receipt, decision.receipt_credential_id, data)
        : [data];
  push({
    trace,
    kind: 'plan',
    req: opts.cached ? `sessionStorage · kl.plan.${plan.field_id}.${plan.farmer_profile_id}` : source === 'live' ? `POST /api/demo/${SID}/plan` : 'recorded · plans.json',
    recorded: source !== 'live',
    lines,
  });
}

export function logAsk(o: AskOutcome, via: 'text' | 'voice') {
  if (o.source === 'offline') {
    push({
      kind: 'ask',
      req: `POST /api/demo/${SID}/ask`,
      recorded: true,
      lines: [{ k: 'fa.ins.status', v: [['fa.ins.offline']], tone: 'stop' }],
      trace: [{ step: 'request', v: [['fa.ins.offline']], s: 'stop' }],
    });
    return;
  }
  const r = o.data;
  const st = r.retrieval.stages;
  const lines: InsLine[] = [
    { k: 'fa.ins.ask', v: [short(r.ask_id), r.lang, via === 'voice' ? ['fa.ins.voice'] : ['fa.ins.text']] },
    { k: 'fa.ins.graph', v: [`${r.pipeline.engine}: ${r.pipeline.path.join(' › ')}`] },
    {
      k: 'fa.ins.retrieval',
      v: [r.retrieval.mode, onOff('bm25', st.bm25), onOff('dense', st.dense), onOff('rerank', st.rerank), r.retrieval.threshold != null ? `τ ${r.retrieval.threshold.toFixed(3)}` : '–'],
    },
  ];
  if (r.status === 'ok' && r.answer) {
    const a = r.answer;
    lines.push({ k: 'fa.ins.answer', v: [`${a.rule_id} v${a.rule_version}`, `via ${a.via}`, a.text_lang] });
    lines.push({ k: 'fa.ins.receipt', v: [short(a.receipt_credential_id, 10), SUITE], tone: 'go' });
    const sha = a.action.receipt.data.find((d) => d.variable === 'question_sha256');
    if (sha) lines.push({ k: 'fa.ins.question', v: [`sha256 ${String(sha.value).slice(0, 12)}…`, ['fa.ins.noWords']] });
  } else if (r.abstention) {
    lines.push({ k: 'fa.ins.abstain', v: [r.abstention.reason_code, r.abstention.why, `→ ${r.abstention.inbox_item_id}`], tone: 'wait' });
  }
  // the router's own path decides what lit: retrieval stages, rule matching, validation, the receipt or the officer
  const ran = new Set(readPipeline(r.pipeline.path).filter((x) => x.state === 'ran').map((x) => x.id));
  const retrieval: TraceNode = {
    step: 'retrieval',
    v: [r.retrieval.mode, ...(['bm25', 'dense', 'rerank'] as const).filter((k) => st[k]), ...(r.retrieval.threshold != null ? [`τ ${r.retrieval.threshold.toFixed(3)}`] : [])],
    s: ran.has('bm25') || ran.has('dense') ? 'ok' : 'skip',
  };
  const trace: TraceNode[] =
    r.status === 'ok' && r.answer
      ? [
          retrieval,
          { step: 'rule', v: [`${r.answer.rule_id} v${r.answer.rule_version}`, `via ${r.answer.via}`], s: ran.has('match') || ran.has('decide') ? 'ok' : 'skip' },
          { step: 'validator', v: [ran.has('validate') ? 'validate' : '–', r.answer.text_lang], s: ran.has('validate') ? 'ok' : 'skip' },
          { step: 'receipt', v: [short(r.answer.receipt_credential_id, 10), SUITE], s: ran.has('receipt') || !!r.answer.receipt_credential_id ? 'ok' : 'skip' },
        ]
      : [retrieval, { step: 'rule', v: [r.abstention?.reason_code ?? '–'], s: ran.has('match') ? 'ok' : 'skip' }, { step: 'officer', v: [r.abstention?.inbox_item_id ?? '–'], s: 'wait' }];
  push({ kind: 'ask', req: o.source === 'live' ? `POST /api/demo/${SID}/ask` : 'recorded · asks.json', recorded: o.source !== 'live', lines, trace });
}

export function logPhoto(c: PhotoCase, area: AreaStats | null) {
  const top = c.suggestion[0];
  const m = area ? meterView(area) : null;
  const lines: InsLine[] = [
    { k: 'fa.ins.case', v: [c.case_id, c.created_at.replace('T', ' ').replace('Z', ' UTC')] },
    { k: 'fa.ins.area', v: [c.area, c.model] },
    { k: 'fa.ins.route', v: [c.route], tone: c.route === 'auto' ? 'go' : 'wait' },
    { k: 'fa.ins.sure', v: [yesNo(c.sure), top ? `p₁ ${top.prob.toFixed(2)}` : '–', ['fa.ins.frozen']] },
    { k: 'fa.ins.consent', v: [yesNo(c.consent), c.photo_available ? ['fa.ins.kept'] : ['fa.ins.notKept']] },
  ];
  if (m) lines.push({ k: 'fa.ins.gate', v: [[m.gateOpen ? 'fa.ins.open' : 'fa.ins.closed'], `LB ${m.lowerBound.toFixed(2)} / ${m.bar.toFixed(2)}`, ['fa.ins.verdicts', { n: m.verdicts }]], tone: m.gateOpen ? 'go' : undefined });
  const trace: TraceNode[] = [
    { step: 'model', v: [c.model, top ? `p₁ ${top.prob.toFixed(2)}` : '–'], s: 'ok' },
    { step: 'gate', v: m ? [[m.gateOpen ? 'fa.ins.open' : 'fa.ins.closed'], `LB ${m.lowerBound.toFixed(2)} / ${m.bar.toFixed(2)}`] : ['–'], s: m ? 'ok' : 'skip' },
    c.route === 'auto' ? { step: 'route', v: [c.route, c.case_id], s: 'ok' } : { step: 'officer', v: [c.case_id], s: 'wait' },
  ];
  push({ kind: 'photo', req: `POST /api/demo/${SID}/photo`, recorded: false, lines, trace });
}

export function logVerify(id: string, r: VerifyOutcome) {
  const lines: InsLine[] = [];
  const trace: TraceNode[] = [];
  if (r.status === 'unreachable') {
    trace.push({ step: 'request', v: [['fa.ins.unreachable']], s: 'stop' });
  } else {
    const proof = r.credential?.proof;
    trace.push({ step: 'sig', v: proof ? [proof.cryptosuite] : ['–'], s: r.status === 'invalid' ? 'stop' : 'ok' });
    if (r.credential?.issuer) trace.push({ step: 'issuer', v: [r.credential.issuer], s: 'ok' });
    if (r.status !== 'invalid') trace.push({ step: 'list', v: r.rules?.length ? r.rules : [['fa.tr.clear']], s: r.status === 'recalled' ? 'stop' : 'ok' });
    trace.push({ step: 'verdict', v: [r.status, ...(r.expired ? [['fa.ins.expired'] as Part] : [])], s: r.status === 'authentic' ? 'ok' : 'stop' });
  }
  if (r.status === 'unreachable') {
    lines.push({ k: 'fa.ins.verdict', v: [['fa.ins.unreachable'], r.reason], tone: 'stop' });
  } else {
    lines.push({ k: 'fa.ins.verdict', v: [r.status, ...(r.expired ? [['fa.ins.expired'] as Part] : [])], tone: r.status === 'authentic' ? 'go' : 'stop' });
    if (r.rules?.length) lines.push({ k: 'fa.ins.recall', v: r.rules });
    const proof = r.credential?.proof;
    if (proof) lines.push({ k: 'fa.ins.suite', v: [proof.cryptosuite, proof.type] });
    if (r.credential?.issuer) lines.push({ k: 'fa.ins.issuer', v: [r.credential.issuer] });
    if (r.status_list) lines.push({ k: 'fa.ins.list', v: [r.status_list.replace(/^https?:\/\/[^/]+/, '').replace(/demo-[0-9a-f]+/, `demo-${SID}`), ['fa.ins.sandbox'], yesNo(r.sandbox)] });
  }
  push({ kind: 'verify', req: r.source === 'sample' ? 'recorded · verify-before.json' : `GET /api/verify/${short(id, 12)}`, recorded: r.source === 'sample', lines, trace });
}

export function logRecall(mode: 'sandbox' | 'sample') {
  push({
    kind: 'recall',
    req: mode === 'sandbox' ? `POST /api/demo/${SID}/recall` : 'simulated in this browser',
    recorded: mode === 'sample',
    lines: [{ k: 'fa.ins.recall', v: [['fa.ins.recallSeen'], ['fa.ins.rebuilt']], tone: 'stop' }],
    trace: [
      { step: 'recall', v: [['fa.ins.recallSeen']], s: 'stop' },
      { step: 'rebuilt', v: [['fa.ins.rebuilt']], s: 'ok' },
    ],
  });
}

export function logError(req: string, message: string) {
  push({ kind: 'error', req, recorded: false, lines: [{ k: 'fa.ins.error', v: [message.slice(0, 160)], tone: 'stop' }], trace: [{ step: 'request', v: [message.slice(0, 80)], s: 'stop' }] });
}
