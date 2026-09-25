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


  it('treats invalid or backwards frame deltas as no-ops and clamps a long browser hitch', () => {
    const limits = { maxSpeed: 8, maxAcceleration: 2, maxJerk: 5, responseSeconds: 0.4 };
    for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const position = new Vector3(2, 3, 4);
      const velocity = new Vector3(1, 0, 0);
      const acceleration = new Vector3(0.5, 0, 0);
      const before = [position.clone(), velocity.clone(), acceleration.clone()];
      advanceCameraFlight(position, velocity, acceleration, new Vector3(20, 3, 4), delta, limits);
      expect(position.equals(before[0]!)).toBe(true);
      expect(velocity.equals(before[1]!)).toBe(true);
      expect(acceleration.equals(before[2]!)).toBe(true);
    }

    const long = { position: new Vector3(), velocity: new Vector3(), acceleration: new Vector3() };
    const clamped = { position: new Vector3(), velocity: new Vector3(), acceleration: new Vector3() };
    const target = new Vector3(20, 5, -8);
    advanceCameraFlight(long.position, long.velocity, long.acceleration, target, 2, limits);
    advanceCameraFlight(clamped.position, clamped.velocity, clamped.acceleration, target, 0.1, limits);
    expect(long.position.distanceTo(clamped.position)).toBeLessThan(1e-10);
    expect(long.velocity.distanceTo(clamped.velocity)).toBeLessThan(1e-10);
    expect(long.acceleration.distanceTo(clamped.acceleration)).toBeLessThan(1e-10);
  });

  it('does not report acquisition while residual momentum is still too high', () => {
    const target = new Vector3(10, 0, 0);
    expect(cameraFlightSettled(new Vector3(10.1, 0, 0), new Vector3(0.2, 0, 0), target, 0.35)).toBe(true);
    expect(cameraFlightSettled(new Vector3(10.1, 0, 0), new Vector3(1.2, 0, 0), target, 0.35)).toBe(false);
    expect(cameraFlightSettled(new Vector3(11, 0, 0), new Vector3(), target, 0.35)).toBe(false);
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
