import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { clamp01, fbmSeeded, octaveSeeds, ridgedSeeded, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from './TerrainSurface';

export type DistantLandformKind = 'mountain-chain' | 'foothills' | 'island-highlands' | 'low-continent';

export interface DistantLandformMetadata {
  presentationOnly: true;
  authoritative: false;
  kind: DistantLandformKind;
  centerDistance: number;
  width: number;
  depth: number;
  maxRelief: number;
}

export interface HorizonRidgeMetadata {
  presentationOnly: true;
  authoritative: false;
  layer: number;
  radius: number;
  arcLength: number;
  samples: number;
  maxRelief: number;
}

export interface HorizonBackdropMetadata {
  presentationOnly: true;
  authoritative: false;
  partialArcCoverage: true;
  layerCount: number;
  totalVertices: number;
  nearestRadius: number;
  farthestRadius: number;
}

export interface DistantWorldMetadata {
  presentationOnly: true;
  authoritative: false;
  asymmetric: true;
  landformCount: number;
  totalVertices: number;
  nearestCenterDistance: number;
  farthestCenterDistance: number;
  canonicalSpan: number;
  horizonLayerCount: number;
  horizonVertices: number;
}

interface LandformSpec {
  kind: DistantLandformKind;
  angle: number;
  centerDistance: number;
  width: number;
  depth: number;
  maxRelief: number;
  grid: number;
}

interface HorizonRidgeSpec {
  angle: number;
  radius: number;
  arcLength: number;
  maxRelief: number;
  samples: number;
}

const PALETTE = {
  shelf: new THREE.Color('#49656a'),
  sand: new THREE.Color('#a99f86'),
  lowland: new THREE.Color('#61765b'),
  upland: new THREE.Color('#626d59'),
  rock: new THREE.Color('#706f6c'),
  alpine: new THREE.Color('#8a8c8a'),
  snow: new THREE.Color('#c8d0d0'),
  haze: new THREE.Color('#788b8b'),
};

const HORIZON_NEAR = new THREE.Color('#62777a');
const HORIZON_MID = new THREE.Color('#718487');
const HORIZON_FAR = new THREE.Color('#819194');
const HORIZON_BASE = new THREE.Color('#65777a');
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/**
 * Cheap presentation geography beyond the finite simulation.
 *
 * Layer 1 hides the canonical square edge. Layer 2 supplies sparse, asymmetric landmasses farther
 * out: foothills, islands and mountain chains that sit inside the existing atmosphere/ocean. The
 * horizon backdrop adds a few even cheaper partial ridgelines behind those masses so wide shots
 * read as nested geography rather than isolated meshes. None of this geometry is authoritative.
 */
export function buildDistantWorld(world: WorldState, surface: TerrainSurface): THREE.Group {
  const group = new THREE.Group();
  group.name = 'distant-world';

  const span = (world.terrain.resolution - 1) * world.terrain.step;
  const centerX = world.terrain.originX + span * 0.5;
  const centerZ = world.terrain.originZ + span * 0.5;
  const signature = distantWorldSignature(world);
  const specs = buildLandformSpecs(signature, span);
  let totalVertices = 0;
  let nearestCenterDistance = Number.POSITIVE_INFINITY;
  let farthestCenterDistance = 0;

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]!;
    const mesh = buildLandform(surface, signature, spec, index, centerX, centerZ, span);
    totalVertices += spec.grid * spec.grid;
    nearestCenterDistance = Math.min(nearestCenterDistance, spec.centerDistance);
    farthestCenterDistance = Math.max(farthestCenterDistance, spec.centerDistance);
    group.add(mesh);
  }

  const horizon = buildHorizonBackdrop(surface, signature, centerX, centerZ, span);
  const horizonMetadata = horizon.userData['horizonBackdrop'] as HorizonBackdropMetadata;
  group.add(horizon);

  group.userData['distantWorld'] = {
    presentationOnly: true,
    authoritative: false,
    asymmetric: true,
    landformCount: specs.length,
    totalVertices,
    nearestCenterDistance,
    farthestCenterDistance,
    canonicalSpan: span,
    horizonLayerCount: horizonMetadata.layerCount,
    horizonVertices: horizonMetadata.totalVertices,
  } satisfies DistantWorldMetadata;
  return group;
}

function buildLandformSpecs(signature: string, span: number): LandformSpec[] {
  const kinds: readonly DistantLandformKind[] = [
    'mountain-chain',
    'foothills',
    'island-highlands',
    'low-continent',
    'foothills',
  ];
  // Deliberately uneven sectors. Jitter keeps seeds distinct without creating an arena-like ring.
  const baseAngles = [0.28, 1.46, 2.72, 4.05, 5.34];
  return kinds.map((kind, index) => {
    const a = stableHash(`${signature}:angle`, index, 0);
    const r = stableHash(`${signature}:radius`, index, 0);
    const w = stableHash(`${signature}:width`, index, 0);
    const d = stableHash(`${signature}:depth`, index, 0);
    const h = stableHash(`${signature}:height`, index, 0);
    const major = kind === 'mountain-chain';
    const continent = kind === 'low-continent';
    return {
      kind,
      angle: (baseAngles[index] ?? index) + (a - 0.5) * (major ? 0.2 : 0.42),
      centerDistance: span * (major ? 1.9 + r * 0.34 : continent ? 1.62 + r * 0.25 : 1.45 + r * 0.52),
      width: span * (major ? 1.5 + w * 0.28 : continent ? 1.15 + w * 0.32 : 0.62 + w * 0.42),
      depth: span * (major ? 0.62 + d * 0.2 : continent ? 0.9 + d * 0.18 : 0.48 + d * 0.34),
      maxRelief: major ? 22 + h * 12 : kind === 'island-highlands' ? 12 + h * 8 : continent ? 7 + h * 5 : 9 + h * 7,
      grid: major ? 30 : continent ? 26 : 22,
    };
  });
}

function buildLandform(
  surface: TerrainSurface,
  signature: string,
  spec: LandformSpec,
  index: number,
  centerX: number,
  centerZ: number,
  span: number,
): THREE.Mesh {
  const radialX = Math.cos(spec.angle);
  const radialZ = Math.sin(spec.angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;
  const landCenterX = centerX + radialX * spec.centerDistance;
  const landCenterZ = centerZ + radialZ * spec.centerDistance;
  const grid = spec.grid;
  const vertexCount = grid * grid;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array((grid - 1) * (grid - 1) * 6);
  const macroSeeds = octaveSeeds(signature, `distant-${index}-macro`, 4);
  const ridgeSeeds = octaveSeeds(signature, `distant-${index}-ridge`, 4);
  const detailSeeds = octaveSeeds(signature, `distant-${index}-detail`, 3);
  const colour = new THREE.Color();

  for (let z = 0; z < grid; z += 1) {
    const v = z / (grid - 1);
    const nz = v * 2 - 1;
    for (let x = 0; x < grid; x += 1) {
      const u = x / (grid - 1);
      const nx = u * 2 - 1;
      // Mountain chains run mostly across the viewing radius, which gives long silhouettes instead
      // of isolated cone-shaped peaks. Other landmasses retain the same basis but different aspect.
      const localAcross = nx * spec.width * 0.5;
      const localRadial = nz * spec.depth * 0.5;
      const worldX = landCenterX + tangentX * localAcross + radialX * localRadial;
      const worldZ = landCenterZ + tangentZ * localAcross + radialZ * localRadial;
      const ellipticalRadius = Math.hypot(nx, nz);
      const edgeEnvelope = 1 - smoothstep(0.62, 1, ellipticalRadius);
      const macro = fbmSeeded(macroSeeds, worldX * 0.009 + 11.7, worldZ * 0.009 - 5.4);
      const detail = fbmSeeded(detailSeeds, worldX * 0.031 - 8.1, worldZ * 0.031 + 14.2);
      const ridge = ridgedSeeded(ridgeSeeds, worldX * 0.012 + 3.8, worldZ * 0.012 - 6.6);
      const brokenCoast = clamp01(edgeEnvelope * (0.78 + (macro - 0.5) * 0.58));
      const landEnvelope = smoothstep(0.08, 0.58, brokenCoast);
      const mountainWeight = spec.kind === 'mountain-chain'
        ? Math.pow(ridge, 1.45) * (0.5 + macro * 0.5)
        : spec.kind === 'island-highlands'
          ? Math.pow(ridge, 1.8) * 0.72
          : spec.kind === 'foothills'
            ? Math.pow(ridge, 2.05) * 0.48
            : Math.pow(ridge, 2.2) * 0.26;
      const rollingRelief = (macro - 0.38) * (spec.kind === 'low-continent' ? 5.2 : 7.2)
        + (detail - 0.5) * 1.5;
      const aboveSea = 0.65 + rollingRelief + mountainWeight * spec.maxRelief;
      // Every patch boundary is safely below the ocean. This is the same trick as Layer 1: there is
      // no visible rectangle to discover even when a camera catches the landmass from the side.
      const seabedY = surface.seaLevelY - (2.4 + macro * 1.8);
      const landY = surface.seaLevelY + aboveSea;
      const worldY = lerp(seabedY, landY, landEnvelope);

      const vertex = z * grid + x;
      const offset = vertex * 3;
      positions[offset] = worldX;
      positions[offset + 1] = worldY;
      positions[offset + 2] = worldZ;
      paintDistantLand(surface, worldY, mountainWeight, spec.centerDistance / span, colour);
      colors[offset] = colour.r;
      colors[offset + 1] = colour.g;
      colors[offset + 2] = colour.b;
    }
  }

  let cursor = 0;
  for (let z = 0; z < grid - 1; z += 1) {
    for (let x = 0; x < grid - 1; x += 1) {
      const a = z * grid + x;
      const b = a + 1;
      const c = a + grid;
      const d = c + 1;
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

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.98,
    metalness: 0,
    vertexColors: true,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `distant-landform-${index}-${spec.kind}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData['distantLandform'] = {
    presentationOnly: true,
    authoritative: false,
    kind: spec.kind,
    centerDistance: spec.centerDistance,
    width: spec.width,
    depth: spec.depth,
    maxRelief: spec.maxRelief,
  } satisfies DistantLandformMetadata;
  return mesh;
}

function buildHorizonBackdrop(
  surface: TerrainSurface,
  signature: string,
  centerX: number,
  centerZ: number,
  span: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'horizon-backdrop';
  const specs = buildHorizonRidgeSpecs(signature, span);
  let totalVertices = 0;
  let nearestRadius = Number.POSITIVE_INFINITY;
  let farthestRadius = 0;

  for (let layer = 0; layer < specs.length; layer += 1) {
    const spec = specs[layer]!;
    group.add(buildHorizonRidge(surface, signature, spec, layer, centerX, centerZ, span));
    totalVertices += spec.samples * 2;
    nearestRadius = Math.min(nearestRadius, spec.radius);
    farthestRadius = Math.max(farthestRadius, spec.radius);
  }

  group.userData['horizonBackdrop'] = {
    presentationOnly: true,
    authoritative: false,
    partialArcCoverage: true,
    layerCount: specs.length,
    totalVertices,
    nearestRadius,
    farthestRadius,
  } satisfies HorizonBackdropMetadata;
  return group;
}

function buildHorizonRidgeSpecs(signature: string, span: number): HorizonRidgeSpec[] {
  const baseAngles = [0.46, 3.48, 5.18];
  const baseRadius = [2.34, 2.5, 2.68];
  const baseArc = [1.5, 1.18, 0.98];
  const baseRelief = [18, 13, 9];
  const samples = [72, 64, 56];
  return baseAngles.map((angle, layer) => ({
    angle: angle + (stableHash(`${signature}:horizon-angle`, layer, 0) - 0.5) * 0.24,
    radius: span * (baseRadius[layer]! + stableHash(`${signature}:horizon-radius`, layer, 0) * 0.08),
    arcLength: baseArc[layer]! + (stableHash(`${signature}:horizon-arc`, layer, 0) - 0.5) * 0.18,
    maxRelief: baseRelief[layer]! + stableHash(`${signature}:horizon-relief`, layer, 0) * 5,
    samples: samples[layer]!,
  }));
}

function buildHorizonRidge(
  surface: TerrainSurface,
  signature: string,
  spec: HorizonRidgeSpec,
  layer: number,
  centerX: number,
  centerZ: number,
  span: number,
): THREE.Mesh {
  const positions = new Float32Array(spec.samples * 2 * 3);
  const colors = new Float32Array(spec.samples * 2 * 3);
  const indices = new Uint32Array((spec.samples - 1) * 6);
  const ridgeSeeds = octaveSeeds(signature, `horizon-${layer}-ridge`, 4);
  const macroSeeds = octaveSeeds(signature, `horizon-${layer}-macro`, 3);
  const topColour = new THREE.Color();
  const layerColour = layer === 0 ? HORIZON_NEAR : layer === 1 ? HORIZON_MID : HORIZON_FAR;

  for (let sample = 0; sample < spec.samples; sample += 1) {
    const t = sample / (spec.samples - 1);
    const angle = spec.angle + (t - 0.5) * spec.arcLength;
    const macro = fbmSeeded(macroSeeds, t * 3.8 + layer * 1.7, layer * 2.9 + 4.1);
    const radius = spec.radius + (macro - 0.5) * span * 0.075;
    const worldX = centerX + Math.cos(angle) * radius;
    const worldZ = centerZ + Math.sin(angle) * radius;
    const ridge = ridgedSeeded(ridgeSeeds, worldX * 0.008 + 2.3, worldZ * 0.008 - 7.2);
    const arcEnvelope = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.72);
    const broad = 0.68 + macro * 0.42;
    const relief = spec.maxRelief * (0.28 + Math.pow(ridge, 1.55) * 0.92) * broad;
    // Arc endpoints submerge, so each partial skyline dies naturally into ocean/air rather than
    // exposing a vertical curtain at either end.
    const topY = surface.seaLevelY - 1.1 + arcEnvelope * (2.25 + relief);
    const bottomY = surface.seaLevelY - 5.2 - macro * 0.9;
    const topIndex = sample * 2;
    const bottomIndex = topIndex + 1;
    let offset = topIndex * 3;
    positions[offset] = worldX;
    positions[offset + 1] = topY;
    positions[offset + 2] = worldZ;
    offset = bottomIndex * 3;
    positions[offset] = worldX;
    positions[offset + 1] = bottomY;
    positions[offset + 2] = worldZ;

    const peak = clamp01((topY - surface.seaLevelY) / Math.max(8, spec.maxRelief));
    topColour.copy(layerColour).lerp(HORIZON_FAR, peak * 0.08 + layer * 0.05);
    offset = topIndex * 3;
    colors[offset] = topColour.r;
    colors[offset + 1] = topColour.g;
    colors[offset + 2] = topColour.b;
    offset = bottomIndex * 3;
    colors[offset] = HORIZON_BASE.r;
    colors[offset + 1] = HORIZON_BASE.g;
    colors[offset + 2] = HORIZON_BASE.b;
  }

  let cursor = 0;
  for (let sample = 0; sample < spec.samples - 1; sample += 1) {
    const a = sample * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[cursor] = a;
    indices[cursor + 1] = b;
    indices[cursor + 2] = c;
    indices[cursor + 3] = c;
    indices[cursor + 4] = b;
    indices[cursor + 5] = d;
    cursor += 6;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // Scene FogExp2 is tuned for the simulated world and would erase these extreme-distance strips
  // almost completely. They are pre-hazed and still pass through the depth-aware aerial perspective,
  // which gives weather/day-night extinction without losing the skyline in clear conditions.
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.toneMapped = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `horizon-ridge-${layer}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData['horizonRidge'] = {
    presentationOnly: true,
    authoritative: false,
    layer,
    radius: spec.radius,
    arcLength: spec.arcLength,
    samples: spec.samples,
    maxRelief: spec.maxRelief,
  } satisfies HorizonRidgeMetadata;
  return mesh;
}

function paintDistantLand(
  surface: TerrainSurface,
  worldY: number,
  mountainWeight: number,
  distanceRatio: number,
  colour: THREE.Color,
): void {
  const height = worldY - surface.seaLevelY;
  if (height < 0.15) {
    colour.copy(PALETTE.shelf).lerp(PALETTE.sand, smoothstep(-0.8, 0.15, height) * 0.55);
  } else {
    colour.copy(PALETTE.lowland);
    colour.lerp(PALETTE.upland, smoothstep(2.5, 8, height) * 0.7);
    colour.lerp(PALETTE.rock, smoothstep(0.28, 0.7, mountainWeight) * 0.78);
    colour.lerp(PALETTE.alpine, smoothstep(9, 19, height) * 0.68);
    colour.lerp(PALETTE.snow, smoothstep(18, 27, height) * 0.48);
  }
  // Lower contrast before the screen-space atmosphere even touches it. This keeps these meshes from
  // competing with the simulated world and makes layered ridgelines read as genuinely far away.
  const haze = clamp01((distanceRatio - 1.15) / 1.45);
  colour.lerp(PALETTE.haze, 0.12 + haze * 0.24);
}

function distantWorldSignature(world: WorldState): string {
  const values = world.terrain.height;
  const last = Math.max(0, values.length - 1);
  const picks = [0, Math.floor(last * 0.17), Math.floor(last * 0.43), Math.floor(last * 0.76), last];
  const fingerprint = picks.map((sample) => Math.round((values[sample] ?? 0) * 10000)).join(':');
  return `distant-world:${world.size}:${world.cellSize}:${world.seaLevel}:${fingerprint}`;
}
