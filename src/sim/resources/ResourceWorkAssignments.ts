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
  /** Occupations physically allowed to perform this extraction. */
  readonly gatherOccupations: readonly Occupation[];
  /** Exact labour actually consumed from each occupation bucket for this site this month. */
  readonly labourByOccupation: Readonly<Partial<Record<Occupation, number>>>;
  readonly amountExtracted: number;
  readonly labourUsed: number;
  readonly accessPath?: ReadonlyArray<Readonly<Vec2>>;
  readonly accessPaths?: ReadonlyArray<ReadonlyArray<Readonly<Vec2>>>;
}

interface MonthlyWorkSnapshot {
  month: number;
  revision: number;
  assignments: ResourceWorkAssignment[];
  /** Cell-based world resources supersede the older deposit model for the same settlement/material. */
  worldAuthority: Set<string>;
  processing: Map<string, Map<string, number>>;
}

const snapshots = new WeakMap<SimulationState, MonthlyWorkSnapshot>();
/** Presentation renderers own the WorldState already; mirror the same transient snapshot by world. */
const snapshotsByWorld = new WeakMap<WorldState, MonthlyWorkSnapshot>();

function authorityKey(settlementId: string, resourceId: string): string {
  return `${settlementId}\u0000${resourceId}`;
}

function freshSnapshot(month: number): MonthlyWorkSnapshot {
  return { month, revision: 0, assignments: [], worldAuthority: new Set(), processing: new Map() };
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
 * Starts the current month's presentation ledger even in a month with zero extraction. Repeating
 * the call in the same month is intentionally a no-op so a second resource pass cannot erase work
 * already recorded by another authority.
 */
export function beginResourceWorkMonth(state: SimulationState): void {
  const current = snapshots.get(state);
  if (current?.month === state.month) {
    snapshotsByWorld.set(state.world, current);
    return;
  }
  const next = freshSnapshot(state.month);
  snapshots.set(state, next);
  snapshotsByWorld.set(state.world, next);
}

/** Records one real extraction site. This never mutates simulation resource quantities. */
export function recordResourceWorkAssignment(state: SimulationState, assignment: ResourceWorkAssignment): void {
  if (assignment.month !== state.month || assignment.amountExtracted <= 0 || assignment.labourUsed <= 0) return;
  const contributed = Object.values(assignment.labourByOccupation).reduce((sum, amount) => sum + (amount ?? 0), 0);
  if (contributed <= 0) return;
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
    labourByOccupation: Object.freeze({ ...assignment.labourByOccupation }),
    accessPath: assignment.accessPath ? Object.freeze(assignment.accessPath.map(copyPoint)) : undefined,
    accessPaths: assignment.accessPaths
      ? Object.freeze(assignment.accessPaths.map((leg) => Object.freeze(leg.map(copyPoint))))
      : undefined,
  }));
  current.revision += 1;
}

/** Current-month work only. Advancing `state.month` automatically exposes a fresh empty snapshot. */
export function resourceWorkAssignments(state: SimulationState): readonly ResourceWorkAssignment[] {
  return snapshot(state).assignments;
}

/** Monotonic within a month; lets documentary routing cache without serializing the full ledger per person. */
export function resourceWorkRevision(state: SimulationState): number {
  return snapshot(state).revision;
}

/** Read-only renderer bridge for systems that deliberately own only the WorldState. */
export function resourceWorkAssignmentsForWorld(world: WorldState): readonly ResourceWorkAssignment[] {
  return snapshotsByWorld.get(world)?.assignments ?? [];
}

/** Observes spent processing labour/inputs, including trials. Never authorizes production. */
export function recordResourceProcessing(state: SimulationState, settlementId: string, recipeId: string): void {
  const ledger = snapshot(state).processing;
  let recipes = ledger.get(settlementId);
  if (!recipes) { recipes = new Map(); ledger.set(settlementId, recipes); }
  recipes.set(recipeId, (recipes.get(recipeId) ?? 0) + 1);
}

export function resourceProcessingForWorld(world: WorldState, settlementId: string, month: number): ReadonlyMap<string, number> {
  const ledger = snapshotsByWorld.get(world);
  return ledger?.month === month ? ledger.processing.get(settlementId) ?? new Map() : new Map();
}
