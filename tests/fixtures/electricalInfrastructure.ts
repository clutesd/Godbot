import { constructGrid } from '../../src/sim/energy/Transmission';
import { energyAt, energyWorld } from '../../src/sim/energy/types';
import { infrastructureLabourBudget } from '../../src/sim/people/HumanCapital';
import { connect, learn, societyFixture } from './settlementDevelopment';

export function electricalFixture(regional = false, mature = true) {
  const result = societyFixture();
  const { state, settlements } = result;
  for (const s of settlements) s.structurePlots = [];
  const s = settlements[0]!;
  learn(s, 'electrical-generation');
  if (mature) learn(s, 'electric-grid');
  // Physical active development, deliberately on both sides of the civic road network.
  for (const [id, x, z, need] of [['plant', -23, -19, 'energy'], ['home', -11, -14, 'housing']] as const) {
    s.structurePlots!.push({ id, worldX: x, worldZ: z, radius: 0.8, width: 1, depth: 1, height: 1,
      condition: 1, foundedMonth: 0, development: {
        need, form: 'works', name: id, level: 1, material: 'timber', cultureId: state.cultures[0]!.id,
        style: { ...state.cultures[0]!.style }, services: {}, reasons: [], capabilities: [],
        cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1, status: 'active',
        origin: { month: 0, action: 'founded', name: id, need, cultureId: state.cultures[0]!.id, reasons: [] },
        history: [], transitionCount: 0, lastUsedMonth: 0,
      } });
  }
  state.transportation.segments['local-road'] = { id: 'local-road', from: s.id, to: s.id, mode: 'road',
    kind: 'surface', status: 'complete', points: [{ x: -24, z: -17, y: 1 }, { x: -18, z: -17, y: 1 },
      { x: -18, z: -12, y: 1 }, { x: -10, z: -12, y: 1 }], length: 19, cost: 1, work: 1 };
  energyAt(s).plants.push({ id: 'generator', plotId: 'plant', kind: 'generator', progress: 1, condition: 1, output: 10, fuelUsed: 0, status: 'running' });
  energyAt(s).storageCapacity = 20;
  for (const settlement of settlements) {
    settlement.localMaterials.copper = settlement.localMaterials.iron = settlement.localMaterials.timber = 1000;
    infrastructureLabourBudget(state, settlement).remaining = 1000;
  }
  if (regional) { learn(settlements[1]!, 'electrical-generation', 'electric-grid'); connect(state, s, settlements[1]!); }
  constructGrid(state);
  return { ...result, s, world: energyWorld(state) };
}
