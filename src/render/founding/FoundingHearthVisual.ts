import * as THREE from 'three';
import type { MaterialPalette } from '../materials/MaterialPalette';

const fract = (value: number): number => value - Math.floor(value);

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Physical founding-hearth dressing. This is presentation only: the caller still decides whether
 * the authoritative first-fire milestone exists and whether the hearth currently has fuel.
 */
export function createFoundingHearthInfrastructure(palette: MaterialPalette, seed: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'founding-hearth-infrastructure';

  const shadow = palette.getSurfaceMaterial('shadow');
  const stone = palette.getSurfaceMaterial('stone');
  const timber = palette.getSurfaceMaterial('timber');
  const char = new THREE.MeshStandardMaterial({ color: '#231a16', roughness: 1, metalness: 0 });
  const soot = new THREE.MeshStandardMaterial({ color: '#15110f', roughness: 1, metalness: 0 });

  const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.47, 24), soot);
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.006;
  scorch.scale.set(1, 1.08, 1);
  scorch.receiveShadow = true;
  group.add(scorch);

  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.39, 22), shadow);
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.012;
  ash.scale.set(1.08, 0.96, 1);
  ash.receiveShadow = true;
  group.add(ash);

  for (let index = 0; index < 11; index += 1) {
    const phase = stableUnit(`${seed}:stone:${index}`);
    const angle = (index / 11) * Math.PI * 2 + (phase - 0.5) * 0.11;
    const radius = 0.545 + (stableUnit(`${seed}:stone-radius:${index}`) - 0.5) * 0.055;
    const size = 0.075 + stableUnit(`${seed}:stone-size:${index}`) * 0.055;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), stone);
    rock.position.set(Math.cos(angle) * radius, 0.042 + size * 0.18, Math.sin(angle) * radius);
    rock.rotation.set(
      stableUnit(`${seed}:stone-rx:${index}`) * 0.32,
      stableUnit(`${seed}:stone-ry:${index}`) * Math.PI,
      stableUnit(`${seed}:stone-rz:${index}`) * 0.32,
    );
    rock.scale.y = 0.72 + stableUnit(`${seed}:stone-flat:${index}`) * 0.45;
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData['hearthStone'] = true;
    group.add(rock);
  }

  const logGeometry = new THREE.CylinderGeometry(0.048, 0.067, 0.76, 7);
  for (let index = 0; index < 3; index += 1) {
    const yaw = index * Math.PI / 3 + (stableUnit(`${seed}:log-yaw:${index}`) - 0.5) * 0.18;
    const log = new THREE.Mesh(logGeometry, index === 1 ? char : timber);
    log.position.set(
      Math.cos(yaw + Math.PI / 2) * 0.055,
      0.09 + index * 0.012,
      Math.sin(yaw + Math.PI / 2) * 0.055,
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = yaw;
    log.rotation.x = (stableUnit(`${seed}:log-roll:${index}`) - 0.5) * 0.12;
    log.castShadow = true;
    log.receiveShadow = true;
    log.userData['hearthLog'] = true;
    group.add(log);
  }

  for (let index = 0; index < 7; index += 1) {
    const angle = stableUnit(`${seed}:coal-angle:${index}`) * Math.PI * 2;
    const radius = 0.08 + stableUnit(`${seed}:coal-radius:${index}`) * 0.18;
    const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035 + stableUnit(`${seed}:coal-size:${index}`) * 0.035, 0), char);
    coal.position.set(Math.cos(angle) * radius, 0.055, Math.sin(angle) * radius);
    coal.scale.y = 0.55 + stableUnit(`${seed}:coal-flat:${index}`) * 0.4;
    coal.rotation.y = angle;
    group.add(coal);
  }

  return group;
}

/**
 * Layered flame tongues and transient sparks. The rig is deliberately small; smoke remains in the
 * renderer's shared smoke pool so a founding fire does not create a second particle system.
 */
export function createFoundingHearthFlameRig(seed: string): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'founding-hearth-flame-rig';
  rig.userData['phase'] = stableUnit(`${seed}:flame-phase`) * Math.PI * 2;

  const materials = [
    new THREE.MeshBasicMaterial({ color: '#e94d1c', toneMapped: false }),
    new THREE.MeshBasicMaterial({ color: '#ff8a25', toneMapped: false }),
    new THREE.MeshBasicMaterial({ color: '#ffc64f', toneMapped: false }),
    new THREE.MeshBasicMaterial({ color: '#fff0ad', toneMapped: false }),
  ];

  for (let index = 0; index < 6; index += 1) {
    const warm = index < 2 ? 0 : index < 4 ? 1 : index === 4 ? 2 : 3;
    const height = 0.25 + stableUnit(`${seed}:tongue-height:${index}`) * 0.24;
    const width = 0.075 + stableUnit(`${seed}:tongue-width:${index}`) * 0.065;
    const geometry = new THREE.ConeGeometry(width, height, 7, 2);
    geometry.translate(0, height / 2, 0);
    const tongue = new THREE.Mesh(geometry, materials[warm]!);
    const angle = index * 2.399 + stableUnit(`${seed}:tongue-angle:${index}`) * 0.5;
    const radius = index === 5 ? 0.015 : 0.025 + stableUnit(`${seed}:tongue-radius:${index}`) * 0.11;
    tongue.position.set(Math.cos(angle) * radius, 0.09, Math.sin(angle) * radius);
    tongue.rotation.y = angle;
    tongue.userData['hearthFlameTongue'] = true;
    tongue.userData['baseX'] = tongue.position.x;
    tongue.userData['baseZ'] = tongue.position.z;
    tongue.userData['baseY'] = tongue.position.y;
    tongue.userData['phase'] = stableUnit(`${seed}:tongue-phase:${index}`) * Math.PI * 2;
    tongue.userData['motion'] = 0.75 + stableUnit(`${seed}:tongue-motion:${index}`) * 0.55;
    rig.add(tongue);
  }

  const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#ffd36b', toneMapped: false });
  for (let index = 0; index < 7; index += 1) {
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.012 + stableUnit(`${seed}:spark-size:${index}`) * 0.009, 0), sparkMaterial);
    spark.userData['hearthSpark'] = true;
    spark.userData['phase'] = stableUnit(`${seed}:spark-phase:${index}`);
    spark.userData['speed'] = 0.36 + stableUnit(`${seed}:spark-speed:${index}`) * 0.25;
    spark.userData['drift'] = stableUnit(`${seed}:spark-drift:${index}`) * Math.PI * 2;
    rig.add(spark);
  }

  return rig;
}

export function createFoundingHearthEmbers(seed: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'founding-hearth-embers';
  const glow = new THREE.MeshBasicMaterial({ color: '#ff9a32', toneMapped: false });
  const hot = new THREE.MeshBasicMaterial({ color: '#ffd76a', toneMapped: false });

  for (let index = 0; index < 9; index += 1) {
    const angle = stableUnit(`${seed}:ember-angle:${index}`) * Math.PI * 2;
    const radius = 0.035 + stableUnit(`${seed}:ember-radius:${index}`) * 0.19;
    const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018 + stableUnit(`${seed}:ember-size:${index}`) * 0.018, 0), index % 4 === 0 ? hot : glow);
    ember.position.set(Math.cos(angle) * radius, 0.014 + stableUnit(`${seed}:ember-y:${index}`) * 0.025, Math.sin(angle) * radius);
    ember.userData['hearthEmber'] = true;
    ember.userData['baseScale'] = 0.7 + stableUnit(`${seed}:ember-scale:${index}`) * 0.55;
    ember.userData['phase'] = stableUnit(`${seed}:ember-phase:${index}`) * Math.PI * 2;
    group.add(ember);
  }
  return group;
}

export function updateFoundingHearthFireMotion(
  rig: THREE.Group,
  embers: THREE.Group | undefined,
  elapsedSeconds: number,
  reducedMotion: boolean,
): void {
  const rigPhase = Number(rig.userData['phase'] ?? 0);
  for (const child of rig.children) {
    if (child.userData['hearthFlameTongue']) {
      const phase = Number(child.userData['phase'] ?? 0);
      const motion = Number(child.userData['motion'] ?? 1);
      const baseX = Number(child.userData['baseX'] ?? child.position.x);
      const baseY = Number(child.userData['baseY'] ?? child.position.y);
      const baseZ = Number(child.userData['baseZ'] ?? child.position.z);
      if (reducedMotion) {
        child.position.set(baseX, baseY, baseZ);
        child.rotation.x = 0;
        child.rotation.z = 0;
        child.scale.set(1, 1, 1);
        continue;
      }
      const fast = Math.sin(elapsedSeconds * (8.1 + motion) + phase + rigPhase);
      const slow = Math.sin(elapsedSeconds * (4.3 + motion * 0.7) + phase * 1.7);
      child.position.set(baseX + slow * 0.014, baseY + Math.max(0, fast) * 0.018, baseZ + fast * 0.01);
      child.rotation.x = slow * 0.07;
      child.rotation.z = fast * 0.1;
      child.scale.set(0.94 + slow * 0.045, 0.93 + fast * 0.11 + slow * 0.055, 0.94 - slow * 0.035);
      continue;
    }
    if (child.userData['hearthSpark']) {
      if (reducedMotion) {
        child.visible = false;
        continue;
      }
      child.visible = true;
      const phase = Number(child.userData['phase'] ?? 0);
      const speed = Number(child.userData['speed'] ?? 0.45);
      const drift = Number(child.userData['drift'] ?? 0);
      const age = fract(elapsedSeconds * speed + phase);
      const lateral = 0.025 + age * 0.11;
      child.position.set(
        Math.cos(drift + age * 1.9) * lateral,
        0.16 + age * 0.78,
        Math.sin(drift + age * 1.6) * lateral,
      );
      const sparkle = Math.sin(age * Math.PI) * (1 - age * 0.55);
      child.scale.setScalar(Math.max(0.001, sparkle));
      child.rotation.y = elapsedSeconds * 4 + drift;
    }
  }

  if (!embers) return;
  for (const child of embers.children) {
    if (!child.userData['hearthEmber']) continue;
    const base = Number(child.userData['baseScale'] ?? 1);
    const phase = Number(child.userData['phase'] ?? 0);
    const pulse = reducedMotion ? 1 : 0.86 + Math.sin(elapsedSeconds * 3.8 + phase) * 0.11 + Math.sin(elapsedSeconds * 7.1 + phase * 1.3) * 0.04;
    child.scale.setScalar(base * pulse);
  }
}
