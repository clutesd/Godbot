import { stableHash } from '../prng';
import { cellAt } from '../world';
import type { Person, Settlement, SimulationState, Vec2, WorldCell, WorldState } from '../types';
import { PeopleSystem } from './PeopleSystem';

const BASE_WEAR_PER_PASS = 0.0008;
const MAX_RECORDED_STEP_MULTIPLIER = 3.5;
const TRAFFIC_SAMPLE_PERIOD = 2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function applyFootpathWear(cell: WorldCell, amount: number, month: number, ownerId: string): void {
  if (cell.water || amount <= 0) return;
  cell.modifications ??= {};
  const previous = cell.modifications.footpath;
  cell.modifications.footpath = {
    intensity: clamp01((previous?.intensity ?? 0) + amount),
    firstMonth: previous?.firstMonth ?? month,
    lastMonth: month,
    ownerId,
  };
}

/**
 * Records one actually-walked segment as persistent landscape wear. This is deliberately much
 * weaker than an engineered road: a single traveller leaves almost nothing, while repeated
 * movement by a community gradually exposes a desire path. Pedestrian wear uses its own
 * `footpath` modification so movement pressure remains distinct from extraction tracks and built
 * road capital.
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
  const wear = BASE_WEAR_PER_PASS * Math.max(0.25, Math.min(2.5, weight));
  let previousCell: WorldCell | undefined;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const cell = cellAt(world, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
    if (!cell || cell === previousCell) continue;
    previousCell = cell;
    applyFootpathWear(cell, wear, month, ownerId);
  }
}

/** A completed monthly trip retains its actual consumed route. Observe that route, including
 * bends around terrain/buildings, rather than wearing the straight chord between its endpoints. */
function recordCompletedTrip(people: PeopleSystem, world: WorldState, from: Vec2, waypoints: readonly Vec2[],
  month: number, ownerId: string, weight: number): void {
  const seen = new Set<WorldCell>();
  const wear = BASE_WEAR_PER_PASS * Math.max(0.25, Math.min(2.5, weight));
  let start = from;
  for (const end of waypoints) {
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    if (distance >= 0.025 && people.walkability.isSegmentWalkable(start, end)) {
      const steps = Math.max(1, Math.ceil(distance / Math.max(0.15, world.cellSize * 0.45)));
      for (let i = 0; i <= steps; i++) {
        const cell = cellAt(world, start.x + (end.x - start.x) * i / steps, start.z + (end.z - start.z) * i / steps);
        if (!cell || seen.has(cell)) continue;
        seen.add(cell);
        applyFootpathWear(cell, wear, month, ownerId);
      }
    }
    start = end;
  }
}

function trafficWeight(person: Person): number {
  if (person.role === 'child' || person.role === 'elder') return 0.65;
  if (['transporter', 'dock-worker', 'logistics-worker', 'farmer', 'miner', 'builder', 'laborer'].includes(person.role ?? '')) return 1.25;
  return 1;
}

function sampledThisMonth(person: Person, state: SimulationState): boolean {
  const phase = Math.floor(stableHash(`${state.seed}:foot-traffic:${person.id}`) * TRAFFIC_SAMPLE_PERIOD) % TRAFFIC_SAMPLE_PERIOD;
  return state.month % TRAFFIC_SAMPLE_PERIOD === phase;
}

let trafficInstalled = false;

/**
 * Instruments the existing PeopleSystem without changing its navigation authority. We observe the
 * position before and after `advancePerson`, including trips which start and finish in one
 * tick. Completed trips use their retained route. Both crossing modes must be pedestrian: a boat journey or
 * emergency relocation cannot carve a shortcut through water or an existing footprint. Every
 * person contributes on a deterministic alternating month and carries double wear on sampled
 * months, preserving long-run traffic pressure while roughly halving bookkeeping cost.
 */
export function installFootTrafficTracking(): void {
  if (trafficInstalled) return;
  trafficInstalled = true;
  const original = PeopleSystem.prototype.advancePerson;
  PeopleSystem.prototype.advancePerson = function trackedAdvancePerson(
    this: PeopleSystem,
    person: Person,
    settlement: Settlement,
    state: SimulationState,
  ): void {
    const from = { ...person.position };
    const previousNavigation = person.navigation;
    const crossingMode = person.navigation?.crossingMode ?? 'walk';
    original.call(this, person, settlement, state);

    if (crossingMode !== 'walk' || (person.navigation?.crossingMode ?? 'walk') !== 'walk'
      || !person.alive || !sampledThisMonth(person, state)) return;
    if (person.navigation?.schedulePhase === 'emergency') return;
    if (state.advanced?.scale === 'modern-statistical') return;
    const navigation = person.navigation;
    if (navigation && navigation !== previousNavigation && !navigation.traveling
      && navigation.waypoints.length > 0 && navigation.waypointIndex === navigation.waypoints.length) {
      recordCompletedTrip(this, state.world, from, navigation.waypoints, state.month, settlement.id,
        trafficWeight(person) * TRAFFIC_SAMPLE_PERIOD);
      return;
    }
    const distance = Math.hypot(person.position.x - from.x, person.position.z - from.z);
    if (distance < 0.025 || distance > state.world.cellSize * MAX_RECORDED_STEP_MULTIPLIER) return;
    if (!this.walkability.isSegmentWalkable(from, person.position)) return;

    recordFootTrafficSegment(state.world, from, person.position, state.month, settlement.id, trafficWeight(person) * TRAFFIC_SAMPLE_PERIOD);
  };
}
