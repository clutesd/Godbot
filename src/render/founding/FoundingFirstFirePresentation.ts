import type { Person, SimulationState, Vec2 } from '../../sim/types';
import {
  FOUNDING_HEARTH_ASSEMBLY_SECONDS,
  FOUNDING_HEARTH_BUILDER_COUNT,
  FOUNDING_HEARTH_LOG_COUNT,
  FOUNDING_HEARTH_STONE_COUNT,
  foundingHearthAssemblySample,
  foundingHearthPickupPoint,
  foundingHearthPiecePose,
  foundingHearthPlacementStance,
  foundingHearthTaskForBuilder,
  foundingHearthTaskPhase,
  type FoundingHearthAssemblyPhase,
  type FoundingHearthPieceKind,
} from './FoundingHearthAssembly';

export type FirstFirePhase = 'assemble-stones' | 'assemble-logs' | 'kindle' | 'catch' | 'gather' | 'settle' | 'complete';
export type FirstFireParticipantRole = 'builder' | 'tender' | 'witness';

const IGNITION_DURATION_SECONDS = 9.5;
export const FIRST_FIRE_DURATION_SECONDS = FOUNDING_HEARTH_ASSEMBLY_SECONDS + IGNITION_DURATION_SECONDS;

export interface FirstFireVisualSample {
  active: boolean;
  phase: FirstFirePhase;
  phaseProgress: number;
  /** Retained for compatibility; the hearth is now assembled piece-by-piece rather than scaled in. */
  hearthScale: number;
  assemblyProgress: number;
  stonesPlaced: number;
  logsPlaced: number;
  assemblyComplete: boolean;
  flameScale: number;
  emberScale: number;
  lightGain: number;
  smokeGain: number;
}

export interface FirstFireStagingTarget extends Vec2 {
  readonly eventId: string;
  readonly role: FirstFireParticipantRole;
  readonly animation: 'gather' | 'build' | 'converse-warm';
  readonly restFacing: number;
  readonly phaseProgress: number;
  readonly assemblyPhase?: FoundingHearthAssemblyPhase;
  readonly pieceKind?: FoundingHearthPieceKind;
  readonly pieceIndex?: number;
  readonly carriedObject?: 'stone' | 'timber';
  readonly interactionTarget?: Readonly<Vec2>;
  readonly contactStrength?: number;
}

interface Participant {
  personId: string;
  builderSlot?: number;
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
 * The simulation records that a first fire happened. Presentation reconstructs the physical work
 * that makes that milestone legible: three founders assemble stones and fuel before the legacy
 * ignition performance may begin. Existing records are never replayed after reload.
 */
export class FoundingFirstFirePresentation {
  private readonly knownEventBySettlement = new Map<string, string>();
  private readonly active = new Map<string, ActiveFirstFire>();
  private nowSeconds = 0;
  /** Prevents simultaneous same-tick milestones from reading as synchronized scripted cues. */
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
      // Separate settlements by more than a single placement beat so their work never looks synced.
      this.nextAvailableStartSeconds = startedAt + 3.1;
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
    const assembly = foundingHearthAssemblySample(age);
    if (!assembly.complete) {
      const stonesDone = assembly.stonesPlaced >= FOUNDING_HEARTH_STONE_COUNT;
      return {
        active: true,
        phase: stonesDone ? 'assemble-logs' : 'assemble-stones',
        phaseProgress: assembly.progress,
        hearthScale: assembly.stonesPlaced + assembly.logsPlaced > 0 ? 1 : 0,
        assemblyProgress: assembly.progress,
        stonesPlaced: assembly.stonesPlaced,
        logsPlaced: assembly.logsPlaced,
        assemblyComplete: false,
        flameScale: 0,
        emberScale: 0,
        lightGain: 0,
        smokeGain: 0,
      };
    }

    const ignitionAge = age - FOUNDING_HEARTH_ASSEMBLY_SECONDS;
    if (ignitionAge < 1.6) {
      const p = ease(ignitionAge / 1.6);
      return {
        active: true, phase: 'kindle', phaseProgress: p,
        hearthScale: 1, assemblyProgress: 1, stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
        logsPlaced: FOUNDING_HEARTH_LOG_COUNT, assemblyComplete: true,
        flameScale: 0.035 + p * 0.19,
        emberScale: 0.18 + p * 0.72,
        lightGain: 0.02 + p * 0.16,
        smokeGain: 0.04 + p * 0.08,
      };
    }
    if (ignitionAge < 3.5) {
      const p = ease((ignitionAge - 1.6) / 1.9);
      const flicker = reducedMotion ? 1 : 1 + Math.sin(this.nowSeconds * 12.7 + stableUnit(performance.eventId) * 8) * 0.045;
      return {
        active: true, phase: 'catch', phaseProgress: p,
        hearthScale: 1, assemblyProgress: 1, stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
        logsPlaced: FOUNDING_HEARTH_LOG_COUNT, assemblyComplete: true,
        flameScale: (0.22 + p * 0.88) * flicker,
        emberScale: 0.9 + p * 0.1,
        lightGain: 0.18 + p * 0.98,
        smokeGain: 0.12 + p * 1.68,
      };
    }
    if (ignitionAge < 7.2) {
      const p = ease((ignitionAge - 3.5) / 3.7);
      const flicker = reducedMotion ? 1 : 1
        + Math.sin(this.nowSeconds * 9.3 + stableUnit(performance.eventId) * 11) * 0.055
        + Math.sin(this.nowSeconds * 5.7 + 1.3) * 0.025;
      return {
        active: true, phase: 'gather', phaseProgress: p,
        hearthScale: 1, assemblyProgress: 1, stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
        logsPlaced: FOUNDING_HEARTH_LOG_COUNT, assemblyComplete: true,
        flameScale: (1.1 - p * 0.1) * flicker,
        emberScale: 1,
        lightGain: 1.16 - p * 0.12,
        smokeGain: 1.8 - p * 0.72,
      };
    }
    const p = ease((ignitionAge - 7.2) / (IGNITION_DURATION_SECONDS - 7.2));
    return {
      active: true, phase: 'settle', phaseProgress: p,
      hearthScale: 1, assemblyProgress: 1, stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
      logsPlaced: FOUNDING_HEARTH_LOG_COUNT, assemblyComplete: true,
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
    settlement: Readonly<Vec2> = current,
  ): FirstFireStagingTarget | undefined {
    const performance = this.active.get(settlementId);
    if (!performance) return;
    const participant = performance.participants.find(candidate => candidate.personId === personId);
    if (!participant) return;
    const age = this.nowSeconds - performance.startedAt;
    if (age < 0 || age >= FIRST_FIRE_DURATION_SECONDS) return;

    if (age < FOUNDING_HEARTH_ASSEMBLY_SECONDS) {
      if (participant.builderSlot === undefined) return;
      const task = foundingHearthTaskForBuilder(age, participant.builderSlot);
      if (!task) return;
      const taskPhase = foundingHearthTaskPhase(task, age);
      const pickup = foundingHearthPickupPoint(hearth, settlement, performance.eventId, participant.builderSlot);
      const piece = foundingHearthPiecePose(performance.eventId, task.kind, task.index);
      const placement = foundingHearthPlacementStance(hearth, piece, participant.builderSlot);
      const interactionTarget = { x: hearth.x + piece.x, z: hearth.z + piece.z };
      const target = taskPhase.phase === 'pickup' ? pickup : placement;
      return {
        ...target,
        eventId: performance.eventId,
        role: 'builder',
        animation: taskPhase.phase === 'place' ? 'build' : 'gather',
        restFacing: Math.atan2(interactionTarget.x - target.x, interactionTarget.z - target.z),
        phaseProgress: taskPhase.progress,
        assemblyPhase: taskPhase.phase,
        pieceKind: task.kind,
        pieceIndex: task.index,
        carriedObject: taskPhase.phase === 'carry' || taskPhase.phase === 'place'
          ? task.kind === 'stone' ? 'stone' : 'timber'
          : undefined,
        interactionTarget,
        contactStrength: taskPhase.phase === 'place' ? taskPhase.progress : 0,
      };
    }

    const ignitionAge = age - FOUNDING_HEARTH_ASSEMBLY_SECONDS;
    const role: FirstFireParticipantRole = participant.builderSlot === 0 ? 'tender' : 'witness';
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
      role,
      animation: role === 'tender' && ignitionAge < 3.5 ? 'gather' : 'converse-warm',
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
    builderSlot: index < FOUNDING_HEARTH_BUILDER_COUNT ? index : undefined,
    radius: index === 0 ? 0.58 : 0.76 + stableUnit(`${person.id}:first-fire-radius`) * 0.12,
    angleJitter: (stableUnit(`${person.id}:first-fire-angle`) - 0.5) * 0.46,
  }));
}

function settledVisual(): FirstFireVisualSample {
  return {
    active: false, phase: 'complete', phaseProgress: 1,
    hearthScale: 1, assemblyProgress: 1, stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
    logsPlaced: FOUNDING_HEARTH_LOG_COUNT, assemblyComplete: true,
    flameScale: 1, emberScale: 1, lightGain: 1, smokeGain: 1,
  };
}

function unlitVisual(): FirstFireVisualSample {
  return {
    active: false, phase: 'complete', phaseProgress: 0,
    hearthScale: 0, assemblyProgress: 0, stonesPlaced: 0, logsPlaced: 0, assemblyComplete: false,
    flameScale: 0, emberScale: 0, lightGain: 0, smokeGain: 0,
  };
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
