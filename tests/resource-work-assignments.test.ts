import { describe, expect, it } from 'vitest';
import { societyFixture } from './fixtures/settlementDevelopment';
import { SeededRandom } from '../src/sim/prng';
import { ResourceSystem } from '../src/sim/resources/ResourceSystem';
import type { ResourceDeposit, Settlement, SimulationState } from '../src/sim/types';

function placeAtSettlement(state: SimulationState, settlement: Settlement): ResourceDeposit {
  const deposit: ResourceDeposit = {
    id: 'work-assignment-herbs',
    resourceId: 'wild-herbs',
    cellIndex: settlement.cellIndex,
    worldX: settlement.position.x,
    worldZ: settlement.position.z,
    quality: 1,
    capacity: 100,
    abundance: 1,
    renewable: true,
    depleted: false,
    overharvested: false,
    discoveredBy: { [settlement.id]: 0 },
  };
  state.world.resourceDeposits = [deposit];
  settlement.discoveredDeposits = [deposit.id];
  return deposit;
}

describe('ResourceSystem work assignment presentation contract', () => {
  it('publishes extraction facts from the same gather transaction that creates cargo', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const s = settlement!;
    const deposit = placeAtSettlement(state, s);
    const system = new ResourceSystem(new SeededRandom('work-assignment-contract'));

    let assignment = system.getWorkAssignments()[0];
    for (let month = 0; month < 8 && !assignment; month += 1) {
      state.month = month;
      system.advanceMonth(state);
      assignment = system.getWorkAssignments().find(item => item.depositId === deposit.id);
    }

    expect(assignment).toBeDefined();
    expect(assignment).toMatchObject({
      month: state.month,
      settlementId: s.id,
      depositId: deposit.id,
      resourceId: 'wild-herbs',
      worldPosition: { x: deposit.worldX, z: deposit.worldZ },
    });
    expect(assignment!.gatherOccupations).toContain('forager');
    expect(assignment!.amountExtracted).toBeGreaterThan(0);
    expect(assignment!.labourUsed).toBeGreaterThan(0);
    expect(assignment!.accessPath.length).toBeGreaterThan(0);
    expect(assignment!.accessPaths.length).toBeGreaterThan(0);

    const shipment = s.materialEconomy!.inTransit.find(item => item.depositId === deposit.id && item.resourceId === 'wild-herbs');
    expect(shipment).toBeDefined();
    expect(shipment!.quantity).toBeCloseTo(assignment!.amountExtracted, 8);
  });

  it('clears the snapshot each month instead of leaking stale work', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const s = settlement!;
    const deposit = placeAtSettlement(state, s);
    const system = new ResourceSystem(new SeededRandom('work-assignment-reset'));

    for (let month = 0; month < 8 && system.getWorkAssignments().length === 0; month += 1) {
      state.month = month;
      system.advanceMonth(state);
    }
    expect(system.getWorkAssignments().some(item => item.depositId === deposit.id)).toBe(true);

    s.localMaterials['wild-herbs'] = 100;
    state.month += 1;
    system.advanceMonth(state);

    expect(system.getWorkAssignments()).toEqual([]);
  });
});
