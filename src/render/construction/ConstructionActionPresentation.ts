import type { Person, Settlement, WeatherCellState } from '../../sim/types';
import type { StructureMaterial } from '../../sim/development/types';
import type { ConstructionWorkerAnchors } from './ConstructionWorkerMotion';
import type { ConstructionCrewRole } from './ConstructionCrewPresentation';
import { resourceVisualUnit } from '../../sim/resources/ResourceWorkPresentation';
import type { ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { facingTarget, workInterruption, type PhysicalActionPresentation } from '../people/PhysicalActionPresentation';

export type ConstructionPhase = 'return' | 'pickup' | 'carry' | 'deliver' | 'assemble' | 'inspect';
export interface ConstructionPlayback { phase: ConstructionPhase; seconds: number; carrying: boolean }
export function createConstructionPlayback(): ConstructionPlayback { return { phase: 'return', seconds: 0, carrying: false }; }

/** Current stock gates loads; already spent stock is in the structure, never back in the pile. */
export function constructionBlockedReason(settlement: Settlement): string | undefined {
  const project = settlement.development?.project;
  if (!settlement.alive || !project || project.progress >= 1) return 'no-active-project';
  if (project.blockedReasons?.length) return project.blockedReasons[0];
  for (const requirement of project.materialRequirements ?? []) {
    if (requirement.amount > 0 && requirement.options.every(id => (settlement.localMaterials[id] ?? 0) <= 0.000001)) return `missing:${requirement.id}`;
  }
  for (const [id, amount] of Object.entries(project.response.materialCost ?? {})) {
    if (amount > 0 && (settlement.localMaterials[id] ?? 0) <= 0.000001) return `missing:${id}`;
  }
  for (const key of ['food', 'wood', 'minerals', 'goods', 'wealth'] as const) {
    if (project.response.cost[key] > 0 && settlement.resources[key] <= 0.000001) return `missing:${key}`;
  }
  return undefined;
}

/** Honour actual substitutes in the project's structural bill of materials. */
export function constructionPresentedMaterial(settlement: Settlement): StructureMaterial {
  const project = settlement.development?.project;
  const supplied = project?.materialRequirements?.[0]?.options.find(id => (settlement.localMaterials[id] ?? 0) > 0.000001);
  if (supplied === 'timber' || supplied === 'lumber') return 'timber';
  if (supplied === 'brick') return 'ceramic';
  if (supplied === 'stone') return 'masonry';
  if (supplied === 'iron' || supplied === 'steel' || supplied === 'bronze') return 'metal';
  return project?.response.material ?? 'earth';
}

export function builderCanPresent(person: Person, settlement: Settlement, weather?: WeatherCellState): boolean {
  const project = settlement.development?.project;
  const plot = settlement.structurePlots?.find(p => p.id === project?.plotId);
  return !workInterruption(person, weather) && settlement.alive && !!project && project.progress < 1
    && !!plot && !plot.fire && (plot.floodDepth ?? 0) <= 0.035 && plot.condition >= 0.65
    && person.homeId === settlement.id && person.activity === 'construct'
    && person.navigation?.destinationKind === 'construction-site'
    && (person.navigation.destinationId === project.plotId || person.navigation.destinationId === `${settlement.id}:construction-site`);
}

/** Arrival gates make phase time independent of path length: no pickup or release in transit.
 * Called only for eligible workers; interruption discards this small renderer-owned state. */
export function advanceConstruction(
  playback: ConstructionPlayback,
  delta: number,
  ready: boolean,
  blocked: boolean,
  crewRole: ConstructionCrewRole = 'hauler',
  crewSize = 1,
): void {
  if (blocked) { playback.phase = 'inspect'; playback.seconds = 0; playback.carrying = false; return; }

  if (crewRole === 'site-worker') {
    if (playback.phase !== 'inspect') { playback.phase = 'inspect'; playback.seconds = 0; playback.carrying = false; }
    if (!ready) return;
    playback.seconds += Math.max(0, Math.min(delta, 0.1));
    if (playback.seconds >= 1.6) playback.seconds = 0;
    return;
  }

  const assembler = crewRole === 'assembler';
  const soloGeneralist = crewRole === 'hauler' && crewSize <= 1;
  // If a second worker joins while the former solo generalist is assembling, specialization takes
  // effect immediately rather than letting the new hauler finish a builder-only beat.
  if (crewRole === 'hauler' && !soloGeneralist && playback.phase === 'assemble') {
    playback.phase = 'return';
    playback.seconds = 0;
  }
  if (playback.phase === 'inspect') { playback.phase = assembler ? 'assemble' : 'return'; playback.seconds = 0; }
  if (!ready) return;
  if (assembler && playback.phase === 'return') playback.phase = 'assemble';
  playback.seconds += Math.max(0, Math.min(delta, 0.1));
  const duration = playback.phase === 'pickup' ? 0.9 : playback.phase === 'deliver' ? 1.15 : playback.phase === 'assemble' ? 1.8 : 0;
  if (playback.phase === 'pickup' && playback.seconds >= 0.9 * 0.62) playback.carrying = true;
  if (playback.phase === 'deliver' && playback.seconds >= 1.15 * 0.52) playback.carrying = false;
  if (playback.seconds < duration) return;
  playback.phase = playback.phase === 'return' ? 'pickup' : playback.phase === 'pickup' ? 'carry'
    : playback.phase === 'carry' ? 'deliver'
      : playback.phase === 'deliver' ? soloGeneralist ? 'assemble' : 'return'
        : assembler ? 'assemble' : 'return';
  playback.seconds = 0;
}

export function sampleConstructionAction(person: Person, plotId: string, playback: ConstructionPlayback,
  anchors: ConstructionWorkerAnchors, material: StructureMaterial, motion: ResourceWorkMotion, blockedReason?: string,
  crewRole: ConstructionCrewRole = 'hauler', crewSize = 1): PhysicalActionPresentation {
  const phase = playback.phase;
  const soloGeneralist = crewRole === 'hauler' && crewSize <= 1;
  const assembling = crewRole === 'assembler' || soloGeneralist && phase === 'assemble';
  const pickup = crewRole === 'hauler' && (phase === 'return' || phase === 'pickup');
  const prep = crewRole === 'site-worker';
  const duration = phase === 'pickup' ? 0.9 : phase === 'deliver' ? 1.15 : phase === 'inspect' ? 1.6 : 1.8;
  const p = Math.min(1, playback.seconds / duration);
  const bend = phase === 'pickup' || phase === 'deliver' ? Math.sin(p * Math.PI) : 0;
  const strike = assembling && phase === 'assemble' ? Math.max(0, Math.sin(p * Math.PI * 2 - 1)) : 0;
  motion.crouch = bend * 0.13; motion.lean = bend * 0.22 + (playback.carrying ? 0.07 : strike * 0.1);
  motion.twist = assembling && phase === 'assemble' ? strike * (0.12 + resourceVisualUnit(person.id) * 0.08) : 0;
  motion.handY = playback.carrying ? 0.43 - bend * 0.19 : 0.5 - bend * 0.32 + strike * 0.2;
  motion.handZ = 0.22 + bend * 0.16; motion.toolAngle = 0.7 + strike * 1.4;
  motion.basket = 0; motion.reposition = false;
  motion.impact = (phase === 'pickup' && p >= 0.58 && p <= 0.66 || phase === 'deliver' && p >= 0.48 && p <= 0.56) ? 1
    : assembling && phase === 'assemble' ? strike : 0;
  const locomotionTarget = prep ? anchors.prep : pickup ? anchors.pickup : anchors.delivery;
  const interactionCenter = prep ? anchors.prepCenter : pickup ? anchors.materialCenter : anchors.siteCenter;
  return { personId: person.id,
    actionKind: crewRole === 'assembler' ? 'construction-assemble' : crewRole === 'site-worker' ? 'construction-site'
      : soloGeneralist ? 'construction-generalist' : 'construction-haul',
    authoritativeActivity: person.activity,
    sourceAuthority: 'development.project + construct destination + current material stocks + deterministic crew presentation', targetId: plotId,
    targetKind: prep ? 'site-prep' : pickup ? 'material-pile' : 'workface',
    interactionAnchor: contactSurface(locomotionTarget, interactionCenter),
    locomotionTarget, phase, phaseProgress: p,
    activeTool: assembling && phase === 'assemble' && material !== 'earth' ? 'hammer' : 'none',
    carriedObject: crewRole === 'hauler' && playback.carrying ? material : undefined,
    contactStrength: assembling || phase === 'pickup' || phase === 'deliver' ? motion.impact : 0, blockedReason };
}

function contactSurface(from: Readonly<{ x: number; z: number }>, center: Readonly<{ x: number; z: number }>): { x: number; z: number } {
  const length = Math.hypot(center.x - from.x, center.z - from.z) || 1;
  return { x: from.x + (center.x - from.x) / length * 0.13, z: from.z + (center.z - from.z) / length * 0.13 };
}

export function constructionFacing(action: PhysicalActionPresentation): number {
  return facingTarget(action.locomotionTarget, action.interactionAnchor);
}
