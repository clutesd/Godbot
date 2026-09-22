import * as THREE from 'three';
import type { Settlement, War } from '../../sim/types';
import type { MilitaryCapabilityProfile } from '../../sim/war/MilitaryCapability';
import { campaignPoint } from '../../sim/war/Campaign';
import { militaryVisualStyle, type PrimaryWeaponVisual } from './MilitaryVisualLanguage';

const MAX_SMOKE = 28;
const MAX_FLASH = 16;
const MAX_TRACERS = 14;
const clamp = THREE.MathUtils.clamp;

/** Only an authoritative, structure-specific event may supply these facts.
 * Aggregate casualties or archive losses are deliberately insufficient. */
export interface StructuralBattleEvidence {
  readonly eventId: string;
  readonly structureId: string;
  readonly position: Readonly<{ x: number; z: number }>;
  readonly damage: number;
  readonly burning: boolean;
}

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
  private readonly structuralDebris = new THREE.InstancedMesh(this.flashGeometry, new THREE.MeshStandardMaterial({ color: '#65594a', roughness: 1 }), 24);
  private readonly structuralFire = new THREE.InstancedMesh(this.flashGeometry, new THREE.MeshBasicMaterial({ color: '#da792e' }), 12);
  private structuralEvidence: StructuralBattleEvidence[] = [];
  private disposed = false;
  private lastBattle = -1;
  private residueX = 0;
  private residueZ = 0;

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Capability battle spectacle';
    this.structuralDebris.name = 'Authoritative structure debris';
    this.structuralFire.name = 'Authoritative structure fire';
    for (const mesh of [this.smoke, this.flashes, this.tracers, this.structuralDebris, this.structuralFire]) {
      mesh.count = 0;
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

  /** Bounded replace semantics: the provider owns repair/extinguish/cleanup lifecycle. */
  setStructuralEvidence(evidence: readonly StructuralBattleEvidence[]): void {
    const seen = new Set<string>();
    this.structuralEvidence = [];
    for (const item of evidence) {
      if (this.structuralEvidence.length === 12) break;
      if (!item.eventId || !item.structureId || seen.has(item.structureId) || !Number.isFinite(item.damage)
        || item.damage <= 0 || !Number.isFinite(item.position.x) || !Number.isFinite(item.position.z)) continue;
      seen.add(item.structureId);
      this.structuralEvidence.push({ ...item, damage: Math.min(1, item.damage), position: { ...item.position } });
    }
  }

  beginWeapons(): void {
    this.flashes.count = this.tracers.count = 0;
  }

  /** The same cadence/pose supplies muzzle contact and the projectile; no free-floating flashes. */
  weaponAttack(x: number, y: number, z: number, yaw: number, distance: number, weapon: PrimaryWeaponVisual,
    flash: boolean, flight: number, fade: number): void {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    if (flash && this.flashes.count < MAX_FLASH) this.part(this.flashes, this.flashes.count++,
      x + dx * 0.24, y, z + dz * 0.24, yaw, 0, 0.045 * fade);
    if (flight >= 0 && this.tracers.count < MAX_TRACERS) {
      const bow = weapon === 'bow';
      const travel = 0.24 + Math.max(0, distance - 0.4) * flight;
      const arc = bow ? Math.sin(flight * Math.PI) * 0.45 : 0;
      this.part(this.tracers, this.tracers.count++, x + dx * travel, y + arc, z + dz * travel,
        yaw, bow ? -Math.cos(flight * Math.PI) * 0.35 : 0, (bow ? 0.42 : 0.25) * fade);
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
    eventTime = -Infinity,
  ): void {
    if (this.disposed) return;
    const frontProgress = 0.76 + clamp(war.progress, -1, 1) * 0.08;
    const front = campaignPoint(war.campaign.route, frontProgress, settlements[1].position);
    const active = war.resolvedMonth === undefined && war.phase === 'battle' && war.campaign.blockedMonths === 0;
    if (this.lastBattle !== war.campaign.battleCount) {
      this.residueX = front.x; this.residueZ = front.z;
      this.lastBattle = war.campaign.battleCount;
    }
    // Absolute event-relative decay, not a last-rendered-frame timestamp.
    const intensity = Math.max(0, 1 - Math.max(0, elapsed - eventTime) / 15);
    const firing = active && battlePulse > 0;
    const time = reducedMotion ? 0 : elapsed;
    this.structuralDebris.count = this.structuralFire.count = 0;
    for (const evidence of this.structuralEvidence) {
      const { x, z } = evidence.position;
      const y = this.elevationAt(x, z);
      for (let i = 0; i < 2; i++) this.part(this.structuralDebris, this.structuralDebris.count++,
        x + (i ? 0.22 : -0.22), y + 0.04, z + 0.18, i * 2.4, 0.3, 0.08 * evidence.damage);
      if (evidence.burning) this.part(this.structuralFire, this.structuralFire.count++, x, y + 0.18, z,
        0, 0, (0.12 + (reducedMotion ? 0 : Math.sin(time * 5) * 0.015)) * evidence.damage);
    }
    this.structuralDebris.instanceMatrix.needsUpdate = this.structuralFire.instanceMatrix.needsUpdate = true;
    const styles = [militaryVisualStyle(profiles[0]), militaryVisualStyle(profiles[1])] as const;
    const smokeBudget = Math.min(MAX_SMOKE, Math.round((styles[0].smoke + styles[1].smoke) * intensity * 0.65));

    this.smoke.count = smokeBudget;
    this.smoke.material.opacity = 0.15 * intensity * fade;
    for (let i = 0; i < smokeBudget; i++) {
      const life = reducedMotion ? (i + 1) / Math.max(1, smokeBudget + 1) : (time * 0.13 + i * 0.173) % 1;
      const angle = i * 2.399 + time * 0.05;
      const radius = 0.18 + life * (0.8 + (i % 4) * 0.17);
      const x = this.residueX + Math.cos(angle) * radius;
      const z = this.residueZ + Math.sin(angle) * radius;
      const y = this.elevationAt(x, z) + 0.22 + life * 1.3;
      const scale = (0.08 + life * 0.34) * Math.sin(Math.max(0.08, life) * Math.PI) * fade;
      this.part(this.smoke, i, x, y, z, angle, 0, Math.max(0.01, scale));
    }
    this.smoke.instanceMatrix.needsUpdate = true;

    this.flashes.instanceMatrix.needsUpdate = true;
    this.tracers.instanceMatrix.needsUpdate = true;

    this.aircraft.forEach(airframe => {
      const count = styles[airframe.side].aircraft;
      airframe.group.visible = firing && airframe.index < count && fade > 0.02;
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
      missile.group.visible = firing && missile.index < count && fade > 0.02;
      if (!missile.group.visible) return;
      const side = missile.side;
      const launchProgress = frontProgress + (side === 0 ? -0.08 : 0.08);
      const targetProgress = frontProgress + (side === 0 ? 0.018 : -0.018);
      const start = campaignPoint(war.campaign.route, launchProgress, settlements[side].position);
      const end = campaignPoint(war.campaign.route, targetProgress, settlements[side === 0 ? 1 : 0].position);
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
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child instanceof THREE.InstancedMesh) child.dispose();
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.structuralEvidence = [];
    this.group.clear();
  }
}
