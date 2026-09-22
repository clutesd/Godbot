import type { Vec2 } from '../../sim/types';
import type { SocialGroup } from './PeoplePresentation';
import type { RestPreference } from './RestChoreography';

/**
 * Presentation-only physical contract for rest.
 *
 * Simulation decides that a person is resting and where "home" is. This layer decides which
 * visible, collision-safe support point represents that rest during documentary presentation.
 * It never writes simulation state.
 */
export type RestPosture = 'supported-sit' | 'ground-sit';
export type RestSupportKind = 'structure-edge' | 'ground';

export interface RestSupportFootprint {
  key: string;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  rotationY: number;
}

export interface RestSpotPresentation {
  /** Stable key used as a presentation reservation. */
  key: string;
  destination: Vec2;
  /** World-space yaw; structure-edge seats face away from the supporting wall. */
  facing: number;
  posture: RestPosture;
  support: RestSupportKind;
  supportKey?: string;
}

export interface RestPlanningContext {
  personId: string;
  base: Vec2;
  from: Vec2;
  group?: Pick<SocialGroup, 'members'>;
  structure?: RestSupportFootprint;
  /** Visible people currently eligible to consume rest slots at this home. */
  restingIds?: readonly string[];
  safePoint(point: Vec2): boolean;
  safeSegment(a: Vec2, b: Vec2): boolean;
  /** Age/personality presentation preference; slot ownership still remains deterministic. */
  preference?: RestPreference;
  avoidKey?: string;
}

const EDGE_CLEARANCE = 0.24;
const FALLBACK_GROUND_RADIUS = 0.72;
const GROUND_SLOTS = 12;

/**
 * Candidate order is deliberately stable. Slot ownership is derived from person id order, so a
 * household does not reshuffle seats when renderer iteration order changes.
 */
export function restSpotCandidates(base: Vec2, structure?: RestSupportFootprint): RestSpotPresentation[] {
  if (!structure) return groundRing(base, undefined, FALLBACK_GROUND_RADIUS);

  const edge: RestSpotPresentation[] = [];
  const halfW = Math.max(0.12, structure.width / 2);
  const halfD = Math.max(0.12, structure.depth / 2);
  const insetX = Math.max(0.08, halfW * 0.72);
  const insetZ = Math.max(0.08, halfD * 0.72);
  const local: readonly [number, number, number, number][] = [
    [0, halfD + EDGE_CLEARANCE, 0, 1],
    [0, -halfD - EDGE_CLEARANCE, 0, -1],
    [halfW + EDGE_CLEARANCE, 0, 1, 0],
    [-halfW - EDGE_CLEARANCE, 0, -1, 0],
    [insetX, halfD + EDGE_CLEARANCE, 0.55, 1],
    [-insetX, halfD + EDGE_CLEARANCE, -0.55, 1],
    [insetX, -halfD - EDGE_CLEARANCE, 0.55, -1],
    [-insetX, -halfD - EDGE_CLEARANCE, -0.55, -1],
    [halfW + EDGE_CLEARANCE, insetZ, 1, 0.55],
    [halfW + EDGE_CLEARANCE, -insetZ, 1, -0.55],
    [-halfW - EDGE_CLEARANCE, insetZ, -1, 0.55],
    [-halfW - EDGE_CLEARANCE, -insetZ, -1, -0.55],
  ];
  for (const [index, [x, z, nx, nz]] of local.entries()) {
    const destination = localToWorld(structure, x, z);
    const normal = rotateDirection(structure.rotationY, nx, nz);
    edge.push({
      key: `${structure.key}:edge:${index}`,
      destination,
      facing: Math.atan2(normal.x, normal.z),
      posture: 'supported-sit',
      support: 'structure-edge',
      supportKey: structure.key,
    });
  }

  const radius = Math.max(
    FALLBACK_GROUND_RADIUS,
    Math.hypot(structure.width, structure.depth) / 2 + 0.42,
  );
  return [...edge, ...groundRing({ x: structure.worldX, z: structure.worldZ }, structure.key, radius)];
}

/**
 * Assign one physical rest slot without a mutable reservation table. Every visible resting member
 * of the same home owns a disjoint slice of the deterministic candidate list.
 */
export function planRestSpot(context: RestPlanningContext): RestSpotPresentation | undefined {
  const candidates = restSpotCandidates(context.base, context.structure);
  if (!candidates.length) return undefined;

  const occupants = stableOccupants(context.personId, context.restingIds ?? context.group?.members);
  const rank = Math.max(0, occupants.indexOf(context.personId));
  const count = Math.max(1, occupants.length);

  const owned = candidates.filter((_, index) => index % count === rank);
  const fallback = owned.length ? owned : candidates;
  const ordered = [...fallback].sort((a, b) =>
    restCandidateScore(a, context) - restCandidateScore(b, context) || a.key.localeCompare(b.key));
  for (const spot of ordered) {
    if (spot.key === context.avoidKey) continue;
    if (!context.safePoint(spot.destination)) continue;
    if (!context.safeSegment(context.from, spot.destination)) continue;
    return copySpot(spot);
  }
  return undefined;
}

function stableOccupants(personId: string, ids?: readonly string[]): string[] {
  const unique = new Set(ids ?? []);
  unique.add(personId);
  return [...unique].sort((a, b) => a.localeCompare(b));
}

function groundRing(center: Vec2, supportKey: string | undefined, radius: number): RestSpotPresentation[] {
  const out: RestSpotPresentation[] = [];
  for (let index = 0; index < GROUND_SLOTS; index++) {
    const angle = index / GROUND_SLOTS * Math.PI * 2;
    const outward = { x: Math.sin(angle), z: Math.cos(angle) };
    const destination = {
      x: center.x + outward.x * radius,
      z: center.z + outward.z * radius,
    };
    out.push({
      key: `${supportKey ?? 'ground'}:ground:${index}`,
      destination,
      // Ground resting in a shared household yard looks inward rather than staring into nowhere.
      facing: Math.atan2(center.x - destination.x, center.z - destination.z),
      posture: 'ground-sit',
      support: 'ground',
      ...(supportKey ? { supportKey } : {}),
    });
  }
  return out;
}

function localToWorld(structure: RestSupportFootprint, localX: number, localZ: number): Vec2 {
  const cos = Math.cos(structure.rotationY);
  const sin = Math.sin(structure.rotationY);
  return {
    x: structure.worldX + localX * cos + localZ * sin,
    z: structure.worldZ - localX * sin + localZ * cos,
  };
}

function rotateDirection(rotationY: number, localX: number, localZ: number): Vec2 {
  const length = Math.hypot(localX, localZ) || 1;
  const x = localX / length;
  const z = localZ / length;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

function copySpot(spot: RestSpotPresentation): RestSpotPresentation {
  return { ...spot, destination: { ...spot.destination } };
}


function restCandidateScore(spot: RestSpotPresentation, context: RestPlanningContext): number {
  const distance = Math.hypot(spot.destination.x - context.from.x, spot.destination.z - context.from.z);
  const preference = context.preference ?? 'mixed';
  const supportPenalty = preference === 'supported'
    ? spot.support === 'structure-edge' ? 0 : 2.4
    : preference === 'ground'
      ? spot.support === 'ground' ? 0 : 2.4
      : spot.support === 'structure-edge' ? 0 : 0.32;
  return supportPenalty + distance;
}
