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
    expect(Math.abs(result.offsetX)).toBeLessThan(0.5);
    expect(Math.abs(result.offsetY)).toBeLessThan(0.5);
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

  it('eases FOV gradually without overshooting', () => {
    let fov = 38;
    for (let i = 0; i < 60; i += 1) fov = easeCameraFov(fov, 34, 1 / 60);
    expect(fov).toBeLessThan(38);
    expect(fov).toBeGreaterThanOrEqual(34);
  });
});
