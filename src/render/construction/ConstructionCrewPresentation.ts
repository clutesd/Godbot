export type ConstructionCrewRole = 'hauler' | 'assembler' | 'site-worker';

export interface ConstructionCrewAssignment {
  role: ConstructionCrewRole;
  /** Stable rank inside the visible project crew; useful for presentation diagnostics. */
  rank: number;
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
  return assignments;
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
