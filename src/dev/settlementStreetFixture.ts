/** Declared movement-history review; placement uses the real simulation reservation contract. */
import { Simulation } from '../sim/Simulation';
import { cellAt } from '../sim/world';
import type { MovementPathStage } from '../sim/environment/PathEvolution';

export function settlementStreetFixture(seed: string, stage: Exclude<MovementPathStage, 'none'> = 'footpath') {
  const state = new Simulation({ seed, startingPopulation: 30, world: { size: 20 }, settlementCount: [2, 2] }).state;
  const settlement = state.settlements[0]!;
  state.settlements = [settlement]; state.arrival = undefined; state.energy = undefined;
  settlement.position = { x: 0, z: 0 }; settlement.structurePlots = []; settlement.buildings = 24;
  settlement.agriculture = undefined; settlement.workedDeposits = []; settlement.development = undefined;
  state.tradeRoutes = [];
  const h = state.world.seaLevel + .2;
  state.world.terrain.height.fill(h); state.world.terrain.waterLevel.fill(-1);
  state.world.terrain.river.fill(0); state.world.terrain.lake.fill(0);
  for (const cell of state.world.cells) Object.assign(cell, { elevation: h, water: false, biome: 'grassland', landform: 'lowland', slope: 0, relief: 0, modifications: undefined });
  for (const weather of state.weather.cells) weather.floodDepth = 0;
  // An occupied lane, its bend and a branch; these facts are declared rather than earned by this viewer.
  const points = [[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [0, -1], [0, -2]];
  for (const [x, z] of points) {
    const cell = cellAt(state.world, x! * state.world.cellSize, z! * state.world.cellSize)!;
    const mark = { intensity: stage === 'desire-path' ? .045 : .32, firstMonth: 0, lastMonth: 120, ownerId: settlement.id };
    const kind = stage === 'engineered-road' ? 'road' : stage === 'cart-road' ? 'cart-road' : stage === 'packed-track' ? 'track' : 'footpath';
    cell.modifications = { [kind]: mark };
  }
  state.month = 120;
  return { state, settlement };
}
