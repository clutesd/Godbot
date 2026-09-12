import type { DestinationKind, Person, Vec2 } from '../../sim/types';
import type { AnimationState } from '../animation/AnimationController';
import { RUN_SPEED_THRESHOLD, WALK_SPEED_THRESHOLD } from './PeopleVisualState';

/**
 * PeoplePresentation.ts
 *
 * Presentation-only reading of simulation state: who belongs to which visible gathering, where a
 * character stands within it, how much individuality it earns, and which animation its visual
 * travel implies. Nothing here changes simulation state; every offset is deterministic in the
 * person's identity so a crowd is stable between frames instead of reshuffling.
 */

export type VisualTier = 'population' | 'notable' | 'historical';

/** How strongly members of a gathering are drawn toward its centre, by destination. */
const COHESION: Partial<Record<DestinationKind, number>> = {
  market: 0.55,
  plaza: 0.55,
  shrine: 0.6,
  'construction-site': 0.5,
  'safe-area': 0.45,
  workshop: 0.4,
  warehouse: 0.4,
  dock: 0.4,
  station: 0.4,
  'civic-building': 0.4,
  'knowledge-institution': 0.4,
  'industrial-site': 0.4,
  field: 0.22,
  'patrol-route': 0.15,
  home: 0.12,
};

/** Destinations people attend by talking to each other rather than by working. */
const CONVERSATIONAL = new Set<DestinationKind>(['market', 'plaza']);
/** Destinations with a focal point every attendant turns toward. */
const FOCAL = new Set<DestinationKind>(['shrine', 'construction-site']);

/** A cluster never pulls a character further than this from its authoritative position. */
const MAX_DISPLACEMENT = 1.6;
const GOLDEN_ANGLE = 2.39996323;

export interface SocialGroup {
  key: string;
  kind: DestinationKind;
  centerX: number;
  centerZ: number;
  /** Person ids in deterministic order; a member's index fixes its place in the cluster. */
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
    group.members.sort();
  }
  return groups;
}

/**
 * Places one member of a gathering. Conversational destinations resolve into pairs facing each
 * other; focal destinations into a loose arc turned toward the centre; work destinations into a
 * spiral cluster. The result is blended with the authoritative position and clamped, so a crowd
 * reads as a crowd without the renderer inventing locations the simulation never chose.
 */
export function placeInGroup(person: Person, group: SocialGroup | undefined, simPosition: Vec2): GroupPlacement {
  if (!group) return { x: simPosition.x, z: simPosition.z };
  const index = group.members.indexOf(person.id);
  if (index < 0) return { x: simPosition.x, z: simPosition.z };
  const count = group.members.length;
  const cohesion = COHESION[group.kind] ?? 0.3;
  const conversational = CONVERSATIONAL.has(group.kind) && count >= 2;
  const slot = conversational ? Math.floor(index / 2) : index;
  const slots = conversational ? Math.ceil(count / 2) : count;
  const spread = 0.55 + Math.sqrt(slots) * 0.42;
  const phase = unit(`${group.key}:phase`) * Math.PI * 2;
  const angle = phase + slot * GOLDEN_ANGLE;
  const radial = spread * Math.sqrt((slot + 0.6) / Math.max(1, slots)) * (0.78 + unit(`${person.id}:cluster`) * 0.4);
  let x = group.centerX + Math.cos(angle) * radial;
  let z = group.centerZ + Math.sin(angle) * radial;
  let restFacing: number | undefined;

  if (conversational) {
    // Pair members stand a step apart on a shared axis and turn to face one another.
    const partnerSide = index % 2 === 0 ? 1 : -1;
    const axis = unit(`${group.key}:${slot}:axis`) * Math.PI * 2;
    const separation = 0.24 + unit(`${group.key}:${slot}:gap`) * 0.1;
    x += Math.cos(axis) * separation * partnerSide;
    z += Math.sin(axis) * separation * partnerSide;
    restFacing = Math.atan2(-Math.cos(axis) * partnerSide, -Math.sin(axis) * partnerSide);
  } else if (FOCAL.has(group.kind)) {
    restFacing = Math.atan2(group.centerX - x, group.centerZ - z);
  }

  const blendedX = simPosition.x + (x - simPosition.x) * cohesion;
  const blendedZ = simPosition.z + (z - simPosition.z) * cohesion;
  const offsetX = blendedX - simPosition.x;
  const offsetZ = blendedZ - simPosition.z;
  const displacement = Math.hypot(offsetX, offsetZ);
  const limit = displacement > MAX_DISPLACEMENT ? MAX_DISPLACEMENT / displacement : 1;
  return {
    x: simPosition.x + offsetX * limit,
    z: simPosition.z + offsetZ * limit,
    ...(restFacing === undefined ? {} : { restFacing }),
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

function unit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
