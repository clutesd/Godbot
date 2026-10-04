import { describe, expect, it } from 'vitest';
import { movementPathHalfWidth, movementPathStage, movementPathStrength } from '../src/sim/environment/PathEvolution';
import type { WorldCell } from '../src/sim/types';

function cellWith(modifications: NonNullable<WorldCell['modifications']>): WorldCell {
  return { modifications } as unknown as WorldCell;
}

describe('route memory: older circulation stays embedded under later routes', () => {
  it('a fading engineered road reverts to the footpath it was built over instead of vanishing', () => {
    const cell = cellWith({ footpath: { intensity: 0.52, firstMonth: 0, lastMonth: 96, ownerId: 'a' }, road: { intensity: 0.05, firstMonth: 60, lastMonth: 96, ownerId: 'a' } });
    expect(movementPathStage(cell)).toBe('footpath');
    expect(movementPathHalfWidth(1, movementPathStage(cell), movementPathStrength(cell))).toBeGreaterThan(0);
  });

  it('a live engineered road takes precedence over the footpath beneath it', () => {
    const cell = cellWith({ footpath: { intensity: 0.52, firstMonth: 0, lastMonth: 96, ownerId: 'a' }, road: { intensity: 0.4, firstMonth: 60, lastMonth: 96, ownerId: 'a' } });
    expect(movementPathStage(cell)).toBe('engineered-road');
    expect(movementPathStrength(cell)).toBeGreaterThan(0.5);
  });

  it('a road that has fully faded leaves no corridor, so later plots may reclaim the ground', () => {
    const cell = cellWith({ road: { intensity: 0.01, firstMonth: 60, lastMonth: 96, ownerId: 'a' } });
    expect(movementPathStage(cell)).toBe('none');
    expect(movementPathHalfWidth(1, 'none', movementPathStrength(cell))).toBe(0);
  });
});
