/**
 * GODBOX prioritizes stable image fidelity over automatic resolution relief.
 * Performance work must reduce simulation/render cost rather than silently lowering final output resolution.
 */
export class AdaptiveResolution {
  readonly scale = 1;

  sample(deltaSeconds: number): boolean {
    void deltaSeconds;
    return false;
  }
}
