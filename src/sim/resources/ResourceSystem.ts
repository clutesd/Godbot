import type { SeededRandom } from '../prng';
import { mastery, type KnowledgeEventDraft } from '../knowledge/KnowledgeSystem';
import { WalkabilityLayer } from '../people/WalkabilityLayer';
import type { MaterialInventory, ResourceDeposit, Settlement, SimulationState, Vec2 } from '../types';
import { RESOURCE_BY_ID } from './catalog';
import { advanceDeposits, harvestSeason } from './WorldResourceSystem';
import { addMaterial, materialEconomy, publishBulkStocks, reconcileBulkStocks, storageRoom } from './Inventory';
import { processRecipes, useLabour, type LabourBudget } from './Processing';
import { consumeMaterials } from './Consumption';

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
    if (technology >= 0.3 && s.infrastructure.workshops >= 0.05) accessible += (1 - accessible) * clamp(technology + s.infrastructure.workshops * 0.4);
  }
  return deposit.capacity * Math.max(0, Math.min(deposit.abundance, accessible - (1 - deposit.abundance)));
}

export class ResourceSystem {
  private walking?: WalkabilityLayer;
  private world?: SimulationState['world'];
  constructor(private readonly random: SeededRandom) {}
  advanceMonth(state: SimulationState): ResourceEventDraft[] {
    if (this.world !== state.world) { this.world = state.world; this.walking = new WalkabilityLayer(state.world); }
    const events: ResourceEventDraft[] = [];
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
      const radius = (6 + s.infrastructure.roads * 6) * state.world.cellSize;
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
        events.push(this.siteEvent(owner, deposit, 'resource-site-abandoned', 'Abandoned after extraction ceased.', ['extraction-ceased']));
      }
      deposit.controlledBy = undefined;
    }
    return events;
  }
  private path(s: Settlement, deposit: ResourceDeposit): Vec2[] {
    const end = { x: deposit.worldX, z: deposit.worldZ };
    if (!this.walking!.isWalkable(end)) return [];
    const path = this.walking!.route(s.position, end);
    const last = path.at(-1);
    return last && Math.hypot(last.x - end.x, last.z - end.z) < 0.1 ? path : [];
  }
  private discover(state: SimulationState, s: Settlement, nearby: ResourceDeposit[], budget: LabourBudget, events: ResourceEventDraft[]): void {
    const explorers = budget.forager ?? 0;
    if (explorers <= 0) return;
    for (const deposit of nearby) {
      if (s.discoveredDeposits.includes(deposit.id) || deposit.depleted) continue;
      const distance = Math.hypot(deposit.worldX - s.position.x, deposit.worldZ - s.position.z) / state.world.cellSize;
      if (!this.random.chance(0.06 * Math.min(2, explorers / 3) / (1 + distance * 0.25)) || !this.path(s, deposit).length) continue;
      s.discoveredDeposits.push(deposit.id); deposit.discoveredBy[s.id] = state.month;
      const definition = RESOURCE_BY_ID.get(deposit.resourceId)!;
      s.knowledge.experimentation[definition.researchDomain ?? 'materials'] += 0.05;
      events.push(this.siteEvent(s, deposit, 'resource-deposit-discovered', `${s.name} located ${definition.name.toLowerCase()}; extraction still requires labour and access.`, ['exploration']));
    }
    materialEconomy(s).labourUsed += useLabour(budget, ['forager'], Math.min(0.2, explorers));
  }
  private deliver(state: SimulationState, s: Settlement, deposits: Map<string, ResourceDeposit>): void {
    const economy = materialEconomy(s);
    for (const shipment of [...economy.inTransit]) {
      const deposit = deposits.get(shipment.depositId);
      if (deposit && !depositControlled(state, s, deposit)) continue;
      if (shipment.path.some((p, i) => i > 0 && !this.walking!.isSegmentWalkable(shipment.path[i - 1]!, p))) continue;
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
    const queue = nearby.filter(d => s.discoveredDeposits.includes(d.id) && depositControlled(state, s, d))
      .sort((a, b) => ((s.materials[a.resourceId] ?? 0) / (economy.demand[a.resourceId] ?? 6)) - ((s.materials[b.resourceId] ?? 0) / (economy.demand[b.resourceId] ?? 6)) || a.id.localeCompare(b.id));
    for (const deposit of queue) {
      const definition = RESOURCE_BY_ID.get(deposit.resourceId)!;
      const available = extractableQuantity(s, deposit);
      if (available <= 0.00001 || storageRoom(s) <= 0) continue;
      const incoming = economy.inTransit.filter(t => t.resourceId === definition.id).reduce((n, t) => n + t.quantity, 0);
      const desired = Math.max(definition.id === 'timber' ? 35 : 12, (economy.demand[definition.id] ?? 0) * 2);
      if ((s.materials[definition.id] ?? 0) + incoming >= desired) continue;
      const cell = state.world.cells[deposit.cellIndex]!;
      const weather = state.world.weather?.cells[deposit.cellIndex];
      const season = definition.category === 'plant' ? harvestSeason(state.world, deposit, state.month) : 1;
      if (season <= 0 || (weather?.snowpack ?? 0) > 0.9 || (weather?.floodDepth ?? 0) > 0.1) continue;
      const path = this.path(s, deposit);
      if (!path.length) continue;
      const length = path.reduce((sum, p, i) => sum + (i ? Math.hypot(p.x - path[i - 1]!.x, p.z - path[i - 1]!.z) : 0), 0) / state.world.cellSize;
      if (length > 9 + s.infrastructure.roads * 10) continue;
      const transportCost = 1 + length * (0.28 + cell.movementCost * 0.06) / (1 + s.infrastructure.roads * 2);
      const labour = definition.gatherOccupations.reduce((sum, o) => sum + (budget[o] ?? 0), 0);
      const tools = 1 + clamp(economy.tools / 12) * 0.7;
      const primitiveWood = definition.category === 'timber' && mastery(s, 'stone-composites').practice < 0.18 ? 0.25 : 1;
      const exposed = Math.max(0, 1 - (weather?.blizzard ?? 0) * 0.5 - (weather?.snowpack ?? 0) * 0.3);
      const rate = definition.gatherYieldPerWorker * Math.max(0.12, deposit.quality) * (deposit.accessibility ?? 1) * season * tools * Math.max(0, 1 - s.conflictPressure * 0.8) * primitiveWood * exposed / transportCost;
      if (rate <= 0) continue;
      const amount = Math.min(available, labour * rate, storageRoom(s), desired - (s.materials[definition.id] ?? 0) - incoming);
      if (amount <= 0.00001) continue;
      economy.labourUsed += useLabour(budget, definition.gatherOccupations, amount / rate);
      deposit.abundance = Math.max(0, deposit.abundance - amount / deposit.capacity);
      if (definition.category === 'timber') {
        cell.forestCapacity ??= Math.max(0.01, cell.wood);
        cell.wood = Math.max(0, cell.wood - amount / deposit.capacity * cell.forestCapacity);
        cell.lastLoggingMonth = state.month;
      } else if (definition.ecologicalDamage) {
        cell.fertility = Math.max(0, cell.fertility - amount / deposit.capacity * definition.ecologicalDamage);
        s.pollution = clamp(s.pollution + amount * definition.ecologicalDamage * 0.0005);
      }
      if (deposit.renewable && deposit.abundance < 0.2) deposit.overharvested = true;
      if (deposit.abundance < 1e-8) {
        deposit.abundance = 0; deposit.depleted = true;
        events.push(this.siteEvent(s, deposit, 'resource-depleted', `Extraction exhausted the ${definition.name.toLowerCase()} at this site.`, ['depletion']));
      }
      economy.inTransit.push({ depositId: deposit.id, resourceId: definition.id, quantity: amount, quality: deposit.quality, path,
        remainingMonths: Math.max(1, Math.ceil(length / (2 + s.infrastructure.roads * 4))) });
      economy.experience[definition.id] = (economy.experience[definition.id] ?? 0) + amount;
      s.knowledge.experimentation[definition.researchDomain ?? 'materials'] += amount * 0.006;
      if (!s.workedDeposits.includes(deposit.id)) {
        s.workedDeposits.push(deposit.id); deposit.controlledBy ??= s.id; deposit.establishedMonth ??= state.month; deposit.abandonedMonth = undefined;
        events.push(this.siteEvent(s, deposit, 'resource-site-established', `${s.name} assigned workers and a carrying route to ${definition.name.toLowerCase()}.`, ['labour-assigned', 'surveyed-access']));
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
