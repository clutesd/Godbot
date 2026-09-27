import type { Vec2 } from '../../sim/types';

export type FoundingHearthPieceKind = 'stone' | 'log';
export type FoundingHearthAssemblyPhase = 'pickup' | 'carry' | 'place';

export const FOUNDING_HEARTH_STONE_COUNT = 11;
export const FOUNDING_HEARTH_LOG_COUNT = 3;
export const FOUNDING_HEARTH_BUILDER_COUNT = 3;

/** Assembly finishes before the existing ignition performance begins. */
export const FOUNDING_HEARTH_ASSEMBLY_SECONDS = 10.6;

export interface FoundingHearthPiecePose {
  readonly kind: FoundingHearthPieceKind;
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export interface FoundingHearthAssemblyTask {
  readonly kind: FoundingHearthPieceKind;
  readonly index: number;
  readonly builderSlot: number;
  readonly startSeconds: number;
  readonly pickupEndSeconds: number;
  readonly carryEndSeconds: number;
  readonly placeEndSeconds: number;
}

export interface FoundingHearthAssemblySample {
  readonly progress: number;
  readonly stonesPicked: number;
  readonly logsPicked: number;
  readonly stonesPlaced: number;
  readonly logsPlaced: number;
  readonly complete: boolean;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function foundingHearthPiecePose(seed: string, kind: FoundingHearthPieceKind, index: number): FoundingHearthPiecePose {
  if (kind === 'stone') {
    const phase = stableUnit(`${seed}:stone:${index}`);
    const angle = (index / FOUNDING_HEARTH_STONE_COUNT) * Math.PI * 2 + (phase - 0.5) * 0.11;
    const radius = 0.545 + (stableUnit(`${seed}:stone-radius:${index}`) - 0.5) * 0.055;
    return { kind, index, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, yaw: angle };
  }
  const yaw = index * Math.PI / 3 + (stableUnit(`${seed}:log-yaw:${index}`) - 0.5) * 0.18;
  return {
    kind,
    index,
    x: Math.cos(yaw + Math.PI / 2) * 0.055,
    z: Math.sin(yaw + Math.PI / 2) * 0.055,
    yaw,
  };
}

export function foundingHearthAssemblyTasks(): readonly FoundingHearthAssemblyTask[] {
  const tasks: FoundingHearthAssemblyTask[] = [];
  for (let index = 0; index < FOUNDING_HEARTH_STONE_COUNT; index += 1) {
    const start = index * 0.58;
    tasks.push({
      kind: 'stone',
      index,
      builderSlot: index % FOUNDING_HEARTH_BUILDER_COUNT,
      startSeconds: start,
      pickupEndSeconds: start + 0.45,
      carryEndSeconds: start + 1.35,
      placeEndSeconds: start + 1.72,
    });
  }
  for (let index = 0; index < FOUNDING_HEARTH_LOG_COUNT; index += 1) {
    const start = 8 + index * 0.18;
    tasks.push({
      kind: 'log',
      index,
      builderSlot: index % FOUNDING_HEARTH_BUILDER_COUNT,
      startSeconds: start,
      pickupEndSeconds: start + 0.5,
      carryEndSeconds: start + 1.55,
      placeEndSeconds: start + 2.0,
    });
  }
  return Object.freeze(tasks);
}

const TASKS = foundingHearthAssemblyTasks();

export function foundingHearthAssemblySample(ageSeconds: number): FoundingHearthAssemblySample {
  const age = Math.max(0, ageSeconds);
  return {
    progress: clamp01(age / FOUNDING_HEARTH_ASSEMBLY_SECONDS),
    stonesPicked: TASKS.filter(task => task.kind === 'stone' && age >= task.pickupEndSeconds).length,
    logsPicked: TASKS.filter(task => task.kind === 'log' && age >= task.pickupEndSeconds).length,
    stonesPlaced: TASKS.filter(task => task.kind === 'stone' && age >= task.placeEndSeconds).length,
    logsPlaced: TASKS.filter(task => task.kind === 'log' && age >= task.placeEndSeconds).length,
    complete: age >= FOUNDING_HEARTH_ASSEMBLY_SECONDS,
  };
}

export function foundingHearthTaskForBuilder(ageSeconds: number, builderSlot: number): FoundingHearthAssemblyTask | undefined {
  const age = Math.max(0, ageSeconds);
  return TASKS.find(task => task.builderSlot === builderSlot
    && age >= task.startSeconds && age < task.placeEndSeconds);
}

export function foundingHearthTaskPhase(task: FoundingHearthAssemblyTask, ageSeconds: number): {
  phase: FoundingHearthAssemblyPhase;
  progress: number;
} {
  const age = Math.max(task.startSeconds, ageSeconds);
  if (age < task.pickupEndSeconds) {
    return {
      phase: 'pickup',
      progress: clamp01((age - task.startSeconds) / Math.max(0.001, task.pickupEndSeconds - task.startSeconds)),
    };
  }
  if (age < task.carryEndSeconds) {
    return {
      phase: 'carry',
      progress: clamp01((age - task.pickupEndSeconds) / Math.max(0.001, task.carryEndSeconds - task.pickupEndSeconds)),
    };
  }
  return {
    phase: 'place',
    progress: clamp01((age - task.carryEndSeconds) / Math.max(0.001, task.placeEndSeconds - task.carryEndSeconds)),
  };
}

export function foundingHearthPickupPoint(
  hearth: Readonly<Vec2>,
  settlement: Readonly<Vec2>,
  seed: string,
  builderSlot: number,
): Vec2 {
  const dx = settlement.x - hearth.x;
  const dz = settlement.z - hearth.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const towardCampX = dx / length;
  const towardCampZ = dz / length;
  const sideX = -towardCampZ;
  const sideZ = towardCampX;
  const lane = (builderSlot - 1) * 0.2 + (stableUnit(`${seed}:pickup:${builderSlot}`) - 0.5) * 0.08;
  return {
    x: hearth.x + towardCampX * 0.78 + sideX * lane,
    z: hearth.z + towardCampZ * 0.78 + sideZ * lane,
  };
}

export function foundingHearthPlacementStance(
  hearth: Readonly<Vec2>,
  piece: FoundingHearthPiecePose,
  builderSlot: number,
): Vec2 {
  const radial = Math.max(0.001, Math.hypot(piece.x, piece.z));
  const ux = radial > 0.12 ? piece.x / radial : Math.cos((builderSlot / FOUNDING_HEARTH_BUILDER_COUNT) * Math.PI * 2);
  const uz = radial > 0.12 ? piece.z / radial : Math.sin((builderSlot / FOUNDING_HEARTH_BUILDER_COUNT) * Math.PI * 2);
  return { x: hearth.x + ux * 0.82, z: hearth.z + uz * 0.82 };
}
