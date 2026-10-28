/**
 * The Ask router (services/ask: a LangGraph pipeline, hybrid BM25 + multilingual-e5 retrieval):
 *   POST /api/demo/{sid}/ask {field_id, profile_id, question, lang}
 * The answer is ALWAYS either the validated text of one existing sourced rule (with a signed receipt) or an abstention
 * that lands in the officer's inbox. No language model writes agronomy. The receipt carries only a sha256 fingerprint
 * of the question, never its words.
 *
 * With the API unreachable, an Ask can only replay a question we recorded (data/recorded): anything else says the
 * live server is not connected. It never pretends to answer.
 */
import { apiStore, HttpError, isUnreachable, sandbox } from './client';
import type { AbstentionCode, Action, I18nText } from './types';
import { loadRecorded, type RecordedAsk } from '../../data/recorded';

export interface AskCandidate {
  rule_id: string;
  version: number;
  kind: string;
  rank: number;
  confidence: number;
  status: string;
  missing?: string[];
}
export interface AskRetrieved {
  rule_id: string;
  score: number;
  confidence: number;
  unit: string;
}
export interface AskAnswer {
  /** the rule's own validated text, in `text_lang` */
  text: string;
  text_lang: string;
  /** true when the rule has no text in the asked language (the English text is shown) */
  lang_fallback: boolean;
  rule_id: string;
  rule_version: number;
  /** "rule": the matched rule answered; "plan_decision": the question was about the spray decision, which the plan logic makes */
  via: 'rule' | 'plan_decision';
  matched_rule_id: string;
  receipt_credential_id: string;
  action: Action;
}
export interface AskResponse {
  ask_id: string;
  status: 'ok' | 'abstained';
  /** the question as stored (digits redacted); the receipt holds only its sha256 */
  question: string;
  lang: string;
  field_id: string;
  farmer_profile_id: string;
  pack_id: string;
  crop: string;
  stage: string;
  answer?: AskAnswer;
  abstention?: { reason_code: AbstentionCode | 'question_unanswered'; reason: I18nText; inbox_item_id: string; why: string };
  retrieval: {
    mode: string;
    threshold: number | null;
    stages: { bm25: boolean; dense: boolean; rerank: boolean };
    note: string;
    rewritten_query: string;
    crops_named: string[];
    candidates: AskCandidate[];
    top_retrieved?: AskRetrieved[];
  };
  pipeline: { engine: 'langgraph'; path: string[] };
  data_mode: string | null;
  data_as_of: string | null;
  generated_at: string;
}

export type AskOutcome =
  | { source: 'live'; data: AskResponse }
  /** a question we recorded earlier, replayed (labelled "Recorded") */
  | { source: 'recorded'; data: AskResponse }
  /** the server is not reachable and this question was never recorded: we say so instead of answering */
  | { source: 'offline'; examples: RecordedAsk[] };

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();

/** The questions we recorded, to offer as examples when the server is not reachable. */
export async function recordedQuestions(fieldId?: string): Promise<RecordedAsk[]> {
  const { asks } = await loadRecorded();
  return fieldId ? asks.filter((a) => a.field_id.slice(0, 2) === fieldId.slice(0, 2)) : asks;
}

async function replay(question: string, fieldId: string): Promise<AskOutcome> {
  const { asks } = await loadRecorded();
  const hit = asks.find((a) => norm(a.question) === norm(question));
  if (hit) return { source: 'recorded', data: JSON.parse(JSON.stringify(hit.response)) as AskResponse };
  return { source: 'offline', examples: asks.filter((a) => a.field_id.slice(0, 2) === fieldId.slice(0, 2)) };
}

/** Ask one question for one demo field and farmer. 4xx answers (empty question, unknown field) are thrown as errors. */
export async function askQuestion(question: string, fieldId: string, profileId: string, lang: string): Promise<AskOutcome> {
  if (apiStore.get().forced) return replay(question, fieldId);
  try {
    const body = JSON.stringify({ field_id: fieldId, profile_id: profileId, question: question.slice(0, 500), lang });
    const data = await sandbox<AskResponse>('/ask', { method: 'POST', body }, 60000);
    apiStore.set((s) => (s.mode === 'live' && s.reason === null ? s : { ...s, mode: 'live', reason: null }));
    return { source: 'live', data };
  } catch (e) {
    if (isUnreachable(e)) {
      apiStore.set((s) => ({ ...s, mode: 'sample', reason: e instanceof HttpError ? `HTTP ${e.status}` : 'network' }));
      return replay(question, fieldId);
    }
    throw e;
  }
}
