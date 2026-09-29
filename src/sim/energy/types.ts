import type { Settlement, SimulationState, Vec2 } from '../types';
export type EnergyCarrier = 'thermal' | 'mechanical' | 'electric';
export type GeneratorKind = 'animal' | 'waterwheel' | 'windmill' | 'steam' | 'generator' | 'coal' | 'hydro' | 'wind' | 'solar' | 'gas' | 'nuclear';
export interface EnergyPlant { id: string; plotId: string; kind: GeneratorKind; progress: number; condition: number; output: number; fuelUsed: number; status: 'construction' | 'running' | 'idle' | 'failed'; }
export interface PowerLine { id: string; from: string; to: string; points: Vec2[]; capacity: number; loss: number; progress: number; condition: number; flow: number; }
export interface EnergyLedger { demand: number; generated: number; supplied: number; imported: number; exported: number; losses: number; curtailed: number; charged: number; discharged: number; }
export interface SettlementEnergy { plants: EnergyPlant[]; materialDemand: Record<string, number>; ledgers: Record<EnergyCarrier, EnergyLedger>; storage: number; storageCapacity: number; shortageMonths: number; reliability: number; lit: boolean; }
export interface EnergyState { month: number; lines: PowerLine[]; milestones: string[]; }
declare module '../types' { interface Settlement { energy?: SettlementEnergy } interface SimulationState { energy?: EnergyState } }
export const ledger = (): EnergyLedger => ({ demand: 0, generated: 0, supplied: 0, imported: 0, exported: 0, losses: 0, curtailed: 0, charged: 0, discharged: 0 });
export function energyAt(s: Settlement): SettlementEnergy { return s.energy ??= { plants: [], materialDemand: {}, ledgers: { thermal: ledger(), mechanical: ledger(), electric: ledger() }, storage: 0, storageCapacity: 0, shortageMonths: 0, reliability: 1, lit: false }; }
export function energyWorld(state: SimulationState): EnergyState { return state.energy ??= { month: -1, lines: [], milestones: [] }; }
export function poweredProductivity(s: Settlement): number {
  if (!s.energy) return 1;
  const { mechanical: m, electric: e } = s.energy.ledgers;
  const total = m.demand + e.demand;
  // Handcraft remains possible; only the mechanized share depends on power.
  return total > 0 ? 1 - Math.min(0.85, s.infrastructure.factories + s.industry.intensity * 0.5) * (1 - Math.min(1, (m.supplied + e.supplied) / total)) : 1;
}
