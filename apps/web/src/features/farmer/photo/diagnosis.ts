/**
 * From a Report to the Diagnosis the API takes (contracts/schemas/diagnosis.schema.json), and from a plan back to
 * "does it cite the diagnosis".
 *
 * The contract has room for labels, probabilities, model name + version + hash, a calibrated flag, a status and the
 * on-device time. It has no room yet for severity, symptoms or the next view: those stay on the phone and in the
 * diagnosis receipt, and API_REQUESTS.md asks for them. The photo is never part of it.
 */
import type { Action, Diagnosis, Plan } from '../../../lib/api/types';
import { topLabels, type Report } from './report';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * `ood_score` is optional since backend v0.4.0 and v0 has no out-of-distribution head, so it is left out (it used to be
 * sent as 1 - top-1 probability, a confidence complement that the server would have read as an OOD score).
 * Sample reports are never turned into a Diagnosis: a scripted result must not reach the planner. The SERVER decides
 * whether the reading counts (`diagnosis_used` / `diagnosis_note` on the plan it returns).
 */
export function toDiagnosis(r: Report, ctx: { sha256: string; now?: Date; camAvailable?: boolean }): Diagnosis {
  if (r.engine.sample) throw new Error('a sample report is never sent to the planner');
  const labels = topLabels(r).map((d) => ({ label: d.id, prob: round4(d.prob) }));
  const unsure = r.verdict !== 'confident';
  return {
    diagnosis_id: r.id,
    crop: r.crop,
    model: { name: r.engine.name, version: r.engine.version, sha256: ctx.sha256 },
    on_device: r.engine.kind === 'on-device',
    labels,
    calibrated: r.engine.calibrated,
    status: unsure ? 'abstained' : 'ok',
    ...(unsure ? { abstention_reason: 'low_confidence' as const } : {}),
    cam_available: ctx.camAvailable ?? false,
    inference_ms: Math.max(0, Math.round(r.ms)),
    created_at: (ctx.now ?? new Date()).toISOString(),
  };
}

/** How a receipt names the model that produced a reading: `on-device-model:<name>@<version>`. */
export const DIAGNOSIS_SOURCE_PREFIX = 'on-device-model:';

/** The actions of a plan whose receipt cites the on-device diagnosis. */
export function citingActions(plan: Plan | null | undefined): Action[] {
  return (plan?.actions ?? []).filter((a) => a.receipt?.data?.some((d) => d.source.startsWith(DIAGNOSIS_SOURCE_PREFIX)));
}
