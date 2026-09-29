import { emitEvent } from '../History';
import { hasKnowledgeCapability as knows } from '../knowledge/CapabilityContract';
import { materialEconomy, takeMaterial } from '../resources/Inventory';
import { settlementRepresentedPopulation } from '../Population';
import type { Settlement, SimulationState } from '../types';
import { GENERATORS, eligibleGenerator, environmentFactor, generatorDefinition } from './Generation';
import { buildWork, constructGrid, deliver } from './Transmission';
import { energyAt, energyWorld, ledger, type EnergyPlant } from './types';

function milestone(state: SimulationState, s: Settlement, key: string, description: string, plant?: EnergyPlant): void {
  const world = energyWorld(state);
  if (world.milestones.includes(key)) return;
  world.milestones.push(key);
  const plot = s.structurePlots?.find(p => p.id === plant?.plotId);
  emitEvent(state, { type: 'infrastructure-built', location: plot ? { x: plot.worldX, z: plot.worldZ } : s.position, locationId: s.id,
    actors: [s.id], causes: ['operating-energy-infrastructure'], context: { need: 'energy', milestone: key, plant: plant?.id ?? '', action: 'operating' },
    outcome: description, affectedPopulation: settlementRepresentedPopulation(state, s.id), magnitude: 0.8, significance: 0.9, tags: ['energy', 'milestone'], summary: `${s.name}: ${description}` });
}
function constructPlants(state: SimulationState, s: Settlement): void {
  const e = energyAt(s);
  const sites = (s.structurePlots ?? []).filter(p => p.development?.status === 'active' && !p.accessRestricted && (p.development.need === 'energy' || p.development.need === 'manufacturing'));
  // Retrofit existing, terrain-validated industrial plots. One machine per physical site.
  for (const site of sites) {
    let plant = e.plants.find(p => p.plotId === site.id);
    if (!plant) {
      const choices = GENERATORS.filter(g => eligibleGenerator(state, s, g) && e.ledgers[g.carrier].demand > e.plants.filter(p => p.progress >= 1 && generatorDefinition(p.kind).carrier === g.carrier).reduce((n, p) => n + p.output, 0) * 1.15);
      choices.sort((a, b) => score(b) - score(a));
      function score(g: typeof GENERATORS[number]): number {
        const fuel = g.fuel === 'food' ? s.resources.food : g.fuel ? s.localMaterials[g.fuel] ?? (g.fuel === 'coal' ? s.localMaterials.timber ?? 0 : 0) : 10;
        return Math.min(g.capacity * environmentFactor(state, s, g.kind), e.ledgers[g.carrier].demand * 1.3) * Math.min(1, fuel / 3) / g.work;
      }
      const chosen = choices.find(g => score(g) > 0 && Object.entries(g.cost).every(([id, n]) => (s.localMaterials[id] ?? 0) >= n * 0.1));
      if (!chosen) continue;
      plant = { id: `power:${s.id}:${site.id}`, plotId: site.id, kind: chosen.kind, progress: 0, condition: 1, output: 0, fuelUsed: 0, status: 'construction' };
      e.plants.push(plant);
    }
    if (plant.progress < 1) {
      const g = generatorDefinition(plant.kind);
      if (!eligibleGenerator(state, s, g)) continue;
      const costs = Object.fromEntries(Object.entries(g.cost).map(([id, n]) => [id, n / g.work]));
      plant.progress = Math.min(1, plant.progress + buildWork(state, s, costs, Math.min(1, (1 - plant.progress) * g.work)) / g.work);
    }
  }
  if (knows(s, 'battery-storage') && e.storageCapacity < e.ledgers.electric.demand * 2) e.storageCapacity += buildWork(state, s, { copper: 1, iron: 1 }, 0.5) * 8;
}
function operate(state: SimulationState, s: Settlement, p: EnergyPlant, need: number): number {
  p.output = 0; p.fuelUsed = 0;
  if (p.progress < 1) { p.status = 'construction'; return 0; }
  const g = generatorDefinition(p.kind), site = s.structurePlots?.find(x => x.id === p.plotId);
  if (!site || site.development?.status !== 'active' || site.accessRestricted || !eligibleGenerator(state, s, g)) { p.status = 'idle'; return 0; }
  const weather = state.weather.cells[s.cellIndex];
  p.condition = Math.max(0, p.condition - 0.002 - Math.max(0, (weather?.wind ?? 0) - 0.8) * 0.04 - (site.floodDepth ?? 0) * 0.03);
  if (p.condition < 0.9) p.condition = Math.min(1, p.condition + buildWork(state, s, { [g.carrier === 'mechanical' ? 'timber' : 'iron']: 0.2 }, 0.1) * 0.1);
  const cooling = !g.cooling ? 1 : Math.min(1, (s.development?.water?.availability ?? state.world.cells[s.cellIndex]?.flow ?? 0) * 2);
  if (p.condition < (p.kind === 'nuclear' ? 0.8 : 0.25) || cooling < (p.kind === 'nuclear' ? 0.65 : 0.05)) { p.status = 'failed'; return 0; }
  let output = Math.min(need, g.capacity * environmentFactor(state, s, p.kind) * p.condition * cooling * site.condition);
  if (g.fuel) {
    let fuel = g.fuel;
    if (fuel === 'coal' && !((s.localMaterials.coal ?? 0) > 0)) fuel = 'timber';
    const efficiency = (g.efficiency ?? 1) * (fuel === 'timber' ? 0.5 : 1);
    energyAt(s).materialDemand[fuel] = output / efficiency * 2;
    materialEconomy(s).demand[fuel] = Math.max(materialEconomy(s).demand[fuel] ?? 0, output / efficiency * 2);
    if (fuel === 'food') { p.fuelUsed = Math.min(Math.max(0, s.resources.food - settlementRepresentedPopulation(state, s.id)), output / efficiency); s.resources.food -= p.fuelUsed; }
    else {
      const reserve = fuel === 'timber' ? s.survival?.cold.fuelNeed ?? 0 : 0;
      p.fuelUsed = takeMaterial(s, fuel, Math.min(output / efficiency, Math.max(0, (s.localMaterials[fuel] ?? 0) - reserve)));
    }
    output = p.fuelUsed * efficiency;
    if (p.kind === 'nuclear' && p.fuelUsed > 0) s.localMaterials['spent-nuclear-fuel'] = (s.localMaterials['spent-nuclear-fuel'] ?? 0) + p.fuelUsed;
    if (fuel !== 'food' && fuel !== 'nuclear-fuel') s.pollution = Math.min(1, s.pollution + p.fuelUsed * 0.0002);
  }
  p.output = Math.max(0, output); p.status = output > 0 ? 'running' : 'idle';
  if (output > 0) {
    milestone(state, s, g.carrier === 'mechanical' ? 'first-mechanical-power' : 'first-electricity', g.carrier === 'mechanical' ? 'Machinery performs sustained useful work.' : 'A working generator produces electricity.', p);
    if (p.kind === 'steam') milestone(state, s, 'first-steam-engine', 'A fuel-fed steam engine enters service.', p);
    if (p.kind === 'nuclear') milestone(state, s, 'first-nuclear-station', 'A cooled and maintained nuclear station supplies electricity.', p);
  }
  return p.output;
}
/** One deterministic monthly dispatch, before production. All quantities are normalized energy per month. */
export function advanceEnergy(state: SimulationState): void {
  const world = energyWorld(state);
  if (world.month === state.month) return;
  world.month = state.month;
  const living = state.settlements.filter(s => s.alive);
  for (const s of living) {
    const e = energyAt(s), population = settlementRepresentedPopulation(state, s.id);
    e.materialDemand = {};
    e.ledgers = { thermal: ledger(), mechanical: ledger(), electric: ledger() };
    const thermal = e.ledgers.thermal;
    thermal.demand = s.survival?.cold.fuelNeed ?? 0;
    thermal.generated = thermal.supplied = s.survival?.cold.fuelUsed ?? 0;
    e.ledgers.mechanical.demand = knows(s, 'wheel-axle') ? s.infrastructure.workshops * 10 + s.industry.intensity * 8 : 0;
    e.ledgers.electric.demand = knows(s, 'electrical-generation') ? population * 0.025 + s.infrastructure.factories * 35 + s.infrastructure.rail * 8 + s.infrastructure.archives * 3 : 0;
    constructPlants(state, s);
  }
  constructGrid(state);
  for (const l of world.lines) { l.flow = 0; l.condition = Math.max(0, l.condition - 0.001); }
  const totalDemand = living.reduce((n, s) => n + energyAt(s).ledgers.electric.demand + Math.max(0, energyAt(s).storageCapacity - energyAt(s).storage), 0);
  const sources: { s: Settlement; node: string; available: number; storage: boolean }[] = [];
  for (const s of living) {
    const e = energyAt(s);
    for (const p of e.plants) {
      const carrier = generatorDefinition(p.kind).carrier, l = e.ledgers[carrier];
      const output = operate(state, s, p, carrier === 'electric' ? totalDemand : Math.max(0, l.demand - l.supplied));
      l.generated += output;
      if (carrier === 'electric') sources.push({ s, node: p.id, available: output, storage: false });
      else l.supplied += output;
    }
    sources.push({ s, node: s.id, available: Math.min(e.storage, e.storageCapacity * 0.25), storage: true });
  }
  // Local generators first, imports next, stored power last. Consumer edges are necessary for service.
  for (const s of living) {
    const e = energyAt(s), consumers = (s.structurePlots ?? []).filter(p => p.development?.status === 'active' && !p.accessRestricted);
    for (const consumer of consumers) {
      let need = e.ledgers.electric.demand / consumers.length;
      const ordered = [...sources].sort((a, b) => Number(a.storage) - Number(b.storage) || Number(b.s.id === s.id) - Number(a.s.id === s.id));
      for (const source of ordered) {
        const flow = deliver(world.lines, source.node, consumer.id, source.available, need);
        source.available -= flow.sent; need -= flow.received;
        const donor = energyAt(source.s).ledgers.electric;
        donor.losses += flow.sent - flow.received;
        e.ledgers.electric.supplied += flow.received;
        if (source.storage) { energyAt(source.s).storage -= flow.sent; donor.discharged += flow.sent; }
        if (source.s.id !== s.id) { donor.exported += flow.received; e.ledgers.electric.imported += flow.received; if (flow.received > 0) milestone(state, s, 'first-regional-grid', 'A connected regional grid delivers power between settlements.'); }
      }
    }
  }
  for (const source of sources.filter(s => !s.storage)) {
    const e = energyAt(source.s), l = e.ledgers.electric;
    const charge = deliver(world.lines, source.node, source.s.id, source.available, Math.max(0, e.storageCapacity - e.storage) / 0.9);
    e.storage += charge.received * 0.9; l.charged += charge.received * 0.9;
    l.losses += charge.sent - charge.received * 0.9;
    l.curtailed += source.available - charge.sent;
  }
  for (const s of living) {
    const e = energyAt(s), l = e.ledgers.electric;
    e.reliability = l.demand > 0 ? Math.min(1, l.supplied / l.demand) : 1;
    e.lit = l.demand > 0 && e.reliability >= 0.75;
    e.shortageMonths = e.reliability < 0.8 ? e.shortageMonths + 1 : Math.max(0, e.shortageMonths - 1);
    s.infrastructure.power = l.demand > 0 ? e.reliability * Math.min(1, l.supplied / 25) : 0;
    if (e.lit) milestone(state, s, 'first-illuminated-settlement', 'Electric light reaches occupied buildings.');
  }
}
