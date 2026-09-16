import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { MATERIAL_RECIPES } from '../src/sim/resources/MaterialEconomy';
import {
  advanceSettlementResourceExtraction,
  settlementResourceCatchment,
} from '../src/sim/resources/SettlementResourceExtraction';

describe('Step 1C material authority invariants', () => {
  it('supplemental extraction never advances the retired legacy timber lifecycle', () => {
    const simulation = new Simulation({ seed: 'step-1c-no-legacy-timber', startingPopulation: 120, settlementCount: [2, 2] });
    const settlement = simulation.state.settlements[0]!;
    const cell = settlementResourceCatchment(simulation.state, settlement)
      .find((candidate) => candidate.naturalResources !== undefined);
    if (!cell?.naturalResources) throw new Error('Expected a physical resource catchment');

    const timber = cell.naturalResources.renewables.timber;
    timber.stock = 10;
    timber.capacity = 100;
    timber.regenerationPerYear = 0.8;
    timber.accessibility = 1;
    cell.naturalResources.lastRegeneratedMonth = 0;
    simulation.state.month = 12;

    advanceSettlementResourceExtraction(simulation.state, settlement);

    expect(timber.stock).toBe(10);
    expect(cell.naturalResources.lastRegeneratedMonth).toBe(12);
  });

  it('does not spend advanced labour on transformations owned elsewhere or on orphan tin stock', () => {
    const ids = new Set(MATERIAL_RECIPES.map((recipe) => recipe.id));
    expect(ids.has('burn-charcoal')).toBe(false);
    expect(ids.has('alloy-bronze')).toBe(false);
    expect(ids.has('smelt-tin')).toBe(false);
  });
});
