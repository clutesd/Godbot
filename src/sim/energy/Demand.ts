import type { Settlement, StructurePlot } from '../types';
import type { SettlementNeed } from '../development/types';
import { energyAt, powerService, type PowerPriority } from './types';
import '../processing/types';

export interface ElectricConsumer {
  id: string;
  settlement: Settlement;
  node: string;
  priority: PowerPriority;
  demand: number;
  supplied: number;
  /** Set when the load is a processing facility; dispatch reports delivered power back to it. */
  facilityId?: string;
}

const NEED_PRIORITY: Record<SettlementNeed, PowerPriority> = {
  food: 'productive',
  housing: 'essential',
  trade: 'productive',
  government: 'essential',
  security: 'essential',
  religion: 'discretionary',
  knowledge: 'essential',
  healthcare: 'critical',
  manufacturing: 'productive',
  transport: 'productive',
  energy: 'productive',
  water: 'critical',
  memory: 'discretionary',
};

const NEED_LOAD: Record<SettlementNeed, number> = {
  food: 0.4,
  housing: 0.12,
  trade: 0.8,
  government: 0.45,
  security: 0.4,
  religion: 0.25,
  knowledge: 0.65,
  healthcare: 1.1,
  manufacturing: 1.8,
  transport: 1.2,
  energy: 0.35,
  water: 1.4,
  memory: 0.1,
};

export function powerPriorityForNeed(need: SettlementNeed): PowerPriority { return NEED_PRIORITY[need]; }

function plotLoad(plot: StructurePlot): { priority: PowerPriority; demand: number } | undefined {
  const development = plot.development;
  if (!development || development.status !== 'active' || plot.accessRestricted) return undefined;
  const demand = NEED_LOAD[development.need] * Math.max(0.25, development.level) * Math.max(0.25, plot.condition);
  if (demand <= 0) return undefined;
  return { priority: NEED_PRIORITY[development.need], demand };
}

/**
 * Electricity demand is attached to real occupied structures where possible, with remaining
 * settlement-scale loads terminating at the settlement distribution node.
 */
export function electricConsumers(settlement: Settlement, population: number): ElectricConsumer[] {
  const consumers: ElectricConsumer[] = [];
  for (const plot of settlement.structurePlots ?? []) {
    // A facility's structure draws exactly what its machinery draws, below; never a generic workshop load as well.
    if (plot.development?.facilityId) continue;
    const load = plotLoad(plot);
    if (!load) continue;
    consumers.push({
      id: `${settlement.id}:plot:${plot.id}`,
      settlement,
      node: plot.id,
      priority: load.priority,
      demand: load.demand,
      supplied: 0,
    });
  }

  for (const facility of settlement.processing?.facilities ?? []) {
    if (facility.progress < 1 || facility.power.carrier !== 'electric' || facility.power.demand <= 0) continue;
    const plot = settlement.structurePlots?.find(p => p.id === facility.plotId);
    if (!plot || plot.development?.status !== 'active' || plot.accessRestricted) continue;
    consumers.push({
      id: `${settlement.id}:facility:${facility.id}`,
      settlement,
      node: plot.id,
      priority: 'productive',
      demand: facility.power.demand,
      supplied: 0,
      facilityId: facility.id,
    });
  }

  const bases: Array<[PowerPriority, number]> = [
    ['essential', Math.max(0, population) * 0.018 + settlement.infrastructure.archives * 1.5],
    ['productive', settlement.infrastructure.factories * 30
      + settlement.infrastructure.rail * 8
      + settlement.infrastructure.workshops * 3
      + settlement.industry.intensity * 6],
    ['discretionary', Math.max(0, population) * Math.max(0, settlement.urbanization) * 0.007],
  ];
  for (const [priority, demand] of bases) {
    if (demand <= 0) continue;
    consumers.push({
      id: `${settlement.id}:base:${priority}`,
      settlement,
      node: settlement.id,
      priority,
      demand,
      supplied: 0,
    });
  }
  return consumers;
}

/** Reset one month's authoritative service ledger from the exact consumers dispatch will serve. */
export function prepareElectricDemand(settlement: Settlement, population: number): ElectricConsumer[] {
  const energy = energyAt(settlement);
  energy.service = powerService();
  const consumers = electricConsumers(settlement, population);
  for (const consumer of consumers) energy.service.demand[consumer.priority] += consumer.demand;
  energy.ledgers.electric.demand = consumers.reduce((sum, consumer) => sum + consumer.demand, 0);
  return consumers;
}
