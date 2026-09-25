import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { easeCameraFov, screenSpaceComposition } from '../src/render/ScreenSpaceComposition';

describe('ScreenSpaceComposition', () => {
  it('leaves a well-composed subject inside the dead zone alone', () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);
    const subject = new THREE.Vector3(-0.45, 1.25, 0);

    const result = screenSpaceComposition(camera, subject, 'worker-follow', { distance: 5 });
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it('produces bounded correction for an off-frame personal subject', () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);
    const subject = new THREE.Vector3(3.5, 1.2, 0);

    const result = screenSpaceComposition(camera, subject, 'street-observation', { moving: true, distance: 6 });
    expect(Math.abs(result.offsetX)).toBeGreaterThan(0);
    expect(Math.abs(result.offsetX)).toBeLessThanOrEqual(1.2);
    expect(Math.abs(result.offsetY)).toBeLessThanOrEqual(0.7);
  });


  it('gives a moving subject lead room in the actual direction of travel', () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);
    const subject = new THREE.Vector3(0, 1.2, 0);

    const movingRight = screenSpaceComposition(camera, subject, 'traveler-follow', {
      moving: true,
      leadDirection: new THREE.Vector3(1, 0, 0),
      distance: 5,
    });
    const movingLeft = screenSpaceComposition(camera, subject, 'traveler-follow', {
      moving: true,
      leadDirection: new THREE.Vector3(-1, 0, 0),
      distance: 5,
    });

    expect(movingRight.offsetX).toBeLessThan(0);
    expect(movingLeft.offsetX).toBeGreaterThan(0);
    expect(Math.abs(movingRight.offsetX)).toBeCloseTo(Math.abs(movingLeft.offsetX), 6);
  });

  it('centers a two-person composition more neutrally than a solo portrait', () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);
    const subject = new THREE.Vector3(0, 1.2, 0);

    const solo = screenSpaceComposition(camera, subject, 'worker-follow', { distance: 5 });
    const pair = screenSpaceComposition(camera, subject, 'worker-follow', { pair: true, distance: 5 });

    expect(solo.offsetX).toBeLessThan(0);
    expect(pair.offsetX).toBe(0);
  });

  it('stays finite and bounded on portrait and ultrawide viewports', () => {
    for (const aspect of [9 / 16, 16 / 9, 32 / 9]) {
      const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 100);
      camera.position.set(0, 1.5, 5);
      camera.lookAt(0, 1.2, 0);
      camera.updateMatrixWorld(true);
      const result = screenSpaceComposition(
        camera,
        new THREE.Vector3(4, 2.4, 0),
        'street-observation',
        { moving: true, distance: 6 },
      );

      expect(Number.isFinite(result.offsetX)).toBe(true);
      expect(Number.isFinite(result.offsetY)).toBe(true);
      expect(Math.abs(result.offsetX)).toBeLessThanOrEqual(1.2);
      expect(Math.abs(result.offsetY)).toBeLessThanOrEqual(0.7);
    }
  });

  it('uses tighter documentary lenses for personal shots and wider lenses for establishing shots', () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    camera.position.set(0, 2, 6);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    const subject = new THREE.Vector3(0, 1, 0);

    const personal = screenSpaceComposition(camera, subject, 'worker-follow');
    const wide = screenSpaceComposition(camera, subject, 'world-establishing');
    expect(personal.desiredFov).toBeLessThan(wide.desiredFov);
  });

  it('eases FOV gradually, frame-rate independently, without overshooting or poisoning on invalid deltas', () => {
    const results = [30, 60, 144].map(fps => {
      let fov = 38;
      for (let i = 0; i < fps * 2; i += 1) fov = easeCameraFov(fov, 34, 1 / fps);
      expect(fov).toBeLessThan(38);
      expect(fov).toBeGreaterThanOrEqual(34);
      return fov;
    });
    expect(Math.abs(results[0]! - results[1]!)).toBeLessThan(1e-10);
    expect(Math.abs(results[1]! - results[2]!)).toBeLessThan(1e-10);
    expect(easeCameraFov(38, 34, -1)).toBe(38);
    expect(easeCameraFov(38, 34, Number.NaN)).toBe(38);
    expect(easeCameraFov(38, 34, Number.POSITIVE_INFINITY)).toBe(38);
  });
});
