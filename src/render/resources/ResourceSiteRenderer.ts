import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { RESOURCE_BY_ID } from '../../sim/resources/catalog';
import { resourceWorkAssignmentsForWorld, type ResourceWorkAssignment } from '../../sim/resources/ResourceWorkAssignments';
import { resourceWorkVisualKind } from '../../sim/resources/ResourceWorkPresentation';
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
/** Active work is documentary detail, not a second simulation population. */
const MAX_ACTIVE_WORK_SITES = 64;
const MAX_SITE_DETAIL = MAX_ACTIVE_WORK_SITES * 5;

interface ActiveCounts {
  logs: number;
  stumps: number;
  rocks: number;
  baskets: number;
  bundles: number;
  handles: number;
  heads: number;
  racks: number;
}

function mixHash(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), HASH_PRIME) >>> 0;
}

function stringHash(value: string): number {
  let hash = HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) hash = mixHash(hash, value.charCodeAt(index));
  return hash >>> 0;
}

/** Resource history plus current extraction work, rendered without becoming simulation authority. */
export class ResourceSiteRenderer {
  readonly group = new THREE.Group();
  private readonly piles: THREE.InstancedMesh;
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private readonly scars: THREE.InstancedMesh;
  private readonly trails = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#796b4f', transparent: true, opacity: 0.42 }));
  private readonly footpaths: THREE.Mesh;
  private readonly activeWork = new THREE.Group();
  private readonly activeLogs: THREE.InstancedMesh;
  private readonly activeStumps: THREE.InstancedMesh;
  private readonly activeRocks: THREE.InstancedMesh;
  private readonly activeBaskets: THREE.InstancedMesh;
  private readonly activeBundles: THREE.InstancedMesh;
  private readonly activeHandles: THREE.InstancedMesh;
  private readonly activeHeads: THREE.InstancedMesh;
  private readonly activeRacks: THREE.InstancedMesh;
  private readonly normal = new THREE.Vector3();
  private readonly circleNormal = new THREE.Vector3(0, 0, 1);
  private readonly abandonedColour = new THREE.Color('#68734e');
  private pileRevision = -1;
  private scarRevision = -1;
  private trailRevision = -1;
  private pathRevision = -1;
  private activeWorkRevision = -1;

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface) {
    this.group.name = 'Resource extraction sites';
    this.piles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), Math.max(1, world.resourceDeposits.length));
    this.piles.count = 0; this.piles.castShadow = true; this.piles.receiveShadow = true;
    this.piles.frustumCulled = false;
    this.group.add(this.piles);

    this.activeWork.name = 'Active resource work sites';
    this.activeLogs = this.activeMesh(
      'Active resource logs',
      new THREE.CylinderGeometry(0.11, 0.13, 0.9, 7),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 }),
      MAX_ACTIVE_WORK_SITES * 4,
    );
    this.activeStumps = this.activeMesh(
      'Active resource stumps',
      new THREE.CylinderGeometry(0.18, 0.22, 0.28, 8),
      new THREE.MeshStandardMaterial({ color: '#a77b4d', roughness: 0.92 }),
      MAX_ACTIVE_WORK_SITES,
    );
    this.activeRocks = this.activeMesh(
      'Active resource rock and ore',
      new THREE.DodecahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0.06 }),
      MAX_SITE_DETAIL,
    );
    this.activeBaskets = this.activeMesh(
      'Active resource baskets',
      new THREE.CylinderGeometry(0.18, 0.13, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: '#94704a', roughness: 1 }),
      MAX_ACTIVE_WORK_SITES,
    );
    this.activeBundles = this.activeMesh(
      'Active resource plant bundles',
      new THREE.ConeGeometry(0.11, 0.34, 6),
      new THREE.MeshStandardMaterial({ color: '#627a45', roughness: 0.96 }),
      MAX_SITE_DETAIL,
    );
    this.activeHandles = this.activeMesh(
      'Active resource tool and rack handles',
      new THREE.BoxGeometry(0.035, 0.62, 0.035),
      new THREE.MeshStandardMaterial({ color: '#65503a', roughness: 0.9 }),
      MAX_ACTIVE_WORK_SITES * 2,
    );
    this.activeHeads = this.activeMesh(
      'Active resource tool heads',
      new THREE.BoxGeometry(0.2, 0.065, 0.09),
      new THREE.MeshStandardMaterial({ color: '#696c69', roughness: 0.72, metalness: 0.28 }),
      MAX_ACTIVE_WORK_SITES,
    );
    this.activeRacks = this.activeMesh(
      'Active resource drying racks',
      new THREE.BoxGeometry(0.58, 0.045, 0.045),
      new THREE.MeshStandardMaterial({ color: '#76502f', roughness: 0.94 }),
      MAX_ACTIVE_WORK_SITES,
    );
    this.activeWork.add(
      this.activeLogs,
      this.activeStumps,
      this.activeRocks,
      this.activeBaskets,
      this.activeBundles,
      this.activeHandles,
      this.activeHeads,
      this.activeRacks,
    );
    this.group.add(this.activeWork);

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
    const activeWorkRevision = this.activeResourceWorkRevision();
    if (activeWorkRevision !== this.activeWorkRevision) {
      this.activeWorkRevision = activeWorkRevision;
      this.rebuildActiveResourceWork();
    }

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

  private activeMesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private activeAssignments(): ResourceWorkAssignment[] {
    return [...resourceWorkAssignmentsForWorld(this.world)]
      .filter((assignment) => assignment.amountExtracted > 0 && assignment.labourUsed > 0)
      .sort((a, b) => b.labourUsed - a.labourUsed || b.amountExtracted - a.amountExtracted || a.siteId.localeCompare(b.siteId))
      .slice(0, MAX_ACTIVE_WORK_SITES);
  }

  private activeResourceWorkRevision(): number {
    let hash = HASH_OFFSET;
    const assignments = this.activeAssignments();
    hash = mixHash(hash, assignments.length);
    for (const assignment of assignments) {
      hash = mixHash(hash, stringHash(assignment.siteId));
      hash = mixHash(hash, stringHash(assignment.resourceId));
      // Month is intentionally not part of the visual revision. If the same work continues next
      // month at the same intensity, keep the existing geometry instead of rebuilding it.
      hash = mixHash(hash, Math.round(assignment.amountExtracted * 64));
      hash = mixHash(hash, Math.round(assignment.labourUsed * 64));
      hash = mixHash(hash, Math.round(assignment.worldPosition.x * 64));
      hash = mixHash(hash, Math.round(assignment.worldPosition.z * 64));
    }
    return hash;
  }

  private resourcePileRevision(): number {
    let hash = mixHash(HASH_OFFSET, this.world.environmentRevision ?? 0);
    hash = mixHash(hash, this.world.resourceDeposits.length);
    const activeDeposits = new Set(this.activeAssignments().flatMap((assignment) => assignment.depositId ? [assignment.depositId] : []));
    for (const id of activeDeposits) hash = mixHash(hash, stringHash(id));
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

  private rebuildActiveResourceWork(): void {
    const counts: ActiveCounts = { logs: 0, stumps: 0, rocks: 0, baskets: 0, bundles: 0, handles: 0, heads: 0, racks: 0 };
    const assignments = this.activeAssignments();
    let renderedSites = 0;
    for (const assignment of assignments) {
      const cell = assignment.cellIndex === undefined ? undefined : this.world.cells[assignment.cellIndex];
      if (cell?.water) continue;
      const angle = (stringHash(assignment.siteId) / 0xffffffff) * Math.PI * 2;
      const count = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(assignment.amountExtracted))));
      const kind = resourceWorkVisualKind(assignment);
      if (kind === 'timber') this.emitTimberWork(assignment, angle, count, counts);
      else if (kind === 'mineral') this.emitMineralWork(assignment, angle, count, counts);
      else if (kind === 'plant') this.emitPlantWork(assignment, angle, count, counts);
      else this.emitGenericWork(assignment, angle, count, counts);
      renderedSites += 1;
    }
    this.finishActiveMesh(this.activeLogs, counts.logs);
    this.finishActiveMesh(this.activeStumps, counts.stumps);
    this.finishActiveMesh(this.activeRocks, counts.rocks);
    this.finishActiveMesh(this.activeBaskets, counts.baskets);
    this.finishActiveMesh(this.activeBundles, counts.bundles);
    this.finishActiveMesh(this.activeHandles, counts.handles);
    this.finishActiveMesh(this.activeHeads, counts.heads);
    this.finishActiveMesh(this.activeRacks, counts.racks);
    this.activeWork.visible = renderedSites > 0;
    this.activeWork.userData['activeSiteCount'] = renderedSites;
    this.activeWork.userData['instanceCount'] = Object.values(counts).reduce((sum, value) => sum + value, 0);
    this.activeWork.userData['drawPoolCount'] = 8;
  }

  private emitTimberWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    this.emitInstance(this.activeStumps, counts.stumps++, assignment, angle, -0.34, 0.08, 0.14, 1, 1, 1, 0, 0, 0);
    for (let index = 0; index < count; index += 1) {
      const colour = index === 0 ? '#a77b4d' : '#76502f';
      this.emitInstance(
        this.activeLogs, counts.logs++, assignment, angle,
        0.18 + index * 0.08, (index % 2 ? 1 : -1) * (0.18 + index * 0.025),
        0.12 + Math.floor(index / 2) * 0.16,
        1, 0.8 + index * 0.08, 1,
        0, index * 0.14, Math.PI / 2,
        colour,
      );
    }
    this.emitTool(assignment, angle, -0.08, -0.34, 0.34, -0.52, true, counts);
  }

  private emitMineralWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    const colour = this.mineralColour(assignment.resourceId);
    for (let index = 0; index < count + 1; index += 1) {
      const scale = 0.8 + (index % 3) * 0.14;
      this.emitInstance(
        this.activeRocks, counts.rocks++, assignment, angle,
        -0.28 + index * 0.17, (index % 2 ? 1 : -1) * 0.18,
        0.12 + (index % 2) * 0.05,
        scale, scale, scale,
        index * 0.3, index * 0.6, index * 0.12,
        colour,
      );
    }
    this.emitInstance(this.activeBaskets, counts.baskets++, assignment, angle, 0.36, 0.3, 0.11, 1.15, 0.8, 1.15, 0, 0, 0);
    this.emitTool(assignment, angle, 0.05, -0.34, 0.34, -0.32, false, counts);
  }

  private emitPlantWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    this.emitInstance(this.activeBaskets, counts.baskets++, assignment, angle, 0.28, 0.18, 0.1, 1, 1, 1, 0, 0, 0);
    for (let index = 0; index < count + 1; index += 1) {
      this.emitInstance(
        this.activeBundles, counts.bundles++, assignment, angle,
        -0.28 + index * 0.16, (index % 2 ? 1 : -1) * 0.16, 0.16,
        1, 1, 1, 0, 0, (index % 2 ? 1 : -1) * 0.18,
      );
    }
    this.emitInstance(this.activeHandles, counts.handles++, assignment, angle, -0.35, -0.28, 0.22, 1, 0.72, 1, 0, 0, 0);
    this.emitInstance(this.activeHandles, counts.handles++, assignment, angle, 0.35, -0.28, 0.22, 1, 0.72, 1, 0, 0, 0);
    this.emitInstance(this.activeRacks, counts.racks++, assignment, angle, 0, -0.28, 0.42, 1, 1, 1, 0, 0, 0);
  }

  private emitGenericWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    for (let index = 0; index < count; index += 1) {
      this.emitInstance(
        this.activeRocks, counts.rocks++, assignment, angle,
        (index - count / 2) * 0.16, (index % 2 ? 1 : -1) * 0.14, 0.11,
        1, 1, 1, 0, index * 0.35, 0,
        '#8b857b',
      );
    }
  }

  private emitTool(
    assignment: ResourceWorkAssignment,
    angle: number,
    localX: number,
    localZ: number,
    localY: number,
    tilt: number,
    broadHead: boolean,
    counts: ActiveCounts,
  ): void {
    this.emitInstance(this.activeHandles, counts.handles++, assignment, angle, localX, localZ, localY, 1, 1, 1, 0, 0, tilt);
    const headX = localX - Math.sin(tilt) * 0.28;
    const headY = localY + Math.cos(tilt) * 0.28;
    this.emitInstance(
      this.activeHeads, counts.heads++, assignment, angle,
      headX, localZ, headY,
      broadHead ? 1.25 : 1, 1, broadHead ? 0.7 : 1,
      0, 0, tilt,
    );
  }

  private emitInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    assignment: ResourceWorkAssignment,
    siteAngle: number,
    localX: number,
    localZ: number,
    lift: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
    colour?: string,
  ): void {
    if (index >= mesh.instanceMatrix.count) return;
    const cos = Math.cos(siteAngle);
    const sin = Math.sin(siteAngle);
    const worldX = assignment.worldPosition.x + localX * cos - localZ * sin;
    const worldZ = assignment.worldPosition.z + localX * sin + localZ * cos;
    this.marker.position.set(worldX, this.surface.heightAt(worldX, worldZ) + lift, worldZ);
    this.marker.rotation.set(rotationX, siteAngle + rotationY, rotationZ);
    this.marker.scale.set(scaleX, scaleY, scaleZ);
    this.marker.updateMatrix();
    mesh.setMatrixAt(index, this.marker.matrix);
    if (colour) {
      this.colour.set(colour);
      mesh.setColorAt(index, this.colour);
    }
  }

  private finishActiveMesh(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = Math.min(count, mesh.instanceMatrix.count);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private mineralColour(resourceId: string): string {
    if (resourceId === 'stone') return '#8b857b';
    if (resourceId === 'copper-ore') return '#8e6f58';
    if (resourceId === 'iron-ore') return '#655e58';
    if (resourceId === 'coal') return '#383633';
    if (resourceId === 'clay') return '#9a7258';
    if (resourceId === 'uranium-ore') return '#6f7860';
    return '#6f665d';
  }

  private rebuildResourcePiles(): void {
    const activeDeposits = new Set(this.activeAssignments().flatMap((assignment) => assignment.depositId ? [assignment.depositId] : []));
    let index = 0;
    for (const d of this.world.resourceDeposits) {
      if (d.establishedMonth === undefined || activeDeposits.has(d.id)) continue;
      const cell = this.world.cells[d.cellIndex];
      if (!cell || cell.water || cell.slope > 0.54) continue;
      const category = RESOURCE_BY_ID.get(d.resourceId)?.category;
      const abandoned = d.abandonedMonth !== undefined || d.depleted;
      const height = abandoned ? 0.12 : category === 'timber' ? 0.3 : 0.5;
      this.marker.position.set(d.worldX, this.surface.heightAt(d.worldX, d.worldZ) + height * 0.4, d.worldZ);
      this.marker.rotation.set(0, 0, 0);
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
