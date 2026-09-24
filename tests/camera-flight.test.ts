import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { advanceCameraFlight, cameraFlightSettled } from '../src/render/CameraFlight';

describe('physical camera flight', () => {
  it('bounds speed acceleration and jerk while converging across common frame rates', () => {
    const target = new Vector3(58, 18, -37);
    const limits = { maxSpeed: 9, maxAcceleration: 2.2, maxJerk: 6, responseSeconds: 0.42 };
    const results = [30, 60, 144].map(fps => {
      const position = new Vector3();
      const velocity = new Vector3();
      const acceleration = new Vector3();
      let maxSpeed = 0;
      let maxAcceleration = 0;
      let maxJerk = 0;
      const previousAcceleration = new Vector3();
      for (let frame = 0; frame < fps * 24; frame += 1) {
        previousAcceleration.copy(acceleration);
        advanceCameraFlight(position, velocity, acceleration, target, 1 / fps, limits);
        maxSpeed = Math.max(maxSpeed, velocity.length());
        maxAcceleration = Math.max(maxAcceleration, acceleration.length());
        maxJerk = Math.max(maxJerk, acceleration.clone().sub(previousAcceleration).length() * fps);
      }
      expect(maxSpeed).toBeLessThanOrEqual(limits.maxSpeed + 1e-6);
      expect(maxAcceleration).toBeLessThanOrEqual(limits.maxAcceleration + 1e-6);
      expect(maxJerk).toBeLessThanOrEqual(limits.maxJerk + 0.08);
      expect(cameraFlightSettled(position, velocity, target, 0.5)).toBe(true);
      return position;
    });
    expect(results[0]!.distanceTo(results[1]!)).toBeLessThan(0.08);
    expect(results[1]!.distanceTo(results[2]!)).toBeLessThan(0.08);
  });

  it('preserves forward momentum when the destination changes instead of reversing instantly', () => {
    const position = new Vector3();
    const velocity = new Vector3();
    const acceleration = new Vector3();
    const limits = { maxSpeed: 8, maxAcceleration: 2, maxJerk: 5, responseSeconds: 0.4 };
    const forward = new Vector3(30, 0, 0);
    for (let frame = 0; frame < 120; frame += 1) {
      advanceCameraFlight(position, velocity, acceleration, forward, 1 / 60, limits);
    }
    const before = velocity.x;
    advanceCameraFlight(position, velocity, acceleration, new Vector3(-30, 0, 0), 1 / 60, limits);
    expect(before).toBeGreaterThan(0);
    expect(velocity.x).toBeGreaterThan(0);
    expect(Math.abs(velocity.x - before)).toBeLessThan(0.15);
  });
});
