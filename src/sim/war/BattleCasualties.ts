import type { BattleImpact, Settlement, SimulationState, Vec2 } from '../types';
import { isStatistical, representedPopulation, settlementRepresentedPopulation } from '../Population';
import { killPeople } from '../people/PersonLifecycle';
import { rememberMortality } from '../development/Remembrance';
import { stableHash } from '../prng';
import type { MilitaryCapabilityProfile } from './MilitaryCapability';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const nuclearDamageRadius = (hydrogen: boolean): number => hydrogen ? 11 : 7;

/** Authored game-space exposure, shared with destruction and presentation. No physical yield model. */
export function nuclearExposure(position: Vec2, sites: readonly Vec2[], hydrogen: boolean): number {
  let survival = 1;
  for (const site of sites) {
    const fraction = Math.hypot(position.x - site.x, position.z - site.z) / nuclearDamageRadius(hydrogen);
    const exposure = fraction <= 0.35 ? 1 : fraction <= 0.65 ? 1 - (fraction - 0.35) / 0.3 * 0.15 : clamp(0.85 * (1 - fraction) / 0.35);
    survival *= 1 - exposure;
  }
  return 1 - survival;
}

/** Firepower, delivered supply and protection determine the fraction of exposed combatants lost. */
export function combatLossFraction(source: MilitaryCapabilityProfile | undefined, target: MilitaryCapabilityProfile | undefined, supply: number): number {
  const kit = source?.equipment ?? [];
  const pressure = kit.includes('guided-missiles') ? 0.3 : kit.includes('drone-swarms') ? 0.24
    : kit.some(k => ['artillery', 'aircraft'].includes(k)) ? 0.21 : kit.includes('cannon') ? 0.15
      : kit.includes('automatic-weapons') ? 0.13 : kit.includes('rifles') ? 0.1
        : kit.includes('gunpowder-weapons') ? 0.075 : kit.includes('siege-engines') ? 0.06
          : kit.includes('bows') ? 0.05 : 0.035;
  return clamp(pressure * clamp(supply) * (1 - clamp(target?.protection ?? 0) * 0.35));
}

function structureExposure(position: Vec2, zones: readonly { hit: BattleImpact; core: number; radius: number }[]): number {
  let survival = 1;
  for (const { hit, core, radius } of zones) {
    const distance = Math.hypot(position.x - hit.position.x, position.z - hit.position.z);
    const exposure = distance <= core ? 1 : clamp((radius - distance) / Math.max(0.1, radius - core));
    survival *= 1 - exposure * (hit.destroyed ? 0.98 : clamp(hit.damage) * 0.8);
  }
  return 1 - survival;
}

/** Integrate a city's documentary footprint; named people remain a sample in statistical mode. */
function cityExposure(settlement: Settlement, exposure: (p: Vec2) => number): number {
  const plots = (settlement.structurePlots ?? []).filter(p => !p.development || p.development.status === 'active' || p.destruction);
  if (plots.length) {
    let weight = 0, sum = 0;
    for (const plot of plots) {
      const area = Math.max(0.1, plot.width * plot.depth) * Math.max(1, plot.development?.level ?? 1);
      // Fixed quadrature keeps aggregate casualties independent of the documentary sample size.
      for (const dx of [-0.35, 0, 0.35]) for (const dz of [-0.35, 0, 0.35]) {
        sum += area * exposure({ x: plot.worldX + dx * plot.width, z: plot.worldZ + dz * plot.depth }); weight += area;
      }
    }
    return clamp(sum / weight);
  }
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const radius = Math.sqrt((i + 0.5) / 64) * 3;
    sum += exposure({ x: settlement.position.x + Math.cos(i * 2.399) * radius, z: settlement.position.z + Math.sin(i * 2.399) * radius });
  }
  return sum / 64;
}

export interface DamageCasualties {
  affectedPopulation: number;
  losses: Record<string, number>;
}

function applyDamageCasualties(state: SimulationState, eventId: string, exposure: (p: Vec2) => number, cause: string): DamageCasualties {
  const previous = state.damageCasualtyReceipts?.find(receipt => receipt.id === eventId);
  if (previous) return { affectedPopulation: Object.values(previous.losses).reduce((n, loss) => n + loss, 0), losses: previous.losses };
  const losses: Record<string, number> = {};
  if (isStatistical(state)) {
    for (const city of state.advanced.cities) {
      const settlement = state.settlements.find(s => s.id === city.settlementId);
      if (!settlement) continue;
      const loss = Math.min(Math.floor(city.population), Math.floor(state.advanced.representedPopulation), Math.round(city.population * cityExposure(settlement, exposure)));
      city.population -= loss; state.advanced.representedPopulation -= loss;
      state.stats.deaths += loss; losses[settlement.id] = loss;
      if (loss) rememberMortality(state, settlement, loss);
    }
  }
  const victims = state.people.filter(person => person.alive && stableHash(`${eventId}:${person.id}:exposure`) < exposure(person.position));
  if (!isStatistical(state)) for (const person of victims) losses[person.homeId] = (losses[person.homeId] ?? 0) + 1;
  killPeople(state, victims, cause);
  if (!isStatistical(state)) state.advanced.representedPopulation = representedPopulation(state);
  (state.damageCasualtyReceipts ??= []).push({ id: eventId, month: state.month, losses });
  state.damageCasualtyReceipts = state.damageCasualtyReceipts.slice(-256);
  return { affectedPopulation: Object.values(losses).reduce((n, loss) => n + loss, 0), losses };
}

export function applyNuclearCasualties(state: SimulationState, eventId: string, sites: readonly Vec2[], hydrogen: boolean): DamageCasualties {
  const resolved = state.damageCasualtyReceipts?.some(receipt => receipt.id === eventId);
  const populations = new Map(state.settlements.map(s => [s.id, settlementRepresentedPopulation(state, s.id)]));
  const result = applyDamageCasualties(state, eventId, p => nuclearExposure(p, sites, hydrogen), 'civilization-shock');
  if (!resolved) for (const war of state.wars.filter(w => w.active)) {
    const lossA = clamp((result.losses[war.attacker] ?? 0) / Math.max(1, populations.get(war.attacker) ?? 0));
    const lossB = clamp((result.losses[war.defender] ?? 0) / Math.max(1, populations.get(war.defender) ?? 0));
    war.casualtiesA += result.losses[war.attacker] ?? 0; war.casualtiesB += result.losses[war.defender] ?? 0;
    war.strengthA *= 1 - lossA; war.strengthB *= 1 - lossB;
    war.moraleA *= 1 - lossA; war.moraleB *= 1 - lossB;
  }
  return result;
}

export function applyStructureCasualties(state: SimulationState, eventId: string, impacts: readonly BattleImpact[]): DamageCasualties {
  const plots = new Map(state.settlements.flatMap(s => s.structurePlots ?? []).map(p => [p.id, p]));
  const zones = impacts.filter(hit => hit.targetKind === 'structure').flatMap(hit => {
    const plot = plots.get(hit.targetId);
    if (!plot) return [];
    const core = Math.max(plot.width, plot.depth) * 0.5;
    return [{ hit, core, radius: core + (hit.weapon === 'missile' ? 1.6 : hit.weapon === 'shell' ? 1.1 : hit.weapon === 'drone' ? 0.7 : 0.35) }];
  });
  return applyDamageCasualties(state, eventId, p => structureExposure(p, zones), 'war');
}
