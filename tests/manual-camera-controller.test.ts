import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ManualCameraController } from '../src/render/ManualCameraController';

describe('ManualCameraController', () => {
  it('takes over without changing the camera pose on activation', () => {
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    camera.position.set(4, 8, 12);
    camera.lookAt(0, 2, 0);
    const element = document.createElement('canvas');
    element.requestPointerLock = vi.fn();
    const controller = new ManualCameraController(camera, element);
    const beforePosition = camera.position.clone();
    const beforeDirection = new THREE.Vector3();
    camera.getWorldDirection(beforeDirection);

    controller.setEnabled(true);
    controller.update(1 / 60);

    expect(camera.position.distanceTo(beforePosition)).toBeLessThan(1e-6);
    const afterDirection = new THREE.Vector3();
    camera.getWorldDirection(afterDirection);
    expect(afterDirection.angleTo(beforeDirection)).toBeLessThan(1e-5);
    controller.dispose();
  });

  it('stays in manual mode when pointer lock is denied', async () => {
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const element = document.createElement('canvas');
    element.requestPointerLock = vi.fn(() => Promise.reject(new Error('pointer lock denied')));
    const controller = new ManualCameraController(camera, element);

    controller.setEnabled(true);
    await Promise.resolve();

    expect(controller.active).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    controller.update(1 / 10);
    expect(camera.position.z).toBeLessThan(0);
    controller.dispose();
  });

  it('supports WASD movement while enabled and ignores movement while autonomous', () => {
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const element = document.createElement('canvas');
    element.requestPointerLock = vi.fn();
    const controller = new ManualCameraController(camera, element);

    controller.setEnabled(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    for (let i = 0; i < 30; i += 1) controller.update(1 / 60);
    expect(camera.position.z).toBeLessThan(-0.1);

    controller.setEnabled(false);
    const stopped = camera.position.clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    controller.update(0.5);
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-6);
    controller.dispose();
  });
});
