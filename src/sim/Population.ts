import type { Person, SimulationState } from './types';

export const isStatistical = (state: SimulationState): boolean => state.advanced?.scale === 'modern-statistical';
export function explicitPopulation(state: SimulationState, settlementId?: string): number {
  return state.people.reduce((n, p) => n + Number(p.alive && (settlementId === undefined || p.homeId === settlementId)), 0);
}
/** Citizens, never display agents. Urban-industrial still uses explicit demography. */
export function representedPopulation(state: SimulationState): number {
  return isStatistical(state) ? Math.max(0, Math.round(state.advanced.representedPopulation)) : explicitPopulation(state);
}
export function settlementRepresentedPopulation(state: SimulationState, id: string, residents?: readonly Person[]): number {
  if (isStatistical(state)) return Math.max(0, state.advanced.cities.find(c => c.settlementId === id)?.population ?? 0);
  // Callers supplying residents own an indexed living-resident bucket.
  return residents ? residents.length : explicitPopulation(state, id);
}
