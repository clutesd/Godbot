import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { lavaHalfWidth, lavaReach, volcanicWind, volcanoChannels } from '../../sim/environment/VolcanoFootprint';
import type { SimulationState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { lavaMaterial, updateLavaMaterial } from './LavaMaterial';

const SMOKE_BUDGET = 96;
const EMBER_BUDGET = 56;
const fract = (v: number) => v - Math.floor(v);

const smokeMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
  vertexShader: `attribute float instanceAlpha; varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
    #include <fog_pars_vertex>
    void main() { vUv = uv; vColor = instanceColor; vAlpha = instanceAlpha;
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
    #include <fog_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
        mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() { vec2 p = (vUv - 0.5) * 2.0;
      float billow = noise(p * 3.8) * 0.65 + noise(p * 8.0) * 0.35;
      float a = (1.0 - smoothstep(0.22, 0.96, length(p) + (billow - 0.5) * 0.25)) * vAlpha;
      if (a < 0.008) discard;
      gl_FragColor = vec4(vColor * (0.72 + billow * 0.5 + p.y * 0.12), a);
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

/** A three-vertex-wide ribbon draped on the ground, tapering toward the flow's toe. */
function ribbon(surface: TerrainSurface, path: THREE.Vector2[], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const flow: number[] = [];
  const indices: number[] = [];
  let distance = 0;
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    const ahead = path[Math.min(path.length - 1, i + 1)]!;
    const behind = path[Math.max(0, i - 1)]!;
    if (i > 0) distance += point.distanceTo(behind);
    const tangent = ahead.clone().sub(behind).normalize();
    const fraction = i / Math.max(1, path.length - 1);
    const half = lavaHalfWidth(width, fraction);
    for (let side = 0; side < 3; side += 1) {
      const offset = (side - 1) * half;
      const x = point.x - tangent.y * offset;
      const z = point.y + tangent.x * offset;
      positions.push(x, surface.heightAt(x, z) + 0.07, z);
      flow.push(side / 2, distance, fraction);
    }
    if (i > 0) {
      const a = (i - 1) * 3, b = i * 3;
      indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('flowUV', new THREE.Float32BufferAttribute(flow, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Winding depends on which way the flow turns first; make sure the lit face points up.
  if (geometry.getAttribute('normal').getY(1) < 0) {
    geometry.setIndex(indices.reverse());
    geometry.computeVertexNormals();
  }
  return geometry;
}

/**
 * Presentation for the volcano sculpted into the terrain at world generation (VolcanicCone):
 * a lava lake in the crater, flows that follow the real slopes downhill, a plume and, during
 * eruptions, ejected embers. Everything scales with VolcanoSystem's `activity`, so dormant
 * centuries read as a steaming crater with a faint glow and an eruption reads as a dark ash
 * column over molten flows. Failures here hide the volcano instead of the world.
 */
export class VolcanoRenderer {
  readonly group = new THREE.Group();
  private readonly lavaMat: THREE.MeshStandardMaterial;
  private readonly lakeMat: THREE.MeshStandardMaterial;
  private readonly lake: THREE.Mesh;
  private readonly spillY: number;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly smoke: THREE.InstancedMesh;
  private readonly embers: THREE.InstancedMesh;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly glow: THREE.PointLight;
  private readonly transform = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly steam = new THREE.Color('#c8cbca');
  private readonly ash = new THREE.Color('#635c58');
  private readonly ember = new THREE.Color('#d0602c');
  private readonly vent: THREE.Vector3;
  private readonly radius: number;
  private readonly phaseSeed: number;
  private activity: number;
  private plumeTime = 0;
  private readonly cameraRotation = new THREE.Quaternion();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly puffOrder = Array.from({ length: SMOKE_BUDGET }, (_, index) => ({ index, depth: 0, age: 0, x: 0, y: 0, z: 0 }));
  private failed = false;

  constructor(private readonly state: SimulationState, private readonly surface: TerrainSurface) {
    const volcano = state.volcano!;
    this.group.name = 'volcano';
    this.radius = volcano.craterRadius;
    this.phaseSeed = stableHash(`${state.seed}:${volcano.id}`) * 60;
    this.activity = volcano.activity;
    const floorY = surface.heightAt(volcano.worldX, volcano.worldZ);
    this.vent = new THREE.Vector3(volcano.worldX, floorY, volcano.worldZ);
    this.lavaMat = lavaMaterial();
    this.lakeMat = lavaMaterial(true);

    const pool = new THREE.CircleGeometry(this.radius * 0.34, 48).rotateX(-Math.PI / 2);
    const position = pool.getAttribute('position');
    const poolFlow = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      // Interpolate planar coordinates, not radius: a triangle fan cannot interpolate rho.
      poolFlow.set([position.getX(i) / (this.radius * 0.34), position.getZ(i) / (this.radius * 0.34), 0], i * 3);
    }
    pool.setAttribute('flowUV', new THREE.BufferAttribute(poolFlow, 3));
    const lake = new THREE.Mesh(pool, this.lakeMat);
    this.lake = lake;
    lake.position.set(volcano.worldX, floorY + 0.18, volcano.worldZ);
    this.meshes.push(lake);

    const channels = volcanoChannels(state.world, state.seed);
    this.spillY = channels.length ? Math.max(floorY + 0.18, Math.min(...channels.map(channel => {
      const start = channel.points[0]!;
      return surface.heightAt(start.x, start.z) - 0.08;
    }))) : floorY + 0.18;
    for (const channel of channels) {
      const path = channel.points.map(point => new THREE.Vector2(point.x, point.z));
      this.meshes.push(new THREE.Mesh(ribbon(surface, path, channel.width), this.lavaMat));
    }
    for (const mesh of this.meshes) mesh.renderOrder = 2;

    const smokeGeometry = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_BUDGET), 1).setUsage(THREE.DynamicDrawUsage);
    smokeGeometry.setAttribute('instanceAlpha', this.alpha);
    this.smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial(), SMOKE_BUDGET);
    // The shader reads instanceColor, which three only declares if the buffer exists at first compile.
    this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_BUDGET * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.renderOrder = 4;

    // Fog would wash incandescent rock out to tan; embers emit their own light.
    this.embers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(this.radius * 0.03),
      new THREE.MeshBasicMaterial({ color: '#ff7a1c', toneMapped: false, fog: false, transparent: true, depthWrite: false }), EMBER_BUDGET);
    // Transparent so it sorts after the plume; otherwise the ash draws over and darkens it.
    this.embers.renderOrder = 5;
    this.embers.count = 0;
    this.embers.frustumCulled = false;
    this.embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.glow = new THREE.PointLight('#ff6a28', 0, this.radius * 9, 2);
    this.glow.position.set(volcano.worldX, floorY + this.radius * 0.5, volcano.worldZ);

    this.group.add(...this.meshes, this.smoke, this.embers, this.glow);
  }

  update(deltaSeconds: number, elapsedSeconds: number, camera: THREE.Camera): void {
    if (this.failed) return;
    try {
      this.activity = THREE.MathUtils.damp(this.activity, this.state.volcano?.activity ?? 0.16, 2.5, Math.min(0.1, Math.max(0, deltaSeconds)));
      this.plumeTime += Math.min(0.1, Math.max(0, deltaSeconds)) * (0.03 + this.activity * 0.05);
      this.animate(elapsedSeconds, camera);
    } catch (error) {
      this.failed = true;
      this.group.visible = false;
      console.error('GODBOX volcano presentation failed and was hidden; the world continues.', error);
    }
  }

  private animate(elapsedSeconds: number, camera: THREE.Camera): void {
    const volcano = this.state.volcano;
    if (!volcano) return;
    const activity = this.activity;
    const erupting = volcano.phase === 'erupting';
    const r = this.radius;
    updateLavaMaterial(this.lavaMat, elapsedSeconds, activity);
    updateLavaMaterial(this.lakeMat, elapsedSeconds, activity);
    const fill = lavaReach(activity);
    this.lake.position.y = THREE.MathUtils.lerp(this.vent.y + 0.18, this.spillY, fill);
    this.lake.scale.setScalar(1 + fill ** 0.7 * 1.7);

    const wind = volcanicWind(this.state.world, volcano.worldX, volcano.worldZ);
    const wx = wind.x * wind.strength;
    const wz = wind.z * wind.strength;

    const t = this.transform;
    // Fixed emission lanes prevent every puff jumping when activity changes the budget.
    const puffs = SMOKE_BUDGET;
    camera.getWorldQuaternion(this.cameraRotation);
    camera.getWorldDirection(this.cameraDirection);
    for (const puff of this.puffOrder) {
      const j = puff.index;
      const age = fract(this.plumeTime + j / puffs + this.phaseSeed);
      const rise = age * r * (2.4 + activity * 6.5);
      const twist = elapsedSeconds * 0.3 + j * 2.399 + this.phaseSeed;
      const umbrella = Math.max(0, (age - 0.55) / 0.45) ** 2 * activity;
      const spread = r * (0.12 + age * 0.4 + umbrella * 2.2);
      puff.age = age;
      puff.x = this.vent.x + wx * rise * (0.3 + age * 0.55) + Math.cos(twist) * spread;
      puff.y = this.lake.position.y + r * 0.3 + rise;
      puff.z = this.vent.z + wz * rise * (0.3 + age * 0.55) + Math.sin(twist * 1.2) * spread;
      puff.depth = puff.x * this.cameraDirection.x + puff.y * this.cameraDirection.y + puff.z * this.cameraDirection.z;
    }
    // Instanced transparent meshes do not sort their instances for us.
    this.puffOrder.sort((a, b) => b.depth - a.depth);
    let smokeCount = 0;
    for (const puff of this.puffOrder) {
      const j = puff.index, age = puff.age;
      t.position.set(puff.x, puff.y, puff.z);
      t.quaternion.copy(this.cameraRotation);
      t.rotateZ(Math.sin(j * 7 + this.phaseSeed) * 2 + age);
      const size = r * (0.55 + activity * 0.7) * (0.7 + age * 3) * (0.85 + fract(j * 0.718 + this.phaseSeed) * 0.3);
      t.scale.set(size, size * 1.12, 1);
      t.updateMatrix();
      this.smoke.setMatrixAt(smokeCount, t.matrix);
      this.color.copy(this.steam).lerp(this.ash, Math.min(1, activity * 1.15));
      if (age < 0.08) this.color.lerp(this.ember, (1 - age / 0.08) * activity * 0.5);
      this.smoke.setColorAt(smokeCount, this.color);
      this.alpha.setX(smokeCount++, Math.min(1, Math.min(1, age * 9) * (1 - age) ** 1.2 * (0.05 + activity * 0.45)));
    }
    this.smoke.count = smokeCount;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.smoke.instanceColor!.needsUpdate = true;
    this.alpha.needsUpdate = true;

    let emberCount = 0;
    if (erupting) {
      const target = Math.round(activity * EMBER_BUDGET);
      for (let j = 0; j < target; j += 1) {
        const age = fract(elapsedSeconds * (0.45 + j * 0.009) + j * 0.618 + this.phaseSeed);
        const angle = j * 2.399 + this.phaseSeed;
        const throwOut = r * (0.3 + fract(j * 0.37) * 1.6) * age;
        t.position.set(this.vent.x + Math.cos(angle) * throwOut + wx * age * r * 0.4,
          this.lake.position.y + Math.sin(age * Math.PI) * r * (1.6 + fract(j * 0.53) * 2.2),
          this.vent.z + Math.sin(angle) * throwOut + wz * age * r * 0.4);
        if (t.position.y <= this.surface.heightAt(t.position.x, t.position.z) + 0.08) continue;
        t.rotation.set(age * 5, j, age * 3);
        t.scale.setScalar((1 - age * 0.7) * (0.5 + activity * 0.5));
        t.updateMatrix();
        this.embers.setMatrixAt(emberCount++, t.matrix);
      }
    }
    this.embers.count = emberCount;
    this.embers.instanceMatrix.needsUpdate = true;

    const flicker = 0.88 + Math.sin(elapsedSeconds * 4.1 + this.phaseSeed) * 0.08 + Math.sin(elapsedSeconds * 9.7) * 0.04;
    this.glow.position.y = this.lake.position.y + r * 0.3;
    this.glow.intensity = activity * (erupting ? 200 : 90) * flicker;
  }

  dispose(): void {
    this.lavaMat.dispose();
    this.lakeMat.dispose();
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.smoke.dispose(); this.smoke.geometry.dispose(); (this.smoke.material as THREE.Material).dispose();
    this.embers.dispose(); this.embers.geometry.dispose(); (this.embers.material as THREE.Material).dispose();
    this.group.clear();
  }
}
