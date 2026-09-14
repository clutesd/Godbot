import type { Person, SimulationState, SocialRelationship, SocialRelationshipKind } from '../types';

const MAX_AFFINITIES = 4;
const MAX_AVOIDANCES = 3;
const MAX_NON_FAMILY_TIES = 7;
const SOCIAL_UPDATE_MONTHS = 12;
const SOCIAL_DESTINATIONS = new Set(['market', 'plaza', 'shrine', 'safe-area']);
const KNOWLEDGE_ROLES = new Set(['scholar', 'scientist', 'researcher', 'engineer', 'machinist', 'machine-systems-specialist']);
const LEADERSHIP_ROLES = new Set(['administrator', 'manager', 'priest', 'guard', 'soldier', 'merchant']);
const RELATION_PRIORITY: Record<SocialRelationshipKind, number> = {
  family: 100,
  mentor: 80,
  'political-ally': 70,
  'intellectual-collaborator': 65,
  rival: 60,
  superior: 55,
  friend: 50,
  colleague: 30,
  neighbor: 20,
};

interface SocialPerson extends Person {
  /** Presentation-only cache of the strongest current positive ties. Authoritative ties live on SimulationState. */
  socialAffinityIds?: string[];
  /** Presentation-only cache of strong rivalries so conversational crowds do not pair obvious antagonists. */
  socialAvoidIds?: string[];
}

export interface SocialInfluenceProfile {
  support: number;
  tension: number;
  learning: number;
  political: number;
  centrality: number;
  positiveTies: number;
  rivalTies: number;
  mentorTies: number;
  collaboratorTies: number;
  politicalTies: number;
}

/**
 * Summarises one person's social network without inventing any new state. Consumers can use this
 * as a bounded signal rather than repeatedly interpreting raw relationships in different ways.
 */
export function socialInfluenceFor(personId: string, relationships: readonly SocialRelationship[]): SocialInfluenceProfile {
  let support = 0;
  let tension = 0;
  let learning = 0;
  let political = 0;
  let positiveTies = 0;
  let rivalTies = 0;
  let mentorTies = 0;
  let collaboratorTies = 0;
  let politicalTies = 0;
  let degree = 0;

  for (const relationship of relationships) {
    if (relationship.a !== personId && relationship.b !== personId) continue;
    degree += 1;
    const quality = relationship.strength * (0.35 + relationship.trust * 0.65);
    switch (relationship.kind) {
      case 'family':
        support += quality * 0.95;
        political += quality * 0.18;
        positiveTies += 1;
        break;
      case 'friend':
        support += quality;
        positiveTies += 1;
        break;
      case 'mentor':
        support += quality * 0.82;
        if (relationship.teaching?.learnerId === personId) learning += quality * Math.min(1, relationship.teaching.progress * 5);
        mentorTies += 1;
        positiveTies += 1;
        break;
      case 'intellectual-collaborator':
        support += quality * 0.62;
        learning += quality * 0.9;
        collaboratorTies += 1;
        positiveTies += 1;
        break;
      case 'political-ally':
        support += quality * 0.7;
        political += quality;
        politicalTies += 1;
        positiveTies += 1;
        break;
      case 'superior':
        support += quality * 0.35;
        political += quality * 0.48;
        positiveTies += relationship.trust >= 0.45 ? 1 : 0;
        break;
      case 'colleague':
        support += quality * 0.42;
        positiveTies += relationship.trust >= 0.5 ? 1 : 0;
        break;
      case 'neighbor':
        support += quality * 0.32;
        positiveTies += relationship.trust >= 0.52 ? 1 : 0;
        break;
      case 'rival':
        tension += relationship.strength * (0.45 + (1 - relationship.trust) * 0.55);
        rivalTies += 1;
        break;
    }
  }

  return {
    support: clamp(support / 2.2),
    tension: clamp(tension / 1.4),
    learning: clamp(learning / 1.35),
    political: clamp(political / 1.4),
    centrality: clamp(degree / 8),
    positiveTies,
    rivalTies,
    mentorTies,
    collaboratorTies,
    politicalTies,
  };
}

/**
 * Maintains the small, persistent social graph behind represented people.
 *
 * Step 2 gives the Step 1 graph semantic depth: work, institutions and repeated contact can mature
 * into mentorships, collaborations, alliances and rivalries. Those relationships still remain
 * bounded and deterministic, but now exert a deliberately small prestige influence so social life
 * can matter to later leadership and historical selection without overpowering material conditions.
 */
const updatedMonth = new WeakMap<SimulationState, number>();
export function advanceSocialDynamics(state: SimulationState): void {
  if (updatedMonth.get(state) === state.month) return;
  // Social structure evolves on human timescales, not every walking tick. Annual maintenance keeps deep-time
  // runs cheap while month 1 still establishes the starting households and work circles immediately.
  if (state.month > 1 && state.month % SOCIAL_UPDATE_MONTHS !== 0) return;

  updatedMonth.set(state, state.month);
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
      if (kind === 'family') existing.kind = 'family';
      else if (kind === 'rival' && existing.kind !== 'family' && existing.kind !== 'mentor') existing.kind = 'rival';
      else if (existing.kind !== 'rival' && RELATION_PRIORITY[kind] > RELATION_PRIORITY[existing.kind]) existing.kind = kind;
      existing.trust = clamp(existing.trust * 0.88 + trustTarget * 0.12);
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
  seedInstitutionTies(living, state, touch);
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
  assignPresentationSignals(living, state.socialRelationships);
  applyBoundedSocialEffects(living, state.socialRelationships);
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
      if (person && colleague && person.id !== colleague.id) {
        const tie = workplaceTie(person, colleague);
        touch(person, colleague, tie.kind, tie.trust, tie.gain);
      }
      if (ordered.length >= 6) {
        const second = ordered[(index + 2) % ordered.length];
        if (person && second && person.id !== second.id) {
          const tie = workplaceTie(person, second, true);
          touch(person, second, tie.kind, tie.trust, tie.gain);
        }
      }
    }
  }
}

function seedInstitutionTies(
  people: readonly Person[],
  state: SimulationState,
  touch: (a: Person, b: Person, kind: SocialRelationshipKind, trust: number, strength: number) => SocialRelationship | undefined,
): void {
  const members = people.filter((person) => person.institutionId);
  const groups = groupBy(members, (person) => person.institutionId ?? '');
  const institutionById = new Map(state.institutions.map((institution) => [institution.id, institution]));

  for (const [institutionId, institutionPeople] of groups) {
    if (institutionPeople.length < 2) continue;
    const institution = institutionById.get(institutionId);
    if (!institution) continue;
    const ordered = [...institutionPeople].sort((a, b) => a.id.localeCompare(b.id));
    for (let index = 0; index < ordered.length; index += 1) {
      const a = ordered[index];
      const b = ordered[(index + 1) % ordered.length];
      if (!a || !b || a.id === b.id || a.householdId === b.householdId) continue;
      if (rivalryPotential(a, b) > 0.72) {
        touch(a, b, 'rival', 0.3, 0.045);
        continue;
      }
      if (institution.kind === 'knowledge-keepers') {
        touch(a, b, 'intellectual-collaborator', 0.69, 0.052);
      } else if (institution.kind === 'council' || institution.kind === 'merchant-association' || institution.kind === 'military-order') {
        touch(a, b, 'political-ally', 0.64, 0.045);
      } else if (mentorshipPair(a, b)) {
        touch(a, b, 'mentor', 0.68, 0.04);
      } else {
        touch(a, b, 'colleague', 0.58, 0.028);
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
      const rivalry = rivalryPotential(a, b);
      if (existing) {
        if (existing.kind !== 'family' && existing.kind !== 'mentor' && rivalry > 0.76) {
          touch(a, b, 'rival', 0.28, 0.052);
        } else if (existing.kind === 'rival') {
          touch(a, b, 'rival', 0.3, 0.035);
        } else {
          touch(a, b, existing.kind, Math.max(0.5, existing.trust), existing.kind === 'friend' ? 0.065 : 0.028);
        }
        continue;
      }
      if (rivalry > 0.68) {
        touch(a, b, 'rival', 0.3, 0.11);
        continue;
      }
      if (compatibility(a, b) < 0.46) continue;
      // A first encounter is intentionally too weak to drive presentation. Repeated meetings make it visible.
      touch(a, b, 'friend', 0.54 + compatibility(a, b) * 0.12, 0.11);
    }
  }
}

function workplaceTie(a: Person, b: Person, secondary = false): { kind: SocialRelationshipKind; trust: number; gain: number } {
  const gainScale = secondary ? 0.62 : 1;
  if (rivalryPotential(a, b) > 0.74) return { kind: 'rival', trust: 0.3, gain: 0.04 * gainScale };
  if (mentorshipPair(a, b)) return { kind: 'mentor', trust: 0.68, gain: 0.038 * gainScale };
  if (a.role && b.role && KNOWLEDGE_ROLES.has(a.role) && KNOWLEDGE_ROLES.has(b.role)) {
    return { kind: 'intellectual-collaborator', trust: 0.66, gain: 0.038 * gainScale };
  }
  if ((a.role && LEADERSHIP_ROLES.has(a.role)) !== Boolean(b.role && LEADERSHIP_ROLES.has(b.role))) {
    return { kind: 'superior', trust: 0.54, gain: 0.028 * gainScale };
  }
  return { kind: 'colleague', trust: 0.57, gain: 0.035 * gainScale };
}

function mentorshipPair(a: Person, b: Person): boolean {
  const older = a.ageMonths >= b.ageMonths ? a : b;
  const younger = older === a ? b : a;
  const gapYears = (older.ageMonths - younger.ageMonths) / 12;
  if (gapYears < 8 || younger.ageMonths < 16 * 12) return false;
  const skilled = Boolean(older.role && (KNOWLEDGE_ROLES.has(older.role) || ['builder', 'craft-worker', 'healer', 'priest', 'merchant'].includes(older.role)));
  return skilled && older.traits.cooperation + older.traits.conscientiousness > 1.05;
}

function rivalryPotential(a: Person, b: Person): number {
  const competitive = (a.traits.ambition + b.traits.ambition) * 0.2 + (a.traits.aggression + b.traits.aggression) * 0.18;
  const lowCooperation = (2 - a.traits.cooperation - b.traits.cooperation) * 0.14;
  const statusCompetition = a.workplaceId && a.workplaceId === b.workplaceId ? 0.08 : 0;
  const roleCompetition = a.role && b.role && a.role === b.role ? 0.06 : 0;
  return clamp(competitive + lowCooperation + statusCompetition + roleCompetition - compatibility(a, b) * 0.18);
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
  const nonFamilyCounts = new Map<string, number>();
  const kept = [...family];
  for (const relationship of ordinary) {
    const aCount = nonFamilyCounts.get(relationship.a) ?? 0;
    const bCount = nonFamilyCounts.get(relationship.b) ?? 0;
    if (aCount >= MAX_NON_FAMILY_TIES || bCount >= MAX_NON_FAMILY_TIES) continue;
    kept.push(relationship);
    nonFamilyCounts.set(relationship.a, aCount + 1);
    nonFamilyCounts.set(relationship.b, bCount + 1);
  }
  return kept.sort((a, b) => a.id.localeCompare(b.id));
}

function assignPresentationSignals(people: readonly Person[], relationships: readonly SocialRelationship[]): void {
  const affinities = new Map<string, Array<{ other: string; relationship: SocialRelationship }>>();
  const avoidances = new Map<string, Array<{ other: string; relationship: SocialRelationship }>>();
  for (const relationship of relationships) {
    if (relationship.kind === 'rival') {
      if (relationship.strength < 0.16) continue;
      const a = avoidances.get(relationship.a) ?? [];
      a.push({ other: relationship.b, relationship });
      avoidances.set(relationship.a, a);
      const b = avoidances.get(relationship.b) ?? [];
      b.push({ other: relationship.a, relationship });
      avoidances.set(relationship.b, b);
      continue;
    }
    if (relationship.strength < 0.25) continue;
    const a = affinities.get(relationship.a) ?? [];
    a.push({ other: relationship.b, relationship });
    affinities.set(relationship.a, a);
    const b = affinities.get(relationship.b) ?? [];
    b.push({ other: relationship.a, relationship });
    affinities.set(relationship.b, b);
  }
  for (const person of people as readonly SocialPerson[]) {
    person.socialAffinityIds = (affinities.get(person.id) ?? [])
      .sort((a, b) => relationshipScore(b.relationship) - relationshipScore(a.relationship) || a.other.localeCompare(b.other))
      .slice(0, MAX_AFFINITIES)
      .map((entry) => entry.other);
    person.socialAvoidIds = (avoidances.get(person.id) ?? [])
      .sort((a, b) => b.relationship.strength - a.relationship.strength || a.other.localeCompare(b.other))
      .slice(0, MAX_AVOIDANCES)
      .map((entry) => entry.other);
  }
}

function applyBoundedSocialEffects(people: readonly Person[], relationships: readonly SocialRelationship[]): void {
  const adjacency = new Map<string, SocialRelationship[]>();
  for (const r of relationships) for (const id of [r.a, r.b]) { const edges = adjacency.get(id) ?? []; edges.push(r); adjacency.set(id, edges); }
  for (const person of people) {
    const influence = socialInfluenceFor(person.id, adjacency.get(person.id) ?? []);
    if (influence.centrality <= 0) continue;
    const networkTarget = clamp(
      0.13
      + influence.support * 0.3
      + influence.political * 0.24
      + influence.learning * 0.12
      + influence.centrality * 0.07
      - influence.tension * 0.18,
    );
    const adjustment = clampRange((networkTarget - person.prestige) * 0.04, -0.01, 0.012);
    person.prestige = clamp(person.prestige + adjustment);
  }
}

function relationshipScore(relationship: SocialRelationship): number {
  const kindBonus = relationship.kind === 'family' ? 0.24
    : relationship.kind === 'mentor' ? 0.18
      : relationship.kind === 'political-ally' ? 0.17
        : relationship.kind === 'intellectual-collaborator' ? 0.15
          : relationship.kind === 'friend' ? 0.14
            : relationship.kind === 'superior' ? 0.07
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

function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
