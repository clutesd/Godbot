import { emitEvent } from '../History';
import { hasKnowledgeCapability as knows } from '../knowledge/CapabilityContract';
import { materialEconomy, takeMaterial } from '../resources/Inventory';
import { settlementRepresentedPopulation } from '../Population';
import type { Settlement, SimulationState } from '../types';
import {
  chargeStorage,
  dispatchPriority,
  dischargeStorage,
  finalizeStorageMonth,
  generationDispatchRequest,
  gridComponent,
  gridComponentDemand,
  gridComponentStorageInputCapacity,
  nuclearBuildJustified,
  prepareStorageMonth,
  storageChargeInputCapacity,
  storageDischargeOutputCapacity,
} from './AdvancedEnergy';
import { combustionFromFuel, combustionFuelPotential, isCombustionKind, planCombustion } from './Combustion';
import { GENERATORS, eligibleGenerator, environmentFactor, generatorDefinition } from './Generation';
import { buildWork, constructGrid, deliver } from './Transmission';
import { prepareElectricDemand, type ElectricConsumer } from './Demand';
import { POWER_PRIORITIES, energyAt, energyWorld, ledger, powerServiceCoverage, type EnergyPlant, type GeneratorKind } from './types';

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
        if (g.kind === 'nuclear' && !nuclearBuildJustified(state, s)) return 0;
        const fuelReadiness = isCombustionKind(g.kind)
          ? Math.min(1, combustionFuelPotential(s, g.kind) / Math.max(1, g.capacity * 0.25))
          : g.fuel === 'food'
            ? Math.min(1, s.resources.food / 3)
            : g.fuel
              ? Math.min(1, (s.localMaterials[g.fuel] ?? 0) / 3)
              : 1;
        return Math.min(g.capacity * environmentFactor(state, s, g.kind), e.ledgers[g.carrier].demand * 1.3) * fuelReadiness / g.work;
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
  const storageTarget = e.ledgers.electric.demand * (knows(s, 'grid-management') ? 3 : 2);
  if (knows(s, 'battery-storage') && e.storageCapacity < storageTarget) {
    e.storageCapacity += buildWork(state, s, { copper: 1, iron: 1 }, Math.min(0.5, (storageTarget - e.storageCapacity) / 8)) * 8;
  }
}
function operate(state: SimulationState, s: Settlement, p: EnergyPlant, need: number): number {
  p.output = 0; p.fuelUsed = 0; p.fuelKind = undefined; p.heatInput = 0; p.conversionLoss = 0;
  if (p.progress < 1) { p.status = 'construction'; return 0; }
  const g = generatorDefinition(p.kind), site = s.structurePlots?.find(x => x.id === p.plotId);
  if (!site || site.development?.status !== 'active' || site.accessRestricted || !eligibleGenerator(state, s, g)) { p.status = 'idle'; return 0; }
  const weather = state.weather.cells[s.cellIndex];
  p.condition = Math.max(0, p.condition - (p.kind === 'nuclear' ? 0.0012 : 0.002)
    - Math.max(0, (weather?.wind ?? 0) - 0.8) * 0.04 - (site.floodDepth ?? 0) * 0.03);
  if (p.condition < 0.92) {
    const maintenance = p.kind === 'nuclear' ? { steel: 0.2, copper: 0.08 }
      : { [g.carrier === 'mechanical' ? 'timber' : 'iron']: 0.2 };
    p.condition = Math.min(1, p.condition + buildWork(state, s, maintenance, 0.1) * (p.kind === 'nuclear' ? 0.14 : 0.1));
  }
  const cell = state.world.cells[s.cellIndex];
  const coolingWater = Math.max(s.development?.water?.availability ?? 0, cell?.lake ? 1 : 0, cell?.river ? cell.flow : 0);
  const cooling = !g.cooling ? 1 : Math.min(1, coolingWater * 2);
  if (p.condition < (p.kind === 'nuclear' ? 0.82 : 0.25)) { p.status = 'failed'; return 0; }
  if (cooling < (p.kind === 'nuclear' ? 0.65 : 0.05)) { p.status = 'idle'; return 0; }
  let output = Math.min(need, g.capacity * environmentFactor(state, s, p.kind) * p.condition * cooling * site.condition);
  if (isCombustionKind(p.kind)) {
    const plan = planCombustion(s, p.kind, output);
    energyAt(s).materialDemand[plan.fuel] = Math.max(energyAt(s).materialDemand[plan.fuel] ?? 0, plan.fuelRequired * 2);
    materialEconomy(s).demand[plan.fuel] = Math.max(materialEconomy(s).demand[plan.fuel] ?? 0, plan.fuelRequired * 2);
    p.fuelUsed = takeMaterial(s, plan.fuel, plan.fuelUsed);
    const actual = combustionFromFuel(p.kind, plan.fuel, p.fuelUsed);
    p.fuelKind = plan.fuel;
    p.heatInput = actual.heatInput;
    p.conversionLoss = actual.conversionLoss;
    output = Math.min(output, actual.output);
    s.pollution = Math.min(1, s.pollution + actual.pollution);
  } else if (g.fuel) {
    const efficiency = g.efficiency ?? 1;
    const reserveMonths = p.kind === 'nuclear' ? 6 : 2;
    energyAt(s).materialDemand[g.fuel] = Math.max(energyAt(s).materialDemand[g.fuel] ?? 0, output / efficiency * reserveMonths);
    materialEconomy(s).demand[g.fuel] = Math.max(materialEconomy(s).demand[g.fuel] ?? 0, output / efficiency * reserveMonths);
    if (g.fuel === 'food') {
      p.fuelUsed = Math.min(Math.max(0, s.resources.food - settlementRepresentedPopulation(state, s.id)), output / efficiency);
      s.resources.food -= p.fuelUsed;
    } else {
      p.fuelUsed = takeMaterial(s, g.fuel, output / efficiency);
    }
    p.fuelKind = g.fuel;
    output = p.fuelUsed * efficiency;
    if (p.kind === 'nuclear' && p.fuelUsed > 0) s.localMaterials['spent-nuclear-fuel'] = (s.localMaterials['spent-nuclear-fuel'] ?? 0) + p.fuelUsed;
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
  const consumers = new Map<string, ElectricConsumer[]>();
  for (const s of living) {
    const e = energyAt(s), population = settlementRepresentedPopulation(state, s.id);
    e.materialDemand = {};
    e.ledgers = { thermal: ledger(), mechanical: ledger(), electric: ledger() };
    const thermal = e.ledgers.thermal;
    thermal.demand = s.survival?.cold.fuelNeed ?? 0;
    thermal.generated = thermal.supplied = s.survival?.cold.fuelUsed ?? 0;
    e.ledgers.mechanical.demand = knows(s, 'wheel-axle') ? s.infrastructure.workshops * 10 + s.industry.intensity * 8 : 0;
    consumers.set(s.id, knows(s, 'electrical-generation') ? prepareElectricDemand(s, population) : prepareElectricDemand(s, 0));
    if (!knows(s, 'electrical-generation')) {
      const service = energyAt(s).service;
      service.demand.essential = service.demand.productive = service.demand.discretionary = service.demand.critical = 0;
      e.ledgers.electric.demand = 0;
      consumers.set(s.id, []);
    }
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
  // Serve critical loads before ordinary life, production and discretionary demand. Every priority
  // first consumes local generation/storage, then may import remaining power across commissioned lines.
  const allConsumers = [...consumers.values()].flat();
  const serve = (consumer: ElectricConsumer, local: boolean): void => {
    let need = Math.max(0, consumer.demand - consumer.supplied);
    if (need <= 0) return;
    const receiverEnergy = energyAt(consumer.settlement);
    const ordered = sources
      .filter(source => (source.s.id === consumer.settlement.id) === local)
      .sort((a, b) => Number(a.storage) - Number(b.storage) || a.s.id.localeCompare(b.s.id) || a.node.localeCompare(b.node));
    for (const source of ordered) {
      if (need <= 1e-9 || source.available <= 1e-9) continue;
      const flow = deliver(world.lines, source.node, consumer.node, source.available, need);
      if (flow.received <= 0) continue;
      source.available = Math.max(0, source.available - flow.sent);
      need = Math.max(0, need - flow.received);
      consumer.supplied += flow.received;
      receiverEnergy.service.supplied[consumer.priority] += flow.received;
      receiverEnergy.ledgers.electric.supplied += flow.received;
      const donor = energyAt(source.s).ledgers.electric;
      donor.losses += flow.sent - flow.received;
      if (source.storage) {
        energyAt(source.s).storage = Math.max(0, energyAt(source.s).storage - flow.sent);
        donor.discharged += flow.sent;
      }
      if (source.s.id !== consumer.settlement.id) {
        donor.exported += flow.received;
        receiverEnergy.ledgers.electric.imported += flow.received;
        milestone(state, consumer.settlement, 'first-regional-grid', 'A connected regional grid delivers power between settlements.');
      }
    }
  };
  for (const priority of POWER_PRIORITIES) {
    const priorityConsumers = allConsumers
      .filter(consumer => consumer.priority === priority)
      .sort((a, b) => a.settlement.id.localeCompare(b.settlement.id) || a.id.localeCompare(b.id));
    for (const consumer of priorityConsumers) serve(consumer, true);
    for (const consumer of priorityConsumers) serve(consumer, false);
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
    const essentialDemand = e.service.demand.essential;
    const visibleSupply = e.service.supplied.essential + e.service.supplied.discretionary;
    e.lit = l.demand > 0 && visibleSupply > 0 && (essentialDemand <= 0 || powerServiceCoverage(s, 'essential') >= 0.7);
    e.shortageMonths = e.reliability < 0.8 ? e.shortageMonths + 1 : Math.max(0, e.shortageMonths - 1);
    s.infrastructure.power = l.demand > 0 ? e.reliability * Math.min(1, l.supplied / 25) : 0;
    if (e.lit) milestone(state, s, 'first-illuminated-settlement', 'Electric light reaches occupied buildings.');
  }
}
