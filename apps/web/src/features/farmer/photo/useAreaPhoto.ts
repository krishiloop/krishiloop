import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareJpeg } from './downscale';
import { useI18n } from '../../../lib/i18n';
import { fetchPlan } from '../../../lib/api/client';
import { loadAreaStats, photoErrorKind, photoSupport, probePhotoSupport, sendPhoto, useAreaStats, type PhotoErrorKind } from '../../../lib/api/trust';
import { areaLabelName } from '../../trust/labels';
import type { Action, AreaStats } from '../../../lib/api/types';

/** A photo ready to send: the downscaled JPEG, its base64 and an object URL for the preview. */
export interface Shot {
  url: string;
  b64: string;
  width: number;
  height: number;
  bytes: number;
}

/** What the planner did with an automatically answered photo (the SERVER decides: `diagnosis_used`). */
export type PlanState =
  | { state: 'loading' }
  /** used, and these actions' receipts name the area's trust (`receipt.area_trust_ref`) */
  | { state: 'ready'; actions: Action[] }
  /** the reading was used, but no rule of the pack answers this label at this stage */
  | { state: 'unused'; label: string }
  /** the gate no longer stood when the plan was made, so the reading was not used */
  | { state: 'withdrawn' }
  | { state: 'offline' }
  | { state: 'failed' };

export type Phase =
  | { k: 'idle' }
  | { k: 'preparing' }
  | { k: 'picked'; shot: Shot }
  | { k: 'sending'; shot: Shot }
  /** the area's gate was closed (or the photo was not sure): the officer has it. The suggestion is NOT kept here. */
  | { k: 'officer'; caseId: string; shared: boolean; shot: Shot }
  | { k: 'auto'; caseId: string; label: string; shot: Shot; plan: PlanState }
  | { k: 'error'; error: PhotoErrorKind | 'prepare'; shot: Shot | null };

/**
 * One farmer's photo through the server path: pick or take it, downscale it, ask for consent, send it, and then either
 * "not sure yet, sent to your officer" or "looks like <label>, and here is why you can rely on it here" plus the plan
 * with the receipted photo practice. The state is a small machine: every transition is one function.
 *
 * What the farmer sees on the officer route never includes the model's suggestion: it is unverified in this area, and the
 * answer comes from the officer. Only an `auto` case (the gate stood and the suggestion was sure) carries a label.
 */
export function useAreaPhoto({ fieldId, profileId, area }: { fieldId: string; profileId: string; area: string }) {
  const { t } = useI18n();
  const support = photoSupport.use();
  const stats: AreaStats | null = useAreaStats(area);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [consent, setConsent] = useState(false);
  const [announce, setAnnounce] = useState('');
  const alive = useRef(true);
  const urls = useRef<Set<string>>(new Set());
  const planSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    const held = urls.current;
    return () => {
      alive.current = false;
      planSeq.current++;
      held.forEach((u) => URL.revokeObjectURL(u));
      held.clear();
    };
  }, []);

  // is there a photo model on this server? The area's numbers answer that (503 = no), and feed the meter
  useEffect(() => {
    if (photoSupport.get() === 'unknown' || !stats) void probePhotoSupport(area);
  }, [area]);

  const dropShot = (shot: Shot | null) => {
    if (!shot) return;
    URL.revokeObjectURL(shot.url);
    urls.current.delete(shot.url);
  };

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setPhase((p) => {
        if ('shot' in p && p.shot) dropShot(p.shot);
        return { k: 'preparing' };
      });
      try {
        const p = await prepareJpeg(file);
        if (!alive.current) return;
        const url = URL.createObjectURL(p.blob);
        urls.current.add(url);
        setPhase({ k: 'picked', shot: { url, b64: p.b64, width: p.width, height: p.height, bytes: p.bytes } });
      } catch (e) {
        console.warn('could not prepare the photo', e);
        if (alive.current) setPhase({ k: 'error', error: 'prepare', shot: null });
      }
    },
    [],
  );

  const runPlan = useCallback(
    async (caseId: string, label: string) => {
      const mine = ++planSeq.current;
      const set = (plan: PlanState) => {
        if (mine !== planSeq.current || !alive.current) return;
        setPhase((p) => (p.k === 'auto' && p.caseId === caseId ? { ...p, plan } : p));
      };
      set({ state: 'loading' });
      try {
        const res = await fetchPlan(fieldId, profileId, { photoCaseId: caseId });
        if (res.source === 'sample') return set({ state: 'offline' });
        const plan = res.data;
        if (plan.diagnosis_used === true) {
          // a receipt that names the area's trust is the proof the photo informed it: never infer that from the text
          const actions = (plan.actions ?? []).filter((a) => !!a.receipt?.area_trust_ref);
          return set(actions.length ? { state: 'ready', actions } : { state: 'unused', label });
        }
        return set(plan.diagnosis_used === false ? { state: 'withdrawn' } : { state: 'failed' });
      } catch (e) {
        console.warn('plan with the photo case failed', e);
        set({ state: 'failed' });
      }
    },
    [fieldId, profileId],
  );

  const send = useCallback(async () => {
    const shot = phase.k === 'picked' || phase.k === 'error' ? phase.shot : null;
    if (!shot) return;
    setPhase({ k: 'sending', shot });
    setAnnounce(t('trust.farmer.sendingSr'));
    try {
      const c = await sendPhoto(fieldId, shot.b64, consent);
      if (!alive.current) return;
      photoSupport.set('available');
      // the numbers after this photo (the farmer's photo can be the one that moves nothing, but the meter must be current)
      void loadAreaStats(c.area).catch(() => undefined);
      if (c.route === 'auto' && c.suggestion[0]) {
        const label = c.suggestion[0].label;
        setPhase({ k: 'auto', caseId: c.case_id, label, shot, plan: { state: 'loading' } });
        setAnnounce(t('trust.farmer.auto.sr', { label: areaLabelName(label, t) }));
        void runPlan(c.case_id, label);
      } else {
        // officer route: keep only what the farmer is told. The suggestion in the answer is not stored or shown.
        setPhase({ k: 'officer', caseId: c.case_id, shared: c.consent, shot });
        setAnnounce(t('trust.farmer.officer.sr'));
      }
    } catch (e) {
      const error = photoErrorKind(e);
      if (error === 'unavailable') photoSupport.set('unavailable');
      if (alive.current) setPhase({ k: 'error', error, shot });
    }
  }, [phase, fieldId, consent, runPlan, t]);

  const reset = useCallback(() => {
    planSeq.current++;
    setPhase((p) => {
      if ('shot' in p && p.shot) dropShot(p.shot);
      return { k: 'idle' };
    });
    setAnnounce('');
  }, []);

  const retryPlan = useCallback(() => {
    if (phase.k === 'auto') void runPlan(phase.caseId, phase.label);
  }, [phase, runPlan]);

  const retryProbe = useCallback(() => {
    photoSupport.set('unknown');
    void probePhotoSupport(area);
  }, [area]);

  return { phase, consent, setConsent, support, stats, pick, send, reset, retryPlan, retryProbe, announce };
}
