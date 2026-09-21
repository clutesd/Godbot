import * as THREE from 'three';
import { arrivalCameraPose } from './founding/ArrivalPresentation';
import { campaignFocus } from '../sim/war/Campaign';
import type { GodboxConfig } from '../config';
import type { Historian } from '../historian/Historian';
import type { AudioCategory, HistorianStatement, ObservationCandidate, ObservationKind } from '../historian/types';
import type { SimulationState } from '../sim/types';
import { cellAt } from '../sim/world';
import type { PhysicalActionPresentation } from './people/PhysicalActionPresentation';

export interface CurrentObservation {
  label: string;
  detail: string;
  kind: ObservationKind;
  interest: number;
  audioCategory: AudioCategory;
  revision: number;
  sceneId?: string;
  statement?: HistorianStatement;
  eventType?: SimulationState['history'][number]['type'];
  eventMonth?: number;
}

export interface CameraFraming {
  radius: readonly [number, number];
  height: readonly [number, number];
  targetHeight: number;
  durationScale: number;
}

export interface CameraClearance {
  lens: number;
  sightline: number;
}

export interface CameraSubjectPresentation {
  readonly x: number;
  readonly z: number;
  readonly footY: number;
  readonly action?: PhysicalActionPresentation;
}

export type CameraSubjectPresentationResolver = (personId: string) => CameraSubjectPresentation | undefined;

export interface InteractionCameraComposition {
  readonly focusX: number;
  readonly focusZ: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly azimuth: number;
  readonly distanceBoost: number;
  readonly contactLock: number;
  readonly anchorWeight: number;
  readonly span: number;
}

type CameraMotion = 'hold' | 'drift' | 'truck' | 'dolly-in' | 'dolly-out' | 'crane' | 'orbit' | 'follow' | 'pullback';

const FRAMING: Record<ObservationKind, CameraFraming> = {
  'world-establishing': { radius: [46, 62], height: [42, 58], targetHeight: 1, durationScale: 1.25 },
  'regional-travel': { radius: [22, 31], height: [19, 28], targetHeight: 0.8, durationScale: 1.15 },
  'settlement-approach': { radius: [15, 22], height: [12, 19], targetHeight: 1.2, durationScale: 1 },
  // Human-scale shots intentionally break from the old aerial grammar. These dimensions are in
  // world units: close people should read as subjects, not colored pixels inside a settlement.
  'street-observation': { radius: [3.4, 5.4], height: [1.25, 2.0], targetHeight: 0.16, durationScale: 1.1 },
  'worker-follow': { radius: [1.8, 2.8], height: [0.52, 0.82], targetHeight: 0.14, durationScale: 1.12 },
  'traveler-follow': { radius: [4.2, 6.4], height: [1.8, 2.8], targetHeight: 0.18, durationScale: 1.08 },
  'institution-exterior': { radius: [10, 16], height: [8, 13], targetHeight: 1.2, durationScale: 1.24 },
  'discovery-scene': { radius: [1.9, 3.0], height: [0.58, 0.9], targetHeight: 0.14, durationScale: 1.35 },
  'battle-overview': { radius: [24, 34], height: [21, 31], targetHeight: 1, durationScale: 1.3 },
  'aftermath-pullback': { radius: [30, 42], height: [27, 39], targetHeight: 0.7, durationScale: 1.4 },
  'city-growth-timelapse': { radius: [20, 29], height: [17, 25], targetHeight: 1.4, durationScale: 1.35 },
  'night-transition': { radius: [27, 38], height: [24, 34], targetHeight: 0.8, durationScale: 1.18 },
  'infrastructure-scene': { radius: [9, 15], height: [7, 12], targetHeight: 0.8, durationScale: 1.25 },
  'landscape-pause': { radius: [30, 44], height: [28, 40], targetHeight: 0.6, durationScale: 1.18 },
  'atomic-threshold': { radius: [12, 18], height: [9, 14], targetHeight: 1.1, durationScale: 1.55 },
  'orbital-establishing': { radius: [48, 66], height: [48, 68], targetHeight: 0.6, durationScale: 1.55 },
  'civilization-ending': { radius: [46, 64], height: [42, 60], targetHeight: 0.7, durationScale: 1.7 },
  'historian-context': { radius: [32, 45], height: [30, 43], targetHeight: 0.8, durationScale: 1.3 },
};

const DOCUMENTARY_BREAK_TYPES = new Set([
  'discovery', 'knowledge-lost', 'knowledge-rediscovered', 'knowledge-adopted', 'technology-transformation', 'industrialization-stage', 'industrialization', 'infrastructure-built', 'archive-destroyed',
  'institution-formed', 'alliance-formed', 'alliance-ended', 'political-transition', 'leadership-succession', 'war-declared', 'war-campaign', 'battle', 'war-ended',
  'settlement-founded', 'settlement-abandoned', 'major-migration', 'first-contact', 'harvest-crisis', 'recovery', 'cultural-shift',
  'statistical-transition', 'atomic-threshold', 'nuclear-energy', 'nuclear-weapons-developed', 'nuclear-restraint', 'nuclear-crisis',
  'nuclear-use', 'nuclear-exchange', 'pandemic', 'ecological-crisis', 'climate-crisis', 'resource-crisis', 'autonomous-weapons-crisis',
  'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition', 'fermi-question',
  'natural-catastrophe', 'civilization-collapse', 'planetary-stability', 'post-biological-transition', 'observation-lost', 'outcome-classified',
]);

/** Close and medium shots where a dense canopy can hide the actual documentary subject. */
const FOREST_AWARE_KINDS = new Set<ObservationKind>([
  'settlement-approach',
  'street-observation',
  'worker-follow',
  'traveler-follow',
  'institution-exterior',
  'discovery-scene',
  'infrastructure-scene',
  'atomic-threshold',
]);

/** Preserve the authored angle when possible; only search nearby compositions. */
const FOREST_AZIMUTH_OFFSETS = [
  0,
  Math.PI / 7.2, -Math.PI / 7.2,
  Math.PI / 3.6, -Math.PI / 3.6,
  Math.PI / 2, -Math.PI / 2,
  Math.PI,
] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function cameraFramingFor(kind: ObservationKind): CameraFraming {
  return FRAMING[kind];
}

export function cameraClearanceFor(kind: ObservationKind | undefined): CameraClearance {
  if (kind === 'worker-follow' || kind === 'discovery-scene') return { lens: 0.42, sightline: 0.12 };
  if (kind === 'street-observation') return { lens: 0.72, sightline: 0.22 };
  if (kind === 'traveler-follow') return { lens: 1.1, sightline: 0.36 };
  return { lens: 3, sightline: 1.6 };
}

export function cameraTargetFloorFor(kind: ObservationKind | undefined): number {
  if (kind === 'worker-follow' || kind === 'discovery-scene') return 0.08;
  if (kind === 'street-observation' || kind === 'traveler-follow') return 0.12;
  return 0.35;
}

export function cameraTransitionScaleFor(kind: ObservationKind | undefined): number {
  if (kind === 'worker-follow' || kind === 'discovery-scene') return 0.44;
  if (kind === 'street-observation') return 0.58;
  if (kind === 'traveler-follow') return 0.68;
  return 1;
}

export interface FoundingEditorialTiming {
  readonly durationSeconds: number;
  readonly transitionSeconds: number;
}

/**
 * Arrival Day is an authored opening montage, not an ordinary documentary rotation.
 * Keep the descent cinematic intact, then move quickly through the post-title orientation.
 */
export function foundingEditorialTimingFor(sceneId: string | undefined): FoundingEditorialTiming | undefined {
  if (!sceneId) return undefined;
  if (sceneId.startsWith('founding:overview:')) return { durationSeconds: 9.5, transitionSeconds: 2.4 };
  if (sceneId.startsWith('founding:community:')) return { durationSeconds: 5.8, transitionSeconds: 1.8 };
  if (sceneId.startsWith('founding-cast:framing:')) return { durationSeconds: 4.6, transitionSeconds: 1.5 };
  if (sceneId.startsWith('founding-cast:introduction:')) return { durationSeconds: 3.8, transitionSeconds: 1.1 };
  return undefined;
}

function angularDistance(a: number, b: number): number {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

/**
 * Frames an actor and the thing they are actually interacting with as one documentary subject.
 * Very distant work targets are capped so the camera never sacrifices the human-scale language
 * just to keep an entire route or worksite in frame.
 */
export function interactionCameraComposition(
  actor: Readonly<{ x: number; z: number }>,
  action: PhysicalActionPresentation,
  baseAzimuth: number,
): InteractionCameraComposition {
  const dx = action.interactionAnchor.x - actor.x;
  const dz = action.interactionAnchor.z - actor.z;
  const rawSpan = Math.hypot(dx, dz);
  const span = Math.min(1.6, rawSpan);
  const scale = rawSpan > 0.0001 ? span / rawSpan : 0;
  const targetX = actor.x + dx * scale;
  const targetZ = actor.z + dz * scale;
  const contactLock = clamp01(action.contactStrength);
  const anchorWeight = 0.5 + contactLock * 0.08;
  const focusX = THREE.MathUtils.lerp(actor.x, targetX, anchorWeight);
  const focusZ = THREE.MathUtils.lerp(actor.z, targetZ, anchorWeight);

  let azimuth = baseAzimuth;
  if (span > 0.08) {
    // Look across the actor→object axis so both subjects separate across the frame instead of
    // collapsing into one silhouette. Keep whichever side is closest to the already-authored shot.
    const actionAxis = Math.atan2(targetZ - actor.z, targetX - actor.x);
    const sideA = actionAxis + Math.PI / 2;
    const sideB = sideA + Math.PI;
    azimuth = angularDistance(sideA, baseAzimuth) <= angularDistance(sideB, baseAzimuth) ? sideA : sideB;
  }

  return {
    focusX,
    focusZ,
    targetX,
    targetZ,
    azimuth,
    distanceBoost: Math.min(0.72, span * 0.42),
    contactLock,
    anchorWeight,
    span,
  };
}

/**
 * Cheap presentation-only estimate of how strongly standing forest occupies a camera sightline.
 * It deliberately reads world forest state rather than renderer meshes so CameraDirector never
 * becomes coupled to vegetation instance buckets. Larger values mean a more obstructed view.
 */
export function forestSightlineObstruction(
  world: SimulationState['world'],
  from: THREE.Vector3,
  target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
): number {
  const horizontalDistance = Math.hypot(target.x - from.x, target.z - from.z);
  if (horizontalDistance < 2) return 0;
  const samples = Math.max(6, Math.min(14, Math.ceil(horizontalDistance / 3)));
  let obstruction = 0;

  for (let index = 1; index < samples; index += 1) {
    const amount = index / samples;
    const x = THREE.MathUtils.lerp(from.x, target.x, amount);
    const z = THREE.MathUtils.lerp(from.z, target.z, amount);
    const cell = cellAt(world, x, z);
    if (!cell || cell.water) continue;

    const capacity = Math.max(0.01, cell.forestCapacity ?? cell.wood);
    const standing = clamp01(cell.wood / capacity);
    if (standing < 0.08) continue;

    const biomeWeight = cell.biome === 'forest' ? 1
      : cell.biome === 'wetland' ? 0.78
        : cell.river ? 0.62
          : 0.42;
    const sightY = THREE.MathUtils.lerp(from.y, target.y, amount);
    const canopyHeight = 3.8 + standing * 2.6;
    const canopyTop = elevationAt(x, z) + canopyHeight;
    const verticalOverlap = clamp01((canopyTop - sightY + 0.45) / 3.2);
    if (verticalOverlap <= 0) continue;

    // Foreground foliage consumes much more of the frame than the same canopy near the subject.
    const foregroundWeight = 1 + (1 - amount) * 0.75;
    obstruction += standing * biomeWeight * verticalOverlap * foregroundWeight;
  }

  return obstruction / samples;
}

/**
 * Presentation-only approximation of building occlusion for low camera positions. A candidate is
 * penalized heavily when the lens lands inside a persistent plot, and more gently when a structure
 * crosses the sightline below its approximate roof height. Fields are excluded because their plot
 * footprint is traversable visual ground, not an opaque wall.
 */
export function structureSightlineObstruction(
  state: SimulationState,
  from: THREE.Vector3,
  target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
): number {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.01) return 0;

  let obstruction = 0;
  for (const settlement of state.settlements) {
    if (!settlement.alive) continue;
    for (const plot of settlement.structurePlots ?? []) {
      if ((plot.development?.form as string | undefined) === 'field' || plot.condition <= 0.08) continue;
      const radius = Math.max(0.2, plot.radius + 0.18);

      const cameraDistance = Math.hypot(from.x - plot.worldX, from.z - plot.worldZ);
      if (cameraDistance < radius) obstruction += 2.5;

      const projected = ((plot.worldX - from.x) * dx + (plot.worldZ - from.z) * dz) / lengthSquared;
      if (projected <= 0.04 || projected >= 0.96) continue;
      const nearestX = from.x + dx * projected;
      const nearestZ = from.z + dz * projected;
      const horizontalDistance = Math.hypot(plot.worldX - nearestX, plot.worldZ - nearestZ);
      if (horizontalDistance >= radius) continue;

      const sightY = THREE.MathUtils.lerp(from.y, target.y, projected);
      const roofY = elevationAt(plot.worldX, plot.worldZ) + Math.max(0.45, plot.height * Math.max(0.25, plot.condition));
      if (sightY < roofY + 0.12) {
        const overlap = 1 - clamp01(horizontalDistance / radius);
        const vertical = clamp01((roofY + 0.12 - sightY) / Math.max(0.35, plot.height));
        obstruction += overlap * (0.8 + vertical * 1.5);
      }
    }
  }
  return obstruction;
}

/**
 * Documentary camera controller. Historical state remains authoritative; this class only decides
 * how the observer glides between and within scenes.
 */
export class CameraDirector {
  readonly observation: CurrentObservation = { label: 'The known world', detail: 'A new history begins.', kind: 'world-establishing', interest: 0.1, audioCategory: 'ambient-wilderness', revision: 0 };
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly shotBasePosition = new THREE.Vector3();
  private readonly shotBaseTarget = new THREE.Vector3();
  private readonly trackedFocus = new THREE.Vector3();
  private readonly workingDirection = new THREE.Vector3();
  private readonly workingTangent = new THREE.Vector3();
  private readonly forestCandidatePosition = new THREE.Vector3();
  private shotAge = 0;
  private shotDuration = 12;
  private currentScene?: ObservationCandidate;
  private currentMotion: CameraMotion = 'hold';
  private shotAzimuth = 0;
  private trackingInitialized = false;
  private readonly acknowledgedMajorEventIds = new Set<string>();
  private latestMajorEvent?: SimulationState['history'][number];
  private lastScannedHistoryLength = -1;
  private lastScannedMonth = -1;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly config: GodboxConfig,
    private readonly historian: Historian,
    private readonly subjectPresentation?: CameraSubjectPresentationResolver,
  ) {
    this.camera.position.set(38, 48, 52);
    this.lookTarget.set(0, 0, 0);
    this.camera.lookAt(this.lookTarget);
  }

  update(deltaSeconds: number, elapsedSeconds: number, state: SimulationState, elevationAt: (x: number, z: number) => number): void {
    if (state.arrival && state.arrival.phase !== 'HISTORY_RUNNING') {
      const pose = arrivalCameraPose(state.arrival);
      if (state.arrival.elapsedSeconds < 0.2) {
        this.camera.position.copy(pose.position);
        this.lookTarget.copy(pose.target);
      } else {
        this.camera.position.lerp(pose.position, 1 - Math.exp(-deltaSeconds * 1.1));
        this.lookTarget.lerp(pose.target, 1 - Math.exp(-deltaSeconds * 1.3));
      }
      // Keep the lens above mature tree crowns, and the sightline above intervening ridges.
      this.camera.position.y = Math.max(this.camera.position.y, elevationAt(this.camera.position.x, this.camera.position.z) + 8);
      for (let i = 1; i < 12; i++) {
        const f = i / 12;
        const x = THREE.MathUtils.lerp(this.camera.position.x, this.lookTarget.x, f);
        const z = THREE.MathUtils.lerp(this.camera.position.z, this.lookTarget.z, f);
        const y = THREE.MathUtils.lerp(this.camera.position.y, this.lookTarget.y, f);
        const clearance = elevationAt(x, z) + 1.4 - y;
        if (clearance > 0) this.camera.position.y += clearance / (1 - f);
      }
      this.camera.lookAt(this.lookTarget);
      this.observation.label = 'Before history';
      this.observation.detail = 'Year 0 · Month 0 · Day 0';
      delete this.observation.sceneId;
      return;
    }
    this.shotAge += deltaSeconds;
    const majorEvent = this.findMajorEvent(state);
    const mayInterrupt = this.shotAge >= Math.max(6, this.config.camera.transitionSeconds * 1.1);
    if (!this.currentScene || (majorEvent && mayInterrupt)) {
      if (majorEvent) this.acknowledgedMajorEventIds.add(majorEvent.id);
      if (this.acknowledgedMajorEventIds.size > 2048) {
        const oldest = this.acknowledgedMajorEventIds.values().next().value as string | undefined;
        if (oldest) this.acknowledgedMajorEventIds.delete(oldest);
      }
      this.chooseShot(state, elevationAt, majorEvent?.id);
    } else if (this.shotAge >= this.shotDuration) {
      this.chooseShot(state, elevationAt);
    }

    this.animateShot(deltaSeconds, elapsedSeconds, state, elevationAt);

    // Critically damped-feeling exponential smoothing. Camera movement is tied to wall-clock time,
    // never simulation months, so deep historical acceleration does not make the camera race.
    const editorialTiming = foundingEditorialTimingFor(this.currentScene?.id);
    const transitionSeconds = editorialTiming?.transitionSeconds
      ?? this.config.camera.transitionSeconds * cameraTransitionScaleFor(this.currentScene?.kind);
    const transitionRate = 3.15 / Math.max(0.5, transitionSeconds);
    const positionSmoothing = 1 - Math.exp(-deltaSeconds * transitionRate);
    const targetSmoothing = 1 - Math.exp(-deltaSeconds * transitionRate * 1.22);
    this.camera.position.lerp(this.desiredPosition, positionSmoothing);
    this.lookTarget.lerp(this.desiredTarget, targetSmoothing);
    const clearance = cameraClearanceFor(this.currentScene?.kind);
    this.camera.position.y = Math.max(this.camera.position.y, elevationAt(this.camera.position.x, this.camera.position.z) + clearance.lens);
    this.lookTarget.y = Math.max(
      this.lookTarget.y,
      elevationAt(this.lookTarget.x, this.lookTarget.z) + cameraTargetFloorFor(this.currentScene?.kind),
    );
    this.camera.lookAt(this.lookTarget);
  }

  current(): ObservationCandidate | undefined {
    return this.currentScene;
  }

  private chooseShot(state: SimulationState, elevationAt: (x: number, z: number) => number, focusEventId?: string): void {
    const scene = this.historian.chooseScene(state, focusEventId);
    this.currentScene = scene;
    this.shotAge = 0;
    this.trackingInitialized = false;
    const framing = FRAMING[scene.kind];
    const baseDuration = this.config.camera.shotSeconds[0] + (this.config.camera.shotSeconds[1] - this.config.camera.shotSeconds[0]) * (0.28 + scene.score * 0.45);
    this.currentMotion = this.motionFor(scene);
    const motionDurationScale = this.currentMotion === 'hold' ? 1.12 : this.currentMotion === 'pullback' ? 1.08 : 1;
    const editorialTiming = foundingEditorialTimingFor(scene.id);
    this.shotDuration = editorialTiming?.durationSeconds
      ?? baseDuration * framing.durationScale * motionDurationScale;

    this.observation.sceneId = scene.id;
    this.observation.label = scene.title;
    this.observation.detail = scene.statement.text;
    this.observation.kind = scene.kind;
    this.observation.interest = scene.interest;
    this.observation.audioCategory = scene.audioCategory;
    this.observation.statement = scene.statement;
    if (scene.event) {
      this.observation.eventType = scene.event.type;
      this.observation.eventMonth = scene.event.month;
    } else {
      delete this.observation.eventType;
      delete this.observation.eventMonth;
    }
    this.observation.revision += 1;

    const ground = elevationAt(scene.position.x, scene.position.z);
    const baseAzimuth = this.stableAzimuth(scene.id);
    const radius = this.interpolate(framing.radius, 0.36 + scene.score * 0.4);
    const height = this.interpolate(framing.height, 0.42 + scene.interest * 0.32);
    this.shotBaseTarget.set(scene.position.x, ground + framing.targetHeight, scene.position.z);
    this.shotAzimuth = this.chooseClearAzimuth(state, scene.kind, baseAzimuth, radius, height, ground, elevationAt);
    this.shotBasePosition.set(scene.position.x + Math.cos(this.shotAzimuth) * radius, ground + height, scene.position.z + Math.sin(this.shotAzimuth) * radius);
    this.desiredTarget.copy(this.shotBaseTarget);
    this.desiredPosition.copy(this.shotBasePosition);
    this.raiseForTerrain(elevationAt);
    this.shotBasePosition.copy(this.desiredPosition);
  }

  private chooseClearAzimuth(
    state: SimulationState,
    kind: ObservationKind,
    baseAzimuth: number,
    radius: number,
    height: number,
    ground: number,
    elevationAt: (x: number, z: number) => number,
  ): number {
    if (!FOREST_AWARE_KINDS.has(kind)) return baseAzimuth;

    let bestAzimuth = baseAzimuth;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const offset of FOREST_AZIMUTH_OFFSETS) {
      const azimuth = baseAzimuth + offset;
      const x = this.shotBaseTarget.x + Math.cos(azimuth) * radius;
      const z = this.shotBaseTarget.z + Math.sin(azimuth) * radius;
      const clearance = cameraClearanceFor(kind);
      this.forestCandidatePosition.set(x, Math.max(ground + height, elevationAt(x, z) + clearance.lens), z);
      const forestObstruction = forestSightlineObstruction(state.world, this.forestCandidatePosition, this.shotBaseTarget, elevationAt);
      const structureObstruction = structureSightlineObstruction(state, this.forestCandidatePosition, this.shotBaseTarget, elevationAt);
      // Preserve the authored side when it is genuinely usable, but never prefer it over an angle
      // that keeps a low lens out of a wall or removes a building from the subject sightline.
      const compositionPenalty = Math.abs(offset) * 0.035;
      const score = forestObstruction + structureObstruction + compositionPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestAzimuth = azimuth;
      }
    }
    return bestAzimuth;
  }

  private animateShot(deltaSeconds: number, elapsedSeconds: number, state: SimulationState, elevationAt: (x: number, z: number) => number): void {
    const scene = this.currentScene;
    if (!scene) return;

    this.desiredPosition.copy(this.shotBasePosition);
    this.desiredTarget.copy(this.shotBaseTarget);

    const progress = Math.max(0, Math.min(1, this.shotAge / Math.max(0.001, this.shotDuration)));
    const eased = this.smoothstep(progress);

    const war = scene.statement.claims.warId ? state.wars.find(w => w.id === scene.statement.claims.warId) : undefined;
    if (war) {
      const a = state.settlements.find(s => s.id === war.attacker);
      const b = state.settlements.find(s => s.id === war.defender);
      if (a && b) {
        const focus = campaignFocus(war, a.position, b.position);
        const ground = elevationAt(focus.x, focus.z);
        this.smoothFocus(focus.x, ground + 0.5, focus.z, deltaSeconds, 1.6);
        const aftermath = war.resolvedMonth !== undefined;
        const baseRadius = aftermath ? 17 : war.phase === 'marching' ? 15 : 12;
        const radius = baseRadius + (aftermath ? eased * 7 : 0);
        const angle = this.shotAzimuth + (eased - 0.5) * (aftermath ? 0.16 : 0.26);
        this.desiredTarget.copy(this.trackedFocus);
        this.desiredPosition.set(
          this.trackedFocus.x + Math.cos(angle) * radius,
          Math.max(this.trackedFocus.y + (aftermath ? 16 + eased * 3 : 10), elevationAt(this.trackedFocus.x + Math.cos(angle) * radius, this.trackedFocus.z + Math.sin(angle) * radius) + 3),
          this.trackedFocus.z + Math.sin(angle) * radius,
        );
        this.raiseForTerrain(elevationAt);
        return;
      }
    }

    if (scene.kind === 'worker-follow' || scene.kind === 'traveler-follow' || scene.kind === 'discovery-scene') {
      const person = state.people.find((candidate) => candidate.alive && candidate.id === scene.subjectId);
      if (person) {
        const framing = FRAMING[scene.kind];
        const presentation = this.subjectPresentation?.(person.id);
        const actorX = presentation?.x ?? person.position.x;
        const actorZ = presentation?.z ?? person.position.z;
        const actorGround = presentation?.footY ?? elevationAt(actorX, actorZ);
        const action = scene.kind === 'traveler-follow' ? undefined : presentation?.action;
        const composition = action ? interactionCameraComposition({ x: actorX, z: actorZ }, action, this.shotAzimuth) : undefined;

        const actorFocusY = actorGround + framing.targetHeight + Math.max(0, action?.platformHeight ?? 0);
        const interactionY = composition && action
          ? elevationAt(composition.targetX, composition.targetZ) + Math.max(0.06, action.contactHeight ?? framing.targetHeight)
          : actorFocusY;
        const focusX = composition?.focusX ?? actorX;
        const focusZ = composition?.focusZ ?? actorZ;
        const focusY = composition ? THREE.MathUtils.lerp(actorFocusY, interactionY, composition.anchorWeight) : actorFocusY;
        this.smoothFocus(focusX, focusY, focusZ, deltaSeconds, scene.kind === 'traveler-follow' ? 1.45 : 1.9);

        // Step 2: when the renderer has an authoritative presentation action, the camera photographs
        // actor + work object as one composition. Otherwise it remains a close person-follow shot.
        const framingVariation = 0.34 + this.stableUnit(`${scene.id}:follow-framing`) * 0.36;
        const followingDistance = this.interpolate(framing.radius, framingVariation) + (composition?.distanceBoost ?? 0);
        const cameraHeight = this.interpolate(framing.height, framingVariation);
        const contactLock = composition?.contactLock ?? 0;
        const baseAngle = composition?.azimuth ?? this.shotAzimuth;
        const microOrbit = Math.sin(elapsedSeconds * 0.11 + this.shotAzimuth) * 0.035 * (1 - contactLock * 0.88);
        const angle = baseAngle + microOrbit;
        const x = this.trackedFocus.x + Math.cos(angle) * followingDistance;
        const z = this.trackedFocus.z + Math.sin(angle) * followingDistance;
        const clearance = cameraClearanceFor(scene.kind);
        const platformLift = Math.max(0, action?.platformHeight ?? 0) * 0.62;
        this.desiredTarget.copy(this.trackedFocus);
        this.desiredPosition.set(
          x,
          Math.max(actorGround + platformLift + cameraHeight, elevationAt(x, z) + clearance.lens),
          z,
        );
        this.raiseForTerrain(elevationAt);
        return;
      }
    }

    if (scene.kind === 'regional-travel') {
      const route = state.tradeRoutes.find((candidate) => candidate.id === scene.subjectId);
      const a = route ? state.settlements.find((settlement) => settlement.id === route.a) : undefined;
      const b = route ? state.settlements.find((settlement) => settlement.id === route.b) : undefined;
      if (route && a && b) {
        // Travel now moves monotonically through the shot instead of oscillating back and forth.
        const travelProgress = 0.08 + eased * 0.84;
        const x = THREE.MathUtils.lerp(a.position.x, b.position.x, travelProgress);
        const z = THREE.MathUtils.lerp(a.position.z, b.position.z, travelProgress);
        const ground = elevationAt(x, z);
        this.smoothFocus(x, ground + 0.65, z, deltaSeconds, 1.35);
        const angle = this.shotAzimuth;
        const cameraX = this.trackedFocus.x + Math.cos(angle) * 18;
        const cameraZ = this.trackedFocus.z + Math.sin(angle) * 18;
        this.desiredTarget.copy(this.trackedFocus);
        this.desiredPosition.set(cameraX, Math.max(this.trackedFocus.y + 14.5, elevationAt(cameraX, cameraZ) + 3), cameraZ);
        this.raiseForTerrain(elevationAt);
        return;
      }
    }

    this.applyCinematicMotion(this.currentMotion, eased, elapsedSeconds);
    this.raiseForTerrain(elevationAt);
  }

  private applyCinematicMotion(motion: CameraMotion, progress: number, elapsedSeconds: number): void {
    this.workingDirection.copy(this.shotBasePosition).sub(this.shotBaseTarget);
    const radius = Math.max(0.001, Math.hypot(this.workingDirection.x, this.workingDirection.z));
    this.workingDirection.normalize();
    this.workingTangent.set(-this.workingDirection.z, 0, this.workingDirection.x).normalize();

    switch (motion) {
      case 'hold': {
        // Almost still, with just enough organic breathing to avoid a frozen surveillance camera.
        // Scale the motion to the composition so intimate shots do not visibly slide sideways.
        const breathAmplitude = Math.min(0.14, radius * 0.035);
        const breath = Math.sin(elapsedSeconds * 0.16 + this.shotAzimuth) * breathAmplitude;
        this.desiredPosition.addScaledVector(this.workingTangent, breath);
        break;
      }
      case 'drift': {
        const offset = (progress - 0.5) * 2.6;
        this.desiredPosition.addScaledVector(this.workingTangent, offset);
        this.desiredTarget.addScaledVector(this.workingTangent, offset * 0.18);
        break;
      }
      case 'truck': {
        const maximumOffset = Math.min(2.6, radius * 0.22);
        const offset = (progress - 0.5) * 2 * maximumOffset;
        this.desiredPosition.addScaledVector(this.workingTangent, offset);
        this.desiredTarget.addScaledVector(this.workingTangent, offset * 0.28);
        break;
      }
      case 'dolly-in': {
        this.desiredPosition.addScaledVector(this.workingDirection, 3.2 - progress * 5.1);
        this.desiredPosition.y += (1 - progress) * 0.9;
        break;
      }
      case 'dolly-out': {
        this.desiredPosition.addScaledVector(this.workingDirection, progress * 5.8);
        this.desiredPosition.y += progress * 1.7;
        break;
      }
      case 'crane': {
        this.desiredPosition.y += (progress - 0.5) * 5;
        this.desiredPosition.addScaledVector(this.workingDirection, (progress - 0.5) * 1.6);
        break;
      }
      case 'orbit': {
        const angle = this.shotAzimuth + (progress - 0.5) * 0.32;
        this.desiredPosition.x = this.shotBaseTarget.x + Math.cos(angle) * radius;
        this.desiredPosition.z = this.shotBaseTarget.z + Math.sin(angle) * radius;
        break;
      }
      case 'pullback': {
        this.desiredPosition.addScaledVector(this.workingDirection, progress * 8.5);
        this.desiredPosition.y += progress * 3.6;
        break;
      }
      case 'follow':
        // Subject-follow shots are handled by their authoritative subject branches above.
        break;
    }
  }

  private smoothFocus(x: number, y: number, z: number, deltaSeconds: number, responsiveness: number): void {
    if (!this.trackingInitialized) {
      this.trackedFocus.set(x, y, z);
      this.trackingInitialized = true;
      return;
    }
    const amount = 1 - Math.exp(-deltaSeconds * responsiveness);
    this.trackedFocus.lerp(new THREE.Vector3(x, y, z), amount);
  }

  private motionFor(scene: ObservationCandidate): CameraMotion {
    const variation = this.stableUnit(`${scene.id}:motion`);
    switch (scene.kind) {
      case 'world-establishing': return variation < 0.55 ? 'drift' : 'orbit';
      case 'regional-travel': return 'follow';
      case 'settlement-approach': return 'dolly-in';
      case 'street-observation': return variation < 0.62 ? 'hold' : 'truck';
      case 'worker-follow':
      case 'traveler-follow':
      case 'discovery-scene': return 'follow';
      case 'institution-exterior': return variation < 0.55 ? 'hold' : 'truck';
      case 'battle-overview': return 'orbit';
      case 'aftermath-pullback': return 'pullback';
      case 'city-growth-timelapse': return variation < 0.5 ? 'crane' : 'orbit';
      case 'night-transition': return 'drift';
      case 'infrastructure-scene': return variation < 0.58 ? 'dolly-in' : 'drift';
      case 'landscape-pause': return variation < 0.7 ? 'hold' : 'drift';
      case 'atomic-threshold': return variation < 0.5 ? 'hold' : 'dolly-out';
      case 'orbital-establishing': return 'orbit';
      case 'civilization-ending': return 'pullback';
      case 'historian-context': return variation < 0.5 ? 'hold' : 'crane';
    }
  }

  /**
   * Keeps the camera above the ground and keeps the sightline clear. With real mountains between
   * the lens and the subject, clearing only the camera's own footprint is not enough.
   */
  private raiseForTerrain(elevationAt: (x: number, z: number) => number): void {
    const clearance = cameraClearanceFor(this.currentScene?.kind);
    this.desiredPosition.y = Math.max(
      this.desiredPosition.y,
      elevationAt(this.desiredPosition.x, this.desiredPosition.z) + clearance.lens,
    );
    const samples = 8;
    for (let index = 1; index < samples; index += 1) {
      const amount = index / samples;
      const x = THREE.MathUtils.lerp(this.desiredPosition.x, this.desiredTarget.x, amount);
      const z = THREE.MathUtils.lerp(this.desiredPosition.z, this.desiredTarget.z, amount);
      const sight = THREE.MathUtils.lerp(this.desiredPosition.y, this.desiredTarget.y, amount);
      const requiredSight = elevationAt(x, z) + clearance.sightline;
      if (requiredSight > sight) this.desiredPosition.y += (requiredSight - sight) / Math.max(0.15, 1 - amount);
    }
  }

  private findMajorEvent(state: SimulationState): SimulationState['history'][number] | undefined {
    if (this.lastScannedHistoryLength === state.history.length && this.lastScannedMonth === state.month) {
      return this.latestMajorEvent && !this.acknowledgedMajorEventIds.has(this.latestMajorEvent.id) ? this.latestMajorEvent : undefined;
    }

    this.latestMajorEvent = undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    const memoryMonths = Math.max(6, this.config.presentation.eventMemoryMonths);

    // Scan the whole presentation memory window. At high tick rates multiple authoritative months
    // can pass between rendered frames; a three-month window could otherwise skip a major event.
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const event = state.history[index];
      if (!event) continue;
      const age = state.month - event.month;
      if (age > memoryMonths) break;
      if (event.month > state.month || event.significance < 0.72 || !DOCUMENTARY_BREAK_TYPES.has(event.type) || this.acknowledgedMajorEventIds.has(event.id)) continue;
      const recency = 1 - age / Math.max(1, memoryMonths);
      const score = event.significance * 1.6 + recency * 0.28;
      if (score > bestScore) {
        bestScore = score;
        this.latestMajorEvent = event;
      }
    }

    this.lastScannedHistoryLength = state.history.length;
    this.lastScannedMonth = state.month;
    return this.latestMajorEvent;
  }

  private smoothstep(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  private stableUnit(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = Math.imul(31, hash) + id.charCodeAt(index) | 0;
    return (hash >>> 0) / 4_294_967_296;
  }

  private stableAzimuth(id: string): number {
    return this.stableUnit(id) * Math.PI * 2;
  }

  private interpolate(range: readonly [number, number], amount: number): number {
    return THREE.MathUtils.lerp(range[0], range[1], Math.max(0, Math.min(1, amount)));
  }
}
