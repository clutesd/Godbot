import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { planSettlementStorage } from '../src/render/settlement/StorageYardPresentation';

describe('earned founding stock', () => {
  it('lands without a prepared stockpile and reveals materials after gathering', () => {
    const sim = new Simulation({ seed: 'founding-loop-audit', startMode: 'arrival', world: { size: 64 } });
    sim.advanceArrival(80);
    expect(sim.state.settlements).toHaveLength(5);
    for (const camp of sim.state.settlements) {
      expect(Object.values(camp.localMaterials).every(amount => amount === 0)).toBe(true);
      expect(camp.resources.food).toBe(100);
      const storage = planSettlementStorage(camp);
      expect(storage.allocations).toHaveLength(0);
      expect(storage.hosts.size).toBe(0);
    }
    expect(sim.beginHistory()).toBe(true);
    sim.step(3);
    const allocations = sim.state.settlements.flatMap(camp => planSettlementStorage(camp).allocations);
    expect(allocations.length).toBeGreaterThan(0);
    for (const camp of sim.state.settlements) {
      for (const allocation of planSettlementStorage(camp).allocations) {
        expect(allocation.amount).toBeGreaterThan(0);
        expect(allocation.amount).toBeLessThanOrEqual(camp.localMaterials[allocation.materialId]!);
      }
    }
  }, 20000);
});
