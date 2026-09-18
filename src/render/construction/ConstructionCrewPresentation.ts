import type { Person, Settlement } from '../../sim/types';

export type ConstructionCrewRole = 'hauler' | 'assembler' | 'site-worker';

export interface ConstructionCrewAssignment {
  role: ConstructionCrewRole;
  /** Stable rank inside the project presentation crew; useful for presentation diagnostics. */
  rank: number;
}

export type ConstructionCrewAuthority = ReadonlyMap<string, ReadonlyMap<string, ConstructionCrewAssignment>>;

export const CONSTRUCTION_VISIBLE_CREW_PER_PROJECT = 3;

/**
 * Protect a tiny documentary crew for each funded project from the general population budget.
 * On-site workers win over commuters; within each group we try to show distinct crew roles first.
 * This never changes who the simulation assigned to construction.
 */
export function constructionVisibleCrewIds(
  people: readonly Person[],
  settlements: readonly Settlement[],
  perProject = CONSTRUCTION_VISIBLE_CREW_PER_PROJECT,
  authority?: ConstructionCrewAuthority,
): Set<string> {
  const visible = new Set<string>();
  const limit = Math.max(0, Math.floor(perProject));
  if (limit === 0) return visible;

  for (const settlement of settlements) {
    const project = settlement.alive ? settlement.development?.project : undefined;
    if (!project || project.progress >= 1) continue;
    const candidates = people.filter(person => person.alive
      && person.homeId === settlement.id
      && person.activity === 'construct'
      && person.navigation?.destinationKind === 'construction-site'
      && (person.navigation.destinationId === project.plotId
        || person.navigation.destinationId === `${settlement.id}:construction-site`));
    if (candidates.length === 0) continue;

    // Runtime visibility consumes the full-workforce authority prepared by PhysicalWorkScene.
    // The deterministic fallback keeps this helper independently useful in tests/tools.
    const assignments = authority?.get(settlement.id)
      ?? assignConstructionCrewRoles(project.plotId, candidates.map(person => person.id));
    const roleOrder: readonly ConstructionCrewRole[] = ['hauler', 'assembler', 'site-worker'];
    const rank = (person: Person): number => assignments.get(person.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const byRank = (a: Person, b: Person): number => rank(a) - rank(b) || a.id.localeCompare(b.id);
    const onSite = candidates.filter(person => !person.navigation?.traveling).sort(byRank);
    const commuters = candidates.filter(person => person.navigation?.traveling).sort(byRank);
    const selected = new Set<string>();

    const addDistinctRoles = (pool: readonly Person[]): void => {
      for (const role of roleOrder) {
        if (selected.size >= limit) return;
        const candidate = pool.find(person => !selected.has(person.id) && assignments.get(person.id)?.role === role);
        if (candidate) selected.add(candidate.id);
      }
    };
    const fill = (pool: readonly Person[]): void => {
      for (const person of pool) {
        if (selected.size >= limit) return;
        selected.add(person.id);
      }
    };

    // Keep the site visibly inhabited first, and prefer one recognizable worker from each core
    // role before duplicates. Commuters are protected only when fewer than three people are on site.
    addDistinctRoles(onSite);
    fill(onSite);
    addDistinctRoles(commuters);
    fill(commuters);
    for (const id of selected) visible.add(id);
  }
  return visible;
}

/**
 * Deterministic presentation-only crew specialization.
 *
 * The simulation still owns who is actually assigned to construction and how much labour exists.
 * This function only makes a visible crew legible: one worker remains a hauler when alone; a
 * two-person crew gains an assembler; crews of three or more repeat hauler/assembler/site-worker.
 */
export function assignConstructionCrewRoles(
  projectKey: string,
  workerIds: readonly string[],
): Map<string, ConstructionCrewAssignment> {
  return reconcileConstructionCrewRoles(projectKey, workerIds);
}

/**
 * Keep existing workers in the same presentation role for the lifetime of one real project.
 * New arrivals fill missing core roles first, then extend the repeating crew pattern. Workers who
 * merely travel to/from the site remain in `workerIds`, so commuting never causes a reshuffle.
 */
export function reconcileConstructionCrewRoles(
  projectKey: string,
  workerIds: readonly string[],
  previous: ReadonlyMap<string, ConstructionCrewAssignment> = new Map(),
): Map<string, ConstructionCrewAssignment> {
  const ranked = [...new Set(workerIds)].sort((a, b) =>
    stableUnit(`${projectKey}:${a}:crew-rank`) - stableUnit(`${projectKey}:${b}:crew-rank`)
    || a.localeCompare(b));
  const active = new Set(ranked);
  const assignments = new Map<string, ConstructionCrewAssignment>();

  // Preserve every still-assigned worker exactly. Removing or adding somebody must never cause
  // the rest of the crew to swap jobs mid-animation.
  for (const [id, assignment] of previous) {
    if (active.has(id)) assignments.set(id, assignment);
  }

  let nextRank = Math.max(-1, ...[...assignments.values()].map(assignment => assignment.rank)) + 1;
  const count = (role: ConstructionCrewRole): number =>
    [...assignments.values()].filter(assignment => assignment.role === role).length;
  const sequence: readonly ConstructionCrewRole[] = ['hauler', 'assembler', 'site-worker'];

  for (const id of ranked) {
    if (assignments.has(id)) continue;
    let role: ConstructionCrewRole;
    if (count('hauler') === 0) role = 'hauler';
    else if (ranked.length >= 2 && count('assembler') === 0) role = 'assembler';
    else if (ranked.length >= 3 && count('site-worker') === 0) role = 'site-worker';
    else role = sequence[nextRank % sequence.length]!;
    assignments.set(id, { role, rank: nextRank });
    nextRank += 1;
  }

  // A genuine crew departure may leave an essential role empty. Rebalance only the minimum
  // number of people required for a viable visible workflow, preferring the newest worker from
  // an overrepresented/non-required role. Temporary travel never reaches this path because
  // commuters remain in workerIds.
  const required: ConstructionCrewRole[] = ['hauler'];
  if (ranked.length >= 2) required.push('assembler');
  if (ranked.length >= 3) required.push('site-worker');
  for (const missing of required.filter(role => count(role) === 0)) {
    const donor = [...assignments.entries()]
      .filter(([, assignment]) => !required.includes(assignment.role) || count(assignment.role) > 1)
      .sort((a, b) => b[1].rank - a[1].rank)[0];
    if (!donor) continue;
    assignments.set(donor[0], { ...donor[1], role: missing });
  }
  return assignments;
}

/** Pair a hauler with one stable assembler so both sides of a handoff share a workface. */
export function constructionHandoffRecipientId(
  personId: string,
  assignments: ReadonlyMap<string, ConstructionCrewAssignment>,
): string | undefined {
  const source = assignments.get(personId);
  if (source?.role !== 'hauler') return undefined;
  const assemblers = [...assignments.entries()]
    .filter(([, assignment]) => assignment.role === 'assembler')
    .sort((a, b) => a[1].rank - b[1].rank || a[0].localeCompare(b[0]));
  if (assemblers.length === 0) return undefined;
  return assemblers[source.rank % assemblers.length]![0];
}

/** Stable face selection spreads workers around the future structure instead of one magic point. */
export function constructionWorkfaceIndex(projectKey: string, personId: string): number {
  return Math.min(3, Math.floor(stableUnit(`${projectKey}:${personId}:workface`) * 4));
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
