import type { DevelopmentProject } from '../development/types';
import type { Person } from '../types';
import { seedHash } from '../prng';
import { workAvailability } from './HumanCapital';

/** Bounded representatives of the occupation buckets which paid for construction, never extra labour. */
export function paidConstructionWorkerIds(project: DevelopmentProject, residents: readonly Person[], settlementId: string,
  budgets: Partial<Record<Person['occupation'], number>>): string[] {
  const previous = new Set(project.workerIds);
  type Candidate = { person: Person; rank: number; retained: boolean };
  const byOccupation = new Map<Person['occupation'], Candidate[]>();
  const compare = (a: Candidate, b: Candidate) => Number(b.retained) - Number(a.retained)
    || a.rank - b.rank || a.person.id.localeCompare(b.person.id);
  for (const person of residents) {
    const limit = Math.min(3, Math.ceil(budgets[person.occupation] ?? 0));
    if (limit <= 0 || person.homeId !== settlementId || workAvailability(person) <= 0.25
      || ['soldier', 'guard'].includes(person.role ?? '')) continue;
    const candidates = byOccupation.get(person.occupation) ?? [];
    candidates.push({ person, rank: seedHash(`${project.plotId}:${person.id}:paid-construction`), retained: previous.has(person.id) });
    candidates.sort(compare); candidates.length = Math.min(limit, candidates.length);
    byOccupation.set(person.occupation, candidates);
  }
  return [...byOccupation.values()].flat().sort(compare).slice(0, 3).map(c => c.person.id);
}
