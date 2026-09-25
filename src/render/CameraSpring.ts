import type { Vector3 } from 'three';

/** Exact critically damped response to a held target. Velocity survives editorial changes. */
export function advanceCameraSpring(position: Vector3, velocity: Vector3, target: Vector3, deltaSeconds: number, settlingSeconds: number): void {
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const omega = 5 / Math.max(0.5, settlingSeconds);
  const decay = Math.exp(-omega * dt);
  for (const axis of ['x', 'y', 'z'] as const) {
    const offset = position[axis] - target[axis];
    const impulse = velocity[axis] + omega * offset;
    position[axis] = target[axis] + (offset + impulse * dt) * decay;
    velocity[axis] = (velocity[axis] - omega * impulse * dt) * decay;
  }
}
