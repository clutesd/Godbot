import { describe, expect, it } from 'vitest';
import { firstMilestones, milestoneCategories } from '../src/historian/Milestones';
import { createResourceCargo } from '../src/render/resources/ResourceCargo';
import type { HistoricalEvent } from '../src/sim/types';
import type { FreightTrip } from '../src/sim/transport/types';

const event = (id: string, milestone: string): HistoricalEvent => ({
  id, month: 1, type: 'resource-trade', location: { x: 0, z: 0 }, locationId: 'town',
  actors: ['town'], causes: ['delivered-freight'], context: { milestone }, outcome: 'Goods moved.',
  affectedPopulation: 20, magnitude: 0.7, significance: 0.8, tags: ['trade'], summary: milestone,
});

describe('authoritative trade presentation', () => {
  it('offers each economic milestone once to the shared historian and camera queue', () => {
    const stages = ['merchant', 'market', 'caravan', 'major-trade-route', 'rail-connection', 'motor-freight'];
    const history = stages.flatMap(stage => [event(`${stage}:first`, stage), event(`${stage}:later`, stage)]);
    expect(firstMilestones(history).map(e => e.id)).toEqual(stages.map(stage => `${stage}:first`));
    expect(milestoneCategories({ ...event('proposal', 'market'), type: 'infrastructure-built', context: { need: 'trade', action: 'abandoned' } })).toEqual([]);
  });

  it.each(['food', 'pottery', 'timber', 'textile', 'iron-tools', 'coal'])('renders readable %s cargo without mutating freight', id => {
    const trip: FreightTrip = { id: 'cargo', origin: 'a', destination: 'b', reason: 'scarcity-relief', mode: 'road',
      materialId: id, quantity: 4, departedMonth: 1, distance: 0, status: 'moving',
      path: { mode: 'road', segmentIds: [], points: [], length: 0 } };
    const before = JSON.stringify(trip);
    const cargo = createResourceCargo(trip)!;
    expect(cargo.count).toBeGreaterThan(0);
    expect(cargo.userData['resourceId']).toBe(id);
    expect(JSON.stringify(trip)).toBe(before);
    cargo.geometry.dispose();
    for (const material of Array.isArray(cargo.material) ? cargo.material : [cargo.material]) material.dispose();
    cargo.dispose();
  });
});
