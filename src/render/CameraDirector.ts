import * as THREE from 'three';
import { advanceCameraSpring } from './CameraSpring';
import { advanceCameraFlight, cameraFlightSettled, type CameraFlightLimits } from './CameraFlight';
import { arrivalSequenceFocus } from './founding/ArrivalPresentation';
import { campaignFocus } from '../sim/war/Campaign';
import type { GodboxConfig } from '../config';
import type { Historian } from '../historian/Historian';
import type { AudioCategory, HistorianStatement, ObservationCandidate, ObservationKind } from '../historian/types';
import type { SimulationState } from '../sim/types';
import { cellAt } from '../sim/world';
import { FOUNDING_VESSEL_KEEP_OUT_RADIUS } from '../shared/FoundingCampLayout';
import { podPosition } from '../sim/founding/FoundingArrival';
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
  readonly partnerId?: string;
  readonly socialMeaning?: number;
  readonly socialTone?: string;
}

export type CameraSubjectPresentationResolver = (personId: string) => CameraSubjectPresentation | undefined;

/** Renderer-owned collision knowledge that simulation state cannot express precisely (for example individual tree crowns). */
export type CameraEnvironmentProbe = (position: THREE.Vector3, padding: number) => number;

export interface CameraSafetyOptions {
  readonly lensClearance?: number;
  readonly sightlineClearance?: number;
  readonly previousPosition?: THREE.Vector3;
  readonly environmentProbe?: CameraEnvironmentProbe;
  readonly subjects?: readonly THREE.Vector3[];
}

export interface CameraSafetyResolution {
  readonly valid: boolean;
  readonly requiresCut: boolean;
  readonly subjectVisibility: number;
  readonly pathSafety: number;
  readonly position: THREE.Vector3;
  readonly lensObstruction: number;
  readonly forestObstruction: number;
  readonly structureObstruction: number;
  readonly vesselObstruction: number;
  readonly angularCorrection: number;
  readonly lift: number;
}

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

export type CameraMotion = 'hold' | 'drift' | 'truck' | 'dolly-in' | 'dolly-out' | 'crane' | 'orbit' | 'follow' | 'pullback';

const FRAMING: Record<ObservationKind, CameraFraming> = {
  'world-establishing': { radius: [46, 62], height: [42, 58], targetHeight: 1, durationScale: 1.25 },
  'regional-travel': { radius: [22, 31], height: [19, 28], targetHeight: 0.8, durationScale: 1.15 },
  'settlement-approach': { radius: [15, 22], height: [12, 19], targetHeight: 1.2, durationScale: 1 },
  // Human-scale shots intentionally break from the old aerial grammar. These dimensions are in
  // world units: close people should read as subjects, not colored pixels inside a settlement.
  'street-observation': { radius: [2.8, 4.5], height: [1.05, 1.7], targetHeight: 0.14, durationScale: 1.18 },
  'worker-follow': { radius: [1.45, 2.25], height: [0.42, 0.7], targetHeight: 0.12, durationScale: 1.26 },
  'traveler-follow': { radius: [3.2, 5.0], height: [1.3, 2.05], targetHeight: 0.16, durationScale: 1.18 },
  'institution-exterior': { radius: [10, 16], height: [8, 13], targetHeight: 1.2, durationScale: 1.24 },
  'discovery-scene': { radius: [1.55, 2.35], height: [0.45, 0.72], targetHeight: 0.12, durationScale: 1.42 },
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

/** Finer-grained corrections keep authored Arrival motion intact while stepping around foreground occluders. */
const FOUNDING_SIGHTLINE_OFFSETS = [
  0,
  Math.PI / 12, -Math.PI / 12,
  Math.PI / 6, -Math.PI / 6,
  Math.PI / 4, -Math.PI / 4,
  Math.PI / 3, -Math.PI / 3,
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

const PERSONAL_CAMERA_KINDS = new Set<ObservationKind>([
  'street-observation',
  'worker-follow',
  'traveler-follow',
  'discovery-scene',
]);

export function isPersonalCameraKind(kind: ObservationKind | undefined): boolean {
  return Boolean(kind && PERSONAL_CAMERA_KINDS.has(kind));
}

export function cameraTransitionScaleFor(kind: ObservationKind | undefined): number {
  // Close documentary work should feel operated, not reactive. Slower springs let the frame
  // absorb small subject motion without snapping the lens or constantly correcting composition.
  if (kind === 'worker-follow' || kind === 'discovery-scene') return 1.18;
  if (kind === 'street-observation') return 1.12;
  if (kind === 'traveler-follow') return 1.08;
  return 1;
}

export interface CameraShotPacing {
  readonly settleHoldFraction: number;
  readonly motionFraction: number;
  readonly finishHoldFraction: number;
}

/**
 * A cinematic operator does not move continuously. Every shot gets a readable settle, one
 * intentional move, then a final hold so the viewer can inspect the scene before the drone leaves.
 */
export function cameraShotPacingFor(kind: ObservationKind | undefined): CameraShotPacing {
  if (kind === 'worker-follow' || kind === 'discovery-scene') {
    return { settleHoldFraction: 0.2, motionFraction: 0.56, finishHoldFraction: 0.24 };
  }
  if (kind === 'street-observation' || kind === 'traveler-follow') {
    return { settleHoldFraction: 0.17, motionFraction: 0.61, finishHoldFraction: 0.22 };
  }
  return { settleHoldFraction: 0.1, motionFraction: 0.74, finishHoldFraction: 0.16 };
}

export function cameraMotionProgressFor(
  kind: ObservationKind | undefined,
  ageSeconds: number,
  durationSeconds: number,
): number {
  const pacing = cameraShotPacingFor(kind);
  const progress = clamp01(ageSeconds / Math.max(0.001, durationSeconds));
  const motionStart = pacing.settleHoldFraction;
  const motionEnd = motionStart + pacing.motionFraction;
  if (progress <= motionStart) return 0;
  if (progress >= motionEnd) return 1;
  return clamp01((progress - motionStart) / Math.max(0.001, pacing.motionFraction));
}

export interface CameraFlightProfile {
  readonly limits: CameraFlightLimits;
  readonly gazeLimits: CameraFlightLimits;
  readonly cruiseClearance: number;
  readonly destinationLift: number;
  readonly approachFraction: number;
  readonly minApproachRadius: number;
  readonly maxApproachRadius: number;
}

/**
 * Personal scenes use a low, slow flight envelope. Wide documentary moves may still gain altitude
 * and cover ground, but a flight into a person should feel like a drone easing down a lane or
 * between buildings, acquiring the subject well before arrival.
 */
export function cameraFlightProfileFor(kind: ObservationKind | undefined, distance: number): CameraFlightProfile {
  const d = Math.max(0, distance);
  if (isPersonalCameraKind(kind)) {
    return {
      limits: {
        // Personal travel remains slower than wide flight, but braking authority stays strong
        // enough to settle into a close composition instead of oscillating around the subject.
        maxSpeed: THREE.MathUtils.clamp(3.5 + d * 0.07, 3.6, 6.5),
        maxAcceleration: d > 32 ? 1.8 : d > 14 ? 1.55 : 1.4,
        maxJerk: d > 24 ? 5 : 4.8,
        responseSeconds: 0.48,
      },
      gazeLimits: { maxSpeed: 5.6, maxAcceleration: 2.8, maxJerk: 8.5, responseSeconds: 0.46 },
      cruiseClearance: 2.4 + Math.min(3.2, d * 0.045),
      destinationLift: 1.2,
      approachFraction: 0.74,
      // Nearby personal moves should glide directly into the subject, not climb into a mini cruise.
      minApproachRadius: 14,
      maxApproachRadius: 30,
    };
  }
  return {
    limits: {
      maxSpeed: THREE.MathUtils.clamp(4.4 + d * 0.075, 4.6, 10.5),
      maxAcceleration: d > 32 ? 2.3 : d > 14 ? 1.9 : 1.45,
      maxJerk: d > 24 ? 6.2 : 5.2,
      responseSeconds: 0.42,
    },
    gazeLimits: { maxSpeed: 9, maxAcceleration: 4.8, maxJerk: 16, responseSeconds: 0.34 },
    cruiseClearance: 5.5 + Math.min(6, d * 0.08),
    destinationLift: 2.5,
    approachFraction: 0.62,
    minApproachRadius: 10,
    maxApproachRadius: 26,
  };
}

export interface FoundingEditorialTiming {
  readonly durationSeconds: number;
  readonly transitionSeconds: number;
}

/**
 * Arrival Day should breathe like one film sequence, not a highlight reel. Opening documentary
 * shots therefore hold long enough for the spring to settle before the next editorial decision.
 */
export function foundingEditorialTimingFor(sceneId: string | undefined): FoundingEditorialTiming | undefined {
  if (!sceneId) return undefined;
  if (sceneId.startsWith('founding:overview:')) return { durationSeconds: 7.8, transitionSeconds: 3.2 };
  if (sceneId.startsWith('founding:community:')) return { durationSeconds: 6.6, transitionSeconds: 2.8 };
  if (sceneId.startsWith('founding-cast:framing:')) return { durationSeconds: 6, transitionSeconds: 2.6 };
  if (sceneId.startsWith('founding-cast:introduction:')) return { durationSeconds: 6.2, transitionSeconds: 2.6 };
  if (sceneId.startsWith('founding-release:')) return { durationSeconds: 7.8, transitionSeconds: 3.2 };
  return undefined;
}

export interface FoundingLandingShotProfile {
  readonly order: number;
  readonly role: 'terrain-reveal' | 'ground-approach' | 'lateral-life' | 'geographic-contrast' | 'history-handoff';
  readonly radius: number;
  readonly height: number;
  readonly targetHeight: number;
  readonly azimuthOffset: number;
  readonly motion: CameraMotion;
}

const FOUNDING_LANDING_SHOTS: readonly FoundingLandingShotProfile[] = [
  { order: 0, role: 'terrain-reveal', radius: 25, height: 22, targetHeight: 1.1, azimuthOffset: -0.18, motion: 'crane' },
  { order: 1, role: 'ground-approach', radius: 12, height: 7.4, targetHeight: 0.8, azimuthOffset: 0.42, motion: 'dolly-in' },
  { order: 2, role: 'lateral-life', radius: 10, height: 5.2, targetHeight: 0.55, azimuthOffset: -0.58, motion: 'truck' },
  { order: 3, role: 'geographic-contrast', radius: 22, height: 25, targetHeight: 0.9, azimuthOffset: 0.76, motion: 'orbit' },
  { order: 4, role: 'history-handoff', radius: 14, height: 9.2, targetHeight: 0.75, azimuthOffset: -0.72, motion: 'pullback' },
];

/**
 * Five landing beats, five visual jobs. The order is documentary metadata encoded in the scene id;
 * it never changes simulation state or implies one community matters more than another.
 */
export function foundingLandingShotProfileFor(sceneId: string | undefined): FoundingLandingShotProfile | undefined {
  if (!sceneId?.startsWith('founding:community:')) return undefined;
  const order = Number(sceneId.split(':')[2]);
  if (!Number.isInteger(order)) return undefined;
  return FOUNDING_LANDING_SHOTS.find(profile => profile.order === order);
}

export interface FoundingCastShotProfile {
  readonly index: number;
  readonly role: 'portrait' | 'side-profile' | 'life-in-place' | 'last-look';
  readonly radius: number;
  readonly height: number;
  readonly targetHeight: number;
  readonly azimuthOffset: number;
  readonly orbitSpan: number;
  readonly distanceDelta: number;
}

const FOUNDING_CAST_SHOTS: readonly FoundingCastShotProfile[] = [
  { index: 0, role: 'portrait', radius: 2.25, height: 0.68, targetHeight: 0.14, azimuthOffset: -0.12, orbitSpan: 0.035, distanceDelta: -0.12 },
  { index: 1, role: 'side-profile', radius: 2.9, height: 0.84, targetHeight: 0.15, azimuthOffset: 0.38, orbitSpan: 0.14, distanceDelta: 0 },
  { index: 2, role: 'life-in-place', radius: 4.1, height: 1.42, targetHeight: 0.18, azimuthOffset: -0.46, orbitSpan: -0.09, distanceDelta: -0.45 },
  { index: 3, role: 'last-look', radius: 2.55, height: 0.76, targetHeight: 0.14, azimuthOffset: 0.3, orbitSpan: 0.05, distanceDelta: 0.9 },
];

export function foundingCastShotProfileFor(sceneId: string | undefined): FoundingCastShotProfile | undefined {
  if (!sceneId?.startsWith('founding-cast:introduction:')) return undefined;
  const index = Number(sceneId.split(':')[2]);
  if (!Number.isInteger(index)) return undefined;
  return FOUNDING_CAST_SHOTS.find(profile => profile.index === index);
}

export function isFoundingReleaseScene(sceneId: string | undefined): boolean {
  return Boolean(sceneId?.startsWith('founding-release:'));
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


/** Founding vessels remain physical landmarks after touchdown and must never become camera volumes. */
export function foundingVesselSightlineObstruction(
  state: SimulationState,
  from: THREE.Vector3,
  target: THREE.Vector3,
  padding = 0,
): number {
  const arrival = state.arrival;
  if (!arrival) return 0;
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.001) return 0;

  let obstruction = 0;
  for (const pod of arrival.pods) {
    if (!pod.landed && arrival.elapsedSeconds < pod.entrySeconds) continue;
    const vessel = podPosition(pod, arrival.elapsedSeconds);
    const radius = FOUNDING_VESSEL_KEEP_OUT_RADIUS + padding;
    const projected = ((vessel.x - from.x) * dx + (vessel.z - from.z) * dz) / lengthSquared;
    if (projected <= 0.02 || projected >= 0.98) continue;
    const nearestX = from.x + dx * projected;
    const nearestZ = from.z + dz * projected;
    const horizontalDistance = Math.hypot(vessel.x - nearestX, vessel.z - nearestZ);
    if (horizontalDistance >= radius) continue;
    const sightY = THREE.MathUtils.lerp(from.y, target.y, projected);
    const verticalDistance = Math.abs(sightY - vessel.y);
    if (verticalDistance >= 1.45 + padding) continue;
    const horizontalOverlap = 1 - clamp01(horizontalDistance / radius);
    const verticalOverlap = 1 - clamp01(verticalDistance / (1.45 + padding));
    obstruction += horizontalOverlap * (0.9 + verticalOverlap * 1.8);
  }
  return obstruction;
}

/**
 * Hard lens occupancy check, independent of the equally necessary subject visibility check:
 * "is the viewer physically inside something right now?"
 */
export function cameraLensObstruction(
  state: SimulationState,
  position: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  padding = 0.16,
  environmentProbe?: CameraEnvironmentProbe,
): number {
  let obstruction = 0;

  for (const settlement of state.settlements) {
    if (!settlement.alive) continue;
    for (const plot of settlement.structurePlots ?? []) {
      if ((plot.development?.form as string | undefined) === 'field' || plot.condition <= 0.08) continue;
      const radius = Math.max(0.2, plot.radius + padding);
      const distance = Math.hypot(position.x - plot.worldX, position.z - plot.worldZ);
      if (distance >= radius) continue;
      const ground = elevationAt(plot.worldX, plot.worldZ);
      const roof = ground + Math.max(0.45, plot.height * Math.max(0.25, plot.condition));
      if (position.y < ground - 0.2 || position.y > roof + padding) continue;
      obstruction = Math.max(obstruction, 2.4 + (1 - clamp01(distance / radius)) * 2.4);
    }
  }

  const arrival = state.arrival;
  if (arrival) {
    for (const pod of arrival.pods) {
      if (!pod.landed && arrival.elapsedSeconds < pod.entrySeconds) continue;
      const vessel = podPosition(pod, arrival.elapsedSeconds);
      const radius = FOUNDING_VESSEL_KEEP_OUT_RADIUS + padding;
      const horizontalDistance = Math.hypot(position.x - vessel.x, position.z - vessel.z);
      const verticalDistance = Math.abs(position.y - vessel.y);
      if (horizontalDistance < radius && verticalDistance < 1.45 + padding) {
        obstruction = Math.max(obstruction,
          3 + (1 - clamp01(horizontalDistance / radius)) * 2 + (1 - clamp01(verticalDistance / (1.45 + padding))));
      }
    }
  }

  if (environmentProbe) {
    obstruction = Math.max(obstruction, environmentProbe(position, padding));
  } else {
    // Fallback for tests/dev consumers without renderer geometry: reject only the densest local canopy.
    const cell = cellAt(state.world, position.x, position.z);
    if (cell && !cell.water) {
      const standing = clamp01(cell.wood / Math.max(0.01, cell.forestCapacity ?? cell.wood));
      const canopyTop = elevationAt(position.x, position.z) + 3.8 + standing * 2.6;
      if (standing > 0.72 && position.y < canopyTop && position.y > elevationAt(position.x, position.z) + 0.2) {
        obstruction = Math.max(obstruction, (standing - 0.72) * 1.8);
      }
    }
  }

  return obstruction;
}

/** Nine rays cover the subject silhouette; one empty gap cannot make a crown readable.
 * Probe spacing plus padding covers the segment between samples, including short foreground rays.
 * Renderer placements take precedence over the coarse forest-cell fallback.
 */
export function cameraSubjectVisibility(
  state: SimulationState, from: THREE.Vector3, target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number, probe?: CameraEnvironmentProbe,
  halfWidth = 0.16,
): number {
  if (!probe) return 1 - clamp01(forestSightlineObstruction(state.world, from, target, elevationAt));
  const right = new THREE.Vector3(target.z - from.z, 0, from.x - target.x).normalize();
  const end = new THREE.Vector3(), point = new THREE.Vector3();
  let visible = 0;
  for (const horizontal of [-1, 0, 1]) for (const vertical of [-1, 0, 1]) {
    end.copy(target).addScaledVector(right, horizontal * halfWidth);
    end.y += vertical * halfWidth * 0.65;
    const distance = from.distanceTo(end);
    const steps = Math.max(2, Math.ceil(distance / 0.24));
    let blocked = false;
    for (let i = 1; i < steps; i++) {
      point.lerpVectors(from, end, i / steps);
      if (probe(point, 0.12) > 0.001) { blocked = true; break; }
    }
    if (!blocked) visible++;
  }
  return visible / 9;
}

export interface CameraShotValidity {
  readonly lensSafety: number;
  readonly subjectVisibility: number;
  readonly structureVisibility: number;
  readonly terrainClearance: number;
  readonly compositionQuality: number;
  readonly score: number;
  readonly valid: boolean;
}

export function cameraShotValidity(
  state: SimulationState, position: THREE.Vector3, target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number, options: CameraSafetyOptions = {},
): CameraShotValidity {
  const lensSafety = cameraLensObstruction(state, position, elevationAt, 0.12, options.environmentProbe) <= 0.001 ? 1 : 0;
  const subjects = options.subjects?.length ? options.subjects : [target];
  const width = options.subjects?.length ? 0.12 : Math.min(1.2, Math.max(0.16, position.distanceTo(target) * 0.035));
  let subjectVisibility = 1, structureVisibility = 1, terrainClearance = 1;
  for (const subject of subjects) {
    subjectVisibility = Math.min(subjectVisibility, cameraSubjectVisibility(state, position, subject, elevationAt, options.environmentProbe, width));
    structureVisibility = Math.min(structureVisibility, 1 - clamp01(
      structureSightlineObstruction(state, position, subject, elevationAt)
      + foundingVesselSightlineObstruction(state, position, subject)));
    const steps = Math.max(2, Math.ceil(position.distanceTo(subject) / 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (THREE.MathUtils.lerp(position.y, subject.y, t) < elevationAt(
        THREE.MathUtils.lerp(position.x, subject.x, t), THREE.MathUtils.lerp(position.z, subject.z, t)) + 0.03) terrainClearance = 0;
    }
  }
  if (position.y < elevationAt(position.x, position.z) + (options.lensClearance ?? 0.42) - 0.001) terrainClearance = 0;
  const compositionQuality = 1 - clamp01(Math.max(0, position.y - target.y) / Math.max(1, position.distanceTo(target))) * 0.35;
  const score = Math.min(lensSafety, subjectVisibility, structureVisibility, terrainClearance) * compositionQuality;
  return { lensSafety, subjectVisibility, structureVisibility, terrainClearance, compositionQuality, score,
    valid: lensSafety === 1 && subjectVisibility >= 0.67 && structureVisibility >= 0.65 && terrainClearance === 1 };
}

/** Validate the swept lens AND subject sightlines along the actual proposed translation. */
export function cameraVisibilityCorridor(
  state: SimulationState, from: THREE.Vector3, to: THREE.Vector3, target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number, options: CameraSafetyOptions = {},
): boolean {
  const steps = Math.max(1, Math.ceil(from.distanceTo(to) / 0.24));
  const point = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    point.lerpVectors(from, to, i / steps);
    if (!cameraShotValidity(state, point, target, elevationAt, options).valid) return false;
  }
  return true;
}


/**
 * Physical flight safety deliberately does not require the destination subject to remain visible.
 * A real drone can cross a ridge or pass behind a building while travelling; the non-negotiable
 * contract is that the lens itself never enters terrain, structures, vessels or rendered foliage.
 */
export function cameraFlightCorridorSafe(
  state: SimulationState,
  from: THREE.Vector3,
  to: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  lensClearance = 0.72,
  environmentProbe?: CameraEnvironmentProbe,
): boolean {
  const steps = Math.max(1, Math.ceil(from.distanceTo(to) / 0.2));
  const point = new THREE.Vector3();
  for (let index = 0; index <= steps; index += 1) {
    point.lerpVectors(from, to, index / steps);
    if (point.y < elevationAt(point.x, point.z) + lensClearance - 0.001) return false;
    if (cameraLensObstruction(state, point, elevationAt, 0.12, environmentProbe) > 0.001) return false;
  }
  return true;
}

/** Hard validity precedes composition cost. Search at cinematic height before any crane escape. */
export function resolveCameraSafety(
  state: SimulationState, authoredPosition: THREE.Vector3, target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number, options: CameraSafetyOptions = {},
): CameraSafetyResolution {
  const radius = Math.max(0.55, Math.hypot(authoredPosition.x - target.x, authoredPosition.z - target.z));
  const base = Math.atan2(authoredPosition.z - target.z, authoredPosition.x - target.x);
  const previous = options.previousPosition;
  const right = new THREE.Vector3(-Math.sin(base), 0, Math.cos(base));
  let best: CameraSafetyResolution | undefined, bestScore = Infinity;
  let cut: CameraSafetyResolution | undefined;
  const evaluate = (position: THREE.Vector3): CameraSafetyResolution => {
    const validity = cameraShotValidity(state, position, target, elevationAt, options);
    const continuous = validity.valid && (!previous || cameraVisibilityCorridor(state, previous, position, target, elevationAt, options));
    const result: CameraSafetyResolution = {
      position, valid: validity.valid, requiresCut: !continuous, pathSafety: continuous ? 1 : 0,
      subjectVisibility: validity.subjectVisibility,
      lensObstruction: 1 - validity.lensSafety,
      forestObstruction: 1 - validity.subjectVisibility,
      structureObstruction: 1 - validity.structureVisibility,
      vesselObstruction: foundingVesselSightlineObstruction(state, position, target),
      angularCorrection: angularDistance(Math.atan2(position.z - target.z, position.x - target.x), base),
      lift: Math.max(0, position.y - authoredPosition.y),
    };
    const score = (1 - validity.score) * 100 + position.distanceTo(previous ?? authoredPosition) * 0.1;
    if (score < bestScore) { bestScore = score; best = result; }
    if (validity.valid && !cut) cut = result;
    return result;
  };
  const authored = evaluate(authoredPosition.clone());
  if (authored.valid && !authored.requiresCut) return authored;
  const stages: THREE.Vector3[][] = [];
  stages.push([0.35, -0.35, 0.7, -0.7, 1.2, -1.2].map(slide => authoredPosition.clone().addScaledVector(right, slide)));
  const offsets = [Math.PI / 18, -Math.PI / 18, Math.PI / 9, -Math.PI / 9, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI];
  const ring = (scale: number, lift: number): THREE.Vector3[] => [0, ...offsets].map(offset => {
    const x = target.x + Math.cos(base + offset) * radius * scale;
    const z = target.z + Math.sin(base + offset) * radius * scale;
    return new THREE.Vector3(x, Math.max(authoredPosition.y + lift, elevationAt(x, z) + (options.lensClearance ?? 0.42)), z);
  });
  stages.push(ring(1, 0), [...ring(0.82, 0), ...ring(1.18, 0)], ring(1, 0.35), ring(1, 0.8));
  // A cut to a low valid composition is preferable to flying above the canopy.
  for (const stage of stages) {
    if (previous) stage.sort((a, b) => a.distanceToSquared(previous) - b.distanceToSquared(previous));
    for (const point of stage) {
      const candidate = evaluate(point);
      if (candidate.valid && !candidate.requiresCut) return candidate;
    }
    if (cut) return cut;
  }
  for (const lift of [1.5, 3, 6, 12, 24]) for (const point of ring(0.82, lift)) {
    const candidate = evaluate(point);
    if (candidate.valid) return candidate;
  }
  // Explicit failure: callers must not mistake the least obstructed candidate for a valid shot.
  return best!;
}

/** Wall-clock hysteresis: tolerate edge branches, never seconds of majority occlusion. */
export class CameraVisibilityHysteresis {
  score = 1;
  private failedSeconds = 0;
  update(validity: CameraShotValidity, deltaSeconds: number, pathSafety = 1): boolean {
    const dt = Math.max(0, deltaSeconds);
    this.score += (Math.min(validity.score, pathSafety) - this.score) * (1 - Math.exp(-dt * 8));
    this.failedSeconds = validity.valid ? 0 : this.failedSeconds + dt;
    return validity.lensSafety === 0 || validity.terrainClearance === 0 || this.failedSeconds >= 0.25;
  }
  reset(): void { this.score = 1; this.failedSeconds = 0; }
}


export interface FoundingSightlineResolution {
  readonly position: THREE.Vector3;
  readonly forestObstruction: number;
  readonly structureObstruction: number;
  readonly angularCorrection: number;
  readonly lift: number;
}

/**
 * Keeps authored Arrival compositions but refuses to let foreground forest/buildings own the frame.
 * The target and horizontal camera distance never change. A clear authored line is returned exactly;
 * when blocked, search the nearest side first and only lift the lens if every nearby side remains
 * obstructed. This runs continuously during founding shots, so a truck/orbit cannot drift behind a
 * tree after starting from a clear angle.
 */
export function resolveFoundingSightline(
  state: SimulationState,
  authoredPosition: THREE.Vector3,
  target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  lensClearance = 0.72,
): FoundingSightlineResolution {
  const radius = Math.hypot(authoredPosition.x - target.x, authoredPosition.z - target.z);
  if (radius < 0.5) {
    const position = authoredPosition.clone();
    position.y = Math.max(position.y, elevationAt(position.x, position.z) + lensClearance);
    return { position, forestObstruction: 0, structureObstruction: 0, angularCorrection: 0, lift: position.y - authoredPosition.y };
  }

  const baseAzimuth = Math.atan2(authoredPosition.z - target.z, authoredPosition.x - target.x);
  const compactShot = radius < 8;
  const liftSteps = compactShot ? [0, 0.45, 0.9, 1.6, 2.5] : [0, 1.5, 3, 5, 8] as const;
  let best: FoundingSightlineResolution | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const lift of liftSteps) {
    for (const offset of FOUNDING_SIGHTLINE_OFFSETS) {
      const angle = baseAzimuth + offset;
      const x = target.x + Math.cos(angle) * radius;
      const z = target.z + Math.sin(angle) * radius;
      const position = new THREE.Vector3(
        x,
        Math.max(authoredPosition.y + lift, elevationAt(x, z) + lensClearance),
        z,
      );
      const forestObstruction = forestSightlineObstruction(state.world, position, target, elevationAt);
      const structureObstruction = structureSightlineObstruction(state, position, target, elevationAt);
      const actualLift = Math.max(0, position.y - authoredPosition.y);
      const score = structureObstruction * 8
        + forestObstruction * 2.4
        + Math.abs(offset) * 0.055
        + actualLift * (compactShot ? 0.07 : 0.025);

      if (score < bestScore) {
        bestScore = score;
        best = { position, forestObstruction, structureObstruction, angularCorrection: offset, lift: actualLift };
      }

      // Buildings are a hard occluder. Forest is a softer proxy because the renderer suppresses
      // individual trees around occupied founding clearings more precisely than world-cell wood.
      if (structureObstruction <= 0.001 && forestObstruction <= 0.055) {
        return { position, forestObstruction, structureObstruction, angularCorrection: offset, lift: actualLift };
      }
    }
  }

  return best ?? {
    position: authoredPosition.clone(),
    forestObstruction: forestSightlineObstruction(state.world, authoredPosition, target, elevationAt),
    structureObstruction: structureSightlineObstruction(state, authoredPosition, target, elevationAt),
    angularCorrection: 0,
    lift: 0,
  };
}

function isFoundingCameraScene(sceneId: string | undefined): boolean {
  return Boolean(sceneId?.startsWith('founding:')
    || sceneId?.startsWith('founding-cast:')
    || sceneId?.startsWith('founding-release:'));
}

function isFoundingOverlayScene(sceneId: string | undefined): boolean {
  return Boolean(sceneId?.startsWith('founding:overview:')
    || sceneId?.startsWith('founding-cast:introduction:'));
}

/**
 * Documentary camera controller. Historical state remains authoritative; this class only decides
 * how the observer glides between and within scenes.
 */
export interface CameraFlightTelemetry {
  readonly active: boolean;
  readonly phase?: 'depart' | 'cruise' | 'approach';
  readonly destinationSceneId?: string;
  readonly startDistance?: number;
  readonly originHeight?: number;
  readonly destinationHeight?: number;
  readonly distance: number;
  readonly horizontalDistance: number;
  readonly speed: number;
  readonly acceleration: number;
  readonly gazeErrorDegrees: number;
  readonly cruiseHeight?: number;
  readonly elapsedSeconds?: number;
  readonly maxSeconds?: number;
  readonly stalledSeconds?: number;
  readonly obstructionRetries?: number;
}

interface CameraFlightState {
  readonly originPosition: THREE.Vector3;
  readonly destinationPosition: THREE.Vector3;
  readonly destinationTarget: THREE.Vector3;
  readonly startDistance: number;
  readonly limits: CameraFlightLimits;
  readonly gazeLimits: CameraFlightLimits;
  readonly approachRadius: number;
  readonly maxSeconds: number;
  readonly maximumCruiseHeight: number;
  phase: 'depart' | 'cruise' | 'approach';
  cruiseHeight: number;
  elapsedSeconds: number;
  bestDistance: number;
  stalledSeconds: number;
  obstructionRetries: number;
}

export class CameraDirector {
  readonly observation: CurrentObservation = { label: 'The known world', detail: 'A new history begins.', kind: 'world-establishing', interest: 0.1, audioCategory: 'ambient-wilderness', revision: 0 };
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly positionVelocity = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly flightAcceleration = new THREE.Vector3();
  private readonly gazeFlightAcceleration = new THREE.Vector3();
  private flight?: CameraFlightState;
  private acquiredScene?: ObservationCandidate;
  private routeCheckSeconds = 0;
  private readonly shotBasePosition = new THREE.Vector3();
  private readonly shotBaseTarget = new THREE.Vector3();
  private readonly trackedFocus = new THREE.Vector3();
  private readonly workingDirection = new THREE.Vector3();
  private readonly workingTangent = new THREE.Vector3();
  private readonly forestCandidatePosition = new THREE.Vector3();
  private safetyInitialized = false;
  private readonly visibility = new CameraVisibilityHysteresis();
  private recoveryOffset?: THREE.Vector3;
  private shotAge = 0;
  private lastHumanShot = false;
  private shotDuration = 12;
  private currentScene?: ObservationCandidate;
  private currentMotion: CameraMotion = 'hold';
  private shotAzimuth = 0;
  private trackingInitialized = false;
  private readonly acknowledgedMajorEventIds = new Set<string>();
  private latestMajorEvent?: SimulationState['history'][number];
  private lastScannedHistoryLength = -1;
  private lastScannedMonth = -1;
  private arrivalActive = false;
  private arrivalSafetySeconds = 0;
  private arrivalSafetyInitialized = false;
  private readonly arrivalSafetyOffset = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly config: GodboxConfig,
    private readonly historian: Historian,
    private readonly subjectPresentation?: CameraSubjectPresentationResolver,
    private readonly humanSubjects?: () => readonly string[],
    private readonly environmentProbe?: CameraEnvironmentProbe,
  ) {
    this.camera.position.set(38, 48, 52);
    this.lookTarget.set(0, 0, 0);
    this.camera.lookAt(this.lookTarget);
  }

  update(deltaSeconds: number, elapsedSeconds: number, state: SimulationState, elevationAt: (x: number, z: number) => number): void {
    if (state.arrival && state.arrival.phase !== 'HISTORY_RUNNING') {
      const focus = arrivalSequenceFocus(state.arrival);
      const target = focus.target;
      this.desiredTarget.set(target.x, target.y, target.z);

      // Arrival uses lens language as part of the shot design: wider for geography, narrower when
      // founders become the subject. Ease focal length continuously so it feels like a camera
      // operator riding the lens rather than a digital zoom cut.
      const fovBlend = 1 - Math.exp(-deltaSeconds * 1.15);
      const nextFov = THREE.MathUtils.lerp(this.camera.fov, focus.fov, fovBlend);
      if (Math.abs(nextFov - this.camera.fov) > 0.001) {
        this.camera.fov = nextFov;
        this.camera.updateProjectionMatrix();
      }

      // Wide Arrival beats preserve one screen direction. Human-scale site beats instead provide
      // an explicit camera pose inside the cleared landing geography so safety does not have to
      // invent a vertical escape route just to reach a founder.
      const azimuth = this.stableAzimuth('arrival:master') + focus.azimuthOffset;
      const authored = focus.cameraPosition
        ? new THREE.Vector3(focus.cameraPosition.x, focus.cameraPosition.y, focus.cameraPosition.z)
        : new THREE.Vector3(
            target.x + Math.cos(azimuth) * focus.radius,
            target.y + focus.height,
            target.z + Math.sin(azimuth) * focus.radius,
          );
      const before = this.camera.position.clone();

      // Exact forest/silhouette safety is intentionally a low-frequency survey during Arrival.
      // The world is nearly static here while the authored target moves every frame; running the
      // full 9-ray corridor search at display frequency turns camera safety into the frame budget.
      // Cache only the correction from the authored pose, then let the spring interpolate smoothly.
      this.arrivalSafetySeconds -= deltaSeconds;
      if (!this.arrivalSafetyInitialized || this.arrivalSafetySeconds <= 0) {
        const safety = resolveCameraSafety(state, authored, this.desiredTarget, elevationAt, {
          lensClearance: 0.72,
          sightlineClearance: 0.22,
          // Do not ask the survey to validate a long swept route. The real lens advances only a
          // small spring step each frame and is guarded below against entering rendered geometry.
          environmentProbe: this.environmentProbe,
        });
        if (safety.valid) {
          this.arrivalSafetyOffset.copy(safety.position).sub(authored);
          this.arrivalSafetyInitialized = true;
        }
        this.arrivalSafetySeconds = 0.25;
      }
      this.desiredPosition.copy(authored).add(this.arrivalSafetyOffset);

      advanceCameraSpring(this.camera.position, this.positionVelocity, this.desiredPosition, deltaSeconds, focus.transitionSeconds);
      advanceCameraSpring(this.lookTarget, this.targetVelocity, this.desiredTarget, deltaSeconds, focus.transitionSeconds / 1.14);
      this.arrivalActive = true;

      // Per-frame Arrival safety is deliberately cheap: one exact lens-volume probe plus terrain
      // clearance. If the next spring step would enter geometry, reject that step and force an
      // immediate full survey on the next frame instead of performing thousands of ray probes now.
      const lensBlocked = cameraLensObstruction(state, this.camera.position, elevationAt, 0.12, this.environmentProbe) > 0.001;
      const lensFloor = elevationAt(this.camera.position.x, this.camera.position.z) + 0.72;
      if (lensBlocked || this.camera.position.y < lensFloor) {
        this.camera.position.copy(before);
        this.positionVelocity.multiplyScalar(0.2);
        this.arrivalSafetySeconds = 0;
      }
      this.camera.lookAt(this.lookTarget);
      this.observation.label = focus.beat === 'pristine' ? 'Before history'
        : focus.beat === 'site-flythrough' ? 'The first camps'
          : focus.beat === 'handoff' ? 'Arrival Day'
            : 'The landings';
      this.observation.detail = focus.beat === 'pristine'
        ? 'Year 0 · Month 0 · Day 0'
        : focus.beat === 'site-flythrough'
          ? `Landing ${(focus.siteIndex ?? 0) + 1} · founders emerge beside the vessel.`
          : focus.beat === 'handoff' ? 'Five communities begin here.'
            : 'Five vessels cross into the world.';
      delete this.observation.sceneId;
      return;
    }
    if (this.arrivalActive) {
      // Preserve the final wide-shot pose as the starting point for the Historian handoff. Reset
      // transient recovery state, but do not mark the camera unsafe or force a first-frame snap.
      this.arrivalActive = false;
      this.arrivalSafetySeconds = 0;
      this.arrivalSafetyInitialized = false;
      this.arrivalSafetyOffset.set(0, 0, 0);
      this.recoveryOffset = undefined;
      this.visibility.reset();
      this.safetyInitialized = true;
      this.positionVelocity.multiplyScalar(0.55);
      this.targetVelocity.multiplyScalar(0.55);
    }
    // Once a destination has been selected, finish the physical flight before making another
    // editorial decision. Major events remain in Historian memory; they never teleport the lens.
    if (this.flight) {
      this.advanceFlight(deltaSeconds, state, elevationAt);
      return;
    }

    this.shotAge += deltaSeconds;
    const majorEvent = this.findMajorEvent(state);
    const readableMinimum = this.currentScene?.id.startsWith('human:') ? 14
      : isPersonalCameraKind(this.currentScene?.kind) ? 10
        : 6;
    const mayInterrupt = this.shotAge >= Math.max(readableMinimum, this.config.camera.transitionSeconds * 1.1);
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

    if (this.flight) {
      this.advanceFlight(deltaSeconds, state, elevationAt);
      return;
    }

    this.animateShot(deltaSeconds, elapsedSeconds, state, elevationAt);

    const before = this.camera.position.clone();
    if (this.recoveryOffset) this.desiredPosition.copy(this.desiredTarget).add(this.recoveryOffset);

    // Local composition changes use the critically damped spring. Large scene-to-scene moves are
    // handled above by the jerk-limited physical flight controller.
    const editorialTiming = foundingEditorialTimingFor(this.currentScene?.id);
    const transitionSeconds = editorialTiming?.transitionSeconds
      ?? this.config.camera.transitionSeconds * cameraTransitionScaleFor(this.currentScene?.kind);
    advanceCameraSpring(this.camera.position, this.positionVelocity, this.desiredPosition, deltaSeconds, transitionSeconds);
    advanceCameraSpring(this.lookTarget, this.targetVelocity, this.desiredTarget, deltaSeconds, transitionSeconds / 1.22);
    const clearance = cameraClearanceFor(this.currentScene?.kind);
    const lensFloor = elevationAt(this.camera.position.x, this.camera.position.z) + clearance.lens;
    if (this.camera.position.y < lensFloor) {
      this.camera.position.y = lensFloor;
      this.positionVelocity.y = Math.max(0, this.positionVelocity.y);
    }
    const targetFloor = elevationAt(this.lookTarget.x, this.lookTarget.z) + cameraTargetFloorFor(this.currentScene?.kind);
    if (this.lookTarget.y < targetFloor) {
      this.lookTarget.y = targetFloor;
      this.targetVelocity.y = Math.max(0, this.targetVelocity.y);
    }

    this.enforceVisibility(before, deltaSeconds, state, elevationAt, clearance);
    this.camera.lookAt(this.lookTarget);
  }

  private enforceVisibility(
    before: THREE.Vector3, deltaSeconds: number, state: SimulationState,
    elevationAt: (x: number, z: number) => number, clearance: CameraClearance,
  ): void {
    const subjects: THREE.Vector3[] = [];
    if (this.currentScene && ['worker-follow', 'traveler-follow', 'discovery-scene'].includes(this.currentScene.kind)) {
      const actor = this.subjectPresentation?.(this.currentScene.subjectId);
      if (actor) {
        subjects.push(new THREE.Vector3(actor.x, actor.footY + 0.17, actor.z));
        const partner = actor.partnerId ? this.subjectPresentation?.(actor.partnerId) : undefined;
        if (partner) subjects.push(new THREE.Vector3(partner.x, partner.footY + 0.17, partner.z));
        if (actor.action) subjects.push(new THREE.Vector3(actor.action.interactionAnchor.x,
          elevationAt(actor.action.interactionAnchor.x, actor.action.interactionAnchor.z) + (actor.action.contactHeight ?? 0.14), actor.action.interactionAnchor.z));
      }
    }
    const options: CameraSafetyOptions = { lensClearance: clearance.lens, sightlineClearance: clearance.sightline,
      environmentProbe: this.environmentProbe, subjects, previousPosition: before };
    const validity = cameraShotValidity(state, this.camera.position, this.desiredTarget, elevationAt, options);
    const corridor = cameraVisibilityCorridor(state, before, this.camera.position, this.desiredTarget, elevationAt, options);
    const failed = this.visibility.update(validity, deltaSeconds, corridor ? 1 : 0);
    const beforeValid = corridor || cameraShotValidity(state, before, this.desiredTarget, elevationAt, options).valid;
    if (!corridor && beforeValid) {
      this.camera.position.copy(before);
      this.positionVelocity.multiplyScalar(0.28);
    }
    // The actual swept move remains checked every frame. The much longer destination survey
    // needs only four checks a second; repeating it at display frequency multiplies ray work.
    this.routeCheckSeconds -= deltaSeconds;
    let route = corridor;
    if (corridor && this.routeCheckSeconds <= 0) {
      route = cameraVisibilityCorridor(state, this.camera.position, this.desiredPosition, this.desiredTarget, elevationAt, options);
      this.routeCheckSeconds = 0.25;
    }
    if (failed || (!route && beforeValid) || !this.safetyInitialized) {
      const safe = resolveCameraSafety(state, this.desiredPosition, this.desiredTarget, elevationAt, options);
      if (safe.valid) {
        if (!this.safetyInitialized) {
          // Startup is the one legitimate hard placement: there is no prior physical camera path
          // to preserve yet.
          this.camera.position.copy(safe.position);
          this.lookTarget.copy(this.desiredTarget);
          this.positionVelocity.set(0, 0, 0);
          this.targetVelocity.set(0, 0, 0);
          this.recoveryOffset = undefined;
        } else if (safe.requiresCut) {
          // Never teleport an established lens. Hold the last valid pose, retire this composition,
          // and let the next editorial destination be reached through CameraFlight.
          this.camera.position.copy(before);
          this.positionVelocity.multiplyScalar(0.32);
          this.targetVelocity.multiplyScalar(0.65);
          this.recoveryOffset = undefined;
          this.shotAge = this.shotDuration;
        } else {
          if (safe.position.distanceTo(this.desiredPosition) > 0.001) {
            this.recoveryOffset = safe.position.clone().sub(this.desiredTarget);
          }
          const next = before.clone().lerp(safe.position, 1 - Math.exp(-deltaSeconds * 4));
          if (cameraVisibilityCorridor(state, before, next, this.desiredTarget, elevationAt, options)) this.camera.position.copy(next);
          this.positionVelocity.multiplyScalar(0.55);
        }
        this.safetyInitialized = true;
      } else {
        // No readable composition exists for this subject: hold safely and request another
        // destination. The camera remains continuous even when the authored shot is impossible.
        this.camera.position.copy(before);
        this.positionVelocity.multiplyScalar(0.25);
        this.targetVelocity.multiplyScalar(0.65);
        this.shotAge = this.shotDuration;
        this.recoveryOffset = undefined;
      }
    }
  }

  current(): ObservationCandidate | undefined {
    // During a flight the documentary still belongs to the last acquired scene. After Arrival there
    // may not be one yet; returning undefined is preferable to pretending the remote destination has
    // already been reached.
    return this.flight ? this.acquiredScene : this.currentScene;
  }

  flightTelemetry(): CameraFlightTelemetry {
    const flight = this.flight;
    if (!flight) {
      return {
        active: false,
        distance: 0,
        horizontalDistance: 0,
        speed: this.positionVelocity.length(),
        acceleration: this.flightAcceleration.length(),
        gazeErrorDegrees: 0,
      };
    }

    this.workingDirection.copy(this.lookTarget).sub(this.camera.position);
    this.workingTangent.copy(flight.destinationTarget).sub(this.camera.position);
    let gazeErrorDegrees = 0;
    if (this.workingDirection.lengthSq() > 1e-8 && this.workingTangent.lengthSq() > 1e-8) {
      const dot = THREE.MathUtils.clamp(
        this.workingDirection.normalize().dot(this.workingTangent.normalize()),
        -1,
        1,
      );
      gazeErrorDegrees = THREE.MathUtils.radToDeg(Math.acos(dot));
    }

    return {
      active: true,
      phase: flight.phase,
      destinationSceneId: this.currentScene?.id,
      startDistance: flight.startDistance,
      originHeight: flight.originPosition.y,
      destinationHeight: flight.destinationPosition.y,
      distance: this.camera.position.distanceTo(flight.destinationPosition),
      horizontalDistance: Math.hypot(
        this.camera.position.x - flight.destinationPosition.x,
        this.camera.position.z - flight.destinationPosition.z,
      ),
      speed: this.positionVelocity.length(),
      acceleration: this.flightAcceleration.length(),
      gazeErrorDegrees,
      cruiseHeight: flight.cruiseHeight,
      elapsedSeconds: flight.elapsedSeconds,
      maxSeconds: flight.maxSeconds,
      stalledSeconds: flight.stalledSeconds,
      obstructionRetries: flight.obstructionRetries,
    };
  }

  private chooseShot(state: SimulationState, elevationAt: (x: number, z: number) => number, focusEventId?: string): void {
    let scene = this.historian.chooseScene(state, focusEventId);
    if (!focusEventId && !isFoundingCameraScene(scene.id) && !this.lastHumanShot) {
      let best: { id: string; view: CameraSubjectPresentation; score: number } | undefined;
      for (const id of this.humanSubjects?.() ?? []) {
        const view = this.subjectPresentation?.(id);
        if (!view?.partnerId || !view.socialMeaning || !this.subjectPresentation?.(view.partnerId)) continue;
        const score = view.socialMeaning;
        if (!best || score > best.score) best = { id, view, score };
      }
      const actor = best && state.people.find(p => p.alive && p.id === best.id);
      const partner = best && state.people.find(p => p.alive && p.id === best.view.partnerId);
      if (best && actor && partner) {
        const id = `human:${actor.id}:${partner.id}`;
        scene = { ...scene, id, subjectId: actor.id, kind: 'worker-follow',
          position: { x: best.view.x, z: best.view.z }, title: `${actor.name} and ${partner.name}`,
          score: best.score, interest: best.score, event: undefined,
          statement: { id, month: state.month, text: `${actor.name} and ${partner.name} share a ${best.view.socialTone ?? 'quiet'} moment.`,
            epistemicStatus: 'probabilistic-inference', sourceEventIds: [], sourceEntityIds: [actor.id, partner.id], sourceArchiveIds: [], claims: {} } };
      }
    }

    this.lastHumanShot = scene.id.startsWith('human:');
    this.currentScene = scene;
    this.shotAge = 0;
    this.trackingInitialized = false;
    this.routeCheckSeconds = 0;
    this.recoveryOffset = undefined;
    this.visibility.reset();

    const framing = FRAMING[scene.kind];
    const foundingProfile = foundingLandingShotProfileFor(scene.id);
    const castProfile = foundingCastShotProfileFor(scene.id);
    const releaseScene = isFoundingReleaseScene(scene.id);
    const openingOverview = scene.id.startsWith('founding:overview:');
    const baseDuration = this.config.camera.shotSeconds[0]
      + (this.config.camera.shotSeconds[1] - this.config.camera.shotSeconds[0]) * (0.28 + scene.score * 0.45);
    this.currentMotion = foundingProfile?.motion ?? (releaseScene ? 'dolly-out' : openingOverview ? 'drift' : this.motionFor(scene));
    const motionDurationScale = this.currentMotion === 'hold' ? 1.12 : this.currentMotion === 'pullback' ? 1.08 : 1;
    const editorialTiming = foundingEditorialTimingFor(scene.id);
    this.shotDuration = editorialTiming?.durationSeconds
      ?? baseDuration * framing.durationScale * motionDurationScale;
    if (scene.id.startsWith('human:')) this.shotDuration = 18;

    const ground = elevationAt(scene.position.x, scene.position.z);
    this.shotBaseTarget.set(scene.position.x, ground + (foundingProfile?.targetHeight
      ?? castProfile?.targetHeight ?? (releaseScene ? 0.32 : framing.targetHeight)), scene.position.z);

    // Preserve the physical side of the world the camera is already occupying. A tiny stable
    // variation avoids mechanical repetition without hashing each scene onto an unrelated compass
    // direction. Arrival's first Historian overview deliberately keeps the prologue master axis.
    const radialX = this.camera.position.x - scene.position.x;
    const radialZ = this.camera.position.z - scene.position.z;
    const inheritedAzimuth = Math.hypot(radialX, radialZ) > 0.75
      ? Math.atan2(radialZ, radialX)
      : this.acquiredScene ? this.shotAzimuth : this.stableAzimuth(scene.id);
    const continuityVariation = (this.stableUnit(`${scene.id}:continuity-angle`) - 0.5) * 0.22;
    const baseAzimuth = (openingOverview
      ? this.stableAzimuth('arrival:master') + 0.02
      : inheritedAzimuth + continuityVariation)
      + (foundingProfile?.azimuthOffset ?? castProfile?.azimuthOffset ?? 0);

    const radius = foundingProfile?.radius ?? castProfile?.radius
      ?? (releaseScene ? 6.8 : this.interpolate(framing.radius, 0.36 + scene.score * 0.4));
    const height = foundingProfile?.height ?? castProfile?.height
      ?? (releaseScene ? 3.4 : this.interpolate(framing.height, 0.42 + scene.interest * 0.32));

    this.shotAzimuth = this.chooseClearAzimuth(state, scene.kind, baseAzimuth, radius, height, ground, elevationAt);
    this.shotBasePosition.set(
      scene.position.x + Math.cos(this.shotAzimuth) * radius,
      ground + height,
      scene.position.z + Math.sin(this.shotAzimuth) * radius,
    );
    this.desiredTarget.copy(this.shotBaseTarget);
    this.desiredPosition.copy(this.shotBasePosition);
    this.raiseForTerrain(elevationAt);

    // Validate the endpoint independently from the travel corridor. If the exact authored pose is
    // inside scenery, choose the nearest readable endpoint now; CameraFlight will still reach it
    // continuously rather than allowing resolveCameraSafety to teleport there later.
    const endpointClearance = cameraClearanceFor(scene.kind);
    const endpoint = resolveCameraSafety(state, this.desiredPosition, this.desiredTarget, elevationAt, {
      lensClearance: endpointClearance.lens,
      sightlineClearance: endpointClearance.sightline,
      environmentProbe: this.environmentProbe,
    });
    if (endpoint.valid) this.desiredPosition.copy(endpoint.position);
    this.shotBasePosition.copy(this.desiredPosition);

    const initialStartup = !this.safetyInitialized && !this.acquiredScene && !this.arrivalActive;
    if (initialStartup) {
      this.camera.position.copy(this.shotBasePosition);
      this.lookTarget.copy(this.shotBaseTarget);
      this.positionVelocity.set(0, 0, 0);
      this.targetVelocity.set(0, 0, 0);
      this.safetyInitialized = true;
      this.acquireCurrentScene();
      return;
    }

    const distance = this.camera.position.distanceTo(this.shotBasePosition);
    if (distance <= 0.45 && this.lookTarget.distanceTo(this.shotBaseTarget) <= 0.9) {
      this.acquireCurrentScene();
      return;
    }
    if (this.acquiredScene && this.acquiredScene.id !== scene.id && isFoundingOverlayScene(this.acquiredScene.id)) {
      this.releaseFoundingOverlayForTransit();
    }
    this.beginFlight(this.shotBasePosition, this.shotBaseTarget, elevationAt);
  }

  private beginFlight(
    destinationPosition: THREE.Vector3,
    destinationTarget: THREE.Vector3,
    elevationAt: (x: number, z: number) => number,
  ): void {
    const horizontalDistance = Math.hypot(
      destinationPosition.x - this.camera.position.x,
      destinationPosition.z - this.camera.position.z,
    );
    const distance = this.camera.position.distanceTo(destinationPosition);
    const profile = cameraFlightProfileFor(this.currentScene?.kind, distance);
    const cruiseHeight = this.flightCruiseHeight(
      destinationPosition,
      elevationAt,
      profile.cruiseClearance,
      profile.destinationLift,
    );
    const maxSeconds = THREE.MathUtils.clamp(
      9 + distance / Math.max(1, profile.limits.maxSpeed) * 2.4,
      14,
      38,
    );
    this.flight = {
      originPosition: this.camera.position.clone(),
      destinationPosition: destinationPosition.clone(),
      destinationTarget: destinationTarget.clone(),
      startDistance: Math.max(0.001, horizontalDistance),
      limits: profile.limits,
      gazeLimits: profile.gazeLimits,
      approachRadius: THREE.MathUtils.clamp(
        horizontalDistance * profile.approachFraction,
        profile.minApproachRadius,
        profile.maxApproachRadius,
      ),
      maxSeconds,
      maximumCruiseHeight: cruiseHeight + 8,
      phase: horizontalDistance > profile.minApproachRadius ? 'depart' : 'approach',
      cruiseHeight,
      elapsedSeconds: 0,
      bestDistance: Math.max(0.001, distance),
      stalledSeconds: 0,
      obstructionRetries: 0,
    };
    this.flightAcceleration.set(0, 0, 0);
    this.gazeFlightAcceleration.set(0, 0, 0);
    this.recoveryOffset = undefined;
  }

  private flightCruiseHeight(
    destination: THREE.Vector3,
    elevationAt: (x: number, z: number) => number,
    landscapeClearance: number,
    destinationLift: number,
  ): number {
    const distance = Math.hypot(destination.x - this.camera.position.x, destination.z - this.camera.position.z);
    let highestGround = Math.max(
      elevationAt(this.camera.position.x, this.camera.position.z),
      elevationAt(destination.x, destination.z),
    );
    const samples = Math.max(6, Math.min(18, Math.ceil(distance / 4)));
    for (let index = 1; index < samples; index += 1) {
      const amount = index / samples;
      highestGround = Math.max(highestGround, elevationAt(
        THREE.MathUtils.lerp(this.camera.position.x, destination.x, amount),
        THREE.MathUtils.lerp(this.camera.position.z, destination.z, amount),
      ));
    }
    return Math.max(this.camera.position.y, destination.y + destinationLift, highestGround + landscapeClearance);
  }

  private advanceFlight(
    deltaSeconds: number,
    state: SimulationState,
    elevationAt: (x: number, z: number) => number,
  ): void {
    const flight = this.flight;
    if (!flight || !this.currentScene) return;
    flight.elapsedSeconds += deltaSeconds;

    const horizontalDistance = Math.hypot(
      flight.destinationPosition.x - this.camera.position.x,
      flight.destinationPosition.z - this.camera.position.z,
    );
    if (flight.phase === 'depart' && this.camera.position.y >= flight.cruiseHeight - 0.4) flight.phase = 'cruise';
    // Personal flights acquire the destination early and spend most of the final leg descending
    // toward the composition. This reads as a deliberate low fly-through instead of cruise-then-drop.
    if (flight.phase === 'cruise' && horizontalDistance <= flight.approachRadius) flight.phase = 'approach';

    if (flight.phase === 'depart') {
      // Climb on a forward arc instead of performing a vertical elevator move first.
      this.desiredPosition.set(
        THREE.MathUtils.lerp(flight.originPosition.x, flight.destinationPosition.x, 0.32),
        flight.cruiseHeight,
        THREE.MathUtils.lerp(flight.originPosition.z, flight.destinationPosition.z, 0.32),
      );
    } else if (flight.phase === 'cruise') {
      this.desiredPosition.set(flight.destinationPosition.x, flight.cruiseHeight, flight.destinationPosition.z);
    } else {
      this.desiredPosition.copy(flight.destinationPosition);
    }

    if (flight.phase === 'approach') {
      this.desiredTarget.copy(flight.destinationTarget);
    } else {
      const dx = flight.destinationPosition.x - this.camera.position.x;
      const dz = flight.destinationPosition.z - this.camera.position.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const ahead = THREE.MathUtils.clamp(horizontalDistance * 0.34, 6, 16);
      const x = this.camera.position.x + dx / length * ahead;
      const z = this.camera.position.z + dz / length * ahead;
      const terrain = elevationAt(x, z);
      // Look along the route, not instantly at the remote subject. This keeps yaw/pitch changes
      // physically coupled to the flight instead of snapping the gaze across the world.
      this.desiredTarget.set(x, Math.max(terrain + 1.4, Math.min(this.camera.position.y - 0.8, flight.destinationTarget.y + 4)), z);
    }

    const before = this.camera.position.clone();
    advanceCameraFlight(
      this.camera.position,
      this.positionVelocity,
      this.flightAcceleration,
      this.desiredPosition,
      deltaSeconds,
      flight.limits,
    );
    advanceCameraFlight(
      this.lookTarget,
      this.targetVelocity,
      this.gazeFlightAcceleration,
      this.desiredTarget,
      deltaSeconds,
      flight.gazeLimits,
    );

    const departureClearance = cameraClearanceFor(this.acquiredScene?.kind).lens;
    const destinationClearance = cameraClearanceFor(this.currentScene.kind).lens;
    const flightClearance = Math.max(0.42, Math.min(1.2, departureClearance, destinationClearance));
    if (!cameraFlightCorridorSafe(state, before, this.camera.position, elevationAt, flightClearance, this.environmentProbe)) {
      // Never cross geometry to preserve a schedule. Return to the last valid frame, bleed momentum,
      // and climb into a new continuous route on the next frame.
      this.camera.position.copy(before);
      this.positionVelocity.multiplyScalar(0.2);
      this.flightAcceleration.set(0, 0, 0);
      flight.obstructionRetries += 1;
      flight.cruiseHeight = Math.min(flight.maximumCruiseHeight, flight.cruiseHeight + 1.4);
      flight.phase = 'depart';
    }

    const remainingDistance = this.camera.position.distanceTo(flight.destinationPosition);
    if (remainingDistance < flight.bestDistance - 0.06) {
      flight.bestDistance = remainingDistance;
      flight.stalledSeconds = 0;
    } else {
      flight.stalledSeconds += deltaSeconds;
    }

    const routeExhausted = flight.elapsedSeconds >= flight.maxSeconds
      || flight.stalledSeconds >= 6
      || (flight.obstructionRetries >= 6 && flight.cruiseHeight >= flight.maximumCruiseHeight - 0.01);
    if (routeExhausted) {
      this.abandonCurrentFlight();
      return;
    }

    this.camera.lookAt(this.lookTarget);

    this.workingDirection.copy(this.lookTarget).sub(this.camera.position).normalize();
    this.workingTangent.copy(flight.destinationTarget).sub(this.camera.position).normalize();
    const gazeAcquired = this.workingDirection.dot(this.workingTangent) >= Math.cos(THREE.MathUtils.degToRad(9));

    if (flight.phase === 'approach'
      && cameraFlightSettled(this.camera.position, this.positionVelocity, flight.destinationPosition, 0.65)
      && gazeAcquired) {
      this.flight = undefined;
      this.flightAcceleration.set(0, 0, 0);
      this.gazeFlightAcceleration.set(0, 0, 0);
      this.positionVelocity.multiplyScalar(0.72);
      this.targetVelocity.multiplyScalar(0.72);
      this.acquireCurrentScene();
    }
  }

  private releaseFoundingOverlayForTransit(): void {
    // The authored founding card has finished. Do not leave its narration pinned to the screen
    // while the camera physically travels to the next scene.
    delete this.observation.sceneId;
    delete this.observation.statement;
    this.observation.label = 'The first day';
    this.observation.detail = 'History continues beyond the landings.';
    this.observation.kind = 'regional-travel';
    this.observation.interest = 0.56;
    this.observation.audioCategory = 'settlement';
    this.observation.eventType = 'ARRIVAL_DAY';
    this.observation.eventMonth = 0;
    this.observation.revision += 1;
  }

  private abandonCurrentFlight(): void {
    // A camera route is presentation, never simulation authority. If a route cannot be completed
    // safely, keep the last valid physical frame and move on rather than trapping the documentary.
    this.flight = undefined;
    this.flightAcceleration.set(0, 0, 0);
    this.gazeFlightAcceleration.set(0, 0, 0);
    this.positionVelocity.multiplyScalar(0.18);
    this.targetVelocity.multiplyScalar(0.35);
    this.currentScene = this.acquiredScene;
    this.lastHumanShot = Boolean(this.acquiredScene?.id.startsWith('human:'));
    this.shotAge = Number.POSITIVE_INFINITY;
    this.trackingInitialized = false;
    this.routeCheckSeconds = 0;
    this.recoveryOffset = undefined;
    this.visibility.reset();
  }

  private acquireCurrentScene(): void {
    if (!this.currentScene) return;
    this.acquiredScene = this.currentScene;
    this.commitObservation(this.currentScene);
    this.shotAge = 0;
    this.trackingInitialized = false;
    this.routeCheckSeconds = 0;
    this.recoveryOffset = undefined;
    this.visibility.reset();
    this.safetyInitialized = true;
  }

  private commitObservation(scene: ObservationCandidate): void {
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
    // The final corridor authority uses actual placements; do not pre-rotate from forest cells.
    if (this.environmentProbe || !FOREST_AWARE_KINDS.has(kind)) return baseAzimuth;

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

    const progress = cameraMotionProgressFor(scene.kind, this.shotAge, this.shotDuration);
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
        const castProfile = foundingCastShotProfileFor(scene.id);
        const presentation = this.subjectPresentation?.(person.id);
        const actorX = presentation?.x ?? person.position.x;
        const actorZ = presentation?.z ?? person.position.z;
        const actorGround = presentation?.footY ?? elevationAt(actorX, actorZ);
        const action = scene.kind === 'traveler-follow' ? undefined : presentation?.action;
        const composition = action ? interactionCameraComposition({ x: actorX, z: actorZ }, action, this.shotAzimuth) : undefined;

        const actorFocusY = actorGround + (castProfile?.targetHeight ?? framing.targetHeight) + Math.max(0, action?.platformHeight ?? 0);
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
        const castDistance = castProfile ? castProfile.radius + castProfile.distanceDelta * eased : undefined;
        const followingDistance = (castDistance ?? this.interpolate(framing.radius, framingVariation)) + (composition?.distanceBoost ?? 0);
        const cameraHeight = castProfile?.height ?? this.interpolate(framing.height, framingVariation);
        const contactLock = composition?.contactLock ?? 0;
        const baseAngle = composition?.azimuth ?? this.shotAzimuth;
        const authoredOrbit = castProfile ? (eased - 0.5) * castProfile.orbitSpan : 0;
        const microOrbit = Math.sin(elapsedSeconds * 0.11 + this.shotAzimuth) * 0.035 * (1 - contactLock * 0.88);
        const angle = baseAngle + authoredOrbit + microOrbit;
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

/** Protect each person, not just the empty midpoint between their silhouettes. */
export function resolveHumanSightline(state: SimulationState, authored: THREE.Vector3, focus: THREE.Vector3,
  subjects: readonly THREE.Vector3[], elevationAt: (x: number, z: number) => number): THREE.Vector3 {
  const radius = Math.hypot(authored.x - focus.x, authored.z - focus.z);
  const base = Math.atan2(authored.z - focus.z, authored.x - focus.x);
  let best = authored.clone(), bestScore = Infinity;
  for (const lift of [0, 0.35, 0.7, 1.2]) for (const offset of FOUNDING_SIGHTLINE_OFFSETS) {
    const x = focus.x + Math.cos(base + offset) * radius, z = focus.z + Math.sin(base + offset) * radius;
    const point = new THREE.Vector3(x, Math.max(authored.y + lift, elevationAt(x, z) + 0.42), z);
    let obstruction = 0;
    for (const subject of subjects) obstruction = Math.max(obstruction,
      forestSightlineObstruction(state.world, point, subject, elevationAt)
      + structureSightlineObstruction(state, point, subject, elevationAt) * 8);
    const score = obstruction * 10 + Math.abs(offset) * 0.025 + lift * 0.05;
    if (score < bestScore) { best = point; bestScore = score; }
    if (obstruction < 0.02) return point;
  }
  return best;
}
