import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BattleImpact, Vec2 } from '../../sim/types';
import type { MilitaryVisualStyle } from './MilitaryVisualLanguage';
import { battleAtmosphereMaterial } from './BattleAtmosphere';

const MISSILE_PERIOD = 12;
const MISSILE_FLIGHT = 3.6;
const DRONE_PERIOD = 17;
const MAX_DRONES = 16;
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const smooth = (t: number) => t * t * (3 - 2 * t);
const modulo = (t: number, period: number) => ((t % period) + period) % period;
type Point = Readonly<{ x: number; y: number; z: number }>;

/** Authored cinematic motion, sampled at absolute event time. It is never a simulation of
 * guidance or damage: the recorded battle and its frozen equipment authorize presentation. */
export function missileFlight(start: Point, end: Point, phase: number, lane = 1): THREE.Vector3 {
  const p = clamp(phase, 0, 1);
  const travel = smooth(p);
  const dx = end.x - start.x, dz = end.z - start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const bend = Math.sin(p * Math.PI) * 0.18 * lane;
  return new THREE.Vector3(mix(start.x, end.x, travel) + dz / length * bend,
    mix(start.y, end.y, p) + Math.sin(p * Math.PI) * (1.05 + Math.min(1.1, length * 0.12)),
    mix(start.z, end.z, travel) - dx / length * bend);
}

export function droneFlight(home: Point, target: Point, age: number, index: number) {
  const orbit = new THREE.Vector3(home.x + Math.cos(age * 0.85 + index) * 0.28,
    home.y + Math.sin(age * 1.2 + index * 2) * 0.035, home.z + Math.sin(age * 0.85 + index) * 0.28);
  if (age < 3) return { position: orbit, stage: 'loiter' as const };
  if (age < 6) {
    const p = smooth((age - 3) / 3);
    const departure = new THREE.Vector3(home.x + Math.cos(3 * 0.85 + index) * 0.28,
      home.y + Math.sin(3 * 1.2 + index * 2) * 0.035, home.z + Math.sin(3 * 0.85 + index) * 0.28);
    return { position: departure.lerp(new THREE.Vector3(target.x, target.y + 1.05, target.z), p), stage: 'approach' as const };
  }
  const p = smooth(clamp((age - 6) / 1.6, 0, 1));
  return { position: new THREE.Vector3(target.x, mix(target.y + 1.05, target.y, p), target.z), stage: 'dive' as const };
}

interface Missile {
  group: THREE.Group;
  launcher: THREE.Group;
  flame: THREE.Mesh;
  side: 0 | 1;
  index: number;
}
interface ParticlePool {
  mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  alpha: THREE.InstancedBufferAttribute;
}

/** Fixed GPU pools: four missiles, sixteen drones and bounded impact particles per campaign. */
export class AdvancedBattleEffects {
  readonly group = new THREE.Group();
  private readonly transform = new THREE.Object3D();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly missiles: Missile[] = [];
  private readonly trails = this.particles('Missile exhaust trails', '#a8a7a0', 0.38, 128);
  private readonly impactSmoke = this.particles('Strike smoke plumes', '#67665f', 0.42, 120);
  private readonly impactDust = this.particles('Strike ground dust', '#aa9170', 0.35, 120);
  private readonly impactFire = this.particles('Strike ignition flashes', '#ffd39c', 0.95, 48, true);
  private readonly drones: THREE.InstancedMesh;
  private readonly sensors: THREE.InstancedMesh;
  private readonly rotors: THREE.InstancedMesh;
  private readonly debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.015, 0.012, 0.018),
    new THREE.MeshStandardMaterial({ color: '#847461', roughness: 1 }), 120);
  private disposed = false;

  constructor(private readonly elevationAt: (x: number, z: number) => number) {
    this.group.name = 'Advanced missile and drone attacks';
    const pieces: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(0.105, 0.036, 0.14); pieces.push(body);
    const battery = new THREE.BoxGeometry(0.065, 0.024, 0.1); battery.translate(0, 0.03, 0); pieces.push(battery);
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const arm = new THREE.BoxGeometry(0.27, 0.014, 0.018); arm.rotateY(angle); pieces.push(arm);
    }
    for (const x of [-0.095, 0.095]) for (const z of [-0.095, 0.095]) {
      const motor = new THREE.CylinderGeometry(0.014, 0.014, 0.028, 8); motor.translate(x, 0.012, z); pieces.push(motor);
      const guard = new THREE.TorusGeometry(0.042, 0.0025, 4, 16); guard.rotateX(Math.PI / 2); guard.translate(x, 0.025, z); pieces.push(guard);
    }
    const geometry = mergeGeometries(pieces)!; pieces.forEach(piece => piece.dispose());
    this.drones = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: '#626963', roughness: 0.65, metalness: 0.2 }), MAX_DRONES);
    this.drones.name = 'Advanced swarm drones';
    const sensor = new THREE.SphereGeometry(0.022, 8, 6); sensor.translate(0, -0.038, 0.04);
    this.sensors = new THREE.InstancedMesh(sensor, new THREE.MeshStandardMaterial({ color: '#182427', roughness: 0.2, metalness: 0.55 }), MAX_DRONES);
    this.sensors.name = 'Drone optical gimbals';
    const rotor = new THREE.CircleGeometry(0.039, 16); rotor.rotateX(-Math.PI / 2);
    this.rotors = new THREE.InstancedMesh(rotor, new THREE.MeshBasicMaterial({ color: '#90968d', transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }), MAX_DRONES * 4);
    this.rotors.name = 'Drone rotor blur';
    this.debris.name = 'Transient strike ejecta';
    for (const mesh of [this.drones, this.sensors, this.rotors, this.debris]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    this.drones.castShadow = true;
    this.sensors.castShadow = true;
    for (const side of [0, 1] as const) for (let index = 0; index < 2; index++) {
      const missile = this.makeMissile(side, index); this.missiles.push(missile);
      this.group.add(missile.group, missile.launcher);
    }
  }

  update(front: Vec2, yaw: number, gap: number, styles: readonly [MilitaryVisualStyle, MilitaryVisualStyle],
    eventTime: number, firing: boolean, fade: number, reducedMotion: boolean, impacts: readonly BattleImpact[] = []): void {
    if (this.disposed) return;
    this.group.visible = firing && fade > 0.02;
    for (const pool of [this.trails, this.impactSmoke, this.impactDust, this.impactFire]) {
      pool.mesh.count = 0; pool.mesh.material.uniforms.opacity!.value = pool.mesh.material.userData['baseOpacity'] * fade;
    }
    this.drones.count = this.sensors.count = this.rotors.count = this.debris.count = 0;
    if (!this.group.visible) return;
    const point = (depth: number, lateral: number, height: number): THREE.Vector3 => {
      const x = front.x + Math.sin(yaw) * depth + Math.cos(yaw) * lateral;
      const z = front.z + Math.cos(yaw) * depth - Math.sin(yaw) * lateral;
      return new THREE.Vector3(x, this.elevationAt(x, z) + height, z);
    };
    for (const missile of this.missiles) {
      const { side, index } = missile;
      const equipped = index < styles[side].missiles;
      const direction = side === 0 ? -1 : 1;
      const start = point(direction * (gap / 2 + 1.5), (index ? -1 : 1) * 0.8, 0.25);
      const assigned = impacts.filter(hit => hit.side === side && hit.weapon === 'missile')
        .filter((_, hitIndex) => hitIndex % Math.max(1, styles[side].missiles) === index);
      const recorded = assigned.find(hit => eventTime < hit.impactAt + 0.3) ?? assigned.at(-1);
      const end = recorded ? new THREE.Vector3(recorded.position.x, this.elevationAt(recorded.position.x, recorded.position.z) + 0.015, recorded.position.z)
        : point(-direction * (gap / 2 + 0.55), (index - 0.5) * 0.85, 0.015);
      const launchTime = recorded ? eventTime - recorded.impactAt + MISSILE_FLIGHT : eventTime - 0.7 - side * 1.55 - index * 3.4;
      const age = launchTime < 0 ? MISSILE_PERIOD - 0.01 : recorded ? launchTime : modulo(launchTime, MISSILE_PERIOD);
      missile.launcher.visible = equipped;
      missile.launcher.position.set(start.x, start.y - 0.25, start.z);
      missile.launcher.rotation.y = yaw + (side ? Math.PI : 0);
      const flying = !reducedMotion && age < MISSILE_FLIGHT;
      const parked = reducedMotion || age > 9;
      missile.group.visible = equipped && (flying || parked);
      missile.flame.visible = flying;
      if (!equipped) continue;
      if (flying) {
        const p = age / MISSILE_FLIGHT;
        const position = missileFlight(start, end, p, index ? -1 : 1);
        const tangent = missileFlight(start, end, Math.min(1, p + 0.002), index ? -1 : 1)
          .sub(missileFlight(start, end, Math.max(0, p - 0.002), index ? -1 : 1)).normalize();
        missile.group.position.copy(position); missile.group.quaternion.setFromUnitVectors(this.axis, tangent);
        missile.flame.scale.set(1, 0.8 + Math.sin(age * 73) * 0.15, 1);
      } else if (parked) {
        missile.group.position.copy(start); missile.group.rotation.set(-0.65, yaw + (side ? Math.PI : 0), 0, 'YXZ');
      }
      if (reducedMotion || launchTime < 0) continue;
      // The trail samples historical positions, so a late-arriving frame looks identical to
      // many small updates. Drift and widening persist after the missile reaches the ground.
      for (let i = 0; i < 28; i++) {
        const sample = i / 27 * MISSILE_FLIGHT;
        const life = age - sample;
        if (life < 0 || life > 2.8) continue;
        const p = missileFlight(start, end, sample / MISSILE_FLIGHT, index ? -1 : 1);
        this.particle(this.trails, p.x + life * 0.1, p.y + life * 0.07, p.z + life * 0.035,
          0.024 + life * 0.085, (1 - life / 2.8) * Math.min(1, life * 7));
      }
      if (age < 0.55) this.particle(this.impactFire, start.x, start.y, start.z, 0.09 * (1 - age / 0.55), 0.8);
      this.impact(end, age - MISSILE_FLIGHT, 1);
    }
    for (const side of [0, 1] as const) for (let index = 0; index < styles[side].drones; index++) {
      const direction = side === 0 ? -1 : 1;
      const lane = (index % 4 - 1.5) * 0.43;
      const home = point(direction * (gap / 2 + 0.55 + Math.floor(index / 4) * 0.4), lane, 1.15 + index % 3 * 0.16);
      const recorded = impacts.filter(hit => hit.side === side && hit.weapon === 'drone')[index];
      const target = recorded ? new THREE.Vector3(recorded.position.x, this.elevationAt(recorded.position.x, recorded.position.z) + 0.025, recorded.position.z)
        : point(-direction * (gap / 2 + 0.6 + Math.floor(index / 4) * 0.35), lane, 0.025);
      const localTime = recorded ? eventTime - recorded.impactAt + 7.6 : eventTime + 2 - index * 0.68 - side * 1.3;
      const age = reducedMotion ? 1.5 : localTime < 0 ? 0 : recorded ? localTime : modulo(localTime, DRONE_PERIOD);
      const observer = index >= 6;
      if (age < 7.6 || observer) {
        // Larger swarms retain an orbiting observation pair while attack drones make their
        // one-way dives. The sky stays inhabited between waves without respawning at impact.
        const orbitTime = reducedMotion ? 0 : eventTime;
        const frame = observer ? droneFlight(home, target, 0, index + orbitTime * 0.55) : droneFlight(home, target, age, index);
        const next = observer ? droneFlight(home, target, 0, index + (orbitTime + 0.01) * 0.55) : droneFlight(home, target, age + 0.01, index);
        const tangent = next.position.clone().sub(frame.position);
        const heading = tangent.lengthSq() > 0.000001 ? Math.atan2(tangent.x, tangent.z) : yaw + side * Math.PI;
        this.transform.position.copy(frame.position);
        this.transform.rotation.set(frame.stage === 'dive' ? mix(0.1, 0.62, clamp((age - 6) / 1.6, 0, 1))
          : frame.stage === 'approach' ? 0.16 : 0, heading, reducedMotion ? 0 : Math.sin(age * 1.4 + index) * 0.035, 'YXZ');
        this.transform.scale.setScalar(1); this.transform.updateMatrix();
        const slot = this.drones.count++;
        this.drones.setMatrixAt(slot, this.transform.matrix); this.sensors.setMatrixAt(this.sensors.count++, this.transform.matrix);
        const root = this.transform.matrix.clone();
        for (const x of [-0.095, 0.095]) for (const z of [-0.095, 0.095]) {
          this.transform.position.set(x, 0.028, z); this.transform.rotation.set(0, reducedMotion ? 0 : age * 90 + index, 0);
          this.transform.updateMatrix(); this.transform.matrix.premultiply(root);
          this.rotors.setMatrixAt(this.rotors.count++, this.transform.matrix);
        }
      }
      if (!reducedMotion && !observer) this.impact(target, age - 7.6, 0.38);
    }
    for (const pool of [this.trails, this.impactSmoke, this.impactDust, this.impactFire]) {
      pool.mesh.instanceMatrix.needsUpdate = true; pool.alpha.needsUpdate = true;
    }
    for (const mesh of [this.drones, this.sensors, this.rotors, this.debris]) mesh.instanceMatrix.needsUpdate = true;
  }

  private impact(p: Point, age: number, power: number): void {
    if (age < 0 || age > 4.5) return;
    if (age < 0.22) this.particle(this.impactFire, p.x, p.y + 0.08, p.z, (0.14 + age * 0.8) * power, 1 - age / 0.22);
    // Fire collapses quickly; dusty ground expansion and buoyant smoke carry the aftermath.
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.399;
      const life = Math.max(0, age - i * 0.055);
      const spread = Math.sqrt(life) * (0.32 + i * 0.07) * power;
      this.particle(this.impactDust, p.x + Math.cos(angle) * spread, p.y + 0.06 + life * 0.045,
        p.z + Math.sin(angle) * spread, (0.08 + life * 0.18) * power, Math.max(0, 1 - life / 2.3));
      this.particle(this.impactSmoke, p.x + life * 0.11 + Math.cos(angle) * spread * 0.18,
        p.y + 0.07 + life * 0.31 * power, p.z + life * 0.05 + Math.sin(angle) * spread * 0.18,
        (0.075 + life * 0.15) * power, Math.min(1, life * 4) * (1 - life / 4.5));
      if (life < 0.7 && this.debris.count < 120) {
        const x = p.x + Math.cos(angle) * life * 0.9 * power;
        const z = p.z + Math.sin(angle) * life * 0.9 * power;
        this.transform.position.set(x, Math.max(this.elevationAt(x, z) + 0.008, p.y + Math.sin(life / 0.7 * Math.PI) * 0.24 * power), z);
        this.transform.rotation.set(life * 13 + i, i * 2, life * 9);
        this.transform.scale.setScalar(power * (1 - life / 0.7)); this.transform.updateMatrix();
        this.debris.setMatrixAt(this.debris.count++, this.transform.matrix);
      }
    }
  }

  private particles(name: string, color: string, opacity: number, capacity: number, glow = false): ParticlePool {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('effectOpacity', alpha);
    const material = battleAtmosphereMaterial(color, opacity, true); material.userData['baseOpacity'] = opacity;
    if (glow) { material.blending = THREE.AdditiveBlending; material.toneMapped = false; }
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    return { mesh, alpha };
  }

  private particle(pool: ParticlePool, x: number, y: number, z: number, size: number, opacity: number): void {
    if (opacity <= 0 || pool.mesh.count >= pool.alpha.count) return;
    this.transform.position.set(x, y, z); this.transform.rotation.set(0, 0, 0);
    this.transform.scale.setScalar(Math.max(0.001, size)); this.transform.updateMatrix();
    pool.mesh.setMatrixAt(pool.mesh.count, this.transform.matrix); pool.alpha.setX(pool.mesh.count++, opacity);
  }

  private makeMissile(side: 0 | 1, index: number): Missile {
    const group = new THREE.Group(), launcher = new THREE.Group();
    group.name = `missile-${side}-${index}`; launcher.name = `missile-launcher-${side}-${index}`;
    const casing = new THREE.MeshStandardMaterial({ color: '#c5c8bf', roughness: 0.46, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: '#333b38', roughness: 0.68, metalness: 0.25 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.029, 0.3, 12), casing); body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.105, 12), casing); nose.rotation.x = Math.PI / 2; nose.position.z = 0.2;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12), dark); collar.rotation.x = Math.PI / 2; collar.position.z = -0.14;
    group.add(body, nose, collar);
    for (let fin = 0; fin < 4; fin++) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.075), dark);
      const angle = fin * Math.PI / 2;
      vane.position.set(Math.cos(angle) * 0.033, Math.sin(angle) * 0.033, -0.1); vane.rotation.z = angle;
      group.add(vane);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.18, 12),
      new THREE.MeshBasicMaterial({ color: '#ffb76b', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    flame.rotation.x = -Math.PI / 2; flame.position.z = -0.23; group.add(flame);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.08, 0.36), dark); base.position.y = 0.05;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.42), casing); rail.rotation.x = -0.65; rail.position.y = 0.18;
    launcher.add(base, rail);
    for (const footX of [-0.14, 0.14]) {
      const outrigger = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.32), dark); outrigger.position.set(footX, 0.025, 0); launcher.add(outrigger);
    }
    group.traverse(object => { if (object instanceof THREE.Mesh && object !== flame) object.castShadow = true; });
    launcher.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    group.visible = launcher.visible = false;
    return { group, launcher, flame, side, index };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    this.group.clear();
  }
}
