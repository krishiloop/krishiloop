/**
 * Plain words for the farmer app: crop, stage and country names, what each demo farmer stands for, and abstention
 * reasons. Data-driven where the data allows; the demo pairs come from the recorded scenarios (lib/api/mocks.ts).
 */
import type { Key, Lang } from '../../lib/i18n';
import { humanize, LOCALES } from '../../lib/format';
import { SCENARIOS } from '../../lib/api/mocks';
import type { DemoField, DemoProfile } from '../../lib/api/types';

type T = (k: Key, p?: Record<string, string | number>) => string;

const CROP: Record<string, Key> = { rice: 'fa.crop.rice', potato: 'fa.crop.potato' };
const STAGE: Record<string, Key> = { tillering: 'fa.stage.tillering', grain_fill: 'fa.stage.grain_fill', vegetative: 'fa.stage.vegetative' };

export const cropName = (crop: string | undefined, t: T) => (crop ? (CROP[crop] ? t(CROP[crop]) : humanize(crop)) : '');
export const stageName = (stage: string | undefined, t: T) => (stage ? (STAGE[stage] ? t(STAGE[stage]) : humanize(stage)) : '');

/** "BD" -> "Bangladesh" / "বাংলাদেশ", from the browser's own region names. */
export function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([LOCALES[lang]], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The area a field's photos belong to: crop and place (mirrors services/engine/planner.py trust_area). */
export const areaOf = (f: Pick<DemoField, 'crop' | 'country' | 'area_code'>) => `${f.crop}@${f.area_code || f.country}`;

/* ------------------------------------------------------------------ demo farmers */

export const profileLetter = (id: string) => (id.split('-').at(-1) ?? id).toUpperCase();

const SUMMARY: Record<string, Key> = {
  'demo-farmer-a': 'fa.profile.a',
  'demo-farmer-b': 'fa.profile.b',
  'demo-farmer-c': 'fa.profile.c',
  'demo-farmer-d': 'fa.profile.d',
};

/** One line on what a demo farmer stands for ("pest counts above the threshold"), then the numbers it carries. */
export function profileSummary(p: DemoProfile, t: T): { line: string; data: string } {
  const raw = p as unknown as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof raw.bph_females_per_hill === 'number') parts.push(t('fa.profile.bph', { f: raw.bph_females_per_hill, n: Number(raw.bph_nymphs_per_hill ?? 0) }));
  else {
    if (typeof raw.crop_protected === 'boolean') parts.push(raw.crop_protected ? t('fa.profile.protectedYes') : t('fa.profile.protectedNo'));
    if (typeof raw.soil_drainage === 'string') parts.push(t('fa.profile.drainage', { v: raw.soil_drainage }));
  }
  const key = SUMMARY[p.farmer_profile_id];
  return { line: key ? t(key) : t('fa.profile.name', { id: profileLetter(p.farmer_profile_id) }), data: parts.join(' · ') };
}

/** Which demo farmers belong to a field (the recorded scenarios pair them); a field we never paired offers everyone. */
export function profilesFor(fieldId: string | null, profiles: DemoProfile[]): DemoProfile[] {
  const ids = SCENARIOS.filter((s) => s.field === fieldId).map((s) => s.profile);
  const fit = profiles.filter((p) => ids.includes(p.farmer_profile_id));
  return fit.length ? fit : profiles;
}

/* ------------------------------------------------------------------ why the app did not answer */

const REASON: Record<string, Key> = {
  low_confidence: 'fa.reason.low_confidence',
  out_of_distribution: 'fa.reason.out_of_distribution',
  missing_source: 'fa.reason.missing_source',
  validator_blocked: 'fa.reason.validator_blocked',
  conflicting_rules: 'fa.reason.conflicting_rules',
  data_unavailable: 'fa.reason.data_unavailable',
  farmer_requested: 'fa.reason.farmer_requested',
  no_matching_rule: 'fa.reason.no_matching_rule',
  rule_recalled: 'fa.reason.rule_recalled',
  data_stale: 'fa.reason.data_stale',
  question_unanswered: 'fa.reason.question_unanswered',
  no_candidate_above_threshold: 'fa.reason.no_candidate_above_threshold',
};

/** A reason code in plain words; an unknown code is shown as itself (never hidden). */
export const reasonText = (code: string | undefined, t: T) => (code ? (REASON[code] ? t(REASON[code]) : humanize(code)) : '');

/* ------------------------------------------------------------------ the photo model's labels (server: krishilens-bioclip2) */

const LABEL: Record<string, Key> = {
  healthy: 'fa.photo.label.healthy',
  blast: 'fa.photo.label.blast',
  brown_spot: 'fa.photo.label.brown_spot',
  tungro: 'fa.photo.label.tungro',
  sheath_blight: 'fa.photo.label.sheath_blight',
};
export const photoLabelName = (label: string, t: T) => (LABEL[label] ? t(LABEL[label]) : humanize(label));

/** "2026-10-29" in local time (plan windows and forecast days are calendar dates). */
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
