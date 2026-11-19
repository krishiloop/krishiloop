/**
 * AgriTriage-Lite on the server (services/api/main.py, AgriTriage block), inside the visitor's own demo sandbox:
 *
 *   POST /api/demo/{sid}/agritriage                    {field_id, image_b64, consent, any_crop, client} -> {case, area, model}
 *   POST /api/demo/{sid}/agritriage/{case}/plan        {profile_id} -> Plan (the photo-keyed practice has its receipt)
 *   POST /api/demo/{sid}/agritriage/{case}/escalate    -> case (a shortlist the farmer sends to the officer)
 *   GET  /api/demo/{sid}/agritriage/cases              -> {cases}
 *   GET  /api/demo/{sid}/agritriage/{case}/image       the JPEG, only with consent and only until the verdict
 *   GET  /api/demo/{sid}/agritriage/{case}/heat        the server's occlusion map on that photo
 *   POST /api/demo/{sid}/agritriage/{case}/verdict     {label} -> {case, event, area}
 *   POST /api/demo/{sid}/agritriage/recall-model       {reason} -> recalls the model in this sandbox
 *
 * The server reads the photo itself (the same ONNX and gate); what the phone read is sent only to measure agreement.
 */
import { currentSessionId, sandbox } from '../api/client';
import type { Plan } from '../api/types';

export type Route = 'receipt' | 'officer' | 'retake';
export type RouteReason =
  | 'ok'
  | 'shortlist'
  | 'unknown'
  | 'too_many'
  | 'crop_unknown'
  | 'no_pack'
  | 'no_rule'
  | 'model_recalled'
  | 'coverage_failed'
  | 'needs_area_trust'
  | 'audit'
  | 'farmer_asked';

export interface ServerReading {
  model: string;
  sha256: string;
  mode: 'crop_known' | 'any_crop';
  crop: string | null;
  outcome: 'diagnose' | 'shortlist' | 'refer';
  reason: 'unknown' | 'single' | 'few' | 'many';
  set: string[];
  coverage_target: number;
  q: number;
  q_source: 'plantwild_cal' | 'area_recalibrated';
  energy: number;
  energy_threshold: number;
  temperature: number;
  labels: { label: string; prob: number }[];
  inference_ms: number;
  weights: string;
}

export interface Agreement {
  client_outcome: string;
  client_set: string[];
  client_top: string;
  client_ms: number | null;
  same_outcome: boolean;
  same_set: boolean;
  same_top: boolean;
}

export interface ServerHeat {
  method: 'occlusion';
  grid: number;
  target: string;
  heat: number[];
  ms: number;
}

export interface TriageCase {
  case_id: string;
  area: string;
  model: string;
  field_id: string;
  crop: string;
  stage: string;
  created_at: string;
  route: Route;
  reason: RouteReason;
  reading: ServerReading;
  mapping: { pack_id?: string; diagnosis_label?: string; rules?: string[]; firing?: string[] } | null;
  consent: boolean;
  verdict: string | null;
  agreement: Agreement | null;
  heat: ServerHeat | null;
  photo_available: boolean;
}

export interface TriageArea {
  area: string;
  verdicts: number;
  gate_open: boolean;
  trust_credential_id: string | null;
  coverage: { checks: number; covered: number; rate: number | null; upper_bound: number; target: number; min_checks: number };
  q: number;
  q_source: 'plantwild_cal' | 'area_recalibrated';
}

export interface ModelInfo {
  model: string;
  sha256: string;
  credential_id: string | null;
  recalled: boolean;
  weights: string;
  classes: number;
  int8_top1: number;
}

export interface ClientReading {
  outcome: string;
  set: string[];
  top: { label: string; prob: number }[];
  ms: number;
}

export function submitTriage(fieldId: string, imageB64: string, consent: boolean, anyCrop: boolean, client: ClientReading | null) {
  return sandbox<{ case: TriageCase; area: TriageArea; model: ModelInfo }>(
    '/agritriage',
    { method: 'POST', body: JSON.stringify({ field_id: fieldId, image_b64: imageB64, consent, any_crop: anyCrop, client }) },
    60_000,
  );
}

export const triagePlan = (caseId: string, profileId: string) =>
  sandbox<Plan>(`/agritriage/${encodeURIComponent(caseId)}/plan`, { method: 'POST', body: JSON.stringify({ profile_id: profileId }) }, 60_000);

export const escalateTriage = (caseId: string) => sandbox<TriageCase>(`/agritriage/${encodeURIComponent(caseId)}/escalate`, { method: 'POST' });

export const listTriageCases = async () => (await sandbox<{ cases: TriageCase[] }>('/agritriage/cases')).cases;

/** "Show where" on the server, when the farmer chose it: the photo is used once and not kept (about 4 s on a laptop CPU). */
export const triageHeatOnce = (fieldId: string, imageB64: string, anyCrop: boolean, target: string) =>
  sandbox<ServerHeat & { where: 'server'; kept: false }>(
    '/agritriage/heat',
    { method: 'POST', body: JSON.stringify({ field_id: fieldId, image_b64: imageB64, any_crop: anyCrop, target }) },
    120_000,
  );

export const triageHeat = (caseId: string) => sandbox<ServerHeat>(`/agritriage/${encodeURIComponent(caseId)}/heat`, {}, 120_000);

export const judgeTriage = (caseId: string, label: string) =>
  sandbox<{ case: TriageCase; event: unknown; area: TriageArea }>(`/agritriage/${encodeURIComponent(caseId)}/verdict`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });

export const recallModel = (reason: string) =>
  sandbox<{ recalled_model_credentials: string[] }>('/agritriage/recall-model', { method: 'POST', body: JSON.stringify({ reason }) });

/** Where the officer's copy of the photo lives (same origin). null before the tab has a session. */
export function triageImageUrl(caseId: string): string | null {
  const sid = currentSessionId();
  return sid ? `/api/demo/${encodeURIComponent(sid)}/agritriage/${encodeURIComponent(caseId)}/image` : null;
}
