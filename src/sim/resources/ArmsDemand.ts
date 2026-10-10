import type { Settlement, SimulationState } from '../types';
import { materialEconomy } from './Inventory';

declare module '../types' {
  interface MaterialEconomy {
    /** Serialized service state; old saves retain their existing usable arms without a grant. */
    woodenArmsService?: { active: number; desired: number; replenishing: boolean; combatLoss: number; replacementBacklog?: number };
  }
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Usable equipment equivalents, not workshop capacity or a count of physical spears. */
export function armsDemand(state: SimulationState, s: Settlement, people: SimulationState['people'], population: number) {
  const eligible = state.advanced.scale === 'modern-statistical' ? population * state.advanced.cohorts.workingAge
    : people.filter(p => p.alive && p.ageMonths > 192 && p.ageMonths < 720).length;
  const cultureId = Object.entries(s.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0];
  const culture = state.cultures.find(c => c.id === cultureId);
  const muster = eligible * (0.11 + clamp(s.politicalPower.military) * 0.08 + (culture?.dimensions.militarism ?? 0.5) * 0.06);
  const atWar = state.wars.some(w => w.active && (w.attacker === s.id || w.defender === s.id));
  const threat = Math.max(0, ...state.relations.filter(r => r.contact && !r.allied && (r.a === s.id || r.b === s.id))
    .map(r => clamp((r.hostility - 0.5) / 0.5)));
  // A quarter of potential forces train/guard in peace; credible hostility mobilizes more.
  const active = muster * (atWar ? 1 : 0.25 + 0.75 * threat);
  const desired = active * 1.2; // 20% reserve, stored rather than continually worn as issued equipment.
  const metal = materialEconomy(s).arms;
  return { eligible, muster, active, desired, woodenDesired: Math.max(0, desired - metal), atWar, threat };
}

export interface ArmsDiagnostic {
  settlementId: string; month: number; population: number; desired: number; policyDesired: number;
  stockBefore: number; stockAfter: number; metal: number; wear: number; combatLoss: number; arbitraryLoss: number;
  replacementDemand: number; expansionDemand: number; attempted: number; achieved: number; labour: number; timber: number;
  adequateBefore: boolean; criticalTimber: boolean; atWar: boolean;
}
let observer: ((record: ArmsDiagnostic) => void) | undefined;
export function observeArmsDemand(callback: typeof observer): void { observer = callback; }
export function recordArmsDemand(record: ArmsDiagnostic): void { observer?.(record); }

/** Casualties lose only the wooden share actually issued; never destroy unissued reserves. */
export function loseCombatArms(s: Settlement, casualties: number): number {
  const e = materialEconomy(s);
  const service = e.woodenArmsService;
  if (!service || casualties <= 0) return 0;
  const issued = Math.min(e.timberArms, Math.max(0, service.active - e.arms));
  const loss = Math.min(issued, casualties * issued / Math.max(1, service.active));
  e.timberArms -= loss;
  service.combatLoss += loss;
  return loss;
}

/** Availability of finished equipment, leaving improvised fighting possible without stored arms. */
export function armsReadiness(s: Settlement): number {
  const e = materialEconomy(s);
  const active = e.woodenArmsService?.active;
  return active === undefined || active <= 0 ? 1 : clamp((e.arms + e.timberArms) / active);
}
