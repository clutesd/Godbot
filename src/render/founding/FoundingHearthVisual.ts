import * as THREE from 'three';
import type { MaterialPalette } from '../materials/MaterialPalette';
import type { Vec2 } from '../../sim/types';
import {
  FOUNDING_HEARTH_LOG_COUNT,
  FOUNDING_HEARTH_STONE_COUNT,
  foundingHearthPiecePose
} from './FoundingHearthAssembly';

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
export function createFoundingHearthInfrastructure(palette: MaterialPalette, seed: string, pickupLocal: Readonly<Vec2> = { x: 0.78, z: 0 }): THREE.Group {
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
  scorch.userData['hearthScorch'] = true;
  group.add(scorch);

  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.39, 22), shadow);
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.012;
  ash.scale.set(1.08, 0.96, 1);
  ash.receiveShadow = true;
  ash.userData['hearthAsh'] = true;
  group.add(ash);

  for (let index = 0; index < FOUNDING_HEARTH_STONE_COUNT; index += 1) {
    const pose = foundingHearthPiecePose(seed, 'stone', index);
    const size = 0.075 + stableUnit(`${seed}:stone-size:${index}`) * 0.055;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), stone);
    rock.position.set(pose.x, 0.042 + size * 0.18, pose.z);
    rock.rotation.set(
      stableUnit(`${seed}:stone-rx:${index}`) * 0.32,
      stableUnit(`${seed}:stone-ry:${index}`) * Math.PI,
      stableUnit(`${seed}:stone-rz:${index}`) * 0.32,
    );
    rock.scale.y = 0.72 + stableUnit(`${seed}:stone-flat:${index}`) * 0.45;
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData['hearthStone'] = true;
    rock.userData['hearthPieceIndex'] = index;
    group.add(rock);
  }

  // Material cache: the first hearth is assembled from visible matter, not spawned geometry.
  // Pieces disappear from this pile only when a builder's pickup beat completes.
  for (let index = 0; index < FOUNDING_HEARTH_STONE_COUNT; index += 1) {
    const size = 0.065 + stableUnit(`${seed}:staged-stone-size:${index}`) * 0.04;
    const angle = stableUnit(`${seed}:staged-stone-angle:${index}`) * Math.PI * 2;
    const radius = 0.08 + stableUnit(`${seed}:staged-stone-radius:${index}`) * 0.26;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), stone);
    rock.position.set(
      pickupLocal.x + Math.cos(angle) * radius,
      0.035 + size * 0.18,
      pickupLocal.z + Math.sin(angle) * radius,
    );
    rock.scale.y = 0.68 + stableUnit(`${seed}:staged-stone-flat:${index}`) * 0.36;
    rock.rotation.y = angle;
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData['hearthStagedStone'] = true;
    rock.userData['hearthPieceIndex'] = index;
    group.add(rock);
  }

  for (let index = 0; index < FOUNDING_HEARTH_LOG_COUNT; index += 1) {
    const yaw = (index - 1) * 0.16 + stableUnit(`${seed}:staged-log-yaw:${index}`) * 0.08;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.06, 0.7, 7), timber);
    log.position.set(pickupLocal.x + (index - 1) * 0.09, 0.055 + index * 0.018, pickupLocal.z + index * 0.035);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = yaw;
    log.castShadow = true;
    log.receiveShadow = true;
    log.userData['hearthStagedLog'] = true;
    log.userData['hearthPieceIndex'] = index;
    group.add(log);
  }

  const logGeometry = new THREE.CylinderGeometry(0.048, 0.067, 0.76, 7);
  for (let index = 0; index < FOUNDING_HEARTH_LOG_COUNT; index += 1) {
    const pose = foundingHearthPiecePose(seed, 'log', index);
    const log = new THREE.Mesh(logGeometry, timber);
    log.position.set(pose.x, 0.09 + index * 0.012, pose.z);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = pose.yaw;
    log.rotation.x = (stableUnit(`${seed}:log-roll:${index}`) - 0.5) * 0.12;
    log.castShadow = true;
    log.receiveShadow = true;
    log.userData['hearthLog'] = true;
    log.userData['hearthPieceIndex'] = index;
    group.add(log);
  }

  const tinder = new THREE.Group();
  tinder.name = 'founding-hearth-tinder';
  tinder.userData['hearthTinder'] = true;
  for (let index = 0; index < 6; index += 1) {
    const twig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.017, 0.28 + stableUnit(`${seed}:tinder-length:${index}`) * 0.12, 5),
      timber,
    );
    twig.rotation.z = Math.PI / 2;
    twig.rotation.y = (index / 6) * Math.PI + (stableUnit(`${seed}:tinder-yaw:${index}`) - 0.5) * 0.3;
    twig.position.set(
      (stableUnit(`${seed}:tinder-x:${index}`) - 0.5) * 0.14,
      0.055 + (index % 2) * 0.012,
      (stableUnit(`${seed}:tinder-z:${index}`) - 0.5) * 0.14,
    );
    twig.castShadow = true;
    tinder.add(twig);
  }
  const tinderGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 6),
    new THREE.MeshBasicMaterial({ color: '#ff7d32', toneMapped: false, transparent: true, opacity: 0.88 }),
  );
  tinderGlow.scale.set(1.15, 0.22, 1.15);
  tinderGlow.position.y = 0.045;
  tinderGlow.userData['hearthTinderGlow'] = true;
  tinder.add(tinderGlow);
  group.add(tinder);

  for (let index = 0; index < 7; index += 1) {
    const angle = stableUnit(`${seed}:coal-angle:${index}`) * Math.PI * 2;
    const radius = 0.08 + stableUnit(`${seed}:coal-radius:${index}`) * 0.18;
    const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035 + stableUnit(`${seed}:coal-size:${index}`) * 0.035, 0), char);
    coal.position.set(Math.cos(angle) * radius, 0.055, Math.sin(angle) * radius);
    coal.scale.y = 0.55 + stableUnit(`${seed}:coal-flat:${index}`) * 0.4;
    coal.rotation.y = angle;
    coal.userData['hearthCoal'] = true;
    group.add(coal);
  }

  return group;
}

export function updateFoundingHearthAssembly(
  group: THREE.Group,
  sample: {
    readonly stonesPicked: number;
    readonly logsPicked: number;
    readonly stonesPlaced: number;
    readonly logsPlaced: number;
    readonly assemblyComplete: boolean;
  },
): void {
  // The material pile exists from the first assembly beat; the hearth itself appears only through
  // completed hand placements. No scale-up shortcut is used anywhere in this sequence.
  group.visible = true;
  group.scale.setScalar(1);
  group.traverse((object) => {
    const pieceIndex = Number(object.userData['hearthPieceIndex'] ?? -1);
    if (object.userData['hearthStagedStone']) {
      object.visible = pieceIndex >= sample.stonesPicked;
      return;
    }
    if (object.userData['hearthStagedLog']) {
      object.visible = pieceIndex >= sample.logsPicked;
      return;
    }
    if (object.userData['hearthStone']) {
      object.visible = pieceIndex >= 0 && pieceIndex < sample.stonesPlaced;
      return;
    }
    if (object.userData['hearthLog']) {
      object.visible = pieceIndex >= 0 && pieceIndex < sample.logsPlaced;
      return;
    }
    if (object.userData['hearthScorch'] || object.userData['hearthAsh'] || object.userData['hearthCoal']
      || object.userData['hearthTinder'] || object.userData['hearthTinderGlow']) {
      object.visible = false;
    }
  });
}

export function updateFoundingHearthIgnition(
  group: THREE.Group,
  sample: {
    readonly phase: string;
    readonly phaseProgress: number;
    readonly assemblyComplete: boolean;
    readonly tinderGlow: number;
  },
): void {
  const openFlame = ['falter', 'catch', 'gather', 'settle', 'complete'].includes(sample.phase);
  const establishedBurn = ['catch', 'gather', 'settle', 'complete'].includes(sample.phase);
  group.traverse((object) => {
    if (object.userData['hearthTinder']) {
      object.visible = sample.assemblyComplete && !['gather', 'settle', 'complete'].includes(sample.phase);
      return;
    }
    if (object.userData['hearthTinderGlow']) {
      object.visible = sample.assemblyComplete && sample.tinderGlow > 0.01
        && !['gather', 'settle', 'complete'].includes(sample.phase);
      const scale = Math.max(0.001, sample.tinderGlow);
      object.scale.set(1.15 * scale, 0.22 * scale, 1.15 * scale);
      return;
    }
    if (object.userData['hearthCoal']) {
      object.visible = openFlame;
      return;
    }
    if (object.userData['hearthScorch']) {
      object.visible = openFlame;
      const scale = sample.phase === 'falter' ? 0.28 + sample.phaseProgress * 0.18
        : sample.phase === 'catch' ? 0.46 + sample.phaseProgress * 0.54 : 1;
      object.scale.set(scale, scale * 1.08, 1);
      return;
    }
    if (object.userData['hearthAsh']) {
      object.visible = establishedBurn;
      const scale = sample.phase === 'catch' ? 0.3 + sample.phaseProgress * 0.7 : 1;
      object.scale.set(1.08 * scale, 0.96 * scale, 1);
    }
  });
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
    new THREE.MeshBasicMaterial({ color: '#ed4312', toneMapped: false, transparent: true, opacity: 0.62, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: '#ff922c', toneMapped: false, transparent: true, opacity: 0.78, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: '#ffd76a', toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: '#fff4c2', toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }),
  ];
  const fireTime = { value: 0 };
  const fireMotion = { value: 1 };
  rig.userData['fireTime'] = fireTime;
  rig.userData['fireMotion'] = fireMotion;
  for (const material of materials) {
    material.onBeforeCompile = shader => {
      shader.uniforms['fireTime'] = fireTime;
      shader.uniforms['fireMotion'] = fireMotion;
      shader.vertexShader = 'uniform float fireTime; uniform float fireMotion; varying float flameHeight;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        flameHeight = uv.y;
        float tip = uv.y * uv.y;
        transformed.x += tip * (sin(uv.y * 9.0 - fireTime * 5.8 + position.z * 17.0) * 0.055
          + sin(fireTime * 2.3 + uv.y * 4.0) * 0.035) * fireMotion;
        transformed.z += tip * cos(uv.y * 7.0 - fireTime * 4.1 + position.x * 21.0) * 0.045 * fireMotion;
      `);
      shader.fragmentShader = 'varying float flameHeight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        diffuseColor.a *= (1.0 - smoothstep(0.6, 1.0, flameHeight)) * 0.8 + 0.2;
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => 'founding-flowing-flame-v1';
  }

  for (let index = 0; index < 6; index += 1) {
    const warm = index < 2 ? 0 : index < 4 ? 1 : index === 4 ? 2 : 3;
    const height = (0.42 + stableUnit(`${seed}:tongue-height:${index}`) * 0.32) * (index === 5 ? 0.65 : 1);
    const width = 0.075 + stableUnit(`${seed}:tongue-width:${index}`) * 0.065;
    // Rounded fuel-fed base, broad belly and a curling tapered tip, with enough rings to flow.
    const geometry = new THREE.LatheGeometry(Array.from({ length: 13 }, (_, ring) => {
      const t = ring / 12;
      const radius = width * (0.62 + Math.sin(t * Math.PI) * 0.65) * (1 - t) ** 0.8;
      return new THREE.Vector2(Math.max(0.001, radius), t * height);
    }), 10);
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
  for (let index = 0; index < 16; index += 1) {
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
  flameGain = 1,
  sparkGain = 1,
): void {
  const rigPhase = Number(rig.userData['phase'] ?? 0);
  if (rig.userData['fireTime']) rig.userData['fireTime'].value = reducedMotion ? 0 : elapsedSeconds;
  if (rig.userData['fireMotion']) rig.userData['fireMotion'].value = reducedMotion ? 0 : 1;
  for (const child of rig.children) {
    if (child.userData['hearthFlameTongue']) {
      const phase = Number(child.userData['phase'] ?? 0);
      const motion = Number(child.userData['motion'] ?? 1);
      const baseX = Number(child.userData['baseX'] ?? child.position.x);
      const baseY = Number(child.userData['baseY'] ?? child.position.y);
      const baseZ = Number(child.userData['baseZ'] ?? child.position.z);
      child.visible = flameGain > 0.005;
      if (reducedMotion) {
        child.position.set(baseX, baseY, baseZ);
        child.rotation.x = 0;
        child.rotation.z = 0;
        child.scale.setScalar(Math.max(0.001, flameGain));
        continue;
      }
      const fast = Math.sin(elapsedSeconds * (8.1 + motion) + phase + rigPhase);
      const slow = Math.sin(elapsedSeconds * (4.3 + motion * 0.7) + phase * 1.7);
      child.position.set(baseX + slow * 0.014, baseY + Math.max(0, fast) * 0.018, baseZ + fast * 0.01);
      child.rotation.x = slow * 0.07;
      child.rotation.z = fast * 0.1;
      child.scale.set(
        (0.94 + slow * 0.045) * flameGain,
        (0.93 + fast * 0.11 + slow * 0.055) * flameGain,
        (0.94 - slow * 0.035) * flameGain,
      );
      continue;
    }
    if (child.userData['hearthSpark']) {
      if (reducedMotion || sparkGain <= 0.01) {
        child.visible = false;
        continue;
      }
      child.visible = true;
      const phase = Number(child.userData['phase'] ?? 0);
      const speed = Number(child.userData['speed'] ?? 0.45);
      const drift = Number(child.userData['drift'] ?? 0);
      const age = fract(elapsedSeconds * speed + phase);
      const lateral = 0.025 + age * age * 0.3;
      child.position.set(
        Math.cos(drift + age * 1.9) * lateral,
        0.12 + age * (1.05 + speed * 0.5),
        Math.sin(drift + age * 1.6) * lateral,
      );
      const sparkle = Math.sin(age * Math.PI) * (1 - age * 0.55);
      child.scale.setScalar(Math.max(0.001, sparkle * sparkGain));
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
