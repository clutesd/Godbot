import type { Person, SimulationState } from '../types';
import { emitEvent } from '../History';
import { isStatistical } from '../Population';
import { advancePersonalMemory } from './PersonalMemorySystem';
import { invalidateLabour } from './HumanCapital';

type DeathObserver = (people: readonly Person[]) => void;
const observers = new WeakMap<SimulationState, DeathObserver>();
export function observeDeaths(state: SimulationState, observer: DeathObserver): void { observers.set(state, observer); }

/** All explicit deaths, including standalone advanced-system shocks, pass through here. */
export function killPeople(state: SimulationState, victims: readonly Person[], cause: string): number {
  const dead = [...new Set(victims)].filter(p => p.alive);
  if (!dead.length) return 0;
  invalidateLabour(state);
  const byId = new Map(state.people.map(p => [p.id, p]));
  const settlements = new Map(state.settlements.map(s => [s.id, s]));
  for (const person of dead) {
    if (!person.alive) continue;
    person.alive = false;
    person.diedMonth = state.month;
    const partner = person.partnerId ? byId.get(person.partnerId) : undefined;
    if (partner?.partnerId === person.id) partner.partnerId = undefined;
    person.partnerId = undefined;
    const settlement = settlements.get(person.homeId);
    const expert = [...(person.expertise ?? [])].sort((a, b) => b.competence - a.competence)[0];
    emitEvent(state, {
      type: 'death', location: settlement?.position ?? person.position, locationId: settlement?.id, actors: [person.id], causes: [cause],
      context: { name: person.name, age: Math.floor(person.ageMonths / 12), bornMonth: person.bornMonth, occupation: person.occupation,
        cultureId: person.cultureId, homeId: person.homeId, prestige: person.prestige,
        expertiseState: JSON.stringify(person.expertise ?? []), careerState: JSON.stringify(person.career ?? null),
        familyIds: [...person.parents, ...person.children, ...(partner ? [partner.id] : [])].join(','),
        expertise: expert?.domain ?? '', competence: expert?.competence ?? 0, teacherId: expert?.teacherId ?? '', documentary: isStatistical(state) },
      outcome: `${person.name}'s life ended.`, affectedPopulation: isStatistical(state) ? 0 : 1,
      magnitude: 0.03, significance: (expert?.competence ?? 0) >= 0.7 ? 0.35 : 0.025,
      tags: ['life', cause, ...((expert?.competence ?? 0) >= 0.7 ? ['expertise-loss'] : [])],
      summary: `${person.name} dies at ${Math.floor(person.ageMonths / 12)} in ${settlement?.name ?? 'the wilderness'}.`,
    });
    if (isStatistical(state)) state.stats.documentaryDeaths = (state.stats.documentaryDeaths ?? 0) + 1;
    else state.stats.deaths++;
  }
  // Capture family/relationship consequences before deleting graph edges or retiring biographies.
  advancePersonalMemory(state);
  const ids = new Set(dead.map(p => p.id));
  state.socialRelationships = state.socialRelationships?.filter(r => !ids.has(r.a) && !ids.has(r.b));
  for (const household of state.households ?? []) {
    household.memberIds = household.memberIds.filter(id => !ids.has(id));
    if (!household.memberIds.length) household.active = false;
  }
  const observer = observers.get(state);
  if (observer) observer(dead);
  else for (const person of dead) {
    if (person.historical && person.historical.status !== 'ordinary') {
      state.notableFigures ??= [];
      state.notableFigures = state.notableFigures.filter(p => p.id !== person.id);
      state.notableFigures.push({ id: person.id, name: person.name, ...person.historical, status: person.historical.status,
        bornMonth: person.bornMonth, diedMonth: state.month, homeId: person.homeId, cultureId: person.cultureId, role: person.role });
      state.notableFigures.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      state.notableFigures = state.notableFigures.slice(0, 256);
    }
  }
  return ids.size;
}
