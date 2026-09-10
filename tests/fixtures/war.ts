import { Simulation } from '../../src/sim/Simulation';
import type { Relation, Settlement, War } from '../../src/sim/types';
import { cellAt } from '../../src/sim/world';

/** Isolate campaign rules from births, harvests and randomly changing weather. */
export function warFixture(seed = 'watcher-campaign') {
  const sim = new Simulation({ seed, startingPopulation: 160, settlementCount: [2, 2], world: { size: 24 }, society: { conflictRate: 0 } });
  const state = sim.state;
  const ground = state.world.seaLevel + 0.15;
  state.world.terrain.height.fill(ground);
  state.world.terrain.waterLevel.fill(-1);
  state.world.terrain.river.fill(0);
  state.world.terrain.lake.fill(0);
  for (const cell of state.world.cells) Object.assign(cell, { elevation: ground, water: false, river: false, lake: false, coast: false,
    slope: 0, relief: 0, biome: 'grassland', landform: 'lowland', fertility: 0.8, moisture: 0.6, movementCost: 1 });
  for (const weather of state.weather.cells) Object.assign(weather, { snowpack: 0, floodDepth: 0, travelPenalty: 0 });
  state.world.environmentRevision = (state.world.environmentRevision ?? 0) + 1;
  const a = state.settlements[0]!;
  const b = state.settlements[1]!;
  [a, b].forEach((s, i) => {
    s.position = { x: i === 0 ? -16 : 16, z: 0 };
    const cell = cellAt(state.world, s.position.x, s.position.z)!;
    s.cellIndex = cell.z * state.world.size + cell.x;
    s.foodSecurity = 0.85; s.prosperity = 0.8; s.resources.food = 1000;
    s.politicalPower.military = 0.6;
  });
  // A stable adulthood distribution makes finite, actually removed casualties measurable.
  state.people.forEach(p => { p.ageMonths = 28 * 12; p.health = 1; });
  const engine = sim as unknown as { startWar(a: Settlement, b: Settlement, relation: Relation): void; runWars(): void; endWar(war: War, a: Settlement, b: Settlement, reason?: War['resolutionReason']): void };
  const relation = state.relations[0]!;
  relation.hostility = 0.9; relation.grievances = 0.8; relation.territorialTension = 0.7;
  const declare = () => { engine.startWar(a, b, relation); return state.wars.at(-1)!; };
  const tick = (months = 1) => { for (let i = 0; i < months; i++) { state.month++; engine.runWars(); } };
  return { sim, state, a, b, engine, declare, tick };
}
