import type { Vector3 } from 'three';

export interface CameraFlightLimits {
  readonly maxSpeed: number;
  readonly maxAcceleration: number;
  readonly maxJerk: number;
  readonly responseSeconds: number;
}

const EPSILON = 1e-6;
const MAX_SUBSTEP_SECONDS = 1 / 120;

function clampLength(vector: Vector3, maximum: number): void {
  const length = vector.length();
  if (length > maximum && length > EPSILON) vector.multiplyScalar(maximum / length);
}

/**
 * Jerk-limited arrival steering for large camera translations.
 *
 * The ordinary camera spring is ideal once the lens is composing a subject. Long relocations need
 * a different physical contract: bounded velocity, bounded acceleration and bounded change in
 * acceleration. Substeps make the path stable across common render rates and prevent one hitch from
 * becoming a visible leap across the world.
 */
export function advanceCameraFlight(
  position: Vector3,
  velocity: Vector3,
  acceleration: Vector3,
  target: Readonly<Vector3>,
  deltaSeconds: number,
  limits: CameraFlightLimits,
): void {
  const dt = Number.isFinite(deltaSeconds) ? Math.min(0.1, Math.max(0, deltaSeconds)) : 0;
  if (dt <= 0) return;

  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_SECONDS));
  const stepSeconds = dt / steps;
  const offset = position.clone();
  const desiredVelocity = position.clone();
  const desiredAcceleration = position.clone();
  const accelerationDelta = position.clone();

  for (let step = 0; step < steps; step += 1) {
    offset.copy(target).sub(position);
    const distance = offset.length();
    if (distance <= 0.0005 && velocity.lengthSq() <= 0.0004 && acceleration.lengthSq() <= 0.0025) {
      position.copy(target);
      velocity.set(0, 0, 0);
      acceleration.set(0, 0, 0);
      continue;
    }

    const brakingSpeed = Math.sqrt(Math.max(0, 2 * limits.maxAcceleration * distance));
    const desiredSpeed = Math.min(limits.maxSpeed, brakingSpeed);
    if (distance > EPSILON) desiredVelocity.copy(offset).multiplyScalar(desiredSpeed / distance);
    else desiredVelocity.set(0, 0, 0);

    desiredAcceleration.copy(desiredVelocity).sub(velocity)
      .multiplyScalar(1 / Math.max(0.08, limits.responseSeconds));
    clampLength(desiredAcceleration, limits.maxAcceleration);

    accelerationDelta.copy(desiredAcceleration).sub(acceleration);
    clampLength(accelerationDelta, limits.maxJerk * stepSeconds);
    acceleration.add(accelerationDelta);
    clampLength(acceleration, limits.maxAcceleration);

    velocity.addScaledVector(acceleration, stepSeconds);
    clampLength(velocity, limits.maxSpeed);

    offset.copy(target).sub(position);
    const remaining = offset.length();
    const travel = velocity.length() * stepSeconds;
    if (remaining > EPSILON && travel >= remaining && velocity.dot(offset) > 0) {
      position.copy(target);
      velocity.multiplyScalar(0.35);
      acceleration.multiplyScalar(0.25);
    } else {
      position.addScaledVector(velocity, stepSeconds);
    }
  }
}

export function cameraFlightSettled(position: Readonly<Vector3>, velocity: Readonly<Vector3>, target: Readonly<Vector3>, tolerance = 0.35): boolean {
  return position.distanceTo(target) <= tolerance && velocity.length() <= Math.max(0.22, tolerance * 0.8);
}
