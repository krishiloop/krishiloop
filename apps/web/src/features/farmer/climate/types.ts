/** Shapes of services/engine/climate.py (the shield), radar.py (the radar) and climate_visit.py (the booking). */
export type CheckKind = 'heavy_rain' | 'heat' | 'flood' | 'disease';
export type CheckLevel = 'warn' | 'clear' | 'unknown';

export interface ThresholdParam {
  name: string;
  value: number | string;
  unit?: string;
  set_by: string;
  note?: string;
}

export interface RuleCitation {
  rule_id: string;
  version: number;
  /** true: the rule's whole condition holds for this field, so its own action (`title`) is shown */
  applies: boolean;
  title: Record<string, string> | null;
  review_level: string;
  source: { doc_id: string; title: string; publisher: string; url: string; page: number; quote: string; language: string };
}

export interface ClimateCheck {
  kind: CheckKind;
  level: CheckLevel;
  days: string[];
  peak: { date: string | null; value: number; unit: string; trend?: string; of?: number; min?: number } | null;
  thresholds: ThresholdParam[];
  basis: 'team';
  reason: string | null;
  rule: RuleCitation | null;
  rule_withdrawn: string | null;
  context: { fact_id: string; source: string; url: string; text: Record<string, string> } | null;
}

export interface ClimateReport {
  version: string;
  field_id: string;
  crop: string;
  stage: string;
  pack_id: string;
  country: string | null;
  snapshot_id: string | null;
  data_mode: string;
  data_as_of: string | null;
  forecast_source: string | null;
  as_of: string;
  window: { from: string; to: string; days: number } | null;
  warnings: number;
  checks: ClimateCheck[];
  threshold_label: string;
}

export interface RadarCell {
  area: string;
  area_name: string;
  country: 'BD' | 'KE' | null;
  level: 'district' | 'county' | null;
  problem: string;
  reports: number;
  reporters: number;
  kinds: { photo: number; abstention: number; ask: number };
  last_days_ago: number;
}

export interface RadarAggregate {
  version: string;
  simulated: boolean;
  k: number;
  window_days: number;
  reports_in_window: number;
  cells: RadarCell[];
  hidden: { reports: number; cells: number };
  label?: string;
}

export interface FieldArea {
  code: string;
  name: string;
  country: 'BD' | 'KE';
  level: 'district' | 'county';
}

export interface RadarData {
  /** null: the real layer is not available (recorded mode, no live service) */
  real: RadarAggregate | null;
  simulated: RadarAggregate;
  fieldAreas: Record<string, FieldArea | null>;
  source: 'live' | 'recorded';
}

export interface WarnResult {
  mode: 'live' | 'sample';
  total: number;
  sms_sandbox: number;
  telegram: number;
  failed: number;
  recipients: { channel: string; to: string; status: string }[];
  text: Record<string, string>;
}

export interface VisitBooking {
  field_id: string;
  profile_id: string;
  date: string;
  slot: 'morning' | 'afternoon' | 'evening';
  mode: 'visit' | 'call';
  phone: string | null;
  note: string;
  lang: string;
}

export interface VisitResult {
  mode: 'live' | 'sample';
  item_id: string;
  requested_date: string;
  slot: string;
  phone_masked: string | null;
}
