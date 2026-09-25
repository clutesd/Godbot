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

function mouseMoveEvent(movementX: number, movementY: number): MouseEvent {
  const event = new Event('mousemove');
  Object.defineProperties(event, {
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  return event as MouseEvent;
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


  it('applies mouse look only while this canvas owns pointer lock', () => {
    const { documentTarget } = installDomStubs();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const element = testCanvas();
    const controller = new ManualCameraController(camera, element);
    controller.setEnabled(true);

    const before = camera.quaternion.clone();
    documentTarget.dispatchEvent(mouseMoveEvent(120, -50));
    controller.update(1 / 60);
    expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-8);

    documentTarget.pointerLockElement = element;
    documentTarget.dispatchEvent(mouseMoveEvent(120, -50));
    controller.update(1 / 60);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.05);
    controller.dispose();
  });

  it('supports vertical flight and a faster Shift travel mode without changing diagonal top speed', () => {
    const { windowTarget } = installDomStubs();
    const ordinaryCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const fastCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const ordinary = new ManualCameraController(ordinaryCamera, testCanvas());
    const fast = new ManualCameraController(fastCamera, testCanvas());

    ordinary.setEnabled(true);
    fast.setEnabled(true);

    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyD'));
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyE'));
    for (let i = 0; i < 30; i += 1) ordinary.update(1 / 60);
    const ordinaryDistance = ordinaryCamera.position.length();
    expect(ordinaryCamera.position.y).toBeGreaterThan(0);

    // Clear the shared key state in both controllers, then drive the fast controller with Shift.
    windowTarget.dispatchEvent(keyboardEvent('keyup', 'KeyW'));
    windowTarget.dispatchEvent(keyboardEvent('keyup', 'KeyD'));
    windowTarget.dispatchEvent(keyboardEvent('keyup', 'KeyE'));
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    windowTarget.dispatchEvent(keyboardEvent('keydown', 'ShiftLeft'));
    for (let i = 0; i < 30; i += 1) fast.update(1 / 60);

    expect(fastCamera.position.length()).toBeGreaterThan(ordinaryDistance);
    ordinary.dispose();
    fast.dispose();
  });

  it('exits owned pointer lock and stops all motion when manual mode is disabled', () => {
    const { windowTarget, documentTarget } = installDomStubs();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const element = testCanvas();
    const controller = new ManualCameraController(camera, element);
    controller.setEnabled(true);
    documentTarget.pointerLockElement = element;

    windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
    controller.update(0.05);
    const beforeDisable = camera.position.clone();

    controller.setEnabled(false);
    expect(documentTarget.exitPointerLock).toHaveBeenCalledTimes(1);
    controller.update(0.5);
    expect(camera.position.distanceTo(beforeDisable)).toBeLessThan(1e-9);
    controller.dispose();
  });

  it('caps a long frame delta so a browser hitch cannot launch the manual camera across the world', () => {
    const run = (dt: number): THREE.Vector3 => {
      const { windowTarget } = installDomStubs();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
      const controller = new ManualCameraController(camera, testCanvas());
      controller.setEnabled(true);
      windowTarget.dispatchEvent(keyboardEvent('keydown', 'KeyW'));
      controller.update(dt);
      const position = camera.position.clone();
      controller.dispose();
      vi.unstubAllGlobals();
      return position;
    };

    expect(run(5).distanceTo(run(0.05))).toBeLessThan(1e-10);
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
