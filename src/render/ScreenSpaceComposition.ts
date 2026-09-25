import * as THREE from 'three';
import type { ObservationKind } from '../historian/types';

export interface ScreenCompositionTarget {
  readonly x: number;
  readonly y: number;
  readonly deadZoneX: number;
  readonly deadZoneY: number;
  readonly fov: number;
}

export interface ScreenCompositionResult {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly subjectNdcX: number;
  readonly subjectNdcY: number;
  readonly desiredFov: number;
}

const PERSONAL = new Set<ObservationKind>([
  'street-observation',
  'worker-follow',
  'traveler-follow',
  'discovery-scene',
]);

const WIDE = new Set<ObservationKind>([
  'world-establishing',
  'regional-travel',
  'settlement-approach',
  'battle-overview',
  'aftermath-pullback',
  'city-growth-timelapse',
  'landscape-pause',
  'historian-context',
  'orbital-establishing',
  'civilization-ending',
]);

function targetFor(kind: ObservationKind, moving: boolean, pair: boolean): ScreenCompositionTarget {
  if (PERSONAL.has(kind)) {
    return {
      x: pair ? 0 : moving ? -0.18 : -0.12,
      y: 0.06,
      deadZoneX: pair ? 0.12 : 0.08,
      deadZoneY: 0.08,
      fov: kind === 'worker-follow' || kind === 'discovery-scene' ? 34 : 36,
    };
  }
  if (kind === 'institution-exterior' || kind === 'infrastructure-scene') {
    return { x: -0.1, y: 0.02, deadZoneX: 0.1, deadZoneY: 0.1, fov: 37 };
  }
  if (WIDE.has(kind)) {
    return { x: 0, y: -0.08, deadZoneX: 0.16, deadZoneY: 0.14, fov: 40 };
  }
  return { x: 0, y: 0, deadZoneX: 0.12, deadZoneY: 0.12, fov: 38 };
}

function deadZoneCorrection(error: number, deadZone: number): number {
  const magnitude = Math.abs(error);
  if (magnitude <= deadZone) return 0;
  return Math.sign(error) * (magnitude - deadZone);
}

/**
 * Converts a desired screen-space composition into a small world-space focus offset.
 * This intentionally remains a gentle trim layer: world-space camera safety and flight
 * remain authoritative, while composition nudges the look target into thirds/headroom.
 */
export function screenSpaceComposition(
  camera: THREE.PerspectiveCamera,
  subject: THREE.Vector3,
  kind: ObservationKind,
  options?: {
    readonly moving?: boolean;
    readonly pair?: boolean;
    readonly leadDirection?: THREE.Vector3;
    readonly distance?: number;
  },
): ScreenCompositionResult {
  const target = targetFor(kind, Boolean(options?.moving), Boolean(options?.pair));
  const projected = subject.clone().project(camera);
  const xError = target.x - projected.x;
  const yError = target.y - projected.y;
  const correctedX = deadZoneCorrection(xError, target.deadZoneX);
  const correctedY = deadZoneCorrection(yError, target.deadZoneY);

  const distance = Math.max(0.5, options?.distance ?? camera.position.distanceTo(subject));
  const halfVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
  const halfHorizontal = halfVertical * Math.max(0.1, camera.aspect);

  const offsetX = THREE.MathUtils.clamp(correctedX * halfHorizontal * 0.52, -1.2, 1.2);
  const offsetY = THREE.MathUtils.clamp(correctedY * halfVertical * 0.4, -0.7, 0.7);

  return {
    offsetX,
    offsetY,
    subjectNdcX: projected.x,
    subjectNdcY: projected.y,
    desiredFov: target.fov,
  };
}

export function easeCameraFov(current: number, desired: number, dtSeconds: number): number {
  const dt = Math.max(0, Math.min(0.1, dtSeconds));
  const alpha = 1 - Math.exp(-dt / 0.9);
  return THREE.MathUtils.lerp(current, desired, alpha);
}
