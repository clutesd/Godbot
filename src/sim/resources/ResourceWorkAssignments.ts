import type { Occupation, SimulationState, Vec2 } from '../types';

export type ResourceWorkSource = 'world-resource' | 'deposit-system';

/**
 * Transient, read-only description of extraction that actually occurred in the current month.
 * Simulation resource state remains authoritative; this contract exists so people/renderers can
 * observe that authority without deriving work from role labels or decorative resource markers.
 */
export interface ResourceWorkAssignment {
  readonly month: number;
  readonly source: ResourceWorkSource;
  readonly settlementId: string;
  readonly siteId: string;
  readonly depositId?: string;
  readonly cellIndex?: number;
  readonly resourceId: string;
  readonly worldPosition: Readonly<Vec2>;
  readonly gatherOccupations: readonly Occupation[];
  readonly amountExtracted: number;
  readonly labourUsed: number;
  readonly accessPath?: ReadonlyArray<Readonly<Vec2>>;
  readonly accessPaths?: ReadonlyArray<ReadonlyArray<Readonly<Vec2>>>;
}

interface MonthlyWorkSnapshot {
  month: number;
  assignments: ResourceWorkAssignment[];
  /** Cell-based world resources supersede the older deposit model for the same settlement/material. */
  worldAuthority: Set<string>;
}

const snapshots = new WeakMap<SimulationState, MonthlyWorkSnapshot>();

function authorityKey(settlementId: string, resourceId: string): string {
  return `${settlementId}\u0000${resourceId}`;
}

function snapshot(state: SimulationState): MonthlyWorkSnapshot {
  const current = snapshots.get(state);
  if (current?.month === state.month) return current;
  const next: MonthlyWorkSnapshot = { month: state.month, assignments: [], worldAuthority: new Set() };
  snapshots.set(state, next);
  return next;
}

function copyPoint(point: Readonly<Vec2>): Readonly<Vec2> {
  return Object.freeze({ x: point.x, z: point.z });
}

/** Records one real extraction site. This never mutates simulation resource quantities. */
export function recordResourceWorkAssignment(state: SimulationState, assignment: ResourceWorkAssignment): void {
  if (assignment.month !== state.month || assignment.amountExtracted <= 0 || assignment.labourUsed <= 0) return;
  const current = snapshot(state);
  const key = authorityKey(assignment.settlementId, assignment.resourceId);

  if (assignment.source === 'world-resource') {
    if (!current.worldAuthority.has(key)) {
      current.assignments = current.assignments.filter((existing) =>
        existing.source !== 'deposit-system' || authorityKey(existing.settlementId, existing.resourceId) !== key);
      current.worldAuthority.add(key);
    }
  } else if (current.worldAuthority.has(key)) {
    return;
  }

  current.assignments.push(Object.freeze({
    ...assignment,
    worldPosition: copyPoint(assignment.worldPosition),
    gatherOccupations: Object.freeze([...assignment.gatherOccupations]),
    accessPath: assignment.accessPath ? Object.freeze(assignment.accessPath.map(copyPoint)) : undefined,
    accessPaths: assignment.accessPaths
      ? Object.freeze(assignment.accessPaths.map((leg) => Object.freeze(leg.map(copyPoint))))
      : undefined,
  }));
}

/** Current-month work only. Advancing `state.month` automatically exposes a fresh empty snapshot. */
export function resourceWorkAssignments(state: SimulationState): readonly ResourceWorkAssignment[] {
  return snapshot(state).assignments;
}
