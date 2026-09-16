import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { Settlement } from '../src/sim/types';
import { advanceMovementPaths, installMovementRoadAuthority, movementPathStage } from '../src/sim/environment/PathEvolution';
import { TransportationSystem } from '../src/sim/transport/TransportationSystem';

function grant(settlement: Settlement, id: string, practice = 0.9): void {
  settlement.knowledge.records[id] = {
    id,
    theory: practice,
    practice,
    discoveredMonth: 0,
    lastUsedMonth: 0,
    originSettlementId: settlement.id,
    lineageId: `path-evolution:${id}`,
    parentLineages: [],
    source: 'discovery',
    dormant: false,
    adoptedMonth: 0,
    transformedMonth: 0,
  };
}

describe('movement-shaped road evolution', () => {
  it('promotes only a genuinely used footpath, then gates cart and engineered roads behind capability and canonical material', () => {
    const simulation = new Simulation({ seed: 'path-evolution-regression', startingPopulation: 30, settlementCount: [2, 2] });
    const state = simulation.state;
    const settlement = state.settlements[0]!;
    const cell = state.world.cells[settlement.cellIndex]!;
    cell.modifications ??= {};
    cell.modifications.footpath = { intensity: 0.52, firstMonth: 0, lastMonth: 12, ownerId: settlement.id };

    state.month = 12;
    advanceMovementPaths(state);
    expect(cell.modifications.track?.intensity).toBeGreaterThan(0.1);
    expect(cell.modifications['cart-road']).toBeUndefined();
    expect(movementPathStage(cell)).toBe('packed-track');

    grant(settlement, 'wheel-axle');
    state.month = 24;
    cell.modifications.footpath.lastMonth = 24;
    advanceMovementPaths(state);
    expect(cell.modifications['cart-road']?.intensity).toBeGreaterThan(0.1);
    expect(cell.modifications.road).toBeUndefined();
    expect(movementPathStage(cell)).toBe('cart-road');

    grant(settlement, 'improved-roads');
    settlement.infrastructure.workshops = 0.5;
    settlement.resources.wealth = 50;
    // No ensureMaterialInventory call: an engineered road must recognize canonical stone directly.
    settlement.localMaterials.stone = 2;
    const stoneBefore = settlement.localMaterials.stone;
    state.month = 36;
    cell.modifications.footpath.lastMonth = 36;
    advanceMovementPaths(state);

    expect(cell.modifications.road?.intensity).toBeGreaterThan(0.1);
    expect(movementPathStage(cell)).toBe('engineered-road');
    expect(settlement.localMaterials.stone).toBeLessThan(stoneBefore);
    expect(settlement.infrastructure.roads).toBeGreaterThan(0.03);
  });

  it('does not create infrastructure from stale or low-traffic path noise', () => {
    const simulation = new Simulation({ seed: 'path-evolution-stale', startingPopulation: 24, settlementCount: [2, 2] });
    const state = simulation.state;
    const settlement = state.settlements[0]!;
    const cell = state.world.cells[settlement.cellIndex]!;
    cell.modifications ??= {};
    cell.modifications.footpath = { intensity: 0.06, firstMonth: 0, lastMonth: 0, ownerId: settlement.id };
    state.month = 120;

    advanceMovementPaths(state);
    expect(cell.modifications.track).toBeUndefined();
    expect(cell.modifications['cart-road']).toBeUndefined();
    expect(cell.modifications.road).toBeUndefined();
  });

  it('stops the legacy district-anchor planner from creating synthetic local road spokes', () => {
    const simulation = new Simulation({ seed: 'movement-road-authority', startingPopulation: 24, settlementCount: [2, 2] });
    const state = simulation.state;
    for (const settlement of state.settlements) settlement.buildings = 12;
    state.month = 12;
    installMovementRoadAuthority();
    const transport = new TransportationSystem(state);
    transport.advanceMonth();

    expect(Object.values(state.transportation.projects).some(project => project.reason === 'district-access')).toBe(false);
  });
});
