import { describe, expect, it } from 'vitest';
import { readPipeline, STAGES } from './askPath';

const ANSWERED = ['normalise', 'retrieve_bm25', 'retrieve_dense', 'fuse', 'rerank:skipped', 'match_rules', 'decide', 'render', 'validate', 'receipt'];
const ABSTAINED = ['normalise', 'retrieve_bm25', 'retrieve_dense', 'fuse', 'rerank:skipped', 'match_rules', 'decide', 'abstain'];

describe('reading the Ask router path', () => {
  it('marks every stage of an answered question as run, and rerank as skipped', () => {
    const v = readPipeline(ANSWERED);
    expect(v.map((s) => s.id)).toEqual([...STAGES]);
    expect(v.filter((s) => s.state === 'ran').map((s) => s.id)).toEqual(['normalise', 'bm25', 'dense', 'fuse', 'match', 'decide', 'render', 'validate', 'receipt']);
    expect(v.find((s) => s.id === 'rerank')?.state).toBe('skipped');
  });

  it('puts the abstention after "decide" and leaves the answer stages unreached', () => {
    const v = readPipeline(ABSTAINED);
    const ids = v.map((s) => s.id);
    expect(ids.indexOf('abstain')).toBe(ids.indexOf('decide') + 1);
    expect(v.filter((s) => s.state === 'unused').map((s) => s.id)).toEqual(['render', 'validate', 'receipt']);
  });

  it('treats a stage jumped over before the last one that ran as skipped', () => {
    const v = readPipeline(['normalise', 'retrieve_bm25', 'fuse', 'match_rules']);
    expect(v.find((s) => s.id === 'dense')?.state).toBe('skipped');
    expect(v.find((s) => s.id === 'decide')?.state).toBe('unused');
  });

  it('keeps a node it does not know, by its own name', () => {
    const v = readPipeline([...ANSWERED, 'translate']);
    expect(v.at(-1)).toEqual({ id: 'translate', state: 'ran', unknown: true });
  });

  it('copes with no path at all', () => {
    expect(readPipeline(undefined).every((s) => s.state === 'unused')).toBe(true);
  });
});
