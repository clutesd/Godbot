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
  const ranked = [...new Set(workerIds)].sort((a, b) =>
    stableUnit(`${projectKey}:${a}:crew-rank`) - stableUnit(`${projectKey}:${b}:crew-rank`)
    || a.localeCompare(b));
  const assignments = new Map<string, ConstructionCrewAssignment>();
  if (ranked.length === 0) return assignments;

  if (ranked.length === 1) {
    assignments.set(ranked[0]!, { role: 'hauler', rank: 0 });
    return assignments;
  }
  if (ranked.length === 2) {
    assignments.set(ranked[0]!, { role: 'hauler', rank: 0 });
    assignments.set(ranked[1]!, { role: 'assembler', rank: 1 });
    return assignments;
  }

  const sequence: readonly ConstructionCrewRole[] = ['hauler', 'assembler', 'site-worker'];
  ranked.forEach((id, rank) => assignments.set(id, { role: sequence[rank % sequence.length]!, rank }));
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
