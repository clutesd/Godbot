import type { DestinationKind, Settlement, StructurePlot } from '../sim/types';
import type { SettlementNeed } from '../sim/development/types';

const DESTINATION_NEED: Partial<Record<DestinationKind, SettlementNeed>> = {
  field: 'food', workshop: 'manufacturing', market: 'trade', shrine: 'religion', 'civic-building': 'government',
  warehouse: 'transport', 'industrial-site': 'manufacturing', 'knowledge-institution': 'knowledge', 'patrol-route': 'security',
};

/** Both navigation identity and destination coordinates refer to this same persistent site. */
export function structureDestination(settlement: Settlement, kind: DestinationKind): StructurePlot | undefined {
  if (kind === 'construction-site') return settlement.structurePlots?.find(p => p.id === settlement.development?.project?.plotId && (p.floodDepth ?? 0) <= 0.06);
  const need = DESTINATION_NEED[kind];
  if (!need) return undefined;
  return settlement.structurePlots?.find(p => p.development?.status === 'active' && !p.accessRestricted && p.condition >= 0.65 && (p.development.services[need] ?? 0) > 0);
}
