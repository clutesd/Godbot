import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { RESOURCE_BY_ID } from '../../sim/resources/catalog';
import { movementPathStage, movementPathStrength, type MovementPathStage } from '../../sim/environment/PathEvolution';

const PATH_NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
const PATH_COLOURS: Record<Exclude<MovementPathStage, 'none'>, THREE.Color> = {
  'desire-path': new THREE.Color('#8d775d'),
  footpath: new THREE.Color('#7b6249'),
  'packed-track': new THREE.Color('#66523e'),
  'cart-road': new THREE.Color('#685a46'),
  'engineered-road': new THREE.Color('#777168'),
};
const STAGE_RANK: Record<MovementPathStage, number> = {
  none: 0,
  'desire-path': 1,
  footpath: 2,
  'packed-track': 3,
  'cart-road': 4,
  'engineered-road': 5,
};
const SCAR_KIND_RANK = { farmland: 1, logging: 2, quarry: 3, mine: 4, industry: 5, ruin: 6 } as const;
const HASH_OFFSET = 2166136261;
const HASH_PRIME = 16777619;

function mixHash(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), HASH_PRIME) >>> 0;
}

/** Small ground-level work piles plus persistent movement-shaped paths. */
export class ResourceSiteRenderer {
  readonly group = new THREE.Group();
  private readonly piles: THREE.InstancedMesh;
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private readonly scars: THREE.InstancedMesh;
  private readonly trails = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#796b4f', transparent: true, opacity: 0.42 }));
  private readonly footpaths: THREE.Mesh;
  private readonly normal = new THREE.Vector3();
  private readonly circleNormal = new THREE.Vector3(0, 0, 1);
  private readonly abandonedColour = new THREE.Color('#68734e');
  private pileRevision = -1;
  private scarRevision = -1;
  private trailRevision = -1;
  private pathRevision = -1;

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface) {
    this.group.name = 'Resource extraction sites';
    this.piles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), Math.max(1, world.resourceDeposits.length));
    this.piles.count = 0; this.piles.castShadow = true; this.piles.receiveShadow = true;
    this.piles.frustumCulled = false;
    this.group.add(this.piles);
    this.scars = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 9), new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), Math.max(1, world.cells.length));
    this.scars.count = 0; this.scars.frustumCulled = false;
    this.trails.name = 'Resource access trails';
    this.footpaths = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        roughness: 1,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        vertexColors: true,
        side: THREE.DoubleSide,
      }),
    );
    // Keep the Step-1 object name stable for diagnostics/tests even though the mesh now spans the
    // whole desire-path -> road hierarchy.
    this.footpaths.name = 'Movement-worn desire paths';
    this.footpaths.receiveShadow = true;
    this.footpaths.frustumCulled = false;
    this.group.add(this.scars, this.trails, this.footpaths);
  }

  update(): void {
    // Presentation work is invalidated by the visual facts it consumes, not by the calendar. This
    // method is still cheap to call monthly, but ordinary month rollover no longer allocates and
    // uploads replacement geometry for every extraction/path layer.
    const pileRevision = this.resourcePileRevision();
    if (pileRevision !== this.pileRevision) {
      this.pileRevision = pileRevision;
      this.rebuildResourcePiles();
    }

    const scarRevision = this.landScarRevision();
    if (scarRevision !== this.scarRevision) {
      this.scarRevision = scarRevision;
      this.rebuildLandScars();
    }

    const trailRevision = this.accessTrailRevision();
    if (trailRevision !== this.trailRevision) {
      this.trailRevision = trailRevision;
      this.rebuildAccessTrails();
    }

    const pathRevision = this.movementPathVisualRevision();
    if (pathRevision !== this.pathRevision) {
      this.pathRevision = pathRevision;
      this.rebuildMovementPaths();
    }
  }

  private resourcePileRevision(): number {
    let hash = mixHash(HASH_OFFSET, this.world.environmentRevision ?? 0);
    hash = mixHash(hash, this.world.resourceDeposits.length);
    for (let index = 0; index < this.world.resourceDeposits.length; index += 1) {
      const deposit = this.world.resourceDeposits[index]!;
      if (deposit.establishedMonth === undefined) continue;
      hash = mixHash(hash, index + 1);
      hash = mixHash(hash, deposit.abandonedMonth === undefined ? 0 : 1);
      hash = mixHash(hash, deposit.depleted ? 1 : 0);
    }
    return hash;
  }

  private landScarRevision(): number {
    let hash = mixHash(HASH_OFFSET, this.world.environmentRevision ?? 0);
    for (let cellIndex = 0; cellIndex < this.world.cells.length; cellIndex += 1) {
      const cell = this.world.cells[cellIndex]!;
      if (!cell.modifications) continue;
      const use = cell.modifications;
      const kind = use.quarry ? 'quarry' : use.mine ? 'mine' : use.industry ? 'industry' : use.ruin ? 'ruin' : use.farmland ? 'farmland' : use.logging ? 'logging' : undefined;
      if (!kind) continue;
      const mark = use[kind]!;
      if (mark.intensity < 0.01) continue;
      hash = mixHash(hash, cellIndex + 1);
      hash = mixHash(hash, SCAR_KIND_RANK[kind]);
      // 1/128 intensity steps are finer than the visible radius/colour difference at normal camera
      // distances, while avoiding a rebuild for microscopic recovery/extraction deltas.
      hash = mixHash(hash, Math.round(mark.intensity * 128));
      hash = mixHash(hash, mark.abandonedMonth === undefined ? 0 : 1);
    }
    return hash;
  }

  private accessTrailRevision(): number {
    let hash = mixHash(HASH_OFFSET, this.world.resourceDeposits.length);
    for (let depositIndex = 0; depositIndex < this.world.resourceDeposits.length; depositIndex += 1) {
      const deposit = this.world.resourceDeposits[depositIndex]!;
      if (deposit.establishedMonth === undefined || (deposit.extracted ?? 0) < 8) continue;
      hash = mixHash(hash, depositIndex + 1);
      const trails = deposit.accessTrails ?? [];
      hash = mixHash(hash, trails.length);
      for (const path of trails) {
        hash = mixHash(hash, path.length);
        for (const point of path) {
          hash = mixHash(hash, Math.round(point.x * 64));
          hash = mixHash(hash, Math.round(point.z * 64));
        }
      }
    }
    return hash;
  }

  private movementPathVisualRevision(): number {
    let hash = mixHash(HASH_OFFSET, this.world.environmentRevision ?? 0);
    for (let cellIndex = 0; cellIndex < this.world.cells.length; cellIndex += 1) {
      const cell = this.world.cells[cellIndex]!;
      const stage = movementPathStage(cell);
      if (stage === 'none' || cell.water) continue;
      const strength = movementPathStrength(cell);
      hash = mixHash(hash, cellIndex + 1);
      hash = mixHash(hash, STAGE_RANK[stage]);
      // Path wear accumulates in tiny per-person increments. Rebuild only when that wear produces a
      // visible width/ranking change; stage promotions remain immediate because stage is hashed too.
      hash = mixHash(hash, Math.round(strength * 32));
      hash = mixHash(hash, Math.round(this.pathHalfWidth(stage, strength) * 200));
    }
    return hash;
  }

  private rebuildResourcePiles(): void {
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

  private rebuildLandScars(): void {
    let scarIndex = 0;
    for (const cell of this.world.cells) {
      if (cell.water || !cell.modifications) continue;
      const use = cell.modifications;
      const kind = use.quarry ? 'quarry' : use.mine ? 'mine' : use.industry ? 'industry' : use.ruin ? 'ruin' : use.farmland ? 'farmland' : use.logging ? 'logging' : undefined;
      if (!kind) continue;
      const mark = use[kind]!;
      if (mark.intensity < 0.01) continue;
      const radius = this.world.cellSize * Math.min(0.38, 0.12 + mark.intensity * 0.28);
      this.marker.position.set(cell.worldX, this.surface.heightAt(cell.worldX, cell.worldZ) + 0.035, cell.worldZ);
      this.normal.set(
        this.surface.heightAt(cell.worldX - 0.2, cell.worldZ) - this.surface.heightAt(cell.worldX + 0.2, cell.worldZ),
        0.4,
        this.surface.heightAt(cell.worldX, cell.worldZ - 0.2) - this.surface.heightAt(cell.worldX, cell.worldZ + 0.2),
      ).normalize();
      this.marker.quaternion.setFromUnitVectors(this.circleNormal, this.normal);
      this.marker.scale.set(radius, radius * 0.8, 1); this.marker.updateMatrix();
      this.scars.setMatrixAt(scarIndex, this.marker.matrix);
      this.colour.set(kind === 'farmland' ? '#817445' : kind === 'logging' ? '#87704e' : kind === 'quarry' ? '#a39980' : '#49433a');
      if (mark.abandonedMonth !== undefined) this.colour.lerp(this.abandonedColour, Math.min(0.65, 1 - mark.intensity));
      this.scars.setColorAt(scarIndex++, this.colour);
    }
    this.marker.rotation.set(0, 0, 0);
    this.marker.quaternion.identity();
    this.scars.count = scarIndex; this.scars.instanceMatrix.needsUpdate = true;
    if (this.scars.instanceColor) this.scars.instanceColor.needsUpdate = true;
  }

  private rebuildAccessTrails(): void {
    const vertices: number[] = [];
    for (const deposit of this.world.resourceDeposits) {
      if (deposit.establishedMonth === undefined || (deposit.extracted ?? 0) < 8) continue;
      for (const path of deposit.accessTrails ?? []) for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.4));
        for (let j = 0; j < steps; j++) for (const t of [j / steps, (j + 1) / steps]) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          vertices.push(x, this.surface.heightAt(x, z) + 0.045, z);
        }
      }
    }
    this.trails.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.trails.geometry.computeBoundingSphere();
  }

  private rebuildMovementPaths(): void {
    const positions: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    const emitted = new Set<string>();
    const counts: Record<MovementPathStage, number> = { none: 0, 'desire-path': 0, footpath: 0, 'packed-track': 0, 'cart-road': 0, 'engineered-road': 0 };

    for (let cellIndex = 0; cellIndex < this.world.cells.length; cellIndex += 1) {
      const cell = this.world.cells[cellIndex]!;
      const stageA = movementPathStage(cell);
      if (cell.water || stageA === 'none') continue;
      const neighbourIndex = this.strongestPathNeighbour(cellIndex);
      if (neighbourIndex === undefined) continue;
      const neighbour = this.world.cells[neighbourIndex]!;
      const stageB = movementPathStage(neighbour);
      if (stageB === 'none') continue;
      const edgeKey = cellIndex < neighbourIndex ? `${cellIndex}:${neighbourIndex}` : `${neighbourIndex}:${cellIndex}`;
      if (emitted.has(edgeKey)) continue;
      emitted.add(edgeKey);

      const vx = neighbour.worldX - cell.worldX;
      const vz = neighbour.worldZ - cell.worldZ;
      const length = Math.hypot(vx, vz);
      if (length < 0.001) continue;
      const sideX = -vz / length;
      const sideZ = vx / length;
      const widthA = this.pathHalfWidth(stageA, movementPathStrength(cell));
      const widthB = this.pathHalfWidth(stageB, movementPathStrength(neighbour));
      const base = positions.length / 3;
      const corners = [
        [cell.worldX + sideX * widthA, cell.worldZ + sideZ * widthA],
        [cell.worldX - sideX * widthA, cell.worldZ - sideZ * widthA],
        [neighbour.worldX + sideX * widthB, neighbour.worldZ + sideZ * widthB],
        [neighbour.worldX - sideX * widthB, neighbour.worldZ - sideZ * widthB],
      ] as const;
      for (const [worldX, worldZ] of corners) positions.push(worldX, this.surface.heightAt(worldX, worldZ) + 0.022, worldZ);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);

      const colourA = PATH_COLOURS[stageA];
      const colourB = PATH_COLOURS[stageB];
      for (let corner = 0; corner < 2; corner += 1) colours.push(colourA.r, colourA.g, colourA.b);
      for (let corner = 0; corner < 2; corner += 1) colours.push(colourB.r, colourB.g, colourB.b);
      counts[STAGE_RANK[stageA] >= STAGE_RANK[stageB] ? stageA : stageB] += 1;
    }

    const geometry = this.footpaths.geometry;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    geometry.deleteAttribute('normal');
    if (positions.length > 0) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.footpaths.userData['pathStageCounts'] = counts;
  }

  private strongestPathNeighbour(cellIndex: number): number | undefined {
    const cell = this.world.cells[cellIndex];
    if (!cell) return undefined;
    let bestIndex: number | undefined;
    let bestScore = 0;
    for (const [dx, dz] of PATH_NEIGHBOURS) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (x < 0 || z < 0 || x >= this.world.size || z >= this.world.size) continue;
      const index = z * this.world.size + x;
      const neighbour = this.world.cells[index];
      if (!neighbour || neighbour.water || movementPathStage(neighbour) === 'none') continue;
      const diagonalPenalty = dx !== 0 && dz !== 0 ? 0.94 : 1;
      const score = movementPathStrength(neighbour) * diagonalPenalty;
      if (score <= bestScore) continue;
      bestScore = score;
      bestIndex = index;
    }
    return bestIndex;
  }

  private pathHalfWidth(stage: Exclude<MovementPathStage, 'none'>, strength: number): number {
    const base = stage === 'desire-path' ? 0.018
      : stage === 'footpath' ? 0.027
        : stage === 'packed-track' ? 0.043
          : stage === 'cart-road' ? 0.064
            : 0.082;
    const growth = stage === 'engineered-road' ? 0.032 : stage === 'cart-road' ? 0.026 : 0.018;
    return this.world.cellSize * Math.min(0.12, base + Math.sqrt(Math.min(1.5, strength)) * growth);
  }
}
