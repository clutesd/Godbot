import * as THREE from 'three';
import type { BattleImpact, Vec2 } from '../../sim/types';
import { battleAtmosphereMaterial } from './BattleAtmosphere';

/** One-shot effects at recorded hit coordinates. Fixed pools never allocate per frame. */
export class ResolvedImpactEffects {
  readonly group = new THREE.Group();
  private readonly transform = new THREE.Object3D();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly alpha = new THREE.InstancedBufferAttribute(new Float32Array(192), 1).setUsage(THREE.DynamicDrawUsage);
  private readonly dust: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly fragments = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.055, 0.07),
    new THREE.MeshStandardMaterial({ color: '#827869', roughness: 1 }), 144);
  private readonly projectiles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 8, 6),
    new THREE.MeshBasicMaterial({ color: '#d8a267' }), 24);
  private readonly flashes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 12, 8),
    new THREE.MeshBasicMaterial({ color: '#ffbc6d', toneMapped: false, transparent: true, opacity: 0.7, depthWrite: false }), 24);

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Recorded destructive impacts';
    this.geometry.setAttribute('effectOpacity', this.alpha);
    this.dust = new THREE.InstancedMesh(this.geometry, battleAtmosphereMaterial('#a69883', 0.45, true), 192);
    this.dust.name = 'Building collapse dust and vaporization ash';
    this.fragments.name = 'Building blast fragments'; this.projectiles.name = 'Recorded shells and siege projectiles';
    this.flashes.name = 'Recorded target contact flashes';
    for (const mesh of [this.dust, this.fragments, this.projectiles, this.flashes]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh);
    }
  }

  update(impacts: readonly BattleImpact[], time: number, reducedMotion: boolean, front?: Vec2, yaw = 0): void {
    for (const mesh of [this.dust, this.fragments, this.projectiles, this.flashes]) mesh.count = 0;
    if (!reducedMotion) for (const hit of impacts.slice(0, 64)) {
      const age = time - hit.impactAt;
      const p = hit.position, ground = this.elevationAt(p.x, p.z);
      const ballistic = hit.weapon === 'shell' || hit.weapon === 'siege';
      const flight = ballistic ? 1.2 : 0.16;
      if (front && (ballistic || hit.weapon === 'projectile') && age >= -flight && age < 0) {
        const phase = (age + flight) / flight;
        const startX = front.x + Math.sin(yaw) * (hit.side ? 1 : -1) * 2.4;
        const startZ = front.z + Math.cos(yaw) * (hit.side ? 1 : -1) * 2.4;
        this.put(this.projectiles, THREE.MathUtils.lerp(startX, p.x, phase),
          ground + 0.3 * (1 - phase) + Math.sin(phase * Math.PI) * (ballistic ? 1.1 : 0.015),
          THREE.MathUtils.lerp(startZ, p.z, phase), hit.weapon === 'siege' ? 2.8 : ballistic ? 1 : 0.35);
      }
      if (age < 0 || age > 7 || hit.weapon === 'melee' || hit.weapon === 'projectile') continue;
      if (age < 0.24 && this.flashes.count < 24) this.put(this.flashes, p.x, ground + 0.2, p.z, (1 - age / 0.24) * (hit.targetKind === 'structure' ? 2 : 0.7));
      const building = hit.targetKind === 'structure';
      for (let i = 0; i < (building ? 14 : 5); i++) {
        const localAge = Math.max(0, age - i * 0.035), angle = i * 2.399;
        const spread = Math.sqrt(localAge) * (building ? 0.5 : 0.2);
        if (this.dust.count < 192) {
          this.put(this.dust, p.x + Math.cos(angle) * spread + localAge * 0.045,
            ground + 0.1 + localAge * (hit.vaporized ? 0.3 : 0.12), p.z + Math.sin(angle) * spread,
            (building ? 0.12 : 0.06) + localAge * 0.1);
          this.alpha.setX(this.dust.count - 1, Math.min(1, localAge * 8) * Math.max(0, 1 - localAge / 7));
        }
        if (building && !hit.vaporized && localAge < 1.1 && this.fragments.count < 144) {
          const x = p.x + Math.cos(angle) * localAge * 1.3, z = p.z + Math.sin(angle) * localAge * 1.3;
          this.put(this.fragments, x, Math.max(this.elevationAt(x, z) + 0.03,
            ground + Math.sin(localAge / 1.1 * Math.PI) * 0.9), z, Math.max(0, 1 - localAge / 1.1), localAge * 7 + i);
        }
      }
    }
    for (const mesh of [this.dust, this.fragments, this.projectiles, this.flashes]) mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }

  private put(mesh: THREE.InstancedMesh, x: number, y: number, z: number, size: number, spin = 0): void {
    if (mesh.count >= mesh.instanceMatrix.count) return;
    this.transform.position.set(x, y, z); this.transform.rotation.set(spin, spin * 0.7, spin * 0.3);
    this.transform.scale.setScalar(size); this.transform.updateMatrix(); mesh.setMatrixAt(mesh.count++, this.transform.matrix);
  }
  dispose(): void {
    for (const mesh of [this.dust, this.fragments, this.projectiles, this.flashes]) {
      mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
