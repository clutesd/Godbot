import { describe, expect, it } from 'vitest';
import {
  CinematicSequencePlanner,
  documentaryShotScaleFor,
} from '../src/render/CinematicSequencePlanner';
import type {
  DocumentaryEditorialIntent,
  ObservationCandidate,
  ObservationKind,
} from '../src/historian/types';
import type { SimulationState } from '../src/sim/types';

function editorial(
  threadId: string,
  preferredScale: DocumentaryEditorialIntent['preferredScale'],
  activityMeaning = 0.5,
  narration: DocumentaryEditorialIntent['narration'] = 'selective',
): DocumentaryEditorialIntent {
  return {
    threadId,
    why: `test intent for ${threadId}`,
    activityMeaning,
    preferredScale,
    narration,
    completion: preferredScale === 'detail' || preferredScale === 'human' ? 'subject-action' : 'sequence-beat',
  };
}

function scene(
  id: string,
  kind: ObservationKind,
  x: number,
  z: number,
  score = 0.7,
  intent?: DocumentaryEditorialIntent,
): ObservationCandidate {
  return {
    id,
    subjectId: id,
    kind,
    position: { x, z },
    title: id,
    statement: {
      id: `statement:${id}`,
      month: 0,
      text: id,
      epistemicStatus: 'derived-statistic',
      sourceEventIds: [],
      sourceEntityIds: [id],
      sourceArchiveIds: [],
      claims: {},
    },
    score,
    interest: score,
    audioCategory: 'settlement',
    breakdown: {
      novelty: 0.5,
      magnitude: 0.5,
      populationAffected: 0.5,
      rarity: 0.5,
      technological: 0.5,
      political: 0.5,
      cultural: 0.5,
      consequence: 0.5,
      continuity: 0.5,
      repetitionPenalty: 0,
    },
    editorial: intent,
  };
}

const state = {
  month: 24,
  world: { size: 64 },
} as unknown as SimulationState;

function drain(planner: CinematicSequencePlanner, first: ReturnType<CinematicSequencePlanner['plan']>) {
  const shots = [first];
  while (planner.hasPlannedShot()) {
    const next = planner.takePlannedShot();
    if (next) shots.push(next);
  }
  return shots;
}

describe('CinematicSequencePlanner', () => {
  it('edits grounded scenes into establish -> approach -> observe -> detail -> reveal -> release grammar', () => {
    const planner = new CinematicSequencePlanner();
    const thread = 'settlement:a';
    const anchor = scene('observe', 'street-observation', 10, 10, 0.9, editorial(thread, 'human', 0.78));
    const candidates = [
      scene('establish', 'world-establishing', 10, 11, 0.7, editorial(thread, 'wide', 0.2, 'silent')),
      scene('approach', 'settlement-approach', 10.5, 10.5, 0.72, editorial(thread, 'medium', 0.42, 'silent')),
      anchor,
      scene('detail', 'worker-follow', 10.2, 10.1, 0.76, editorial(thread, 'detail', 0.9)),
      scene('reveal', 'infrastructure-scene', 9.8, 10.2, 0.72, editorial(thread, 'medium', 0.6)),
      scene('release', 'landscape-pause', 13, 12, 0.64, editorial(thread, 'wide', 0.08, 'silent')),
    ];

    const shots = drain(planner, planner.plan(state, anchor, candidates));

    expect(shots.map(shot => shot.role)).toEqual([
      'establish',
      'approach',
      'observe',
      'detail',
      'reveal',
      'release',
    ]);
    expect(shots.map(shot => shot.scene.id)).toEqual([
      'establish',
      'approach',
      'observe',
      'detail',
      'reveal',
      'release',
    ]);
    expect(shots.map(shot => shot.scale)).toEqual(['wide', 'medium', 'human', 'detail', 'medium', 'wide']);
    expect(new Set(shots.map(shot => shot.scene.id)).size).toBe(shots.length);
    expect(shots.every(shot => shot.sequenceId === shots[0]!.sequenceId)).toBe(true);
  });

  it('preserves the anchor narrative thread instead of chasing a remote high-score subject', () => {
    const planner = new CinematicSequencePlanner();
    const thread = 'settlement:a';
    const anchor = scene('anchor', 'street-observation', 10, 10, 0.88, editorial(thread, 'human', 0.8));
    const candidates = [
      anchor,
      scene('local-wide', 'world-establishing', 11, 10, 0.65, editorial(thread, 'wide', 0.2)),
      scene('local-approach', 'settlement-approach', 10.5, 10, 0.66, editorial(thread, 'medium', 0.4)),
      scene('local-detail', 'worker-follow', 10, 11, 0.68, editorial(thread, 'detail', 0.92)),
      scene('local-reveal', 'institution-exterior', 9.5, 10, 0.67, editorial(thread, 'medium', 0.58)),
      scene('local-release', 'landscape-pause', 13, 12, 0.62, editorial(thread, 'wide', 0.1)),
      scene('remote-detail', 'worker-follow', 55, 55, 0.99, editorial('settlement:b', 'detail', 0.99)),
    ];

    const shots = drain(planner, planner.plan(state, anchor, candidates));

    expect(shots.some(shot => shot.scene.id === 'remote-detail')).toBe(false);
    expect(shots.every(shot => shot.threadId === thread)).toBe(true);
  });

  it('keeps narration selective: visual orientation and release can remain silent', () => {
    const planner = new CinematicSequencePlanner();
    const thread = 'settlement:a';
    const anchor = scene('observe', 'street-observation', 2, 2, 0.9, editorial(thread, 'human', 0.8, 'required'));
    const shots = drain(planner, planner.plan(state, anchor, [
      scene('establish', 'world-establishing', 2, 3, 0.7, editorial(thread, 'wide', 0.1, 'silent')),
      scene('approach', 'settlement-approach', 2.5, 2.5, 0.7, editorial(thread, 'medium', 0.3, 'silent')),
      anchor,
      scene('detail', 'worker-follow', 2.1, 2.1, 0.86, editorial(thread, 'detail', 0.9, 'required')),
      scene('reveal', 'infrastructure-scene', 1.8, 2.2, 0.8, editorial(thread, 'medium', 0.7, 'required')),
      scene('release', 'landscape-pause', 5, 4, 0.65, editorial(thread, 'wide', 0.05, 'silent')),
    ]));

    expect(shots.find(shot => shot.role === 'establish')?.narrate).toBe(false);
    expect(shots.find(shot => shot.role === 'approach')?.narrate).toBe(false);
    expect(shots.find(shot => shot.role === 'observe')?.narrate).toBe(true);
    expect(shots.find(shot => shot.role === 'detail')?.narrate).toBe(true);
    expect(shots.find(shot => shot.role === 'reveal')?.narrate).toBe(true);
    expect(shots.find(shot => shot.role === 'release')?.narrate).toBe(false);
  });

  it('remembers subjects and shot scales across sequences to resist repetitive aerial grammar', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'street-observation', 3, 3, 0.9, editorial('a', 'human', 0.8));
    const first = planner.plan(state, anchor, [
      anchor,
      scene('wide', 'world-establishing', 3, 4, 0.7, editorial('a', 'wide', 0.2)),
      scene('detail', 'worker-follow', 4, 3, 0.72, editorial('a', 'detail', 0.85)),
      scene('reveal', 'institution-exterior', 3.5, 3, 0.7, editorial('a', 'medium', 0.55)),
      scene('release', 'landscape-pause', 5, 5, 0.65, editorial('a', 'wide', 0.1)),
    ]);
    drain(planner, first);

    const memory = planner.recentEditorialMemory();
    expect(memory.length).toBeGreaterThanOrEqual(3);
    expect(new Set(memory.map(entry => entry.scale)).size).toBeGreaterThan(1);
    expect(memory.some(entry => entry.subjectId === 'anchor')).toBe(true);

    const newAnchor = scene('new-anchor', 'street-observation', 4, 4, 0.88, editorial('a', 'human', 0.8));
    const next = drain(planner, planner.plan(state, newAnchor, [
      newAnchor,
      anchor,
      scene('new-wide', 'world-establishing', 4, 5, 0.68, editorial('a', 'wide', 0.2)),
      scene('new-detail', 'worker-follow', 5, 4, 0.72, editorial('a', 'detail', 0.86)),
      scene('new-release', 'landscape-pause', 6, 5, 0.65, editorial('a', 'wide', 0.1)),
    ]));

    expect(next.some(shot => shot.scene.id === 'anchor')).toBe(false);
  });

  it('is deterministic when equally scored candidates arrive in a different array order', () => {
    const makeRun = (reverse: boolean): string[] => {
      const planner = new CinematicSequencePlanner();
      const anchor = scene('anchor', 'street-observation', 10, 10, 0.9, editorial('a', 'human', 0.8));
      const candidates = [
        anchor,
        scene('a-establish', 'world-establishing', 11, 10, 0.7, editorial('a', 'wide')),
        scene('b-establish', 'world-establishing', 9, 10, 0.7, editorial('a', 'wide')),
        scene('a-detail', 'worker-follow', 10, 11, 0.7, editorial('a', 'detail')),
        scene('b-detail', 'worker-follow', 10, 9, 0.7, editorial('a', 'detail')),
        scene('release', 'landscape-pause', 12, 12, 0.65, editorial('a', 'wide')),
      ];
      const ordered = reverse ? [...candidates].reverse() : candidates;
      return drain(planner, planner.plan(state, anchor, ordered)).map(shot => shot.scene.id);
    };

    expect(makeRun(false)).toEqual(makeRun(true));
  });

  it('keeps sequence metadata internally consistent and includes the anchor exactly once', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'settlement-approach', 0, 0, 0.92, editorial('a', 'medium', 0.5));
    const shots = drain(planner, planner.plan(state, anchor, [
      scene('establish', 'world-establishing', 0, 1, 0.7, editorial('a', 'wide')),
      anchor,
      scene('observe', 'street-observation', 0.5, 0, 0.74, editorial('a', 'human')),
      scene('detail', 'worker-follow', 1, 0, 0.76, editorial('a', 'detail')),
      scene('reveal', 'institution-exterior', 1.5, 0.5, 0.72, editorial('a', 'medium')),
      scene('release', 'landscape-pause', 3, 2, 0.68, editorial('a', 'wide')),
    ]));

    expect(shots.filter(shot => shot.scene.id === anchor.id)).toHaveLength(1);
    expect(shots.map(shot => shot.ordinal)).toEqual(shots.map((_, index) => index));
    expect(shots.every(shot => shot.total === shots.length)).toBe(true);
    expect(shots.every(shot => shot.sequenceId === shots[0]!.sequenceId)).toBe(true);
  });

  it('never mutates simulation state or candidate facts while planning presentation', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'street-observation', 4, 4, 0.9, editorial('a', 'human', 0.8));
    const candidates = [
      anchor,
      scene('wide', 'world-establishing', 4, 5, 0.7, editorial('a', 'wide')),
      scene('detail', 'worker-follow', 5, 4, 0.72, editorial('a', 'detail')),
      scene('release', 'landscape-pause', 7, 6, 0.65, editorial('a', 'wide')),
    ];
    const stateBefore = JSON.stringify(state);
    const candidateBefore = JSON.stringify(candidates);

    planner.plan(state, anchor, candidates);

    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(JSON.stringify(candidates)).toBe(candidateBefore);
  });

  it('interrupts queued editorial beats immediately for a major event', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'settlement-approach', 0, 0, 0.8, editorial('a', 'medium'));
    planner.plan(state, anchor, [
      anchor,
      scene('detail', 'worker-follow', 1, 0, 0.7, editorial('a', 'detail')),
      scene('release', 'landscape-pause', 3, 2, 0.65, editorial('a', 'wide')),
    ]);
    expect(planner.hasPlannedShot()).toBe(true);
    planner.interrupt();
    expect(planner.hasPlannedShot()).toBe(false);
    expect(planner.takePlannedShot()).toBeUndefined();
  });

  it('classifies documentary scale from subject distance grammar', () => {
    expect(documentaryShotScaleFor('world-establishing')).toBe('wide');
    expect(documentaryShotScaleFor('settlement-approach')).toBe('medium');
    expect(documentaryShotScaleFor('street-observation')).toBe('human');
    expect(documentaryShotScaleFor('worker-follow')).toBe('detail');
  });
});
