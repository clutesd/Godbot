import type { Person, SimulationState, SocialRelationship, SocialRelationshipKind } from '../types';

const MAX_AFFINITIES = 4;
const MAX_NON_FAMILY_TIES = 7;
const SOCIAL_UPDATE_MONTHS = 3;
const SOCIAL_DESTINATIONS = new Set(['market', 'plaza', 'shrine', 'safe-area']);
const RELATION_PRIORITY: Record<SocialRelationshipKind, number> = {
  family: 9,
  mentor: 8,
  friend: 7,
  'political-ally': 6,
  'intellectual-collaborator': 6,
  colleague: 5,
  neighbor: 4,
  superior: 3,
  rival: 1,
};

interface SocialPerson extends Person {
  /** Presentation-only cache of the strongest current positive ties. Authoritative ties live on SimulationState. */
  socialAffinityIds?: string[];
}

/**
 * Maintains the small, persistent social graph behind represented people.
 *
 * This deliberately does not make political, migration, fertility, or economic decisions. Step 1 only records
 * relationships already implied by household/workplace life and repeated face-to-face contact, then exposes a
 * bounded list of strong ties for crowd presentation. Later systems may consume the authoritative graph.
 */
export function advanceSocialDynamics(state: SimulationState): void {
  // Social structure changes much more slowly than walking. Quarterly maintenance keeps the graph cheap enough
  // for deep-time runs while month 1 still establishes the starting households and work circles immediately.
  if (state.month > 1 && state.month % SOCIAL_UPDATE_MONTHS !== 0) return;

  const living = state.people.filter((person) => person.alive);
  const livingById = new Map(living.map((person) => [person.id, person]));
  const relationships = (state.socialRelationships ??= [])
    .filter((relationship) => livingById.has(relationship.a) && livingById.has(relationship.b));
  state.socialRelationships = relationships;

  const byPair = new Map<string, SocialRelationship>();
  for (const relationship of relationships) byPair.set(pairKey(relationship.a, relationship.b), relationship);

  const touch = (
    a: Person,
    b: Person,
    kind: SocialRelationshipKind,
    trustTarget: number,
    strengthGain: number,
  ): SocialRelationship | undefined => {
    if (a.id === b.id) return undefined;
    const [first, second] = orderedPair(a.id, b.id);
    const key = pairKey(first, second);
    const existing = byPair.get(key);
    if (existing) {
      if (RELATION_PRIORITY[kind] > RELATION_PRIORITY[existing.kind]) existing.kind = kind;
      existing.trust = clamp(existing.trust * 0.9 + trustTarget * 0.1);
      existing.strength = clamp(existing.strength + strengthGain);
      existing.lastContactMonth = state.month;
      return existing;
    }
    const relationship: SocialRelationship = {
      id: `social-${first}-${second}`,
      a: first,
      b: second,
      kind,
      trust: clamp(trustTarget),
      strength: clamp(Math.max(0.08, strengthGain)),
      formedMonth: state.month,
      lastContactMonth: state.month,
    };
    relationships.push(relationship);
    byPair.set(key, relationship);
    return relationship;
  };

  seedFamilyTies(living, touch);
  seedWorkplaceTies(living, touch);
  seedNeighborTies(living, touch);
  reinforceRepeatedContact(living, state.month, touch, byPair);

  const touchedThisMonth = new Set(relationships.filter((relationship) => relationship.lastContactMonth === state.month).map((relationship) => relationship.id));
  for (const relationship of relationships) {
    if (relationship.kind === 'family' || touchedThisMonth.has(relationship.id)) continue;
    const staleMonths = state.month - relationship.lastContactMonth;
    if (staleMonths > 12) relationship.strength = clamp(relationship.strength - 0.0035 * SOCIAL_UPDATE_MONTHS);
    if (staleMonths > 36) relationship.trust = clamp(relationship.trust - 0.0015 * SOCIAL_UPDATE_MONTHS);
  }

  state.socialRelationships = capAndPruneRelationships(relationships, state.month);
  assignPresentationAffinities(living, state.socialRelationships);
}

function seedFamilyTies(
  people: readonly Person[],
  touch: (a: Person, b: Person, kind: SocialRelationshipKind, trust: number, strength: number) => SocialRelationship | undefined,
): void {
  const byId = new Map(people.map((person) => [person.id, person]));
  const households = groupBy(people, (person) => `${person.homeId}:${person.householdId}`);

  for (const person of people) {
    if (person.partnerId) {
      const partner = byId.get(person.partnerId);
      if (partner) touch(person, partner, 'family', 0.82, 0.12);
    }
    for (const parentId of person.parents) {
      const parent = byId.get(parentId);
      if (parent) touch(person, parent, 'family', 0.84, 0.11);
    }
  }

  for (const members of households.values()) {
    const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 9);
    for (let a = 0; a < ordered.length; a += 1) {
      for (let b = a + 1; b < ordered.length; b += 1) {
        const left = ordered[a];
        const right = ordered[b];
        if (left && right) touch(left, right, 'family', 0.76, 0.055);
      }
    }
  }
}

function seedWorkplaceTies(
  people: readonly Person[],
  touch: (a: Person, b: Person, kind: SocialRelationshipKind, trust: number, strength: number) => SocialRelationship | undefined,
): void {
  const workers = people.filter((person) => person.workplaceId && person.role !== 'child' && person.role !== 'elder');
  const workplaces = groupBy(workers, (person) => `${person.homeId}:${person.workplaceId}`);
  for (const members of workplaces.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id));
    for (let index = 0; index < ordered.length; index += 1) {
      const person = ordered[index];
      const colleague = ordered[(index + 1) % ordered.length];
      if (person && colleague && person.id !== colleague.id) touch(person, colleague, 'colleague', 0.57, 0.035);
      if (ordered.length >= 6) {
        const second = ordered[(index + 2) % ordered.length];
        if (person && second && person.id !== second.id) touch(person, second, 'colleague', 0.54, 0.018);
      }
    }
  }
}

function seedNeighborTies(
  people: readonly Person[],
  touch: (a: Person, b: Person, kind: SocialRelationshipKind, trust: number, strength: number) => SocialRelationship | undefined,
): void {
  const homeNow = people.filter((person) => person.navigation?.destinationKind === 'home' && !person.navigation.traveling);
  const households = groupBy(homeNow, (person) => `${person.homeId}:${person.householdId}`);
  const anchors = [...households.entries()].map(([key, members]) => {
    const representative = [...members].sort((a, b) => adultScore(b) - adultScore(a) || a.id.localeCompare(b.id))[0];
    return {
      key,
      settlementId: representative?.homeId ?? '',
      representative,
      x: average(members.map((member) => member.position.x)),
      z: average(members.map((member) => member.position.z)),
    };
  }).filter((entry) => entry.representative);

  for (const anchor of anchors) {
    let nearest: typeof anchor | undefined;
    let nearestDistance = Infinity;
    for (const other of anchors) {
      if (other.key === anchor.key || other.settlementId !== anchor.settlementId) continue;
      const d = Math.hypot(anchor.x - other.x, anchor.z - other.z);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = other;
      }
    }
    if (nearest && nearestDistance <= 7.5 && anchor.representative && nearest.representative) {
      touch(anchor.representative, nearest.representative, 'neighbor', 0.5, 0.022);
    }
  }
}

function reinforceRepeatedContact(
  people: readonly Person[],
  month: number,
  touch: (a: Person, b: Person, kind: SocialRelationshipKind, trust: number, strength: number) => SocialRelationship | undefined,
  byPair: ReadonlyMap<string, SocialRelationship>,
): void {
  const social = people.filter((person) => {
    const navigation = person.navigation;
    return navigation && !navigation.traveling && SOCIAL_DESTINATIONS.has(navigation.destinationKind);
  });
  const gatherings = groupBy(social, (person) => `${person.homeId}:${person.navigation!.destinationId}`);

  for (const members of gatherings.values()) {
    if (members.length < 2) continue;
    const ordered = [...members]
      .sort((a, b) => stableUnit(`${month}:${a.id}`) - stableUnit(`${month}:${b.id}`) || a.id.localeCompare(b.id))
      .slice(0, 28);
    for (let index = 0; index + 1 < ordered.length; index += 2) {
      const a = ordered[index];
      const b = ordered[index + 1];
      if (!a || !b || a.householdId === b.householdId) continue;
      const existing = byPair.get(pairKey(a.id, b.id));
      if (existing) {
        touch(a, b, existing.kind, Math.max(0.5, existing.trust), existing.kind === 'friend' ? 0.065 : 0.028);
        continue;
      }
      if (compatibility(a, b) < 0.46) continue;
      // A first encounter is intentionally too weak to drive presentation. Repeated meetings make it visible.
      touch(a, b, 'friend', 0.54 + compatibility(a, b) * 0.12, 0.11);
    }
  }
}

function capAndPruneRelationships(relationships: readonly SocialRelationship[], month: number): SocialRelationship[] {
  const viable = relationships.filter((relationship) => {
    if (relationship.kind === 'family') return true;
    const staleMonths = month - relationship.lastContactMonth;
    return !(staleMonths > 72 && relationship.strength < 0.2) && relationship.strength >= 0.08;
  });
  const family = viable.filter((relationship) => relationship.kind === 'family');
  const ordinary = viable.filter((relationship) => relationship.kind !== 'family')
    .sort((a, b) => relationshipScore(b) - relationshipScore(a) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  const kept = [...family];
  for (const relationship of family) {
    counts.set(relationship.a, (counts.get(relationship.a) ?? 0) + 1);
    counts.set(relationship.b, (counts.get(relationship.b) ?? 0) + 1);
  }
  for (const relationship of ordinary) {
    const aCount = counts.get(relationship.a) ?? 0;
    const bCount = counts.get(relationship.b) ?? 0;
    if (aCount >= MAX_NON_FAMILY_TIES || bCount >= MAX_NON_FAMILY_TIES) continue;
    kept.push(relationship);
    counts.set(relationship.a, aCount + 1);
    counts.set(relationship.b, bCount + 1);
  }
  return kept.sort((a, b) => a.id.localeCompare(b.id));
}

function assignPresentationAffinities(people: readonly Person[], relationships: readonly SocialRelationship[]): void {
  const byPerson = new Map<string, Array<{ other: string; relationship: SocialRelationship }>>();
  for (const relationship of relationships) {
    if (relationship.kind === 'rival' || relationship.strength < 0.25) continue;
    const a = byPerson.get(relationship.a) ?? [];
    a.push({ other: relationship.b, relationship });
    byPerson.set(relationship.a, a);
    const b = byPerson.get(relationship.b) ?? [];
    b.push({ other: relationship.a, relationship });
    byPerson.set(relationship.b, b);
  }
  for (const person of people as readonly SocialPerson[]) {
    person.socialAffinityIds = (byPerson.get(person.id) ?? [])
      .sort((a, b) => relationshipScore(b.relationship) - relationshipScore(a.relationship) || a.other.localeCompare(b.other))
      .slice(0, MAX_AFFINITIES)
      .map((entry) => entry.other);
  }
}

function relationshipScore(relationship: SocialRelationship): number {
  const kindBonus = relationship.kind === 'family' ? 0.24
    : relationship.kind === 'friend' ? 0.16
      : relationship.kind === 'mentor' ? 0.13
        : relationship.kind === 'intellectual-collaborator' ? 0.1
          : relationship.kind === 'colleague' ? 0.06
            : relationship.kind === 'neighbor' ? 0.03
              : relationship.kind === 'rival' ? -0.2 : 0.04;
  return relationship.strength * 0.62 + relationship.trust * 0.38 + kindBonus;
}

function compatibility(a: Person, b: Person): number {
  return clamp(
    (a.traits.sociability + b.traits.sociability) * 0.18
    + (a.traits.cooperation + b.traits.cooperation) * 0.16
    + (a.traits.empathy + b.traits.empathy) * 0.11
    + (1 - Math.abs(a.traits.aggression - b.traits.aggression)) * 0.1
    + (a.cultureId === b.cultureId ? 0.09 : 0.03),
  );
}

function adultScore(person: Person): number {
  const age = person.ageMonths / 12;
  return age >= 18 && age <= 70 ? 2 : age >= 15 ? 1 : 0;
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function pairKey(a: string, b: string): string {
  const [first, second] = orderedPair(a, b);
  return `${first}|${second}`;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
