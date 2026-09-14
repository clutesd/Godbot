import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { clamp01, fbmSeeded, octaveSeeds, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { buildDistantWorld } from './DistantWorldRenderer';
import type { SurfaceSample, TerrainSurface } from './TerrainSurface';

interface EdgePoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

export interface WorldEdgeTransitionMetadata {
  presentationOnly: true;
  authoritative: false;
  transitionWidth: number;
  radialSegments: number;
  perimeterSamples: number;
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
  distant: new THREE.Color('#748078'),
};

const GRAIN_SEEDS = octaveSeeds('terrain', 'surface-grain', 3);
const diagonal = Math.SQRT1_2;
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/**
 * Presentation-only continuation around the authoritative terrain field.
 *
 * The simulation remains finite. This mesh starts on the exact canonical border, carries its relief
 * outward, then irregularly descends beneath the oversized ocean plane. The viewer therefore sees
 * landscape/ocean continuity instead of the old vertical diorama wall, while every gameplay query
 * continues to use TerrainSurface and the canonical TerrainField only.
 */
export function buildWorldEdgeTransition(world: WorldState, surface: TerrainSurface): THREE.Mesh {
  const { terrain } = world;
  const span = (terrain.resolution - 1) * terrain.step;
  const transitionWidth = Math.max(span * 0.32, terrain.step * 10);
  const radialSegments = Math.max(12, Math.min(20, Math.round(transitionWidth / Math.max(terrain.step * 2.4, 0.001))));
  const perimeter = buildPerimeter(world);
  const perimeterSamples = perimeter.length;
  const rings = radialSegments + 1;
  const vertexCount = perimeterSamples * rings;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(radialSegments * perimeterSamples * 6);

  const signature = terrainSignature(world);
  const macroSeeds = octaveSeeds(signature, 'edge-macro', 4);
  const detailSeeds = octaveSeeds(signature, 'edge-detail', 3);
  const coastSeeds = octaveSeeds(signature, 'edge-coast', 3);
  const colour = new THREE.Color();
  const rockTone = new THREE.Color();

  // The authoritative edge never changes during presentation. Cache it once instead of resampling
  // the same border for every visual ring.
  const edgeSamples = perimeter.map((point) => surface.sample(point.x, point.z));
  const edgeHeights = edgeSamples.map((sample) => sample.y);
  const inwardHeights = perimeter.map((point) => surface.heightAt(
    point.x - point.nx * terrain.step * 2,
    point.z - point.nz * terrain.step * 2,
  ));
  const coastVariations = perimeter.map((point) => fbmSeeded(
    coastSeeds,
    point.x * 0.035 + 17.3,
    point.z * 0.035 - 9.1,
  ));

  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / radialSegments;
    for (let pointIndex = 0; pointIndex < perimeterSamples; pointIndex += 1) {
      const point = perimeter[pointIndex]!;
      const edgeY = edgeHeights[pointIndex] ?? surface.seaLevelY;
      const inwardY = inwardHeights[pointIndex] ?? edgeY;
      const coastVariation = coastVariations[pointIndex] ?? 0.5;
      const distanceJitter = 1 + (coastVariation - 0.5) * 0.28 * smoothstep(0, 1, t);
      const distance = transitionWidth * t * distanceJitter;
      const worldX = point.x + point.nx * distance;
      const worldZ = point.z + point.nz * distance;
      const macro = fbmSeeded(macroSeeds, worldX * 0.018 + 4.2, worldZ * 0.018 - 6.8);
      const detail = fbmSeeded(detailSeeds, worldX * 0.065 - 12.7, worldZ * 0.065 + 3.6);

      // Continue the local border gradient briefly so cliffs, valleys and beaches do not flatten at
      // the seam. The derivative then decays and gives way to cheap seeded presentation relief.
      const outwardGradient = THREE.MathUtils.clamp((edgeY - inwardY) * 0.35, -0.48, 0.48);
      const gradientReach = Math.min(distance / Math.max(terrain.step, 0.001), 4);
      const continuedY = edgeY + outwardGradient * gradientReach * Math.exp(-t * 2.8);
      const reliefEnvelope = smoothstep(0.015, 0.24, t) * (1 - smoothstep(0.68, 0.98, t));
      const relief = ((macro - 0.5) * 5.4 + (detail - 0.5) * 1.8) * reliefEnvelope;

      // High border terrain relaxes toward foothills before reaching the coast. This avoids a ring
      // of giant perimeter cliffs while retaining enough relief to hide the old square silhouette.
      const rawLandY = continuedY + relief;
      const uplandCap = surface.seaLevelY + 2.1 + (macro - 0.5) * 3.2;
      const descent = smoothstep(0.16, 0.82, t) * 0.58;
      const relaxedLandY = lerp(rawLandY, Math.min(rawLandY, uplandCap), descent);

      // Vary where the visual coast begins around the perimeter. Every outermost vertex is safely
      // below the ocean plane, so the transition mesh itself never exposes another hard boundary.
      const coastStart = 0.44 + coastVariation * 0.3;
      const submerge = smoothstep(coastStart, 1, t);
      const seabedY = surface.seaLevelY - (1.9 + macro * 2.2);
      const worldY = lerp(relaxedLandY, seabedY, submerge);

      const vertex = ring * perimeterSamples + pointIndex;
      const offset = vertex * 3;
      positions[offset] = worldX;
      positions[offset + 1] = worldY;
      positions[offset + 2] = worldZ;

      const sample = edgeSamples[pointIndex]!;
      paintTransition(world, surface, sample, worldX, worldZ, worldY, t, colour, rockTone);
      colors[offset] = colour.r;
      colors[offset + 1] = colour.g;
      colors[offset + 2] = colour.b;
    }
  }

  let cursor = 0;
  for (let ring = 0; ring < radialSegments; ring += 1) {
    const inner = ring * perimeterSamples;
    const outer = (ring + 1) * perimeterSamples;
    for (let pointIndex = 0; pointIndex < perimeterSamples; pointIndex += 1) {
      const next = (pointIndex + 1) % perimeterSamples;
      const a = inner + pointIndex;
      const b = inner + next;
      const c = outer + pointIndex;
      const d = outer + next;
      indices[cursor] = a;
      indices[cursor + 1] = b;
      indices[cursor + 2] = c;
      indices[cursor + 3] = b;
      indices[cursor + 4] = d;
      indices[cursor + 5] = c;
      cursor += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.97,
    metalness: 0,
    vertexColors: true,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain-edge-transition';
  mesh.receiveShadow = true;
  // This large presentation skirt must never widen the authoritative shadow footprint.
  mesh.castShadow = false;
  mesh.userData['edgeTransition'] = {
    presentationOnly: true,
    authoritative: false,
    transitionWidth,
    radialSegments,
    perimeterSamples,
  } satisfies WorldEdgeTransitionMetadata;
  // Layer 2 lives under the same presentation root so existing renderer integration stays simple,
  // while remaining separately named/marked and impossible to reach through TerrainSurface queries.
  mesh.add(buildDistantWorld(world, surface));
  return mesh;
}

function terrainSignature(world: WorldState): string {
  const values = world.terrain.height;
  const last = Math.max(0, values.length - 1);
  const picks = [0, Math.floor(last * 0.29), Math.floor(last * 0.61), last];
  const fingerprint = picks.map((index) => Math.round((values[index] ?? 0) * 10000)).join(':');
  return `world-edge:${world.size}:${world.cellSize}:${world.seaLevel}:${fingerprint}`;
}

/** Clockwise perimeter with diagonal normals at the four corners. */
function buildPerimeter(world: WorldState): EdgePoint[] {
  const { resolution, step, originX, originZ } = world.terrain;
  const maxX = originX + (resolution - 1) * step;
  const maxZ = originZ + (resolution - 1) * step;
  const points: EdgePoint[] = [];

  for (let x = 0; x < resolution; x += 1) {
    points.push({
      x: originX + x * step,
      z: originZ,
      nx: x === 0 ? -diagonal : x === resolution - 1 ? diagonal : 0,
      nz: x === 0 || x === resolution - 1 ? -diagonal : -1,
    });
  }
  for (let z = 1; z < resolution; z += 1) {
    points.push({
      x: maxX,
      z: originZ + z * step,
      nx: z === resolution - 1 ? diagonal : 1,
      nz: z === resolution - 1 ? diagonal : 0,
    });
  }
  for (let x = resolution - 2; x >= 0; x -= 1) {
    points.push({
      x: originX + x * step,
      z: maxZ,
      nx: x === 0 ? -diagonal : 0,
      nz: x === 0 ? diagonal : 1,
    });
  }
  for (let z = resolution - 2; z >= 1; z -= 1) {
    points.push({ x: originX, z: originZ + z * step, nx: -1, nz: 0 });
  }
  return points;
}

function paintTransition(
  world: WorldState,
  surface: TerrainSurface,
  sample: SurfaceSample,
  worldX: number,
  worldZ: number,
  worldY: number,
  distanceRatio: number,
  colour: THREE.Color,
  rockTone: THREE.Color,
): void {
  // Ring zero deliberately mirrors TerrainSurface's palette closely. Farther out, elevation is a
  // presentation height rather than simulation elevation, so colour follows height relative to sea.
  const elevation = distanceRatio < 0.001
    ? sample.elevation
    : world.seaLevel + (worldY - surface.seaLevelY) / 17.5;
  const moisture = sample.moisture;
  const temperature = sample.temperature;
  const rock = sample.rock;
  const flow = sample.flow;
  const slope = sample.slope;

  if (worldY < surface.seaLevelY + 0.03) {
    const depth = clamp01((surface.seaLevelY - worldY) / 3.8);
    colour.copy(PALETTE.sand).lerp(PALETTE.shelf, smoothstep(0, 0.38, depth)).lerp(PALETTE.abyss, smoothstep(0.42, 1, depth));
  } else {
    colour.copy(PALETTE.grass);
    colour.lerp(PALETTE.dry, smoothstep(0.44, 0.2, moisture));
    colour.lerp(PALETTE.desert, smoothstep(0.3, 0.12, moisture) * smoothstep(0.5, 0.78, temperature));
    colour.lerp(PALETTE.lush, smoothstep(0.5, 0.78, moisture));
    colour.lerp(PALETTE.forestFloor, smoothstep(0.46, 0.78, sample.wood));
    colour.lerp(PALETTE.wetland, smoothstep(0.68, 0.9, moisture) * smoothstep(surface.seaLevelY + 2.8, surface.seaLevelY, worldY));
    colour.lerp(PALETTE.mud, smoothstep(0.62, 0.95, flow) * 0.35 * (1 - distanceRatio));
    const shore = smoothstep(surface.seaLevelY + 0.55, surface.seaLevelY, worldY) * smoothstep(0.4, 0.12, slope);
    colour.lerp(PALETTE.wetSand, shore * 0.45);
    colour.lerp(PALETTE.sand, shore * shore * 0.5);
  }

  const exposure = clamp01(smoothstep(0.3, 0.68, slope) * 0.8 + smoothstep(0.35, 0.85, rock) * 0.52);
  const strata = fbmSeeded(GRAIN_SEEDS, worldX * 0.11 + 4.7, worldZ * 0.11 - 9.3);
  rockTone.copy(PALETTE.rock).lerp(PALETTE.warmRock, strata);
  colour.lerp(rockTone, exposure * 0.82 * (1 - distanceRatio * 0.35));
  colour.lerp(PALETTE.darkRock, smoothstep(0.62, 0.95, slope) * 0.45 * (1 - distanceRatio * 0.4));
  colour.lerp(PALETTE.alpine, smoothstep(world.mountainLevel - 0.1, world.mountainLevel + 0.08, elevation) * 0.45);

  // Tiny stable variation prevents a uniform annulus without becoming visible terrain noise.
  const grain = stableHash('edge-transition-colour', Math.round(worldX * 2), Math.round(worldZ * 2)) - 0.5;
  colour.offsetHSL(grain * 0.008, grain * 0.025, grain * 0.035);
  // Distant land is slightly lower contrast so existing aerial perspective can take over smoothly.
  colour.lerp(PALETTE.distant, smoothstep(0.58, 1, distanceRatio) * 0.12);
}
