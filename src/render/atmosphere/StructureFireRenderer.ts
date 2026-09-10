import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { structureFireScars, structureFireSnapshots, type StructureFireSnapshot } from '../../sim/fire/StructureFireSystem';
import { cellAt } from '../../sim/world';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

const MAX_FIRES = 24;
const FLAMES_PER_FIRE = 7;
const SMOKE_PER_FIRE = 8;
const EMBERS_PER_FIRE = 10;
const MAX_SCARS = 72;
const FIRE_LIGHT_BUDGET = 4;

/**
 * Camera-local, bounded presentation of the authoritative structure-fire runtime.
 * Nothing in this class mutates simulation state: it only turns fire snapshots into flames,
 * smoke, embers, light and persistent scorch marks.
 */
export class StructureFireRenderer {
  readonly group = new THREE.Group();
  private readonly outerFlames: THREE.InstancedMesh;
  private readonly coreFlames: THREE.InstancedMesh;
  private readonly smoke: THREE.InstancedMesh;
  private readonly scorch: THREE.InstancedMesh;
  private readonly embers: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, private readonly seed: string) {
    this.group.name = 'structure-fires';

    const flameGeometry = new THREE.ConeGeometry(0.19, 1, 7, 2, true).translate(0, 0.5, 0);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: '#ff6a18', transparent: true, opacity: 0.78, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
    });
    this.outerFlames = new THREE.InstancedMesh(flameGeometry, outerMaterial, MAX_FIRES * FLAMES_PER_FIRE);
    this.outerFlames.frustumCulled = false;
    this.outerFlames.count = 0;

    const coreGeometry = new THREE.ConeGeometry(0.105, 0.68, 6, 1, true).translate(0, 0.34, 0);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: '#ffd36a', transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
    });
    this.coreFlames = new THREE.InstancedMesh(coreGeometry, coreMaterial, MAX_FIRES * FLAMES_PER_FIRE);
    this.coreFlames.frustumCulled = false;
    this.coreFlames.count = 0;

    const smokeGeometry = new THREE.IcosahedronGeometry(0.34, 1);
    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: '#302d2b', transparent: true, opacity: 0.24, depthWrite: false, vertexColors: true,
    });
    this.smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial, MAX_FIRES * SMOKE_PER_FIRE);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;

    const scorchGeometry = new THREE.CircleGeometry(0.5, 18);
    scorchGeometry.rotateX(-Math.PI / 2);
    const scorchMaterial = new THREE.MeshBasicMaterial({
      color: '#241d19', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    this.scorch = new THREE.InstancedMesh(scorchGeometry, scorchMaterial, MAX_SCARS);
    this.scorch.frustumCulled = false;
    this.scorch.count = 0;

    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FIRES * EMBERS_PER_FIRE * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const emberMaterial = new THREE.PointsMaterial({
      color: '#ff9b42', size: 0.055, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.embers = new THREE.Points(emberGeometry, emberMaterial);
    this.embers.frustumCulled = false;
    this.embers.geometry.setDrawRange(0, 0);

    this.group.add(this.scorch, this.smoke, this.outerFlames, this.coreFlames, this.embers);
    for (let index = 0; index < FIRE_LIGHT_BUDGET; index += 1) {
      const light = new THREE.PointLight('#ff7b32', 0, 12, 1.7);
      light.visible = false;
      this.fireLights.push(light);
      this.group.add(light);
    }
  }

  update(_delta: number, elapsed: number, camera: THREE.Camera): void {
    const fires = structureFireSnapshots(this.world)
      .filter((fire) => fire.intensity > 0.02 && this.distanceToCamera(fire.worldX, fire.worldZ, camera) < 145)
      .sort((a, b) => this.firePriority(b, camera) - this.firePriority(a, camera))
      .slice(0, MAX_FIRES);

    this.updateScars(camera);
    this.updateFlamesAndSmoke(fires, elapsed);
    this.updateEmbers(fires, elapsed);
    this.updateLights(fires, elapsed);
  }

  private updateFlamesAndSmoke(fires: readonly StructureFireSnapshot[], elapsed: number): void {
    let flameIndex = 0;
    let smokeIndex = 0;
    for (const fire of fires) {
      const weather = this.weatherAt(fire.worldX, fire.worldZ);
      const windX = (weather?.windX ?? 0) * (weather?.wind ?? 0);
      const windZ = (weather?.windZ ?? 0) * (weather?.wind ?? 0);
      const ground = this.surface.heightAt(fire.worldX, fire.worldZ);
      const footprint = Math.max(0.35, Math.min(1.7, Math.max(fire.width, fire.depth) * 0.42));

      for (let particle = 0; particle < FLAMES_PER_FIRE; particle += 1) {
        const phase = this.phase(fire, particle, 'flame');
        const angle = phase * Math.PI * 2 + particle * 2.399;
        const radius = footprint * (0.12 + phase * 0.62);
        const anchorX = fire.worldX + Math.cos(angle) * radius * Math.min(1, fire.width / Math.max(fire.width, fire.depth));
        const anchorZ = fire.worldZ + Math.sin(angle) * radius * Math.min(1, fire.depth / Math.max(fire.width, fire.depth));
        const wallHeight = fire.height * (0.15 + phase * 0.58);
        const flicker = 0.72 + Math.sin(elapsed * (7.4 + phase * 5.2) + phase * 17.3) * 0.16 + Math.sin(elapsed * 13.7 + particle) * 0.08;
        const height = Math.max(0.12, (0.32 + fire.intensity * 1.12) * flicker);
        const width = (0.18 + fire.intensity * 0.28) * (0.72 + phase * 0.42);
        const lean = 0.2 + fire.intensity * 0.25;
        this.compose(anchorX + windX * height * 0.08, ground + wallHeight, anchorZ + windZ * height * 0.08,
          width, height, width, -windZ * lean, 0, windX * lean);
        this.outerFlames.setMatrixAt(flameIndex, this.matrix);
        this.color.setHSL(0.035 + phase * 0.025, 1, 0.49 + flicker * 0.08);
        this.outerFlames.setColorAt(flameIndex, this.color);

        const coreWidth = width * 0.58;
        this.compose(anchorX, ground + wallHeight + 0.015, anchorZ, coreWidth, height * 0.66, coreWidth,
          -windZ * lean * 0.75, 0, windX * lean * 0.75);
        this.coreFlames.setMatrixAt(flameIndex, this.matrix);
        this.color.setHSL(0.105 + phase * 0.035, 0.96, 0.67 + flicker * 0.08);
        this.coreFlames.setColorAt(flameIndex, this.color);
        flameIndex += 1;
      }

      for (let particle = 0; particle < SMOKE_PER_FIRE; particle += 1) {
        const phase = this.phase(fire, particle, 'smoke');
        const cycle = (elapsed * (0.11 + fire.intensity * 0.08) + phase) % 1;
        const rise = cycle * (2.2 + fire.height * 1.25 + fire.intensity * 2.6);
        const curl = Math.sin(elapsed * 0.9 + phase * 19) * (0.12 + cycle * 0.34);
        const x = fire.worldX + windX * rise * (0.36 + cycle * 0.38) + curl;
        const z = fire.worldZ + windZ * rise * (0.36 + cycle * 0.38) + Math.cos(elapsed * 0.8 + phase * 13) * (0.1 + cycle * 0.28);
        const y = ground + fire.height * 0.58 + 0.18 + rise;
        const size = (0.22 + fire.width * 0.07 + cycle * 0.72) * (0.7 + fire.intensity * 0.55);
        this.compose(x, y, z, size * (1 + cycle * 0.4), size, size * (1 + cycle * 0.4), 0, phase * Math.PI * 2 + elapsed * 0.05, 0);
        this.smoke.setMatrixAt(smokeIndex, this.matrix);
        const soot = Math.max(0.08, Math.min(0.35, 0.26 - fire.intensity * 0.12 + cycle * 0.08));
        this.color.setRGB(soot, soot * 0.94, soot * 0.9);
        this.smoke.setColorAt(smokeIndex, this.color);
        smokeIndex += 1;
      }
    }

    this.outerFlames.count = flameIndex;
    this.coreFlames.count = flameIndex;
    this.smoke.count = smokeIndex;
    this.outerFlames.instanceMatrix.needsUpdate = true;
    this.coreFlames.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.outerFlames.instanceColor) this.outerFlames.instanceColor.needsUpdate = true;
    if (this.coreFlames.instanceColor) this.coreFlames.instanceColor.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }

  private updateEmbers(fires: readonly StructureFireSnapshot[], elapsed: number): void {
    const positions = this.embers.geometry.getAttribute('position');
    let emberIndex = 0;
    for (const fire of fires) {
      const weather = this.weatherAt(fire.worldX, fire.worldZ);
      const windX = (weather?.windX ?? 0) * (weather?.wind ?? 0);
      const windZ = (weather?.windZ ?? 0) * (weather?.wind ?? 0);
      const ground = this.surface.heightAt(fire.worldX, fire.worldZ);
      for (let particle = 0; particle < EMBERS_PER_FIRE; particle += 1) {
        const phase = this.phase(fire, particle, 'ember');
        const cycle = (elapsed * (0.24 + fire.intensity * 0.22) + phase) % 1;
        const angle = phase * Math.PI * 2 + elapsed * (0.5 + phase);
        const radius = (0.12 + cycle * 0.8) * Math.max(0.5, fire.width * 0.3);
        const rise = 0.25 + cycle * (1.2 + fire.intensity * 2.4);
        positions.setXYZ(emberIndex,
          fire.worldX + Math.cos(angle) * radius + windX * cycle * 1.7,
          ground + fire.height * 0.35 + rise,
          fire.worldZ + Math.sin(angle) * radius + windZ * cycle * 1.7);
        emberIndex += 1;
      }
    }
    this.embers.geometry.setDrawRange(0, emberIndex);
    if (emberIndex) positions.needsUpdate = true;
    this.embers.visible = emberIndex > 0;
  }

  private updateScars(camera: THREE.Camera): void {
    const scars = structureFireScars(this.world)
      .filter((scar) => scar.severity > 0.03 && this.distanceToCamera(scar.worldX, scar.worldZ, camera) < 165)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, MAX_SCARS);
    let index = 0;
    for (const scar of scars) {
      const y = this.surface.heightAt(scar.worldX, scar.worldZ) + 0.012;
      this.compose(scar.worldX, y, scar.worldZ,
        Math.max(0.45, scar.width * (0.72 + scar.severity * 0.3)), 1,
        Math.max(0.45, scar.depth * (0.72 + scar.severity * 0.3)), 0, 0, 0);
      this.scorch.setMatrixAt(index, this.matrix);
      index += 1;
    }
    this.scorch.count = index;
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  private updateLights(fires: readonly StructureFireSnapshot[], elapsed: number): void {
    for (let index = 0; index < this.fireLights.length; index += 1) {
      const light = this.fireLights[index]!;
      const fire = fires[index];
      if (!fire) {
        light.visible = false;
        light.intensity = 0;
        continue;
      }
      const ground = this.surface.heightAt(fire.worldX, fire.worldZ);
      const phase = this.phase(fire, index, 'light');
      const flicker = 0.82 + Math.sin(elapsed * (9 + phase * 3) + phase * 11) * 0.13 + Math.sin(elapsed * 17.2 + phase) * 0.05;
      light.visible = true;
      light.position.set(fire.worldX, ground + Math.max(0.45, fire.height * 0.55), fire.worldZ);
      light.intensity = (1.2 + fire.intensity * 4.8) * flicker;
      light.distance = 6 + fire.intensity * 9;
    }
  }

  private firePriority(fire: StructureFireSnapshot, camera: THREE.Camera): number {
    return fire.intensity * 3 + fire.width * 0.08 - this.distanceToCamera(fire.worldX, fire.worldZ, camera) * 0.008;
  }

  private distanceToCamera(x: number, z: number, camera: THREE.Camera): number {
    return Math.hypot(camera.position.x - x, camera.position.z - z);
  }

  private weatherAt(x: number, z: number) {
    const cell = cellAt(this.world, x, z);
    return cell ? this.world.weather?.cells[cell.z * this.world.size + cell.x] : undefined;
  }

  private phase(fire: StructureFireSnapshot, particle: number, layer: string): number {
    return stableHash(`${this.seed}:${layer}:${fire.plotId}`, particle, fire.startedMonth);
  }

  private compose(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number): void {
    this.position.set(x, y, z);
    this.scale.set(sx, sy, sz);
    this.euler.set(rx, ry, rz);
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }

  dispose(): void {
    for (const object of [this.outerFlames, this.coreFlames, this.smoke, this.scorch, this.embers]) {
      object.geometry.dispose();
      if (!Array.isArray(object.material)) object.material.dispose();
    }
  }
}
