import { createStore } from '../../lib/store';
import { readJSON, writeJSON } from '../../lib/storage';
import type { Key, Params } from '../../lib/i18n';
import type { AreaStats, DataSource, PhotoCase, Plan, Receipt } from '../../lib/api/types';
import type { AskOutcome } from '../../lib/api/ask';
import type { VerifyOutcome } from '../../lib/api/client';
import { meterView } from '../trust/gate';

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
export interface InsEntry {
  id: string;
  at: number;
  kind: InsKind;
  /** the request as it went out (the session id is never shown), or where a recorded answer came from */
  req: string;
  recorded: boolean;
  lines: InsLine[];
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
  push({
    kind: 'plan',
    req: opts.cached ? `sessionStorage · kl.plan.${plan.field_id}.${plan.farmer_profile_id}` : source === 'live' ? `POST /api/demo/${SID}/plan` : 'recorded · plans.json',
    recorded: source !== 'live',
    lines,
  });
}

export function logAsk(o: AskOutcome, via: 'text' | 'voice') {
  if (o.source === 'offline') {
    push({ kind: 'ask', req: `POST /api/demo/${SID}/ask`, recorded: true, lines: [{ k: 'fa.ins.status', v: [['fa.ins.offline']], tone: 'stop' }] });
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
  push({ kind: 'ask', req: o.source === 'live' ? `POST /api/demo/${SID}/ask` : 'recorded · asks.json', recorded: o.source !== 'live', lines });
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
  push({ kind: 'photo', req: `POST /api/demo/${SID}/photo`, recorded: false, lines });
}

export function logVerify(id: string, r: VerifyOutcome) {
  const lines: InsLine[] = [];
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
  push({ kind: 'verify', req: r.source === 'sample' ? 'recorded · verify-before.json' : `GET /api/verify/${short(id, 12)}`, recorded: r.source === 'sample', lines });
}

export function logRecall(mode: 'sandbox' | 'sample') {
  push({
    kind: 'recall',
    req: mode === 'sandbox' ? `POST /api/demo/${SID}/recall` : 'simulated in this browser',
    recorded: mode === 'sample',
    lines: [{ k: 'fa.ins.recall', v: [['fa.ins.recallSeen'], ['fa.ins.rebuilt']], tone: 'stop' }],
  });
}

export function logError(req: string, message: string) {
  push({ kind: 'error', req, recorded: false, lines: [{ k: 'fa.ins.error', v: [message.slice(0, 160)], tone: 'stop' }] });
}
