import { mastery } from '../knowledge/KnowledgeSystem';
import type { Settlement, SimulationState, WorldCell, WorldState } from '../types';
import { ExtractionAccessibility } from './ExtractionAccessibility';
import { depositControlled, extractableQuantity } from './ResourceSystem';
import { resourceKnowledge } from './ResourceDiscoverySystem';
import { RESOURCE_CATALOG } from './catalog';

/** Siting reads visible ecology and inherited works, never undiscovered buried ore. */
export function environmentalSuitability(cell: WorldCell): number {
  return cell.water ? 0 : Math.max(0, cell.habitability * 0.5 + cell.fertility * 0.25 + cell.wood * 0.12
    + (cell.soil?.waterAccess ?? cell.flow) * 0.13 - (cell.modifications?.industry?.intensity ?? 0) * 0.1);
}
export function waterEconomy(cell: WorldCell, s: Settlement) {
  const water = cell.soil?.waterAccess ?? cell.flow;
  return { waterAccess: water, catchment: cell.soil?.catchment ?? -1,
    irrigation: water * mastery(s, 'irrigation').practice, processing: water * s.infrastructure.workshops,
    millPotential: water * cell.flow * (1 - cell.slope), portCapacity: s.infrastructure.ports };
}

/** Read-only settlement API. Callers can retain the routing service for cached repeated queries. */
export function settlementResources(state: SimulationState, s: Settlement, access = new ExtractionAccessibility(state)) {
  const provinces = state.world.resourceDeposits.filter(d => s.discoveredDeposits.includes(d.id)).map(d => {
    const knowledge = resourceKnowledge(s, d), route = access.resolve(s, d);
    const quantity = knowledge.understood ? extractableQuantity(s, d) : 0;
    return { id: d.id, resourceId: d.resourceId, quality: knowledge.understood ? d.quality : undefined,
      knownRemaining: knowledge.understood ? d.capacity * d.abundance : undefined,
      available: depositControlled(state, s, d) && route ? quantity : 0,
      transportCost: route?.cost ?? Infinity, economicValue: depositControlled(state, s, d) && route ? quantity * d.quality / route.cost : 0,
      exhausted: d.depleted, controlledBy: d.controlledBy, ...knowledge };
  });
  const shortages = RESOURCE_CATALOG.filter(r => (s.materialEconomy?.demand[r.id] ?? 0) > (s.localMaterials[r.id] ?? 0)
    && !provinces.some(p => p.resourceId === r.id && p.available > 0 && p.transportCost <= 8)).map(r => r.id);
  return { provinces, shortages, exhausted: provinces.filter(p => p.exhausted).map(p => p.id),
    threats: provinces.filter(p => p.controlledBy && !p.available && !p.exhausted).map(p => p.id),
    tradeOpportunities: state.settlements.filter(other => other.alive && other.id !== s.id && state.relations.some(r => r.contact
      && ((r.a === s.id && r.b === other.id) || (r.b === s.id && r.a === other.id))))
      .flatMap(other => shortages.filter(id => (other.localMaterials[id] ?? 0) > (other.materialEconomy?.demand[id] ?? 6))
        .map(resourceId => ({ settlementId: other.id, resourceId }))),
    water: waterEconomy(state.world.cells[s.cellIndex]!, s) };
}
export function knownResourceAttraction(world: WorldState, s: Settlement, cell: WorldCell): number {
  let score = 0;
  for (const d of world.resourceDeposits) {
    if (!s.discoveredDeposits.includes(d.id) || d.depleted || !resourceKnowledge(s, d).understood) continue;
    const range = Math.hypot(d.worldX - cell.worldX, d.worldZ - cell.worldZ) / world.cellSize;
    if (range < 6) score = Math.max(score, d.quality * d.abundance * (1 - range / 6) * 0.15);
  }
  return score;
}
