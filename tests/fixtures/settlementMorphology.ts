import { Simulation } from '../../src/sim/Simulation';
import { cellAt } from '../../src/sim/world';

export function morphologyFixture(history: 'east' | 'bend' | 'none' = 'east') {
  const state = new Simulation({ seed: 'morphology-history', startingPopulation: 30,
    world: { size: 20 }, settlementCount: [2, 2] }).state;
  const town = state.settlements[0]!;
  state.settlements = [town]; state.arrival = undefined; state.energy = undefined;
  town.position = { x: 0, z: 0 }; town.structurePlots = []; town.buildings = 24;
  town.agriculture = undefined; town.workedDeposits = []; town.development = undefined;
  state.tradeRoutes = [];
  const height = state.world.seaLevel + 0.2;
  state.world.terrain.height.fill(height); state.world.terrain.waterLevel.fill(-1);
  state.world.terrain.river.fill(0); state.world.terrain.lake.fill(0);
  for (const cell of state.world.cells) Object.assign(cell, { elevation: height, water: false,
    biome: 'grassland', landform: 'lowland', slope: 0, relief: 0, modifications: undefined });
  for (const cell of state.weather.cells) cell.floodDepth = 0;
  const step = state.world.cellSize;
  const points = history === 'none' ? [] : history === 'east'
    ? [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0]]
    : [[0, -2], [0, -1], [0, 0], [1, 0], [1, 1], [1, 2]];
  for (const [x, z] of points) {
    const cell = cellAt(state.world, x! * step, z! * step)!;
    cell.modifications = { footpath: { intensity: 0.3, firstMonth: 0, lastMonth: 120, ownerId: town.id } };
  }
  state.month = 120;
  return { state, town };
}

