import type { Person, SimulationState, Vec2 } from '../../sim/types';

export type FirstFirePhase = 'kindle' | 'catch' | 'gather' | 'settle' | 'complete';
export type FirstFireParticipantRole = 'tender' | 'witness';

export const FIRST_FIRE_DURATION_SECONDS = 9.5;

export interface FirstFireVisualSample {
  active: boolean;
  phase: FirstFirePhase;
  phaseProgress: number;
  flameScale: number;
  emberScale: number;
  lightGain: number;
  smokeGain: number;
}

export interface FirstFireStagingTarget extends Vec2 {
  readonly eventId: string;
  readonly role: FirstFireParticipantRole;
  readonly animation: 'gather' | 'converse-warm';
  readonly restFacing: number;
  readonly phaseProgress: number;
}

interface Participant {
  personId: string;
  role: FirstFireParticipantRole;
  delay: number;
  radius: number;
  angleJitter: number;
}

interface ActiveFirstFire {
  settlementId: string;
  eventId: string;
  startedAt: number;
  participants: Participant[];
}

/**
 * Presentation-only performance for a simulation-authored first-fire milestone.
 *
 * Existing first-fire records are treated as already presented when this object is created, so a
 * reload/revisit never replays the ceremony. A first-fire record that appears while the renderer is
 * alive gets one real-time performance driven by HumanLifeClock.
 */
export class FoundingFirstFirePresentation {
  private readonly knownEventBySettlement = new Map<string, string>();
  private readonly active = new Map<string, ActiveFirstFire>();
  private nowSeconds = 0;
  /** Prevents simultaneous same-tick milestones from reading as a synchronized scripted cue. */
  private nextAvailableStartSeconds = 0;

  constructor(state: Pick<SimulationState, 'settlements'>) {
    for (const settlement of state.settlements) {
      const eventId = settlement.survival?.firstFire?.eventId;
      if (eventId) this.knownEventBySettlement.set(settlement.id, eventId);
    }
  }

  update(state: Pick<SimulationState, 'settlements' | 'people'>, elapsedSeconds: number): void {
    this.nowSeconds = Math.max(0, elapsedSeconds);
    const pending = state.settlements.filter(settlement => {
      const eventId = settlement.survival?.firstFire?.eventId;
      return Boolean(eventId && this.knownEventBySettlement.get(settlement.id) !== eventId);
    }).sort((a, b) => {
      const aFire = a.survival!.firstFire!;
      const bFire = b.survival!.firstFire!;
      return (aFire.plannedMonth ?? aFire.month) - (bFire.plannedMonth ?? bFire.month)
        || (bFire.readiness ?? 0) - (aFire.readiness ?? 0)
        || stableUnit(a.id) - stableUnit(b.id);
    });

    for (const settlement of pending) {
      const eventId = settlement.survival!.firstFire!.eventId;
      this.knownEventBySettlement.set(settlement.id, eventId);
      const naturalDelay = 0.28 + stableUnit(`${eventId}:presentation-delay`) * 0.52;
      const startedAt = Math.max(this.nowSeconds + naturalDelay, this.nextAvailableStartSeconds);
      this.nextAvailableStartSeconds = startedAt + 2.8;
      this.active.set(settlement.id, {
        settlementId: settlement.id,
        eventId,
        startedAt,
        participants: selectParticipants(state.people, settlement.id, settlement.position),
      });
    }
    for (const [settlementId, performance] of this.active) {
      if (this.nowSeconds - performance.startedAt >= FIRST_FIRE_DURATION_SECONDS) this.active.delete(settlementId);
    }
  }

  sample(settlementId: string, reducedMotion = false): FirstFireVisualSample {
    const performance = this.active.get(settlementId);
    if (!performance) {
      const settled = this.knownEventBySettlement.has(settlementId);
      return settled ? settledVisual() : unlitVisual();
    }

    const rawAge = this.nowSeconds - performance.startedAt;
    if (rawAge < 0) return unlitVisual();
    const age = rawAge;
    if (age < 1.6) {
      const p = ease(age / 1.6);
      return {
        active: true, phase: 'kindle', phaseProgress: p,
        flameScale: 0.035 + p * 0.19,
        emberScale: 0.18 + p * 0.72,
        lightGain: 0.02 + p * 0.16,
        smokeGain: 0.04 + p * 0.08,
      };
    }
    if (age < 3.5) {
      const p = ease((age - 1.6) / 1.9);
      const flicker = reducedMotion ? 1 : 1 + Math.sin(this.nowSeconds * 12.7 + stableUnit(performance.eventId) * 8) * 0.045;
      return {
        active: true, phase: 'catch', phaseProgress: p,
        flameScale: (0.22 + p * 0.88) * flicker,
        emberScale: 0.9 + p * 0.1,
        lightGain: 0.18 + p * 0.98,
        smokeGain: 0.12 + p * 1.68,
      };
    }
    if (age < 7.2) {
      const p = ease((age - 3.5) / 3.7);
      const flicker = reducedMotion ? 1 : 1
        + Math.sin(this.nowSeconds * 9.3 + stableUnit(performance.eventId) * 11) * 0.055
        + Math.sin(this.nowSeconds * 5.7 + 1.3) * 0.025;
      return {
        active: true, phase: 'gather', phaseProgress: p,
        flameScale: (1.1 - p * 0.1) * flicker,
        emberScale: 1,
        lightGain: 1.16 - p * 0.12,
        smokeGain: 1.8 - p * 0.72,
      };
    }
    const p = ease((age - 7.2) / (FIRST_FIRE_DURATION_SECONDS - 7.2));
    return {
      active: true, phase: 'settle', phaseProgress: p,
      flameScale: 1,
      emberScale: 1,
      lightGain: 1.04 - p * 0.04,
      smokeGain: 1.08 - p * 0.08,
    };
  }

  targetFor(
    personId: string,
    settlementId: string,
    hearth: Readonly<Vec2>,
    current: Readonly<Vec2>,
  ): FirstFireStagingTarget | undefined {
    const performance = this.active.get(settlementId);
    if (!performance) return;
    const participant = performance.participants.find(candidate => candidate.personId === personId);
    if (!participant) return;
    const age = this.nowSeconds - performance.startedAt;
    if (age < participant.delay || age >= FIRST_FIRE_DURATION_SECONDS) return;

    const dx = current.x - hearth.x;
    const dz = current.z - hearth.z;
    const baseAngle = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dz, dx) : stableUnit(personId) * Math.PI * 2;
    const angle = baseAngle + participant.angleJitter;
    const x = hearth.x + Math.cos(angle) * participant.radius;
    const z = hearth.z + Math.sin(angle) * participant.radius;
    const sample = this.sample(settlementId);
    return {
      x, z,
      eventId: performance.eventId,
      role: participant.role,
      animation: participant.role === 'tender' ? 'gather' : 'converse-warm',
      restFacing: Math.atan2(hearth.x - x, hearth.z - z),
      phaseProgress: sample.phaseProgress,
    };
  }

  isPerforming(settlementId: string): boolean {
    return this.active.has(settlementId);
  }
}

function selectParticipants(people: readonly Person[], settlementId: string, settlement: Readonly<Vec2>): Participant[] {
  const candidates = people.filter(person => person.alive && person.homeId === settlementId && person.health > 0.3)
    .sort((a, b) => {
      const adultA = a.ageMonths >= 168 ? 0 : 1;
      const adultB = b.ageMonths >= 168 ? 0 : 1;
      if (adultA !== adultB) return adultA - adultB;
      const distanceA = Math.hypot(a.position.x - settlement.x, a.position.z - settlement.z);
      const distanceB = Math.hypot(b.position.x - settlement.x, b.position.z - settlement.z);
      if (Math.abs(distanceA - distanceB) > 0.01) return distanceA - distanceB;
      return stableUnit(a.id) - stableUnit(b.id);
    }).slice(0, 5);

  return candidates.map((person, index) => ({
    personId: person.id,
    role: index === 0 ? 'tender' : 'witness',
    delay: index === 0 ? 0.15 : 1.15 + (index - 1) * 0.38,
    radius: index === 0 ? 0.58 : 0.76 + stableUnit(`${person.id}:first-fire-radius`) * 0.12,
    angleJitter: (stableUnit(`${person.id}:first-fire-angle`) - 0.5) * 0.46,
  }));
}

function settledVisual(): FirstFireVisualSample {
  return { active: false, phase: 'complete', phaseProgress: 1, flameScale: 1, emberScale: 1, lightGain: 1, smokeGain: 1 };
}

function unlitVisual(): FirstFireVisualSample {
  return { active: false, phase: 'complete', phaseProgress: 0, flameScale: 0, emberScale: 0, lightGain: 0, smokeGain: 0 };
}

function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
