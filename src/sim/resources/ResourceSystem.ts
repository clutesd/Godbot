import type { SeededRandom } from '../prng';
import { mastery, type KnowledgeEventDraft } from '../knowledge/KnowledgeSystem';
import type { MaterialInventory, ResourceDeposit, Settlement, SimulationState } from '../types';
import { RESOURCE_BY_ID } from './catalog';
import { advanceDeposits, harvestSeason } from './WorldResourceSystem';
import { addMaterial, materialEconomy, publishBulkStocks, reconcileBulkStocks, storageRoom, takeMaterial } from './Inventory';
import { processRecipes, useLabour, type LabourBudget } from './Processing';
import { consumeMaterials } from './Consumption';
import { ExtractionAccessibility } from './ExtractionAccessibility';
import { discoverProvince, discoveryReadiness } from './ResourceDiscoverySystem';
import { advanceEnvironment, disturbForest, forestRecoveryTarget, logProvince, modifyLand, wearExtractionPath } from '../environment/EnvironmentalModificationSystem';

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
export type ResourceEventDraft = KnowledgeEventDraft;
export function createMaterialState(): { materials: MaterialInventory; discoveredDeposits: string[]; workedDeposits: string[]; knownRecipes: string[] } {
  return { materials: {}, discoveredDeposits: [], workedDeposits: [], knownRecipes: [] };
}
export function depositControlled(state: SimulationState, s: Settlement, deposit: ResourceDeposit): boolean {
  const owner = state.settlements.find(other => other.id === deposit.controlledBy && other.alive);
  return !owner || owner.id === s.id || owner.polityId === s.polityId;
}
/** Expertise opens deeper reserves; exhausted rock never regenerates. */
export function extractableQuantity(s: Settlement, deposit: ResourceDeposit): number {
  const definition = RESOURCE_BY_ID.get(deposit.resourceId);
  if (!definition || deposit.depleted) return 0;
  if (definition.understandingKnowledge && mastery(s, definition.understandingKnowledge).theory < 0.12) return 0;
  let accessible = deposit.surfaceShare ?? 1;
  if (definition.extractionKnowledge) {
    const technology = mastery(s, definition.extractionKnowledge).practice;
    if (technology >= 0.3 && s.infrastructure.workshops >= 0.05) accessible += (1 - accessible) * clamp((technology + s.infrastructure.workshops * 0.4) / (1 + (deposit.depth ?? 0) * 0.3));
  }
  return deposit.capacity * Math.max(0, Math.min(deposit.abundance, accessible - (1 - deposit.abundance)));
}

export class ResourceSystem {
  private access?: ExtractionAccessibility;
  private world?: SimulationState['world'];
  constructor(private readonly random: SeededRandom) {}
  advanceMonth(state: SimulationState): ResourceEventDraft[] {
    if (this.world !== state.world) { this.world = state.world; this.access = new ExtractionAccessibility(state); }
    const events: ResourceEventDraft[] = [];
    advanceEnvironment(state);
    advanceDeposits(state.world, state.month);
    const deposits = new Map(state.world.resourceDeposits.map(d => [d.id, d]));
    const peopleByHome = new Map<string, SimulationState['people']>();
    for (const p of state.people) if (p.alive) {
      const group = peopleByHome.get(p.homeId) ?? []; group.push(p); peopleByHome.set(p.homeId, group);
    }
    for (const s of state.settlements.filter(s => s.alive)) {
      reconcileBulkStocks(s);
      const economy = materialEconomy(s);
      const people = peopleByHome.get(s.id) ?? [];
      const budget: LabourBudget = {};
      const shares: LabourBudget = { forager: 0.5, builder: 0.35, artisan: 0.6, keeper: 0.5, elder: 0.25, carrier: 0.5 };
      for (const p of people) budget[p.occupation] = (budget[p.occupation] ?? 0) + (shares[p.occupation] ?? 0) * clamp(p.health);
      economy.demand = { timber: Math.max(12, s.buildings * 3), stone: Math.max(6, s.buildings) };
      economy.energyDemand = 0; economy.energySupplied = 0; economy.labourUsed = 0;
      economy.delivered = {};
      this.deliver(state, s, deposits);
      const radius = (7 + s.infrastructure.roads * 10 + s.infrastructure.ports * 16 + s.infrastructure.rail * 20) * state.world.cellSize;
      const nearby = state.world.resourceDeposits.filter(d => Math.hypot(d.worldX - s.position.x, d.worldZ - s.position.z) <= radius);
      this.discover(state, s, nearby, budget, events);
      events.push(...processRecipes(state, s, budget, this.random));
      this.gather(state, s, nearby, budget, events);
      consumeMaterials(state, s, people, budget, events);
      publishBulkStocks(s);
    }
    for (const deposit of state.world.resourceDeposits) {
      if (!deposit.controlledBy || deposit.abandonedMonth !== undefined) continue;
      const owner = state.settlements.find(s => s.id === deposit.controlledBy);
      if (owner?.alive && state.month - (deposit.lastWorkedMonth ?? state.month) < 120 && !deposit.depleted) continue;
      deposit.abandonedMonth = state.month;
      if (owner) {
        owner.workedDeposits = owner.workedDeposits.filter(id => id !== deposit.id);
        if (!deposit.renewable || deposit.depleted) events.push(this.siteEvent(owner, deposit, 'resource-site-abandoned', 'Abandoned after extraction ceased.', ['extraction-ceased']));
      }
      deposit.controlledBy = undefined;
    }
    return events;
  }
  private discover(state: SimulationState, s: Settlement, nearby: ResourceDeposit[], budget: LabourBudget, events: ResourceEventDraft[]): void {
    const explorers = budget.forager ?? 0;
    if (explorers <= 0) return;
    for (const deposit of nearby) {
      if (s.discoveredDeposits.includes(deposit.id) || deposit.depleted) continue;
      const distance = Math.hypot(deposit.worldX - s.position.x, deposit.worldZ - s.position.z) / state.world.cellSize;
      const readiness = discoveryReadiness(s, deposit);
      if (readiness <= 0 || !this.random.chance(0.06 * readiness * Math.min(2, explorers / 3) / (1 + distance * 0.25)) || !this.access!.resolve(s, deposit)) continue;
      discoverProvince(s, deposit, state.month);
      const definition = RESOURCE_BY_ID.get(deposit.resourceId)!;
      s.knowledge.experimentation[definition.researchDomain ?? 'materials'] += 0.05;
      const key = `discovery:${definition.id}`;
      const economy = materialEconomy(s);
      if (state.month - (economy.lastEventMonth[key] ?? -120) >= 120) {
        economy.lastEventMonth[key] = state.month;
        events.push(this.siteEvent(s, deposit, 'resource-deposit-discovered', `${s.name} located ${definition.name.toLowerCase()}; extraction still requires labour and access.`, [readiness > (deposit.exposure ?? 1) ? 'prospecting' : 'exploration']));
      }
    }
    materialEconomy(s).labourUsed += useLabour(budget, ['forager'], Math.min(0.2, explorers));
  }
  private deliver(state: SimulationState, s: Settlement, deposits: Map<string, ResourceDeposit>): void {
    const economy = materialEconomy(s);
    for (const shipment of [...economy.inTransit]) {
      const deposit = deposits.get(shipment.depositId);
      if (deposit && !depositControlled(state, s, deposit)) continue;
      if (!this.access!.valid({ accessPaths: shipment.accessPaths ?? [shipment.path], networkPath: shipment.networkPath })) continue;
      shipment.remainingMonths--;
      if (shipment.remainingMonths > 0) continue;
      economy.inTransit = economy.inTransit.filter(item => item !== shipment);
      const delivered = addMaterial(s, shipment.resourceId, shipment.quantity, shipment.quality);
      economy.delivered[shipment.resourceId] = (economy.delivered[shipment.resourceId] ?? 0) + delivered;
      if (delivered < shipment.quantity) economy.inTransit.push({ ...shipment, quantity: shipment.quantity - delivered, remainingMonths: 0 });
    }
  }
  private gather(state: SimulationState, s: Settlement, nearby: ResourceDeposit[], budget: LabourBudget, events: ResourceEventDraft[]): void {
    const economy = materialEconomy(s);
    const value = (d: ResourceDeposit) => d.quality * (d.accessibility ?? 1) / ((this.access!.resolve(s, d)?.cost ?? Infinity) * (1 + (d.extractionDifficulty ?? 0)));
    const queue = nearby.filter(d => s.discoveredDeposits.includes(d.id) && depositControlled(state, s, d) && extractableQuantity(s, d) > 0
      && (s.materials[d.resourceId] ?? 0) < Math.max(d.resourceId === 'timber' ? 35 : 12, (economy.demand[d.resourceId] ?? 0) * 2))
      .map(d => ({ d, value: value(d), need: (s.materials[d.resourceId] ?? 0) / (economy.demand[d.resourceId] ?? 6) }))
      .sort((a, b) => a.need - b.need || b.value - a.value || a.d.id.localeCompare(b.d.id)).map(item => item.d);
    for (const deposit of queue) {
      const definition = RESOURCE_BY_ID.get(deposit.resourceId)!;
      const available = extractableQuantity(s, deposit);
      if (available <= 0.00001 || storageRoom(s) <= 0) continue;
      const incoming = economy.inTransit.filter(t => t.resourceId === definition.id).reduce((n, t) => n + t.quantity, 0);
      const desired = Math.max(definition.id === 'timber' ? 35 : 12, (economy.demand[definition.id] ?? 0) * 2);
      if ((s.materials[definition.id] ?? 0) + incoming >= desired) continue;
      const cell = state.world.cells[deposit.cellIndex]!;
      const weather = state.world.weather?.cells[deposit.cellIndex];
      const season = definition.category === 'plant' ? harvestSeason(state.world, deposit, state.month)
        : definition.category === 'timber' ? 0.55 + harvestSeason(state.world, deposit, state.month) * 0.45 : 1;
      if (season <= 0 || (weather?.snowpack ?? 0) > 0.9 || (weather?.floodDepth ?? 0) > 0.1) continue;
      const access = this.access!.resolve(s, deposit);
      if (!access || access.cost > 8) continue;
      const { path } = access;
      const transportCost = access.cost * (1 + (deposit.extractionDifficulty ?? 0));
      const labour = definition.gatherOccupations.reduce((sum, o) => sum + (budget[o] ?? 0), 0);
      const tools = 1 + clamp(economy.tools / 12) * 0.7;
      const primitiveWood = definition.category === 'timber' && mastery(s, 'stone-composites').practice < 0.18 ? 0.25 : 1;
      const exposed = Math.max(0, 1 - (weather?.blizzard ?? 0) * 0.5 - (weather?.snowpack ?? 0) * 0.3);
      const rate = definition.gatherYieldPerWorker * Math.max(0.12, deposit.quality) * (deposit.accessibility ?? 1) * season * tools * Math.max(0, 1 - s.conflictPressure * 0.8) * primitiveWood * exposed / transportCost;
      if (rate <= 0) continue;
      const surfaceRemaining = deposit.capacity * Math.max(0, (deposit.surfaceShare ?? 1) - (1 - deposit.abundance));
      const fuel = deposit.depth !== undefined ? definition.deepEnergy : undefined;
      const deepCapacity = fuel ? (s.materials[fuel.material] ?? 0) / fuel.perUnit : Infinity;
      const amount = Math.min(available, surfaceRemaining + deepCapacity, labour * rate, storageRoom(s), desired - (s.materials[definition.id] ?? 0) - incoming);
      if (amount <= 0.00001) continue;
      economy.labourUsed += useLabour(budget, definition.gatherOccupations, amount / rate);
      if (fuel && amount > surfaceRemaining) {
        const spent = takeMaterial(s, fuel.material, (amount - surfaceRemaining) * fuel.perUnit);
        economy.energyDemand += spent; economy.energySupplied += spent;
      }
      deposit.abundance = Math.max(0, deposit.abundance - amount / deposit.capacity);
      deposit.extracted = (deposit.extracted ?? 0) + amount;
      if (definition.category === 'timber') {
        logProvince(state.world, deposit, amount, state.month, s.id);
      } else if (definition.ecologicalDamage) {
        cell.fertility = Math.max(0, cell.fertility - amount / deposit.capacity * definition.ecologicalDamage);
        s.pollution = clamp(s.pollution + amount * definition.ecologicalDamage * 0.0005);
        modifyLand(cell, definition.id === 'stone' ? 'quarry' : 'mine', Math.min(1, 0.06 + deposit.extracted / Math.max(10, deposit.capacity * 0.1)), state.month, s.id);
        const target = forestRecoveryTarget(cell);
        if (cell.wood > target) { disturbForest(cell, (cell.wood - target) / Math.max(0.01, cell.forestCapacity ?? 1), state.month); cell.wood = target; }
      }
      for (const leg of access.accessPaths) wearExtractionPath(state.world, leg, amount, state.month, s.id);
      deposit.accessTrails = access.accessPaths;
      if (definition.category === 'timber' && deposit.abundance < 0.35 && !deposit.deforestationRecorded) {
        deposit.deforestationRecorded = true;
        events.push({ ...this.siteEvent(s, deposit, 'ecological-crisis', 'Sustained logging removed most of a woodland district.', ['deforestation']),
          summary: `${s.name}'s timber district has lost most of its standing forest.`, significance: 0.7 });
      }
      if (!deposit.renewable && deposit.extracted > deposit.capacity * 0.12 && deposit.establishedMonth !== undefined
        && state.month - deposit.establishedMonth < 600 && !deposit.expansionRecorded) {
        deposit.expansionRecorded = true;
        events.push({ ...this.siteEvent(s, deposit, 'resource-site-established', 'Extraction expanded rapidly across the mineral district.', ['mining-expansion']),
          summary: `${s.name}'s ${definition.name.toLowerCase()} district expands rapidly.`, significance: 0.68 });
      }
      if (deposit.renewable && deposit.abundance < 0.2) deposit.overharvested = true;
      if (deposit.abundance < 1e-8) {
        deposit.abundance = 0; deposit.depleted = true;
        if (!deposit.renewable) events.push(this.siteEvent(s, deposit, 'resource-depleted', `Extraction exhausted the ${definition.name.toLowerCase()} at this site.`, ['depletion']));
      }
      economy.inTransit.push({ depositId: deposit.id, resourceId: definition.id, quantity: amount, quality: deposit.quality, path,
        accessPaths: access.accessPaths, networkPath: access.networkPath, remainingMonths: access.months });
      economy.experience[definition.id] = (economy.experience[definition.id] ?? 0) + amount;
      s.knowledge.experimentation[definition.researchDomain ?? 'materials'] += amount * 0.006;
      if (!s.workedDeposits.includes(deposit.id)) {
        const first = deposit.establishedMonth === undefined;
        s.workedDeposits.push(deposit.id); deposit.controlledBy ??= s.id; deposit.establishedMonth ??= state.month; deposit.abandonedMonth = undefined;
        if (first) events.push(this.siteEvent(s, deposit, 'resource-site-established', `${s.name} assigned workers and a carrying route to ${definition.name.toLowerCase()}.`, ['labour-assigned', 'surveyed-access']));
      }
      deposit.lastWorkedMonth = state.month;
    }
  }
  private siteEvent(s: Settlement, d: ResourceDeposit, type: ResourceEventDraft['type'], outcome: string, causes: string[]): ResourceEventDraft {
    const name = RESOURCE_BY_ID.get(d.resourceId)?.name.toLowerCase() ?? d.resourceId;
    return { type, location: { x: d.worldX, z: d.worldZ }, locationId: s.id, actors: [s.id], causes,
      context: { resource: d.resourceId, deposit: d.id, quality: d.quality, remaining: d.capacity * d.abundance }, outcome,
      significance: d.resourceId.includes('ore') ? 0.62 : 0.35, tags: ['resource', 'economy'],
      summary: `${s.name}: ${name} ${type === 'resource-deposit-discovered' ? 'discovered' : type === 'resource-depleted' ? 'exhausted' : type === 'resource-site-abandoned' ? 'site abandoned' : 'site established'}.` };
  }
}
