import type { Settlement, SimulationState, Vec2 } from '../types';

export type EnergyCarrier = 'thermal' | 'mechanical' | 'electric';
export type GeneratorKind = 'animal' | 'waterwheel' | 'windmill' | 'steam' | 'generator' | 'coal' | 'hydro' | 'wind' | 'solar' | 'gas' | 'nuclear';
export type PowerPriority = 'critical' | 'essential' | 'productive' | 'discretionary';
export const POWER_PRIORITIES: readonly PowerPriority[] = ['critical', 'essential', 'productive', 'discretionary'] as const;

export interface EnergyPlant { id: string; plotId: string; kind: GeneratorKind; progress: number; condition: number; output: number; fuelUsed: number; status: 'construction' | 'running' | 'idle' | 'failed'; }
export interface PowerLine { id: string; from: string; to: string; points: Vec2[]; capacity: number; loss: number; progress: number; condition: number; flow: number; }
export interface EnergyLedger { demand: number; generated: number; supplied: number; imported: number; exported: number; losses: number; curtailed: number; charged: number; discharged: number; }
export interface PowerServiceLedger { demand: Record<PowerPriority, number>; supplied: Record<PowerPriority, number>; }
export interface SettlementEnergy {
  plants: EnergyPlant[];
  materialDemand: Record<string, number>;
  ledgers: Record<EnergyCarrier, EnergyLedger>;
  service: PowerServiceLedger;
  storage: number;
  storageCapacity: number;
  shortageMonths: number;
  reliability: number;
  lit: boolean;
}
export interface EnergyState { month: number; lines: PowerLine[]; milestones: string[]; }

declare module '../types' {
  interface Settlement { energy?: SettlementEnergy }
  interface SimulationState { energy?: EnergyState }
}

export const ledger = (): EnergyLedger => ({ demand: 0, generated: 0, supplied: 0, imported: 0, exported: 0, losses: 0, curtailed: 0, charged: 0, discharged: 0 });
export const powerService = (): PowerServiceLedger => ({
  demand: { critical: 0, essential: 0, productive: 0, discretionary: 0 },
  supplied: { critical: 0, essential: 0, productive: 0, discretionary: 0 },
});

export function energyAt(s: Settlement): SettlementEnergy {
  const energy = s.energy ??= {
    plants: [],
    materialDemand: {},
    ledgers: { thermal: ledger(), mechanical: ledger(), electric: ledger() },
    service: powerService(),
    storage: 0,
    storageCapacity: 0,
    shortageMonths: 0,
    reliability: 1,
    lit: false,
  };
  // Archive compatibility: the first energy pass predates priority-class service telemetry.
  energy.service ??= powerService();
  return energy;
}

export function energyWorld(state: SimulationState): EnergyState { return state.energy ??= { month: -1, lines: [], milestones: [] }; }

export function powerServiceCoverage(s: Settlement, priority: PowerPriority): number {
  if (!s.energy) return 1;
  const service = s.energy.service ?? powerService();
  const demand = service.demand[priority];
  return demand > 0 ? Math.min(1, service.supplied[priority] / demand) : 1;
}

/**
 * Handcraft remains possible during a blackout. Only the mechanized share of production is
 * throttled, using power that actually reached productive loads rather than settlement-wide
 * generation or an abstract infrastructure score.
 */
export function poweredProductivity(s: Settlement): number {
  if (!s.energy) return 1;
  const energy = s.energy;
  const mechanical = energy.ledgers.mechanical;
  const productiveElectricDemand = energy.service?.demand.productive ?? energy.ledgers.electric.demand;
  const productiveElectricSupply = energy.service?.supplied.productive ?? energy.ledgers.electric.supplied;
  // Mechanical shaft power and electricity are alternative ways to satisfy the same productive
  // energy service as civilizations electrify; do not double-charge a factory for both carriers.
  const demand = Math.max(mechanical.demand, productiveElectricDemand);
  if (demand <= 0) return 1;
  const coverage = Math.min(1, (mechanical.supplied + productiveElectricSupply) / demand);
  const mechanizedShare = Math.min(0.88,
    s.infrastructure.workshops * 0.18
    + s.infrastructure.factories * 0.62
    + s.industry.intensity * 0.38);
  return 1 - mechanizedShare * (1 - coverage);
}
