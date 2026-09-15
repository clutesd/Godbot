import type { Occupation, SimulationState, Vec2, WorldState } from '../types';

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
/** Presentation renderers own the WorldState already; mirror the same transient snapshot by world. */
const snapshotsByWorld = new WeakMap<WorldState, MonthlyWorkSnapshot>();

function authorityKey(settlementId: string, resourceId: string): string {
  return `${settlementId}\u0000${resourceId}`;
}

function freshSnapshot(month: number): MonthlyWorkSnapshot {
  return { month, assignments: [], worldAuthority: new Set() };
}

function snapshot(state: SimulationState): MonthlyWorkSnapshot {
  const current = snapshots.get(state);
  if (current?.month === state.month) {
    snapshotsByWorld.set(state.world, current);
    return current;
  }
  const next = freshSnapshot(state.month);
  snapshots.set(state, next);
  snapshotsByWorld.set(state.world, next);
  return next;
}

function copyPoint(point: Readonly<Vec2>): Readonly<Vec2> {
  return Object.freeze({ x: point.x, z: point.z });
}

/**
 * Starts a new presentation ledger even in a month with zero extraction. This is what prevents
 * renderers that only know the world object from displaying last month's workers/sites forever.
 */
export function beginResourceWorkMonth(state: SimulationState): void {
  const next = freshSnapshot(state.month);
  snapshots.set(state, next);
  snapshotsByWorld.set(state.world, next);
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

/** Read-only renderer bridge for systems that deliberately own only the WorldState. */
export function resourceWorkAssignmentsForWorld(world: WorldState): readonly ResourceWorkAssignment[] {
  return snapshotsByWorld.get(world)?.assignments ?? [];
}
