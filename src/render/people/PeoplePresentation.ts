import type { DestinationKind, Person, Vec2 } from '../../sim/types';
import { memoryInfluenceFor, socialWithdrawalFor } from '../../sim/people/PersonalMemorySystem';
import { resourceWorkVisualKindFromDestinationId } from '../../sim/people/ResourceWorkRouting';
import type { AnimationState } from '../animation/AnimationController';
import { RUN_SPEED_THRESHOLD, WALK_SPEED_THRESHOLD } from './PeopleVisualState';

/**
 * PeoplePresentation.ts
 *
 * Presentation-only reading of simulation state: who belongs to which visible gathering, where a
 * character safely arrives within it, how much individuality it earns, and which animation its
 * visual travel implies. Group placement is a stable anchor, not a permanent standing slot;
 * LocalActivityPresentation supplies bounded social/work choreography around it. Nothing here
 * changes simulation authority.
 */

export type VisualTier = 'population' | 'notable' | 'historical';
export type HumanStoryCue = 'ordinary' | 'bereaved' | 'survivor' | 'migrant' | 'legacy' | 'accomplished';

type SocialPerson = Person & { socialAffinityIds?: string[]; socialAvoidIds?: string[] };

/** How strongly members of a gathering are drawn toward its occupancy geometry, by destination. */
const COHESION: Partial<Record<DestinationKind, number>> = {
  market: 0.89,
  plaza: 0.91,
  shrine: 0.88,
  'memorial-site': 0.84,
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
const FOCAL = new Set<DestinationKind>(['shrine', 'memorial-site', 'construction-site']);
const LINEAR = new Set<DestinationKind>(['dock', 'station', 'patrol-route']);
const WORK_GRID = new Set<DestinationKind>([
  'field', 'workshop', 'construction-site', 'warehouse', 'industrial-site', 'knowledge-institution', 'civic-building',
]);

/** A visual gathering never drags a character far from the authoritative simulation position. */
const MAX_DISPLACEMENT = 1.6;
const GOLDEN_ANGLE = 2.39996323;

export type SocialPodKind = 'adult' | 'children' | 'mixed';

export interface SocialPod {
  id: string;
  index: number;
  members: string[];
  kind: SocialPodKind;
  center?: Vec2;
}

export interface SocialGroup {
  key: string;
  kind: DestinationKind;
  centerX: number;
  centerZ: number;
  /** Deterministic social order: close ties are adjacent when possible, then stable id order. */
  members: string[];
  /** Conversational destinations expose the same pod contract to placement and choreography. */
  pods?: SocialPod[];
}

export interface GroupPlacement {
  x: number;
  z: number;
  /** Facing to hold while stationary — toward a focal point or a conversation partner. */
  restFacing?: number;
  /** Shared conversational geometry, used by local choreography instead of rediscovering neighbours. */
  podId?: string;
  podCenter?: Vec2;
  podKind?: SocialPodKind;
}

/** People who are travelling keep their own route; only settled attendants form gatherings. */
export function groupKeyFor(person: Person): string | undefined {
  const navigation = person.navigation;
  if (!person.alive || !navigation || navigation.traveling || navigation.schedulePhase === 'emergency') return undefined;
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
    if (CONVERSATIONAL.has(group.kind) && group.members.length >= 2) {
      group.pods = buildConversationalPods(group, peopleById);
    }
  }
  return groups;
}

/**
 * Gives one member of a gathering a destination-specific arrival/safety anchor. Markets resolve
 * into conversational pods, shrines into audience arcs, docks/patrols into lanes, work sites into
 * loose grids, and homes into compact household groups. The anchor must not become a mannequin slot:
 * local presentation is expected to move around it over real seconds. Recent grief/adversity produces a restrained
 * presentation-only tendency to stand slightly outside the social centre. The simulation position
 * stays authoritative and every displacement remains tightly bounded.
 */
export function placeInGroup(person: Person, group: SocialGroup | undefined, simPosition: Vec2): GroupPlacement {
  if (!group) return { x: simPosition.x, z: simPosition.z };
  const index = group.members.indexOf(person.id);
  if (index < 0) return { x: simPosition.x, z: simPosition.z };

  const target = occupancyPlacement(group, index);
  const withdrawal = socialWithdrawalFor(person);
  const baseCohesion = COHESION[group.kind] ?? 0.3;
  const podCohesion = target.podKind === 'children' ? Math.min(0.96, baseCohesion + 0.05) : baseCohesion;
  const cohesion = podCohesion * (1 - withdrawal * (CONVERSATIONAL.has(group.kind) ? 0.34 : 0.16));
  let targetX = target.x;
  let targetZ = target.z;
  if (withdrawal > 0.05 && group.members.length > 2 && (CONVERSATIONAL.has(group.kind) || group.kind === 'shrine' || group.kind === 'home')) {
    let outwardX = target.x - group.centerX;
    let outwardZ = target.z - group.centerZ;
    const outwardLength = Math.hypot(outwardX, outwardZ) || 1;
    outwardX /= outwardLength;
    outwardZ /= outwardLength;
    targetX += outwardX * Math.min(0.34, withdrawal * 0.38);
    targetZ += outwardZ * Math.min(0.34, withdrawal * 0.38);
  }
  const blendedX = simPosition.x + (targetX - simPosition.x) * cohesion;
  const blendedZ = simPosition.z + (targetZ - simPosition.z) * cohesion;
  const offsetX = blendedX - simPosition.x;
  const offsetZ = blendedZ - simPosition.z;
  const displacement = Math.hypot(offsetX, offsetZ);
  const limit = displacement > MAX_DISPLACEMENT ? MAX_DISPLACEMENT / displacement : 1;
  const x = simPosition.x + offsetX * limit;
  const z = simPosition.z + offsetZ * limit;
  const restFacing = target.podCenter
    ? Math.atan2(target.podCenter.x - x, target.podCenter.z - z)
    : target.restFacing;
  return {
    x,
    z,
    ...(restFacing === undefined ? {} : { restFacing }),
    ...(target.podId === undefined ? {} : { podId: target.podId }),
    ...(target.podCenter === undefined ? {} : { podCenter: { ...target.podCenter } }),
    ...(target.podKind === undefined ? {} : { podKind: target.podKind }),
  };
}

export function visualTierFor(person: Person): VisualTier {
  const status = person.historical?.status;
  return status === 'historical' ? 'historical' : status === 'notable' ? 'notable' : 'population';
}

/**
 * Read-only storytelling cue for renderers/camera/debug UI. It never invents state; it only reduces
 * the bounded memory profile to one dominant visual interpretation.
 */
export function humanStoryCueFor(person: Person): HumanStoryCue {
  const memory = memoryInfluenceFor(person);
  if (memory.recentShock > 0.35 || memory.grief > 0.5) return 'bereaved';
  if (memory.adversity > 0.5) return 'survivor';
  if (memory.displacement > 0.5) return 'migrant';
  if (memory.legacy > 0.48) return 'legacy';
  if (memory.achievement > 0.5 || person.expertise?.some(e => e.competence >= 0.7)) return 'accomplished';
  return 'ordinary';
}

/**
 * Visual travel wins over the logical activity: a character that is plainly moving must not play a
 * stationary work loop. Once a resource worker is stationary, the documentary destination may
 * specialize the pose without changing the simulation-level `gather` activity established in 1B.
 */
export function travelAnimationFor(speed: number, person: Person): AnimationState | undefined {
  if (speed < WALK_SPEED_THRESHOLD) {
    if (person.navigation?.traveling || ['patrol', 'travel', 'migrate', 'flee'].includes(person.activity)) return 'idle';
    if (person.activity !== 'gather') return undefined;
    if (person.navigation?.schedulePhase === 'emergency' || person.displacedSinceMonth !== undefined) return undefined;
    const resourceKind = resourceWorkVisualKindFromDestinationId(person.navigation?.destinationId);
    if (resourceKind === 'timber') return 'build';
    if (resourceKind === 'mineral') return 'work';
    if (resourceKind === 'plant' || resourceKind === 'generic') return 'gather';
    return undefined;
  }
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
  const id = group.members[index]!;
  const pod = conversationPodFor(group, id);
  if (!pod) return radialCluster(group, index, phase);
  const localIndex = pod.members.indexOf(id);
  const center = conversationPodCenter(group, pod);
  const axis = phase + pod.index * GOLDEN_ANGLE + (unit(`${pod.id}:axis`) - 0.5) * 0.7;
  const size = pod.members.length;
  // Children need visible running room; adult pods stay intimate. Mixed pods sit between the two.
  const memberRadius = pod.kind === 'children'
    ? (size === 2 ? 0.39 : size === 3 ? 0.44 : 0.48)
    : pod.kind === 'mixed'
      ? (size === 2 ? 0.34 : size === 3 ? 0.38 : 0.42)
      : (size === 2 ? 0.31 : size === 3 ? 0.34 : 0.38);
  const memberAngle = axis + localIndex / Math.max(1, size) * Math.PI * 2;
  const x = center.x + Math.cos(memberAngle) * memberRadius;
  const z = center.z + Math.sin(memberAngle) * memberRadius;
  return {
    x,
    z,
    restFacing: Math.atan2(center.x - x, center.z - z),
    podId: pod.id,
    podCenter: center,
    podKind: pod.kind,
  };
}

export function conversationPodFor(group: SocialGroup | undefined, personId: string): SocialPod | undefined {
  return group?.pods?.find(pod => pod.members.includes(personId));
}

export function conversationPodCenter(group: SocialGroup, pod: SocialPod): Vec2 {
  if (pod.center) return { ...pod.center };
  const phase = unit(`${group.key}:phase`) * Math.PI * 2;
  const podCount = Math.max(1, group.pods?.length ?? 1);
  const angle = phase + pod.index * GOLDEN_ANGLE;
  const centerRadius = podCount <= 1 ? 0.12
    : 0.46 + Math.sqrt(podCount) * 0.2 + Math.sqrt((pod.index + 0.5) / podCount) * 0.22;
  return {
    x: group.centerX + Math.cos(angle) * centerRadius,
    z: group.centerZ + Math.sin(angle) * centerRadius,
  };
}

function buildConversationalPods(group: SocialGroup, peopleById: ReadonlyMap<string, SocialPerson>): SocialPod[] {
  const remaining = new Set(group.members);
  const pods: SocialPod[] = [];
  while (remaining.size) {
    const seed = remaining.values().next().value!;
    const members = [seed];
    remaining.delete(seed);
    const desired = conversationalPodSizes(remaining.size + 1)[0]!;
    while (members.length < desired && remaining.size) {
      const candidates = [...remaining].filter(id => members.every(member => {
        const a = peopleById.get(member)!, b = peopleById.get(id)!;
        return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= 2.4
          && !a.socialAvoidIds?.includes(id) && !b.socialAvoidIds?.includes(member);
      }));
      const score = (id: string) => members.reduce((sum, member) => {
        const a = peopleById.get(member)!, b = peopleById.get(id)!;
        return sum + (a.socialAffinityIds?.includes(id) || b.socialAffinityIds?.includes(member) ? 5 : 0)
          + (a.householdId === b.householdId ? 2 : 0)
          + (isChildPerson(a) === isChildPerson(b) ? 1 : 0)
          - Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      }, 0);
      candidates.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
      if (!candidates.length) break;
      members.push(candidates[0]!); remaining.delete(candidates[0]!);
    }
    const childCount = members.filter(id => isChildPerson(peopleById.get(id))).length;
    const kind: SocialPodKind = childCount === members.length ? 'children' : childCount === 0 ? 'adult' : 'mixed';
    const center = members.reduce((at, id) => {
      const position = peopleById.get(id)!.position;
      return { x: at.x + position.x / members.length, z: at.z + position.z / members.length };
    }, { x: 0, z: 0 });
    pods.push({ id: `${group.key}:pod:${seed}`, index: pods.length, members, kind, center });
  }
  // Co-located arrivals still need separate conversational space.
  for (const pod of pods) {
    if (pods.some(other => other !== pod && Math.hypot(other.center!.x - pod.center!.x, other.center!.z - pod.center!.z) < 0.6)) {
      const angle = unit(`${pod.id}:space`) * Math.PI * 2;
      pod.center!.x += Math.cos(angle) * 0.55;
      pod.center!.z += Math.sin(angle) * 0.55;
    }
  }
  return pods;
}

function isChildPerson(person: Person | undefined): boolean {
  return Boolean(person && person.ageMonths < 15 * 12 && (person.occupation === 'child' || person.role === 'child'));
}

/** Prefer readable 3-person pods, using pairs or fours only to avoid isolated singletons. */
function conversationalPodSizes(count: number): number[] {
  if (count <= 1) return [count];
  if (count <= 4) return [count];
  const sizes: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining === 2 || remaining === 3 || remaining === 4) {
      sizes.push(remaining);
      break;
    }
    if (remaining === 5) {
      sizes.push(3, 2);
      break;
    }
    if (remaining === 7) {
      sizes.push(4, 3);
      break;
    }
    sizes.push(3);
    remaining -= 3;
  }
  return sizes;
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
            : person && CONVERSATIONAL.has(kind) && person.occupation === 'child' && a?.occupation === 'child' ? 18
              : person && isWorkDestination(kind) && a?.workplaceId === person.workplaceId ? 20 : 100;
      const bRank = bAvoided ? 1000
        : bAffinity >= 0 ? bAffinity
          : person && b?.householdId === person.householdId ? 10
            : person && CONVERSATIONAL.has(kind) && person.occupation === 'child' && b?.occupation === 'child' ? 18
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
