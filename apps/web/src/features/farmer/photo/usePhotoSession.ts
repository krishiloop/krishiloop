import { useEffect, useRef, useState } from 'react';
import { SAMPLE_PACKS, type SampleScenarioId } from './samplePacks';
import { sampleImage, type SampleArt } from './sampleArt';
import type { Engine, ShotRead } from './engines';
import { MAX_PHOTOS, OTHER, topDisease, type Report } from './report';
import { citingActions, toDiagnosis } from './diagnosis';
import { getModelSha, wasDownloadedBefore, type LoadProgress } from './photoModel';
import { PHOTO_MODEL_CARD } from './photoModelCard';
import type { DecisionState } from './PhotoDecision';
import { registerPhotoCase, updatePhotoCase, withdrawPhotoCase } from '../../officer/inboxStore';
import { fetchDemoInbox, fetchPlan } from '../../../lib/api/client';
import { useI18n } from '../../../lib/i18n';
import { fmtNum, pickText } from '../../../lib/format';
import type { Diagnosis } from '../../../lib/api/types';

/** One photo in the session. `reading` while the engine looks at it. */
export interface Shot {
  id: string;
  url: string;
  /** a sample picture (an illustration), not the farmer's photo */
  sample: boolean;
  state: 'reading' | 'ready';
  read?: ShotRead;
}

export type Stage = 'idle' | 'downloading' | 'ready';
export type PhotoError = 'read' | 'model' | 'download';

let seq = 0;
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

/** The picture the sample engine shows at step `index` of a scenario. */
export function sampleArtFor(crop: string, scenario: SampleScenarioId, index: number): SampleArt {
  const steps = SAMPLE_PACKS[crop]?.scenarios[scenario] ?? [];
  return steps[Math.min(index, steps.length - 1)]?.art ?? 'top';
}

/**
 * One farmer's photo session: photos in, one Report out, and what the report triggers.
 *   confident  -> the planner (real engines) or a "sample, nothing sent" note (sample engine); any automatic case is withdrawn
 *   ambiguous  -> nothing yet: the report carries the one photo that would help
 *   unsure     -> the officer gets the case (created once, updated as photos are added)
 * One function (`apply`) decides this for every change to the photos, so adding and removing can never disagree.
 */
export function usePhotoSession(opts: { engine: Engine; scenario: SampleScenarioId; fieldId: string; profileId: string; crop: string; farmerLabel: string }) {
  const { engine, fieldId, profileId, crop, farmerLabel } = opts;
  const { t, lang } = useI18n();
  const [stage, setStage] = useState<Stage>(() => (!engine.needsDownload || engine.isReady() || wasDownloadedBefore() ? 'ready' : 'idle'));
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<PhotoError | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [active, setActive] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [decision, setDecision] = useState<DecisionState>({ state: 'idle' });
  const [caseId, setCaseId] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const shotsRef = useRef<Shot[]>([]);
  const caseRef = useRef<{ id: string; kind: 'auto' | 'asked' } | null>(null);
  const planSeq = useRef(0);
  const alive = useRef(true);
  const scenarioRef = useRef(opts.scenario);
  scenarioRef.current = opts.scenario;
  const lastDx = useRef<Diagnosis | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      planSeq.current++;
      shotsRef.current.forEach((s) => !s.sample && URL.revokeObjectURL(s.url));
    };
  }, []);

  const commit = (next: Shot[]) => {
    shotsRef.current = next;
    setShots(next);
  };
  const setCase = (c: { id: string; kind: 'auto' | 'asked' } | null) => {
    caseRef.current = c;
    setCaseId(c?.id ?? null);
  };
  const withdrawAuto = (note: string) => {
    const c = caseRef.current;
    if (c?.kind !== 'auto') return;
    withdrawPhotoCase(c.id, note);
    setWithdrawn(c.id);
    setCase(null);
  };

  const runPlan = async (d: Diagnosis) => {
    lastDx.current = d;
    const mine = ++planSeq.current;
    setDecision({ state: 'planning' });
    try {
      const res = await fetchPlan(fieldId, profileId, { diagnosis: d });
      if (mine !== planSeq.current || !alive.current) return;
      const plan = res.data;
      if (res.source === 'sample') {
        // sample data answered (forced, or the API was unreachable): the reading was not used, and nothing says it was
        setDecision({ state: 'offline' });
      } else if (plan.diagnosis_used === true) {
        const acts = citingActions(plan);
        setDecision(acts.length ? { state: 'cited', actions: acts, source: res.source } : { state: 'used', source: res.source });
      } else if (plan.diagnosis_used === false) {
        // the gate said no: the server made an officer case in this session's inbox. Find it so the link opens it.
        let caseId: string | null = null;
        try {
          caseId = (await fetchDemoInbox()).data.find((i) => i.diagnosis_id === d.diagnosis_id)?.item_id ?? null;
        } catch {
          /* the link then opens the whole inbox */
        }
        if (mine !== planSeq.current || !alive.current) return;
        setDecision({ state: 'not-used', note: plan.diagnosis_note ?? 'none', caseId });
      } else {
        setDecision({ state: 'unknown', source: res.source });
      }
    } catch (e) {
      if (mine !== planSeq.current || !alive.current) return;
      console.warn('plan with photo reading failed', e);
      setDecision({ state: 'failed' });
    }
  };

  const apply = (all: Shot[]) => {
    const ready = all.filter((s) => s.state === 'ready' && s.read);
    const rep = ready.length ? engine.combine(ready.map((s) => s.read!), { crop, scenario: scenarioRef.current }) : null;
    setReport(rep);
    if (!rep) {
      planSeq.current++;
      setDecision({ state: 'idle' });
      setAnnounce('');
      withdrawAuto('The farmer removed the photos, so the farmer app closed this case.');
      return;
    }
    const best = topDisease(rep);
    const top = rep.differential.filter((d) => d.id !== OTHER).slice(0, 3).map((d) => ({ label: d.id, prob: d.prob }));

    if (rep.verdict === 'unsure') {
      planSeq.current++;
      setDecision({ state: 'idle' });
      setWithdrawn(null);
      const c = caseRef.current;
      if (c) updatePhotoCase(c.id, { top, diagnosisId: rep.id });
      else setCase({ id: registerPhotoCase({ fieldId, farmerLabel, top, diagnosisId: rep.id, sample: rep.engine.sample }), kind: 'auto' });
      setAnnounce(t('photo.sr.unsure'));
      return;
    }

    if (rep.verdict === 'ambiguous') {
      planSeq.current++;
      setDecision({ state: 'idle' });
      withdrawAuto('The farmer added a photo and the answer is not final yet, so the farmer app closed this case.');
      setAnnounce(t('photo.sr.ambiguous'));
      return;
    }

    // confident: the reading is a fact for the planner
    withdrawAuto('The farmer added photos and the reading reached the threshold, so the farmer app closed this case.');
    if (caseRef.current) updatePhotoCase(caseRef.current.id, { top, diagnosisId: rep.id });
    setAnnounce(t('photo.sr.confident', { label: best ? pickText(best.name, lang).text : '', pct: fmtNum(Math.round((best?.prob ?? 0) * 100), lang) }));
    if (rep.engine.sample) {
      planSeq.current++;
      setDecision({ state: 'sample' });
    } else {
      void runPlan(toDiagnosis(rep, { sha256: getModelSha()?.hex ?? PHOTO_MODEL_CARD.sha256 }));
    }
  };

  const busy = shots.some((s) => s.state === 'reading');

  const add = async (url: string, file: Blob | null, sample = false) => {
    if (shotsRef.current.length >= MAX_PHOTOS || shotsRef.current.some((s) => s.state === 'reading')) {
      if (!sample) URL.revokeObjectURL(url);
      return;
    }
    setError(null);
    setWithdrawn(null);
    const id = `shot-${++seq}`;
    const index = shotsRef.current.length;
    commit([...shotsRef.current, { id, url, sample, state: 'reading' }]);
    setActive(index);
    try {
      if (engine.needsDownload && !engine.isReady()) {
        setStage('downloading');
        await engine.prepare(setProgress);
        setStage('ready');
      }
      await frames(2); // let the "reading" state paint before the model blocks the thread
      const read = await engine.read(file, { crop, index, scenario: scenarioRef.current });
      if (!alive.current) return;
      const next = shotsRef.current.map((s) => (s.id === id ? { ...s, state: 'ready' as const, read } : s));
      commit(next);
      apply(next);
    } catch (e) {
      console.warn('photo check failed', e);
      if (!sample) URL.revokeObjectURL(url);
      if (!alive.current) return;
      const next = shotsRef.current.filter((s) => s.id !== id);
      commit(next);
      setActive(Math.max(0, next.length - 1));
      const modelUp = !engine.needsDownload || engine.isReady();
      setError(modelUp ? 'read' : 'model');
      if (!modelUp) setStage('idle');
    }
  };

  return {
    stage,
    progress,
    error,
    shots,
    active: Math.min(active, Math.max(0, shots.length - 1)),
    setActive,
    report,
    decision,
    caseId,
    withdrawn,
    announce,
    busy,
    canAdd: stage === 'ready' && !busy && shots.length < MAX_PHOTOS,

    async download() {
      setError(null);
      setStage('downloading');
      try {
        await engine.prepare(setProgress);
        setStage('ready');
      } catch (e) {
        console.warn('photo model download failed', e);
        setError('download');
        setStage('idle');
      }
    },
    addFile: (file: File | undefined) => (file ? add(URL.createObjectURL(file), file) : Promise.resolve()),
    /** the sample picture for the next step (sample engine) */
    addSample() {
      const art = sampleArtFor(crop, scenarioRef.current, shotsRef.current.length);
      return add(sampleImage(crop, art), null, true);
    },
    removeActive() {
      const gone = shotsRef.current[Math.min(active, shotsRef.current.length - 1)];
      if (!gone || gone.state !== 'ready') return;
      if (!gone.sample) URL.revokeObjectURL(gone.url);
      const next = shotsRef.current.filter((s) => s.id !== gone.id);
      commit(next);
      setActive(Math.max(0, next.length - 1));
      apply(next);
    },
    startOver() {
      shotsRef.current.forEach((s) => !s.sample && URL.revokeObjectURL(s.url));
      setCase(null); // the officer keeps an earlier case; this just forgets it on screen
      setWithdrawn(null);
      setError(null);
      commit([]);
      setActive(0);
      apply([]);
    },
    sendToOfficer() {
      if (!report || caseRef.current) return;
      const top = report.differential.filter((d) => d.id !== OTHER).slice(0, 3).map((d) => ({ label: d.id, prob: d.prob }));
      setCase({ id: registerPhotoCase({ fieldId, farmerLabel, top, diagnosisId: report.id, reason: 'farmer_requested', sample: report.engine.sample }), kind: 'asked' });
    },
    retryPlan() {
      if (report && report.verdict === 'confident' && !report.engine.sample) void runPlan(toDiagnosis(report, { sha256: getModelSha()?.hex ?? PHOTO_MODEL_CARD.sha256 }));
    },
  };
}
