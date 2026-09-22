import * as THREE from 'three';
import type { SimulationState, WorldState } from '../../sim/types';
import { ResourceFlowRenderer } from './ResourceFlowRenderer';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { RESOURCE_BY_ID } from '../../sim/resources/catalog';
import { resourceWorkDestinationId } from '../../sim/people/ResourceWorkRouting';
import { resourceWorkAssignmentsForWorld, type ResourceWorkAssignment } from '../../sim/resources/ResourceWorkAssignments';
import { resourceVisualUnit } from '../../sim/resources/ResourceWorkPresentation';
import { MAX_ACTIVE_WORK_SITES, ResourceWorkScene, type ResourceWorkSite } from './ResourceWorkScene';
import { resourceBundleGeometry, resourceLogGeometry } from './ResourceWorkGeometry';
import { mineralVisualProfile, type MineralGeometryKind } from './MineralPresentation';
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
const MAX_SITE_DETAIL = MAX_ACTIVE_WORK_SITES * 16;

interface ActiveCounts {
  logs: number;
  stumps: number;
  rocks: number;
  clods: number;
  coal: number;
  shards: number;
  crystals: number;
  fines: number;
  baskets: number;
  bundles: number;
  handles: number;
  heads: number;
  racks: number;
  structures: number;
  seams: number;
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
  private readonly discoveries: THREE.InstancedMesh;
  private readonly marker = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private readonly scars: THREE.InstancedMesh;
  private readonly historicalStumps: THREE.InstancedMesh;
  private readonly historicalFaces: THREE.InstancedMesh;
  private readonly trails = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#796b4f', transparent: true, opacity: 0.42 }));
  private readonly footpaths: THREE.Mesh;
  private readonly activeWork = new THREE.Group();
  private readonly activeLogs: THREE.InstancedMesh;
  private readonly activeStumps: THREE.InstancedMesh;
  private readonly activeRocks: THREE.InstancedMesh;
  private readonly activeClods: THREE.InstancedMesh;
  private readonly activeCoal: THREE.InstancedMesh;
  private readonly activeShards: THREE.InstancedMesh;
  private readonly activeCrystals: THREE.InstancedMesh;
  private readonly activeFines: THREE.InstancedMesh;
  private readonly activeBaskets: THREE.InstancedMesh;
  private readonly activeBundles: THREE.InstancedMesh;
  private readonly activeHandles: THREE.InstancedMesh;
  private readonly activeHeads: THREE.InstancedMesh;
  private readonly activeRacks: THREE.InstancedMesh;
  private readonly structures: THREE.InstancedMesh;
  private readonly seams: THREE.InstancedMesh;
  private readonly normal = new THREE.Vector3();
  private readonly circleNormal = new THREE.Vector3(0, 0, 1);
  private readonly abandonedColour = new THREE.Color('#68734e');
  private pileRevision = -1;
  private scarRevision = -1;
  private trailRevision = -1;
  private pathRevision = -1;
  private activeWorkRevision = -1;
  private emittingSite?: ResourceWorkSite;
  private readonly workScene: ResourceWorkScene;
  private readonly flows?: ResourceFlowRenderer;

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, workScene?: ResourceWorkScene, state?: SimulationState) {
    if (workScene) this.workScene = workScene;
    else {
      this.workScene = new ResourceWorkScene(world, 'resource-work', (x, z) => {
        const slopeX = (surface.heightAt(x + 0.1, z) - surface.heightAt(x - 0.1, z)) / 0.2;
        const slopeZ = (surface.heightAt(x, z + 0.1) - surface.heightAt(x, z - 0.1)) / 0.2;
        return Math.hypot(slopeX, slopeZ) <= Math.tan(40 * Math.PI / 180);
      });
    }
    this.group.name = 'Resource extraction sites';
    this.piles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), Math.max(1, world.resourceDeposits.length));
    this.piles.count = 0; this.piles.castShadow = true; this.piles.receiveShadow = true;
    this.piles.frustumCulled = false;
    this.group.add(this.piles);
    this.discoveries = this.activeMesh('Surveyed ore glints', new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.4,
        emissive: '#718174', emissiveIntensity: 0.12 }), 128);
    this.group.add(this.discoveries);

    this.activeWork.name = 'Active resource work sites';
    this.structures = this.activeMesh('Resource work infrastructure', new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88 }), MAX_ACTIVE_WORK_SITES * 24);
    this.seams = this.activeMesh('Discovered material seams', new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.45,
        emissive: '#b4c9b8', emissiveIntensity: 0.18 }), MAX_ACTIVE_WORK_SITES * 8);
    this.activeLogs = this.activeMesh(
      'Active resource logs',
      resourceLogGeometry(),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, vertexColors: true }),
      MAX_SITE_DETAIL,
    );
    this.activeStumps = this.activeMesh(
      'Active resource stumps',
      new THREE.CylinderGeometry(0.09, 0.12, 0.1, 8),
      new THREE.MeshStandardMaterial({ color: '#a77b4d', roughness: 0.92 }),
      MAX_ACTIVE_WORK_SITES,
    );
    this.activeRocks = this.activeMesh(
      'Active resource rock and clay',
      new THREE.DodecahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0.03 }),
      MAX_SITE_DETAIL,
    );
    this.activeClods = this.activeMesh(
      'Active extracted clay clods',
      new THREE.IcosahedronGeometry(0.22, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 }),
      MAX_SITE_DETAIL,
    );
    this.activeCoal = this.activeMesh(
      'Active extracted coal',
      new THREE.TetrahedronGeometry(0.23, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0.04 }),
      MAX_SITE_DETAIL,
    );
    this.activeShards = this.activeMesh(
      'Active extracted ore shards',
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0.22 }),
      MAX_SITE_DETAIL,
    );
    this.activeCrystals = this.activeMesh(
      'Active extracted crystal ore',
      new THREE.ConeGeometry(0.16, 0.38, 5),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.54, metalness: 0.2 }),
      MAX_SITE_DETAIL,
    );
    this.activeFines = this.activeMesh(
      'Active mineral fines and spoil',
      new THREE.CylinderGeometry(0.22, 0.3, 0.045, 9),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
      MAX_ACTIVE_WORK_SITES * 2,
    );
    this.activeBaskets = this.activeMesh(
      'Active resource baskets',
      new THREE.CylinderGeometry(0.065, 0.05, 0.07, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: '#94704a', roughness: 1, side: THREE.DoubleSide }),
      MAX_ACTIVE_WORK_SITES * 5,
    );
    this.activeBundles = this.activeMesh(
      'Active resource plant bundles',
      resourceBundleGeometry(),
      new THREE.MeshStandardMaterial({ color: '#627a45', roughness: 0.96 }),
      MAX_SITE_DETAIL,
    );
    this.activeHandles = this.activeMesh(
      'Active resource tool and rack handles',
      new THREE.BoxGeometry(0.035, 0.62, 0.035),
      new THREE.MeshStandardMaterial({ color: '#65503a', roughness: 0.9 }),
      MAX_SITE_DETAIL,
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
      this.activeClods,
      this.activeCoal,
      this.activeShards,
      this.activeCrystals,
      this.activeFines,
      this.activeBaskets,
      this.activeBundles,
      this.activeHandles,
      this.activeHeads,
      this.activeRacks,
      this.structures, this.seams,
    );
    this.group.add(this.activeWork);

    this.scars = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 9), new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), Math.max(1, world.cells.length));
    this.scars.count = 0; this.scars.frustumCulled = false;
    this.historicalStumps = this.activeMesh('Persistent logging stumps', new THREE.CylinderGeometry(0.11, 0.15, 0.13, 7),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), 768);
    this.historicalFaces = this.activeMesh('Persistent excavation faces', new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), 768);
    this.group.add(this.historicalStumps, this.historicalFaces);
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
    if (state) {
      this.flows = new ResourceFlowRenderer(state, surface, this.workScene);
      this.group.add(this.flows.group);
    }
  }

  update(): void {
    this.flows?.update();
    // Presentation work is invalidated by the visual facts it consumes, not by the calendar. This
    // method is still cheap to call monthly, but ordinary month rollover no longer allocates and
    // uploads replacement geometry for every extraction/path layer.
    this.workScene.update();
    const activeWorkRevision = this.workScene.revision;
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

  private resourcePileRevision(): number {
    let hash = mixHash(HASH_OFFSET, this.world.environmentRevision ?? 0);
    hash = mixHash(hash, this.world.resourceDeposits.length);
    const activeDeposits = new Set(this.activeAssignments().flatMap((assignment) => assignment.depositId ? [assignment.depositId] : []));
    for (const id of activeDeposits) hash = mixHash(hash, stringHash(id));
    for (let index = 0; index < this.world.resourceDeposits.length; index += 1) {
      const deposit = this.world.resourceDeposits[index]!;
      if (deposit.resourceId.includes('ore') && Object.keys(deposit.discoveredBy).length > 0) {
        hash = mixHash(hash, index + 1);
        hash = mixHash(hash, deposit.depleted || deposit.abundance <= 0 ? 0 : 1);
      }
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
    const counts: ActiveCounts = { logs: 0, stumps: 0, rocks: 0, clods: 0, coal: 0, shards: 0, crystals: 0, fines: 0,
      baskets: 0, bundles: 0, handles: 0, heads: 0, racks: 0, structures: 0, seams: 0 };
    let renderedSites = 0;
    const emitted = new Set<string>();
    for (const site of this.workScene.sites.values()) {
      const physicalSite = resourceWorkDestinationId(site.assignment);
      if (emitted.has(physicalSite)) continue;
      emitted.add(physicalSite);
      this.emittingSite = site;
      const assignment = site.assignment;
      const angle = resourceVisualUnit(`${this.workScene.seed}:${assignment.siteId}:props`) * Math.PI * 2;
      const count = site.profile.pileCount;
      const kind = site.profile.kind;
      if (kind === 'timber') this.emitTimberWork(assignment, angle, count, counts);
      else if (kind === 'mineral') this.emitMineralWork(assignment, angle, count, counts);
      else if (kind === 'plant') this.emitPlantWork(assignment, angle, count, counts);
      else this.emitGenericWork(assignment, angle, count, counts);
      this.emitWorkTargets(site, counts);
      this.emitInfrastructure(site, angle, counts);
      renderedSites += 1;
    }
    this.emittingSite = undefined;
    this.finishActiveMesh(this.activeLogs, counts.logs);
    this.finishActiveMesh(this.activeStumps, counts.stumps);
    this.finishActiveMesh(this.activeRocks, counts.rocks);
    this.finishActiveMesh(this.activeClods, counts.clods);
    this.finishActiveMesh(this.activeCoal, counts.coal);
    this.finishActiveMesh(this.activeShards, counts.shards);
    this.finishActiveMesh(this.activeCrystals, counts.crystals);
    this.finishActiveMesh(this.activeFines, counts.fines);
    this.finishActiveMesh(this.activeBaskets, counts.baskets);
    this.finishActiveMesh(this.activeBundles, counts.bundles);
    this.finishActiveMesh(this.activeHandles, counts.handles);
    this.finishActiveMesh(this.activeHeads, counts.heads);
    this.finishActiveMesh(this.activeRacks, counts.racks);
    this.finishActiveMesh(this.structures, counts.structures);
    this.finishActiveMesh(this.seams, counts.seams);
    this.activeWork.visible = renderedSites > 0;
    this.activeWork.userData['activeSiteCount'] = renderedSites;
    this.activeWork.userData['instanceCount'] = Object.values(counts).reduce((sum, value) => sum + value, 0);
    this.activeWork.userData['drawPoolCount'] = 15;
    this.activeWork.userData['rebuildCount'] = Number(this.activeWork.userData['rebuildCount'] ?? 0) + 1;
  }

  /** Silhouettes describe the actual material and capability; they never obstruct navigation. */
  private emitInfrastructure(site: ResourceWorkSite, angle: number, counts: ActiveCounts): void {
    const { assignment, profile: p } = site;
    const beam = (x: number, z: number, y: number, sx: number, sy: number, sz: number, colour = '#73563e') =>
      this.emitInstance(this.structures, counts.structures++, assignment, angle, x, z, y, sx, sy, sz, 0, 0, 0, colour);
    const ore = assignment.resourceId.includes('ore');
    if (p.kind === 'mineral') {
      // Low stepped rock faces and spoil grow only with authoritative reserve loss.
      for (let step = 0; step < 3; step++) beam(-0.23 + step * 0.17, -0.12, 0.035 + step * 0.035,
        0.17, 0.07 + p.excavation * 0.15, 0.4 - step * 0.06, ore ? '#514d48' : '#a19c8e');
      if (ore) for (let i = 0; i < 3; i++) this.emitInstance(this.seams, counts.seams++, assignment, angle,
        -0.2 + i * 0.12, -0.23, 0.11 + i * 0.03, 0.024, 0.04 + p.emphasis * 0.02, 0.018,
        0, i, 0, p.materialColour);
      if (p.excavation > 0.05) beam(-0.52, 0.2, 0.035, 0.3, 0.06 + p.excavation * 0.12, 0.25, '#746a59');
    }
    if (p.stage === 0) return;
    if (p.kind === 'timber') {
      // Saw trestles and a sorting bed, distinct from mine headframes and herb racks.
      for (const x of [-0.22, 0.22]) beam(x, -0.55, 0.14, 0.06, 0.28, 0.24);
      beam(0, -0.55, 0.29, 0.64, 0.055, 0.2, '#b58a58');
    } else if (p.kind === 'plant') {
      beam(0, -0.6, 0.38, 0.62, 0.025, 0.24, '#c1af76');
      for (const x of [-0.28, 0.28]) beam(x, -0.6, 0.2, 0.035, 0.4, 0.035);
    } else {
      for (const x of [-0.27, 0.27]) beam(x, -0.5, 0.25, 0.065, 0.5, 0.065);
      beam(0, -0.5, 0.51, 0.66, 0.07, 0.08);
      if (ore) beam(0, -0.51, 0.15, 0.4, 0.28, 0.025, '#302d2a');
    }
    if (p.stage < 2) return;
    // Ordered storage rails indicate practiced extraction and a real workshop capability.
    for (const z of [-0.15, 0.3]) beam(0.64, z, 0.035, 0.38, 0.055, 0.035);
    for (const x of [0.46, 0.82]) beam(x, 0.08, 0.13, 0.035, 0.26, 0.035);
    if (p.stage < 3) return;
    // Raised hoist/shelter frame requires wheel-and-axle practice as well as workshops.
    for (const x of [-0.3, 0.3]) beam(x, -0.65, 0.38, 0.055, 0.76, 0.055, '#626a6b');
    beam(0, -0.65, 0.77, 0.72, 0.07, 0.24, '#626a6b');
    beam(0, -0.65, 0.5, 0.018, 0.5, 0.018, '#b9a27b');
  }

  private emitTimberWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    this.emitInstance(this.activeStumps, counts.stumps++, assignment, angle, -0.52, 0.08, 0.05, 1, 1, 1, 0, 0, 0);
    for (let index = 0; index < count; index += 1) {
      const colour = '#ffffff';
      this.emitInstance(
        this.activeLogs, counts.logs++, assignment, angle,
        0.62 + (index % 2) * 0.09, (index % 2 ? 1 : -1) * 0.055,
        0.035 + Math.floor(index / 2) * 0.07,
        0.32, 0.5 + index * 0.035, 0.32,
        0, this.emittingSite?.developed ? 0 : index * 0.14, Math.PI / 2,
        colour,
      );
    }
    this.emitTool(assignment, angle, -0.08, -0.34, 0.1, -0.52, true, counts);
  }

  private emitMineralWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    const profile = mineralVisualProfile(assignment.resourceId);
    const mesh = this.mineralMesh(profile.geometry);
    for (let index = 0; index < count + 1; index += 1) {
      const scale = 0.2 + (index % 3) * 0.085;
      const localX = 0.52 + (index % 3) * 0.105;
      const localZ = (index % 2 ? 1 : -1) * (0.065 + (index % 3) * 0.012);
      const lift = 0.032 + Math.floor(index / 3) * 0.06;
      const meshIndex = this.nextMineralCount(counts, profile.geometry);
      this.emitInstance(
        mesh, meshIndex, assignment, angle,
        localX, localZ, lift,
        scale * profile.scale[0], scale * profile.scale[1], scale * profile.scale[2],
        profile.tilt * (index % 2 ? 1 : -1) + index * 0.12, index * 0.67, index * 0.19,
        index % 2 ? profile.secondaryColour : profile.baseColour,
      );
      if (profile.accentStrength > 0.2 && index < 2) {
        this.emitInstance(this.seams, counts.seams++, assignment, angle,
          localX + 0.018, localZ - 0.01, lift + scale * profile.scale[1] * 0.13,
          0.015 + profile.accentStrength * 0.012, 0.022 + profile.accentStrength * 0.018, 0.012,
          index * 0.4, index * 0.8, profile.tilt, profile.accentColour);
      }
    }
    // A shallow fines/spoil bed makes fresh extraction read as broken material rather than loose props.
    this.emitInstance(this.activeFines, counts.fines++, assignment, angle, 0.63, 0, 0.016,
      0.75 + profile.scale[0] * 0.2, 0.55, 0.62 + profile.scale[2] * 0.18, 0, 0, 0, profile.secondaryColour);
    this.emitInstance(this.activeBaskets, counts.baskets++, assignment, angle, 0.62, 0.24, 0.04, 1.15, 0.8, 1.15, 0, 0, 0);
    this.emitTool(assignment, angle, 0.05, -0.34, 0.1, -0.32, false, counts);
  }

  private emitPlantWork(assignment: ResourceWorkAssignment, angle: number, count: number, counts: ActiveCounts): void {
    this.emitInstance(this.activeBaskets, counts.baskets++, assignment, angle, 0.6, 0.18, 0.035, 1, 1, 1, 0, 0, 0);
    for (let index = 0; index < count + 1; index += 1) {
      this.emitInstance(
        this.activeBundles, counts.bundles++, assignment, angle,
        0.48 + index * 0.065, (index % 2 ? 1 : -1) * 0.08, 0.05,
        1, 1, 1, 0, 0, (index % 2 ? 1 : -1) * 0.18,
      );
    }
    this.emitInstance(this.activeHandles, counts.handles++, assignment, angle, -0.2, -0.6, 0.12, 0.65, 0.4, 0.65, 0, 0, 0);
    this.emitInstance(this.activeHandles, counts.handles++, assignment, angle, 0.2, -0.6, 0.12, 0.65, 0.4, 0.65, 0, 0, 0);
    this.emitInstance(this.activeRacks, counts.racks++, assignment, angle, 0, -0.6, 0.25, 0.75, 1, 1, 0, 0, 0);
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

  private mineralMesh(kind: MineralGeometryKind): THREE.InstancedMesh {
    if (kind === 'clod') return this.activeClods;
    if (kind === 'coal') return this.activeCoal;
    if (kind === 'shard') return this.activeShards;
    if (kind === 'crystal') return this.activeCrystals;
    return this.activeRocks;
  }

  private nextMineralCount(counts: ActiveCounts, kind: MineralGeometryKind): number {
    if (kind === 'clod') return counts.clods++;
    if (kind === 'coal') return counts.coal++;
    if (kind === 'shard') return counts.shards++;
    if (kind === 'crystal') return counts.crystals++;
    return counts.rocks++;
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
    this.emitInstance(this.activeHandles, counts.handles++, assignment, angle, localX, localZ, localY, 0.3, 0.3, 0.3, 0, 0, tilt);
    const headX = localX - Math.sin(tilt) * 0.084;
    const headY = localY + Math.cos(tilt) * 0.084;
    this.emitInstance(
      this.activeHeads, counts.heads++, assignment, angle,
      headX, localZ, headY,
      broadHead ? 0.375 : 0.3, 0.3, broadHead ? 0.21 : 0.3,
      0, 0, tilt,
      this.emittingSite?.profile.toolColour,
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
    const origin = this.emittingSite?.origin ?? assignment.worldPosition;
    const worldX = origin.x + localX * cos - localZ * sin;
    const worldZ = origin.z + localX * sin + localZ * cos;
    if (!this.workScene.safeSegment(origin, { x: worldX, z: worldZ })) {
      // Hide an unsafe detail, never strand props beyond the walkable edge.
      scaleX = 0; scaleY = 0; scaleZ = 0;
    }
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

  private emitWorkTargets(site: ResourceWorkSite, counts: ActiveCounts): void {
    const { assignment, origin, profile } = site;
    // Each station has an explicit contact surface. These are current-work documentary props.
    for (const station of site.stations) {
      const x = station.target.x - origin.x, z = station.target.z - origin.z;
      if (profile.kind === 'timber') {
        if (!site.standingTree) this.emitInstance(this.activeLogs, counts.logs++, assignment, 0, x, z, 0.045, 0.32, 0.2, 0.32, Math.PI / 2, station.facing + Math.PI / 2, 0, '#ffffff');
        // Branch slash beside the work face, in the existing shared handle pool.
        this.emitInstance(this.activeHandles, counts.handles++, assignment, 0, x + 0.06, z + 0.04, 0.018, 0.45, 0.24, 0.45, Math.PI / 2, station.facing + 0.6, 0);
      } else if (profile.kind === 'mineral') {
        const material = mineralVisualProfile(assignment.resourceId);
        const mesh = this.mineralMesh(material.geometry);
        const meshIndex = this.nextMineralCount(counts, material.geometry);
        this.emitInstance(mesh, meshIndex, assignment, 0, x, z, 0.035,
          0.3 * material.scale[0], 0.32 * material.scale[1], 0.3 * material.scale[2],
          material.tilt, station.facing, 0, material.baseColour);
      } else if (profile.kind === 'plant') {
        this.emitInstance(this.activeBundles, counts.bundles++, assignment, 0, x, z, 0.05, 1.3, 0.85, 1.3, 0, station.facing, 0);
      }
      if (profile.kind === 'plant' || profile.kind === 'mineral') this.emitInstance(this.activeBaskets, counts.baskets++, assignment, 0,
        station.anchor.x - origin.x + Math.cos(station.facing) * 0.11,
        station.anchor.z - origin.z - Math.sin(station.facing) * 0.11, 0.035, 0.85, 0.85, 0.85, 0, station.facing, 0);
    }
    if (profile.kind === 'mineral') {
      const material = mineralVisualProfile(assignment.resourceId);
      const mesh = this.mineralMesh(material.geometry);
      const meshIndex = this.nextMineralCount(counts, material.geometry);
      this.emitInstance(mesh, meshIndex, assignment, 0, 0, 0, 0.05,
        0.7 * material.scale[0], (0.42 + profile.intensity * 0.35) * material.scale[1], 0.7 * material.scale[2],
        material.tilt, 0.3, 0, material.baseColour);
    }
    const propsAngle = resourceVisualUnit(`${this.workScene.seed}:${assignment.siteId}:props`) * Math.PI * 2;
    if (profile.kind === 'plant') for (let i = 0; i < profile.pileCount; i++) {
      this.emitInstance(this.activeBundles, counts.bundles++, assignment, propsAngle, -0.14 + i * 0.09, -0.6, 0.19,
        0.8, 0.9, 0.8, Math.PI, 0, 0);
    }
  }

  private rebuildResourcePiles(): void {
    const activeDeposits = new Set(this.activeAssignments().flatMap((assignment) => assignment.depositId ? [assignment.depositId] : []));
    let index = 0;
    this.discoveries.count = 0;
    for (const d of this.world.resourceDeposits) {
      if (d.resourceId.includes('ore') && Object.keys(d.discoveredBy).length > 0 && !d.depleted && d.abundance > 0
        && this.discoveries.count < this.discoveries.instanceMatrix.count
        && this.workScene.safeSegment({ x: d.worldX, z: d.worldZ }, { x: d.worldX, z: d.worldZ })) {
        this.marker.position.set(d.worldX, this.surface.heightAt(d.worldX, d.worldZ) + 0.075, d.worldZ);
        this.marker.rotation.set(0, resourceVisualUnit(d.id) * Math.PI, 0.3);
        this.marker.scale.set(0.065, 0.1, 0.045); this.marker.updateMatrix();
        this.discoveries.setMatrixAt(this.discoveries.count, this.marker.matrix);
        this.colour.set(mineralVisualProfile(d.resourceId).accentColour);
        this.discoveries.setColorAt(this.discoveries.count++, this.colour);
      }
      if (d.establishedMonth === undefined || activeDeposits.has(d.id)) continue;
      const cell = this.world.cells[d.cellIndex];
      if (!cell || cell.water || cell.slope > 0.54) continue;
      const category = RESOURCE_BY_ID.get(d.resourceId)?.category;
      const abandoned = d.abandonedMonth !== undefined || d.depleted;
      const height = abandoned ? 0.12 : category === 'timber' ? 0.3 : 0.5;
      this.marker.position.set(d.worldX, this.surface.heightAt(d.worldX, d.worldZ) + height * 0.4, d.worldZ);
      this.marker.rotation.set(0, 0, 0);
      const mineral = mineralVisualProfile(d.resourceId);
      this.marker.scale.set(category === 'timber' ? 1.5 : category === 'mineral' ? 0.9 * mineral.scale[0] : 0.9,
        category === 'mineral' ? height * mineral.scale[1] : height,
        category === 'mineral' ? 0.8 * mineral.scale[2] : 0.8);
      this.marker.rotation.set(category === 'mineral' ? mineral.tilt : 0, resourceVisualUnit(`${d.id}:pile`) * Math.PI, 0);
      this.marker.updateMatrix();
      this.piles.setMatrixAt(index, this.marker.matrix);
      this.colour.set(abandoned ? '#514b43' : category === 'timber' ? '#89623c' : category === 'plant' ? '#627b45' : mineral.baseColour);
      this.piles.setColorAt(index++, this.colour);
    }
    this.piles.count = index; this.piles.instanceMatrix.needsUpdate = true;
    if (this.piles.instanceColor) this.piles.instanceColor.needsUpdate = true;
    this.discoveries.instanceMatrix.needsUpdate = true;
    if (this.discoveries.instanceColor) this.discoveries.instanceColor.needsUpdate = true;
  }

  private rebuildLandScars(): void {
    let scarIndex = 0;
    this.historicalStumps.count = this.historicalFaces.count = 0;
    for (const cell of this.world.cells) {
      if (cell.water || !cell.modifications) continue;
      const use = cell.modifications;
      const kind = use.quarry ? 'quarry' : use.mine ? 'mine' : use.industry ? 'industry' : use.ruin ? 'ruin' : use.farmland ? 'farmland' : use.logging ? 'logging' : undefined;
      if (!kind) continue;
      const mark = use[kind]!;
      if (mark.intensity < 0.01) continue;
      if (kind === 'logging' || kind === 'quarry' || kind === 'mine') {
        const mesh = kind === 'logging' ? this.historicalStumps : this.historicalFaces;
        const count = Math.min(3, Math.ceil(mark.intensity * 3));
        for (let i = 0; i < count && mesh.count < mesh.instanceMatrix.count; i++) {
          const angle = resourceVisualUnit(`${cell.x}:${cell.z}:history:${i}`) * Math.PI * 2;
          const x = cell.worldX + Math.cos(angle) * this.world.cellSize * 0.18;
          const z = cell.worldZ + Math.sin(angle) * this.world.cellSize * 0.18;
          if (!this.workScene.safeSegment({ x, z }, { x, z })) continue;
          const strength = Math.max(0.15, mark.intensity);
          this.marker.position.set(x, this.surface.heightAt(x, z) + 0.045 * strength, z);
          this.marker.rotation.set(0, angle, 0);
          this.marker.scale.set(kind === 'logging' ? 0.7 : 0.3, kind === 'logging' ? strength : 0.12 * strength, kind === 'logging' ? 0.7 : 0.25);
          this.marker.updateMatrix(); mesh.setMatrixAt(mesh.count, this.marker.matrix);
          this.colour.set(kind === 'logging' ? '#a27f54' : kind === 'mine' ? '#696258' : '#a09a88');
          if (mark.abandonedMonth !== undefined) this.colour.lerp(this.abandonedColour, 1 - strength);
          mesh.setColorAt(mesh.count++, this.colour);
        }
      }
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
    for (const mesh of [this.historicalStumps, this.historicalFaces]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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
