import type { DestinationKind, Person, SimulationState, Vec2 } from '../types';
import {
  resourceWorkAssignments,
  type ResourceWorkAssignment,
} from '../resources/ResourceWorkAssignments';
import { WalkabilityLayer } from './WalkabilityLayer';

const MAX_WORKERS_PER_SITE = 4;
const MAX_WORKERS_PER_SETTLEMENT = 12;
const RESOURCE_DESTINATION_PREFIX = 'resource-work:';
const RESOURCE_ROUTE_TOLERANCE = 0.12;
const COMMITTED_ROLES = new Set(['soldier', 'guard']);

interface RoutingSnapshot {
  month: number;
  seed: string;
  signature: string;
  byPerson: Map<string, ResourceWorkAssignment>;
}

interface SiteCandidateQueue {
  people: Person[];
  cursor: number;
}

const routingSnapshots = new WeakMap<SimulationState, RoutingSnapshot>();

/**
 * The economic system owns labour quantities. This layer only chooses a small documentary cast
 * from the same real occupation buckets so visible work never creates or consumes production.
 */
export function resourceWorkAssignmentForPerson(
  state: SimulationState,
  person: Person,
  seed: string,
): ResourceWorkAssignment | undefined {
  return routingSnapshot(state, seed).byPerson.get(person.id);
}

export function resourceWorkDestinationId(assignment: ResourceWorkAssignment): string {
  return `${RESOURCE_DESTINATION_PREFIX}${assignment.siteId}`;
}

export function isResourceWorkDestinationId(destinationId: string | undefined): boolean {
  return Boolean(destinationId?.startsWith(RESOURCE_DESTINATION_PREFIX));
}

/**
 * Reuses existing destination categories so the current presentation occupancy grammar can spread
 * workers at the site. The destination id and point remain the actual resource site.
 */
export function resourceWorkDestinationKind(assignment: ResourceWorkAssignment): DestinationKind {
  const resource = assignment.resourceId;
  return resource.includes('ore') || resource === 'stone' || resource === 'clay' || resource === 'coal'
    ? 'industrial-site'
    : 'field';
}

/**
 * Only a single contiguous pedestrian access leg is safe to reuse as a preferred commute. A
 * multimodal extraction route exposes separate walking prefix/suffix legs around rail/water; never
 * flatten those disconnected legs into a fake pedestrian path. In that case ordinary terrain-safe
 * routing decides whether a representative can actually reach the work site on foot.
 */
export function resourceWorkPreferredWaypoints(assignment: ResourceWorkAssignment): Vec2[] {
  const source = assignment.accessPaths?.length === 1
    ? assignment.accessPaths[0]!
    : assignment.accessPaths && assignment.accessPaths.length > 1
      ? []
      : assignment.accessPath ?? [];
  const points: Vec2[] = [];
  for (const point of source) {
    const previous = points[points.length - 1];
    if (previous && Math.hypot(previous.x - point.x, previous.z - point.z) < 0.001) continue;
    points.push({ x: point.x, z: point.z });
  }
  return points;
}

function routingSnapshot(state: SimulationState, seed: string): RoutingSnapshot {
  const assignments = resourceWorkAssignments(state);
  const signature = assignments
    .map((assignment) => `${assignment.settlementId}:${assignment.siteId}:${assignment.resourceId}:${assignment.amountExtracted.toFixed(4)}:${assignment.labourUsed.toFixed(4)}`)
    .join('|');
  const cached = routingSnapshots.get(state);
  if (cached?.month === state.month && cached.seed === seed && cached.signature === signature) return cached;

  const byPerson = allocateRepresentatives(state, assignments, seed);
  const next = { month: state.month, seed, signature, byPerson };
  routingSnapshots.set(state, next);
  return next;
}

function allocateRepresentatives(
  state: SimulationState,
  assignments: readonly ResourceWorkAssignment[],
  seed: string,
): Map<string, ResourceWorkAssignment> {
  const result = new Map<string, ResourceWorkAssignment>();
  const bySettlement = new Map<string, ResourceWorkAssignment[]>();
  for (const assignment of assignments) {
    if (assignment.month !== state.month || assignment.amountExtracted <= 0 || assignment.labourUsed <= 0) continue;
    const local = bySettlement.get(assignment.settlementId) ?? [];
    local.push(assignment);
    bySettlement.set(assignment.settlementId, local);
  }

  const walking = new WalkabilityLayer(state.world);
  for (const [settlementId, localAssignments] of bySettlement) {
    const residents = state.people.filter((person) => person.alive && person.homeId === settlementId);
    const rankedAssignments = [...localAssignments].sort((a, b) =>
      b.labourUsed - a.labourUsed || b.amountExtracted - a.amountExtracted || a.siteId.localeCompare(b.siteId));
    const targets = new Map(rankedAssignments.map((assignment) => [assignment.siteId, representativeTarget(assignment)]));
    const assignedAtSite = new Map<string, number>();
    const claimed = new Set<string>();
    const queues = new Map<string, SiteCandidateQueue>();
    for (const assignment of rankedAssignments) {
      queues.set(assignment.siteId, {
        cursor: 0,
        people: residents
          .filter((person) => eligibleRepresentative(person, assignment))
          .sort((a, b) => workerRank(seed, state.month, assignment.siteId, a.id) - workerRank(seed, state.month, assignment.siteId, b.id)
            || a.id.localeCompare(b.id)),
      });
    }
    let remaining = MAX_WORKERS_PER_SETTLEMENT;

    // Round-robin passes ensure small but real sites get a worker before a large site fills its cap.
    for (let pass = 0; pass < MAX_WORKERS_PER_SITE && remaining > 0; pass += 1) {
      let added = false;
      for (const assignment of rankedAssignments) {
        if (remaining <= 0) break;
        const target = targets.get(assignment.siteId) ?? 0;
        const siteCount = assignedAtSite.get(assignment.siteId) ?? 0;
        if (siteCount >= target || siteCount > pass) continue;
        const queue = queues.get(assignment.siteId);
        const candidate = queue ? nextReachableCandidate(queue, claimed, walking, assignment) : undefined;
        if (!candidate) continue;
        result.set(candidate.id, assignment);
        claimed.add(candidate.id);
        assignedAtSite.set(assignment.siteId, siteCount + 1);
        remaining -= 1;
        added = true;
      }
      if (!added) break;
    }
  }
  return result;
}

function eligibleRepresentative(person: Person, assignment: ResourceWorkAssignment): boolean {
  return assignment.gatherOccupations.includes(person.occupation)
    && person.displacedSinceMonth === undefined
    && person.activity !== 'migrate'
    && person.navigation?.schedulePhase !== 'emergency'
    && !COMMITTED_ROLES.has(person.role ?? '')
    && person.health > 0.2;
}

function nextReachableCandidate(
  queue: SiteCandidateQueue,
  claimed: ReadonlySet<string>,
  walking: WalkabilityLayer,
  assignment: ResourceWorkAssignment,
): Person | undefined {
  while (queue.cursor < queue.people.length) {
    const person = queue.people[queue.cursor++];
    if (!person || claimed.has(person.id)) continue;
    if (canReachResourceSite(walking, person, assignment)) return person;
  }
  return undefined;
}

function canReachResourceSite(
  walking: WalkabilityLayer,
  person: Person,
  assignment: ResourceWorkAssignment,
): boolean {
  const destination = walking.nearestWalkable(
    assignment.worldPosition,
    `${person.id}:${resourceWorkDestinationId(assignment)}`,
  );
  const route = walking.route(person.position, destination, resourceWorkPreferredWaypoints(assignment), 'walk');
  const end = route.at(-1);
  return Boolean(end && Math.hypot(end.x - destination.x, end.z - destination.z) <= RESOURCE_ROUTE_TOLERANCE);
}

function representativeTarget(assignment: ResourceWorkAssignment): number {
  return Math.min(MAX_WORKERS_PER_SITE, Math.max(1, Math.ceil(Math.sqrt(assignment.labourUsed))));
}

function workerRank(seed: string, month: number, siteId: string, personId: string): number {
  return stableUnit(`${seed}:${month}:${siteId}:${personId}:resource-worker`);
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
