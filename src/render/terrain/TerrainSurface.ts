import * as THREE from 'three';
import { elevationToY, surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';
export { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import { stableHash } from '../../sim/prng';
import { clamp01, fbmSeeded, octaveSeeds, smoothstep } from '../../sim/terrain/noise';
import { nearestIndex, sampleField } from '../../sim/terrain/TerrainField';
import type { WorldCell, WorldState } from '../../sim/types';

export interface SurfaceSample {
  elevation: number;
  /** 0..1 normalised steepness. */
  slope: number;
  rock: number;
  flow: number;
  moisture: number;
  temperature: number;
  wood: number;
  /** Ground height in world units. */
  y: number;
}

const PALETTE = {
  abyss: new THREE.Color('#2b4450'),
  shelf: new THREE.Color('#54706e'),
  sand: new THREE.Color('#c4b394'),
  wetSand: new THREE.Color('#8f8267'),
  grass: new THREE.Color('#6f8a4e'),
  lush: new THREE.Color('#477b56'),
  dry: new THREE.Color('#b09257'),
  desert: new THREE.Color('#c19a63'),
  forestFloor: new THREE.Color('#3e5c3d'),
  wetland: new THREE.Color('#4c7668'),
  mud: new THREE.Color('#6d5f45'),
  rock: new THREE.Color('#77706a'),
  warmRock: new THREE.Color('#8a7761'),
  darkRock: new THREE.Color('#4a4744'),
  alpine: new THREE.Color('#8b8781'),
  snow: new THREE.Color('#e8edef'),
};

/**
 * The single authority on where the ground is. The mesh, building foundations, vegetation, routes
 * and the camera all sample this, which is why nothing floats or sinks.
 */
export class TerrainSurface {
  readonly seaLevelY: number;
  private readonly world: WorldState;
  private readonly moistureField: Float32Array;
  private readonly temperatureField: Float32Array;
  private readonly woodField: Float32Array;
  private readonly grainSeeds = octaveSeeds('terrain', 'surface-grain', 3);
  private readonly rockTone = new THREE.Color();
  private readonly scratch = new THREE.Color();

  constructor(world: WorldState) {
    this.world = world;
    this.seaLevelY = elevationToY(world.seaLevel, world.seaLevel);
    const count = world.size * world.size;
    this.moistureField = new Float32Array(count);
    this.temperatureField = new Float32Array(count);
    this.woodField = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const cell = world.cells[index];
      if (!cell) continue;
      this.moistureField[index] = cell.moisture;
      this.temperatureField[index] = cell.temperature;
      this.woodField[index] = cell.wood;
    }
  }

  /** Ground height in world units at any position, smoothly interpolated. */
  heightAt(worldX: number, worldZ: number): number {
    return surfaceHeightAt(this.world, worldX, worldZ);
  }

  elevationAt(worldX: number, worldZ: number): number {
    return sampleField(this.world.terrain, this.world.terrain.height, worldX, worldZ);
  }

  /** Surface of standing or flowing water in world units, or -Infinity where the ground is dry. */
  waterYAt(worldX: number, worldZ: number): number {
    const level = this.world.terrain.waterLevel[nearestIndex(this.world.terrain, worldX, worldZ)] ?? -1;
    return level < 0 ? Number.NEGATIVE_INFINITY : elevationToY(level, this.world.seaLevel);
  }

  slopeAt(worldX: number, worldZ: number): number {
    const step = this.world.terrain.step;
    const east = this.heightAt(worldX + step, worldZ);
    const west = this.heightAt(worldX - step, worldZ);
    const south = this.heightAt(worldX, worldZ + step);
    const north = this.heightAt(worldX, worldZ - step);
    return clamp01(Math.hypot(east - west, south - north) / (2 * step) * 0.6);
  }

  normalAt(worldX: number, worldZ: number, target: THREE.Vector3): THREE.Vector3 {
    const step = this.world.terrain.step;
    const east = this.heightAt(worldX + step, worldZ);
    const west = this.heightAt(worldX - step, worldZ);
    const south = this.heightAt(worldX, worldZ + step);
    const north = this.heightAt(worldX, worldZ - step);
    return target.set(west - east, 2 * step, north - south).normalize();
  }

  sample(worldX: number, worldZ: number): SurfaceSample {
    const { terrain } = this.world;
    return {
      elevation: this.elevationAt(worldX, worldZ),
      slope: this.slopeAt(worldX, worldZ),
      rock: sampleField(terrain, terrain.rock, worldX, worldZ),
      flow: sampleField(terrain, terrain.flow, worldX, worldZ),
      moisture: this.sampleCellField(this.moistureField, worldX, worldZ),
      temperature: this.sampleCellField(this.temperatureField, worldX, worldZ),
      wood: this.sampleCellField(this.woodField, worldX, worldZ),
      y: this.heightAt(worldX, worldZ),
    };
  }

  /** Bilinear read of a per-cell simulation field, so surfaces blend instead of tiling. */
  sampleCellField(values: Float32Array, worldX: number, worldZ: number): number {
    const { size, cellSize } = this.world;
    const fx = Math.min(size - 1, Math.max(0, worldX / cellSize + size / 2));
    const fz = Math.min(size - 1, Math.max(0, worldZ / cellSize + size / 2));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(size - 1, x0 + 1);
    const z1 = Math.min(size - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const a = values[z0 * size + x0] ?? 0;
    const b = values[z0 * size + x1] ?? 0;
    const c = values[z1 * size + x0] ?? 0;
    const d = values[z1 * size + x1] ?? 0;
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  /**
   * One continuous, smoothly shaded mesh at three samples per simulation cell. This is what
   * replaces the per-cell boxes, and it is the single biggest reason the world stops reading
   * as a grid.
   */
  buildMesh(seed: string): THREE.Mesh {
    const { terrain } = this.world;
    const { resolution, step, originX, originZ } = terrain;
    const vertexCount = resolution * resolution;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);

    for (let z = 0; z < resolution; z += 1) {
      const worldZ = originZ + z * step;
      for (let x = 0; x < resolution; x += 1) {
        const index = z * resolution + x;
        const worldX = originX + x * step;
        const elevation = terrain.height[index] ?? 0;
        const offset = index * 3;
        positions[offset] = worldX;
        positions[offset + 1] = this.heightAt(worldX, worldZ);
        positions[offset + 2] = worldZ;
        this.paintSurface(seed, worldX, worldZ, index, elevation);
        colors[offset] = this.scratch.r;
        colors[offset + 1] = this.scratch.g;
        colors[offset + 2] = this.scratch.b;
      }
    }

    let cursor = 0;
    for (let z = 0; z < resolution - 1; z += 1) {
      for (let x = 0; x < resolution - 1; x += 1) {
        const a = z * resolution + x;
        const b = a + 1;
        const c = a + resolution;
        const d = c + 1;
        // Flip the shared edge per quad so the triangulation stops reading as diagonal stripes.
        if (((x + z) & 1) === 0) {
          indices[cursor] = a; indices[cursor + 1] = c; indices[cursor + 2] = b;
          indices[cursor + 3] = b; indices[cursor + 4] = c; indices[cursor + 5] = d;
        } else {
          indices[cursor] = a; indices[cursor + 1] = c; indices[cursor + 2] = d;
          indices[cursor + 3] = a; indices[cursor + 4] = d; indices[cursor + 5] = b;
        }
        cursor += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true, flatShading: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  /** A downward apron around the border so the world reads as a mass, not a sheet. */
  buildApron(): THREE.Mesh {
    const { terrain, seaLevel } = this.world;
    const { resolution, step, originX, originZ } = terrain;
    const bottom = elevationToY(0, seaLevel) - 6;
    const positions: number[] = [];
    const indices: number[] = [];
    const edge: Array<[number, number]> = [];
    for (let x = 0; x < resolution; x += 1) edge.push([x, 0]);
    for (let z = 1; z < resolution; z += 1) edge.push([resolution - 1, z]);
    for (let x = resolution - 2; x >= 0; x -= 1) edge.push([x, resolution - 1]);
    for (let z = resolution - 2; z >= 0; z -= 1) edge.push([0, z]);

    for (const [x, z] of edge) {
      const worldX = originX + x * step;
      const worldZ = originZ + z * step;
      const y = this.heightAt(worldX, worldZ);
      positions.push(worldX, y, worldZ, worldX, bottom, worldZ);
    }
    const rings = edge.length;
    for (let index = 0; index < rings - 1; index += 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#4a463f', roughness: 1 }));
    mesh.name = 'terrain-apron';
    return mesh;
  }

  /**
   * Surface blending. Every transition is driven by slope, altitude, moisture and hydrology, so
   * beaches appear where the land meets the sea and rock appears where the land stands up.
   */
  private paintSurface(seed: string, worldX: number, worldZ: number, index: number, elevation: number): void {
    const { terrain, seaLevel, mountainLevel } = this.world;
    const colour = this.scratch;
    const moisture = this.sampleCellField(this.moistureField, worldX, worldZ);
    const temperature = this.sampleCellField(this.temperatureField, worldX, worldZ);
    const wood = this.sampleCellField(this.woodField, worldX, worldZ);
    const rock = terrain.rock[index] ?? 0;
    const flow = terrain.flow[index] ?? 0;
    const slope = this.slopeAt(worldX, worldZ);

    if (elevation < seaLevel) {
      const depth = smoothstep(seaLevel, seaLevel - 0.16, elevation);
      colour.copy(PALETTE.sand).lerp(PALETTE.shelf, smoothstep(0, 0.35, depth)).lerp(PALETTE.abyss, smoothstep(0.35, 1, depth));
    } else {
      colour.copy(PALETTE.grass);
      colour.lerp(PALETTE.dry, smoothstep(0.44, 0.2, moisture));
      colour.lerp(PALETTE.desert, smoothstep(0.3, 0.12, moisture) * smoothstep(0.5, 0.78, temperature));
      colour.lerp(PALETTE.lush, smoothstep(0.5, 0.78, moisture));
      colour.lerp(PALETTE.forestFloor, smoothstep(0.46, 0.78, wood));
      colour.lerp(PALETTE.wetland, smoothstep(0.68, 0.9, moisture) * smoothstep(seaLevel + 0.16, seaLevel, elevation));
      // Floodplain silt beside the rivers.
      colour.lerp(PALETTE.mud, smoothstep(0.62, 0.95, flow) * 0.45);
      // Beaches only form where the shore is flat; steep coast stays rock.
      const shore = smoothstep(seaLevel + 0.03, seaLevel, elevation) * smoothstep(0.4, 0.12, slope);
      colour.lerp(PALETTE.wetSand, shore * 0.5);
      colour.lerp(PALETTE.sand, shore * shore * 0.55);
    }

    // Rock is a mix, not a single grey: warm strata low down, cold stone on the exposed faces.
    const exposure = clamp01(smoothstep(0.3, 0.68, slope) * 0.9 + smoothstep(0.35, 0.85, rock) * 0.6);
    const strata = fbmSeeded(this.grainSeeds, worldX * 0.11 + 4.7, worldZ * 0.11 - 9.3);
    this.rockTone.copy(PALETTE.rock).lerp(PALETTE.warmRock, strata);
    colour.lerp(this.rockTone, exposure * 0.88);
    colour.lerp(PALETTE.darkRock, smoothstep(0.62, 0.95, slope) * 0.55);
    colour.lerp(PALETTE.alpine, smoothstep(mountainLevel - 0.1, mountainLevel + 0.08, elevation) * 0.5);

    // Fine deterministic grain, so large flat surfaces still have life at close range.
    const grain = stableHash(`${seed}:surface-grain`, index % terrain.resolution, (index / terrain.resolution) | 0) - 0.5;
    colour.offsetHSL(grain * 0.012, grain * 0.05, grain * 0.055);
  }
}

/**
 * Normalised elevation to world height. The alpine term is eased rather than linear so lowlands
 * stay gentle enough to build on while the high country gains the vertical drama the skyline needs.
 */
export function cellSurfaceY(cell: WorldCell, seaLevel: number): number {
  return elevationToY(cell.elevation, seaLevel);
}
