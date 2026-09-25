import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ManualCameraController } from '../src/render/ManualCameraController';

interface TestDocument extends EventTarget {
  pointerLockElement: EventTarget | null;
  exitPointerLock: ReturnType<typeof vi.fn>;
}

function installDomStubs(): { windowTarget: EventTarget; documentTarget: TestDocument } {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget() as TestDocument;
  documentTarget.pointerLockElement = null;
  documentTarget.exitPointerLock = vi.fn(() => { documentTarget.pointerLockElement = null; });

  class TestInputElement extends EventTarget {}
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('HTMLInputElement', TestInputElement);
  return { windowTarget, documentTarget };
}

function testCanvas(requestPointerLock: () => void | Promise<void> = vi.fn()): HTMLElement {
  const element = new EventTarget() as EventTarget & { requestPointerLock: () => void | Promise<void> };
  element.requestPointerLock = requestPointerLock;
  return element as unknown as HTMLElement;
}

function keyboardEvent(type: 'keydown' | 'keyup', code: string): KeyboardEvent {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  Object.defineProperty(event, 'repeat', { value: false });
  return event as KeyboardEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ManualCameraController', () => {
  it('takes over without changing the camera pose on activation', () => {
    installDomStubs();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    camera.position.set(4, 8, 12);
    camera.lookAt(0, 2, 0);
    const element = testCanvas();
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
    const { windowTarget } = installDomStubs();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const element = testCanvas(() => Promise.reject(new Error('pointer lock denied')));
    const controller = new ManualCameraController(camera, element);

    controller.setEnabled(true);
    await Promise.resolve();

    expect(controller.active).toBe(true);
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    controller.update(1 / 10);
    expect(camera.position.z).toBeLessThan(0);
    controller.dispose();
  });

  it('supports WASD movement while enabled and ignores movement while autonomous', () => {
    const { windowTarget } = installDomStubs();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const element = testCanvas();
    const controller = new ManualCameraController(camera, element);

    controller.setEnabled(true);
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    for (let i = 0; i < 30; i += 1) controller.update(1 / 60);
    expect(camera.position.z).toBeLessThan(-0.1);

    controller.setEnabled(false);
    const stopped = camera.position.clone();
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    controller.update(0.5);
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-6);
    controller.dispose();
  });

  it('clears held movement when the window loses focus', () => {
    const { windowTarget } = installDomStubs();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const controller = new ManualCameraController(camera, testCanvas());

    controller.setEnabled(true);
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    controller.update(0.05);
    const moving = camera.position.clone();

    windowTarget.dispatchEvent(new Event('blur'));
    controller.update(0.5);

    expect(camera.position.distanceTo(moving)).toBeLessThan(1e-6);
    controller.dispose();
  });
});
