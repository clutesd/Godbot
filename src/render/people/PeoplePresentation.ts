import type { DestinationKind, Person, Vec2 } from '../../sim/types';
import type { AnimationState } from '../animation/AnimationController';
import { RUN_SPEED_THRESHOLD, WALK_SPEED_THRESHOLD } from './PeopleVisualState';

/**
 * PeoplePresentation.ts
 *
 * Presentation-only reading of simulation state: who belongs to which visible gathering, where a
 * character stands within it, how much individuality it earns, and which animation its visual
 * travel implies. Nothing here changes simulation authority; every offset is deterministic in the
 * person's identity so a crowd is stable between frames instead of reshuffling.
 */

export type VisualTier = 'population' | 'notable' | 'historical';

type SocialPerson = Person & { socialAffinityIds?: string[]; socialAvoidIds?: string[] };

/** How strongly members of a gathering are drawn toward its occupancy geometry, by destination. */
const COHESION: Partial<Record<DestinationKind, number>> = {
  market: 0.84,
  plaza: 0.82,
  shrine: 0.88,
  'construction-site': 0.78,
  'safe-area': 0.76,
  workshop: 0.7,
  warehouse: 0.72,
  dock: 0.82,
  station: 0.82,
  'civic-building': 0.7,
  'knowledge-institution': 0.72,
  'industrial-site': 0.72,
  field: 0.5,
  'patrol-route': 0.78,
  home: 0.72,
};

/** Destinations people attend by talking to each other rather than by working. */
const CONVERSATIONAL = new Set<DestinationKind>(['market', 'plaza']);
/** Destinations with a focal point every attendant turns toward. */
const FOCAL = new Set<DestinationKind>(['shrine', 'construction-site']);
const LINEAR = new Set<DestinationKind>(['dock', 'station', 'patrol-route']);
const WORK_GRID = new Set<DestinationKind>([
  'field', 'workshop', 'construction-site', 'warehouse', 'industrial-site', 'knowledge-institution', 'civic-building',
]);

/** A visual gathering never drags a character far from the authoritative simulation position. */
const MAX_DISPLACEMENT = 1.6;
const GOLDEN_ANGLE = 2.39996323;

export interface SocialGroup {
  key: string;
  kind: DestinationKind;
  centerX: number;
  centerZ: number;
  /** Deterministic social order: close ties are adjacent when possible, then stable id order. */
  members: string[];
}

export interface GroupPlacement {
  x: number;
  z: number;
  /** Facing to hold while stationary — toward a focal point or a conversation partner. */
  restFacing?: number;
}

/** People who are travelling keep their own route; only settled attendants form gatherings. */
export function groupKeyFor(person: Person): string | undefined {
  const navigation = person.navigation;
  if (!navigation || navigation.traveling) return undefined;
  if (COHESION[navigation.destinationKind] === undefined) return undefined;
  return `${navigation.destinationKind}:${navigation.destinationId}`;
}

export function buildSocialGroups(people: readonly Person[]): Map<string, SocialGroup> {
  const groups = new Map<string, SocialGroup>();
  const peopleById = new Map(people.map((person) => [person.id, person as SocialPerson]));
  for (const person of people) {
    const key = groupKeyFor(person);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.centerX += person.position.x;
      existing.centerZ += person.position.z;
      existing.members.push(person.id);
      continue;
    }
    groups.set(key, {
      key,
      kind: person.navigation!.destinationKind,
      centerX: person.position.x,
      centerZ: person.position.z,
      members: [person.id],
    });
  }
  for (const group of groups.values()) {
    group.centerX /= group.members.length;
    group.centerZ /= group.members.length;
    group.members = sociallyOrderMembers(group.members, peopleById, group.kind);
  }
  return groups;
}

/**
 * Places one member of a gathering using destination-specific occupancy geometry. Markets resolve
 * into conversational pods, shrines into audience arcs, docks/patrols into lanes, work sites into
 * loose grids, and homes into compact household groups. The result is blended with the authoritative
 * position and clamped, so presentation reveals social structure without inventing simulation travel.
 */
export function placeInGroup(person: Person, group: SocialGroup | undefined, simPosition: Vec2): GroupPlacement {
  if (!group) return { x: simPosition.x, z: simPosition.z };
  const index = group.members.indexOf(person.id);
  if (index < 0) return { x: simPosition.x, z: simPosition.z };

  const target = occupancyPlacement(group, index);
  const cohesion = COHESION[group.kind] ?? 0.3;
  const blendedX = simPosition.x + (target.x - simPosition.x) * cohesion;
  const blendedZ = simPosition.z + (target.z - simPosition.z) * cohesion;
  const offsetX = blendedX - simPosition.x;
  const offsetZ = blendedZ - simPosition.z;
  const displacement = Math.hypot(offsetX, offsetZ);
  const limit = displacement > MAX_DISPLACEMENT ? MAX_DISPLACEMENT / displacement : 1;
  return {
    x: simPosition.x + offsetX * limit,
    z: simPosition.z + offsetZ * limit,
    ...(target.restFacing === undefined ? {} : { restFacing: target.restFacing }),
  };
}

export function visualTierFor(person: Person): VisualTier {
  const status = person.historical?.status;
  return status === 'historical' ? 'historical' : status === 'notable' ? 'notable' : 'population';
}

/**
 * Visual travel wins over the logical activity: a character that is plainly moving must not play a
 * stationary work loop. Carrying and alert states survive because they read while walking.
 */
export function travelAnimationFor(speed: number, person: Person): AnimationState | undefined {
  if (speed < WALK_SPEED_THRESHOLD) return undefined;
  if (person.activity === 'flee' || speed >= RUN_SPEED_THRESHOLD) return 'run';
  if (person.activity === 'transport' || person.appearance?.carriedItem === 'basket' || person.appearance?.carriedItem === 'bag') return 'carry';
  return 'walk';
}

function occupancyPlacement(group: SocialGroup, index: number): GroupPlacement {
  const count = group.members.length;
  const phase = unit(`${group.key}:phase`) * Math.PI * 2;
  if (CONVERSATIONAL.has(group.kind) && count >= 2) return conversationalPod(group, index, phase);
  if (group.kind === 'shrine') return audienceArc(group, index, phase);
  if (LINEAR.has(group.kind)) return linearLane(group, index, phase);
  if (WORK_GRID.has(group.kind)) return workGrid(group, index, phase);
  if (group.kind === 'home') return householdCluster(group, index, phase);
  return radialCluster(group, index, phase);
}

function conversationalPod(group: SocialGroup, index: number, phase: number): GroupPlacement {
  const count = group.members.length;
  const pod = Math.floor(index / 2);
  const podCount = Math.ceil(count / 2);
  const side = index % 2 === 0 ? 1 : -1;
  const angle = phase + pod * GOLDEN_ANGLE;
  const radius = 0.42 + Math.sqrt(podCount) * 0.24 + Math.sqrt((pod + 0.5) / Math.max(1, podCount)) * 0.35;
  const centerX = group.centerX + Math.cos(angle) * radius;
  const centerZ = group.centerZ + Math.sin(angle) * radius;
  const axis = angle + Math.PI * 0.5 + (unit(`${group.key}:${pod}:axis`) - 0.5) * 0.45;
  const separation = 0.25 + unit(`${group.key}:${pod}:gap`) * 0.08;
  return {
    x: centerX + Math.cos(axis) * separation * side,
    z: centerZ + Math.sin(axis) * separation * side,
    restFacing: Math.atan2(-Math.cos(axis) * side, -Math.sin(axis) * side),
  };
}

function audienceArc(group: SocialGroup, index: number, phase: number): GroupPlacement {
  const perRow = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(group.members.length) * 1.5)));
  const row = Math.floor(index / perRow);
  const rowStart = row * perRow;
  const inRow = Math.min(perRow, group.members.length - rowStart);
  const column = index - rowStart;
  const span = Math.min(Math.PI * 1.15, 0.42 * Math.max(1, inRow - 1));
  const angle = phase - span * 0.5 + (inRow <= 1 ? 0 : column / (inRow - 1) * span);
  const radius = 0.52 + row * 0.42;
  const x = group.centerX + Math.cos(angle) * radius;
  const z = group.centerZ + Math.sin(angle) * radius;
  return { x, z, restFacing: Math.atan2(group.centerX - x, group.centerZ - z) };
}

function linearLane(group: SocialGroup, index: number, phase: number): GroupPlacement {
  const perRow = Math.min(7, Math.max(2, Math.ceil(Math.sqrt(group.members.length) * 1.8)));
  const row = Math.floor(index / perRow);
  const column = index % perRow;
  const membersThisRow = Math.min(perRow, group.members.length - row * perRow);
  const lateral = (column - (membersThisRow - 1) / 2) * (group.kind === 'patrol-route' ? 0.42 : 0.48);
  const depth = (row - 0.5) * 0.42;
  const alongX = Math.cos(phase);
  const alongZ = Math.sin(phase);
  const acrossX = -alongZ;
  const acrossZ = alongX;
  const x = group.centerX + alongX * lateral + acrossX * depth;
  const z = group.centerZ + alongZ * lateral + acrossZ * depth;
  return { x, z, ...(group.kind === 'patrol-route' ? { restFacing: Math.atan2(alongX, alongZ) } : {}) };
}

function workGrid(group: SocialGroup, index: number, phase: number): GroupPlacement {
  const columns = Math.max(2, Math.ceil(Math.sqrt(group.members.length)));
  const rows = Math.ceil(group.members.length / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const spacing = group.kind === 'field' ? 0.72 : group.kind === 'industrial-site' ? 0.58 : 0.52;
  const localX = (column - (columns - 1) / 2) * spacing;
  const localZ = (row - (rows - 1) / 2) * spacing;
  const cos = Math.cos(phase);
  const sin = Math.sin(phase);
  const x = group.centerX + localX * cos - localZ * sin;
  const z = group.centerZ + localX * sin + localZ * cos;
  return { x, z, ...(FOCAL.has(group.kind) ? { restFacing: Math.atan2(group.centerX - x, group.centerZ - z) } : {}) };
}

function householdCluster(group: SocialGroup, index: number, phase: number): GroupPlacement {
  if (group.members.length === 1) return { x: group.centerX, z: group.centerZ };
  const angle = phase + index / group.members.length * Math.PI * 2;
  const radius = 0.28 + Math.min(0.42, Math.sqrt(group.members.length) * 0.11);
  return { x: group.centerX + Math.cos(angle) * radius, z: group.centerZ + Math.sin(angle) * radius };
}

function radialCluster(group: SocialGroup, index: number, phase: number): GroupPlacement {
  const count = group.members.length;
  const angle = phase + index * GOLDEN_ANGLE;
  const radius = (0.34 + Math.sqrt(count) * 0.18) * Math.sqrt((index + 0.6) / Math.max(1, count));
  return { x: group.centerX + Math.cos(angle) * radius, z: group.centerZ + Math.sin(angle) * radius };
}

function sociallyOrderMembers(ids: readonly string[], peopleById: ReadonlyMap<string, SocialPerson>, kind: DestinationKind): string[] {
  const remaining = new Set([...ids].sort());
  const ordered: string[] = [];
  let current = [...remaining][0];
  while (current) {
    ordered.push(current);
    remaining.delete(current);
    if (remaining.size === 0) break;
    const person = peopleById.get(current);
    const affinities = person?.socialAffinityIds ?? [];
    const avoidances = person?.socialAvoidIds ?? [];
    const candidates = [...remaining];
    candidates.sort((aId, bId) => {
      const a = peopleById.get(aId);
      const b = peopleById.get(bId);
      const aAffinity = affinities.indexOf(aId);
      const bAffinity = affinities.indexOf(bId);
      const aAvoided = avoidances.includes(aId) || Boolean(a?.socialAvoidIds?.includes(current!));
      const bAvoided = avoidances.includes(bId) || Boolean(b?.socialAvoidIds?.includes(current!));
      const aRank = aAvoided ? 1000
        : aAffinity >= 0 ? aAffinity
          : person && a?.householdId === person.householdId ? 10
            : person && isWorkDestination(kind) && a?.workplaceId === person.workplaceId ? 20 : 100;
      const bRank = bAvoided ? 1000
        : bAffinity >= 0 ? bAffinity
          : person && b?.householdId === person.householdId ? 10
            : person && isWorkDestination(kind) && b?.workplaceId === person.workplaceId ? 20 : 100;
      return aRank - bRank || aId.localeCompare(bId);
    });
    current = candidates[0];
  }
  return ordered;
}

function isWorkDestination(kind: DestinationKind): boolean {
  return WORK_GRID.has(kind) || LINEAR.has(kind);
}

function unit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
