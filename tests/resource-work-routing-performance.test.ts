import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import {
  beginResourceWorkMonth,
  recordResourceWorkAssignment,
  resourceWorkRevision,
} from '../src/sim/resources/ResourceWorkAssignments';

describe('resource work routing revision', () => {
  it('changes only when the current-month assignment ledger changes', () => {
    const simulation = new Simulation({
      seed: 'resource-work-revision',
      startMode: 'established',
      startingPopulation: 40,
      settlementCount: [2, 2],
      world: { size: 20 },
    });
    const state = simulation.state;
    const settlement = state.settlements[0]!;
    const cell = state.world.cells[settlement.cellIndex]!;

    beginResourceWorkMonth(state);
    expect(resourceWorkRevision(state)).toBe(0);

    recordResourceWorkAssignment(state, {
      month: state.month,
      source: 'world-resource',
      settlementId: settlement.id,
      siteId: 'revision-site',
      cellIndex: settlement.cellIndex,
      resourceId: 'timber',
      worldPosition: { x: cell.worldX, z: cell.worldZ },
      gatherOccupations: ['forager'],
      labourByOccupation: { forager: 1 },
      amountExtracted: 1,
      labourUsed: 1,
    });
    expect(resourceWorkRevision(state)).toBe(1);
    expect(resourceWorkRevision(state)).toBe(1);

    state.month += 1;
    expect(resourceWorkRevision(state)).toBe(0);
  });
});
