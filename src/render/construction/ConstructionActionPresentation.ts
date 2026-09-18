import type { Person, Settlement, WeatherCellState } from '../../sim/types';
import type { StructureMaterial } from '../../sim/development/types';
import type { ConstructionWorkerAnchors } from './ConstructionWorkerMotion';
import type { ConstructionCrewRole } from './ConstructionCrewPresentation';
import { constructionChoreography, constructionContactEffect, type ConstructionChoreographyProfile } from './ConstructionChoreography';
import type { Era } from '../materials/MaterialPalette';
import { resourceVisualUnit } from '../../sim/resources/ResourceWorkPresentation';
import type { ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { facingTarget, workInterruption, type PhysicalActionPresentation } from '../people/PhysicalActionPresentation';
import { constructionPresentationProgress, constructionStagePresentation } from './ConstructionVisualGrammar';

export type ConstructionPhase = 'return' | 'pickup' | 'carry' | 'deliver' | 'handoff' | 'assemble' | 'inspect';
export interface ConstructionPlayback { phase: ConstructionPhase; seconds: number; carrying: boolean }
export interface ConstructionHandoffCue {
  sourcePersonId: string;
  progress: number;
  material: StructureMaterial;
}
export const CONSTRUCTION_HANDOFF_SECONDS = 0.9;
const CONSTRUCTION_DELIVER_SECONDS = 0.55;
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

export type ConstructionSitePresentationState =
  | 'inactive'
  | 'active'
  | 'blocked-material'
  | 'blocked-work'
  | 'finishing';

/**
 * Compact renderer-facing state for the whole active worksite. This intentionally collapses raw
 * blocker wording into visual categories so heavy geometry rebuilds only when the site story changes.
 */
export function constructionSitePresentationState(settlement: Settlement): ConstructionSitePresentationState {
  const project = settlement.development?.project;
  if (!settlement.alive || !project || project.progress >= 1) return 'inactive';
  const blocked = constructionBlockedReason(settlement);
  if (blocked) return blocked.startsWith('missing:') ? 'blocked-material' : 'blocked-work';
  return constructionStagePresentation(constructionPresentationProgress(settlement)).finishing ? 'finishing' : 'active';
}

/** Honour actual substitutes in the project's structural bill of materials. */
export function constructionPresentedMaterial(settlement: Settlement): StructureMaterial {
  const project = settlement.development?.project;
  const responseMaterial = project?.response.material ?? 'earth';
  // Earth construction legitimately consumes timber/lumber for structural frames, but that support
  // material must not visually turn the whole earth building into a timber project.
  if (responseMaterial === 'earth') return 'earth';
  const supplied = project?.materialRequirements?.[0]?.options.find(id => (settlement.localMaterials[id] ?? 0) > 0.000001);
  if (supplied === 'timber' || supplied === 'lumber') return 'timber';
  if (supplied === 'brick') return responseMaterial === 'masonry' ? 'ceramic' : responseMaterial;
  if (supplied === 'stone') return 'masonry';
  if (supplied === 'iron' || supplied === 'steel' || supplied === 'bronze') return 'metal';
  return responseMaterial;
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
  handoffReady = true,
  finishing = false,
): void {
  if (blocked) {
    if (playback.phase !== 'inspect') { playback.phase = 'inspect'; playback.seconds = 0; }
    playback.carrying = false;
    if (!ready) return;
    playback.seconds += Math.max(0, Math.min(delta, 0.1));
    if (playback.seconds >= 2.6) playback.seconds = 0;
    return;
  }

  const assembler = crewRole === 'assembler';
  const soloGeneralist = crewRole === 'hauler' && crewSize <= 1;
  if (finishing && !assembler && !soloGeneralist) {
    if (playback.phase !== 'inspect') { playback.phase = 'inspect'; playback.seconds = 0; }
    playback.carrying = false;
    if (!ready) return;
    playback.seconds += Math.max(0, Math.min(delta, 0.1));
    if (playback.seconds >= 2.2) playback.seconds = 0;
    return;
  }

  if (crewRole === 'site-worker') {
    if (playback.phase !== 'inspect') { playback.phase = 'inspect'; playback.seconds = 0; playback.carrying = false; }
    if (!ready) return;
    playback.seconds += Math.max(0, Math.min(delta, 0.1));
    if (playback.seconds >= 1.6) playback.seconds = 0;
    return;
  }

  // If a second worker joins while the former solo generalist is assembling, specialization takes
  // effect immediately rather than letting the new hauler finish a builder-only beat.
  if (crewRole === 'hauler' && !soloGeneralist && playback.phase === 'assemble') {
    playback.phase = 'return';
    playback.seconds = 0;
  }
  if (playback.phase === 'inspect') { playback.phase = assembler ? 'assemble' : 'return'; playback.seconds = 0; }
  if (!ready) return;
  if (assembler && playback.phase === 'return') playback.phase = 'assemble';
  // Dedicated haulers wait with the load in their hands until their paired assembler is actually
  // standing at the receive point. Solo generalists do not need a partner.
  if (playback.phase === 'handoff' && !soloGeneralist && !handoffReady) return;
  playback.seconds += Math.max(0, Math.min(delta, 0.1));
  const duration = playback.phase === 'pickup' ? 0.9
    : playback.phase === 'deliver' ? CONSTRUCTION_DELIVER_SECONDS
      : playback.phase === 'handoff' ? CONSTRUCTION_HANDOFF_SECONDS
        : playback.phase === 'assemble' ? 1.8 : 0;
  if (playback.phase === 'pickup' && playback.seconds >= 0.9 * 0.62) playback.carrying = true;
  // Keep the load visible into the receive beat; it transfers near the middle of handoff.
  if (playback.phase === 'handoff' && playback.seconds >= CONSTRUCTION_HANDOFF_SECONDS * 0.52) playback.carrying = false;
  if (playback.seconds < duration) return;
  if (playback.phase === 'handoff') playback.carrying = false;
  playback.phase = playback.phase === 'return' ? 'pickup' : playback.phase === 'pickup' ? 'carry'
    : playback.phase === 'carry' ? 'deliver'
      : playback.phase === 'deliver' ? 'handoff'
        : playback.phase === 'handoff' ? soloGeneralist ? 'assemble' : 'return'
          : assembler ? 'assemble' : 'return';
  playback.seconds = 0;
}

export function sampleConstructionAction(person: Person, plotId: string, playback: ConstructionPlayback,
  anchors: ConstructionWorkerAnchors, material: StructureMaterial, motion: ResourceWorkMotion, blockedReason?: string,
  crewRole: ConstructionCrewRole = 'hauler', crewSize = 1, progress = 0.5,
  handoff?: ConstructionHandoffCue, era: Era = 'early'): PhysicalActionPresentation {
  const phase = playback.phase;
  const blocked = blockedReason !== undefined;
  const choreography = constructionChoreography(material, progress);
  const soloGeneralist = crewRole === 'hauler' && crewSize <= 1;
  const finishingAssembler = choreography.finishing && (crewRole === 'assembler' || soloGeneralist) && !blocked;
  const finishingCleanup = choreography.finishing && !finishingAssembler && !blocked;
  const assembling = !blocked && !finishingCleanup && (crewRole === 'assembler' || soloGeneralist && phase === 'assemble');
  const pickup = !blocked && !finishingCleanup && crewRole === 'hauler' && (phase === 'return' || phase === 'pickup');
  const handoffing = !blocked && !finishingCleanup && crewRole === 'hauler' && phase === 'handoff';
  const receiving = !blocked && !choreography.finishing && crewRole === 'assembler' && handoff !== undefined;
  const prep = !blocked && !finishingCleanup && crewRole === 'site-worker';
  const duration = blocked ? 2.6
    : finishingCleanup ? 2.2
      : phase === 'pickup' ? 0.9
        : phase === 'deliver' ? CONSTRUCTION_DELIVER_SECONDS
          : phase === 'handoff' ? CONSTRUCTION_HANDOFF_SECONDS
            : phase === 'inspect' ? 1.6 : 1.8;
  const p = Math.min(1, playback.seconds / duration);
  if (blocked) applyQuietInspectionMotion(p, person.id, motion);
  else if (finishingCleanup) applyCleanupMotion(p, person.id, crewRole, motion);
  else if (receiving) applyReceiveMotion(handoff.progress, motion);
  else if (handoffing) applyHandoffMotion(playback, p, motion);
  else if (assembling && phase === 'assemble') applyAssemblyMotion(choreography, p, person.id, motion);
  else if (prep) applyPrepMotion(choreography, p, person.id, motion);
  else applyHaulMotion(playback, phase, p, motion);
  const haulingToHandoff = !blocked && !finishingCleanup && crewRole === 'hauler' && !pickup && phase !== 'assemble';
  const cleanupTarget = crewRole === 'hauler' ? anchors.pickup : anchors.handoff;
  const blockedTarget = crewRole === 'hauler' ? anchors.pickup : crewRole === 'assembler' ? anchors.delivery : anchors.prep;
  const locomotionTarget = blocked ? blockedTarget
    : finishingCleanup ? cleanupTarget
      : prep ? anchors.prep : pickup ? anchors.pickup : haulingToHandoff ? anchors.handoff : anchors.delivery;
  const interactionCenter = blocked ? anchors.siteCenter
    : finishingCleanup ? crewRole === 'hauler' ? anchors.materialCenter : anchors.siteCenter
      : receiving ? anchors.handoff
        : haulingToHandoff ? anchors.delivery
          : prep ? anchors.prepCenter : pickup ? anchors.materialCenter : anchors.siteCenter;
  const presentedPhase = blocked ? 'inspect' : finishingCleanup ? 'cleanup' : receiving ? 'receive' : phase;
  return { personId: person.id,
    actionKind: blocked ? 'construction-blocked'
      : finishingCleanup ? 'construction-cleanup'
        : receiving ? 'construction-receive'
          : finishingAssembler ? 'construction-finish'
            : crewRole === 'assembler' ? 'construction-assemble' : crewRole === 'site-worker' ? 'construction-site'
              : soloGeneralist ? 'construction-generalist' : 'construction-haul',
    authoritativeActivity: person.activity,
    sourceAuthority: 'development.project + construct destination + current material stocks + deterministic crew presentation', targetId: plotId,
    targetKind: receiving || haulingToHandoff ? 'handoff' : prep ? 'site-prep' : pickup ? 'material-pile' : 'workface',
    interactionAnchor: contactSurface(locomotionTarget, interactionCenter),
    locomotionTarget, phase: presentedPhase, phaseProgress: receiving ? handoff.progress : p,
    activeTool: blocked || finishingCleanup || receiving || handoffing ? 'none'
      : assembling && phase === 'assemble' ? choreography.assemblerTool : prep ? choreography.prepTool : 'none',
    carriedObject: blocked || finishingCleanup ? undefined
      : receiving && handoff.progress >= 0.48 && handoff.progress < 0.88 ? handoff.material
        : crewRole === 'hauler' && playback.carrying ? material : undefined,
    contactStrength: blocked || finishingCleanup ? 0
      : receiving || handoffing ? motion.impact
        : assembling || prep || phase === 'pickup' || phase === 'deliver' ? motion.impact : 0,
    contactEffect: !blocked && !finishingCleanup && !receiving && !handoffing && (assembling || prep) && motion.impact > 0
      ? constructionContactEffect(material, era) : undefined,
    blockedReason };
}

function applyQuietInspectionMotion(p: number, personId: string, motion: ResourceWorkMotion): void {
  const variation = 0.85 + resourceVisualUnit(personId) * 0.3;
  const look = Math.sin(p * Math.PI * 2) * variation;
  motion.crouch = 0;
  motion.lean = 0.015 + Math.max(0, Math.sin(p * Math.PI)) * 0.025;
  motion.twist = look * 0.08;
  motion.handY = 0.43 + Math.max(0, Math.sin(p * Math.PI)) * 0.025;
  motion.handZ = 0.15;
  motion.toolAngle = 1.9;
  motion.basket = 0; motion.held = 0; motion.reposition = p > 0.9;
  motion.impact = 0;
}

function applyCleanupMotion(
  p: number,
  personId: string,
  role: ConstructionCrewRole,
  motion: ResourceWorkMotion,
): void {
  const variation = 0.9 + resourceVisualUnit(personId) * 0.2;
  const reach = Math.sin(p * Math.PI);
  const shift = Math.sin(p * Math.PI * 2) * variation;
  motion.crouch = role === 'site-worker' ? reach * 0.1 : reach * 0.06;
  motion.lean = 0.05 + reach * 0.12;
  motion.twist = shift * 0.12;
  motion.handY = 0.42 - reach * 0.11;
  motion.handZ = 0.2 + reach * 0.14;
  motion.toolAngle = 1.9;
  motion.basket = 0; motion.held = 0; motion.reposition = p > 0.82;
  motion.impact = 0;
}

function applyHandoffMotion(
  playback: ConstructionPlayback,
  p: number,
  motion: ResourceWorkMotion,
): void {
  const transfer = Math.sin(Math.min(1, p) * Math.PI);
  motion.crouch = transfer * 0.07;
  motion.lean = 0.08 + transfer * 0.13;
  motion.twist = 0;
  motion.handY = playback.carrying ? 0.43 - transfer * 0.08 : 0.46 + transfer * 0.03;
  motion.handZ = 0.25 + transfer * 0.18;
  motion.toolAngle = 1.7;
  motion.basket = 0;
  motion.held = playback.carrying ? 1 : 0;
  motion.reposition = p > 0.88;
  motion.impact = Math.max(0, 1 - Math.abs(p - 0.52) / 0.18) * 0.34;
}

function applyReceiveMotion(p: number, motion: ResourceWorkMotion): void {
  const receive = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
  const settle = p > 0.52 ? Math.sin(Math.min(1, (p - 0.52) / 0.48) * Math.PI) : 0;
  motion.crouch = receive * 0.045;
  motion.lean = 0.06 + receive * 0.11;
  motion.twist = -receive * 0.08;
  motion.handY = 0.47 - receive * 0.06 + settle * 0.035;
  motion.handZ = 0.22 + receive * 0.2 - settle * 0.06;
  motion.toolAngle = 1.8;
  motion.basket = 0;
  motion.held = p >= 0.48 && p < 0.88 ? 1 : 0;
  motion.reposition = p > 0.88;
  motion.impact = Math.max(0, 1 - Math.abs(p - 0.52) / 0.18) * 0.26;
}

function applyHaulMotion(
  playback: ConstructionPlayback,
  phase: ConstructionPhase,
  p: number,
  motion: ResourceWorkMotion,
): void {
  const bend = phase === 'pickup' || phase === 'deliver' ? Math.sin(p * Math.PI) : 0;
  motion.crouch = bend * 0.13;
  motion.lean = bend * 0.22 + (playback.carrying ? 0.07 : 0);
  motion.twist = 0;
  motion.handY = playback.carrying ? 0.43 - bend * 0.19 : 0.5 - bend * 0.32;
  motion.handZ = 0.22 + bend * 0.16;
  motion.toolAngle = 0.7;
  motion.basket = 0;
  motion.held = playback.carrying ? 1 : 0;
  motion.reposition = false;
  motion.impact = (phase === 'pickup' && p >= 0.58 && p <= 0.66
    || phase === 'deliver' && p >= 0.48 && p <= 0.56) ? 1 : 0;
}

function applyAssemblyMotion(
  profile: ConstructionChoreographyProfile,
  p: number,
  personId: string,
  motion: ResourceWorkMotion,
): void {
  const variation = 0.9 + resourceVisualUnit(personId) * 0.2;
  const stageReach = profile.stageName === 'foundation' ? -0.08
    : profile.stageName === 'frame' ? 0.08
      : profile.stageName === 'partial-walls' ? 0.025
        : profile.stageName === 'roof' ? 0.13 : 0.04;
  const stageCrouch = profile.stageName === 'foundation' ? 0.08
    : profile.stageName === 'partial-walls' ? 0.035 : 0;
  const cycles = profile.stageName === 'partial-walls' ? 3 : profile.stageName === 'roof' ? 2.4 : 2;
  const effort = profile.finishing ? 0.55 : 1;
  const pulse = Math.max(0, Math.sin(p * Math.PI * cycles - 0.8)) * effort;
  const reach = Math.sin(p * Math.PI);
  motion.basket = 0; motion.held = 0; motion.reposition = p > 0.94;

  if (profile.assemblyMotion === 'pack') {
    const tampCycles = profile.stageName === 'partial-walls' ? 4 : 3;
    const tamp = Math.max(0, Math.sin(p * Math.PI * tampCycles - 0.5)) * effort;
    motion.crouch = 0.08 + stageCrouch + reach * 0.08;
    motion.lean = 0.15 + tamp * 0.12;
    motion.twist = Math.sin(p * Math.PI * 2) * 0.08 * variation;
    motion.handY = 0.4 + stageReach - tamp * 0.18;
    motion.handZ = 0.3 + reach * 0.09;
    motion.toolAngle = 1.6;
    motion.impact = tamp * 0.72;
    return;
  }

  if (profile.assemblyMotion === 'place') {
    motion.crouch = stageCrouch + reach * 0.07;
    motion.lean = 0.08 + reach * 0.12;
    motion.twist = Math.sin(p * Math.PI * 2) * 0.09 * variation;
    motion.handY = 0.48 + stageReach - stageCrouch - reach * 0.1 + pulse * 0.05;
    motion.handZ = 0.27 + reach * 0.12;
    motion.toolAngle = 0.95 + pulse * 0.75;
    motion.impact = pulse * (profile.material === 'ceramic' ? 0.28 : 0.62);
    return;
  }

  const fit = profile.assemblyMotion === 'fit';
  motion.crouch = stageCrouch * 0.5 + reach * (fit ? 0.04 : 0.055);
  motion.lean = pulse * (fit ? 0.14 : 0.1);
  motion.twist = pulse * (fit ? 0.16 : 0.2) * variation;
  motion.handY = 0.52 + stageReach + pulse * (fit ? 0.18 : 0.24);
  motion.handZ = 0.21 + reach * 0.08;
  motion.toolAngle = 0.55 + pulse * (fit ? 1.05 : 1.45);
  motion.impact = pulse * (fit ? 0.78 : 0.9);
}

function applyPrepMotion(
  profile: ConstructionChoreographyProfile,
  p: number,
  personId: string,
  motion: ResourceWorkMotion,
): void {
  const variation = 0.9 + resourceVisualUnit(personId) * 0.2;
  const prepCycles = profile.stageName === 'foundation' ? 2.4
    : profile.stageName === 'frame' ? 3.2
      : profile.stageName === 'partial-walls' ? 3.8
        : profile.stageName === 'roof' ? 3.4 : 2.6;
  const effort = profile.finishing ? 0.55 : 1;
  const stroke = Math.max(0, Math.sin(p * Math.PI * prepCycles - 0.7)) * effort;
  const reach = Math.sin(p * Math.PI);
  const stageLift = profile.stageName === 'roof' ? 0.09 : profile.stageName === 'frame' ? 0.045 : 0;
  motion.basket = 0; motion.held = 0; motion.reposition = p > 0.92;

  if (profile.prepMotion === 'cut') {
    motion.crouch = 0.06 + reach * 0.06;
    motion.lean = 0.1 + stroke * 0.13;
    motion.twist = stroke * 0.22 * variation;
    motion.handY = 0.5 + stageLift + stroke * 0.16;
    motion.handZ = 0.28;
    motion.toolAngle = 0.65 + stroke * 1.4;
    motion.impact = stroke * 0.88;
    return;
  }
  if (profile.prepMotion === 'dress') {
    motion.crouch = 0.09 + reach * 0.08;
    motion.lean = 0.12 + stroke * 0.09;
    motion.twist = stroke * 0.12 * variation;
    motion.handY = 0.42 + stageLift + stroke * 0.12;
    motion.handZ = 0.31;
    motion.toolAngle = 0.85 + stroke * 0.95;
    motion.impact = stroke * (profile.material === 'metal' ? 0.76 : 0.58);
    return;
  }
  if (profile.prepMotion === 'sort') {
    motion.crouch = 0.08 + reach * 0.08;
    motion.lean = 0.16 + reach * 0.08;
    motion.twist = Math.sin(p * Math.PI * 2) * 0.18 * variation;
    motion.handY = 0.4 + stageLift * 0.5 - reach * 0.1;
    motion.handZ = 0.3 + reach * 0.12;
    motion.toolAngle = 1.8;
    motion.impact = 0;
    return;
  }
  motion.crouch = 0.12 + reach * 0.1;
  motion.lean = 0.18 + reach * 0.09;
  motion.twist = Math.sin(p * Math.PI * 2) * 0.1 * variation;
  motion.handY = 0.36 + stageLift * 0.4 - reach * 0.12;
  motion.handZ = 0.32 + reach * 0.1;
  motion.toolAngle = 1.7;
  motion.impact = stroke * 0.35;
}

function contactSurface(from: Readonly<{ x: number; z: number }>, center: Readonly<{ x: number; z: number }>): { x: number; z: number } {
  const length = Math.hypot(center.x - from.x, center.z - from.z) || 1;
  return { x: from.x + (center.x - from.x) / length * 0.13, z: from.z + (center.z - from.z) / length * 0.13 };
}

export function constructionFacing(action: PhysicalActionPresentation): number {
  return facingTarget(action.locomotionTarget, action.interactionAnchor);
}
