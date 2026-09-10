import * as THREE from 'three';
import type { Settlement, Vec2, War } from '../../sim/types';
import type { MilitaryCapabilityProfile } from '../../sim/war/MilitaryCapability';
import { campaignPoint } from '../../sim/war/Campaign';
import { militaryVisualStyle } from './MilitaryVisualLanguage';

const MAX_SMOKE = 28;
const MAX_FLASH = 16;
const MAX_TRACERS = 14;
const MAX_AIRCRAFT = 4;
const MAX_MISSILES = 4;
const clamp = THREE.MathUtils.clamp;

interface Airframe {
  group: THREE.Group;
  side: 0 | 1;
  index: number;
}

interface MissileVisual {
  group: THREE.Group;
  side: 0 | 1;
  index: number;
}

/**
 * Purely documentary battle spectacle. Every effect is bounded, deterministic from elapsed time,
 * and incapable of changing simulation state. It makes Step-2 capability differences legible at a glance.
 */
export class BattleSpectacle {
  readonly group = new THREE.Group();
  private readonly matrix = new THREE.Object3D();
  private readonly smokeGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly flashGeometry = new THREE.IcosahedronGeometry(1, 0);
  private readonly tracerGeometry = new THREE.BoxGeometry(0.018, 0.018, 0.42);
  private readonly smoke = new THREE.InstancedMesh(this.smokeGeometry, new THREE.MeshBasicMaterial({ color: '#756f68', transparent: true, opacity: 0.2, depthWrite: false }), MAX_SMOKE);
  private readonly flashes = new THREE.InstancedMesh(this.flashGeometry, new THREE.MeshBasicMaterial({ color: '#ffd79a', transparent: true, opacity: 0.95, depthWrite: false }), MAX_FLASH);
  private readonly tracers = new THREE.InstancedMesh(this.tracerGeometry, new THREE.MeshBasicMaterial({ color: '#ffcf85', transparent: true, opacity: 0.8, depthWrite: false }), MAX_TRACERS);
  private readonly aircraft: Airframe[] = [];
  private readonly missiles: MissileVisual[] = [];
  private disposed = false;

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Capability battle spectacle';
    for (const mesh of [this.smoke, this.flashes, this.tracers]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    for (let side = 0 as 0 | 1; side <= 1; side = (side + 1) as 0 | 1) {
      for (let i = 0; i < 2; i++) {
        const airframe = this.makeAircraft(side, i);
        const missile = this.makeMissile(side, i);
        this.aircraft.push(airframe);
        this.missiles.push(missile);
        this.group.add(airframe.group, missile.group);
      }
    }
  }

  update(
    war: War,
    settlements: readonly [Settlement, Settlement],
    profiles: readonly [MilitaryCapabilityProfile, MilitaryCapabilityProfile],
    elapsed: number,
    battlePulse: number,
    fade: number,
    reducedMotion: boolean,
  ): void {
    if (this.disposed) return;
    const frontProgress = 0.76 + clamp(war.progress, -1, 1) * 0.08;
    const front = campaignPoint(war.campaign.route, frontProgress, settlements[1].position);
    const active = !war.resolvedMonth && war.phase === 'battle' && war.campaign.blockedMonths === 0;
    const intensity = active ? Math.max(0.28, battlePulse) : 0;
    const time = reducedMotion ? 0 : elapsed;
    const styles = [militaryVisualStyle(profiles[0]), militaryVisualStyle(profiles[1])] as const;
    const smokeBudget = Math.min(MAX_SMOKE, Math.round((styles[0].smoke + styles[1].smoke) * intensity * 0.65));
    const flashBudget = Math.min(MAX_FLASH, Math.round((styles[0].flash + styles[1].flash) * intensity * 0.55));
    const tracerBudget = Math.min(MAX_TRACERS, Math.round((styles[0].tracer + styles[1].tracer) * intensity * 0.55));

    this.smoke.count = smokeBudget;
    this.smoke.material.opacity = 0.06 + 0.19 * intensity * fade;
    for (let i = 0; i < smokeBudget; i++) {
      const life = reducedMotion ? (i + 1) / Math.max(1, smokeBudget + 1) : (time * 0.13 + i * 0.173) % 1;
      const angle = i * 2.399 + time * 0.05;
      const radius = 0.18 + life * (0.8 + (i % 4) * 0.17);
      const x = front.x + Math.cos(angle) * radius;
      const z = front.z + Math.sin(angle) * radius;
      const y = this.elevationAt(x, z) + 0.22 + life * 1.3;
      const scale = (0.08 + life * 0.34) * Math.sin(Math.max(0.08, life) * Math.PI) * fade;
      this.part(this.smoke, i, x, y, z, angle, 0, Math.max(0.01, scale));
    }
    this.smoke.instanceMatrix.needsUpdate = true;

    this.flashes.count = flashBudget;
    for (let i = 0; i < flashBudget; i++) {
      const side = (i % 2) as 0 | 1;
      const phase = reducedMotion ? 0.7 : Math.sin(time * (8.4 + (i % 3)) + i * 2.71) * 0.5 + 0.5;
      const source = campaignPoint(war.campaign.route, frontProgress + (side === 0 ? -0.012 : 0.012), settlements[side].position);
      const angle = i * 2.13 + side * Math.PI;
      const radius = 0.18 + (i % 5) * 0.08;
      const x = source.x + Math.cos(angle) * radius;
      const z = source.z + Math.sin(angle) * radius;
      const y = this.elevationAt(x, z) + 0.22 + (i % 3) * 0.035;
      const scale = phase > 0.72 ? (0.025 + phase * 0.055) * intensity * fade : 0.001;
      this.part(this.flashes, i, x, y, z, angle, 0, scale);
    }
    this.flashes.instanceMatrix.needsUpdate = true;

    this.tracers.count = tracerBudget;
    for (let i = 0; i < tracerBudget; i++) {
      const side = (i % 2) as 0 | 1;
      const forward = side === 0 ? 1 : -1;
      const phase = reducedMotion ? 0.45 : (time * 1.7 + i * 0.137) % 1;
      const source = campaignPoint(war.campaign.route, frontProgress + (side === 0 ? -0.02 : 0.02), settlements[side].position);
      const target = campaignPoint(war.campaign.route, frontProgress + (side === 0 ? 0.018 : -0.018), settlements[1 - side].position);
      const x = THREE.MathUtils.lerp(source.x, target.x, phase) + Math.sin(i * 3.1) * 0.12;
      const z = THREE.MathUtils.lerp(source.z, target.z, phase) + Math.cos(i * 2.7) * 0.12;
      const dx = target.x - source.x;
      const dz = target.z - source.z;
      const yaw = Math.atan2(dx, dz) + (forward < 0 ? Math.PI : 0);
      const y = this.elevationAt(x, z) + 0.2 + Math.sin(phase * Math.PI) * 0.28;
      this.part(this.tracers, i, x, y, z, yaw, 0, Math.max(0.01, 0.5 * intensity * fade));
    }
    this.tracers.instanceMatrix.needsUpdate = true;

    this.aircraft.forEach(airframe => {
      const count = styles[airframe.side].aircraft;
      airframe.group.visible = active && airframe.index < count && fade > 0.02;
      if (!airframe.group.visible) return;
      const sideDirection = airframe.side === 0 ? 1 : -1;
      const phase = reducedMotion ? 0.35 + airframe.index * 0.2 : (time * 0.07 + airframe.index * 0.37 + airframe.side * 0.19) % 1;
      const sweep = (phase - 0.5) * 8.5 * sideDirection;
      const cross = Math.sin(phase * Math.PI * 2 + airframe.index) * 2.1;
      const x = front.x + sweep;
      const z = front.z + cross;
      const y = this.elevationAt(x, z) + 2.4 + Math.sin(phase * Math.PI) * 1.1 + airframe.index * 0.25;
      airframe.group.position.set(x, y, z);
      airframe.group.rotation.set(0.08 * Math.sin(phase * Math.PI * 2), sideDirection > 0 ? Math.PI / 2 : -Math.PI / 2, -0.16 * Math.sin(phase * Math.PI * 2));
      airframe.group.scale.setScalar(0.75 + profiles[airframe.side].airPower * 0.2);
    });

    this.missiles.forEach(missile => {
      const count = styles[missile.side].missiles;
      missile.group.visible = active && missile.index < count && fade > 0.02;
      if (!missile.group.visible) return;
      const side = missile.side;
      const launchProgress = frontProgress + (side === 0 ? -0.08 : 0.08);
      const targetProgress = frontProgress + (side === 0 ? 0.018 : -0.018);
      const start = campaignPoint(war.campaign.route, launchProgress, settlements[side].position);
      const end = campaignPoint(war.campaign.route, targetProgress, settlements[1 - side].position);
      const phase = reducedMotion ? 0.55 : (time * 0.16 + missile.index * 0.43 + side * 0.21) % 1;
      const x = THREE.MathUtils.lerp(start.x, end.x, phase);
      const z = THREE.MathUtils.lerp(start.z, end.z, phase);
      const ground = this.elevationAt(x, z);
      const y = ground + 0.45 + Math.sin(phase * Math.PI) * (2.2 + profiles[side].missile * 1.2);
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const yaw = Math.atan2(dx, dz);
      const horizontal = Math.max(0.001, Math.hypot(dx, dz));
      const dy = Math.cos(phase * Math.PI) * Math.PI * (2.2 + profiles[side].missile * 1.2);
      const pitch = -Math.atan2(dy, horizontal);
      missile.group.position.set(x, y, z);
      missile.group.rotation.set(pitch, yaw, 0, 'YXZ');
      missile.group.scale.setScalar(0.72 + profiles[side].missile * 0.2);
    });
  }

  private part(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, yaw: number, pitch: number, scale: number): void {
    this.matrix.position.set(x, y, z);
    this.matrix.rotation.set(pitch, yaw, 0, 'YXZ');
    this.matrix.scale.setScalar(scale);
    this.matrix.updateMatrix();
    mesh.setMatrixAt(index, this.matrix.matrix);
  }

  private makeAircraft(side: 0 | 1, index: number): Airframe {
    const group = new THREE.Group();
    group.name = `aircraft-${side}-${index}`;
    const material = new THREE.MeshStandardMaterial({ color: side === 0 ? '#5d615f' : '#4f5b5c', roughness: 0.68, metalness: 0.12 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2e3434', roughness: 0.82 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.55, 6), material);
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 6), material);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.34;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.025, 0.15), material);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.11), dark);
    tail.position.z = -0.22;
    group.add(body, nose, wing, tail);
    group.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    group.visible = false;
    return { group, side, index };
  }

  private makeMissile(side: 0 | 1, index: number): MissileVisual {
    const group = new THREE.Group();
    group.name = `missile-${side}-${index}`;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#d9d5c7', roughness: 0.55, metalness: 0.16 });
    const glowMaterial = new THREE.MeshBasicMaterial({ color: '#ffc477', transparent: true, opacity: 0.85, depthWrite: false });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 6), bodyMaterial);
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), bodyMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.23;
    const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), glowMaterial);
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.z = -0.28;
    group.add(body, nose, exhaust);
    group.visible = false;
    return { group, side, index };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.smoke, this.flashes, this.tracers]) {
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => material.dispose());
    }
    for (const object of [...this.aircraft.map(item => item.group), ...this.missiles.map(item => item.group)]) {
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => material.dispose());
      });
    }
    this.group.clear();
  }
}
