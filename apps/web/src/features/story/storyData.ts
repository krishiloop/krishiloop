/**
 * The recorded real outputs the story page shows (cut from src/data/recorded by our recorder: one BD rice "no spray"
 * receipt, one "re-check" receipt, one Kenyan potato receipt, their forecasts, the Ask answers and the after-recall
 * verdict). Bundled with the story chunk so the hero never waits for the big recorded files.
 */
import raw from '../../data/recorded/story.json';
import type { Action, FieldSnapshot, VerifyResponse } from '../../lib/api/types';

export interface StoryDecision {
  action: Action;
  plan: { plan_id: string; pack_id: string; field_id: string; crop: string; stage: string; valid_from: string; valid_to: string; data_mode: string; data_as_of: string };
}
export interface StoryAsk {
  lang: string;
  question: string;
  status: 'ok' | 'abstained';
  rule_id: string | null;
  text: string | null;
  reason: Record<string, string> | null;
  path: string[];
  stages: { bm25: boolean; dense: boolean; rerank: boolean };
}

const data = raw as unknown as {
  calm: StoryDecision;
  pests: StoryDecision;
  potato: StoryDecision;
  recalled_verdict: Omit<VerifyResponse, 'credential'>;
  snapshot: FieldSnapshot;
  potato_snapshot: FieldSnapshot | null;
  asks: StoryAsk[];
};

export const STORY = data;
