import { cellAt } from '../world';
import type { Person, Settlement, SimulationState, Vec2, WorldCell, WorldState } from '../types';
import { PeopleSystem } from './PeopleSystem';

const BASE_WEAR_PER_PASS = 0.0008;
const MAX_RECORDED_STEP_MULTIPLIER = 3.5;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function applyTrackWear(cell: WorldCell, amount: number, month: number, ownerId: string): void {
  if (cell.water || amount <= 0) return;
  cell.modifications ??= {};
  const previous = cell.modifications.track;
  cell.modifications.track = {
    intensity: clamp01((previous?.intensity ?? 0) + amount),
    firstMonth: previous?.firstMonth ?? month,
    lastMonth: month,
    ownerId,
  };
}

/**
 * Records one actually-walked segment as persistent landscape wear. This is deliberately much
 * weaker than an engineered road: a single traveller leaves almost nothing, while repeated
 * movement by a community gradually exposes a desire path. The state lives in the existing
 * `track` land modification so abandoned routes inherit the normal environmental fade/recovery.
 */
export function recordFootTrafficSegment(
  world: WorldState,
  from: Vec2,
  to: Vec2,
  month: number,
  ownerId: string,
  weight = 1,
): void {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance < 0.025 || distance > world.cellSize * MAX_RECORDED_STEP_MULTIPLIER) return;

  const steps = Math.max(1, Math.ceil(distance / Math.max(0.15, world.cellSize * 0.45)));
  const seen = new Set<WorldCell>();
  const wear = BASE_WEAR_PER_PASS * Math.max(0.25, Math.min(2.5, weight));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const cell = cellAt(world, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
    if (!cell || seen.has(cell)) continue;
    seen.add(cell);
    applyTrackWear(cell, wear, month, ownerId);
  }
}

function trafficWeight(person: Person): number {
  if (person.role === 'child' || person.role === 'elder') return 0.65;
  if (['transporter', 'dock-worker', 'logistics-worker', 'farmer', 'miner', 'builder', 'laborer'].includes(person.role ?? '')) return 1.25;
  return 1;
}

let installed = false;

/**
 * Instruments the existing PeopleSystem without changing its navigation authority. We observe the
 * position before and after `advancePerson`; only a short, genuinely walkable on-foot movement is
 * allowed to wear the ground. Teleports, flood evacuation jumps, rail and water travel cannot
 * create paths.
 */
export function installFootTrafficTracking(): void {
  if (installed) return;
  installed = true;
  const original = PeopleSystem.prototype.advancePerson;
  PeopleSystem.prototype.advancePerson = function trackedAdvancePerson(
    person: Person,
    settlement: Settlement,
    state: SimulationState,
  ): void {
    const from = { ...person.position };
    const crossingMode = person.navigation?.crossingMode ?? 'walk';
    original.call(this, person, settlement, state);

    if (crossingMode !== 'walk' || !person.alive) return;
    const distance = Math.hypot(person.position.x - from.x, person.position.z - from.z);
    if (distance < 0.025 || distance > this.walkability['world'].cellSize * MAX_RECORDED_STEP_MULTIPLIER) return;
    if (!this.walkability.isWalkable(from) || !this.walkability.isWalkable(person.position)) return;
    if (!this.walkability.isSegmentWalkable(from, person.position)) return;

    recordFootTrafficSegment(state.world, from, person.position, state.month, settlement.id, trafficWeight(person));
  };
}
