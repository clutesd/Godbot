import * as THREE from 'three';

/** Two rigid segments, composed in body space. No bones, allocations or per-person objects.
 * Positive shoulder/hip flexion points forward; knees bend back and elbows bend forward.
 * Composing yaw BEFORE local flexion is essential: world XYZ Euler swing fans arms sideways.
 */
export class HumanJointRig {
  readonly upper = new THREE.Matrix4();
  readonly lower = new THREE.Matrix4();
  readonly tip = new THREE.Vector3();
  private readonly local = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly one = new THREE.Vector3(1, 1, 1);

  compose(parent: THREE.Matrix4, x: number, y: number, flexion: number, bend: number,
    length: number, lowerLength: number, arm: boolean, splay = 0): void {
    this.local.makeTranslation(x, y, 0);
    this.upper.multiplyMatrices(parent, this.local);
    this.local.makeRotationZ(splay);
    this.upper.multiply(this.local);
    this.local.makeRotationX(-flexion);
    this.upper.multiply(this.local);
    this.local.makeTranslation(0, -length, 0);
    this.lower.multiplyMatrices(this.upper, this.local);
    this.local.makeRotationX((arm ? -1 : 1) * bend);
    this.lower.multiply(this.local);
    this.tip.set(0, -lowerLength, 0).applyMatrix4(this.lower);
  }

  /** Analytic two-link reach in torso space, with a stable outward elbow pole. Unreachable
   * targets are clamped, never achieved by stretching anatomy or moving the person. */
  reach(parent: THREE.Matrix4, x: number, y: number, worldTarget: THREE.Vector3,
    length: number, lowerLength: number, side: number): void {
    this.inverse.copy(parent).invert();
    this.target.copy(worldTarget).applyMatrix4(this.inverse).sub(this.elbow.set(x, y, 0));
    const distance = Math.max(Math.abs(length - lowerLength) + 0.0001,
      Math.min(length + lowerLength - 0.0001, this.target.length()));
    this.direction.copy(this.target).normalize();
    if (this.direction.lengthSq() < 0.1) this.direction.copy(this.down);
    this.target.copy(this.direction).multiplyScalar(distance).add(this.elbow);
    this.pole.set(side, -0.3, 0).addScaledVector(this.direction, -this.direction.dot(this.pole)).normalize();
    if (this.pole.lengthSq() < 0.1) this.pole.set(0, 0, 1);
    const along = (length * length + distance * distance - lowerLength * lowerLength) / (2 * distance);
    this.elbow.addScaledVector(this.direction, along).addScaledVector(this.pole, Math.sqrt(Math.max(0, length * length - along * along)));
    this.direction.copy(this.elbow).sub(this.pole.set(x, y, 0)).normalize();
    this.rotation.setFromUnitVectors(this.down, this.direction);
    this.local.compose(this.pole, this.rotation, this.one);
    this.upper.multiplyMatrices(parent, this.local);
    this.direction.copy(this.target).sub(this.elbow).normalize();
    this.rotation.setFromUnitVectors(this.down, this.direction);
    this.local.compose(this.elbow, this.rotation, this.one);
    this.lower.multiplyMatrices(parent, this.local);
    this.tip.set(0, -lowerLength, 0).applyMatrix4(this.lower);
  }
}
