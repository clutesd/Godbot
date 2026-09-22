import * as THREE from 'three';
import { farmGeometry, type FarmGeometry } from '../../shared/FarmGeometry';
import type { SimulationState } from '../../sim/types';
import { farmPresentationState, type FarmPresentationState, type FarmStage } from './FarmActionPresentation';
import { resourceVisualUnit } from '../../sim/resources/ResourceWorkPresentation';
import { farmSackGeometry, farmSheafGeometry } from './FarmMaterialGeometry';

const MAX_FIELDS = 64;
const ROWS = 4;
const COLUMNS = 6;
const PLANTS_PER_CLUMP = 3;
const MAX_PLANTS = MAX_FIELDS * ROWS * COLUMNS * PLANTS_PER_CLUMP;
const MAX_FURROWS = MAX_FIELDS * (ROWS + 1);
const MAX_EDGES = MAX_FIELDS * 8;
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
  readonly fields = new Map<string, { geometry: FarmGeometry; state: FarmPresentationState }>();

  private readonly soil = this.mesh('Cultivated farm soil', new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#66503b', roughness: 1 }), MAX_FIELDS);
  private readonly furrows = this.mesh('Cultivated farm furrows', new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#765b42', roughness: 1 }), MAX_FURROWS);
  private readonly moisture = this.mesh('Farm irrigation and wet-soil cues', new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#3b5a50', roughness: 0.95, transparent: true, opacity: 0.72 }), MAX_FURROWS);
  private readonly stems = this.mesh('Farm crop stalks', new THREE.CylinderGeometry(0.7, 1, 1, 5),
    new THREE.MeshStandardMaterial({ color: '#789c4c', roughness: 0.92 }), MAX_PLANTS);
  private readonly leaves = this.mesh('Farm crop leaves', new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#6f9147', roughness: 0.95, side: THREE.DoubleSide }), MAX_LEAVES);
  private readonly heads = this.mesh('Farm crop heads', new THREE.SphereGeometry(1, 5, 4),
    new THREE.MeshStandardMaterial({ color: '#c6aa5d', roughness: 0.78, emissive: '#5b481d', emissiveIntensity: 0.08 }), MAX_PLANTS);
  private readonly borders = this.mesh('Farm field borders', new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#765b42', roughness: 0.96 }), MAX_EDGES);
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
    const counts = { soil: 0, furrows: 0, moisture: 0, stems: 0, leaves: 0, heads: 0, borders: 0,
      bundles: 0, sacks: 0, markers: 0, baskets: 0 };

    for (const settlement of [...state.settlements].sort((a, b) => a.id.localeCompare(b.id))) {
      const field = farmGeometry(settlement);
      if (!field || counts.soil >= MAX_FIELDS) continue;
      const visual = farmPresentationState(settlement, state.month, state.weather.cells[settlement.cellIndex]);
      // Reject an entire unsafe bed instead of moving visual agriculture away from its authoritative geometry.
      if (!standable(field.center.x, field.center.z) && visual.stage !== 'flooded' && visual.stage !== 'snow') continue;
      this.fields.set(settlement.id, { geometry: field, state: visual });
      const palette = PALETTES[visual.stage];

      this.emitBox(this.soil, counts.soil++, field.center.x, heightAt(field.center.x, field.center.z) + 0.007, field.center.z,
        field.width, 0.014, field.depth, palette.soil);

      // Four broad cultivated rows remain aligned with FarmGeometry/farmAnchor. Thin darker channels
      // between them make the plot read as intentionally worked land from the normal camera.
      const rowSpacing = field.depth / ROWS;
      for (let row = 0; row < ROWS; row++) {
        const z = field.center.z + (row - 1.5) * rowSpacing;
        this.emitBox(this.furrows, counts.furrows++, field.center.x, heightAt(field.center.x, z) + 0.018, z,
          field.width * 0.94, 0.022, rowSpacing * 0.54, palette.ridge);
      }
      for (let gap = 0; gap <= ROWS; gap++) {
        if (visual.irrigation <= 0.08 || visual.stage === 'snow') break;
        const z = field.center.z + (gap - ROWS / 2) * rowSpacing;
        const wet = 0.016 + visual.irrigation * 0.02;
        this.emitBox(this.moisture, counts.moisture++, field.center.x, heightAt(field.center.x, z) + 0.012, z,
          field.width * 0.9, 0.008, wet, palette.wet);
      }

      // A low perimeter gives the plot a readable silhouette without creating collision geometry.
      const edge = Math.max(0.025, Math.min(field.width, field.depth) * 0.025);
      const halfW = field.width * 0.5;
      const halfD = field.depth * 0.5;
      this.emitBox(this.borders, counts.borders++, field.center.x, heightAt(field.center.x, field.center.z - halfD) + 0.035,
        field.center.z - halfD, field.width + edge * 2, 0.045, edge, palette.border);
      this.emitBox(this.borders, counts.borders++, field.center.x, heightAt(field.center.x, field.center.z + halfD) + 0.035,
        field.center.z + halfD, field.width + edge * 2, 0.045, edge, palette.border);
      this.emitBox(this.borders, counts.borders++, field.center.x - halfW, heightAt(field.center.x - halfW, field.center.z) + 0.035,
        field.center.z, edge, 0.045, field.depth, palette.border);
      this.emitBox(this.borders, counts.borders++, field.center.x + halfW, heightAt(field.center.x + halfW, field.center.z) + 0.035,
        field.center.z, edge, 0.045, field.depth, palette.border);

      // Four small corner markers help cultivated land read as intentionally managed without
      // inventing fences, ownership or infrastructure in simulation state.
      if (visual.stage !== 'dormant' && visual.stage !== 'snow') {
        for (const [mx, mz] of [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]] as const) {
          const x = field.center.x + mx, z = field.center.z + mz;
          this.emit(this.markers, counts.markers++, x, heightAt(x, z) + 0.09, z,
            0.025, 0.18, 0.025, palette.border, resourceVisualUnit(`${settlement.id}:${mx}:${mz}:marker`) * 0.12 - 0.06);
        }
      }

      if (visual.height > 0 && visual.density > 0) {
        const plantCount = Math.max(1, Math.min(PLANTS_PER_CLUMP, 1 + Math.floor(visual.density * PLANTS_PER_CLUMP)));
        const headStage = visual.stage === 'mature' || visual.stage === 'harvest';
        const stubble = visual.stage === 'stubble';
        for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
          const baseX = field.center.x + (column / (COLUMNS - 1) - 0.5) * field.width * 0.8;
          const baseZ = field.center.z + (row - 1.5) * rowSpacing;
          const h = visual.height * (0.8 + visual.health * 0.2);
          for (let plant = 0; plant < plantCount; plant++) {
            const [ox, oz] = STEM_OFFSETS[plant]!;
            const x = baseX + ox * (0.65 + field.width * 0.08);
            const z = baseZ + oz * (0.65 + field.depth * 0.08);
            const stalkHeight = stubble ? Math.max(0.012, h) : h * (0.9 + plant * 0.05);
            const radius = 0.006 + visual.density * 0.004;
            const lean = (resourceVisualUnit(`${settlement.id}:${row}:${column}:${plant}:lean`) - 0.5) * 0.2;
            const turn = resourceVisualUnit(`${settlement.id}:${row}:${column}:${plant}:turn`) * Math.PI;
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
        const edgeZ = field.center.z + halfD + 0.16;
        for (let piece = 0; piece < pieces; piece++) {
          const x = field.center.x + (piece - (pieces - 1) / 2) * 0.13;
          const y = heightAt(x, edgeZ) + 0.06;
          this.emit(this.bundles, counts.bundles++, x, y, edgeZ, 0.95, 0.95, 0.95, palette.head,
            piece % 2 ? 0.16 : -0.13, resourceVisualUnit(`${settlement.id}:sheaf:${piece}`) * Math.PI);
        }
        if (visual.harvestable) {
          const x = field.center.x + Math.min(halfW * 0.72, 0.42);
          this.emit(this.baskets, counts.baskets++, x, heightAt(x, edgeZ) + 0.055, edgeZ, 1, 1, 1, '#8d6942');
          const sackCount = Math.min(2, Math.max(1, Math.ceil(Math.log2(1 + visual.output) / 3)));
          for (let sack = 0; sack < sackCount; sack++) {
            const sx = field.center.x - Math.min(halfW * 0.7, 0.38) + sack * 0.14;
            this.emit(this.sacks, counts.sacks++, sx, heightAt(sx, edgeZ) + 0.075, edgeZ,
              0.9, 0.9, 0.9, '#a88a5f', (sack ? 1 : -1) * 0.06);
          }
        }
      }
    }

    this.finish(this.soil, counts.soil);
    this.finish(this.furrows, counts.furrows);
    this.finish(this.moisture, counts.moisture);
    this.finish(this.stems, counts.stems);
    this.finish(this.leaves, counts.leaves);
    this.finish(this.heads, counts.heads);
    this.finish(this.borders, counts.borders);
    this.finish(this.bundles, counts.bundles);
    this.finish(this.sacks, counts.sacks);
    this.finish(this.markers, counts.markers);
    this.finish(this.baskets, counts.baskets);
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

  private emitBox(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, colour: string): void {
    this.emit(mesh, index, x, y, z, sx, sy, sz, colour);
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
