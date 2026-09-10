import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { cellAt } from '../../sim/world';
import type { SimulationState, StructurePlot } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

export const FIRE_BUDGET = { fires: 12, tongues: 12 * 10 * 2, smoke: 12 * 36, embers: 12 * 8, lights: 3, scars: 192 } as const;
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
    void main() { vec2 p = (vUv - 0.5) * 2.0;
      float angle = atan(p.y, p.x); float edge = 0.83 + sin(angle * 5.0) * 0.055 + cos(angle * 7.0) * 0.035;
      float a = (1.0 - smoothstep(edge * 0.3, edge, length(p))) * vAlpha;
      if (a < 0.008) discard;
      gl_FragColor = vec4(vColor, a);
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

/** Fixed pools for all fires; smoke is retained at distances where small flames are culled. */
export class StructureFireRenderer {
  readonly group = new THREE.Group();
  private readonly flames: THREE.InstancedMesh;
  private readonly smoke: THREE.InstancedMesh;
  private readonly embers: THREE.InstancedMesh;
  private readonly scars: THREE.InstancedMesh;
  private readonly lights = Array.from({ length: FIRE_BUDGET.lights }, () => new THREE.PointLight('#ff9b36', 0, 14, 2));
  private readonly transform = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly dark = new THREE.Color('#343237');
  private readonly pale = new THREE.Color('#a4aaa9');
  private readonly alpha: THREE.InstancedBufferAttribute;
  private sites: StructurePlot[] = [];
  private scarSites: StructurePlot[] = [];
  private accumulator = 1;
  private count = 0;
  constructor(private readonly state: SimulationState, private readonly surface: TerrainSurface) {
    this.group.name = 'structure-fires';
    const tongue = new THREE.CylinderGeometry(0.015, 0.3, 1, 5, 3).translate(0, 0.5, 0);
    const p = tongue.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + p.getY(i) ** 2 * 0.18);
    tongue.computeVertexNormals();
    this.flames = new THREE.InstancedMesh(tongue, new THREE.MeshBasicMaterial({ toneMapped: false }), FIRE_BUDGET.tongues);
    const smokeGeometry = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_BUDGET.smoke), 1).setUsage(THREE.DynamicDrawUsage);
    smokeGeometry.setAttribute('instanceAlpha', this.alpha);
    this.smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial(), FIRE_BUDGET.smoke);
    this.embers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.025), new THREE.MeshBasicMaterial({ color: '#ffb641', toneMapped: false }), FIRE_BUDGET.embers);
    this.scars = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 11).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#211d1b', transparent: true, opacity: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), FIRE_BUDGET.scars);
    for (const mesh of [this.flames, this.smoke, this.embers, this.scars]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh);
    }
    this.smoke.renderOrder = 4;
    this.group.add(...this.lights);
  }
  update(delta: number, elapsed: number, camera: THREE.Camera, night: number): void {
    this.accumulator += delta;
    if (this.accumulator >= 0.25) {
      this.accumulator = 0;
      const distance = (p: StructurePlot) => Math.hypot(p.worldX - camera.position.x, p.worldZ - camera.position.z);
      const plots = this.state.settlements.flatMap(s => s.structurePlots ?? []);
      this.sites = plots.filter(p => p.fire && distance(p) < 180).sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, FIRE_BUDGET.fires);
      this.scarSites = plots.filter(p => (p.scorch ?? 0) > 0.015 && distance(p) < 180).sort((a, b) => distance(a) - distance(b)).slice(0, FIRE_BUDGET.scars);
    }
    let flameCount = 0, smokeCount = 0, emberCount = 0, lightCount = 0;
    const t = this.transform;
    for (const plot of this.sites) {
      const fire = plot.fire;
      if (!fire) continue;
      const phase = stableHash(plot.id) * 50;
      const cell = cellAt(this.state.world, plot.worldX, plot.worldZ);
      const weather = cell && this.state.world.weather?.cells[cell.z * this.state.world.size + cell.x];
      const wind = weather?.wind ?? 0, wx = (weather?.windX ?? 1) * wind, wz = (weather?.windZ ?? 0) * wind;
      const baseY = this.surface.heightAt(plot.worldX, plot.worldZ);
      const scale = Math.max(0.55, Math.min(3.5, Math.sqrt(plot.width * plot.depth) * 0.48));
      const roof = Math.max(0.25, plot.height * (0.12 + plot.condition * 0.88) * 0.65);
      const smoulder = fire.stage === 'smouldering';
      const strength = smoulder ? 0 : fire.intensity;
      const distance = Math.hypot(plot.worldX - camera.position.x, plot.worldZ - camera.position.z);
      const visibility = 1 - THREE.MathUtils.smoothstep(distance, 80, 180);
      const flicker = 0.85 + Math.sin(elapsed * 5.7 + phase) * 0.09 + Math.sin(elapsed * 9.3 + phase * 1.7) * 0.06;
      const tongues = distance < 85 ? Math.ceil(3 + strength * 7) : 0;
      if (strength > 0.015) for (let j = 0; j < tongues; j++) {
        const angle = j * 2.399 + phase;
        const spread = scale * (0.16 + strength * 0.7) * Math.sqrt((j + 1) / tongues);
        const h = scale * strength * (0.8 + fract(j * 0.618 + phase) * 1.2) * (flicker + Math.sin(elapsed * 4.2 + j * 1.8) * 0.19);
        for (let core = 0; core < 2; core++) {
          t.position.set(plot.worldX + Math.cos(angle) * spread, baseY + roof * (0.5 + fract(j * 0.7) * 0.5), plot.worldZ + Math.sin(angle) * spread);
          t.rotation.set(wz * 0.45, angle + Math.sin(elapsed * 1.7 + j) * 0.3, -wx * 0.45);
          t.scale.set(scale * (core ? 0.32 : 0.65) * (0.3 + strength), h * (core ? 0.62 : 1), scale * (core ? 0.3 : 0.6) * (0.3 + strength));
          t.updateMatrix(); this.flames.setMatrixAt(flameCount, t.matrix);
          this.color.set(core ? '#fff2a2' : j % 3 ? '#ff9228' : '#ed4b16'); this.flames.setColorAt(flameCount++, this.color);
        }
      }
      const puffs = distance > 100 ? 18 : 36;
      for (let j = 0; j < puffs; j++) {
        const age = fract(elapsed * (smoulder ? 0.065 : 0.1) + j / puffs + phase);
        const rise = age * scale * (smoulder ? 4.5 : 9);
        const twist = elapsed * 0.55 + j * 2.399 + phase;
        const radius = scale * (0.2 + age * 1.1);
        t.position.set(plot.worldX + wx * rise * (0.4 + age) + Math.cos(twist) * radius * 0.5,
          baseY + roof + rise, plot.worldZ + wz * rise * (0.4 + age) + Math.sin(twist * 1.2) * radius * 0.5);
        t.quaternion.copy(camera.quaternion); t.rotateZ(Math.sin(j * 7 + phase) * 2 + age);
        const size = scale * (0.85 + age * 3.8) * (0.85 + fract(j * 0.718 + phase) * 0.3);
        t.scale.set(size, size * 1.12, 1); t.updateMatrix(); this.smoke.setMatrixAt(smokeCount, t.matrix);
        this.color.copy(this.dark).lerp(this.pale, smoulder ? 0.8 : Math.min(0.8, (1 - strength) * 0.5 + age * 0.4));
        this.smoke.setColorAt(smokeCount, this.color);
        this.alpha.setX(smokeCount++, visibility * Math.min(1, age * 12) * (1 - age) ** 1.6 * (smoulder ? 0.18 : 0.28 + strength * 0.5));
      }
      if (strength > 0.3 && distance < 65) for (let j = 0; j < Math.ceil(strength * 8); j++) {
        const age = fract(elapsed * (0.32 + j * 0.013) + j * 0.618 + phase);
        const carry = j === 0 ? 2.6 : 0.6;
        t.position.set(plot.worldX + Math.sin(j * 12 + elapsed) * scale * 0.4 + wx * age * scale * carry,
          baseY + roof + Math.sin(age * Math.PI * 0.75) * scale * (1.1 + j * 0.12), plot.worldZ + Math.cos(j * 9) * scale * 0.4 + wz * age * scale * carry);
        t.rotation.set(age * 5, j, age * 3); t.scale.setScalar(Math.sin(age * Math.PI) * strength); t.updateMatrix(); this.embers.setMatrixAt(emberCount++, t.matrix);
      }
      if (strength > 0.04 && lightCount < FIRE_BUDGET.lights && distance < 65) {
        const light = this.lights[lightCount++]!;
        light.position.set(plot.worldX, baseY + roof + scale * 0.4, plot.worldZ);
        light.intensity = strength * scale * flicker * (7 + night * 14); light.distance = 5 + scale * 7;
      }
    }
    for (let i = lightCount; i < this.lights.length; i++) this.lights[i]!.intensity = 0;
    let scars = 0;
    for (const plot of this.scarSites) {
      const x = plot.worldX, z = plot.worldZ;
      t.position.set(x, this.surface.heightAt(x, z) + 0.035, z);
      t.rotation.set(Math.atan2(this.surface.heightAt(x, z + 0.3) - this.surface.heightAt(x, z - 0.3), 0.6), stableHash(plot.id) * 6.28,
        -Math.atan2(this.surface.heightAt(x + 0.3, z) - this.surface.heightAt(x - 0.3, z), 0.6));
      t.scale.set(plot.width * 0.85, 1, plot.depth * 0.85); t.updateMatrix(); this.scars.setMatrixAt(scars, t.matrix);
      this.scars.setColorAt(scars++, this.color.setScalar(0.4 + (1 - (plot.scorch ?? 0)) * 0.6));
    }
    this.count = this.sites.filter(p => p.fire).length;
    this.flames.count = flameCount; this.smoke.count = smokeCount; this.embers.count = emberCount; this.scars.count = scars;
    for (const mesh of [this.flames, this.smoke, this.embers, this.scars]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.alpha.needsUpdate = true;
  }
  get report() { return { fires: this.count, flames: this.flames.count, smoke: this.smoke.count, embers: this.embers.count, scars: this.scars.count, lights: this.lights.filter(l => l.intensity > 0).length, budget: FIRE_BUDGET }; }
  dispose(): void {
    for (const mesh of [this.flames, this.smoke, this.embers, this.scars]) { mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
    this.group.clear(); this.sites = []; this.scarSites = [];
  }
}
