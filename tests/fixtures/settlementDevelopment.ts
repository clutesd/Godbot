import { Simulation } from '../../src/sim/Simulation';
import { advanceSettlementDevelopment, initializeSettlementDevelopment } from '../../src/sim/development/SettlementDevelopmentSystem';
import type { CultureDimensions, InstitutionKind, Settlement, SimulationState } from '../../src/sim/types';
import { syncStructurePlots } from '../../src/shared/StructurePlots';
import { cellAt } from '../../src/sim/world';

export function learn(s: Settlement, ...ids: string[]) {
  for (const id of ids) s.knowledge.records[id] = { id, theory: 0.8, practice: 0.8, discoveredMonth: 0, adoptedMonth: 0, lastUsedMonth: 0,
    originSettlementId: s.id, lineageId: id, parentLineages: [], source: 'inheritance', dormant: false };
}

export function societyFixture() {
  const sim = new Simulation({ seed: 'development-acceptance', startingPopulation: 256, world: { size: 20 }, settlementCount: [4, 4] });
  const state = sim.state;
  const ground = state.world.seaLevel + 0.15;
  state.world.terrain.height.fill(ground); state.world.terrain.waterLevel.fill(-1);
  state.world.terrain.river.fill(0); state.world.terrain.lake.fill(0);
  for (const cell of state.world.cells) Object.assign(cell, { elevation: ground, water: false, biome: 'grassland', landform: 'lowland', slope: 0, relief: 0,
    river: false, lake: false, coast: false, movementCost: 1, fertility: 0.75, moisture: 0.6, wood: 0.8, minerals: 0.5 });
  for (const weather of state.weather.cells) Object.assign(weather, { floodDepth: 0, waterDepth: 0 });
  const dimensions: CultureDimensions = { cooperation: 0.6, hierarchy: 0.6, militarism: 0.2, tradeOrientation: 0.2, curiosity: 0.2,
    religiousTendency: 0.2, institutionalTrust: 0.6, outsiderOpenness: 0.6, longTermOrientation: 0.6 };
  state.institutions = []; state.tradeRoutes = [];
  state.cultures = state.settlements.map((_s, i) => ({ ...structuredClone(state.cultures[i % state.cultures.length]!), id: `fixture-culture-${i}`,
    dimensions: { ...dimensions }, memory: { tradeSuccess: 0, collectiveSuccess: 0, frontierViolence: 0, militarySuccess: 0 } }));
  state.settlements.forEach((s, i) => {
    s.position = { x: i % 2 ? 18 : -18, z: i < 2 ? -18 : 18 };
    const cell = cellAt(state.world, s.position.x, s.position.z)!;
    s.cellIndex = cell.z * state.world.size + cell.x;
    s.cultureShares = { [state.cultures[i]!.id]: 1 };
    s.institutionIds = []; s.structurePlots = []; s.development = undefined; s.structurePlotTarget = undefined;
    s.buildings = 4; s.targetBuildings = 4; s.resources = { food: 2000, wood: 600, minerals: 600, goods: 400, wealth: 400 };
    s.foodSecurity = 0.9; s.prosperity = 0.8; s.specialization = 'forestry'; s.urbanization = 0.1; s.conflictPressure = 0;
    s.politicalPower.kinship = 0.1; s.politicalPower.institutional = 0.7;
    s.knowledge.records = {}; s.knowledge.literacy = 0;
    learn(s, 'stone-composites', 'leverage', 'pottery-firing', 'fire-control');
    residents(state, s).forEach((p, index) => { p.occupation = index < 6 ? 'builder' : index < 14 ? 'artisan' : index < 20 ? 'keeper' : 'forager'; p.health = 1; });
  });
  syncStructurePlots(state);
  state.settlements.forEach(s => initializeSettlementDevelopment(state, s));
  return { sim, state, settlements: state.settlements };
}

export function residents(state: SimulationState, s: Settlement) { return state.people.filter(p => p.homeId === s.id && p.alive); }
export function sponsor(state: SimulationState, s: Settlement, kind: InstitutionKind) {
  const id = `${s.id}:${kind}`;
  state.institutions.push({ id, name: id, kind, settlementId: s.id, cultureId: Object.keys(s.cultureShares)[0]!, foundedMonth: state.month,
    support: 0.9, prestige: 0.8, resources: 30, reach: 0.7, members: 24, interests: [kind] });
  s.institutionIds.push(id); return id;
}
export function connect(state: SimulationState, a: Settlement, b: Settlement) {
  state.transportation.segments['fixture-road'] = { id: 'fixture-road', from: a.id, to: b.id, mode: 'road', kind: 'surface', status: 'complete',
    points: [{ ...a.position, y: 1 }, { ...b.position, y: 1 }], length: 36, cost: 1, work: 1 };
  state.tradeRoutes.push({ id: `${a.id}-${b.id}`, a: a.id, b: b.id, active: true, volume: 0.8, ageMonths: 100, mode: 'land', caravanProgress: 0,
    caravanDirection: 1, knowledgeFlow: 0, cumulativeKnowledge: 2, transport: { projectIds: ['fixture-road'], nextDispatchMonth: 0,
      path: { mode: 'road', points: [{ ...a.position, y: 1 }, { ...b.position, y: 1 }], segmentIds: ['fixture-road'], length: 36 } } });
}
export function run(state: SimulationState, months: number, work = 0.08) {
  const events = [];
  for (let i = 0; i < months; i++) {
    state.month++;
    for (const s of state.settlements) events.push(...advanceSettlementDevelopment(state, s, residents(state, s), work));
  }
  return events;
}

export function contrastingSocieties() {
    const { state, settlements: [sacred, civic, martial, clan] } = societyFixture();
    const cultures = state.cultures;
    cultures[0]!.dimensions.religiousTendency = 0.95;
    sacred!.specialization = 'agriculture'; sponsor(state, sacred!, 'temple'); learn(sacred!, 'crop-selection', 'agrarian-surplus');
    residents(state, sacred!).slice(20).forEach(p => { p.occupation = 'farmer'; });
    cultures[1]!.dimensions.tradeOrientation = 0.95;
    sponsor(state, civic!, 'council'); sponsor(state, civic!, 'merchant-association'); learn(civic!, 'durable-records', 'counting-measure');
    connect(state, civic!, sacred!); connect(state, civic!, martial!);
    cultures[2]!.dimensions.militarism = 0.95; martial!.conflictPressure = 0.8; sponsor(state, martial!, 'military-order');
    cultures[3]!.dimensions.hierarchy = 0.1; clan!.politicalPower.kinship = 0.95;
    return { state, settlements: [sacred!, civic!, martial!, clan!] };
}
