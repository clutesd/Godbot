import { describe, expect, it } from 'vitest';
import { CinematicSequencePlanner } from '../src/render/CinematicSequencePlanner';
import type { ObservationCandidate, ObservationKind } from '../src/historian/types';
import type { SimulationState } from '../src/sim/types';

function scene(id: string, kind: ObservationKind, x: number, z: number, score = 0.7): ObservationCandidate {
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
  };
}

const state = {
  month: 24,
  world: { size: 64 },
} as unknown as SimulationState;

describe('CinematicSequencePlanner', () => {
  it('builds a bounded multi-shot visual sequence with scale contrast', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'street-observation', 10, 10, 0.9);
    const candidates = [
      scene('establish', 'world-establishing', 11, 11, 0.66),
      scene('approach', 'settlement-approach', 10.5, 10.5, 0.72),
      anchor,
      scene('context', 'institution-exterior', 9.7, 10.2, 0.7),
      scene('release', 'landscape-pause', 14, 13, 0.62),
      scene('remote', 'street-observation', 55, 55, 0.99),
    ];

    const first = planner.plan(state, anchor, candidates);
    const shots = [first];
    while (planner.hasPlannedShot()) {
      const next = planner.takePlannedShot();
      if (next) shots.push(next);
    }

    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBeLessThanOrEqual(5);
    expect(shots.some(shot => shot.scene.id === 'anchor')).toBe(true);
    expect(shots.some(shot => shot.scene.id === 'remote')).toBe(false);
    expect(new Set(shots.map(shot => shot.scene.id)).size).toBe(shots.length);
    expect(shots.every(shot => shot.sequenceId === shots[0]!.sequenceId)).toBe(true);
  });

  it('interrupts queued editorial beats immediately for a major event', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'settlement-approach', 0, 0);
    planner.plan(state, anchor, [
      anchor,
      scene('detail', 'worker-follow', 1, 0),
      scene('release', 'landscape-pause', 3, 2),
    ]);
    expect(planner.hasPlannedShot()).toBe(true);
    planner.interrupt();
    expect(planner.hasPlannedShot()).toBe(false);
    expect(planner.takePlannedShot()).toBeUndefined();
  });

  it('does not immediately recycle recently viewed sequence scenes', () => {
    const planner = new CinematicSequencePlanner();
    const anchor = scene('anchor', 'street-observation', 3, 3, 0.9);
    const alternate = scene('alternate', 'worker-follow', 4, 3, 0.7);
    const establishing = scene('establish', 'world-establishing', 3, 4, 0.7);
    const release = scene('release', 'landscape-pause', 5, 5, 0.65);
    planner.plan(state, anchor, [anchor, alternate, establishing, release]);
    while (planner.hasPlannedShot()) planner.takePlannedShot();

    const newAnchor = scene('new-anchor', 'street-observation', 4, 4, 0.88);
    const next = planner.plan(state, newAnchor, [newAnchor, anchor, alternate, establishing, release]);
    const ids = [next.scene.id];
    while (planner.hasPlannedShot()) {
      const shot = planner.takePlannedShot();
      if (shot) ids.push(shot.scene.id);
    }

    expect(ids).toContain('new-anchor');
    expect(ids.filter(id => id === 'anchor')).toHaveLength(0);
  });
});
