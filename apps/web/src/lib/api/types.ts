/**
 * Types mirrored from D:/AI_congress/repo/krishiloop/contracts/schemas/*.json
 * (plan, action, receipt, credential, inbox_item, diagnosis, field_snapshot).
 * If a schema changes, change it here: the compiler then points at every screen that needs updating.
 */

/** BCP-47 tag -> text, e.g. { en: "...", bn: "..." } */
export type I18nText = Record<string, string>;

export type TrafficLight = 'green' | 'amber' | 'red';
export type Decision = 'spray' | 'dont_spray' | 'recheck';
export type ActionKind = 'input_decision' | 'irrigation' | 'monitoring' | 'harvest' | 'nutrient' | 'officer_contact' | 'practice' | 'other';
export type ReviewLevel = 'expert' | 'team' | 'pending';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type LocationPrecision = 'field_private' | 'fuzzed_1km' | 'union_level' | 'sample_location';
export type AbstentionCode =
  | 'low_confidence'
  | 'out_of_distribution'
  | 'missing_source'
  | 'validator_blocked'
  | 'conflicting_rules'
  | 'data_unavailable'
  | 'farmer_requested'
  | 'no_matching_rule'
  /** a rule the decision needed was recalled (backend v0.4.0) */
  | 'rule_recalled'
  /** the saved weather is too old to plan "this week" (backend v0.4.0) */
  | 'data_stale';

export interface ReceiptSource {
  doc_id: string;
  title: string;
  publisher: string;
  url?: string;
  page: number | string;
  quote: string;
  quote_sha256: string;
  licence_status: 'cleared' | 'permitted' | 'cited_permission_requested';
  acknowledgement?: string;
  language: string;
}

export interface Reading {
  source: string;
  variable: string;
  value: number | string | boolean;
  unit?: string;
  observed_at: string;
  retrieved_at: string;
  location_precision?: LocationPrecision;
}

export interface RuleRef {
  rule_id: string;
  version: number;
  credential_id: string;
  review_level: ReviewLevel;
}

export interface ReviewerParameter {
  name: string;
  value: number | string;
  unit?: string;
  set_by: 'expert' | 'team';
  note: string;
}

/** Where the weather behind a plan came from: fetched now, a saved snapshot, or bundled sample data. */
export type DataMode = 'live' | 'snapshot' | 'sample';

/** The exact advice a receipt certifies (signed, so editing it breaks the signature). */
export interface ReceiptAdvice {
  action_id: string;
  kind: ActionKind;
  title: I18nText;
  decision?: Decision;
  traffic_light?: TrafficLight;
  phrasing_model?: string | null;
}
/** The plan window a receipt belongs to. `field_ref` is a hash: no location, no personal data. */
export interface ReceiptPlan {
  plan_id: string;
  pack_id: string;
  crop: string;
  stage: string;
  valid_from: string;
  valid_to: string;
  field_ref: string;
  data_mode: DataMode;
  data_as_of: string;
}

/**
 * Set on an advice receipt that a photo reading informed (a server photo case answered automatically): the
 * AreaTrustCredential that stood when the advice was issued. If that credential is later withdrawn the receipt verifies
 * as recalled and `rules` carries "photo trust for <model> in <area>".
 */
export interface AreaTrustRef {
  credential_id: string;
  area: string;
  model: string;
}

export interface Receipt {
  receipt_id: string;
  claim: string;
  /** backend v0.4.0: the exact advice and the plan window, inside the signed content */
  advice?: ReceiptAdvice;
  plan?: ReceiptPlan;
  sources: ReceiptSource[];
  data: Reading[];
  /** earned-trust backend: present when a photo reading informed this advice */
  area_trust_ref?: AreaTrustRef;
  rule_refs: RuleRef[];
  reviewer_parameters?: ReviewerParameter[];
  graph_path?: string[];
  confidence: { level: ConfidenceLevel; score?: number; basis: string };
  generated_by: { planner_version: string; validator_version: string; phrasing_model?: string | null };
  created_at: string;
}

export interface MoneyImpact {
  direction: 'saves' | 'costs';
  amount_min: number;
  amount_max: number;
  currency: string;
  basis: string;
  price_source_ids: string[];
  /** true when prices/areas are sample values: must be shown as "sample" */
  sample: boolean;
}

export interface Action {
  action_id: string;
  kind: ActionKind;
  decision?: Decision;
  traffic_light?: TrafficLight;
  title: I18nText;
  detail?: I18nText;
  when?: { window_start: string; window_end: string } | null;
  money_impact?: MoneyImpact;
  do_not?: I18nText[];
  receipt: Receipt;
  receipt_credential_id?: string;
}

export interface PersonalizationFactor {
  name: 'crop_protected' | 'variety' | 'stage' | 'irrigation_source' | 'budget' | 'labour' | 'voice_preference' | 'past_outcome' | 'soil_drainage';
  value: string;
  effect: I18nText;
}

export interface Abstention {
  reason_code: AbstentionCode;
  reason: I18nText;
  inbox_item_id: string;
}

export interface Plan {
  plan_id: string;
  pack_id: string;
  field_id: string;
  farmer_profile_id: string;
  status: 'ok' | 'abstained';
  crop: string;
  season?: string;
  stage: string;
  valid_from: string;
  valid_to: string;
  actions?: Action[];
  personalization?: { factors: PersonalizationFactor[] };
  abstention?: Abstention;
  generated_at: string;
  snapshot_id: string;
  /** backend v0.4.0: where the weather came from and when it was saved */
  data_mode?: DataMode;
  data_as_of?: string;
  /**
   * Only present when the request carried a `diagnosis`. true = the photo reading passed the server's gate and fed the
   * rules; false = it did not, and `diagnosis_note` says why. The weather plan stands either way.
   */
  diagnosis_used?: boolean;
  diagnosis_note?: DiagnosisNote;
}

/** Why the server did not use a photo reading (`ok` when it did). */
export type DiagnosisNote = 'ok' | 'uncalibrated' | 'low_confidence' | 'out_of_distribution' | 'model_abstained' | 'none';

export interface DemoField {
  field_id: string;
  lat: number;
  lon: number;
  country: string;
  precision: LocationPrecision;
  label: string;
  crop: string;
  stage: string;
  pack_id: string;
  /** a finer place than the country for photo trust areas (crop@area_code); the server falls back to `country` */
  area_code?: string;
}
export interface DemoProfile {
  farmer_profile_id: string;
  crop_protected: boolean;
  soil_drainage: string;
}
export interface DemoPayload {
  fields: DemoField[];
  profiles: DemoProfile[];
}

/** The snapshot endpoint rates a day `high`, `low` or `unknown` (`medium` is kept for older copies). */
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export interface ForecastDay {
  date: string;
  tmax_c?: number;
  tmin_c?: number;
  precip_mm?: number;
  rh_mean_pct?: number;
  risk?: RiskLevel;
}
export interface FieldSnapshot {
  snapshot_id: string;
  field_id: string;
  mode: 'live' | 'snapshot';
  location: { lat: number; lon: number; precision: LocationPrecision; country: string; label?: string };
  crop: string;
  variety?: string;
  planting_date?: string;
  stage: string;
  s2?: {
    item_id: string;
    acquired_at: string;
    cloud_cover: number;
    ndvi_mean: number | null;
    ndvi_p10?: number | null;
    ndvi_p90?: number | null;
    chip_url?: string | null;
    timelapse_url?: string | null;
  } | null;
  forecast?: { source: string; issued_at: string; days: ForecastDay[] } | null;
  flood?: { source: string; issued_at: string; trend: 'rising' | 'stable' | 'falling' | 'unknown'; discharge: { date: string; m3s: number }[] } | null;
  created_at: string;
  /** GET /api/snapshots/{id}: how `forecast.days[].risk` was worked out (team-set thresholds, review pending) */
  risk_basis?: string;
}

export interface Credential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  validUntil?: string;
  credentialSubject: Receipt | Record<string, unknown>;
  /** Rule credentials carry one. Advice receipts (backend v0.4) do not: they are recalled through the rule versions they cite. */
  credentialStatus?: { id: string; type: 'BitstringStatusListEntry'; statusPurpose: 'revocation' | 'suspension'; statusListIndex: string; statusListCredential: string };
  proof: { type: 'DataIntegrityProof'; cryptosuite: 'eddsa-jcs-2022'; created: string; verificationMethod: string; proofPurpose: 'assertionMethod'; proofValue: string };
}

export type VerifyStatus = 'authentic' | 'recalled' | 'invalid';
/**
 * GET /api/verify/{id} (backend v0.4.0). Render ONLY `credential`: it is the signed content the verifier checked.
 * `credential` is absent for `invalid`. `sandbox` is true for receipts made in a demo session. `expired` is set on
 * `authentic` receipts whose plan week is over (authentic and expired are both true: signed, but for an earlier week).
 */
export interface VerifyResponse {
  status: VerifyStatus;
  reason?: string;
  rules?: string[];
  credential?: Credential;
  sandbox?: boolean;
  expired?: boolean;
  /** URL of the status list of the store that issued this receipt (its rule credentials' list; a demo sandbox has its own) */
  status_list?: string;
}

export interface DiagnosisLabel {
  label: string;
  prob: number;
}
/**
 * contracts/schemas/diagnosis.schema.json (additionalProperties: false, so send exactly these keys).
 * The photo itself is NOT part of it. `labels` holds at most 3 entries.
 */
export interface Diagnosis {
  diagnosis_id: string;
  crop: string;
  model: { name: string; version: string; sha256: string };
  on_device: boolean;
  labels: DiagnosisLabel[];
  calibrated: boolean;
  temperature?: number;
  /** optional since backend v0.4.0: leave it out unless the model has a real out-of-distribution head */
  ood_score?: number;
  status: 'ok' | 'abstained';
  /** required by the schema when status is "abstained" */
  abstention_reason?: AbstentionCode;
  cam_available?: boolean;
  inference_ms: number;
  created_at: string;
  severity?: { pct: number; lo?: number; hi?: number };
  symptoms?: { concept: string; strength: number; signature_ref?: string }[];
}
export interface InboxItem {
  item_id: string;
  field_id: string;
  farmer_display_name: string;
  reason_code: AbstentionCode;
  reason: I18nText;
  diagnosis_id?: string | null;
  top_labels?: DiagnosisLabel[];
  question?: string | null;
  photo_attached: boolean;
  status: 'open' | 'resolved';
  resolution_note?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  /** backend v0.4.0: facts the officer may need (pack, snapshot, gate, model...). Free-form; shown as read-only key/values */
  details?: Record<string, unknown>;
}

/** GET /api/stats and GET /api/demo/{sid}/stats */
export interface Stats {
  rule_versions_recalled: number;
  status_entries_used: number;
  status_entries_revoked: number;
  credentials_stored: number;
  inbox_open: number;
}

/** GET /api/packs */
export interface PackInfo {
  pack_id: string;
  crops: string[];
  rules: number;
  review_levels: Record<string, number>;
  /** "planned (Knowledge Compiler not built yet)" until symptom signatures exist */
  signatures: string;
}

export interface DidDocument {
  '@context'?: string[];
  id: string;
  verificationMethod?: { id: string; type: string; controller: string; publicKeyMultibase: string }[];
  assertionMethod?: string[];
}

/* ------------------------------------------------------------------ earned trust for photo diagnosis (plan/EARNED_TRUST_DESIGN.md) */

export interface PhotoSuggestion {
  label: string;
  prob: number;
}
export type PhotoRoute = 'officer' | 'auto';

/**
 * POST /api/demo/{sid}/photo and GET /api/demo/{sid}/photo/cases. `suggestion` is the model's top-2, FROZEN in the area's
 * ledger before any officer answered. It is the officer's to see: the farmer app never shows it as an answer unless the
 * case went `auto` (the area's gate was open and the suggestion was sure).
 */
export interface PhotoCase {
  case_id: string;
  area: string;
  model: string;
  field_id: string;
  created_at: string;
  route: PhotoRoute;
  /** the top probability reached the policy's "sure" level (0.85) */
  sure: boolean;
  suggestion: PhotoSuggestion[];
  consent: boolean;
  verdict: string | null;
  /** the JPEG can still be fetched (consent given, case waiting for the officer) */
  photo_available: boolean;
}

/** The gate of an area moved: trust was earned (`opened`) or withdrawn (`closed`, drift). */
export interface GateEvent {
  event: 'opened' | 'closed';
  at: string;
  verdicts: number;
  sure_in_window: number;
  precision: number | null;
  lower_bound: number;
  policy_version: number;
}

/** GET /api/demo/{sid}/areas/{area}: the evidence behind one area's gate. */
export interface AreaStats {
  area: string;
  model: string;
  policy_version: number;
  /** all officer verdicts in this area for this model version */
  verdicts: number;
  /** sure suggestions among the last 50 judged ones (only sure suggestions count toward the gate) */
  sure_in_window: number;
  sure_right_in_window: number;
  precision: number | null;
  /** Wilson 95% lower bound on the precision of those sure suggestions (0 until there is evidence) */
  lower_bound: number;
  gate_open: boolean;
  events: GateEvent[];
  /** the live AreaTrustCredential while the gate stands, else null */
  trust_credential_id: string | null;
}

/** POST /api/demo/{sid}/photo/{case_id}/verdict */
export interface VerdictResult {
  case: PhotoCase;
  event: GateEvent | null;
  area: AreaStats;
}

/** The signed content of an AreaTrustCredential (GET /api/verify/{id} -> credential.credentialSubject). */
export interface AreaTrustSubject {
  area: string;
  model: string;
  policy_id?: string;
  policy_version: number;
  verdicts: number;
  sure_in_window: number;
  sure_right_in_window: number;
  precision: number | null;
  lower_bound: number;
  opened_at: string;
}

/** GET /api/replay/area-trust: replay of public datasets. The datasets' labels stand in for officers. */
export interface ReplaySettings {
  sure: number;
  window: number;
  min_n: number;
  open_lb: number;
  close_lb: number;
  audit: number;
  lams?: number[];
  headline_lam?: number;
  max_stream?: number;
  strict_cosine?: number | null;
}
export interface ReplaySummary {
  photos: number;
  /** officer verdicts counted when the gate first opened; null = it never opened */
  confirmations_until_open: number | null;
  officer_confirmations: number;
  auto_answers: number;
  auto_precision: number | null;
  auto_share_of_all_photos: number;
  gate_closings: number;
  open_at_end: boolean;
  /** "0-50": [photos, top-1 right, top-2 right] (the suggestion shown to the officer, by stage) */
  suggestion_by_stage?: Record<string, [number, number | null, number | null]>;
}
export interface ReplayArea {
  fields?: string[];
  /** [photos_seen, officer_verdicts, lower_bound_before_this_verdict (null before 30 sure verdicts), gate_open (0/1), auto_answers, auto_right] */
  points: (number | null)[][];
  summary: ReplaySummary;
}
export interface ReplayPayload {
  note?: string;
  settings: ReplaySettings;
  /** backbone -> dataset key (BD-A ...) -> replay */
  areas: Record<string, Record<string, ReplayArea>>;
}

/** Where a piece of data came from. Anything "sample" is always labelled in the UI. */
export type DataSource = 'live' | 'sample';
export interface Sourced<T> {
  data: T;
  source: DataSource;
  /** why we fell back to sample (network error, forced, ...) */
  note?: string;
}
