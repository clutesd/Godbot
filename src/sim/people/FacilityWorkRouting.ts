import { facilityTierSpec } from '../processing/FacilityCatalog';
import type { FacilityFamilyId, FacilityStatus, ProcessingFacility } from '../processing/types';
import type { Occupation, Person, Settlement, SimulationState, Vec2 } from '../types';
import { resourceWorkAssignmentForPerson } from './ResourceWorkRouting';

/**
 * Who stands at which machine.
 *
 * The facility authority already decides how many worker-months a works consumed, out of which
 * occupations, and what it was limited by. This layer only chooses a small documentary cast from
 * those same real numbers, so a visible crew can never create, consume or imply production that
 * the simulation did not perform. A works that used no labour this month has nobody at it.
 */

const FACILITY_DESTINATION_PREFIX = 'facility-work:';
const MAX_WORKERS_PER_FACILITY = 6;
const MAX_WORKERS_PER_SETTLEMENT = 14;
const COMMITTED_ROLES = new Set(['soldier', 'guard']);

/** What the represented person is standing in for, out of the facility's own labour accounting. */
export type FacilityDuty = 'process' | 'maintenance' | 'haul';

export interface FacilityWorkAssignment {
  month: number;
  settlementId: string;
  facilityId: string;
  family: FacilityFamilyId;
  tier: number;
  /** Stable tier kind id (`sawmill`, `machine-shop`, ...). */
  kind: string;
  plotId: string;
  position: Vec2;
  duty: FacilityDuty;
  /** Worker-months the works actually used last month. */
  labourUsed: number;
  /** Hauling worker-months, already counted separately by the authority. */
  labourHaul: number;
  status: FacilityStatus;
  /** 0..1 of nominal work delivered; drives how urgent the visible work looks. */
  throughput: number;
  heat: number;
  hauling: boolean;
}

interface RoutingSnapshot {
  month: number;
  seed: string;
  byPerson: Map<string, FacilityWorkAssignment>;
}

const snapshots = new WeakMap<SimulationState, RoutingSnapshot>();

export function facilityWorkAssignmentForPerson(
  state: SimulationState, person: Person, seed: string,
): FacilityWorkAssignment | undefined {
  return snapshot(state, seed).byPerson.get(person.id);
}

/** Every binding for one month; used by presentation and tests, never by production accounting. */
export function facilityWorkAssignments(state: SimulationState, seed: string): ReadonlyMap<string, FacilityWorkAssignment> {
  return snapshot(state, seed).byPerson;
}

export function facilityWorkDestinationId(assignment: FacilityWorkAssignment): string {
  return `${FACILITY_DESTINATION_PREFIX}${assignment.family}:${assignment.duty}:${assignment.facilityId}`;
}

export function isFacilityWorkDestinationId(destinationId: string | undefined): boolean {
  return Boolean(destinationId?.startsWith(FACILITY_DESTINATION_PREFIX));
}

/** Presentation reads the duty from the routed id without re-deriving the allocation. */
export function facilityWorkDutyFromDestinationId(destinationId: string | undefined): FacilityDuty | undefined {
  if (!isFacilityWorkDestinationId(destinationId)) return undefined;
  const duty = destinationId!.slice(FACILITY_DESTINATION_PREFIX.length).split(':')[1];
  return duty === 'process' || duty === 'maintenance' || duty === 'haul' ? duty : undefined;
}

export function facilityIdFromDestinationId(destinationId: string | undefined): string | undefined {
  if (!isFacilityWorkDestinationId(destinationId)) return undefined;
  const parts = destinationId!.slice(FACILITY_DESTINATION_PREFIX.length).split(':');
  return parts.slice(2).join(':') || undefined;
}

function snapshot(state: SimulationState, seed: string): RoutingSnapshot {
  const cached = snapshots.get(state);
  if (cached?.month === state.month && cached.seed === seed) return cached;
  const next: RoutingSnapshot = { month: state.month, seed, byPerson: allocate(state, seed) };
  snapshots.set(state, next);
  return next;
}

/** Worker-months a works used are the only licence for a visible crew, so they set its size. */
function crewTarget(f: ProcessingFacility): number {
  const used = Math.max(0, f.labour.used) + Math.max(0, f.labour.haul) * 0.5;
  if (used <= 1e-6) return 0;
  return Math.min(MAX_WORKERS_PER_FACILITY, Math.max(1, Math.round(used)));
}

/** The duties a works is actually paying for this month, in the order they should be filled. */
function duties(f: ProcessingFacility, count: number): FacilityDuty[] {
  const result: FacilityDuty[] = [];
  const hauling = f.labour.haul > 1e-6 || f.freight.inbound > 0.01 || f.freight.outbound > 0.01;
  const maintaining = f.condition < 0.995;
  for (let index = 0; index < count; index++) {
    if (index === 1 && hauling) result.push('haul');
    else if (index === 2 && maintaining) result.push('maintenance');
    else result.push('process');
  }
  return result;
}

function operating(f: ProcessingFacility): boolean {
  return f.progress >= 1 && !f.upgrade && f.status !== 'ruined' && f.status !== 'under-construction';
}

function eligible(state: SimulationState, person: Person, occupations: readonly Occupation[], seed: string): boolean {
  return occupations.includes(person.occupation)
    && person.alive
    && person.health > 0.2
    && person.displacedSinceMonth === undefined
    && person.activity !== 'migrate'
    && person.navigation?.schedulePhase !== 'emergency'
    && !COMMITTED_ROLES.has(person.role ?? '')
    // Someone already standing at a real extraction site cannot also be at a machine.
    && !resourceWorkAssignmentForPerson(state, person, seed);
}

/** Legible casting inside the economically valid occupation pool; never a new labour decision. */
function workerRank(seed: string, month: number, f: ProcessingFacility, duty: FacilityDuty, person: Person): number {
  const documentary = stableUnit(`${seed}:${month}:${f.id}:${person.id}:facility-worker`);
  const visible = stableUnit(`${seed}:${person.id}:visible`);
  const role = person.role ?? '';
  const dutyBias = duty === 'haul'
    ? ['transporter', 'logistics-worker', 'dock-worker', 'railway-worker'].includes(role) ? -0.26 : 0
    : duty === 'maintenance'
      ? ['engineer', 'machinist', 'machine-systems-specialist', 'builder'].includes(role) ? -0.26 : 0
      : ['machinist', 'factory-worker', 'craft-worker', 'engineer', 'energy-technician'].includes(role) ? -0.26 : 0;
  const skilled = (person.expertise ?? []).some(entry => entry.competence >= 0.5) ? -0.06 : 0;
  return documentary * 0.38 + visible * 0.62 + dutyBias + skilled;
}

function allocate(state: SimulationState, seed: string): Map<string, FacilityWorkAssignment> {
  const result = new Map<string, FacilityWorkAssignment>();
  for (const s of state.settlements) {
    if (!s.alive) continue;
    const facilities = (s.processing?.facilities ?? []).filter(operating)
      .sort((a, b) => crewTarget(b) - crewTarget(a) || a.id.localeCompare(b.id));
    if (facilities.length === 0) continue;
    const residents = state.people.filter(person => person.homeId === s.id);
    const claimed = new Set<string>();
    let remaining = MAX_WORKERS_PER_SETTLEMENT;
    for (const f of facilities) {
      if (remaining <= 0) break;
      const spec = facilityTierSpec(f.family, f.tier);
      const target = Math.min(crewTarget(f), remaining);
      if (!spec || target <= 0) continue;
      const plan = duties(f, target);
      const candidates = residents.filter(person => eligible(state, person, spec.occupations, seed));
      for (const duty of plan) {
        const pick = candidates
          .filter(person => !claimed.has(person.id) && dutyOccupationSupported(f, duty, person.occupation))
          .sort((a, b) => workerRank(seed, state.month, f, duty, a) - workerRank(seed, state.month, f, duty, b) || a.id.localeCompare(b.id))[0];
        if (!pick) continue;
        claimed.add(pick.id);
        remaining -= 1;
        result.set(pick.id, assignmentFor(state, s, f, duty));
      }
    }
  }
  return result;
}

/**
 * The works recorded worker-months by occupation. A duty may only be represented by someone whose
 * occupation actually contributed, except for hauling, which the authority bills separately.
 */
function dutyOccupationSupported(f: ProcessingFacility, duty: FacilityDuty, occupation: Occupation): boolean {
  if (duty === 'haul') return occupation === 'carrier' || (f.labour.byOccupation[occupation] ?? 0) > 0;
  return (f.labour.byOccupation[occupation] ?? 0) > 0;
}

function assignmentFor(
  state: SimulationState, s: Settlement, f: ProcessingFacility, duty: FacilityDuty,
): FacilityWorkAssignment {
  return {
    month: state.month,
    settlementId: s.id,
    facilityId: f.id,
    family: f.family,
    tier: f.tier,
    kind: f.kind,
    plotId: f.plotId,
    position: { x: f.position.x, z: f.position.z },
    duty,
    labourUsed: f.labour.used,
    labourHaul: f.labour.haul,
    status: f.status,
    throughput: f.throughput,
    heat: f.heat,
    hauling: f.freight.inbound > 0.01 || f.freight.outbound > 0.01,
  };
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
