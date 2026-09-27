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

export type FirstFirePhase = 'assemble-stones' | 'assemble-logs' | 'prepare-tinder' | 'strike' | 'ember' | 'falter' | 'catch' | 'gather' | 'settle' | 'complete';
export type FirstFireParticipantRole = 'builder' | 'tender' | 'witness';

const IGNITION_DURATION_SECONDS = 12;
export const FIRST_FIRE_DURATION_SECONDS = FOUNDING_HEARTH_ASSEMBLY_SECONDS + IGNITION_DURATION_SECONDS;

export interface FirstFireVisualSample {
  active: boolean;
  phase: FirstFirePhase;
  phaseProgress: number;
  /** Retained for compatibility; the hearth is now assembled piece-by-piece rather than scaled in. */
  hearthScale: number;
  assemblyProgress: number;
  stonesPicked: number;
  logsPicked: number;
  stonesPlaced: number;
  logsPlaced: number;
  assemblyComplete: boolean;
  flameScale: number;
  emberScale: number;
  lightGain: number;
  smokeGain: number;
  /** Glow inside the tinder nest before open flame exists. */
  tinderGlow: number;
  /** Independent strike/spark gain so sparks can exist before a flame tongue does. */
  sparkGain: number;
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
  readonly ceremonyPhase?: FirstFirePhase;
}

interface Participant {
  personId: string;
  builderSlot?: number;
  radius: number;
  angleJitter: number;
  witnessDelay: number;
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
        stonesPicked: assembly.stonesPicked,
        logsPicked: assembly.logsPicked,
        stonesPlaced: assembly.stonesPlaced,
        logsPlaced: assembly.logsPlaced,
        assemblyComplete: false,
        flameScale: 0,
        emberScale: 0,
        lightGain: 0,
        smokeGain: 0,
        tinderGlow: 0,
        sparkGain: 0,
      };
    }

    const ignitionAge = age - FOUNDING_HEARTH_ASSEMBLY_SECONDS;
    const assembled = {
      hearthScale: 1,
      assemblyProgress: 1,
      stonesPicked: FOUNDING_HEARTH_STONE_COUNT,
      logsPicked: FOUNDING_HEARTH_LOG_COUNT,
      stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
      logsPlaced: FOUNDING_HEARTH_LOG_COUNT,
      assemblyComplete: true,
    };

    if (ignitionAge < 1.4) {
      const p = ease(ignitionAge / 1.4);
      return {
        active: true, phase: 'prepare-tinder', phaseProgress: p, ...assembled,
        flameScale: 0, emberScale: 0, lightGain: 0, smokeGain: 0,
        tinderGlow: 0, sparkGain: 0,
      };
    }
    if (ignitionAge < 2.4) {
      const p = ease((ignitionAge - 1.4) / 1);
      const strike = reducedMotion ? 0.5 : Math.max(0.08, Math.sin(p * Math.PI * 4) ** 2);
      return {
        active: true, phase: 'strike', phaseProgress: p, ...assembled,
        flameScale: 0, emberScale: 0.025 * p, lightGain: 0.008 * p, smokeGain: 0,
        tinderGlow: 0.04 + p * 0.08, sparkGain: strike,
      };
    }
    if (ignitionAge < 4) {
      const p = ease((ignitionAge - 2.4) / 1.6);
      return {
        active: true, phase: 'ember', phaseProgress: p, ...assembled,
        flameScale: 0, emberScale: 0.08 + p * 0.5, lightGain: 0.015 + p * 0.045,
        smokeGain: 0.025 + p * 0.085, tinderGlow: 0.12 + p * 0.58, sparkGain: 0.08,
      };
    }
    if (ignitionAge < 5.3) {
      const p = ease((ignitionAge - 4) / 1.3);
      // The first tongue appears and then visibly weakens. A perfect instant ignition reads as an
      // effect; this small deterministic failure makes the tender's work causal and legible.
      const falterArc = Math.sin(p * Math.PI);
      return {
        active: true, phase: 'falter', phaseProgress: p, ...assembled,
        flameScale: 0.035 + falterArc * 0.24,
        emberScale: 0.55 + p * 0.1,
        lightGain: 0.045 + falterArc * 0.15,
        smokeGain: 0.08 + falterArc * 0.14,
        tinderGlow: 0.7 - p * 0.12,
        sparkGain: 0.14,
      };
    }
    if (ignitionAge < 7.6) {
      const p = ease((ignitionAge - 5.3) / 2.3);
      const flicker = reducedMotion ? 1 : 1 + Math.sin(this.nowSeconds * 10.7 + stableUnit(performance.eventId) * 8) * 0.04;
      return {
        active: true, phase: 'catch', phaseProgress: p, ...assembled,
        flameScale: (0.08 + p * 0.94) * flicker,
        emberScale: 0.65 + p * 0.35,
        lightGain: 0.1 + p * 1.02,
        smokeGain: 0.22 + p * 1.34,
        tinderGlow: 0.58 + p * 0.42,
        sparkGain: 0.22 + p * 0.72,
      };
    }
    if (ignitionAge < 10.3) {
      const p = ease((ignitionAge - 7.6) / 2.7);
      const flicker = reducedMotion ? 1 : 1
        + Math.sin(this.nowSeconds * 9.3 + stableUnit(performance.eventId) * 11) * 0.05
        + Math.sin(this.nowSeconds * 5.7 + 1.3) * 0.022;
      return {
        active: true, phase: 'gather', phaseProgress: p, ...assembled,
        flameScale: (1.04 - p * 0.04) * flicker,
        emberScale: 1,
        lightGain: 1.12 - p * 0.08,
        smokeGain: 1.56 - p * 0.5,
        tinderGlow: 1,
        sparkGain: 0.72 - p * 0.22,
      };
    }
    const p = ease((ignitionAge - 10.3) / (IGNITION_DURATION_SECONDS - 10.3));
    return {
      active: true, phase: 'settle', phaseProgress: p, ...assembled,
      flameScale: 1, emberScale: 1, lightGain: 1.04 - p * 0.04,
      smokeGain: 1.06 - p * 0.06, tinderGlow: 1, sparkGain: 0.5,
    };

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
    const sample = this.sample(settlementId);

    if (role === 'tender') {
      const angle = stableUnit(`${performance.eventId}:${personId}:tender`) * Math.PI * 2;
      const radius = 0.47;
      const x = hearth.x + Math.cos(angle) * radius;
      const z = hearth.z + Math.sin(angle) * radius;
      return {
        x, z,
        eventId: performance.eventId,
        role,
        animation: ['prepare-tinder', 'strike', 'ember', 'falter', 'catch'].includes(sample.phase) ? 'ignite' : 'converse-warm',
        restFacing: Math.atan2(hearth.x - x, hearth.z - z),
        phaseProgress: sample.phaseProgress,
        interactionTarget: { x: hearth.x, z: hearth.z },
        contactStrength: sample.phase === 'strike' ? 0.85
          : sample.phase === 'prepare-tinder' ? 0.32
            : ['ember', 'falter', 'catch'].includes(sample.phase) ? 0.62 : 0,
        ceremonyPhase: sample.phase,
      };
    }

    // Witnesses do not pre-stage around a dark hearth. They join only once the second attempt is
    // visibly catching, each on a slightly different beat.
    if (ignitionAge < participant.witnessDelay) return;
    const angle = stableUnit(`${performance.eventId}:${personId}:witness`) * Math.PI * 2 + participant.angleJitter;
    const x = hearth.x + Math.cos(angle) * participant.radius;
    const z = hearth.z + Math.sin(angle) * participant.radius;
    return {
      x, z,
      eventId: performance.eventId,
      role,
      animation: 'converse-warm',
      restFacing: Math.atan2(hearth.x - x, hearth.z - z),
      phaseProgress: sample.phaseProgress,
      ceremonyPhase: sample.phase,
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
    witnessDelay: index === 0 ? 0 : 5.55 + (index - 1) * 0.42 + stableUnit(`${person.id}:first-fire-witness-delay`) * 0.16,
  }));
}

function settledVisual(): FirstFireVisualSample {
  return {
    active: false, phase: 'complete', phaseProgress: 1,
    hearthScale: 1, assemblyProgress: 1, stonesPicked: FOUNDING_HEARTH_STONE_COUNT,
    logsPicked: FOUNDING_HEARTH_LOG_COUNT, stonesPlaced: FOUNDING_HEARTH_STONE_COUNT,
    logsPlaced: FOUNDING_HEARTH_LOG_COUNT, assemblyComplete: true,
    flameScale: 1, emberScale: 1, lightGain: 1, smokeGain: 1, tinderGlow: 1, sparkGain: 0.5,
  };
}

function unlitVisual(): FirstFireVisualSample {
  return {
    active: false, phase: 'complete', phaseProgress: 0,
    hearthScale: 0, assemblyProgress: 0, stonesPicked: 0, logsPicked: 0,
    stonesPlaced: 0, logsPlaced: 0, assemblyComplete: false,
    flameScale: 0, emberScale: 0, lightGain: 0, smokeGain: 0, tinderGlow: 0, sparkGain: 0,
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
