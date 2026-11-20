/**
 * When to show "Nearest Krishi officer", and what the card says. Pure functions: the screens pass in their result and
 * the place, and get back one of four states. Nothing here guesses a place: no place means the card asks for one.
 */
import { NO_LIST_KM, rankForPlace, type Office, type OfficeData, type Place } from './nearest';

/** The photo check is not sure: anything but a single confident reading ("shortlist" or "refer"). */
export const photoNeedsOfficer = (outcome: 'diagnose' | 'shortlist' | 'refer') => outcome !== 'diagnose';

/** The Ask answer went to an officer: no answer (abstained), or the answer itself says "talk to your officer". */
export function askNeedsOfficer(r: { status: string; answer?: { action?: { kind?: string } | null } | null }): boolean {
  return r.status !== 'ok' || !r.answer || r.answer.action?.kind === 'officer_contact';
}

export type CardModel =
  /** we do not know where the farmer is: ask, with one button */
  | { kind: 'ask' }
  /** a place is known, the office list is still loading */
  | { kind: 'loading' }
  /** the place is far from every office we list (outside Bangladesh): only the national helpline */
  | { kind: 'far'; helpline: string | null }
  | {
      kind: 'office';
      office: Office;
      /** km from the farmer; null when the place is a picked district (we do not know where in it) */
      km: number | null;
      /** the number the Call button rings: the officer's published work mobile, else the office phone */
      call: { who: 'officer' | 'office'; phone: string } | null;
      /** show "Call 16123": there is no published officer mobile */
      helpline: string | null;
    };

export function cardModel(data: OfficeData | null, place: Place | null): CardModel {
  if (!place) return { kind: 'ask' };
  if (!data) return { kind: 'loading' };
  const helpline = data.national?.phone ?? null;
  const top = rankForPlace(data.offices, place, 1)[0];
  if (!top || (place.kind === 'gps' && top.km > NO_LIST_KM)) return { kind: 'far', helpline };
  const o = top.office;
  const call = o.officer?.mobile ? { who: 'officer' as const, phone: o.officer.mobile } : o.phone ? { who: 'office' as const, phone: o.phone } : null;
  return { kind: 'office', office: o, km: place.kind === 'gps' ? top.km : null, call, helpline: o.officer?.mobile ? null : helpline };
}
