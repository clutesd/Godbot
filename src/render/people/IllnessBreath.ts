import * as THREE from 'three';

/** Brief condensed cough breath, not a visualization of invisible pathogens. */
export class IllnessBreath {
  readonly mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#d2d4cb', transparent: true, opacity: 0.09, depthWrite: false }), 32);
  private readonly transform = new THREE.Object3D();
  constructor() { this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'Cold cough condensation'; }
  beginFrame(): void { this.mesh.count = 0; }
  draw(x: number, y: number, z: number, yaw: number, seconds: number, size: number): void {
    const phase = ((seconds * 0.7) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const age = phase - Math.PI / 2;
    if (age < 0 || age > 0.35 || this.mesh.count >= 32) return;
    this.transform.position.set(x + Math.sin(yaw) * (0.03 + age * 0.3) * size,
      y + age * 0.06 * size, z + Math.cos(yaw) * (0.03 + age * 0.3) * size);
    this.transform.scale.setScalar((0.01 + age * 0.08) * Math.sin(age / 0.35 * Math.PI) * size);
    this.transform.updateMatrix();
    this.mesh.setMatrixAt(this.mesh.count++, this.transform.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}
