/**
 * BuildingComposer.ts
 *
 * Turns a BuildingGrammar into geometry.
 *
 * Everything is assembled in a canonical frame: origin on the ground at the centre of the
 * footprint, +Y up, entrance facing +Z. The renderer scales and rotates the result onto its
 * reserved placement footprint, so nothing here may depend on world position.
 *
 * Parts are emitted into per-surface geometry builders and merged, so a fully detailed
 * structure costs a handful of draw calls rather than one per plank.
 */

import * as THREE from 'three';
import { GeometryBuilder, squareRing, type Vec3 } from './GeometryBuilder';
import type { BuildingGrammar, RoofFamily, WallLayer } from './BuildingGrammar';
import { eraRank } from './BuildingGrammar';
import type { MaterialPalette, SurfaceKey } from '../materials/MaterialPalette';
import type { MotifFamily, PatternStyle } from '../style/CultureStyleProfile';
import { SeededRandom } from '../../sim/prng';

/** Construction lifecycle. Parts are emitted only once their stage has been reached. */
export const BUILD_STAGE = {
  FOUNDATION: 0,
  FRAME: 1,
  WALLS: 2,
  ROOF: 3,
  DETAIL: 4,
} as const;

export type BuildStage = (typeof BUILD_STAGE)[keyof typeof BUILD_STAGE];

export const BUILD_STAGE_ORDER: readonly string[] = [
  'foundation',
  'frame',
  'partial-walls',
  'roof',
  'complete',
];

export function stageFromName(name: string | undefined): BuildStage {
  const index = name ? BUILD_STAGE_ORDER.indexOf(name) : -1;
  return (index < 0 ? BUILD_STAGE.DETAIL : index) as BuildStage;
}

class BuildingCanvas {
  private readonly surfaces = new Map<SurfaceKey, GeometryBuilder>();

  constructor(
    private readonly stage: number,
    private readonly wear = 0,
    private readonly tone = 0,
  ) {}

  /** Returns a builder only if the requested part belongs to a stage already built. */
  at(surface: SurfaceKey, requiredStage: number): GeometryBuilder | undefined {
    if (requiredStage > this.stage) return undefined;
    let builder = this.surfaces.get(surface);
    if (!builder) {
      builder = new GeometryBuilder();
      builder.setWeathering(this.wear, this.tone);
      this.surfaces.set(surface, builder);
    }
    return builder;
  }

  /** Raise weathering for parts that age faster: soot around flues, splash at ground level. */
  stain(builder: GeometryBuilder | undefined, extra: number): void {
    builder?.setWeathering(Math.min(1, this.wear + extra), this.tone);
  }

  /** Return a builder to the building's baseline weathering. */
  clean(builder: GeometryBuilder | undefined): void {
    builder?.setWeathering(this.wear, this.tone);
  }

  build(palette: MaterialPalette): THREE.Group {
    const group = new THREE.Group();
    for (const [surface, builder] of this.surfaces) {
      if (builder.isEmpty) continue;
      const geometry = builder.build();
      geometry.userData['shared'] = true;
      const material = palette.getSurfaceMaterial(surface);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = surface !== 'shadow';
      mesh.receiveShadow = true;
      mesh.name = surface;
      group.add(mesh);
    }
    return group;
  }
}

interface WallFrame {
  originX: number;
  originZ: number;
  tangentX: number;
  tangentZ: number;
  normalX: number;
  normalZ: number;
  length: number;
}

function wallFrames(halfWidth: number, halfDepth: number): WallFrame[] {
  return [
    { originX: 0, originZ: halfDepth, tangentX: 1, tangentZ: 0, normalX: 0, normalZ: 1, length: halfWidth * 2 },
    { originX: 0, originZ: -halfDepth, tangentX: -1, tangentZ: 0, normalX: 0, normalZ: -1, length: halfWidth * 2 },
    { originX: halfWidth, originZ: 0, tangentX: 0, tangentZ: -1, normalX: 1, normalZ: 0, length: halfDepth * 2 },
    { originX: -halfWidth, originZ: 0, tangentX: 0, tangentZ: 1, normalX: -1, normalZ: 0, length: halfDepth * 2 },
  ];
}

function framePoint(frame: WallFrame, u: number, y: number, outward: number): Vec3 {
  return {
    x: frame.originX + frame.tangentX * u + frame.normalX * outward,
    y,
    z: frame.originZ + frame.tangentZ * u + frame.normalZ * outward,
  };
}

interface RoofShellOptions {
  halfWidth: number;
  halfDepth: number;
  baseY: number;
  height: number;
  overhang: number;
  upturn: number;
  concavity: number;
  ridgeXRatio: number;
  ridgeZRatio: number;
  segmentsPerSide: number;
  rings: number;
  eaveDrop: number;
  /** Emit proud lips at intermediate rings so tile and thatch roofs read as laid courses. */
  courses?: boolean;
  /** Plan offset, for porticoes, cupolas and towers that do not sit over the body centre. */
  centerX?: number;
  centerZ?: number;
}

/**
 * Lofts a roof shell between an overhanging eave ring and a ridge ring.
 * Concavity bends the profile (positive sags like layered tile roofs, negative bulges into a
 * shell dome) and `upturn` lifts the corners, which is what produces the flared silhouette.
 */
function emitRoofShell(builder: GeometryBuilder, soffit: GeometryBuilder | undefined, options: RoofShellOptions): void {
  const exponent = 1 / (1 + Math.max(-0.85, options.concavity));
  const eaveScale = 1 + options.overhang;
  const offsetX = options.centerX ?? 0;
  const offsetZ = options.centerZ ?? 0;
  const rings: ReturnType<typeof squareRing>[] = [];
  for (let index = 0; index < options.rings; index += 1) {
    const v = index / (options.rings - 1);
    const f = Math.pow(v, exponent);
    const scaleX = eaveScale + (options.ridgeXRatio - eaveScale) * f;
    const scaleZ = eaveScale + (options.ridgeZRatio - eaveScale) * f;
    const y = options.baseY - options.eaveDrop + (options.height + options.eaveDrop) * v;
    const ring = squareRing(
      Math.max(0.004, options.halfWidth * scaleX),
      Math.max(0.004, options.halfDepth * scaleZ),
      y,
      options.segmentsPerSide,
    );
    const lift = options.upturn * Math.pow(1 - v, 1.5);
    for (const point of ring) {
      point.y += lift * Math.pow(point.cornerWeight, 2.4);
      point.x += offsetX;
      point.z += offsetZ;
    }
    rings.push(ring);
  }
  for (let index = 0; index < rings.length - 1; index += 1) {
    builder.addLoft(rings[index]!, rings[index + 1]!);
  }
  if (options.courses) {
    for (let index = 1; index < rings.length - 1; index += 1) {
      const ring = rings[index]!;
      const lip = ring.map((point) => ({
        x: offsetX + (point.x - offsetX) * 1.045,
        y: point.y + 0.013,
        z: offsetZ + (point.z - offsetZ) * 1.045,
      }));
      builder.addLoft(ring, lip);
    }
  }
  const top = rings[rings.length - 1]!;
  builder.addFanUp({ x: offsetX, y: options.baseY + options.height, z: offsetZ }, top);
  soffit?.addFanDown({ x: offsetX, y: options.baseY - options.eaveDrop, z: offsetZ }, rings[0]!);
}

function roofShellShape(family: RoofFamily): {
  ridgeXRatio: number;
  ridgeZRatio: number;
  segmentsPerSide: number;
  rings: number;
} {
  switch (family) {
    case 'hide-cone':
      return { ridgeXRatio: 0.06, ridgeZRatio: 0.06, segmentsPerSide: 3, rings: 3 };
    case 'thatch-hip':
      return { ridgeXRatio: 0.3, ridgeZRatio: 0.06, segmentsPerSide: 3, rings: 3 };
    case 'tile-hip':
      return { ridgeXRatio: 0.28, ridgeZRatio: 0.05, segmentsPerSide: 4, rings: 4 };
    case 'tile-gable':
      return { ridgeXRatio: 0.98, ridgeZRatio: 0.03, segmentsPerSide: 3, rings: 4 };
    case 'tile-layered':
      return { ridgeXRatio: 0.46, ridgeZRatio: 0.12, segmentsPerSide: 5, rings: 5 };
    case 'stepped-terrace':
      return { ridgeXRatio: 0.66, ridgeZRatio: 0.66, segmentsPerSide: 3, rings: 3 };
    case 'shell-dome':
      return { ridgeXRatio: 0.1, ridgeZRatio: 0.1, segmentsPerSide: 6, rings: 5 };
    case 'canopy-shell':
      return { ridgeXRatio: 0.58, ridgeZRatio: 0.58, segmentsPerSide: 5, rings: 4 };
    case 'lean-slope':
    case 'saw-tooth':
      return { ridgeXRatio: 0.5, ridgeZRatio: 0.5, segmentsPerSide: 2, rings: 2 };
  }
}

function roofSurfaceFor(grammar: BuildingGrammar): SurfaceKey {
  if (grammar.era === 'primitive') return 'hide';
  if (grammar.era === 'early') return 'roof-thatch';
  if (grammar.roofFamily === 'saw-tooth' || grammar.roofFamily === 'canopy-shell') return 'roof-metal';
  return 'roof-tile';
}

function wallSurfaceFor(layer: WallLayer): SurfaceKey {
  return layer;
}

/** Draws a culture motif in the plane of a wall frame; used for finials, tablets and banners. */
function emitMotifIcon(
  builder: GeometryBuilder | undefined,
  motif: MotifFamily,
  center: Vec3,
  size: number,
  frame: WallFrame,
  thickness: number,
): void {
  if (!builder) return;
  const bar = (u0: number, v0: number, u1: number, v1: number, width: number): void => {
    builder.addBeam(
      { x: center.x + frame.tangentX * u0, y: center.y + v0, z: center.z + frame.tangentZ * u0 },
      { x: center.x + frame.tangentX * u1, y: center.y + v1, z: center.z + frame.tangentZ * u1 },
      thickness,
      size * width,
    );
  };
  const s = size;
  switch (motif) {
    case 'sun-step':
      bar(-s, -s * 0.6, s, -s * 0.6, 0.16);
      bar(-s * 0.62, -s * 0.16, s * 0.62, -s * 0.16, 0.16);
      bar(-s * 0.3, s * 0.28, s * 0.3, s * 0.28, 0.16);
      bar(0, -s * 0.6, 0, s * 0.72, 0.16);
      break;
    case 'river-eye':
      for (let index = 0; index < 8; index += 1) {
        const a = (index / 8) * Math.PI * 2;
        const b = ((index + 1) / 8) * Math.PI * 2;
        bar(Math.cos(a) * s, Math.sin(a) * s * 0.62, Math.cos(b) * s, Math.sin(b) * s * 0.62, 0.13);
      }
      break;
    case 'woven-moon':
      for (let index = 0; index < 7; index += 1) {
        const a = 0.5 + (index / 7) * Math.PI * 1.5;
        const b = 0.5 + ((index + 1) / 7) * Math.PI * 1.5;
        bar(Math.cos(a) * s, Math.sin(a) * s, Math.cos(b) * s, Math.sin(b) * s, 0.15);
      }
      break;
    case 'mountain-knot':
      bar(-s, -s * 0.7, 0, s * 0.8, 0.15);
      bar(0, s * 0.8, s, -s * 0.7, 0.15);
      bar(-s * 0.55, -s * 0.7, s * 0.55, -s * 0.7, 0.15);
      break;
    case 'seed-spiral':
      for (let index = 0; index < 9; index += 1) {
        const a = (index / 9) * Math.PI * 2.6;
        const b = ((index + 1) / 9) * Math.PI * 2.6;
        const ra = s * (0.22 + index * 0.09);
        const rb = s * (0.22 + (index + 1) * 0.09);
        bar(Math.cos(a) * ra, Math.sin(a) * ra, Math.cos(b) * rb, Math.sin(b) * rb, 0.12);
      }
      break;
  }
}

/**
 * Wraps a geometric façade band around the body.
 * These bands are the textile/mosaic half of the style — they must read as structural
 * courses in the wall, not stickers, so they are extruded proud of the plaster.
 */
function emitPatternBand(
  builder: GeometryBuilder | undefined,
  pattern: PatternStyle,
  halfWidth: number,
  halfDepth: number,
  y: number,
  bandHeight: number,
  proud: number,
  density: number,
  backing?: GeometryBuilder,
): void {
  if (!builder) return;
  for (const frame of wallFrames(halfWidth, halfDepth)) {
    const isEnd = Math.abs(frame.normalX) > 0.5;
    // A recessed dark course behind the figures makes the band read as carved relief.
    if (backing) {
      const center = framePoint(frame, 0, y, proud * 0.18);
      backing.addBox(center.x, center.y, center.z, isEnd ? proud * 0.3 : frame.length * 0.98, bandHeight * 1.2, isEnd ? frame.length * 0.98 : proud * 0.3);
    }
    const unit = Math.max(bandHeight * 0.85, bandHeight / Math.max(0.35, density));
    const count = Math.max(2, Math.round(frame.length / unit));
    const step = frame.length / count;
    const half = frame.length / 2;
    for (let index = 0; index < count; index += 1) {
      const u = -half + step * (index + 0.5);
      const p = (du: number, dv: number): Vec3 => framePoint(frame, u + du, y + dv, proud * 0.5);
      const w = step * 0.34;
      const h = bandHeight * 0.42;
      switch (pattern) {
        case 'chevron':
          builder.addBeam(p(-step * 0.36, -h), p(0, h), proud, w * 0.5);
          builder.addBeam(p(0, h), p(step * 0.36, -h), proud, w * 0.5);
          break;
        case 'diamond':
          builder.addBeam(p(-step * 0.34, 0), p(0, h), proud, w * 0.42);
          builder.addBeam(p(0, h), p(step * 0.34, 0), proud, w * 0.42);
          builder.addBeam(p(step * 0.34, 0), p(0, -h), proud, w * 0.42);
          builder.addBeam(p(0, -h), p(-step * 0.34, 0), proud, w * 0.42);
          break;
        case 'terrace':
          builder.addBeam(p(-step * 0.38, -h), p(step * 0.38, -h), proud, bandHeight * 0.2);
          builder.addBeam(p(-step * 0.24, 0), p(step * 0.24, 0), proud, bandHeight * 0.2);
          builder.addBeam(p(-step * 0.1, h * 0.9), p(step * 0.1, h * 0.9), proud, bandHeight * 0.2);
          break;
        case 'crossweave':
          if (index % 2 === 0) {
            builder.addBeam(p(0, -h), p(0, h), proud, w * 0.7);
          } else {
            builder.addBeam(p(-step * 0.38, 0), p(step * 0.38, 0), proud, bandHeight * 0.4);
          }
          break;
        case 'wave': {
          const lift = index % 2 === 0 ? h * 0.7 : -h * 0.7;
          builder.addBeam(p(-step * 0.4, -lift), p(0, lift), proud, w * 0.45);
          builder.addBeam(p(0, lift), p(step * 0.4, -lift), proud, w * 0.45);
          break;
        }
      }
    }
  }
}

interface ComposedBuilding {
  group: THREE.Group;
  height: number;
  /** Plan extent of everything emitted, precinct included, not just the walled body. */
  extentX: number;
  extentZ: number;
}

export function composeBuilding(
  grammar: BuildingGrammar,
  palette: MaterialPalette,
  seed: string,
  stage: BuildStage,
): ComposedBuilding {
  const canvas = new BuildingCanvas(stage, grammar.wear, grammar.toneShift);
  // Open institutions and productive land have their own physical silhouette, using the same
  // surface batching and footprint contract as enclosed buildings.
  if (grammar.development?.form === 'gathering' && grammar.development.level === 1 || grammar.development?.form === 'field') {
    canvas.at('ground', BUILD_STAGE.FOUNDATION)?.addBox(0, 0.012, 0, 2.2, 0.024, 1.8);
    const field = grammar.development?.form === 'field';
    for (let i = 0; i < (field ? 7 : 6); i++) {
      if (field) {
        canvas.at('timber', BUILD_STAGE.WALLS)?.addBox(-0.9 + i * 0.28, 0.045, 0, 0.08, 0.065, 1.5);
      } else {
        const angle = i / 6 * Math.PI * 2;
        canvas.at('timber', BUILD_STAGE.FRAME)?.addBox(Math.cos(angle) * 0.65, 0.1, Math.sin(angle) * 0.55, 0.3, 0.2, 0.22, angle);
        if (grammar.development?.need === 'trade') {
          canvas.at('timber', BUILD_STAGE.FRAME)?.addBox(Math.cos(angle) * 0.65, 0.3, Math.sin(angle) * 0.55, 0.04, 0.6, 0.04);
          canvas.at('cloth', BUILD_STAGE.ROOF)?.addBox(Math.cos(angle) * 0.65, 0.6, Math.sin(angle) * 0.55, 0.48, 0.04, 0.4, angle);
        }
      }
    }
    if (field) canvas.at('plaster', BUILD_STAGE.ROOF)?.addBox(0.75, 0.2 * grammar.development!.level, 0.6, 0.45, 0.4 * grammar.development!.level, 0.4);
    const group = canvas.build(palette);
    group.userData['grammarRole'] = grammar.role;
    group.userData['grammarEra'] = grammar.era;
    return { group, height: field ? 0.4 * grammar.development!.level : 0.62, extentX: 2.3, extentZ: 1.9 };
  }
  const random = new SeededRandom(`${seed}:compose`);
  const rank = eraRank(grammar.era);

  const halfWidth = grammar.width / 2;
  const halfDepth = grammar.depth / 2;
  const plinthTop = grammar.plinthHeight;
  const wallTop = plinthTop + grammar.wallHeight * grammar.storeys;
  const wallSurface = wallSurfaceFor(grammar.wallLayer);
  const roofSurface = roofSurfaceFor(grammar);
  const postSurface: SurfaceKey =
    grammar.postStyle === 'stone' ? 'stone' : grammar.postStyle === 'steel' || grammar.postStyle === 'composite' ? 'metal' : 'timber';

  emitGroundworks(canvas, grammar, halfWidth, halfDepth);
  emitFrame(canvas, grammar, halfWidth, halfDepth, plinthTop, wallTop, postSurface);
  emitBody(canvas, grammar, halfWidth, halfDepth, plinthTop, wallTop, wallSurface, postSurface);
  const roofTop = emitRoof(canvas, grammar, halfWidth, halfDepth, wallTop, roofSurface, wallSurface, postSurface, random);
  const crownTop = emitCrown(canvas, grammar, halfWidth, halfDepth, plinthTop, wallTop, roofTop, roofSurface, wallSurface, postSurface);
  emitFrontage(canvas, grammar, halfWidth, halfDepth, plinthTop, wallTop, roofSurface, wallSurface, postSurface);
  emitDetails(canvas, grammar, halfWidth, halfDepth, plinthTop, wallTop, roofTop, postSurface, random);
  emitYardProps(canvas, grammar, halfWidth, halfDepth, random);

  const group = canvas.build(palette);
  group.userData['grammarRole'] = grammar.role;
  group.userData['grammarEra'] = grammar.era;
  const bounds = new THREE.Box3().setFromObject(group);
  // Measured as reach from the origin, not raw span: forecourts and gateways sit on one side
  // only, and the reserved placement footprint is a circle centred on the origin.
  return {
    group,
    height: Math.max(roofTop, crownTop) + (rank >= 4 ? 0.1 : 0),
    extentX: Math.max(grammar.width, Math.abs(bounds.min.x), Math.abs(bounds.max.x) ) * 2,
    extentZ: Math.max(grammar.depth, Math.abs(bounds.min.z), Math.abs(bounds.max.z)) * 2,
  };
}

function emitGroundworks(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
): void {
  const stone = canvas.at('stone', BUILD_STAGE.FOUNDATION);
  const ground = canvas.at('ground', BUILD_STAGE.FOUNDATION);
  // Contact shadow grounds the structure against the blocky terrain — cheap ambient occlusion.
  canvas.at('shadow', BUILD_STAGE.FOUNDATION)?.addBox(0, 0.005, 0, grammar.width * 1.22, 0.008, grammar.depth * 1.22);

  if (grammar.forecourt) {
    ground?.addBox(0, 0.006, halfDepth * 1.5, grammar.width * 1.9, 0.012, grammar.depth * 1.5);
    // Motif paving: a ring of set stones marking the ceremonial approach.
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      stone?.addBox(
        Math.cos(angle) * halfWidth * 0.9,
        0.016,
        halfDepth * 1.5 + Math.sin(angle) * halfDepth * 0.62,
        0.08,
        0.028,
        0.08,
        angle,
      );
    }
  }

  if (grammar.plinthHeight <= 0) {
    // Primitive structures sit on a scraped hearth ring rather than a podium.
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2;
      stone?.addBox(
        Math.cos(angle) * halfWidth * 1.02,
        0.022,
        Math.sin(angle) * halfDepth * 1.02,
        0.07,
        0.044,
        0.07,
        angle,
      );
    }
    return;
  }

  const overhang = -grammar.plinthInset;
  const steps = grammar.role === 'shrine' || grammar.role === 'hall' ? 2 : 1;
  for (let step = 0; step < steps; step += 1) {
    const inset = (steps - 1 - step) * 0.06;
    const height = grammar.plinthHeight / steps;
    stone?.addBox(
      0,
      height * (step + 0.5),
      0,
      grammar.width + overhang + inset * 2,
      height,
      grammar.depth + overhang + inset * 2,
    );
  }

  if (grammar.stairs) {
    const treads = 2 + (grammar.plinthHeight > 0.12 ? 1 : 0);
    for (let index = 0; index < treads; index += 1) {
      const height = grammar.plinthHeight * ((index + 1) / treads);
      stone?.addBox(
        0,
        height * 0.5,
        halfDepth + overhang * 0.5 + (treads - index) * 0.055,
        grammar.width * 0.34,
        height,
        0.055,
      );
    }
  }
}

function emitFrame(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  plinthTop: number,
  wallTop: number,
  postSurface: SurfaceKey,
): void {
  const posts = canvas.at(postSurface, BUILD_STAGE.FRAME);
  const stakes = canvas.at('timber', BUILD_STAGE.FOUNDATION);
  const thickness = grammar.postThickness;

  // Setting-out stakes read as a marked-out plot before framing starts.
  for (const corner of [
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
  ] as const) {
    stakes?.addBox(corner[0], 0.05, corner[1], thickness * 0.6, 0.1, thickness * 0.6);
  }

  if (grammar.roofFamily === 'hide-cone') {
    // Conical shelters are pure pole structures: a lashed tripod plus a ring of rafters.
    const apex = { x: 0, y: plinthTop + grammar.wallHeight + grammar.width * grammar.roofPitch, z: 0 };
    const poles = Math.max(5, grammar.bays * 5);
    for (let index = 0; index < poles; index += 1) {
      const angle = (index / poles) * Math.PI * 2;
      posts?.addBeam(
        { x: Math.cos(angle) * halfWidth, y: 0, z: Math.sin(angle) * halfDepth },
        apex,
        thickness * 0.7,
        thickness * 0.7,
      );
    }
    return;
  }

  if (grammar.roofFamily === 'lean-slope') {
    const back = plinthTop + grammar.wallHeight + grammar.depth * grammar.roofPitch;
    for (const side of [-1, 1]) {
      posts?.addBeam(
        { x: side * halfWidth, y: 0, z: halfDepth },
        { x: side * halfWidth, y: plinthTop + grammar.wallHeight, z: halfDepth },
        thickness,
        thickness,
      );
      posts?.addBeam(
        { x: side * halfWidth, y: 0, z: -halfDepth },
        { x: side * halfWidth, y: back, z: -halfDepth },
        thickness,
        thickness,
      );
    }
    return;
  }

  const bayPositions: number[] = [];
  for (let index = 0; index <= grammar.bays; index += 1) {
    bayPositions.push(-halfWidth + (grammar.width * index) / grammar.bays);
  }

  // Post rhythm on the long elevations, corner posts thickened.
  for (const z of [halfDepth, -halfDepth]) {
    for (const x of bayPositions) {
      const corner = Math.abs(Math.abs(x) - halfWidth) < 1e-6;
      posts?.addBox(x, plinthTop + (wallTop - plinthTop) / 2, z, thickness * (corner ? 1.3 : 1), wallTop - plinthTop, thickness * (corner ? 1.3 : 1));
    }
  }
  const sidePosts = Math.max(1, Math.round(grammar.bays * (grammar.depth / grammar.width)));
  for (const x of [halfWidth, -halfWidth]) {
    for (let index = 1; index < sidePosts; index += 1) {
      const z = -halfDepth + (grammar.depth * index) / sidePosts;
      posts?.addBox(x, plinthTop + (wallTop - plinthTop) / 2, z, thickness, wallTop - plinthTop, thickness);
    }
  }

  // Sill, mid-rail and head beams give the timber-framing rhythm its horizontals.
  const beamLevels = [plinthTop + thickness * 0.6, wallTop - thickness * 0.6];
  if (grammar.storeys > 1) beamLevels.splice(1, 0, plinthTop + grammar.wallHeight);
  for (const y of beamLevels) {
    posts?.addBox(0, y, halfDepth, grammar.width + thickness * 1.4, thickness * 0.85, thickness);
    posts?.addBox(0, y, -halfDepth, grammar.width + thickness * 1.4, thickness * 0.85, thickness);
    posts?.addBox(halfWidth, y, 0, thickness, thickness * 0.85, grammar.depth);
    posts?.addBox(-halfWidth, y, 0, thickness, thickness * 0.85, grammar.depth);
  }

  if (grammar.postStyle === 'steel' || grammar.postStyle === 'composite') {
    // Industrial and later frames brace their bays; the diagonal reads as a truss.
    for (let index = 0; index < grammar.bays; index += 1) {
      const x0 = bayPositions[index]!;
      const x1 = bayPositions[index + 1]!;
      posts?.addBeam(
        { x: x0, y: plinthTop, z: halfDepth },
        { x: x1, y: wallTop, z: halfDepth },
        thickness * 0.5,
        thickness * 0.5,
      );
    }
  }
}

function emitBody(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  plinthTop: number,
  wallTop: number,
  wallSurface: SurfaceKey,
  postSurface: SurfaceKey,
): void {
  const wall = canvas.at(wallSurface, BUILD_STAGE.WALLS);
  const inset = grammar.postThickness * 0.45;
  const bodyHeight = wallTop - plinthTop;
  wall?.addBox(0, plinthTop + bodyHeight / 2, 0, grammar.width - inset, bodyHeight, grammar.depth - inset);

  if (grammar.massing === 'wing') {
    wall?.addBox(halfWidth * 0.72, plinthTop + bodyHeight * 0.36, -halfDepth * 0.95, grammar.width * 0.44, bodyHeight * 0.72, grammar.depth * 0.6);
  } else if (grammar.massing === 'twin') {
    wall?.addBox(-halfWidth * 0.86, plinthTop + bodyHeight * 0.42, halfDepth * 0.5, grammar.width * 0.34, bodyHeight * 0.84, grammar.depth * 0.38);
    wall?.addBox(halfWidth * 0.86, plinthTop + bodyHeight * 0.42, halfDepth * 0.5, grammar.width * 0.34, bodyHeight * 0.84, grammar.depth * 0.38);
  } else if (grammar.massing === 'court') {
    for (const side of [-1, 1]) {
      wall?.addBox(side * halfWidth * 1.02, plinthTop + bodyHeight * 0.3, halfDepth * 1.1, grammar.width * 0.26, bodyHeight * 0.6, grammar.depth * 0.75);
    }
  }

  for (let band = 0; band < grammar.patternBands; band += 1) {
    const t = grammar.patternBands === 1 ? 0.72 : 0.3 + (band / Math.max(1, grammar.patternBands - 1)) * 0.55;
    emitPatternBand(
      canvas.at('motif', BUILD_STAGE.WALLS),
      grammar.pattern,
      halfWidth - inset / 2,
      halfDepth - inset / 2,
      plinthTop + bodyHeight * t,
      Math.min(0.13, bodyHeight * 0.2),
      grammar.postThickness * 0.55,
      grammar.patternDensity,
      canvas.at('shadow', BUILD_STAGE.WALLS),
    );
  }

  emitOpenings(canvas, grammar, halfWidth - inset / 2, halfDepth - inset / 2, plinthTop, wallTop, postSurface);
}

function emitOpenings(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  plinthTop: number,
  wallTop: number,
  postSurface: SurfaceKey,
): void {
  const shadow = canvas.at('shadow', BUILD_STAGE.WALLS);
  const trim = canvas.at(postSurface, BUILD_STAGE.WALLS);
  const glow = canvas.at('glow', BUILD_STAGE.DETAIL);
  const bodyHeight = wallTop - plinthTop;
  const frames = wallFrames(halfWidth, halfDepth);
  const proud = grammar.postThickness * 0.5;

  // Entrance
  const doorWidth = Math.min(grammar.width * 0.3, 0.34);
  const doorHeight = Math.min(bodyHeight * 0.78, 0.6);
  shadow?.addBox(0, plinthTop + doorHeight / 2, halfDepth + proud * 0.4, doorWidth, doorHeight, proud);
  for (const side of [-1, 1]) {
    trim?.addBox(side * doorWidth * 0.58, plinthTop + doorHeight / 2, halfDepth + proud, grammar.postThickness * 0.8, doorHeight, proud * 1.4);
  }
  trim?.addBox(0, plinthTop + doorHeight + grammar.postThickness * 0.5, halfDepth + proud, doorWidth * 1.5, grammar.postThickness, proud * 1.8);
  if (grammar.openings === 'flap') {
    shadow?.addBeam(
      { x: -doorWidth * 0.5, y: plinthTop + doorHeight, z: halfDepth + proud },
      { x: doorWidth * 0.5, y: plinthTop + doorHeight * 0.86, z: halfDepth + proud * 2.6 },
      doorHeight * 0.8,
      proud * 0.4,
    );
  }

  if (grammar.openings === 'flap') return;

  // A hung timber door with a stone threshold; entrances stop reading as black holes.
  const door = canvas.at('timber', BUILD_STAGE.DETAIL);
  door?.addBox(0, plinthTop + doorHeight / 2, halfDepth + proud * 0.55, doorWidth * 0.92, doorHeight * 0.96, proud * 0.5);
  canvas.at('stone', BUILD_STAGE.FOUNDATION)?.addBox(0, 0.025, halfDepth + proud * 2.4, doorWidth * 1.4, 0.05, 0.14);
  if (grammar.ornament > 0.4) {
    canvas.at('motif', BUILD_STAGE.DETAIL)?.addBox(doorWidth * 0.3, plinthTop + doorHeight * 0.48, halfDepth + proud * 0.85, 0.02, 0.02, 0.02);
  }

  const rows = grammar.windowRows;
  const perRow = Math.max(1, grammar.bays - 1);
  const windowWidth = Math.min((grammar.width / (perRow + 1)) * 0.5, 0.2);
  const windowHeight = grammar.openings === 'slit' ? Math.min(bodyHeight * 0.4, 0.26) : Math.min(bodyHeight * 0.3, 0.22);

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex]!;
    const isEnd = frameIndex >= 2;
    const count = isEnd ? Math.max(1, Math.round(perRow * (grammar.depth / grammar.width))) : perRow;
    for (let row = 0; row < rows; row += 1) {
      const y = plinthTop + bodyHeight * ((row + 1) / (rows + 1)) + bodyHeight * 0.08;
      for (let index = 0; index < count; index += 1) {
        const u = -frame.length / 2 + (frame.length * (index + 1)) / (count + 1);
        if (frameIndex === 0 && row === 0 && Math.abs(u) < doorWidth) continue;
        const width = grammar.openings === 'slit' ? windowWidth * 0.4 : windowWidth;
        const opening = framePoint(frame, u, y, proud * 0.4);
        shadow?.addBox(opening.x, opening.y, opening.z, isEnd ? proud : width, windowHeight, isEnd ? width : proud);
        const lit = framePoint(frame, u, y, proud * 0.22);
        glow?.addBox(lit.x, lit.y, lit.z, isEnd ? proud * 0.5 : width * 0.88, windowHeight * 0.88, isEnd ? width * 0.88 : proud * 0.5);

        if (grammar.openings === 'lattice') {
          // Shoji-style grid: two mullions and two transoms across the opening.
          for (const fraction of [-0.24, 0.24]) {
            const bar = framePoint(frame, u + width * fraction, y, proud * 0.9);
            trim?.addBox(bar.x, bar.y, bar.z, isEnd ? proud * 0.6 : width * 0.07, windowHeight, isEnd ? width * 0.07 : proud * 0.6);
          }
          for (const fraction of [-0.26, 0.26]) {
            const bar = framePoint(frame, u, y + windowHeight * fraction, proud * 0.9);
            trim?.addBox(bar.x, bar.y, bar.z, isEnd ? proud * 0.6 : width, windowHeight * 0.07, isEnd ? width : proud * 0.6);
          }
        } else if (grammar.openings === 'shutter') {
          for (const side of [-1, 1]) {
            const shutter = framePoint(frame, u + side * width * 0.72, y, proud * 1.1);
            trim?.addBox(shutter.x, shutter.y, shutter.z, isEnd ? proud * 0.8 : width * 0.5, windowHeight * 1.06, isEnd ? width * 0.5 : proud * 0.8);
          }
        } else if (grammar.openings === 'glazed' || grammar.openings === 'panel') {
          const bar = framePoint(frame, u, y, proud * 0.9);
          trim?.addBox(bar.x, bar.y, bar.z, isEnd ? proud * 0.6 : width * 0.07, windowHeight, isEnd ? width * 0.07 : proud * 0.6);
        }
        // Every opening gets a moulded head — the detail that stops walls reading as boxes.
        const head = framePoint(frame, u, y + windowHeight * 0.62, proud * 1.2);
        trim?.addBox(head.x, head.y, head.z, isEnd ? proud * 1.1 : width * 1.35, grammar.postThickness * 0.45, isEnd ? width * 1.35 : proud * 1.1);
      }
    }
  }
}

function emitRoof(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  wallTop: number,
  roofSurface: SurfaceKey,
  wallSurface: SurfaceKey,
  postSurface: SurfaceKey,
  random: SeededRandom,
): number {
  const roof = canvas.at(roofSurface, BUILD_STAGE.ROOF);
  const soffit = canvas.at('shadow', BUILD_STAGE.ROOF);
  const timber = canvas.at(postSurface, BUILD_STAGE.ROOF);
  const drum = canvas.at(wallSurface, BUILD_STAGE.ROOF);
  const motif = canvas.at('motif', BUILD_STAGE.DETAIL);

  if (!roof) return wallTop;

  if (grammar.roofFamily === 'lean-slope') {
    const front = wallTop;
    const back = wallTop + grammar.depth * grammar.roofPitch;
    roof.addBeam(
      { x: 0, y: front, z: halfDepth * (1 + grammar.eaveOverhang) },
      { x: 0, y: back, z: -halfDepth * (1 + grammar.eaveOverhang) },
      grammar.width * (1 + grammar.eaveOverhang),
      0.03,
    );
    return back;
  }

  if (grammar.roofFamily === 'saw-tooth') {
    // Industrial north-light roof, but the front edge keeps the culture's flared eave band
    // so the workshop still belongs to the same architectural family.
    const teeth = Math.max(2, Math.round(grammar.bays * 0.6));
    const pitchHeight = grammar.depth * grammar.roofPitch;
    const glow = canvas.at('glow', BUILD_STAGE.DETAIL);
    for (let index = 0; index < teeth; index += 1) {
      const z0 = halfDepth - (grammar.depth * index) / teeth;
      const z1 = halfDepth - (grammar.depth * (index + 1)) / teeth;
      roof.addBeam(
        { x: 0, y: wallTop, z: z0 },
        { x: 0, y: wallTop + pitchHeight, z: z1 + (z0 - z1) * 0.25 },
        grammar.width * (1 + grammar.eaveOverhang * 0.4),
        0.028,
      );
      const clerestory = { x: 0, y: wallTop + pitchHeight * 0.5, z: z1 + (z0 - z1) * 0.2 };
      canvas.at('shadow', BUILD_STAGE.ROOF)?.addBox(clerestory.x, clerestory.y, clerestory.z, grammar.width * 0.96, pitchHeight, 0.02);
      glow?.addBox(clerestory.x, clerestory.y, clerestory.z + 0.012, grammar.width * 0.9, pitchHeight * 0.82, 0.012);
    }
    emitRoofShell(roof, soffit, {
      halfWidth,
      halfDepth: halfDepth * 0.14,
      baseY: wallTop,
      height: grammar.depth * 0.1,
      overhang: grammar.eaveOverhang,
      upturn: grammar.eaveUpturn * 0.7,
      concavity: grammar.roofConcavity,
      ridgeXRatio: 0.9,
      ridgeZRatio: 0.3,
      segmentsPerSide: 3,
      rings: 3,
      eaveDrop: grammar.depth * 0.03,
    });
    const top = wallTop + pitchHeight;
    emitStacks(canvas, grammar, halfWidth, halfDepth, top, postSurface);
    return top;
  }

  const shape = roofShellShape(grammar.roofFamily);
  const laidCourses = roofSurface === 'roof-tile' || roofSurface === 'roof-thatch';
  // Weather reaches a roof first; the covering ages ahead of the walls beneath it.
  canvas.stain(roof, 0.14);
  let baseY = wallTop;
  let topY = wallTop;
  for (let tier = 0; tier < grammar.roofTiers; tier += 1) {
    const shrink = Math.pow(0.76, tier);
    const height = grammar.width * grammar.roofPitch * Math.pow(0.86, tier);
    emitRoofShell(roof, tier === 0 ? soffit : undefined, {
      halfWidth: halfWidth * shrink * random.range(0.995, 1.012),
      halfDepth: halfDepth * shrink * random.range(0.995, 1.012),
      baseY,
      height,
      overhang: grammar.eaveOverhang,
      upturn: grammar.eaveUpturn * shrink * random.range(0.9, 1.12),
      concavity: grammar.roofConcavity,
      ridgeXRatio: shape.ridgeXRatio,
      ridgeZRatio: shape.ridgeZRatio,
      segmentsPerSide: shape.segmentsPerSide,
      rings: shape.rings,
      eaveDrop: height * 0.16,
      courses: laidCourses,
    });

    // Rafter tails under the eave: the detail that makes an overhang read as carpentry.
    if (grammar.rafterTails > 0 && tier === 0) {
      const overhangDepth = halfDepth * grammar.eaveOverhang;
      for (const frame of wallFrames(halfWidth * shrink, halfDepth * shrink)) {
        const count = Math.max(2, Math.round((grammar.rafterTails * frame.length) / (grammar.width + grammar.depth)));
        for (let index = 0; index < count; index += 1) {
          const u = -frame.length / 2 + (frame.length * (index + 0.5)) / count;
          const reach = random.range(0.86, 1.0);
          const inner = framePoint(frame, u, baseY - height * 0.05, -grammar.postThickness);
          const outer = framePoint(frame, u, baseY - height * 0.16 - overhangDepth * 0.12, overhangDepth * reach);
          timber?.addBeam(inner, outer, grammar.postThickness * random.range(0.44, 0.58), grammar.postThickness * 0.5);
        }
      }
    }

    if (tier < grammar.roofTiers - 1) {
      const drumHeight = height * 0.44;
      drum?.addBox(0, baseY + height + drumHeight / 2, 0, halfWidth * shrink * 1.42, drumHeight, halfDepth * shrink * 1.42);
      timber?.addBox(0, baseY + height + drumHeight, 0, halfWidth * shrink * 1.5, grammar.postThickness * 0.7, halfDepth * shrink * 1.5);
      baseY += height + drumHeight;
    } else {
      topY = baseY + height;
    }
  }

  // Ridge beam plus motif finials at both ends — the crowning cultural signature.
  const ridgeHalf = halfWidth * Math.pow(0.76, grammar.roofTiers - 1) * shape.ridgeXRatio;
  timber?.addBox(0, topY + grammar.postThickness * 0.5, 0, Math.max(ridgeHalf * 2, grammar.width * 0.16), grammar.postThickness * 1.1, grammar.postThickness * 1.4);
  if (grammar.ridgeFinials) {
    for (const side of [-1, 1]) {
      const size = grammar.postThickness * 2.4 + grammar.ornament * 0.05;
      emitMotifIcon(
        motif,
        grammar.motif,
        { x: side * Math.max(ridgeHalf, grammar.width * 0.08), y: topY + size * 0.9, z: 0 },
        size,
        wallFrames(halfWidth, halfDepth)[0]!,
        grammar.postThickness * 0.6,
      );
    }
  }

  emitStacks(canvas, grammar, halfWidth, halfDepth, topY, postSurface);
  canvas.clean(roof);
  return topY;
}

/** Chimneys and vents. Even a foundry stack is crowned with a miniature flared eave. */
function emitStacks(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  topY: number,
  postSurface: SurfaceKey,
): void {
  const brick = canvas.at(grammar.wallLayer === 'panel' ? 'panel' : 'brick', BUILD_STAGE.ROOF);
  const metal = canvas.at('metal', BUILD_STAGE.ROOF);
  const motif = canvas.at('motif', BUILD_STAGE.DETAIL);
  const trim = canvas.at(postSurface, BUILD_STAGE.ROOF);
  // Flues are the sootiest fabric on any building.
  if (grammar.chimneys > 0) canvas.stain(brick, 0.4);
  if (grammar.vents > 0) canvas.stain(metal, 0.2);

  // A stack cluster crown already carries this building's flues; do not raise them twice.
  const chimneys = grammar.crown === 'stack-cluster' ? 0 : grammar.chimneys;
  for (let index = 0; index < chimneys; index += 1) {
    const x = (-halfWidth * 0.6 + (halfWidth * 1.2 * (index + 0.5)) / Math.max(1, chimneys)) * 1;
    const z = -halfDepth * 0.45;
    const height = grammar.wallHeight * (2.1 + index * 0.35);
    brick?.addBox(x, topY + height / 2, z, 0.09, height, 0.09);
    brick?.addBox(x, topY + height * 0.42, z, 0.115, 0.035, 0.115);
    motif?.addBox(x, topY + height * 0.74, z, 0.108, 0.05, 0.108);
    motif?.addBox(x, topY + height * 0.74, z, 0.128, 0.018, 0.128);
    trim?.addBox(x, topY + height + 0.02, z, 0.16, 0.02, 0.16);
    trim?.addBox(x, topY + height + 0.045, z, 0.11, 0.03, 0.11);
  }

  for (let index = 0; index < grammar.vents; index += 1) {
    const angle = (index / Math.max(1, grammar.vents)) * Math.PI * 2;
    metal?.addBox(Math.cos(angle) * halfWidth * 0.5, topY + 0.07, Math.sin(angle) * halfDepth * 0.5, 0.07, 0.14, 0.07, angle);
    metal?.addBox(Math.cos(angle) * halfWidth * 0.5, topY + 0.15, Math.sin(angle) * halfDepth * 0.5, 0.11, 0.02, 0.11, angle);
  }
  canvas.clean(brick);
  canvas.clean(metal);
}

/**
 * How the building meets the street.
 *
 * Frontage is the identity cue that survives furthest: an open stall line, a columned civic
 * front, a raised loading face and a guarded screen are different silhouettes long before
 * colour, banners or ornament resolve. All of it lands on surfaces the body already uses.
 */
function emitFrontage(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  plinthTop: number,
  wallTop: number,
  roofSurface: SurfaceKey,
  wallSurface: SurfaceKey,
  postSurface: SurfaceKey,
): void {
  if (grammar.frontage === 'none') return;
  const thickness = grammar.postThickness;
  const bodyHeight = wallTop - plinthTop;
  const posts = canvas.at(postSurface, BUILD_STAGE.FRAME);
  const timber = canvas.at('timber', BUILD_STAGE.DETAIL);
  const stone = canvas.at('stone', BUILD_STAGE.FOUNDATION);
  const ground = canvas.at('ground', BUILD_STAGE.FOUNDATION);
  const cloth = canvas.at('cloth', BUILD_STAGE.ROOF);
  const shadow = canvas.at('shadow', BUILD_STAGE.WALLS);
  const roof = canvas.at(roofSurface, BUILD_STAGE.ROOF);
  const wall = canvas.at(wallSurface, BUILD_STAGE.WALLS);

  switch (grammar.frontage) {
    case 'market-stalls': {
      // Open bays under a continuous awning, with a counter in every bay.
      const bays = Math.max(3, Math.min(6, grammar.bays));
      const bayWidth = grammar.width / bays;
      const reach = Math.max(0.16, halfDepth * 0.85);
      const openHeight = bodyHeight * 0.66;
      for (let index = 0; index < bays; index += 1) {
        const x = -halfWidth + bayWidth * (index + 0.5);
        shadow?.addBox(x, plinthTop + openHeight / 2, halfDepth + thickness * 0.35, bayWidth * 0.74, openHeight, thickness * 0.8);
        posts?.addBeam(
          { x, y: 0, z: halfDepth + reach },
          { x, y: plinthTop + bodyHeight * 0.92, z: halfDepth + reach },
          thickness * 0.9,
          thickness * 0.9,
        );
        timber?.addBox(x, plinthTop + bodyHeight * 0.22, halfDepth + reach * 0.42, bayWidth * 0.68, thickness * 1.3, reach * 0.36);
      }
      posts?.addBox(0, plinthTop + bodyHeight * 0.93, halfDepth + reach, grammar.width * 1.04, thickness, thickness);
      cloth?.addBeam(
        { x: 0, y: plinthTop + bodyHeight * 1.04, z: halfDepth + thickness },
        { x: 0, y: plinthTop + bodyHeight * 0.94, z: halfDepth + reach * 1.1 },
        grammar.width * 1.06,
        0.012,
      );
      ground?.addBox(0, 0.006, halfDepth + reach * 0.85, grammar.width * 1.5, 0.012, reach * 1.9);
      break;
    }
    case 'colonnade': {
      const count = Math.max(4, Math.min(9, grammar.bays + 1));
      const z = halfDepth * 1.26;
      const span = grammar.width * 1.02;
      const columnHeight = bodyHeight * 0.96;
      stone?.addBox(0, Math.max(0.012, plinthTop * 0.5), (halfDepth + z) / 2, span * 1.08, Math.max(0.024, plinthTop), Math.max(0.05, z - halfDepth + thickness * 3));
      for (let index = 0; index < count; index += 1) {
        const x = -span / 2 + (span * index) / (count - 1);
        posts?.addBox(x, plinthTop + columnHeight / 2, z, thickness * 1.7, columnHeight, thickness * 1.7);
        posts?.addBox(x, plinthTop + columnHeight, z, thickness * 2.3, thickness * 0.9, thickness * 2.3);
      }
      posts?.addBox(0, plinthTop + columnHeight + thickness * 1.2, z, span * 1.06, thickness * 1.6, thickness * 2.4);
      shadow?.addBox(0, plinthTop + bodyHeight * 0.5, halfDepth + thickness * 0.4, grammar.width * 0.98, bodyHeight * 0.82, thickness * 0.7);
      break;
    }
    case 'portico': {
      // Symmetry, a flight of steps and a pedimented projecting entrance.
      const projection = Math.max(0.14, halfDepth * 0.8);
      const z = halfDepth + projection * 0.55;
      const width = grammar.width * 0.62;
      const columnHeight = bodyHeight * 1.04;
      const treads = 3;
      for (let index = 0; index < treads; index += 1) {
        const height = Math.max(0.024, plinthTop) * ((index + 1) / treads);
        stone?.addBox(0, height * 0.5, halfDepth + projection * 1.04 + (treads - index) * 0.05, width * 1.35, height, 0.05);
      }
      stone?.addBox(0, Math.max(0.012, plinthTop * 0.5), z, width * 1.3, Math.max(0.024, plinthTop), projection * 1.15);
      for (const side of [-1, -0.34, 0.34, 1]) {
        posts?.addBox(side * width * 0.5, plinthTop + columnHeight / 2, z, thickness * 1.9, columnHeight, thickness * 1.9);
        posts?.addBox(side * width * 0.5, plinthTop + columnHeight, z, thickness * 2.6, thickness, thickness * 2.6);
      }
      posts?.addBox(0, plinthTop + columnHeight + thickness * 1.4, z, width * 1.16, thickness * 1.9, projection * 1.2);
      if (roof) {
        emitRoofShell(roof, undefined, {
          halfWidth: width * 0.58,
          halfDepth: projection * 0.6,
          baseY: plinthTop + columnHeight + thickness * 2.4,
          height: width * 0.2,
          overhang: 0.12,
          upturn: grammar.eaveUpturn * 0.8,
          concavity: grammar.roofConcavity,
          ridgeXRatio: 0.9,
          ridgeZRatio: 0.06,
          segmentsPerSide: 3,
          rings: 3,
          eaveDrop: thickness * 0.5,
          centerZ: z,
        });
      }
      break;
    }
    case 'loading-dock': {
      const dockHeight = Math.max(0.05, bodyHeight * 0.28);
      const dockDepth = Math.max(0.12, halfDepth * 0.5);
      stone?.addBox(0, dockHeight / 2, halfDepth + dockDepth / 2, grammar.width * 1.06, dockHeight, dockDepth);
      for (let index = 0; index < 3; index += 1) {
        const height = dockHeight * ((index + 1) / 3);
        stone?.addBox(-halfWidth * 1.04, height / 2, halfDepth + dockDepth * (0.18 + index * 0.3), grammar.width * 0.2, height, dockDepth * 0.3);
      }
      const doors = Math.max(2, Math.min(4, Math.round(grammar.bays / 2)));
      const doorWidth = (grammar.width / doors) * 0.6;
      const doorHeight = bodyHeight * 0.62;
      for (let index = 0; index < doors; index += 1) {
        const x = -halfWidth + (grammar.width * (index + 0.5)) / doors;
        shadow?.addBox(x, dockHeight + doorHeight / 2, halfDepth + thickness * 0.35, doorWidth, doorHeight, thickness * 0.8);
        posts?.addBox(x, dockHeight + doorHeight + thickness * 0.6, halfDepth + thickness * 0.7, doorWidth * 1.16, thickness * 1.1, thickness * 1.2);
      }
      roof?.addBeam(
        { x: 0, y: plinthTop + bodyHeight * 0.96, z: halfDepth },
        { x: 0, y: plinthTop + bodyHeight * 0.86, z: halfDepth + dockDepth * 1.2 },
        grammar.width * 1.04,
        0.02,
      );
      for (const side of [-1, 1]) {
        posts?.addBeam(
          { x: side * halfWidth * 0.92, y: plinthTop + bodyHeight * 0.58, z: halfDepth },
          { x: side * halfWidth * 0.92, y: plinthTop + bodyHeight * 0.9, z: halfDepth + dockDepth * 1.1 },
          thickness * 0.7,
          thickness * 0.7,
        );
      }
      break;
    }
    case 'work-yard': {
      // An open-sided working bay beside the shed: the building is visibly a place of labour.
      const yardCenter = halfWidth * 1.42;
      const yardWidth = grammar.width * 0.72;
      const shedHeight = plinthTop + bodyHeight * 0.72;
      ground?.addBox(yardCenter, 0.006, 0, yardWidth, 0.012, grammar.depth * 1.12);
      for (const z of [-halfDepth * 0.78, halfDepth * 0.78]) {
        posts?.addBeam({ x: halfWidth * 1.78, y: 0, z }, { x: halfWidth * 1.78, y: shedHeight * 0.78, z }, thickness * 0.9, thickness * 0.9);
        posts?.addBeam({ x: halfWidth * 1.04, y: 0, z }, { x: halfWidth * 1.04, y: shedHeight, z }, thickness * 0.9, thickness * 0.9);
      }
      roof?.addBeam(
        { x: halfWidth * 1.02, y: shedHeight + thickness, z: 0 },
        { x: halfWidth * 1.8, y: shedHeight * 0.8, z: 0 },
        grammar.depth * 0.92,
        0.02,
      );
      timber?.addBox(yardCenter, 0.11, halfDepth * 0.2, yardWidth * 0.5, 0.022, 0.12);
      for (const corner of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        timber?.addBox(yardCenter + corner[0] * yardWidth * 0.2, 0.05, halfDepth * 0.2 + corner[1] * 0.045, 0.018, 0.1, 0.018);
      }
      break;
    }
    case 'guard-screen': {
      const screen = wall ?? stone;
      const screenZ = halfDepth * 1.5;
      const screenHeight = Math.max(0.12, bodyHeight * 0.78);
      for (const side of [-1, 1]) {
        screen?.addBox(side * grammar.width * 0.34, plinthTop + screenHeight / 2, screenZ, grammar.width * 0.4, screenHeight, thickness * 3.4);
        screen?.addBox(side * halfWidth * 1.06, plinthTop + screenHeight * 0.66, screenZ, grammar.width * 0.22, screenHeight * 1.32, thickness * 4.2);
      }
      const merlons = 7;
      const span = halfWidth * 2.12;
      for (let index = 0; index < merlons; index += 1) {
        const x = -span / 2 + (span * index) / (merlons - 1);
        if (Math.abs(x) < grammar.width * 0.13) continue;
        screen?.addBox(x, plinthTop + screenHeight + 0.035, screenZ, grammar.width * 0.08, 0.07, thickness * 3.2);
      }
      shadow?.addBox(0, plinthTop + screenHeight * 0.36, screenZ, grammar.width * 0.26, screenHeight * 0.72, thickness * 3.8);
      posts?.addBox(0, plinthTop + screenHeight * 0.78, screenZ, grammar.width * 0.34, thickness * 1.6, thickness * 3.8);
      break;
    }
    case 'ward-pavilion': {
      // A long, low, open arcade with a planted strip in front: orderly and unfortified.
      const z = halfDepth * 1.22;
      const count = Math.max(5, Math.min(10, grammar.bays + 2));
      const span = grammar.width * 1.02;
      const arcadeTop = plinthTop + bodyHeight * 0.8;
      for (let index = 0; index < count; index += 1) {
        const x = -span / 2 + (span * index) / (count - 1);
        posts?.addBeam({ x, y: 0, z }, { x, y: arcadeTop, z }, thickness * 0.7, thickness * 0.7);
      }
      posts?.addBox(0, arcadeTop, z, span * 1.02, thickness * 0.9, thickness * 1.2);
      roof?.addBeam(
        { x: 0, y: plinthTop + bodyHeight * 0.92, z: halfDepth },
        { x: 0, y: arcadeTop + thickness, z: z * 1.04 },
        span * 1.04,
        0.016,
      );
      timber?.addBox(0, Math.max(0.02, plinthTop * 0.6), (halfDepth + z) / 2, span, 0.02, Math.max(0.04, z - halfDepth));
      ground?.addBox(0, 0.006, halfDepth * 1.85, grammar.width * 1.1, 0.012, halfDepth * 0.75);
      break;
    }
  }
}

/**
 * The one large feature that has to survive to the skyline.
 *
 * Every crown is built from the same shells, posts and motifs as the body, so a spire, a
 * watch tower and a cooling mass still read as work of the same civilisation. Returns the
 * height reached, which becomes the structure's height when it exceeds the roof.
 */
function emitCrown(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  plinthTop: number,
  wallTop: number,
  roofTop: number,
  roofSurface: SurfaceKey,
  wallSurface: SurfaceKey,
  postSurface: SurfaceKey,
): number {
  if (grammar.crown === 'none') return roofTop;
  const thickness = grammar.postThickness;
  const unit = Math.min(halfWidth, halfDepth);
  const roof = canvas.at(roofSurface, BUILD_STAGE.ROOF);
  const wall = canvas.at(wallSurface, BUILD_STAGE.ROOF);
  const posts = canvas.at(postSurface, BUILD_STAGE.ROOF);
  const metal = canvas.at('metal', BUILD_STAGE.ROOF);
  const stone = canvas.at('stone', BUILD_STAGE.ROOF);
  const motif = canvas.at('motif', BUILD_STAGE.DETAIL);
  const glow = canvas.at('glow', BUILD_STAGE.DETAIL);
  const shadow = canvas.at('shadow', BUILD_STAGE.ROOF);
  const frontFrame = wallFrames(halfWidth, halfDepth)[0]!;

  switch (grammar.crown) {
    case 'spire': {
      const height = grammar.wallHeight * (1.35 + grammar.ornament * 0.95);
      const shaftHalf = unit * 0.3;
      wall?.addBox(0, roofTop + height * 0.22, 0, shaftHalf * 1.7, height * 0.44, shaftHalf * 1.7);
      let tierBase = roofTop + height * 0.4;
      for (let tier = 0; tier < 3; tier += 1) {
        const shrink = Math.pow(0.66, tier);
        const tierHeight = height * 0.2 * Math.pow(0.86, tier);
        if (roof) {
          emitRoofShell(roof, undefined, {
            halfWidth: shaftHalf * 1.5 * shrink,
            halfDepth: shaftHalf * 1.5 * shrink,
            baseY: tierBase,
            height: tierHeight,
            overhang: 0.28,
            upturn: grammar.eaveUpturn * shrink,
            concavity: grammar.roofConcavity,
            ridgeXRatio: 0.3,
            ridgeZRatio: 0.3,
            segmentsPerSide: 4,
            rings: 3,
            eaveDrop: tierHeight * 0.2,
          });
        }
        tierBase += tierHeight * 0.88;
      }
      const mastTop = tierBase + height * 0.32;
      posts?.addBeam({ x: 0, y: tierBase, z: 0 }, { x: 0, y: mastTop, z: 0 }, thickness * 1.1, thickness * 1.1);
      for (let ring = 0; ring < 3; ring += 1) {
        const size = thickness * (3.2 - ring * 0.7);
        motif?.addBox(0, tierBase + (mastTop - tierBase) * (0.24 + ring * 0.25), 0, size, thickness * 0.5, size);
      }
      emitMotifIcon(motif, grammar.motif, { x: 0, y: mastTop + thickness * 2, z: 0 }, thickness * 2.4, frontFrame, thickness * 0.6);
      return mastTop + thickness * 3.4;
    }
    case 'obelisk': {
      const height = grammar.wallHeight * (1.6 + grammar.ornament);
      const segments = 5;
      for (let index = 0; index < segments; index += 1) {
        const taper = index / segments;
        const size = unit * (0.66 - taper * 0.42);
        stone?.addBox(0, roofTop + (height * (index + 0.5)) / segments, 0, size, height / segments, size);
      }
      motif?.addBox(0, roofTop + height + thickness, 0, unit * 0.2, thickness * 2.4, unit * 0.2);
      emitMotifIcon(motif, grammar.motif, { x: 0, y: roofTop + height * 0.6, z: unit * 0.2 }, thickness * 2, frontFrame, thickness * 0.5);
      return roofTop + height + thickness * 3;
    }
    case 'lantern-cupola': {
      const drumHeight = grammar.wallHeight * 0.5;
      const radius = unit * 0.34;
      wall?.addBox(0, roofTop + drumHeight * 0.5, 0, radius * 2, drumHeight, radius * 2);
      for (const side of [-1, 1]) {
        glow?.addBox(side * radius * 0.99, roofTop + drumHeight * 0.55, 0, 0.006, drumHeight * 0.55, radius * 1.1);
        glow?.addBox(0, roofTop + drumHeight * 0.55, side * radius * 0.99, radius * 1.1, drumHeight * 0.55, 0.006);
      }
      posts?.addBox(0, roofTop + drumHeight + thickness * 0.4, 0, radius * 2.3, thickness * 0.8, radius * 2.3);
      if (roof) {
        emitRoofShell(roof, undefined, {
          halfWidth: radius * 1.2,
          halfDepth: radius * 1.2,
          baseY: roofTop + drumHeight + thickness * 0.8,
          height: drumHeight * 0.7,
          overhang: 0.24,
          upturn: grammar.eaveUpturn,
          concavity: grammar.roofConcavity,
          ridgeXRatio: 0.16,
          ridgeZRatio: 0.16,
          segmentsPerSide: 4,
          rings: 3,
          eaveDrop: thickness,
        });
      }
      const top = roofTop + drumHeight * 1.7 + thickness;
      emitMotifIcon(motif, grammar.motif, { x: 0, y: top + thickness * 1.6, z: 0 }, thickness * 1.8, frontFrame, thickness * 0.5);
      return top + thickness * 2.6;
    }
    case 'watch-tower': {
      const towerHalf = unit * 0.5;
      const towerTop = wallTop + grammar.wallHeight * 1.9;
      const cx = -halfWidth * 0.7;
      const cz = -halfDepth * 0.6;
      wall?.addBox(cx, plinthTop + (towerTop - plinthTop) / 2, cz, towerHalf * 2, towerTop - plinthTop, towerHalf * 2);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          posts?.addBeam(
            { x: cx + sx * towerHalf, y: plinthTop, z: cz + sz * towerHalf },
            { x: cx + sx * towerHalf, y: towerTop + thickness * 2, z: cz + sz * towerHalf },
            thickness * 0.9,
            thickness * 0.9,
          );
        }
      }
      posts?.addBox(cx, towerTop + thickness, cz, towerHalf * 2.5, thickness * 1.2, towerHalf * 2.5);
      for (const frame of wallFrames(towerHalf * 1.16, towerHalf * 1.16)) {
        for (let index = 0; index < 3; index += 1) {
          const u = -frame.length / 2 + (frame.length * (index + 0.5)) / 3;
          const point = framePoint(frame, u, towerTop + thickness * 2.6, 0);
          wall?.addBox(cx + point.x, point.y, cz + point.z, thickness * 2, thickness * 2.4, thickness * 2);
        }
      }
      glow?.addBox(cx, towerTop - grammar.wallHeight * 0.42, cz + towerHalf * 1.02, towerHalf * 0.7, grammar.wallHeight * 0.24, 0.006);
      return towerTop + thickness * 4;
    }
    case 'observatory': {
      const radius = unit * 0.52;
      const drumHeight = grammar.wallHeight * 0.46;
      wall?.addBox(0, roofTop + drumHeight * 0.5, 0, radius * 2, drumHeight, radius * 2);
      posts?.addBox(0, roofTop + drumHeight + thickness * 0.3, 0, radius * 2.25, thickness * 0.7, radius * 2.25);
      if (roof) {
        emitRoofShell(roof, undefined, {
          halfWidth: radius * 1.06,
          halfDepth: radius * 1.06,
          baseY: roofTop + drumHeight + thickness * 0.7,
          height: radius,
          overhang: 0.02,
          upturn: 0,
          concavity: -0.55,
          ridgeXRatio: 0.12,
          ridgeZRatio: 0.12,
          segmentsPerSide: 6,
          rings: 4,
          eaveDrop: 0,
        });
      }
      shadow?.addBox(0, roofTop + drumHeight + radius * 0.6, 0, radius * 0.22, radius * 1.05, radius * 2.1);
      return roofTop + drumHeight + radius * 1.05 + thickness;
    }
    case 'stack-cluster': {
      const brick = canvas.at(grammar.wallLayer === 'panel' ? 'panel' : 'brick', BUILD_STAGE.ROOF);
      canvas.stain(brick, 0.55);
      const stacks = Math.max(2, Math.min(4, grammar.chimneys + 1));
      let top = roofTop;
      for (let index = 0; index < stacks; index += 1) {
        const height = grammar.wallHeight * (2.4 - index * 0.45);
        const size = unit * (0.26 - index * 0.03);
        const x = -halfWidth * 0.5 + (halfWidth * index) / (stacks - 1);
        const z = -halfDepth * 0.42;
        brick?.addBox(x, roofTop + height / 2, z, size, height, size);
        for (let band = 0; band < 3; band += 1) {
          brick?.addBox(x, roofTop + height * (0.3 + band * 0.22), z, size * 1.22, height * 0.03, size * 1.22);
        }
        metal?.addBox(x, roofTop + height + 0.015, z, size * 1.4, 0.03, size * 1.4);
        top = Math.max(top, roofTop + height + 0.05);
      }
      canvas.clean(brick);
      metal?.addBox(0, roofTop + grammar.wallHeight * 0.28, -halfDepth * 0.42, halfWidth * 1.15, unit * 0.14, unit * 0.14);
      return top;
    }
    case 'cooling-mass': {
      const radius = unit * 0.42;
      const height = grammar.wallHeight * 2;
      for (const side of [-1, 1]) {
        const cx = side * halfWidth * 0.52;
        const cz = -halfDepth * 0.3;
        if (metal) {
          emitRoofShell(metal, undefined, {
            halfWidth: radius,
            halfDepth: radius,
            baseY: roofTop,
            height,
            overhang: 0,
            upturn: 0,
            concavity: 0.9,
            ridgeXRatio: 0.72,
            ridgeZRatio: 0.72,
            segmentsPerSide: 5,
            rings: 4,
            eaveDrop: 0,
            centerX: cx,
            centerZ: cz,
          });
        }
        metal?.addBox(cx, roofTop + height + 0.02, cz, radius * 1.55, 0.035, radius * 1.55);
        glow?.addBox(cx, roofTop + height * 0.93, cz, radius * 1.18, height * 0.05, radius * 1.18);
      }
      return roofTop + height + 0.06;
    }
    case 'water-tank': {
      const radius = unit * 0.46;
      const legHeight = grammar.wallHeight * 1.1;
      const tankHeight = grammar.wallHeight * 0.9;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          posts?.addBeam(
            { x: sx * radius * 0.82, y: roofTop, z: sz * radius * 0.82 },
            { x: sx * radius * 0.56, y: roofTop + legHeight, z: sz * radius * 0.56 },
            thickness * 0.9,
            thickness * 0.9,
          );
        }
        posts?.addBeam(
          { x: sx * radius * 0.82, y: roofTop, z: -radius * 0.82 },
          { x: sx * radius * 0.56, y: roofTop + legHeight, z: radius * 0.56 },
          thickness * 0.4,
          thickness * 0.4,
        );
      }
      if (metal) {
        emitRoofShell(metal, undefined, {
          halfWidth: radius,
          halfDepth: radius,
          baseY: roofTop + legHeight,
          height: tankHeight,
          overhang: 0,
          upturn: 0,
          concavity: 0,
          ridgeXRatio: 0.94,
          ridgeZRatio: 0.94,
          segmentsPerSide: 6,
          rings: 2,
          eaveDrop: 0,
        });
      }
      metal?.addBox(0, roofTop + legHeight + tankHeight * 0.55, 0, radius * 2.06, tankHeight * 0.07, radius * 2.06);
      metal?.addBox(0, roofTop + legHeight + tankHeight + 0.02, 0, radius * 1.5, 0.03, radius * 1.5);
      return roofTop + legHeight + tankHeight + 0.06;
    }
    case 'roof-monitor': {
      const monitorHeight = grammar.wallHeight * 0.44;
      const halfLength = halfWidth * 0.82;
      const halfSpan = Math.max(0.03, halfDepth * 0.2);
      wall?.addBox(0, roofTop + monitorHeight * 0.5, 0, halfLength * 2, monitorHeight, halfSpan * 2);
      for (const side of [-1, 1]) {
        for (let index = 0; index < 4; index += 1) {
          metal?.addBox(0, roofTop + monitorHeight * (0.24 + index * 0.17), side * halfSpan * 1.06, halfLength * 1.94, monitorHeight * 0.1, 0.008);
        }
        glow?.addBox(0, roofTop + monitorHeight * 0.6, side * halfSpan * 1.02, halfLength * 1.9, monitorHeight * 0.42, 0.006);
      }
      if (roof) {
        emitRoofShell(roof, undefined, {
          halfWidth: halfLength * 1.08,
          halfDepth: halfSpan * 1.5,
          baseY: roofTop + monitorHeight,
          height: monitorHeight * 0.5,
          overhang: 0.16,
          upturn: grammar.eaveUpturn * 0.5,
          concavity: grammar.roofConcavity,
          ridgeXRatio: 0.92,
          ridgeZRatio: 0.14,
          segmentsPerSide: 3,
          rings: 3,
          eaveDrop: monitorHeight * 0.08,
        });
      }
      return roofTop + monitorHeight * 1.6;
    }
  }
}

/**
 * Small deterministic exterior props.
 *
 * These never change massing; they are the evidence of daily use that tells you what the
 * building is for once you are close enough to see a woodpile or an ore heap. Everything reuses
 * surfaces the building already draws, so props cost triangles rather than draw calls.
 */
function emitYardProps(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  random: SeededRandom,
): void {
  if (grammar.props === 'none') return;
  const timber = canvas.at('timber', BUILD_STAGE.DETAIL);
  const stone = canvas.at('stone', BUILD_STAGE.DETAIL);
  const motif = canvas.at('motif', BUILD_STAGE.DETAIL);
  const glow = canvas.at('glow', BUILD_STAGE.DETAIL);
  const shadow = canvas.at('shadow', BUILD_STAGE.DETAIL);
  const service = -halfWidth * 1.3;
  const jitter = (amount: number): number => random.range(-amount, amount);

  switch (grammar.props) {
    case 'domestic': {
      // Split firewood, stacked and re-stacked, plus a scrappy yard fence.
      canvas.stain(timber, 0.16);
      for (let row = 0; row < 3; row += 1) {
        for (let log = 0; log < 4; log += 1) {
          timber?.addBox(
            service + jitter(0.007),
            0.022 + row * 0.034,
            -halfDepth * 0.28 + log * 0.038,
            0.17,
            0.032,
            0.032,
            jitter(0.06),
          );
        }
      }
      canvas.clean(timber);
      for (const end of [-0.036, 4 * 0.038]) {
        timber?.addBox(service, 0.062, -halfDepth * 0.28 + end, 0.026, 0.124, 0.026);
      }
      for (let index = 0; index < 5; index += 1) {
        const z = halfDepth * (0.3 + index * 0.34);
        timber?.addBox(-halfWidth * 1.12, 0.05 * random.range(0.88, 1.16), z, 0.02, 0.1, 0.02);
        if (index > 0) timber?.addBox(-halfWidth * 1.12, 0.072, z - halfDepth * 0.17, 0.012, 0.012, halfDepth * 0.34);
      }
      break;
    }
    case 'market': {
      for (let index = 0; index < 5; index += 1) {
        const size = 0.055 + (index % 2) * 0.016;
        timber?.addBox(
          service + jitter(0.022),
          size / 2 + (index > 2 ? 0.056 : 0),
          halfDepth * (0.35 + index * 0.26),
          size,
          size,
          size,
          jitter(0.34),
        );
      }
      for (const side of [-1, 1]) {
        timber?.addBox(side * halfWidth * 0.62, 0.045, halfDepth * 1.55, 0.07, 0.09, 0.07, jitter(0.2));
        timber?.addBox(side * halfWidth * 0.62, 0.092, halfDepth * 1.55, 0.078, 0.008, 0.078);
      }
      break;
    }
    case 'workshop': {
      canvas.stain(timber, 0.2);
      for (let row = 0; row < 3; row += 1) {
        timber?.addBox(service + jitter(0.01), 0.028 + row * 0.05, -halfDepth * 0.1, 0.05, 0.048, halfDepth * 0.9, jitter(0.03));
      }
      timber?.addBox(service * 0.82, 0.085, halfDepth * 0.72, 0.14, 0.02, 0.05);
      for (const side of [-1, 1]) {
        timber?.addBeam(
          { x: service * 0.82 + side * 0.05, y: 0, z: halfDepth * 0.72 },
          { x: service * 0.82, y: 0.085, z: halfDepth * 0.72 },
          0.016,
          0.016,
        );
      }
      canvas.clean(timber);
      break;
    }
    case 'foundry': {
      // Ore in, slag out: the two heaps that always flank a furnace.
      canvas.stain(stone, 0.5);
      for (let index = 0; index < 3; index += 1) {
        const size = 0.2 - index * 0.055;
        stone?.addBox(service, 0.018 + index * 0.036, -halfDepth * 0.5, size, 0.038, size, jitter(0.4));
      }
      canvas.clean(stone);
      canvas.stain(shadow, 0.8);
      for (let index = 0; index < 2; index += 1) {
        const size = 0.17 - index * 0.06;
        shadow?.addBox(service * 0.92, 0.016 + index * 0.032, halfDepth * 0.55, size, 0.034, size, jitter(0.5));
      }
      canvas.clean(shadow);
      glow?.addBox(service * 0.92, 0.05, halfDepth * 0.55, 0.05, 0.012, 0.05);
      break;
    }
    case 'storage': {
      for (let index = 0; index < 4; index += 1) {
        timber?.addBox(service + jitter(0.014), 0.042, -halfDepth * 0.4 + index * 0.1, 0.07, 0.084, 0.07, jitter(0.3));
        timber?.addBox(service + jitter(0.014), 0.062, -halfDepth * 0.4 + index * 0.1, 0.078, 0.008, 0.078);
      }
      for (let index = 0; index < 3; index += 1) {
        timber?.addBox(service * 0.85, 0.03 + index * 0.058, halfDepth * 0.6, 0.056, 0.056, 0.056, jitter(0.25));
      }
      timber?.addBox(service * 0.7, 0.012, halfDepth * 1.05, 0.3, 0.024, 0.2);
      break;
    }
    case 'herb-garden': {
      const garden = canvas.at('garden', BUILD_STAGE.DETAIL);
      for (let bed = 0; bed < 3; bed += 1) {
        const z = -halfDepth * 0.5 + bed * halfDepth * 0.62;
        timber?.addBox(service, 0.024, z, 0.26, 0.048, 0.16);
        garden?.addBox(service, 0.056, z, 0.23, 0.026, 0.13);
        for (let plant = 0; plant < 3; plant += 1) {
          garden?.addBox(service - 0.075 + plant * 0.075 + jitter(0.008), 0.082, z + jitter(0.02), 0.045, 0.05, 0.045, jitter(0.5));
        }
      }
      for (let index = 0; index < 4; index += 1) {
        garden?.addBox(-halfWidth * 0.4 + index * halfWidth * 0.28, 0.032, halfDepth * 1.9, 0.1, 0.064, 0.08, jitter(0.3));
      }
      break;
    }
    case 'altar': {
      stone?.addBox(0, 0.042, halfDepth * 1.78, 0.24, 0.084, 0.14);
      stone?.addBox(0, 0.094, halfDepth * 1.78, 0.28, 0.02, 0.17);
      motif?.addBox(0, 0.112, halfDepth * 1.78, 0.09, 0.018, 0.09);
      canvas.at('forge', BUILD_STAGE.DETAIL)?.addBox(0, 0.126, halfDepth * 1.78, 0.05, 0.024, 0.05);
      for (const side of [-1, 1]) {
        stone?.addBox(side * halfWidth * 0.95, 0.09, halfDepth * 1.5, 0.05, 0.18, 0.05);
        motif?.addBox(side * halfWidth * 0.95, 0.19, halfDepth * 1.5, 0.066, 0.016, 0.066);
      }
      break;
    }
    case 'defensive': {
      for (let index = 0; index < 7; index += 1) {
        const u = -halfWidth * 1.1 + (halfWidth * 2.2 * index) / 6;
        timber?.addBeam(
          { x: u, y: 0, z: halfDepth * 1.85 },
          { x: u + jitter(0.01), y: 0.14 * random.range(0.85, 1.15), z: halfDepth * 1.62 },
          0.022,
          0.022,
        );
      }
      for (const side of [-1, 1]) {
        timber?.addBox(side * halfWidth * 0.72, 0.075, halfDepth * 1.72, 0.03, 0.15, 0.03);
        timber?.addBox(side * halfWidth * 0.72, 0.11, halfDepth * 1.72, 0.03, 0.016, 0.14);
      }
      stone?.addBox(service, 0.05, halfDepth * 0.4, 0.09, 0.1, 0.09);
      glow?.addBox(service, 0.108, halfDepth * 0.4, 0.06, 0.03, 0.06);
      break;
    }
    case 'civic': {
      for (let index = 0; index < 3; index += 1) {
        const x = -halfWidth * 0.7 + index * halfWidth * 0.7;
        const height = 0.2 + (index === 1 ? 0.06 : 0);
        stone?.addBox(x, height / 2, halfDepth * 1.72, 0.06, height, 0.05);
        motif?.addBox(x, height + 0.012, halfDepth * 1.72, 0.078, 0.022, 0.066);
      }
      for (const side of [-1, 1]) {
        stone?.addBox(side * halfWidth * 1.12, 0.045, halfDepth * 1.2, 0.05, 0.09, 0.05);
      }
      break;
    }
    case 'utility': {
      const metal = canvas.at('metal', BUILD_STAGE.DETAIL);
      canvas.stain(metal, 0.25);
      metal?.addBeam(
        { x: service, y: 0.06, z: -halfDepth * 0.8 },
        { x: service, y: 0.06, z: halfDepth * 0.8 },
        0.05,
        0.05,
      );
      for (let index = 0; index < 3; index += 1) {
        const z = -halfDepth * 0.6 + index * halfDepth * 0.6;
        metal?.addBox(service, 0.024, z, 0.07, 0.048, 0.07);
        metal?.addBox(service + 0.045, 0.085, z, 0.055, 0.012, 0.012, jitter(0.4));
      }
      metal?.addBox(service * 0.78, 0.09, halfDepth * 1.15, 0.16, 0.18, 0.16);
      metal?.addBox(service * 0.78, 0.185, halfDepth * 1.15, 0.18, 0.016, 0.18);
      canvas.clean(metal);
      break;
    }
  }
}

function emitDetails(
  canvas: BuildingCanvas,
  grammar: BuildingGrammar,
  halfWidth: number,
  halfDepth: number,
  plinthTop: number,
  wallTop: number,
  roofTop: number,
  postSurface: SurfaceKey,
  random: SeededRandom,
): void {
  const timber = canvas.at(postSurface, BUILD_STAGE.DETAIL);
  const deck = canvas.at('timber', BUILD_STAGE.DETAIL);
  const motif = canvas.at('motif', BUILD_STAGE.DETAIL);
  const cloth = canvas.at('cloth', BUILD_STAGE.DETAIL);
  const glow = canvas.at('glow', BUILD_STAGE.DETAIL);
  const stone = canvas.at('stone', BUILD_STAGE.DETAIL);
  const forge = canvas.at('forge', BUILD_STAGE.DETAIL);
  const thickness = grammar.postThickness;

  // Veranda / engawa
  if (grammar.veranda !== 'none') {
    const depth = Math.min(0.17, grammar.depth * 0.2);
    const sides: WallFrame[] = grammar.veranda === 'wrap'
      ? wallFrames(halfWidth, halfDepth)
      : [wallFrames(halfWidth, halfDepth)[0]!];
    for (const frame of sides) {
      const centre = framePoint(frame, 0, plinthTop - 0.012, depth / 2);
      const along = frame.length + (grammar.veranda === 'wrap' ? depth * 2 : 0);
      const isEnd = Math.abs(frame.normalX) > 0.5;
      deck?.addBox(centre.x, centre.y, centre.z, isEnd ? depth : along, 0.024, isEnd ? along : depth);
      const posts = Math.max(2, Math.round(along / 0.3));
      for (let index = 0; index <= posts; index += 1) {
        const u = -frame.length / 2 + (frame.length * index) / posts;
        const foot = framePoint(frame, u, 0, depth * 0.86);
        deck?.addBox(foot.x, plinthTop / 2, foot.z, thickness * 0.6, plinthTop + 0.02, thickness * 0.6);
        if (grammar.railing) {
          deck?.addBox(foot.x, plinthTop + 0.05, foot.z, thickness * 0.5, 0.1, thickness * 0.5);
        }
      }
      if (grammar.railing) {
        const rail = framePoint(frame, 0, plinthTop + 0.1, depth * 0.86);
        deck?.addBox(rail.x, rail.y, rail.z, isEnd ? thickness : frame.length, thickness * 0.7, isEnd ? frame.length : thickness);
      }
      // Veranda posts rising to the eave: the deep-shadow colonnade of the front elevation.
      if (grammar.ornament > 0.35) {
        for (const side of [-1, 1]) {
          const post = framePoint(frame, (side * frame.length) / 2.4, 0, depth * 0.8);
          timber?.addBeam({ x: post.x, y: plinthTop, z: post.z }, { x: post.x, y: wallTop, z: post.z }, thickness * 0.8, thickness * 0.8);
        }
      }
    }
  }

  // Corner brackets under the eaves.
  if (grammar.ornament > 0.3 && grammar.roofFamily !== 'hide-cone' && grammar.roofFamily !== 'lean-slope') {
    for (const corner of [
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
    ] as const) {
      timber?.addBeam(
        { x: corner[0] * 0.86, y: wallTop - grammar.wallHeight * 0.28, z: corner[1] * 0.86 },
        { x: corner[0] * 1.16, y: wallTop + thickness, z: corner[1] * 1.16 },
        thickness * 0.7,
        thickness * 0.7,
      );
    }
  }

  // Ceremonial gateway derived from a torii: two posts, a straight nuki and a flared kasagi.
  if (grammar.gateway) {
    const gateZ = halfDepth * (grammar.forecourt ? 2.5 : 1.75);
    const gateHeight = wallTop * 1.02;
    const gateHalf = halfWidth * 0.86;
    for (const side of [-1, 1]) {
      timber?.addBox(side * gateHalf, gateHeight / 2, gateZ, thickness * 1.5, gateHeight, thickness * 1.5);
    }
    timber?.addBox(0, gateHeight * 0.74, gateZ, gateHalf * 2.1, thickness * 1.1, thickness * 1.2);
    if (motif) {
      emitRoofShell(motif, undefined, {
        halfWidth: gateHalf * 1.16,
        halfDepth: thickness * 1.6,
        baseY: gateHeight,
        height: thickness * 2.2,
        overhang: 0.14,
        upturn: grammar.eaveUpturn * 1.3,
        concavity: grammar.roofConcavity,
        ridgeXRatio: 0.92,
        ridgeZRatio: 0.3,
        segmentsPerSide: 4,
        rings: 3,
        eaveDrop: thickness * 0.6,
      });
    }
    emitMotifIcon(motif, grammar.motif, { x: 0, y: gateHeight * 0.86, z: gateZ + thickness }, thickness * 2.2, wallFrames(halfWidth, halfDepth)[0]!, thickness * 0.5);
  }

  // Banner
  if (grammar.banner !== 'none') {
    const height = grammar.banner === 'standard' ? roofTop * 0.95 : wallTop * 1.15;
    const x = -halfWidth * 1.25;
    const z = halfDepth * 0.7;
    timber?.addBox(x, height / 2, z, thickness * 0.7, height, thickness * 0.7);
    const clothHeight = grammar.banner === 'pennant' ? height * 0.28 : height * 0.5;
    const clothWidth = grammar.banner === 'pennant' ? 0.07 : 0.13;
    cloth?.addBox(x + clothWidth * 0.6, height - clothHeight * 0.6, z, clothWidth, clothHeight, 0.008);
    if (grammar.banner !== 'pennant') {
      emitMotifIcon(
        motif,
        grammar.motif,
        { x: x + clothWidth * 0.6, y: height - clothHeight * 0.6, z: z + 0.008 },
        clothWidth * 0.34,
        wallFrames(halfWidth, halfDepth)[0]!,
        0.006,
      );
    }
  }

  // Lanterns
  for (let index = 0; index < grammar.lanterns; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const along = 0.4 + Math.floor(index / 2) * 0.42;
    const x = side * halfWidth * 0.94;
    const z = halfDepth * (1 + along * 0.5);
    if (grammar.ornament > 0.45) {
      stone?.addBox(x, 0.045, z, 0.055, 0.09, 0.055);
      stone?.addBox(x, 0.16, z, 0.03, 0.14, 0.03);
      glow?.addBox(x, 0.25, z, 0.062, 0.062, 0.062);
      stone?.addBox(x, 0.295, z, 0.085, 0.016, 0.085);
    } else {
      timber?.addBeam({ x, y: wallTop + 0.02, z: halfDepth * 0.98 }, { x, y: wallTop - 0.07, z: halfDepth * 0.98 }, 0.008, 0.008);
      glow?.addBox(x, wallTop - 0.11, halfDepth * 0.98, 0.05, 0.07, 0.05);
    }
  }

  // Forge / reactor heat
  if (grammar.forgeGlow > 0) {
    forge?.addBox(halfWidth * 0.5, plinthTop + grammar.wallHeight * 0.32, halfDepth * 1.01, 0.13 * grammar.forgeGlow + 0.05, 0.11, 0.02);
    if (grammar.forgeGlow > 0.7) {
      forge?.addBox(0, roofTop * 0.5, 0, halfWidth * 0.3, roofTop * 0.06, halfDepth * 0.3);
    }
  }

  // Enclosure
  if (grammar.enclosure !== 'none') {
    const radiusX = halfWidth * (grammar.enclosure === 'court' ? 2.05 : 1.8);
    const radiusZ = halfDepth * (grammar.enclosure === 'court' ? 2.05 : 1.8);
    const wallHeight = grammar.enclosure === 'court' ? 0.2 : grammar.enclosure === 'yard' ? 0.12 : 0.16;
    const surface = canvas.at(grammar.enclosure === 'stakes' ? 'timber' : 'stone', BUILD_STAGE.DETAIL);
    const posts = grammar.enclosure === 'stakes' ? 14 : 22;
    for (let index = 0; index < posts; index += 1) {
      const angleT = index / posts;
      if (angleT > 0.42 && angleT < 0.58) continue; // entrance gap toward +Z
      const angle = angleT * Math.PI * 2 + Math.PI * 0.25;
      const x = Math.cos(angle) * radiusX;
      const z = Math.sin(angle) * radiusZ;
      if (grammar.enclosure === 'stakes') {
        surface?.addBeam({ x, y: 0, z }, { x: x * 1.04, y: wallHeight * random.range(0.8, 1.25), z: z * 1.04 }, 0.018, 0.018);
      } else {
        surface?.addBox(x, wallHeight / 2, z, 0.09, wallHeight, 0.09, angle);
      }
    }
    if (grammar.enclosure === 'court') {
      emitPatternBand(motif, grammar.pattern, radiusX, radiusZ, wallHeight * 0.98, 0.045, 0.014, grammar.patternDensity * 0.7);
    }
  }
}
