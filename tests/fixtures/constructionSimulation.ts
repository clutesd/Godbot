import { Simulation } from '../../src/sim/Simulation';

/** A real monthly economy with an explicit shelter deficit, rather than excess prebuilt housing. */
export function constructionSimulation(): Simulation {
  const sim = new Simulation({ seed: 'construction-runtime-live', startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
  for (const settlement of sim.state.settlements) {
    settlement.structurePlots = [];
    settlement.buildings = 0;
    settlement.targetBuildings = 0;
    settlement.constructionProgress = 0;
    if (settlement.development) settlement.development.project = undefined;
  }
  return sim;
}
