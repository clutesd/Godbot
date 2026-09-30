import { generatorDefinition } from '../energy/Generation';
import type { Settlement, SimulationState } from '../types';
import type { FacilityPowerSpec, ProcessingFacility } from './types';
import './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** A grid service node stands at the facility's plot and is commissioned. */
export function gridServes(state: SimulationState, f: Pick<ProcessingFacility, 'plotId'>): boolean {
  return !!state.energy?.nodes?.some(node => node.id === f.plotId && !node.retired && node.progress >= 1 && node.condition > 0.25);
}

/** Electricity once the grid reaches the plot; otherwise shaft power. Explicit modes never switch. */
export function facilityCarrier(state: SimulationState, f: ProcessingFacility, power: FacilityPowerSpec): ProcessingFacility['power']['carrier'] {
  if (power.mode === 'none') return 'none';
  if (power.mode === 'either') return gridServes(state, f) ? 'electric' : 'mechanical';
  return power.mode;
}

/** A generator or wheel of the right kind is standing and not failed. */
export function powerSourceAvailable(s: Settlement, power: FacilityPowerSpec): boolean {
  if (power.mode === 'none') return true;
  const plants = s.energy?.plants ?? [];
  const built = (carrier: 'mechanical' | 'electric') => plants.some(p => p.progress >= 1 && p.status !== 'failed' && generatorDefinition(p.kind).carrier === carrier);
  if (power.mode === 'mechanical') return built('mechanical');
  if (power.mode === 'electric') return built('electric') || (s.energy?.ledgers.electric.supplied ?? 0) > 0;
  return built('mechanical') || built('electric') || (s.energy?.ledgers.electric.supplied ?? 0) > 0;
}

/** Normalized energy per month the facility asks the dispatcher for next month. */
export function facilityPowerRequest(power: FacilityPowerSpec, load: number): number {
  return power.mode === 'none' ? 0 : power.demand * Math.max(0.1, clamp01(load));
}

/** Fraction of nominal throughput the delivered power supports; hand work covers the fallback share. */
export function powerFactor(power: FacilityPowerSpec, f: ProcessingFacility): number {
  if (power.mode === 'none' || f.power.carrier === 'none') return 1;
  const supported = power.demand > 0 ? clamp01(f.power.supplied / power.demand) : 1;
  return power.fallback + (1 - power.fallback) * supported;
}

/** Mechanical shaft demand the settlement's shaft plants must cover. */
export function facilityMechanicalDemand(s: Settlement): number {
  return (s.processing?.facilities ?? []).reduce((sum, f) => f.power.carrier === 'mechanical' && f.progress >= 1 ? sum + f.power.demand : sum, 0);
}

/** Shaft coverage is shared by every mechanical consumer in the settlement, as the ledger has one pool. */
export function applyMechanicalCoverage(s: Settlement, supplied: number, demand: number): void {
  const coverage = demand > 0 ? clamp01(supplied / demand) : 1;
  for (const f of s.processing?.facilities ?? []) {
    if (f.power.carrier !== 'mechanical') continue;
    f.power.supplied = f.power.demand * coverage;
    f.power.coverage = coverage;
  }
}
