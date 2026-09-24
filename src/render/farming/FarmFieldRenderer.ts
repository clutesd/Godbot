import * as THREE from 'three';
import { farmGeometries, farmGeometry, farmPoint, type FarmGeometry } from '../../shared/FarmGeometry';
import type { SimulationState } from '../../sim/types';
import { farmPresentationState, type FarmPresentationState, type FarmStage } from './FarmActionPresentation';
import { resourceVisualUnit } from '../../sim/resources/ResourceWorkPresentation';
import { farmSackGeometry, farmSheafGeometry } from './FarmMaterialGeometry';

const MAX_FIELDS = 64;
const ROWS = 4;
const COLUMNS = 6;
const PLANTS_PER_CLUMP = 3;
const MAX_PLANTS = MAX_FIELDS * ROWS * COLUMNS * PLANTS_PER_CLUMP;
const SOIL_SEGMENTS_X = 10;
const SOIL_SEGMENTS_Z = 8;
const RIBBON_SEGMENTS = 10;
const SOIL_LIFT = 0.0055;
const MAX_HARVEST_PROPS = MAX_FIELDS * 8;
const MAX_LEAVES = MAX_PLANTS * 2;
const MAX_FIELD_MARKERS = MAX_FIELDS * 4;

interface FarmPalette {
  soil: string;
  ridge: string;
  crop: string;
  leaf: string;
  head: string;
  wet: string;
  border: string;
}

const PALETTES: Record<FarmStage, FarmPalette> = {
  dormant: { soil: '#5b4938', ridge: '#725942', crop: '#73805a', leaf: '#73805a', head: '#9b8856', wet: '#3f584e', border: '#6f5a42' },
  prepared: { soil: '#4f3829', ridge: '#6a4b35', crop: '#73805a', leaf: '#73805a', head: '#9b8856', wet: '#334d46', border: '#745a3d' },
  planted: { soil: '#513a2b', ridge: '#6d4e37', crop: '#7c9a52', leaf: '#7c9a52', head: '#9b9a5a', wet: '#34564c', border: '#765b3e' },
  young: { soil: '#57412f', ridge: '#6f533b', crop: '#789c4c', leaf: '#789c4c', head: '#a4a25c', wet: '#36594f', border: '#785d40' },
  growing: { soil: '#5b4532', ridge: '#73583d', crop: '#6f9846', leaf: '#6f9846', head: '#afaa5f', wet: '#365b50', border: '#7b6042' },
  mature: { soil: '#614a34', ridge: '#775d41', crop: '#82994d', leaf: '#82994d', head: '#c6aa5d', wet: '#3a5c50', border: '#7e6244' },
  harvest: { soil: '#66503a', ridge: '#7a6044', crop: '#a59a4e', leaf: '#a59a4e', head: '#d0af5c', wet: '#3b5a4f', border: '#806347' },
  stubble: { soil: '#6b563f', ridge: '#80664a', crop: '#9a7b49', leaf: '#9a7b49', head: '#b49355', wet: '#405c51', border: '#82664a' },
  damaged: { soil: '#655743', ridge: '#75654d', crop: '#786f4c', leaf: '#786f4c', head: '#938255', wet: '#485b51', border: '#76624c' },
  flooded: { soil: '#4b443b', ridge: '#5a5145', crop: '#69764d', leaf: '#69764d', head: '#8f885b', wet: '#496663', border: '#655b4c' },
  snow: { soil: '#8f9187', ridge: '#aaa99c', crop: '#7f846f', leaf: '#7f846f', head: '#aaa17f', wet: '#647978', border: '#7d776a' },
};

function presentationForField(base: FarmPresentationState, field: FarmGeometry): FarmPresentationState {
  if (field.workable || field.source === 'fallback') return base;
  const weatherStage = base.stage === 'snow' || base.stage === 'flooded' ? base.stage : undefined;
  const damaged = field.burning || field.condition < 0.45 || field.status === 'ruin';
  return {
    ...base,
    stage: weatherStage ?? (damaged ? 'damaged' : 'dormant'),
    productive: false,
    harvestable: false,
    density: 0,
    height: 0,
    irrigation: 0,
    output: 0,
    blockedReason: field.burning ? 'fire-damaged-field' : field.status === 'active' ? 'unsafe-field' : 'fallow-field',
  };
}

const STEM_OFFSETS = [
  [-0.025, 0],
  [0.02, -0.018],
  [0.014, 0.023],
] as const;

/**
 * Presentation-only agricultural surface. Every detail derives from the existing field geometry,
 * seasonal presentation state and authoritative agriculture output. Nothing here owns crop stock,
 * yield, labour, irrigation or progression.
 */
export class FarmFieldRenderer {
  readonly group = new THREE.Group();
  /** Primary work field by settlement, preserved for farmer choreography. */
  readonly fields = new Map<string, { geometry: FarmGeometry; state: FarmPresentationState }>();
  /** Every visible physical/fallback field keyed by field id. */
  readonly renderedFields = new Map<string, { geometry: FarmGeometry; state: FarmPresentationState }>();

  private readonly soil = this.surfaceMesh('Cultivated farm soil',
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  private readonly furrows = this.surfaceMesh('Cultivated farm furrows',
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  private readonly moisture = this.surfaceMesh('Farm irrigation and wet-soil cues',
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, opacity: 0.72, depthWrite: false }));
  private readonly stems = this.mesh('Farm crop stalks', new THREE.CylinderGeometry(0.7, 1, 1, 5),
    new THREE.MeshStandardMaterial({ color: '#789c4c', roughness: 0.92 }), MAX_PLANTS);
  private readonly leaves = this.mesh('Farm crop leaves', new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#6f9147', roughness: 0.95, side: THREE.DoubleSide }), MAX_LEAVES);
  private readonly heads = this.mesh('Farm crop heads', new THREE.SphereGeometry(1, 5, 4),
    new THREE.MeshStandardMaterial({ color: '#c6aa5d', roughness: 0.78, emissive: '#5b481d', emissiveIntensity: 0.08 }), MAX_PLANTS);
  private readonly borders = this.surfaceMesh('Farm field borders',
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
  private readonly bundles = this.mesh('Farm harvest bundles', farmSheafGeometry(),
    new THREE.MeshStandardMaterial({ color: '#c3a457', roughness: 0.9 }), MAX_HARVEST_PROPS);
  private readonly sacks = this.mesh('Farm harvest sacks', farmSackGeometry(),
    new THREE.MeshStandardMaterial({ color: '#a88a5f', roughness: 0.98 }), MAX_FIELDS * 3);
  private readonly markers = this.mesh('Farm row marker posts', new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#806243', roughness: 0.98 }), MAX_FIELD_MARKERS);
  private readonly baskets = this.mesh('Farm harvest baskets', new THREE.CylinderGeometry(0.09, 0.065, 0.1, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: '#8d6942', roughness: 1, side: THREE.DoubleSide }), MAX_FIELDS * 2);
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();

  constructor() {
    this.group.name = 'Authoritative agricultural fields';
    this.group.add(this.soil, this.furrows, this.moisture, this.stems, this.leaves, this.heads, this.borders,
      this.bundles, this.sacks, this.markers, this.baskets);
  }

  update(state: SimulationState, heightAt: (x: number, z: number) => number, standable: (x: number, z: number) => boolean): void {
    this.fields.clear();
    this.renderedFields.clear();
    const surfaces = {
      soil: new DrapedSurfaceBatch(),
      furrows: new DrapedSurfaceBatch(),
      moisture: new DrapedSurfaceBatch(),
      borders: new DrapedSurfaceBatch(),
    };
    const counts = { fields: 0, stems: 0, leaves: 0, heads: 0,
      bundles: 0, sacks: 0, markers: 0, baskets: 0 };

    for (const settlement of [...state.settlements].sort((a, b) => a.id.localeCompare(b.id))) {
      const candidates = farmGeometries(settlement);
      if (candidates.length === 0 || counts.fields >= MAX_FIELDS) continue;
      const baseVisual = farmPresentationState(settlement, state.month, state.weather.cells[settlement.cellIndex]);
      const primary = farmGeometry(settlement);
      for (const field of candidates) {
        if (counts.fields >= MAX_FIELDS) break;
        const visual = presentationForField(baseVisual, field);
        // Physical field plots persist even when damaged or temporarily unsafe. Only the synthetic
        // fallback bed is rejected when the selected ground is not currently standable.
        if (field.source === 'fallback' && !standable(field.center.x, field.center.z)
          && visual.stage !== 'flooded' && visual.stage !== 'snow') continue;
        this.renderedFields.set(field.id, { geometry: field, state: visual });
        if (primary?.id === field.id) this.fields.set(settlement.id, { geometry: field, state: visual });
        const palette = PALETTES[visual.stage];
        counts.fields++;

      // Cultivated ground is a true draped surface, not a rigid slab. Every vertex samples the
      // same terrain authority used by people, buildings and the camera, so hills and hollows pass
      // naturally through the field without buried corners or floating edges.
      surfaces.soil.addPatch(field.center.x, field.center.z, field.width, field.depth, field.rotationY,
        SOIL_SEGMENTS_X, SOIL_SEGMENTS_Z, SOIL_LIFT, palette.soil, heightAt);

      // Rows are low crowned ribbons that follow the terrain longitudinally and laterally. They
      // retain the exact FarmGeometry/farmAnchor layout while reading as worked earth rather than
      // rectangular beams laid across the landscape.
      const rowSpacing = field.depth / ROWS;
      const rowHalfWidth = rowSpacing * 0.27;
      for (let row = 0; row < ROWS; row++) {
        const localZ = (row - 1.5) * rowSpacing;
        const start = farmPoint(field, -field.width * 0.47, localZ);
        const end = farmPoint(field, field.width * 0.47, localZ);
        surfaces.furrows.addRibbon(
          start.x, start.z, end.x, end.z,
          rowHalfWidth * 2, RIBBON_SEGMENTS, 0.011, 0.034, palette.ridge, heightAt,
        );
      }
      for (let gap = 0; gap <= ROWS; gap++) {
        if (visual.irrigation <= 0.08 || visual.stage === 'snow') break;
        const localZ = (gap - ROWS / 2) * rowSpacing;
        const start = farmPoint(field, -field.width * 0.45, localZ);
        const end = farmPoint(field, field.width * 0.45, localZ);
        const wetWidth = 0.016 + visual.irrigation * 0.02;
        surfaces.moisture.addRibbon(
          start.x, start.z, end.x, end.z,
          wetWidth, RIBBON_SEGMENTS, 0.0065, 0.009, palette.wet, heightAt,
        );
      }

      // The perimeter is an earthen berm, also draped vertex-by-vertex. A subtle crown gives the
      // silhouette definition without making the field look fenced or engineered.
      const edge = Math.max(0.03, Math.min(field.width, field.depth) * 0.028);
      const halfW = field.width * 0.5;
      const halfD = field.depth * 0.5;
      const northA = farmPoint(field, -halfW - edge, -halfD), northB = farmPoint(field, halfW + edge, -halfD);
      const southA = farmPoint(field, -halfW - edge, halfD), southB = farmPoint(field, halfW + edge, halfD);
      const westA = farmPoint(field, -halfW, -halfD), westB = farmPoint(field, -halfW, halfD);
      const eastA = farmPoint(field, halfW, -halfD), eastB = farmPoint(field, halfW, halfD);
      surfaces.borders.addRibbon(northA.x, northA.z, northB.x, northB.z, edge * 2, RIBBON_SEGMENTS, 0.01, 0.045, palette.border, heightAt);
      surfaces.borders.addRibbon(southA.x, southA.z, southB.x, southB.z, edge * 2, RIBBON_SEGMENTS, 0.01, 0.045, palette.border, heightAt);
      surfaces.borders.addRibbon(westA.x, westA.z, westB.x, westB.z, edge * 2, RIBBON_SEGMENTS, 0.01, 0.045, palette.border, heightAt);
      surfaces.borders.addRibbon(eastA.x, eastA.z, eastB.x, eastB.z, edge * 2, RIBBON_SEGMENTS, 0.01, 0.045, palette.border, heightAt);

      // Four small corner markers help cultivated land read as intentionally managed without
      // inventing fences, ownership or infrastructure in simulation state.
      if (visual.stage !== 'dormant' && visual.stage !== 'snow') {
        for (const [mx, mz] of [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]] as const) {
          const point = farmPoint(field, mx, mz);
          this.emit(this.markers, counts.markers++, point.x, heightAt(point.x, point.z) + 0.09, point.z,
            0.025, 0.18, 0.025, palette.border, resourceVisualUnit(`${field.id}:${mx}:${mz}:marker`) * 0.12 - 0.06);
        }
      }

      if (visual.height > 0 && visual.density > 0) {
        const plantCount = Math.max(1, Math.min(PLANTS_PER_CLUMP, 1 + Math.floor(visual.density * PLANTS_PER_CLUMP)));
        const headStage = visual.stage === 'mature' || visual.stage === 'harvest';
        const stubble = visual.stage === 'stubble';
        for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
          const base = farmPoint(field, (column / (COLUMNS - 1) - 0.5) * field.width * 0.8, (row - 1.5) * rowSpacing);
          const baseX = base.x;
          const baseZ = base.z;
          const h = visual.height * (0.8 + visual.health * 0.2);
          for (let plant = 0; plant < plantCount; plant++) {
            const [ox, oz] = STEM_OFFSETS[plant]!;
            const localOffset = farmPoint(field, ox * (0.65 + field.width * 0.08), oz * (0.65 + field.depth * 0.08));
            const x = baseX + (localOffset.x - field.center.x);
            const z = baseZ + (localOffset.z - field.center.z);
            const stalkHeight = stubble ? Math.max(0.012, h) : h * (0.9 + plant * 0.05);
            const radius = 0.006 + visual.density * 0.004;
            const lean = (resourceVisualUnit(`${field.id}:${row}:${column}:${plant}:lean`) - 0.5) * 0.2;
            const turn = resourceVisualUnit(`${field.id}:${row}:${column}:${plant}:turn`) * Math.PI;
            this.emit(this.stems, counts.stems++, x, heightAt(x, z) + stalkHeight * 0.5 + 0.016, z,
              radius, stalkHeight, radius, palette.crop, lean, turn);
            if (!stubble && stalkHeight > 0.03) {
              const leafY = heightAt(x, z) + stalkHeight * 0.55 + 0.014;
              this.emit(this.leaves, counts.leaves++, x, leafY, z,
                0.014, stalkHeight * 0.52, 1, palette.leaf, 0.72 + lean, turn + 0.7);
              this.emit(this.leaves, counts.leaves++, x, leafY + stalkHeight * 0.08, z,
                0.014, stalkHeight * 0.44, 1, palette.leaf, -0.7 + lean, turn - 0.7);
            }
            if (headStage && stalkHeight > 0.055) {
              const headScale = 0.012 + visual.density * 0.008;
              this.emit(this.heads, counts.heads++, x, heightAt(x, z) + stalkHeight + 0.018, z,
                headScale * 0.72, headScale * 1.7, headScale * 0.72, palette.head, lean * 0.7, turn);
            }
          }
        }
      }

      // These are documentary cues for harvest output already recorded by settlement.agriculture,
      // never inventory. They make mature/harvested material physically legible beside the field.
      const harvestEvidence = visual.output > 0.01
        && (visual.stage === 'mature' || visual.stage === 'harvest' || visual.stage === 'stubble');
      if (harvestEvidence) {
        const pieces = Math.min(5, Math.max(1, Math.ceil(Math.log2(1 + visual.output))));
        const edgeLocalZ = halfD + 0.16;
        for (let piece = 0; piece < pieces; piece++) {
          const point = farmPoint(field, (piece - (pieces - 1) / 2) * 0.13, edgeLocalZ);
          const y = heightAt(point.x, point.z) + 0.06;
          this.emit(this.bundles, counts.bundles++, point.x, y, point.z, 0.95, 0.95, 0.95, palette.head,
            piece % 2 ? 0.16 : -0.13, resourceVisualUnit(`${field.id}:sheaf:${piece}`) * Math.PI);
        }
        if (visual.harvestable) {
          const basket = farmPoint(field, Math.min(halfW * 0.72, 0.42), edgeLocalZ);
          this.emit(this.baskets, counts.baskets++, basket.x, heightAt(basket.x, basket.z) + 0.055, basket.z, 1, 1, 1, '#8d6942');
          const sackCount = Math.min(2, Math.max(1, Math.ceil(Math.log2(1 + visual.output) / 3)));
          for (let sack = 0; sack < sackCount; sack++) {
            const point = farmPoint(field, -Math.min(halfW * 0.7, 0.38) + sack * 0.14, edgeLocalZ);
            this.emit(this.sacks, counts.sacks++, point.x, heightAt(point.x, point.z) + 0.075, point.z,
              0.9, 0.9, 0.9, '#a88a5f', (sack ? 1 : -1) * 0.06);
          }
        }
      }
      }
    }

    this.finishSurface(this.soil, surfaces.soil);
    this.finishSurface(this.furrows, surfaces.furrows);
    this.finishSurface(this.moisture, surfaces.moisture);
    this.finish(this.stems, counts.stems);
    this.finish(this.leaves, counts.leaves);
    this.finish(this.heads, counts.heads);
    this.finishSurface(this.borders, surfaces.borders);
    this.finish(this.bundles, counts.bundles);
    this.finish(this.sacks, counts.sacks);
    this.finish(this.markers, counts.markers);
    this.finish(this.baskets, counts.baskets);
  }

  private surfaceMesh(name: string, material: THREE.MeshStandardMaterial): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  private finishSurface(mesh: THREE.Mesh, batch: DrapedSurfaceBatch): void {
    const previous = mesh.geometry;
    mesh.geometry = batch.build();
    mesh.visible = batch.triangleCount > 0;
    previous.dispose();
  }

  private mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private emit(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, colour: string, rz = 0, ry = 0, rx = 0): void {
    if (index >= mesh.instanceMatrix.count) return;
    this.marker.position.set(x, y, z);
    this.marker.rotation.set(rx, ry, rz);
    this.marker.scale.set(sx, sy, sz);
    this.marker.updateMatrix();
    mesh.setMatrixAt(index, this.marker.matrix);
    mesh.setColorAt(index, this.colour.set(colour));
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}


class DrapedSurfaceBatch {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly indices: number[] = [];
  private readonly colour = new THREE.Color();
  triangleCount = 0;

  addPatch(
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    rotationY: number,
    segmentsX: number,
    segmentsZ: number,
    lift: number,
    colour: string,
    heightAt: (x: number, z: number) => number,
  ): void {
    const base = this.vertexCount;
    const rgb = this.colour.set(colour);
    const cosine = Math.cos(rotationY), sine = Math.sin(rotationY);
    for (let zIndex = 0; zIndex <= segmentsZ; zIndex++) {
      const v = zIndex / segmentsZ;
      const localZ = (v - 0.5) * depth;
      for (let xIndex = 0; xIndex <= segmentsX; xIndex++) {
        const u = xIndex / segmentsX;
        const localX = (u - 0.5) * width;
        const x = centerX + localX * cosine + localZ * sine;
        const z = centerZ - localX * sine + localZ * cosine;
        this.vertex(x, heightAt(x, z) + lift, z, rgb);
      }
    }
    const stride = segmentsX + 1;
    for (let zIndex = 0; zIndex < segmentsZ; zIndex++) for (let xIndex = 0; xIndex < segmentsX; xIndex++) {
      const a = base + zIndex * stride + xIndex;
      const b = a + 1;
      const d = base + (zIndex + 1) * stride + xIndex;
      const e = d + 1;
      this.indices.push(a, d, b, b, d, e);
      this.triangleCount += 2;
    }
  }

  addRibbon(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    width: number,
    segments: number,
    edgeLift: number,
    crownLift: number,
    colour: string,
    heightAt: (x: number, z: number) => number,
  ): void {
    const dx = endX - startX, dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    if (length <= 0.000001 || width <= 0) return;
    const perpX = -dz / length, perpZ = dx / length;
    const half = width * 0.5;
    const base = this.vertexCount;
    const rgb = this.colour.set(colour);
    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const centerX = startX + dx * t;
      const centerZ = startZ + dz * t;
      const leftX = centerX - perpX * half, leftZ = centerZ - perpZ * half;
      const rightX = centerX + perpX * half, rightZ = centerZ + perpZ * half;
      this.vertex(leftX, heightAt(leftX, leftZ) + edgeLift, leftZ, rgb);
      this.vertex(centerX, heightAt(centerX, centerZ) + crownLift, centerZ, rgb);
      this.vertex(rightX, heightAt(rightX, rightZ) + edgeLift, rightZ, rgb);
    }
    for (let segment = 0; segment < segments; segment++) {
      const row = base + segment * 3;
      const next = row + 3;
      // Wind every ribbon triangle toward +Y so the default FrontSide farm materials remain
      // visible and correctly lit from the documentary camera above the ground.
      this.indices.push(row, row + 1, next, row + 1, next + 1, next);
      this.indices.push(row + 1, row + 2, next + 1, row + 2, next + 2, next + 1);
      this.triangleCount += 4;
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setIndex(this.indices);
    if (this.indices.length) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private get vertexCount(): number {
    return this.positions.length / 3;
  }

  private vertex(x: number, y: number, z: number, colour: THREE.Color): void {
    this.positions.push(x, y, z);
    this.colours.push(colour.r, colour.g, colour.b);
  }
}
