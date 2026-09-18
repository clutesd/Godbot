import type { Person, Settlement, Vec2, WeatherCellState } from '../../sim/types';
import type { DevelopmentProject } from '../../sim/development/types';
import { developmentPresentationEra } from '../assets/BuildingGrammar';
import type { FarmGeometry } from '../../shared/FarmGeometry';
import { farmerCanPresent, sampleFarmAction, type FarmPresentationState } from '../farming/FarmActionPresentation';
import { advanceConstruction, builderCanPresent, constructionBlockedReason, constructionPresentedMaterial, CONSTRUCTION_HANDOFF_SECONDS, createConstructionPlayback, sampleConstructionAction, type ConstructionHandoffCue, type ConstructionPlayback } from '../construction/ConstructionActionPresentation';
import { constructionWorkerLane, rotateConstructionAnchor, type ConstructionWorkerAnchors } from '../construction/ConstructionWorkerMotion';
import { constructionHandoffRecipientId, reconcileConstructionCrewRoles, constructionWorkfaceIndex, type ConstructionCrewAssignment, type ConstructionCrewRole } from '../construction/ConstructionCrewPresentation';
import { constructionWorksiteAnchors } from '../construction/ConstructionWorksite';
import { createResourceWorkMotion, type ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { atInteraction, facingTarget, type PhysicalActionPresentation } from './PhysicalActionPresentation';
import type { PersonVisualState } from './PeopleVisualState';

export interface WorkPlacement { key: string; worldX: number; worldZ: number; width: number; depth: number; constructionWidth?: number; constructionDepth?: number; rotationY: number }
export interface PhysicalWorker {
  action: PhysicalActionPresentation;
  motion: ResourceWorkMotion;
  seconds: number;
  blend: number;
  ready: boolean;
  seen: boolean;
  project?: DevelopmentProject;
  anchors?: ConstructionWorkerAnchors;
  playback?: ConstructionPlayback;
  field?: FarmGeometry;
  fieldState?: FarmPresentationState;
  crewRole: ConstructionCrewRole;
  crewRank: number;
  crewSize: number;
  handoffRecipientId?: string;
  material?: import('../../sim/development/types').StructureMaterial;
}

/** Bounded renderer continuity only. Revalidated against live authority on every visible frame. */
export class PhysicalWorkScene {
  private readonly workers = new Map<string, PhysicalWorker>();
  private readonly constructionCrewCandidates = new Map<string, Person[]>();
  private readonly constructionRoleAssignments = new WeakMap<DevelopmentProject, Map<string, ConstructionCrewAssignment>>();
  beginFrame(people: readonly Person[]): void {
    for (const worker of this.workers.values()) worker.seen = false;
    this.constructionCrewCandidates.clear();
    // Keep commuters in the project roster. Travel prevents animation contact, but it must not
    // change someone's job simply because they are still walking to the site this frame.
    for (const person of people) if (person.alive && person.activity === 'construct'
      && person.navigation?.destinationKind === 'construction-site') {
      const crew = this.constructionCrewCandidates.get(person.homeId) ?? [];
      crew.push(person);
      this.constructionCrewCandidates.set(person.homeId, crew);
    }
  }
  plan(person: Person, settlement: Settlement | undefined, placement: WorkPlacement | undefined,
    farm: { geometry: FarmGeometry; state: FarmPresentationState } | undefined, weather: WeatherCellState | undefined,
    safeSegment: (a: Vec2, b: Vec2) => boolean): PhysicalWorker | undefined {
    const builder = settlement && placement && builderCanPresent(person, settlement, weather);
    const farmer = farm && farmerCanPresent(person, farm.geometry, farm.state, weather);
    if (!builder && !farmer) { this.workers.delete(person.id); return undefined; }
    let worker = this.workers.get(person.id);
    const project = builder ? settlement.development!.project : undefined;
    let crew: ConstructionCrewAssignment | undefined;
    let assignments: Map<string, ConstructionCrewAssignment> | undefined;
    if (builder && project) {
      const candidates = (this.constructionCrewCandidates.get(person.homeId) ?? [person])
        .filter(candidate => candidate.navigation?.destinationKind === 'construction-site'
          && (candidate.navigation.destinationId === project.plotId
            || candidate.navigation.destinationId === `${settlement.id}:construction-site`))
        .map(candidate => candidate.id);
      const previous = this.constructionRoleAssignments.get(project);
      assignments = reconcileConstructionCrewRoles(project.plotId, candidates.length > 0 ? candidates : [person.id], previous);
      this.constructionRoleAssignments.set(project, assignments);
      crew = assignments.get(person.id) ?? { role: 'hauler', rank: 0 };
    }
    const crewSize = builder && project ? this.constructionRoleAssignments.get(project)?.size ?? 1 : 1;
    const handoffRecipientId = builder && project && assignments && crew?.role === 'hauler'
      ? constructionHandoffRecipientId(person.id, assignments) : undefined;
    if (worker && (worker.project !== project || worker.field?.id !== (farmer ? farm.geometry.id : undefined)
      || builder && (worker.crewRole !== crew?.role || worker.handoffRecipientId !== handoffRecipientId))) {
      this.workers.delete(person.id); worker = undefined;
    }
    if (!worker) {
      if (this.workers.size >= 128) return undefined;
      const motion = createResourceWorkMotion();
      if (builder && project) {
        const center = { x: placement.worldX, z: placement.worldZ };
        const lane = constructionWorkerLane(person.id);
        const workface = constructionWorkfaceIndex(project.plotId, person.id);
        const workWidth = placement.constructionWidth ?? placement.width;
        const workDepth = placement.constructionDepth ?? placement.depth;
        const local = constructionWorksiteAnchors(workWidth, workDepth, project.plotId, lane, workface);
        const recipientLocal = handoffRecipientId
          ? constructionWorksiteAnchors(workWidth, workDepth, project.plotId,
            constructionWorkerLane(handoffRecipientId), constructionWorkfaceIndex(project.plotId, handoffRecipientId))
          : local;
        const rotate = (p: Vec2) => rotateConstructionAnchor(p, center, placement.rotationY);
        const anchors = {
          pickup: rotate(local.pickup), delivery: rotate(recipientLocal.delivery), handoff: rotate(recipientLocal.handoff),
          materialCenter: rotate(local.materialCenter), prep: rotate(local.prep), prepCenter: rotate(local.prepCenter), siteCenter: center,
        };
        const crewRole = crew?.role ?? 'hauler';
        const initialTarget = crewRole === 'hauler' ? anchors.pickup : crewRole === 'assembler' ? anchors.delivery : anchors.prep;
        if (!safeSegment(person.position, initialTarget)
          || crewRole === 'hauler' && !safeSegment(anchors.pickup, anchors.handoff)) return undefined;
        const playback = createConstructionPlayback();
        if (crewRole === 'assembler') playback.phase = 'assemble';
        if (crewRole === 'site-worker') playback.phase = 'inspect';
        worker = { motion, project, anchors, playback, crewRole, crewRank: crew?.rank ?? 0, crewSize, handoffRecipientId,
          material: constructionPresentedMaterial(settlement!), seconds: 0, blend: 0, ready: false, seen: true,
          action: sampleConstructionAction(person, project.plotId, playback, anchors, constructionPresentedMaterial(settlement!), motion,
            undefined, crewRole, crewSize, project.progress, undefined, developmentPresentationEra(project.response)) };
      } else if (farmer) {
        const action = sampleFarmAction(person, farm.geometry, farm.state, 0, motion);
        if (!safeSegment(person.position, action.locomotionTarget)) return undefined;
        worker = { motion, action, field: farm.geometry, fieldState: farm.state, seconds: 0, blend: 0, ready: false, seen: true, crewRole: 'hauler', crewRank: 0, crewSize: 1 };
      }
      if (!worker) return undefined;
      this.workers.set(person.id, worker);
    }
    worker.seen = true;
    if (builder && worker.playback) {
      const blocked = constructionBlockedReason(settlement);
      worker.material = constructionPresentedMaterial(settlement);
      worker.crewSize = crewSize;
      advanceConstruction(worker.playback, 0, false, !!blocked, worker.crewRole, worker.crewSize);
      const handoff = !blocked && worker.crewRole === 'assembler' ? this.handoffFor(project!, person.id) : undefined;
      worker.action = sampleConstructionAction(person, project!.plotId, worker.playback, worker.anchors!,
        constructionPresentedMaterial(settlement), worker.motion, blocked, worker.crewRole, worker.crewSize, project!.progress,
        handoff, developmentPresentationEra(project!.response));
    } else if (farmer) {
      worker.fieldState = farm.state;
      const action = sampleFarmAction(person, farm.geometry, farm.state, worker.seconds, worker.motion);
      if (!safeSegment(worker.action.locomotionTarget, action.locomotionTarget)) { this.workers.delete(person.id); return undefined; }
      worker.action = action;
    }
    return worker;
  }
  advance(person: Person, worker: PhysicalWorker, visual: PersonVisualState, delta: number): void {
    const action = worker.action;
    worker.ready = atInteraction(visual, action.locomotionTarget, visual.facing, facingTarget(action.locomotionTarget, action.interactionAnchor), visual.speed) && !visual.traveling;
    worker.blend = Math.max(0, Math.min(1, worker.blend + (worker.ready ? 1 : -1) * Math.max(0, delta) / 0.25));
    // Acquisition/placement only starts once the approach blend has settled.
    const ready = worker.ready && worker.blend >= 1;
    if (worker.playback) {
      const handoff = !action.blockedReason && worker.crewRole === 'assembler'
        ? this.handoffFor(worker.project!, person.id) : undefined;
      // Receiving is renderer-owned coordination. Freeze the assembler's ordinary loop while the
      // hauler physically transfers the visible load, then resume assembly from the same state.
      if (!handoff) {
        const handoffReady = !worker.handoffRecipientId
          || this.handoffRecipientReady(worker.project!, worker.handoffRecipientId);
        advanceConstruction(worker.playback, delta, ready, !!action.blockedReason, worker.crewRole, worker.crewSize, handoffReady);
      }
      worker.action = sampleConstructionAction(person, worker.project!.plotId, worker.playback, worker.anchors!,
        worker.material!, worker.motion, action.blockedReason, worker.crewRole, worker.crewSize, worker.project!.progress,
        handoff, developmentPresentationEra(worker.project!.response));
    } else if (ready && worker.field) {
      worker.seconds += Math.max(0, Math.min(0.1, delta));
      // New anchors take effect in plan next frame, so a recovery never jumps straight into contact.
    }
  }
  private handoffRecipientReady(project: DevelopmentProject, recipientId: string): boolean {
    const recipient = this.workers.get(recipientId);
    return Boolean(recipient && recipient.project === project && recipient.crewRole === 'assembler'
      && recipient.ready && !recipient.action.blockedReason);
  }
  private handoffFor(project: DevelopmentProject, recipientId: string): ConstructionHandoffCue | undefined {
    const source = [...this.workers.entries()]
      .filter(([, worker]) => worker.project === project && worker.crewRole === 'hauler'
        && worker.handoffRecipientId === recipientId && worker.playback?.phase === 'handoff' && worker.material)
      .sort((a, b) => a[1].crewRank - b[1].crewRank || a[0].localeCompare(b[0]))[0];
    if (!source?.[1].playback || !source[1].material) return undefined;
    return {
      sourcePersonId: source[0],
      progress: Math.min(1, source[1].playback.seconds / CONSTRUCTION_HANDOFF_SECONDS),
      material: source[1].material,
    };
  }
  inspect(personId: string): PhysicalActionPresentation | undefined {
    const action = this.workers.get(personId)?.action;
    return action ? { ...action, interactionAnchor: { ...action.interactionAnchor }, locomotionTarget: { ...action.locomotionTarget } } : undefined;
  }
  endFrame(): void { for (const [id, worker] of this.workers) if (!worker.seen) this.workers.delete(id); }
}
