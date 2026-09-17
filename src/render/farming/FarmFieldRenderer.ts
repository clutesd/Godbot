import * as THREE from 'three';
import { farmGeometry, type FarmGeometry } from '../../shared/FarmGeometry';
import type { SimulationState } from '../../sim/types';
import { farmPresentationState, type FarmPresentationState } from './FarmActionPresentation';

/** Updated at simulation revisions, not animation frames; four rows of six bounded crop clumps. */
export class FarmFieldRenderer {
  readonly group = new THREE.Group();
  readonly fields = new Map<string, { geometry: FarmGeometry; state: FarmPresentationState }>();
  private readonly soil = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#66503b', roughness: 1 }), 64);
  private readonly crops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.04, 1, 4), new THREE.MeshStandardMaterial({ roughness: 1 }), 64 * 24);
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  constructor() {
    this.group.name = 'Authoritative agricultural fields';
    this.group.add(this.soil, this.crops);
    this.soil.count = this.crops.count = 0;
    this.soil.frustumCulled = this.crops.frustumCulled = false;
    this.crops.castShadow = this.soil.receiveShadow = true;
  }
  update(state: SimulationState, heightAt: (x: number, z: number) => number, standable: (x: number, z: number) => boolean): void {
    this.fields.clear(); let beds = 0, crops = 0;
    for (const settlement of [...state.settlements].sort((a, b) => a.id.localeCompare(b.id))) {
      const field = farmGeometry(settlement);
      if (!field || beds >= 64) continue;
      const visual = farmPresentationState(settlement, state.month, state.weather.cells[settlement.cellIndex]);
      // Reject an entire unsafe bed instead of moving the crop away from its authoritative geometry.
      if (!standable(field.center.x, field.center.z) && visual.stage !== 'flooded' && visual.stage !== 'snow') continue;
      this.fields.set(settlement.id, { geometry: field, state: visual });
      const y = heightAt(field.center.x, field.center.z);
      this.marker.position.set(field.center.x, y + 0.008, field.center.z);
      this.marker.scale.set(field.width, 0.012, field.depth); this.marker.updateMatrix(); this.soil.setMatrixAt(beds++, this.marker.matrix);
      this.colour.set(visual.stage === 'damaged' ? '#84704c' : visual.stage === 'harvest' || visual.stage === 'mature' || visual.stage === 'stubble' ? '#b5a159' : '#708d45');
      for (let row = 0; row < 4; row++) for (let column = 0; column < 6; column++) {
        if (visual.height <= 0 || visual.density <= 0) continue;
        const x = field.center.x + (column / 5 - 0.5) * field.width * 0.8;
        const z = field.center.z + (row - 1.5) * field.depth / 4;
        const h = visual.height * (0.8 + visual.health * 0.2);
        this.marker.position.set(x, heightAt(x, z) + h * 0.5, z); this.marker.scale.set(0.2 + visual.density * 0.8, h, 0.2 + visual.density * 0.8); this.marker.updateMatrix();
        this.crops.setMatrixAt(crops, this.marker.matrix); this.crops.setColorAt(crops++, this.colour);
      }
    }
    this.soil.count = beds; this.crops.count = crops;
    this.soil.instanceMatrix.needsUpdate = this.crops.instanceMatrix.needsUpdate = true;
    if (this.crops.instanceColor) this.crops.instanceColor.needsUpdate = true;
  }
}
