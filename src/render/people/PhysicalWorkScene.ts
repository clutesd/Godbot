import type { Person, Settlement, Vec2, WeatherCellState } from '../../sim/types';
import type { DevelopmentProject } from '../../sim/development/types';
import { developmentPresentationEra } from '../assets/BuildingGrammar';
import { constructionStagePresentation } from '../construction/ConstructionVisualGrammar';
import type { FarmGeometry } from '../../shared/FarmGeometry';
import { farmerCanPresent, sampleFarmAction, type FarmPresentationState } from '../farming/FarmActionPresentation';
import { advanceConstruction, builderCanPresent, constructionBlockedReason, constructionPresentedMaterial, CONSTRUCTION_HANDOFF_SECONDS, createConstructionPlayback, sampleConstructionAction, type ConstructionHandoffCue, type ConstructionPlayback } from '../construction/ConstructionActionPresentation';
import { constructionWorkerLane, rotateConstructionAnchor, type ConstructionWorkerAnchors } from '../construction/ConstructionWorkerMotion';
import { constructionHandoffRecipientId, reconcileConstructionCrewRoles, constructionWorkfaceIndex, type ConstructionCrewAssignment, type ConstructionCrewAuthority, type ConstructionCrewRole } from '../construction/ConstructionCrewPresentation';
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

function constructionAnchorsFor(
  placement: WorkPlacement,
  project: DevelopmentProject,
  personId: string,
  handoffRecipientId?: string,
): ConstructionWorkerAnchors {
  const center = { x: placement.worldX, z: placement.worldZ };
  const workWidth = placement.constructionWidth ?? placement.width;
  const workDepth = placement.constructionDepth ?? placement.depth;
  const local = constructionWorksiteAnchors(
    workWidth, workDepth, project.plotId,
    constructionWorkerLane(personId), constructionWorkfaceIndex(project.plotId, personId), project.progress,
  );
  const recipientLocal = handoffRecipientId
    ? constructionWorksiteAnchors(
      workWidth, workDepth, project.plotId,
      constructionWorkerLane(handoffRecipientId), constructionWorkfaceIndex(project.plotId, handoffRecipientId), project.progress,
    )
    : local;
  const rotate = (p: Vec2) => rotateConstructionAnchor(p, center, placement.rotationY);
  return {
    pickup: rotate(local.pickup),
    delivery: rotate(recipientLocal.delivery),
    handoff: rotate(recipientLocal.handoff),
    materialCenter: rotate(local.materialCenter),
    prep: rotate(local.prep),
    prepCenter: rotate(local.prepCenter),
    siteCenter: center,
  };
}

/** Bounded renderer continuity only. Revalidated against live authority on every visible frame. */
export class PhysicalWorkScene {
  private readonly workers = new Map<string, PhysicalWorker>();
  private readonly constructionRoleAssignments = new WeakMap<DevelopmentProject, Map<string, ConstructionCrewAssignment>>();
  private readonly constructionAuthorityBySettlement = new Map<string, {
    project: DevelopmentProject;
    assignments: Map<string, ConstructionCrewAssignment>;
  }>();

  /**
   * Reconcile project roles from the full simulation workforce, not the rendered population.
   * The renderer calls this only with its visibility refresh cadence, so city-scale populations are
   * not scanned every animation frame. Commuters remain in the roster and therefore keep their job.
   */
  refreshConstructionCrewAuthority(people: readonly Person[], settlements: readonly Settlement[]): void {
    this.constructionAuthorityBySettlement.clear();
    for (const settlement of settlements) {
      const project = settlement.alive ? settlement.development?.project : undefined;
      if (!project || project.progress >= 1) continue;
      const candidateIds = people
        .filter(person => person.alive
          && person.homeId === settlement.id
          && person.activity === 'construct'
          && person.navigation?.destinationKind === 'construction-site'
          && (person.navigation.destinationId === project.plotId
            || person.navigation.destinationId === `${settlement.id}:construction-site`))
        .map(person => person.id);
      if (candidateIds.length === 0) continue;
      const previous = this.constructionRoleAssignments.get(project);
      const assignments = reconcileConstructionCrewRoles(project.plotId, candidateIds, previous);
      this.constructionRoleAssignments.set(project, assignments);
      this.constructionAuthorityBySettlement.set(settlement.id, { project, assignments });
    }
  }

  constructionCrewAuthority(): ConstructionCrewAuthority {
    const authority = new Map<string, ReadonlyMap<string, ConstructionCrewAssignment>>();
    for (const [settlementId, entry] of this.constructionAuthorityBySettlement) {
      authority.set(settlementId, entry.assignments);
    }
    return authority;
  }

  constructionCrewAssignment(settlementId: string, personId: string): ConstructionCrewAssignment | undefined {
    const assignment = this.constructionAuthorityBySettlement.get(settlementId)?.assignments.get(personId);
    return assignment ? { ...assignment } : undefined;
  }

  beginFrame(people?: readonly Person[], settlements?: readonly Settlement[]): void {
    // Test/tool convenience: callers may refresh authority here. Runtime supplies no arguments
    // because refreshVisiblePeople already reconciled against state.people.
    if (people && settlements) this.refreshConstructionCrewAuthority(people, settlements);
    for (const worker of this.workers.values()) worker.seen = false;
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
      const authority = this.constructionAuthorityBySettlement.get(settlement.id);
      assignments = authority?.project === project ? authority.assignments : this.constructionRoleAssignments.get(project);

      // Same-month newcomers can appear before the next visibility refresh. Extend the existing
      // authority minimally instead of recomputing from the visible subset.
      if (!assignments?.has(person.id)) {
        const previous = assignments ?? new Map<string, ConstructionCrewAssignment>();
        assignments = reconcileConstructionCrewRoles(project.plotId, [...previous.keys(), person.id], previous);
        this.constructionRoleAssignments.set(project, assignments);
        this.constructionAuthorityBySettlement.set(settlement.id, { project, assignments });
      }
      crew = assignments.get(person.id) ?? { role: 'hauler', rank: 0 };
    }
    const crewSize = assignments?.size ?? 1;
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
        const anchors = constructionAnchorsFor(placement, project, person.id, handoffRecipientId);
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
    if (builder && project && placement && worker.playback) {
      const candidateAnchors = constructionAnchorsFor(placement, project, person.id, worker.handoffRecipientId);
      const blocked = constructionBlockedReason(settlement);
      const material = constructionPresentedMaterial(settlement);
      const candidateCrewSize = crewSize;
      const candidatePlayback: ConstructionPlayback = { ...worker.playback };
      const candidateMotion: ResourceWorkMotion = { ...worker.motion };
      advanceConstruction(candidatePlayback, 0, false, !!blocked, worker.crewRole, candidateCrewSize, true,
        constructionStagePresentation(project.progress).finishing);
      const handoff = !blocked && worker.crewRole === 'assembler' ? this.handoffFor(project, person.id) : undefined;
      const candidateAction = sampleConstructionAction(person, project.plotId, candidatePlayback, candidateAnchors,
        material, candidateMotion, blocked, worker.crewRole, candidateCrewSize, project.progress,
        handoff, developmentPresentationEra(project.response));

      // Stage migration is presentation-only, but its new path must satisfy the same safety contract
      // as initial construction placement. Derive everything on temporary copies first; an unsafe
      // transition fails closed without changing anchors, playback or pose and can be retried later.
      const migrationSafe = safeSegment(worker.action.locomotionTarget, candidateAction.locomotionTarget);
      const haulCorridorSafe = worker.crewRole !== 'hauler'
        || safeSegment(candidateAnchors.pickup, candidateAnchors.handoff);
      if (!migrationSafe || !haulCorridorSafe) return undefined;

      worker.anchors = candidateAnchors;
      worker.material = material;
      worker.crewSize = candidateCrewSize;
      Object.assign(worker.playback, candidatePlayback);
      Object.assign(worker.motion, candidateMotion);
      worker.action = candidateAction;
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
        advanceConstruction(worker.playback, delta, ready, !!action.blockedReason, worker.crewRole, worker.crewSize, handoffReady,
          constructionStagePresentation(worker.project!.progress).finishing);
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
