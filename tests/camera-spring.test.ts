import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { advanceCameraSpring } from '../src/render/CameraSpring';

describe('critically damped camera spring', () => {
  it('settles identically at 30, 60 and 144 Hz without overshooting a held target', () => {
    const results = [30, 60, 144].map(fps => {
      const position = new Vector3();
      const velocity = new Vector3();
      const target = new Vector3(10, 5, -8);
      let lastX = 0;
      for (let frame = 0; frame < fps * 4; frame += 1) {
        advanceCameraSpring(position, velocity, target, 1 / fps, 4);
        expect(position.x).toBeGreaterThanOrEqual(lastX);
        expect(position.x).toBeLessThan(10);
        lastX = position.x;
      }
      return position;
    });

    expect(results[0]!.distanceTo(results[1]!)).toBeLessThan(1e-10);
    expect(results[1]!.distanceTo(results[2]!)).toBeLessThan(1e-10);
    expect(results[0]!.x).toBeGreaterThan(9.5);
  });

  it('eases in from rest and preserves momentum when editorial composition changes', () => {
    const position = new Vector3();
    const velocity = new Vector3();
    const target = new Vector3(20, 0, 0);
    advanceCameraSpring(position, velocity, target, 1 / 60, 4);
    expect(position.x).toBeLessThan(0.01);

    for (let i = 0; i < 60; i += 1) advanceCameraSpring(position, velocity, target, 1 / 60, 4);
    const before = velocity.x;
    advanceCameraSpring(position, velocity, new Vector3(-20, 0, 0), 1 / 144, 4);

    expect(velocity.x).toBeGreaterThan(0);
    expect(Math.abs(velocity.x - before)).toBeLessThan(0.5);
  });

  it('treats backwards and non-finite frame deltas as no-ops', () => {
    for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const position = new Vector3(2, 3, 4);
      const velocity = new Vector3(0.5, -0.1, 0.2);
      const beforePosition = position.clone();
      const beforeVelocity = velocity.clone();

      advanceCameraSpring(position, velocity, new Vector3(9, 5, -3), delta, 3);

      expect(position.equals(beforePosition)).toBe(true);
      expect(velocity.equals(beforeVelocity)).toBe(true);
    }
  });
});
