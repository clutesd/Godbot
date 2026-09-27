import { foundingHearthEstablished, foundingHearthWorldPosition } from '../../shared/FoundingCampLayout';
import type { Activity, DestinationKind, Person, SchedulePhase, Settlement, SimulationState, Vec2 } from '../types';

export interface FoundingCommunityDestination {
  kind: DestinationKind;
  phase: SchedulePhase;
  activity: Activity;
  reason: string;
  destinationId: string;
  point: Vec2;
}

export function isFoundingCommunityDestinationId(destinationId: string | undefined): boolean {
  return Boolean(destinationId?.includes(':founding-'));
}

export type FoundingCommunityChore =
  | 'shelter-support'
  | 'supply-yard'
  | 'hearth-support'
  | 'camp-edge'
  | 'household-prep'
  | 'children-nearby';

/**
 * A founding camp stops using this presentation grammar once it has several completed structures
 * and no survival shelter still rising. This is deliberately based on physical maturity rather
 * than an elapsed-month timer.
 */
export function foundingCommunityIsForming(settlement: Settlement): boolean {
  if (!settlement.alive || !settlement.foundingPodId) return false;
  const activeFoundingShelter = Boolean(settlement.development?.project?.response.adaptation);
  const completed = (settlement.structurePlots ?? [])
    .filter(plot => plot.development?.status === 'active')
    .length;
  return activeFoundingShelter || completed < 3;
}

/**
 * Ordinary roles should not pretend a brand-new landing already has markets, offices and workshops.
 * This returns a grounded camp-life destination for people who are not currently authoritative
 * builders, resource workers or the survival-fire tender. It changes no economic output.
 */
export function foundingCommunityDestination(
  person: Person,
  settlement: Settlement,
  state: SimulationState,
  shiftedHour: number,
): FoundingCommunityDestination | undefined {
  if (!foundingCommunityIsForming(settlement) || person.activity === 'migrate') return undefined;

  const pod = state.arrival?.pods.find(candidate => candidate.id === settlement.foundingPodId && candidate.landed);
  const projectPlot = settlement.development?.project
    ? settlement.structurePlots?.find(plot => plot.id === settlement.development?.project?.plotId)
    : undefined;
  const firstUsable = settlement.structurePlots?.find(plot => plot.development?.status === 'active');
  const shelter = projectPlot ?? firstUsable;
  const hearth = foundingHearthWorldPosition(settlement, state.arrival?.pods ?? []);
  const campCenter = hearth ?? shelter
    ? {
      x: ((hearth?.x ?? shelter!.worldX) + settlement.position.x) / 2,
      z: ((hearth?.z ?? shelter!.worldZ) + settlement.position.z) / 2,
    }
    : { ...settlement.position };

  if (person.occupation === 'child' || person.role === 'child') {
    if (shiftedHour < 8 || shiftedHour >= 19) return undefined;
    return {
      kind: 'plaza',
      phase: shiftedHour < 16 ? 'social' : 'meal',
      activity: 'socialize',
      reason: 'staying near the occupied camp while the adults establish it',
      destinationId: `${settlement.id}:founding-children`,
      point: ringPoint(campCenter, `${person.id}:founding-children`, 1.15, 0.38),
    };
  }

  if (shiftedHour >= 19) {
    const ritual = ['priest', 'ritual-specialist'].includes(person.role ?? '')
      || (state.month + Math.floor(stableUnit(person.id) * 4)) % 5 === 0;
    if (!ritual) return undefined;
    const ritualAnchor = hearth ?? campCenter;
    return {
      kind: 'plaza',
      phase: 'ritual',
      activity: 'worship',
      reason: foundingHearthEstablished(settlement)
        ? 'joining a quiet evening observance beside the communal hearth'
        : 'joining a quiet evening observance in the new camp',
      destinationId: `${settlement.id}:founding-evening-circle`,
      point: ringPoint(ritualAnchor, `${person.id}:founding-evening`, 0.82, 0.2),
    };
  }

  if (shiftedHour >= 16) {
    const mealAnchor = hearth ?? campCenter;
    return {
      kind: 'plaza',
      phase: 'meal',
      activity: 'socialize',
      reason: foundingHearthEstablished(settlement)
        ? 'sharing the evening meal around the camp hearth'
        : 'sharing the evening meal in the occupied camp',
      destinationId: `${settlement.id}:founding-meal`,
      point: ringPoint(mealAnchor, `${person.id}:founding-meal`, 0.9, 0.32),
    };
  }

  const chore = foundingCommunityChore(person, settlement, state);
  const work = choreDestination(chore, person, settlement, state, pod?.position, shelter
    ? { x: shelter.worldX, z: shelter.worldZ }
    : undefined, hearth, campCenter);
  if (!work) return undefined;
  if (shiftedHour < 8) {
    return {
      ...work,
      phase: 'commute',
      activity: 'travel',
      reason: `heading out to ${work.reason.replace(/^helping |^organizing |^checking |^preparing /, '')}`,
    };
  }
  return { ...work, phase: 'work' };
}

export function foundingCommunityChore(person: Person, settlement: Settlement, state: SimulationState): FoundingCommunityChore {
  if (['soldier', 'guard'].includes(person.role ?? '')) return 'camp-edge';
  const project = settlement.development?.project;
  const hasHearth = foundingHearthEstablished(settlement);
  const draw = stableUnit(`${state.seed}:${state.month}:${settlement.id}:${person.id}:founding-chore`);

  if (project?.response.adaptation && ['builder', 'carrier', 'artisan', 'keeper'].includes(person.occupation) && draw < 0.48) {
    return 'shelter-support';
  }
  if (hasHearth && ['keeper', 'carrier', 'elder'].includes(person.occupation) && draw < 0.62) return 'hearth-support';
  if (['artisan', 'carrier', 'keeper'].includes(person.occupation) || draw < 0.34) return 'supply-yard';
  if (['forager', 'farmer'].includes(person.occupation) || draw < 0.68) return 'camp-edge';
  return 'household-prep';
}

function choreDestination(
  chore: FoundingCommunityChore,
  person: Person,
  settlement: Settlement,
  state: SimulationState,
  pod: Vec2 | undefined,
  shelter: Vec2 | undefined,
  hearth: Vec2 | undefined,
  campCenter: Vec2,
): Omit<FoundingCommunityDestination, 'phase'> | undefined {
  switch (chore) {
    case 'shelter-support': {
      const anchor = shelter ?? campCenter;
      return {
        kind: 'construction-site',
        activity: 'assist',
        reason: 'helping stage already-delivered material beside the active shelter',
        destinationId: `${settlement.id}:founding-shelter-support`,
        point: ringPoint(anchor, `${person.id}:shelter-support`, 0.95, 0.18),
      };
    }
    case 'hearth-support': {
      const anchor = hearth ?? campCenter;
      return {
        kind: 'plaza',
        activity: 'assist',
        reason: 'organizing cookware, bedding and shared goods around the established hearth',
        destinationId: `${settlement.id}:founding-hearth-support`,
        point: ringPoint(anchor, `${person.id}:hearth-support`, 0.92, 0.2),
      };
    }
    case 'supply-yard': {
      const anchor = foundingCommunitySupplyAnchor(settlement, state, shelter);
      return {
        kind: 'warehouse',
        activity: person.occupation === 'artisan' ? 'craft' : 'assist',
        reason: 'organizing landed supplies and tools for the new camp',
        destinationId: `${settlement.id}:founding-supply-yard`,
        point: ringPoint(anchor, `${person.id}:supply-yard`, 0.5, 0.18),
      };
    }
    case 'camp-edge': {
      const radius = 2.5 + stableUnit(`${settlement.id}:camp-edge-radius`) * 0.6;
      return {
        kind: 'safe-area',
        activity: ['soldier', 'guard'].includes(person.role ?? '') ? 'patrol' : 'assist',
        reason: ['soldier', 'guard'].includes(person.role ?? '')
          ? 'walking the occupied camp perimeter'
          : 'checking paths, drying space and the occupied edge of camp',
        destinationId: `${settlement.id}:founding-camp-edge`,
        point: ringPoint(settlement.position, `${person.id}:camp-edge`, radius, 0.55),
      };
    }
    case 'household-prep': {
      const anchor = shelter ?? campCenter;
      return {
        kind: 'home',
        activity: 'assist',
        reason: 'preparing sleeping space and shared household goods away from the landing vessel',
        destinationId: `${settlement.id}:founding-household-prep`,
        point: ringPoint(anchor, `${person.id}:household-prep`, 1.25, 0.25),
      };
    }
    case 'children-nearby':
      return undefined;
  }
}

export function foundingCommunitySupplyAnchor(
  settlement: Settlement,
  state: SimulationState,
  knownShelter?: Vec2,
): Vec2 {
  const pod = state.arrival?.pods.find(candidate => candidate.id === settlement.foundingPodId && candidate.landed);
  const projectPlot = settlement.development?.project
    ? settlement.structurePlots?.find(plot => plot.id === settlement.development?.project?.plotId)
    : undefined;
  const firstUsable = settlement.structurePlots?.find(plot => plot.development?.status === 'active');
  const shelter = knownShelter ?? (projectPlot ?? firstUsable
    ? { x: (projectPlot ?? firstUsable)!.worldX, z: (projectPlot ?? firstUsable)!.worldZ }
    : undefined);
  return supplyAnchor(settlement, pod?.position, shelter, state.seed);
}

function supplyAnchor(
  settlement: Settlement,
  pod: Vec2 | undefined,
  shelter: Vec2 | undefined,
  seed: string,
): Vec2 {
  const target = shelter ?? settlement.position;
  if (!pod) return ringPoint(settlement.position, `${seed}:${settlement.id}:supply-anchor`, 1.45, 0);
  const dx = target.x - pod.x;
  const dz = target.z - pod.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const ux = dx / length;
  const uz = dz / length;
  const side = stableUnit(`${seed}:${settlement.id}:supply-side`) < 0.5 ? -1 : 1;
  return {
    x: pod.x + ux * 1.45 - uz * 0.72 * side,
    z: pod.z + uz * 1.45 + ux * 0.72 * side,
  };
}

function ringPoint(anchor: Vec2, key: string, radius: number, jitter: number): Vec2 {
  const angle = stableUnit(`${key}:angle`) * Math.PI * 2;
  const r = radius + (stableUnit(`${key}:radius`) - 0.5) * jitter;
  return { x: anchor.x + Math.cos(angle) * r, z: anchor.z + Math.sin(angle) * r };
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
