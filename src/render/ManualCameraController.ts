import * as THREE from 'three';

export class ManualCameraController {
  private enabled = false;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.repeat || event.target instanceof HTMLInputElement) return;
    const key = event.code;
    if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(key)) {
      event.preventDefault();
      this.keys.add(key);
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || document.pointerLockElement !== this.domElement) return;
    this.yaw -= event.movementX * 0.0018;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -Math.PI * 0.48, Math.PI * 0.48);
  };
  private readonly onClick = (): void => {
    if (this.enabled && document.pointerLockElement !== this.domElement) void this.domElement.requestPointerLock();
  };

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly domElement: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    domElement.addEventListener('click', this.onClick);
  }

  get active(): boolean { return this.enabled; }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    if (enabled) {
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.pitch = euler.x;
      this.yaw = euler.y;
      void this.domElement.requestPointerLock();
    } else if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) return;
    const dt = Math.min(0.05, Math.max(0, deltaSeconds));
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 0.001) this.forward.normalize();
    this.right.crossVectors(this.forward, this.up).normalize();

    const desired = new THREE.Vector3();
    if (this.keys.has('KeyW')) desired.add(this.forward);
    if (this.keys.has('KeyS')) desired.sub(this.forward);
    if (this.keys.has('KeyD')) desired.add(this.right);
    if (this.keys.has('KeyA')) desired.sub(this.right);
    if (this.keys.has('KeyE')) desired.y += 1;
    if (this.keys.has('KeyQ')) desired.y -= 1;
    if (desired.lengthSq() > 1) desired.normalize();

    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 15 : 7;
    desired.multiplyScalar(speed);
    const alpha = 1 - Math.exp(-dt / 0.12);
    this.velocity.lerp(desired, alpha);
    this.camera.position.addScaledVector(this.velocity, dt);
  }

  dispose(): void {
    this.setEnabled(false);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('click', this.onClick);
  }
}
