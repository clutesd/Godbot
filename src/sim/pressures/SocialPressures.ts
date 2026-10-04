import { emitEvent } from '../History';
import type { Settlement, SimulationState } from '../types';
import { observePressure, positive, unit } from './Pressure';
import { survivalState } from './Survival';
import type { PressureObservation } from './types';

/** Evidence adapter for existing resource, migration, polity and war decisions. Owns no controller,
 * disaster schedule, resource budget, or competing response selection. */
export function observeSocialPressures(state: SimulationState): void {
  const populations = new Map<string, number>();
  if (state.advanced.scale === 'modern-statistical') {
    for (const city of state.advanced.cities) populations.set(city.settlementId, city.population);
  } else for (const p of state.people) if (p.alive) populations.set(p.homeId, (populations.get(p.homeId) ?? 0) + 1);
  const migrating = new Map<string, number>();
  for (const p of state.people) if (p.alive && p.activity === 'migrate') migrating.set(p.homeId, (migrating.get(p.homeId) ?? 0) + 1);
  const wars = new Map<string, number>();
  for (const war of state.wars) if (war.active) for (const id of [war.attacker, war.defender]) wars.set(id, (wars.get(id) ?? 0) + 1);
  const polities = new Map(state.polities.map(p => [p.id, p]));
  for (const s of state.settlements) {
    if (!s.alive) continue;
    const population = populations.get(s.id) ?? 0, survival = survivalState(s);
    let demand = 0, missing = 0;
    for (const [id, quantity] of Object.entries(s.materialEconomy?.demand ?? {})) {
      demand += positive(quantity); missing += Math.max(0, positive(quantity) - positive(s.localMaterials[id] ?? 0));
    }
    const scarcity = demand > 0 ? unit(missing / demand) : 0;
    const hardship = unit(survival.deprivation / 8 + survival.exposureDose / 12 + (survival.disease?.prevalence ?? 0));
    const polity = polities.get(s.polityId);
    const politics = polity ? unit(1 - (polity.legitimacy + polity.stability) / 2) : 0;
    const unrest = unit(hardship * 0.6 + scarcity * 0.1 + s.conflictPressure * 0.25 + politics * 0.15);
    const observe = (kind: 'scarcity' | 'migration' | 'politics' | 'unrest' | 'war', intensity: number,
      causes: string[], responses: string[], consequences: string[], evidence: Record<string, number>) => {
      const prior = survival.observations[kind];
      const input: PressureObservation = observePressure(prior, { kind, intensity, confidence: 0.7,
        affectedPopulation: population, location: s.position, observedMonth: state.month, causes, responses, consequences, evidence });
      survival.observations[kind] = input;
      if (input.perceived >= 0.5 && !input.eventId) input.eventId = emitEvent(state, {
        type: 'pressure-detected', location: { ...s.position }, locationId: s.id, actors: [s.id], causes,
        context: { pressure: kind, perceived: input.perceived, ...evidence }, affectedPopulation: population,
        magnitude: input.intensity, significance: 0.4, tags: ['causal', kind],
        summary: `${s.name} faces sustained ${kind} pressure.`, outcome: `Existing local decisions face ${kind} pressure.`,
      }).id;
    };
    observe('scarcity', scarcity, ['unmet-material-demand'], ['substitution', 'extraction', 'trade', 'defer-construction'],
      ['stalled-production', 'territorial-competition'], { demand, missing });
    observe('war', unit(wars.get(s.id) ?? 0), ['active-campaign'], ['mobilization', 'provisioning', 'retreat', 'negotiation'],
      ['casualties', 'labour-reservation', 'displacement', 'infectious-contact'], { campaigns: wars.get(s.id) ?? 0, conflict: s.conflictPressure });
    observe('migration', unit(hardship * 0.6 + s.conflictPressure * 0.4 + (survival.establishment?.migration ?? 0) * 0.3),
      pressureCauses(s), ['household-migration', 'stay', 'seek-refuge'], ['lost-workers', 'knowledge-transfer', 'infectious-contact'],
      { hardship, migrating: migrating.get(s.id) ?? 0 });
    observe('politics', politics, ['legitimacy', 'institutional-stability', ...pressureCauses(s)], ['succession', 'political-transition', 'secession'],
      ['fragmentation', 'integration', 'conflict'], { legitimacy: polity?.legitimacy ?? 0, stability: polity?.stability ?? 0 });
    observe('unrest', unrest, pressureCauses(s), ['public-provision', 'care', 'migration', 'political-transition'],
      ['legitimacy-loss', 'instability'], { hardship, scarcity, conflict: s.conflictPressure, politics });
  }
}

export function pressureCauses(s: Settlement): string[] {
  return [...new Set(Object.values(s.survival?.observations ?? {}).filter(p => p && p.kind !== 'politics' && p.kind !== 'unrest' && p.kind !== 'migration' && p.intensity >= 0.3)
    .flatMap(p => p!.eventId ? [p!.eventId!] : p!.causes)), ...(s.survival?.disease?.episodeEventId ? [s.survival.disease.episodeEventId] : [])];
}
