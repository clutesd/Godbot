import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { RESOURCE_BY_ID } from '../../sim/resources/catalog';

/** Small ground-level work piles: only discovered working/abandoned sites become visible. */
export class ResourceSiteRenderer {
  readonly group = new THREE.Group();
  private readonly piles: THREE.InstancedMesh;
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface) {
    this.group.name = 'Resource extraction sites';
    this.piles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), Math.max(1, world.resourceDeposits.length));
    this.piles.count = 0; this.piles.castShadow = true; this.piles.receiveShadow = true;
    this.piles.frustumCulled = false;
    this.group.add(this.piles);
  }
  update(): void {
    let index = 0;
    for (const d of this.world.resourceDeposits) {
      if (d.establishedMonth === undefined) continue;
      const cell = this.world.cells[d.cellIndex];
      if (!cell || cell.water || cell.slope > 0.54) continue;
      const category = RESOURCE_BY_ID.get(d.resourceId)?.category;
      const abandoned = d.abandonedMonth !== undefined || d.depleted;
      const height = abandoned ? 0.12 : category === 'timber' ? 0.3 : 0.5;
      this.marker.position.set(d.worldX, this.surface.heightAt(d.worldX, d.worldZ) + height * 0.4, d.worldZ);
      this.marker.scale.set(category === 'timber' ? 1.5 : 0.9, height, 0.8);
      this.marker.updateMatrix();
      this.piles.setMatrixAt(index, this.marker.matrix);
      this.colour.set(abandoned ? '#514b43' : category === 'timber' ? '#89623c' : category === 'plant' ? '#627b45' : d.resourceId === 'copper-ore' ? '#8d7660' : '#76706a');
      this.piles.setColorAt(index++, this.colour);
    }
    this.piles.count = index; this.piles.instanceMatrix.needsUpdate = true;
    if (this.piles.instanceColor) this.piles.instanceColor.needsUpdate = true;
  }
}
