import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../sim/prng';
import { smoothstep } from '../../sim/terrain/noise';
import { cellAt } from '../../sim/world';
import type { WorldState } from '../../sim/types';
import { BIOME_LIFE, ECOLOGY_GLSL, ecologyUniforms, type EcologyField, type EcologyQuality } from '../ecology/EcologyField';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { resolveTreeLifecycle, type TreePlacement } from './ForestPlanner';
import { insideVegetationTerrain } from './VegetationPlacement';

type Kind = 'fungus' | 'flower' | 'lichen';
interface Colony { x: number; z: number; rotation: number; scale: number; colour: THREE.Color; kind: Kind; tree: TreePlacement }
interface Clearing { x: number; z: number; radius: number }

/** Three shared instanced shapes and one GPU particle cloud, attached to the real forest pool.
 * Membership changes only at vegetation LOD cadence; no per-particle CPU animation. */
export class BioluminescentFlora {
  readonly group = new THREE.Group();
  private readonly colonies: Colony[] = [];
  private readonly meshes: Record<Kind, THREE.InstancedMesh>;
  private readonly particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly floraBudget: number;
  private readonly moteBudget: number;

  constructor(world: WorldState, private readonly surface: TerrainSurface, seed: string,
    trees: readonly TreePlacement[], private readonly ecology: EcologyField, quality: EcologyQuality) {
    this.group.name = 'bioluminescent-forest-ecology';
    this.floraBudget = Math.min(3600, Math.max(0, Math.round(1800 * quality.bioluminescenceDensity)));
    this.moteBudget = Math.min(2800, Math.max(0, Math.round(1400 * quality.particleDensity)));
    const budget = Math.max(this.floraBudget, this.moteBudget);
    const random = new SeededRandom(`${seed}:symbiotic-flora`);
    // Hash-independent, bounded shuffle so a low budget samples the whole world, not one corner.
    const anchors = [...trees];
    for (let i = anchors.length - 1; i > 0; i--) {
      const j = random.int(0, i + 1);
      [anchors[i], anchors[j]] = [anchors[j]!, anchors[i]!];
    }
    for (let pass = 0; pass < 3 && this.colonies.length < budget; pass++) {
      for (const tree of anchors) {
        if (this.colonies.length >= budget) break;
        const cell = cellAt(world, tree.worldX, tree.worldZ);
        if (!cell || !random.chance(BIOME_LIFE[cell.biome].flora * (0.6 + tree.regrowth * 0.6))) continue;
        const kind: Kind = random.chance(0.12) ? 'lichen' : random.chance(cell.moisture > 0.55 ? 0.75 : 0.38) ? 'fungus' : 'flower';
        const members = kind === 'lichen' ? 1 : random.int(2, 5);
        const angle = random.range(0, Math.PI * 2);
        const radius = kind === 'lichen' ? 0.08 : random.range(0.6, 2.3);
        const cx = tree.worldX + Math.cos(angle) * radius;
        const cz = tree.worldZ + Math.sin(angle) * radius;
        const colour = new THREE.Color(random.chance(0.18) ? '#b48bed' : BIOME_LIFE[cell.biome].colour);
        for (let member = 0; member < members && this.colonies.length < budget; member++) {
          const x = cx + (kind === 'lichen' ? 0 : random.range(-0.4, 0.4));
          const z = cz + (kind === 'lichen' ? 0 : random.range(-0.4, 0.4));
          if (!insideVegetationTerrain(world, x, z, 0.15) || surface.sample(x, z).slope > 0.6) continue;
          this.colonies.push({ x, z, tree, kind, colour, rotation: random.range(0, Math.PI * 2), scale: random.range(0.65, 1.5) });
        }
      }
    }
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.83, vertexColors: true });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, ecologyUniforms(ecology));
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${ECOLOGY_GLSL}\nvarying float vBioGlow;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 colonyPosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          vec4 habitat = habitatAt(colonyPosition.xz);
          vBioGlow = ecologyNight * habitat.r * (1.0 + habitat.b * 2.2);
          transformed.x += sin(ecologyTime * 0.55 + colonyPosition.x) * position.y * 0.028;
        `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBioGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vBioGlow * 6.5;');
    };
    material.customProgramCacheKey = () => 'godbox-living-colonies-v1';
    const makeMesh = (kind: Kind) => {
      const mesh = new THREE.InstancedMesh(colonyGeometry(kind), material, Math.max(1, this.floraBudget));
      mesh.name = `luminous-${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, this.floraBudget) * 3), 3);
      return mesh;
    };
    this.meshes = { fungus: makeMesh('fungus'), flower: makeMesh('flower'), lichen: makeMesh('lichen') };
    this.particles = createLivingMotes(ecology, this.moteBudget);
    this.group.add(...Object.values(this.meshes), this.particles);
  }

  get report() {
    const meshes = Object.values(this.meshes);
    return { planned: this.colonies.length, flora: meshes.reduce((n, m) => n + m.count, 0),
      motes: this.particles.geometry.drawRange.count,
      triangles: meshes.reduce((n, m) => n + m.count * (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, 0),
      drawCalls: meshes.filter(m => m.count > 0).length + (this.particles.geometry.drawRange.count > 0 ? 1 : 0) };
  }

  updateLod(camera: THREE.Vector3, month: number, clearings: readonly Clearing[]): void {
    for (const mesh of Object.values(this.meshes)) mesh.count = 0;
    const positions = this.particles.geometry.getAttribute('position');
    const colours = this.particles.geometry.getAttribute('color');
    let flora = 0;
    let motes = 0;
    for (const colony of this.colonies) {
      const distance = Math.hypot(colony.x - camera.x, colony.z - camera.z);
      const fade = 1 - smoothstep(55, 100, distance);
      if (fade <= 0 || this.ecology.vitalityAt(colony.x, colony.z) < 0.012) continue;
      if (clearings.some(zone => Math.hypot(colony.x - zone.x, colony.z - zone.z) < zone.radius)) continue;
      const lifecycle = resolveTreeLifecycle(colony.tree, month / 12);
      if (!lifecycle.foliageVisible || lifecycle.fallen) continue;
      const ground = this.surface.heightAt(colony.x, colony.z);
      if (this.surface.waterYAt(colony.x, colony.z) > ground - 0.035) continue;
      if (flora < this.floraBudget) {
        const mesh = this.meshes[colony.kind];
        const growth = colony.kind === 'lichen' ? lifecycle.scale : 0.7 + Math.min(1, lifecycle.scale) * 0.3;
        this.position.set(colony.x, ground + 0.014 + (colony.kind === 'lichen' ? lifecycle.scale * 0.24 : 0), colony.z);
        this.rotation.setFromAxisAngle(this.axis, colony.rotation);
        this.scale.setScalar(colony.scale * growth * fade);
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(mesh.count, this.matrix);
        mesh.setColorAt(mesh.count++, colony.colour);
        flora++;
      }
      if (motes < this.moteBudget) {
        positions.setXYZ(motes, colony.x, ground + 0.4 + colony.scale * 0.4, colony.z);
        colours.setXYZ(motes, colony.colour.r, colony.colour.g, colony.colour.b);
        motes++;
      }
    }
    for (const mesh of Object.values(this.meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    positions.needsUpdate = colours.needsUpdate = true;
    this.particles.geometry.setDrawRange(0, motes);
  }

  setViewport(height: number, pixelRatio: number): void {
    this.particles.material.uniforms['pointScale']!.value = height * pixelRatio * 0.5;
  }
}

function colonyGeometry(kind: Kind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'fungus') {
    // Thin stems, domed caps and a faint gill skirt, readable even without emission.
    parts.push(new THREE.CylinderGeometry(0.012, 0.023, 0.22, 5).translate(0, 0.11, 0));
    parts.push(new THREE.SphereGeometry(0.12, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(1, 0.48, 1).translate(0, 0.23, 0));
  } else if (kind === 'flower') {
    parts.push(new THREE.CylinderGeometry(0.009, 0.02, 0.32, 4).translate(0, 0.16, 0));
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      parts.push(new THREE.SphereGeometry(0.055, 5, 3).scale(0.7, 1.4, 0.7).translate(Math.cos(a) * 0.08, 0.29 + i * 0.035, Math.sin(a) * 0.08));
    }
  } else {
    for (let i = 0; i < 4; i++) parts.push(new THREE.IcosahedronGeometry(0.035, 0)
      .scale(0.65, 1.6, 1).translate(Math.sin(i * 2.4) * 0.07, i * 0.09, Math.cos(i * 2.4) * 0.07));
  }
  parts.forEach((part, i) => {
    const shade = i === 0 && kind !== 'lichen' ? 0.13 : 1;
    const colours = new Float32Array(part.getAttribute('position').count * 3).fill(shade);
    part.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  });
  const result = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return result;
}

function createLivingMotes(field: EcologyField, capacity: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib['fog']!), ...ecologyUniforms(field), pointScale: { value: 450 } },
    transparent: true, depthWrite: false, vertexColors: true, fog: true,
    blending: THREE.AdditiveBlending,
    vertexShader: `${ECOLOGY_GLSL}
      uniform float pointScale;
      varying vec3 moteColour;
      varying float moteAlpha;
      #include <fog_pars_vertex>
      void main() {
        vec4 habitat = habitatAt(position.xz);
        float phase = dot(position.xz, vec2(12.71, 8.39));
        float t = ecologyTime * 0.27;
        vec3 drift = vec3(sin(t + phase) * 0.75, (sin(t * 0.71 + phase * 1.7) + 1.0) * 0.6, cos(t * 0.83 + phase) * 0.65);
        drift.xz += ecologyWind * sin(t * 0.43 + phase) * 1.3;
        vec4 mvPosition = modelViewMatrix * vec4(position + drift, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float fade = 1.0 - smoothstep(45.0, 90.0, length(mvPosition.xyz));
        float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 2.2 + phase), 2.0);
        // Pale spring pollen by day; sporadic luminous life emerges at dusk.
        moteColour = mix(vec3(0.7, 0.65, 0.43), mix(color, vec3(1.0, 0.63, 0.14), step(0.82, fract(phase))) * 4.5, ecologyNight);
        moteAlpha = habitat.a * fade * mix(0.08, pulse, ecologyNight) * (1.0 + habitat.b * 0.6);
        gl_PointSize = clamp(pointScale * 0.10 / max(1.0, -mvPosition.z), 1.0, 8.0);
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 moteColour; varying float moteAlpha;
      #include <fog_pars_fragment>
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        float core = exp(-radius * radius * 28.0);
        gl_FragColor = vec4(moteColour, core * moteAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'fireflies-spores-and-pollen';
  points.frustumCulled = false;
  return points;
}
