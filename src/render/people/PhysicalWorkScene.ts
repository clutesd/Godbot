import type { Person, Settlement, Vec2, WeatherCellState } from '../../sim/types';
import type { DevelopmentProject } from '../../sim/development/types';
import type { FarmGeometry } from '../../shared/FarmGeometry';
import { farmerCanPresent, sampleFarmAction, type FarmPresentationState } from '../farming/FarmActionPresentation';
import { advanceConstruction, builderCanPresent, constructionBlockedReason, constructionPresentedMaterial, createConstructionPlayback, sampleConstructionAction, type ConstructionPlayback } from '../construction/ConstructionActionPresentation';
import { constructionWorkerLane, rotateConstructionAnchor, type ConstructionWorkerAnchors } from '../construction/ConstructionWorkerMotion';
import { assignConstructionCrewRoles, constructionWorkfaceIndex, type ConstructionCrewRole } from '../construction/ConstructionCrewPresentation';
import { constructionWorksiteAnchors } from '../construction/ConstructionWorksite';
import { createResourceWorkMotion, type ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { atInteraction, facingTarget, type PhysicalActionPresentation } from './PhysicalActionPresentation';
import type { PersonVisualState } from './PeopleVisualState';

export interface WorkPlacement { key: string; worldX: number; worldZ: number; width: number; depth: number; rotationY: number }
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
  material?: import('../../sim/development/types').StructureMaterial;
}

/** Bounded renderer continuity only. Revalidated against live authority on every visible frame. */
export class PhysicalWorkScene {
  private readonly workers = new Map<string, PhysicalWorker>();
  private readonly constructionCrews = new Map<string, string[]>();
  beginFrame(people: readonly Person[]): void {
    for (const worker of this.workers.values()) worker.seen = false;
    this.constructionCrews.clear();
    // SettlementDevelopmentSystem permits only one funded project per settlement. Normalize both
    // accepted navigation forms (plot id and generic construction-site id) into that one visible crew.
    for (const person of people) if (person.alive && person.activity === 'construct' && !person.navigation?.traveling) {
      const crew = this.constructionCrews.get(person.homeId) ?? [];
      crew.push(person.id);
      this.constructionCrews.set(person.homeId, crew);
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
    const crew = builder && project
      ? assignConstructionCrewRoles(project.plotId, this.constructionCrews.get(person.homeId) ?? [person.id]).get(person.id)
        ?? { role: 'hauler' as const, rank: 0 }
      : undefined;
    if (worker && (worker.project !== project || worker.field?.id !== (farmer ? farm.geometry.id : undefined)
      || builder && worker.crewRole !== crew?.role)) {
      this.workers.delete(person.id); worker = undefined;
    }
    if (!worker) {
      if (this.workers.size >= 128) return undefined;
      const motion = createResourceWorkMotion();
      if (builder && project) {
        const center = { x: placement.worldX, z: placement.worldZ };
        const lane = constructionWorkerLane(person.id);
        const workface = constructionWorkfaceIndex(project.plotId, person.id);
        const local = constructionWorksiteAnchors(placement.width, placement.depth, project.plotId, lane, workface);
        const rotate = (p: Vec2) => rotateConstructionAnchor(p, center, placement.rotationY);
        const anchors = {
          pickup: rotate(local.pickup), delivery: rotate(local.delivery), materialCenter: rotate(local.materialCenter),
          prep: rotate(local.prep), prepCenter: rotate(local.prepCenter), siteCenter: center,
        };
        const crewRole = crew?.role ?? 'hauler';
        const initialTarget = crewRole === 'hauler' ? anchors.pickup : crewRole === 'assembler' ? anchors.delivery : anchors.prep;
        if (!safeSegment(person.position, initialTarget)
          || crewRole === 'hauler' && !safeSegment(anchors.pickup, anchors.delivery)) return undefined;
        const playback = createConstructionPlayback();
        if (crewRole === 'assembler') playback.phase = 'assemble';
        if (crewRole === 'site-worker') playback.phase = 'inspect';
        worker = { motion, project, anchors, playback, crewRole, crewRank: crew?.rank ?? 0,
          material: constructionPresentedMaterial(settlement!), seconds: 0, blend: 0, ready: false, seen: true,
          action: sampleConstructionAction(person, project.plotId, playback, anchors, constructionPresentedMaterial(settlement!), motion, undefined, crewRole) };
      } else if (farmer) {
        const action = sampleFarmAction(person, farm.geometry, farm.state, 0, motion);
        if (!safeSegment(person.position, action.locomotionTarget)) return undefined;
        worker = { motion, action, field: farm.geometry, fieldState: farm.state, seconds: 0, blend: 0, ready: false, seen: true, crewRole: 'hauler', crewRank: 0 };
      }
      if (!worker) return undefined;
      this.workers.set(person.id, worker);
    }
    worker.seen = true;
    if (builder && worker.playback) {
      const blocked = constructionBlockedReason(settlement);
      worker.material = constructionPresentedMaterial(settlement);
      advanceConstruction(worker.playback, 0, false, !!blocked, worker.crewRole);
      worker.action = sampleConstructionAction(person, project!.plotId, worker.playback, worker.anchors!, constructionPresentedMaterial(settlement), worker.motion, blocked, worker.crewRole);
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
      advanceConstruction(worker.playback, delta, ready, !!action.blockedReason, worker.crewRole);
      worker.action = sampleConstructionAction(person, worker.project!.plotId, worker.playback, worker.anchors!, worker.material!, worker.motion, action.blockedReason, worker.crewRole);
    } else if (ready && worker.field) {
      worker.seconds += Math.max(0, Math.min(0.1, delta));
      // New anchors take effect in plan next frame, so a recovery never jumps straight into contact.
    }
  }
  inspect(personId: string): PhysicalActionPresentation | undefined {
    const action = this.workers.get(personId)?.action;
    return action ? { ...action, interactionAnchor: { ...action.interactionAnchor }, locomotionTarget: { ...action.locomotionTarget } } : undefined;
  }
  endFrame(): void { for (const [id, worker] of this.workers) if (!worker.seen) this.workers.delete(id); }
}
