import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01, fbm, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { elevationToY, type TerrainSurface } from '../terrain/TerrainSurface';
import { softPointTexture } from './sprites';

/**
 * Sky, cloud and valley mist. Wide shots need something behind the mountains and something
 * between them; without the layers a stylised world reads flat no matter how good the terrain is.
 */
export class SkyAtmosphere {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh;
  private readonly skyColors: THREE.BufferAttribute;
  private readonly skyHeights: Float32Array;
  private readonly clouds: THREE.Points | undefined;
  private readonly mist: THREE.Mesh | undefined;
  private readonly zenith = new THREE.Color();
  private readonly horizon = new THREE.Color();
  private readonly blend = new THREE.Color();

  constructor(world: WorldState, surface: TerrainSurface, seed: string) {
    this.group.name = 'atmosphere';
    // Larger than the ocean sheet, so the water never pokes out past the horizon.
    const radius = Math.max(world.size * world.cellSize * 6, 760);
    const geometry = new THREE.SphereGeometry(radius, 32, 20);
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    this.skyHeights = new Float32Array(position.count);
    for (let index = 0; index < position.count; index += 1) {
      this.skyHeights[index] = clamp01((position.getY(index) / radius) * 0.5 + 0.5);
    }
    this.skyColors = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', this.skyColors);
    this.sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.name = 'sky';
    this.sky.renderOrder = -1;
    this.group.add(this.sky);
    this.setPalette(new THREE.Color('#7fa5c4'), new THREE.Color('#c9d4d2'));

    const random = new SeededRandom(`${seed}:atmosphere`);
    this.clouds = buildClouds(world, random);
    if (this.clouds) this.group.add(this.clouds);
    this.mist = buildValleyMist(world, surface, seed);
    if (this.mist) this.group.add(this.mist);
  }

  /** Recoloured every frame by the day/night cycle, so the horizon warms and cools with the sun. */
  setPalette(zenith: THREE.Color, horizon: THREE.Color): void {
    this.zenith.copy(zenith);
    this.horizon.copy(horizon);
    const colors = this.skyColors.array as Float32Array;
    for (let index = 0; index < this.skyHeights.length; index += 1) {
      const height = this.skyHeights[index] ?? 0;
      this.blend.copy(this.horizon).lerp(this.zenith, smoothstep(0.46, 0.94, height));
      colors[index * 3] = this.blend.r;
      colors[index * 3 + 1] = this.blend.g;
      colors[index * 3 + 2] = this.blend.b;
    }
    this.skyColors.needsUpdate = true;
  }

  setMistStrength(strength: number): void {
    if (!this.mist) return;
    const material = this.mist.material;
    if (material instanceof THREE.MeshBasicMaterial) material.opacity = clamp01(strength);
  }

  setCloudTint(colour: THREE.Color): void {
    if (!this.clouds) return;
    const material = this.clouds.material;
    if (material instanceof THREE.PointsMaterial) material.color.copy(colour);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    if (this.clouds) this.clouds.rotation.y += deltaSeconds * 0.0042;
    if (this.mist) this.mist.position.y = Math.sin(elapsedSeconds * 0.09) * 0.25;
  }

  followCamera(camera: THREE.Camera): void {
    this.sky.position.set(camera.position.x, 0, camera.position.z);
  }
}

function buildClouds(world: WorldState, random: SeededRandom): THREE.Points | undefined {
  const count = 260;
  const span = world.size * world.cellSize * 2.4;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = random.range(0, Math.PI * 2);
    const distance = (0.45 + Math.sqrt(random.float()) * 0.55) * span * 0.5;
    positions[index * 3] = Math.cos(angle) * distance;
    positions[index * 3 + 1] = random.range(46, 78);
    positions[index * 3 + 2] = Math.sin(angle) * distance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const clouds = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: '#eef2f2',
      size: 26,
      map: softPointTexture(),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  clouds.name = 'cloud-layer';
  clouds.frustumCulled = false;
  return clouds;
}

/**
 * A translucent sheet that pools in the low ground. Alpha is driven by how far the terrain sits
 * below the mist ceiling, so it fills valleys and basins and thins out on the slopes above.
 */
function buildValleyMist(world: WorldState, surface: TerrainSurface, seed: string): THREE.Mesh | undefined {
  const { terrain, seaLevel } = world;
  const stride = 2;
  const resolution = Math.floor((terrain.resolution - 1) / stride) + 1;
  if (resolution < 4) return undefined;
  const step = terrain.step * stride;
  const ceiling = elevationToY(seaLevel + 0.1, seaLevel);
  const positions = new Float32Array(resolution * resolution * 3);
  const colors = new Float32Array(resolution * resolution * 4);
  const indices: number[] = [];
  const base = new THREE.Color('#d7e2e4');
  let anyVisible = false;

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const worldX = terrain.originX + x * step;
      const worldZ = terrain.originZ + z * step;
      const ground = surface.heightAt(worldX, worldZ);
      positions[index * 3] = worldX;
      positions[index * 3 + 1] = ceiling;
      positions[index * 3 + 2] = worldZ;
      const depth = smoothstep(ceiling, ceiling - 4.2, ground);
      const drift = fbm(`${seed}:mist`, worldX * 0.06, worldZ * 0.06, 3);
      const alpha = clamp01(depth * smoothstep(0.3, 0.72, drift));
      if (alpha > 0.05) anyVisible = true;
      colors[index * 4] = base.r;
      colors[index * 4 + 1] = base.g;
      colors[index * 4 + 2] = base.b;
      colors[index * 4 + 3] = alpha;
    }
  }
  if (!anyVisible) return undefined;

  for (let z = 0; z < resolution - 1; z += 1) {
    for (let x = 0; x < resolution - 1; x += 1) {
      const a = z * resolution + x;
      indices.push(a, a + resolution, a + 1, a + 1, a + resolution, a + resolution + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.name = 'valley-mist';
  mesh.renderOrder = 2;
  return mesh;
}
