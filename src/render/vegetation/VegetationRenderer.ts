import * as THREE from 'three';
import { SeededRandom, stableHash } from '../../sim/prng';
import { tornadoExposure } from '../../sim/weather/Tornado';
import { cellAt } from '../../sim/world';
import type { Settlement, TornadoState, Vec2, WorldState } from '../../sim/types';
import type { ResourceWorkAssignment } from '../../sim/resources/ResourceWorkAssignments';
import type { ResourceWorkTreeTarget } from '../resources/ResourceWorkScene';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import { AmbientBirds } from './AmbientBirds';
import { planForest, resolveForestSuccession, resolveTreeLifecycle, type ResolvedTreeLifecycle, type TreePlacement } from './ForestPlanner';
import { FlowerField } from './FlowerField';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR, type TreeFamily, type TreeVariant } from './TreeLibrary';
import { resolveTreeMorphology, resolveTreePhenotype, type TreeMorphology, type TreePhenotype } from './TreeMorphology';
import { resolveTreePhenology, treeFoliageColour } from './TreePhenology';
import { bindTreeMaterial } from './TreeMaterials';
import { insideVegetationTerrain } from './VegetationPlacement';
import { BioluminescentFlora } from './BioluminescentFlora';
import { DEFAULT_ECOLOGY_QUALITY, type EcologyField, type EcologyQuality } from '../ecology/EcologyField';

export interface VegetationReport {
  trees: number;
  significantTrees: number;
  near: number;
  far: number;
  cleared: number;
  underwater: number;
  flowers: { placed: number; visible: number };
  drawCalls: number;
  triangles: number;
  byFamily: Record<TreeFamily, number>;
  bioluminescence?: { planned: number; flora: number; motes: number; drawCalls: number };
}

interface Bucket {
  family: TreeFamily;
  variant: number;
  bark: THREE.InstancedMesh;
  foliage: THREE.InstancedMesh;
  capacity: number;
  count: number;
  crownHeight: number;
  barkState: THREE.InstancedBufferAttribute;
  canopyState: THREE.InstancedBufferAttribute;
}

interface DisturbanceZone {
  id: string;
  x: number;
  z: number;
  radius: number;
}

interface RecoveryZone extends DisturbanceZone {
  releasedYear: number;
}

const VARIANTS_PER_FAMILY = 3;
/** Placements closer than this to the camera get the detailed tier. */
const NEAR_RANGE = 40;
const NEAR_CAPACITY_PER_BUCKET = 220;
/** Spare cherry instances allow settlements founded after renderer construction to plant trees. */
const MANAGED_CHERRY_RESERVE_PER_VARIANT = 512;
const MANAGED_TREE_SCALE = 2.5;
const RECOVERY_ZONE_RETENTION_YEARS = 80;
const MAX_RECOVERY_ZONES = 128;
const ROOT_PLATE_CAPACITY = 512;

/**
 * The forest. Trees are planned once, then drawn through two instanced tiers whose membership is
 * re-sorted by camera distance a few times a second: high perceived density, bounded triangles.
 * Settlement plantings join the same placement/lifecycle pool instead of using decorative meshes.
 */
export class VegetationRenderer {
  readonly group = new THREE.Group();
  private readonly placements: TreePlacement[];
  private readonly workTreesByCell = new Map<number, number[]>();
  private readonly workTreeBuckets: Array<Bucket | undefined> = [];
  private readonly workTreeSlots: number[] = [];
  private readonly impactedTrees: number[] = [];
  private readonly phenotypes: TreePhenotype[];
  private readonly nearBuckets = new Map<string, Bucket>();
  private readonly farBuckets = new Map<string, Bucket>();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly crownOffset = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly tiltEuler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly fallenAxis = new THREE.Vector3(0, 0, 1);
  private disturbance: DisturbanceZone[] = [];
  private readonly recoveryZones = new Map<string, RecoveryZone>();
  private readonly managedSettlementIds = new Set<string>();
  private readonly lifecycle: ResolvedTreeLifecycle[];
  private readonly flowers: FlowerField;
  private readonly birds: AmbientBirds;
  private readonly luminousFlora?: BioluminescentFlora;
  private readonly rootPlates: THREE.InstancedMesh;
  private readonly rootPlateTriangles: number;
  private rootPlateCount = 0;
  private ecologyYear = 0;
  private season = 0;
  private targetSeason = 0;
  private lastCalendarMonth: number | undefined;
  private previousElapsed = 0;
  private clearedCount = 0;
  private nearCount = 0;
  private farCount = 0;
  private readonly triangleCost = new Map<string, { near: number; far: number }>();
  private readonly byFamily: Record<TreeFamily, number>;
  private readonly leaves = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#c99435', size: 0.075, transparent: true, opacity: 0.8, depthWrite: false }));
  private readonly leafSites: { tree: TreePlacement; height: number; blossom: boolean }[] = [];
  private readonly particleColour = new THREE.Color();
  private occupiedGround: { x: number; z: number; radius: number }[] = [];
  private scarSignature = '';
  private readonly scarsByCell = new Map<number, TornadoState[]>();

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, private readonly seed: string, budget: number, anchors: readonly { x: number; z: number }[] = [], ecology?: EcologyField, quality: EcologyQuality = DEFAULT_ECOLOGY_QUALITY) {
    this.group.name = 'vegetation';
    this.leaves.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    this.leaves.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    this.leaves.name = 'seasonal-falling-leaves-and-petals';
    this.leaves.material.color.set('#ffffff');
    this.leaves.material.vertexColors = true;
    this.leaves.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_particle_fragment>',
        '#include <map_particle_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.25, 0.5, length(gl_PointCoord - vec2(0.5)));');
    };
    this.leaves.geometry.setDrawRange(0, 0);
    this.leaves.frustumCulled = false;
    this.group.add(this.leaves);

    const rootGeometry = new THREE.CylinderGeometry(0.5, 0.38, 0.18, 8, 1);
    rootGeometry.rotateZ(Math.PI * 0.5);
    const rootMaterial = new THREE.MeshStandardMaterial({ color: '#514131', roughness: 0.98, metalness: 0 });
    this.rootPlates = new THREE.InstancedMesh(rootGeometry, rootMaterial, Math.max(1, Math.min(ROOT_PLATE_CAPACITY, budget)));
    this.rootPlates.name = 'tree-uprooted-root-plates';
    this.rootPlates.userData['weatherSurface'] = true;
    this.rootPlates.castShadow = true;
    this.rootPlates.receiveShadow = true;
    this.rootPlates.frustumCulled = false;
    this.rootPlates.count = 0;
    this.rootPlates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rootPlateTriangles = (rootGeometry.index?.count ?? rootGeometry.getAttribute('position').count) / 3;
    this.group.add(this.rootPlates);

    const plan = planForest(world, surface, seed, budget, VARIANTS_PER_FAMILY, anchors);
    this.placements = plan.trees;
    this.placements.forEach((tree, index) => {
      const cell = cellAt(world, tree.worldX, tree.worldZ);
      if (!cell) return;
      const key = cell.z * world.size + cell.x;
      const bucket = this.workTreesByCell.get(key) ?? [];
      bucket.push(index);
      this.workTreesByCell.set(key, bucket);
    });
    this.phenotypes = this.placements.map((placement) => resolveTreePhenotype(seed, placement));
    this.byFamily = plan.byFamily;
    this.lifecycle = this.placements.map((placement) => resolveTreeLifecycle(placement, this.ecologyYear));
    const flowerBudget = budget <= 0 ? 0 : Math.max(400, Math.min(2800, Math.round(budget * 0.8)));
    this.flowers = new FlowerField(world, surface, `${seed}:flowers`, flowerBudget, this.placements);
    this.birds = new AmbientBirds(seed, this.placements);
    this.group.add(this.flowers.group, this.birds.group);
    if (ecology && budget > 0) {
      this.luminousFlora = new BioluminescentFlora(world, surface, seed, this.placements, ecology, quality);
      this.group.add(this.luminousFlora.group);
    }

    const nearLibrary = buildTreeLibrary(seed, VARIANTS_PER_FAMILY, TREE_LOD_NEAR);
    const farLibrary = buildTreeLibrary(seed, VARIANTS_PER_FAMILY, TREE_LOD_FAR);
    const counts = new Map<string, number>();
    for (const placement of this.placements) {
      const key = bucketKey(placement.family, placement.variant);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const [family, nearVariants] of nearLibrary) {
      for (let variant = 0; variant < nearVariants.length; variant += 1) {
        const key = bucketKey(family, variant);
        const total = counts.get(key) ?? 0;
        const reserve = family === 'cherry' ? MANAGED_CHERRY_RESERVE_PER_VARIANT : 0;
        const near = nearVariants[variant];
        const far = farLibrary.get(family)?.[variant];
        if (!near || !far) continue;
        if (total === 0 && reserve === 0) {
          near.bark.dispose(); near.foliage.dispose(); far.bark.dispose(); far.foliage.dispose();
          continue;
        }
        const capacity = total + reserve;
        this.nearBuckets.set(key, this.createBucket(family, variant, near, Math.min(capacity, NEAR_CAPACITY_PER_BUCKET)));
        this.farBuckets.set(key, this.createBucket(family, variant, far, capacity));
        this.triangleCost.set(key, { near: triangleCount(near), far: triangleCount(far) });
      }
    }
  }

  get report(): VegetationReport {
    let triangles = 0;
    for (const [key, bucket] of this.nearBuckets) triangles += bucket.count * (this.triangleCost.get(key)?.near ?? 0);
    for (const [key, bucket] of this.farBuckets) triangles += bucket.count * (this.triangleCost.get(key)?.far ?? 0);
    const flowerReport = this.flowers.report;
    return {
      trees: this.placements.length,
      significantTrees: this.placements.filter((placement) => placement.id !== undefined).length,
      near: this.nearCount,
      far: this.farCount,
      cleared: this.clearedCount,
      underwater: this.placements.filter(placement => this.surface.waterYAt(placement.worldX, placement.worldZ) > placement.y).length,
      flowers: { placed: flowerReport.placements, visible: flowerReport.visible },
      drawCalls: [...this.nearBuckets.values(), ...this.farBuckets.values()].filter(bucket => bucket.count > 0).length * 2
        + flowerReport.drawCalls + (this.leaves.geometry.drawRange.count > 0 ? 1 : 0) + (this.rootPlateCount > 0 ? 1 : 0)
        + (this.luminousFlora?.report.drawCalls ?? 0),
      triangles: triangles + this.rootPlateCount * this.rootPlateTriangles + flowerReport.triangles + (this.luminousFlora?.report.triangles ?? 0),
      byFamily: { ...this.byFamily },
      bioluminescence: this.luminousFlora?.report,
    };
  }


  /**
   * Camera collision query against the same deterministic tree placements that are actually drawn.
   * This is intentionally a lens-volume test, not a general physics system: CameraDirector uses it
   * only to keep the viewer out of trunks/crowns while retaining its documentary composition.
   */
  cameraLensObstruction(position: THREE.Vector3, padding = 0.16): number {
    const cell = cellAt(this.world, position.x, position.z);
    if (!cell) return 0;

    const reach = Math.max(1, Math.ceil((3.6 + padding) / Math.max(0.25, this.world.cellSize)));
    let obstruction = 0;

    for (let row = Math.max(0, cell.z - reach); row <= Math.min(this.world.size - 1, cell.z + reach); row += 1) {
      for (let column = Math.max(0, cell.x - reach); column <= Math.min(this.world.size - 1, cell.x + reach); column += 1) {
        for (const index of this.workTreesByCell.get(row * this.world.size + column) ?? []) {
          const tree = this.placements[index];
          const bucket = this.workTreeBuckets[index];
          const lifecycle = this.lifecycle[index];
          const phenotype = this.phenotypes[index];
          if (!tree || !bucket || !lifecycle || !phenotype || lifecycle.fallen) continue;

          const morphology = resolveTreeMorphology(phenotype, lifecycle);
          const renderedHeight = Math.max(
            0.8,
            bucket.crownHeight * lifecycle.scale * Math.max(morphology.trunkHeight, morphology.crownHeight),
          );
          const localY = position.y - tree.y;
          if (localY < -padding || localY > renderedHeight + padding) continue;

          const radialDistance = Math.hypot(position.x - tree.worldX, position.z - tree.worldZ);
          const trunkRadius = bucket.crownHeight * 0.044 * (tree.family === 'ancient' ? 1.9 : 1)
            * lifecycle.scale * (morphology.trunkRadiusX + morphology.trunkRadiusZ) * 0.5;
          const crownRadius = renderedHeight * 0.19
            * Math.max(morphology.crownWidthX, morphology.crownWidthZ);
          const trunkHit = radialDistance < trunkRadius + padding;
          const crownHit = lifecycle.foliageVisible
            && localY > renderedHeight * 0.12 - padding
            && radialDistance < crownRadius + padding;
          if (!trunkHit && !crownHit) continue;

          const radius = Math.max(trunkRadius, crownHit ? crownRadius : trunkRadius) + padding;
          const radialOverlap = 1 - clamp01(radialDistance / Math.max(0.01, radius));
          const verticalOverlap = 1 - clamp01(Math.abs(localY - renderedHeight * 0.52) / Math.max(0.4, renderedHeight * 0.62));
          obstruction = Math.max(obstruction, 1.5 + radialOverlap * 2.5 + verticalOverlap);
        }
      }
    }

    return obstruction;
  }

  /**
   * Foot-level collision against the same deterministic trunks that are actually rendered.
   * Crowns remain non-solid for pedestrians; fallen or cleared trees do not block movement.
   */
  pedestrianSegmentClear(a: Vec2, b: Vec2, padding = 0.1): boolean {
    const midpoint = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const cell = cellAt(this.world, midpoint.x, midpoint.z);
    if (!cell) return true;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const reach = Math.max(1, Math.ceil((length * 0.5 + 0.7) / Math.max(0.25, this.world.cellSize)));
    for (let row = Math.max(0, cell.z - reach); row <= Math.min(this.world.size - 1, cell.z + reach); row += 1) {
      for (let column = Math.max(0, cell.x - reach); column <= Math.min(this.world.size - 1, cell.x + reach); column += 1) {
        for (const index of this.workTreesByCell.get(row * this.world.size + column) ?? []) {
          const tree = this.placements[index];
          const lifecycle = this.lifecycle[index];
          const phenotype = this.phenotypes[index];
          if (!tree || !lifecycle || !phenotype || lifecycle.fallen || this.isCleared(tree)) continue;
          const morphology = resolveTreeMorphology(phenotype, lifecycle);
          const height = this.nearBuckets.get(bucketKey(tree.family, tree.variant))?.crownHeight ?? 1;
          const trunkRadius = height * 0.044 * (tree.family === 'ancient' ? 1.9 : 1)
            * lifecycle.scale * (morphology.trunkRadiusX + morphology.trunkRadiusZ) * 0.5;
          if (distanceToGroundSegment(a, b, tree.worldX, tree.worldZ) < trunkRadius + padding) return false;
        }
      }
    }
    return true;
  }

  /**
   * Cities eat the woodland around them. When a city dies, its disturbed footprint restarts as a
   * new stand and visibly progresses through regrowth, young woodland and mature forest.
   */
  setDisturbance(settlements: readonly Settlement[], artifacts: readonly { x: number; z: number; radius: number }[] = []): void {
    this.occupiedGround = settlements.flatMap(settlement => (settlement.structurePlots ?? []).map(plot =>
      ({ x: plot.worldX, z: plot.worldZ, radius: plot.radius + 0.35 })));
    this.occupiedGround.push(...artifacts);
    this.syncManagedPlantings(settlements);
    const currentYear = Math.floor((this.world.weather?.month ?? this.ecologyYear * 12) / 12);
    const previous = new Map(this.disturbance.map((zone) => [zone.id, zone]));
    const next = settlements
      .filter((settlement) => settlement.alive && (!settlement.foundingPodId || settlement.buildings > 0))
      .map((settlement) => ({
        id: settlement.id,
        x: settlement.position.x,
        z: settlement.position.z,
        radius: 3.4 + Math.sqrt(Math.max(1, settlement.buildings)) * 0.72 + settlement.urbanization * 4.2,
      }));
    const activeIds = new Set(next.map((zone) => zone.id));

    for (const zone of previous.values()) {
      if (activeIds.has(zone.id)) continue;
      const recovery: RecoveryZone = { ...zone, releasedYear: currentYear };
      this.recoveryZones.set(zone.id, recovery);
      this.restartStandInside(recovery);
    }
    for (const zone of next) this.recoveryZones.delete(zone.id);
    this.trimRecoveryZones(currentYear);
    this.disturbance = next;
  }

  setSeason(season: number): void {
    this.targetSeason = ((season % 12) + 12) % 12;
    if (this.lastCalendarMonth === undefined || Math.abs(season - this.lastCalendarMonth) > 3) this.season = this.targetSeason;
    this.lastCalendarMonth = season;
  }

  /** A whole forest ecology pass happens at most once per simulation year. */
  setEcologyYear(year: number): void {
    if (year === this.ecologyYear) return;
    this.ecologyYear = year;
    this.birds.setEcologyYear(year);
    this.trimRecoveryZones(year);
    for (let index = 0; index < this.placements.length; index += 1) {
      const placement = this.placements[index];
      if (!placement) continue;
      this.lifecycle[index] = resolveTreeLifecycle(placement, year);
    }
  }

  /** Re-sorts every placement into the near or far tier. Called at the structural update rate. */
  updateLod(camera: THREE.Vector3): void {
    this.birds.setCamera(camera);
    this.leafSites.length = 0;
    const scars = this.world.weather?.forestScars ?? [];
    const signature = `${scars.length}:${scars[0]?.id}:${scars.at(-1)?.id}`;
    if (signature !== this.scarSignature) {
      this.scarSignature = signature;
      this.scarsByCell.clear();
      for (const scar of scars) {
        const grid = (coordinate: number): number => Math.max(0, Math.min(this.world.size - 1, Math.floor(coordinate / this.world.cellSize + this.world.size / 2)));
        const minX = grid(Math.min(...scar.path.map((point) => point.x)) - scar.width - this.world.cellSize);
        const maxX = grid(Math.max(...scar.path.map((point) => point.x)) + scar.width + this.world.cellSize);
        const minZ = grid(Math.min(...scar.path.map((point) => point.z)) - scar.width - this.world.cellSize);
        const maxZ = grid(Math.max(...scar.path.map((point) => point.z)) + scar.width + this.world.cellSize);
        for (let row = minZ; row <= maxZ; row += 1) {
          for (let column = minX; column <= maxX; column += 1) {
            const index = row * this.world.size + column;
            const bucket = this.scarsByCell.get(index) ?? [];
            bucket.push(scar);
            this.scarsByCell.set(index, bucket);
          }
        }
      }
    }
    this.workTreeBuckets.fill(undefined);
    this.impactedTrees.length = 0;
    for (const bucket of this.nearBuckets.values()) bucket.count = 0;
    for (const bucket of this.farBuckets.values()) bucket.count = 0;
    this.rootPlateCount = 0;
    this.clearedCount = 0;
    this.nearCount = 0;
    this.farCount = 0;

    for (let index = 0; index < this.placements.length; index += 1) {
      const placement = this.placements[index];
      if (!placement) continue;
      if (this.isCleared(placement)) {
        if (!placement.id && !placement.managedBy) {
          placement.establishedYear = this.ecologyYear;
          this.lifecycle[index] = resolveTreeLifecycle(placement, this.ecologyYear);
        }
        this.clearedCount += 1;
        continue;
      }
      let lifecycle = this.lifecycle[index] ?? resolveTreeLifecycle(placement, this.ecologyYear);
      const recoveryLifecycle = this.lifecycleDuringRecovery(placement);
      if (recoveryLifecycle === null) {
        this.clearedCount += 1;
        continue;
      }
      if (recoveryLifecycle) lifecycle = recoveryLifecycle;

      const key = bucketKey(placement.family, placement.variant);
      const distance = Math.hypot(placement.worldX - camera.x, placement.worldZ - camera.z);
      const nearBucket = this.nearBuckets.get(key);
      const target = distance < NEAR_RANGE && nearBucket && nearBucket.count < nearBucket.capacity ? nearBucket : this.farBuckets.get(key);
      if (!target || target.count >= target.capacity) continue;
      const cell = cellAt(this.world, placement.worldX, placement.worldZ);
      if (cell && (cell.lastLoggingMonth !== undefined || cell.modifications) && !placement.id && !placement.managedBy) {
        const standing = clamp01(cell.wood / Math.max(0.01, cell.forestCapacity ?? cell.wood));
        const rank = stableHash(`${this.seed}:logging-tree`, Math.round(placement.worldX * 100), Math.round(placement.worldZ * 100));
        if (rank > standing) {
          placement.establishedYear = this.ecologyYear;
          this.lifecycle[index] = resolveTreeLifecycle(placement, this.ecologyYear);
          this.clearedCount++;
          continue;
        }
      }
      const weather = cell ? this.world.weather?.cells[cell.z * this.world.size + cell.x] : undefined;
      for (const scar of cell ? this.scarsByCell.get(cell.z * this.world.size + cell.x) ?? [] : []) {
        const exposure = tornadoExposure(scar, { x: placement.worldX, z: placement.worldZ });
        if (exposure * scar.intensity < stableHash(`${this.seed}:tornado-tree`, Math.round(placement.worldX * 100), Math.round(placement.worldZ * 100))) continue;
        if (scar.month > (this.world.weather?.month ?? 0)) continue;
        placement.disturbedYear = Math.max(placement.disturbedYear ?? -Infinity, scar.month / 12);
      }
      const windthrown = weather && stableHash(`${this.seed}:windthrow`, Math.round(placement.worldX * 100), Math.round(placement.worldZ * 100))
        < weather.treeDamage * (0.6 + placement.age * 0.4);
      if (windthrown && weather.lastWindthrowMonth >= 0 && weather.lastWindthrowMonth <= (this.world.weather?.month ?? 0)) {
        placement.disturbedYear = Math.max(placement.disturbedYear ?? -Infinity, weather.lastWindthrowMonth / 12);
      }
      if (placement.disturbedYear !== undefined) lifecycle = resolveTreeLifecycle(placement, (this.world.weather?.month ?? this.ecologyYear * 12) / 12);
      const phenotype = this.phenotypes[index] ?? resolveTreePhenotype(this.seed, placement);
      const morphology = resolveTreeMorphology(phenotype, lifecycle);
      this.workTreeBuckets[index] = target;
      this.workTreeSlots[index] = target.count;
      this.write(target, placement, lifecycle, phenotype, morphology);
      if (lifecycle.fallen && distance < NEAR_RANGE && this.shouldShowRootPlate(placement, phenotype)) {
        this.writeRootPlate(placement, lifecycle, phenotype);
      }
      if (distance < 24 && this.leafSites.length < 96 && lifecycle.foliageVisible && !windthrown && cell) {
        const phase = resolveTreePhenology(this.season, cell, weather ?? cell, placement.family, phenotype.phenology);
        if (phase.leafFall > 0.2 || phase.blossom > 0.3) {
          const blossom = phase.blossom > 0.3;
          for (let particle = 0; particle < (blossom ? 4 : 2) && this.leafSites.length < 96; particle++) {
            this.leafSites.push({ tree: placement, height: lifecycle.scale * target.crownHeight * morphology.crownHeight * 0.82, blossom });
          }
        }
      }
      if (target === nearBucket) this.nearCount += 1;
      else this.farCount += 1;
    }

    for (const bucket of [...this.nearBuckets.values(), ...this.farBuckets.values()]) {
      bucket.bark.count = bucket.count;
      bucket.foliage.count = bucket.count;
      bucket.bark.instanceMatrix.needsUpdate = true;
      bucket.foliage.instanceMatrix.needsUpdate = true;
      bucket.barkState.needsUpdate = true;
      bucket.canopyState.needsUpdate = true;
      if (bucket.foliage.instanceColor) bucket.foliage.instanceColor.needsUpdate = true;
    }
    this.rootPlates.count = this.rootPlateCount;
    this.rootPlates.instanceMatrix.needsUpdate = true;
    const winter = this.targetSeason < 1 || this.targetSeason >= 10;
    this.flowers.update(camera, winter ? this.targetSeason : this.season, [...this.disturbance, ...this.occupiedGround]);
    this.luminousFlora?.updateLod(camera, this.world.weather?.month ?? this.ecologyYear * 12 + this.targetSeason, [...this.disturbance, ...this.occupiedGround]);
  }

  /** Read existing tree placements only; harvesting animations can never remove a tree. */
  resourceWorkTree(assignment: ResourceWorkAssignment): ResourceWorkTreeTarget | undefined {
    const cell = cellAt(this.world, assignment.worldPosition.x, assignment.worldPosition.z);
    if (!cell) return undefined;
    const standing = clamp01(cell.wood / Math.max(0.01, cell.forestCapacity ?? cell.wood));
    let best: TreePlacement | undefined;
    let distance = 1.2;
    let radius = 0;
    let renderId = -1;
    for (const index of this.workTreesByCell.get(cell.z * this.world.size + cell.x) ?? []) {
      const tree = this.placements[index]!;
      if (tree.id || tree.managedBy || this.isCleared(tree) || this.lifecycleDuringRecovery(tree) === null) continue;
      const lifecycle = this.lifecycleDuringRecovery(tree) ?? resolveTreeLifecycle(tree, this.ecologyYear);
      if (lifecycle.fallen || !lifecycle.foliageVisible) continue;
      if ((cell.lastLoggingMonth !== undefined || cell.modifications)
        && stableHash(`${this.seed}:logging-tree`, Math.round(tree.worldX * 100), Math.round(tree.worldZ * 100)) > standing) continue;
      const candidateDistance = Math.hypot(tree.worldX - assignment.worldPosition.x, tree.worldZ - assignment.worldPosition.z);
      if (candidateDistance >= distance) continue;
      const morphology = resolveTreeMorphology(this.phenotypes[index]!, lifecycle);
      const height = this.nearBuckets.get(bucketKey(tree.family, tree.variant))?.crownHeight ?? 1;
      radius = height * 0.044 * (tree.family === 'ancient' ? 1.9 : 1) * lifecycle.scale
        * (morphology.trunkRadiusX + morphology.trunkRadiusZ) * 0.5;
      best = tree; distance = candidateDistance; renderId = index;
    }
    return best ? { x: best.worldX, z: best.worldZ, radius, renderId } : undefined;
  }

  /** Touch only the bounded set of trees struck last frame. No tree or site scans. */
  beginResourceImpacts(): void {
    for (const index of this.impactedTrees) {
      const bucket = this.workTreeBuckets[index], slot = this.workTreeSlots[index];
      if (!bucket || slot === undefined) continue;
      bucket.barkState.setW(slot, 0); bucket.canopyState.setW(slot, 0);
      bucket.barkState.needsUpdate = true; bucket.canopyState.needsUpdate = true;
    }
    this.impactedTrees.length = 0;
  }

  resourceImpact(renderId: number, strength: number): void {
    const bucket = this.workTreeBuckets[renderId], slot = this.workTreeSlots[renderId];
    if (!bucket || slot === undefined || strength <= 0 || this.impactedTrees.length >= 256) return;
    if (bucket.barkState.getW(slot) === 0) this.impactedTrees.push(renderId);
    const amount = Math.max(bucket.barkState.getW(slot), Math.min(1, strength));
    bucket.barkState.setW(slot, amount); bucket.canopyState.setW(slot, amount);
    bucket.barkState.needsUpdate = true; bucket.canopyState.needsUpdate = true;
  }

  setViewport(height: number, pixelRatio: number): void { this.luminousFlora?.setViewport(height, pixelRatio); }

  updateLeaves(elapsed: number): void {
    const delta = Math.max(0, Math.min(1, elapsed - this.previousElapsed));
    this.previousElapsed = elapsed;
    const difference = ((this.targetSeason - this.season + 18) % 12) - 6;
    this.season = (this.season + difference * (1 - Math.exp(-delta * 1.5)) + 12) % 12;
    const positions = this.leaves.geometry.getAttribute('position');
    const colours = this.leaves.geometry.getAttribute('color');
    const wind = this.world.weather;
    for (let index = 0; index < this.leafSites.length; index += 1) {
      const { tree, height, blossom } = this.leafSites[index]!;
      const phase = (elapsed * 0.15 + tree.rotation + index * 0.618) % 1;
      const x = tree.worldX + Math.sin(elapsed + index) * 0.35 + phase * (wind?.windX ?? 1) * 0.8;
      const z = tree.worldZ + Math.cos(elapsed * 0.8 + index) * 0.3 + phase * (wind?.windZ ?? 0) * 0.8;
      const ground = this.surface.heightAt(x, z);
      positions.setXYZ(index, x, Math.max(ground + 0.02, tree.y + height * (1 - phase)), z);
      this.particleColour.set(blossom ? '#efb6c9' : '#c99435');
      colours.setXYZ(index, this.particleColour.r, this.particleColour.g, this.particleColour.b);
    }
    positions.needsUpdate = true;
    colours.needsUpdate = true;
    this.leaves.geometry.setDrawRange(0, this.leafSites.length);
    this.birds.update(elapsed, wind?.wind ?? 0, [...this.disturbance, ...this.occupiedGround]);
  }

  private syncManagedPlantings(settlements: readonly Settlement[]): void {
    const living = new Map(settlements.filter((settlement) => settlement.alive).map((settlement) => [settlement.id, settlement]));
    const currentYear = Math.floor((this.world.weather?.month ?? this.ecologyYear * 12) / 12);

    for (let index = this.placements.length - 1; index >= 0; index -= 1) {
      const placement = this.placements[index];
      if (!placement?.managedBy || living.has(placement.managedBy)) continue;
      this.byFamily[placement.family] = Math.max(0, this.byFamily[placement.family] - 1);
      this.placements.splice(index, 1);
      this.lifecycle.splice(index, 1);
      this.phenotypes.splice(index, 1);
    }
    for (const settlementId of [...this.managedSettlementIds]) {
      if (!living.has(settlementId)) this.managedSettlementIds.delete(settlementId);
    }

    for (const settlement of living.values()) {
      if (this.managedSettlementIds.has(settlement.id)) continue;
      this.managedSettlementIds.add(settlement.id);
      const random = new SeededRandom(`${this.seed}:managed-cherry:${settlement.id}`);
      const count = 1 + (random.chance(0.55) ? 1 : 0) + (random.chance(0.25) ? 1 : 0);
      const foundedYear = Math.floor(settlement.foundedMonth / 12);
      const settlementRadius = 3.4 + Math.sqrt(Math.max(1, settlement.buildings)) * 0.72 + settlement.urbanization * 4.2;
      const innerRadius = Math.max(4.6, settlementRadius * 0.72);
      const outerRadius = Math.max(innerRadius + 1.8, settlementRadius * 1.08);
      for (let tree = 0; tree < count; tree += 1) {
        let placement: TreePlacement | undefined;
        for (let attempt = 0; attempt < 32; attempt += 1) {
          const angle = random.range(0, Math.PI * 2) + attempt * 2.399;
          const radius = random.range(innerRadius, outerRadius) + Math.sqrt(attempt) * 0.18;
          const worldX = settlement.position.x + Math.cos(angle) * radius;
          const worldZ = settlement.position.z + Math.sin(angle) * radius;
          if (!insideVegetationTerrain(this.world, worldX, worldZ, 0.3)) continue;
          const sample = this.surface.sample(worldX, worldZ);
          if (sample.slope > 0.48 || sample.temperature < 0.28 || sample.moisture < 0.28) continue;
          if (this.occupiedGround.some((plot) => Math.hypot(worldX - plot.x, worldZ - plot.z) < plot.radius + 0.65)) continue;
          if (this.placements.some(existing => Math.hypot(worldX - existing.worldX, worldZ - existing.worldZ) < 0.9)) continue;
          const y = this.surface.heightAt(worldX, worldZ);
          const waterY = this.surface.waterYAt(worldX, worldZ);
          if (Number.isFinite(waterY) && waterY > y - 0.05) continue;
          const establishedYear = Math.min(currentYear, foundedYear + random.int(0, 3));
          placement = {
            managedBy: settlement.id,
            worldX,
            worldZ,
            y,
            family: 'cherry',
            variant: random.int(0, VARIANTS_PER_FAMILY),
            scale: MANAGED_TREE_SCALE * random.range(0.82, 1.16),
            rotation: random.range(0, Math.PI * 2),
            age: random.float() * 0.35,
            establishedYear,
            lifespanYears: random.int(65, 116),
            regrowth: 0.9,
          };
          break;
        }
        if (!placement) continue;
        this.placements.push(placement);
        this.lifecycle.push(resolveTreeLifecycle(placement, currentYear));
        this.phenotypes.push(resolveTreePhenotype(this.seed, placement));
        this.byFamily.cherry += 1;
      }
    }
  }

  private restartStandInside(zone: RecoveryZone): void {
    for (let index = 0; index < this.placements.length; index += 1) {
      const placement = this.placements[index];
      if (!placement || placement.family === 'ancient' || placement.managedBy === zone.id) continue;
      if (Math.hypot(placement.worldX - zone.x, placement.worldZ - zone.z) >= zone.radius) continue;
      placement.establishedYear = zone.releasedYear;
      delete placement.disturbedYear;
      placement.age = 0;
      this.lifecycle[index] = resolveTreeLifecycle(placement, zone.releasedYear);
    }
  }

  private lifecycleDuringRecovery(placement: TreePlacement): ResolvedTreeLifecycle | null | undefined {
    if (placement.id) return undefined;
    let recovery: RecoveryZone | undefined;
    for (const zone of this.recoveryZones.values()) {
      if (placement.managedBy === zone.id) continue;
      if (Math.hypot(placement.worldX - zone.x, placement.worldZ - zone.z) >= zone.radius) continue;
      if (!recovery || zone.releasedYear > recovery.releasedYear) recovery = zone;
    }
    if (!recovery) return undefined;
    const years = Math.max(0, this.ecologyYear - recovery.releasedYear);
    const succession = resolveForestSuccession(years, placement.regrowth);
    if (succession === 'cleared') return null;
    if (succession === 'regrowth') {
      const progress = clamp01(years / 12);
      return { stage: 'sapling', scale: placement.scale * (0.16 + progress * 0.22), foliageVisible: true, fallen: false, maturity: progress * 0.12 };
    }
    if (succession === 'young-woodland') {
      const progress = clamp01((years - 10) / 34);
      return { stage: 'young', scale: placement.scale * (0.48 + progress * 0.34), foliageVisible: true, fallen: false, maturity: 0.12 + progress * 0.24 };
    }
    return undefined;
  }

  private trimRecoveryZones(year: number): void {
    for (const [id, zone] of this.recoveryZones) {
      if (year - zone.releasedYear > RECOVERY_ZONE_RETENTION_YEARS) this.recoveryZones.delete(id);
    }
    while (this.recoveryZones.size > MAX_RECOVERY_ZONES) {
      let oldest: RecoveryZone | undefined;
      for (const zone of this.recoveryZones.values()) {
        if (!oldest || zone.releasedYear < oldest.releasedYear) oldest = zone;
      }
      if (!oldest) break;
      this.recoveryZones.delete(oldest.id);
    }
  }

  private createBucket(family: TreeFamily, variant: number, source: TreeVariant, capacity: number): Bucket {
    const barkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
    const foliageMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const bark = new THREE.InstancedMesh(source.bark, barkMaterial, Math.max(1, capacity));
    const foliage = new THREE.InstancedMesh(source.foliage, foliageMaterial, Math.max(1, capacity));
    const barkState = bindTreeMaterial(bark, 'bark', family, source.height);
    const canopyState = bindTreeMaterial(foliage, 'foliage', family, source.height);
    foliage.name = 'weather-foliage';
    bark.castShadow = true;
    bark.receiveShadow = true;
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    bark.frustumCulled = false;
    foliage.frustumCulled = false;
    bark.count = 0;
    foliage.count = 0;
    bark.name = `tree-bark:${family}:${variant}`;
    bark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    foliage.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    foliage.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    this.group.add(bark, foliage);
    return { family, variant, bark, foliage, barkState, canopyState, capacity: Math.max(1, capacity), count: 0, crownHeight: source.height };
  }

  private write(bucket: Bucket, placement: TreePlacement, lifecycle: ResolvedTreeLifecycle,
    phenotype: TreePhenotype, morphology: TreeMorphology): void {
    this.position.set(placement.worldX, placement.y, placement.worldZ);
    this.quaternion.setFromAxisAngle(this.axis, placement.rotation);
    if (lifecycle.fallen) {
      this.position.y += lifecycle.scale * 0.055;
      this.tilt.setFromAxisAngle(this.fallenAxis, morphology.fallAngle);
      this.quaternion.multiply(this.tilt);
    }
    else {
      this.tiltEuler.set(morphology.leanZ, 0, -morphology.leanX, 'XYZ');
      this.tilt.setFromEuler(this.tiltEuler);
      this.quaternion.multiply(this.tilt);
    }

    this.scale.set(
      lifecycle.scale * morphology.trunkRadiusX,
      lifecycle.scale * morphology.trunkHeight,
      lifecycle.scale * morphology.trunkRadiusZ,
    );
    this.matrix.compose(this.position, this.quaternion, this.scale);
    bucket.bark.setMatrixAt(bucket.count, this.matrix);
    bucket.barkState.setXYZW(bucket.count, morphology.barkBreakFraction, morphology.barkWeathering,
      phenotype.pigment * Math.PI * 2, 0);
    bucket.canopyState.setXYZW(bucket.count, 0, 0, 0, 0);

    if (lifecycle.foliageVisible) {
      const cell = cellAt(this.world, placement.worldX, placement.worldZ);
      const weather = cell ? this.world.weather?.cells[cell.z * this.world.size + cell.x] : undefined;
      const canopy = cell ? resolveTreePhenology(this.season, cell, weather ?? cell,
        placement.family, phenotype.phenology).canopy : 1;
      // Leaves emerge and recede around their own twigs, keeping the crown/scaffold anchored.
      // Scaling the entire crown pulled autumn foliage away from its branches into a tiny ball.
      const size = Math.cbrt(clamp01(canopy * morphology.foliageDensity));
      bucket.canopyState.setX(bucket.count, size);
      this.position.set(placement.worldX, placement.y, placement.worldZ);
      this.crownOffset.set(
        morphology.crownOffsetX * lifecycle.scale,
        morphology.crownLift * lifecycle.scale,
        morphology.crownOffsetZ * lifecycle.scale,
      ).applyAxisAngle(this.axis, placement.rotation);
      this.position.add(this.crownOffset);
      this.scale.set(
        lifecycle.scale * morphology.crownWidthX,
        lifecycle.scale * morphology.crownHeight,
        lifecycle.scale * morphology.crownWidthZ,
      );
      this.matrix.compose(this.position, this.quaternion, this.scale);
      bucket.foliage.setMatrixAt(bucket.count, this.matrix);
    }
    else {
      this.scale.setScalar(0.0001);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      bucket.foliage.setMatrixAt(bucket.count, this.matrix);
    }
    bucket.foliage.setColorAt(bucket.count, this.foliageTint(placement, lifecycle, phenotype));
    bucket.count += 1;
  }

  private shouldShowRootPlate(placement: TreePlacement, phenotype: TreePhenotype): boolean {
    const disturbedYear = placement.disturbedYear;
    if (disturbedYear === undefined) return false;
    const displayYear = (this.world.weather?.month ?? this.ecologyYear * 12) / 12;
    if (!placement.id && (displayYear < disturbedYear || displayYear >= disturbedYear + 3)) return false;
    const threshold: Record<TreeFamily, number> = {
      cherry: 0.5,
      broadleaf: 0.54,
      birch: 0.48,
      conifer: 0.42,
      dry: 0.64,
      riverbank: 0.48,
      alpine: 0.52,
      ancient: 0.58,
    };
    return phenotype.uprooting > threshold[placement.family];
  }

  private writeRootPlate(placement: TreePlacement, lifecycle: ResolvedTreeLifecycle, phenotype: TreePhenotype): void {
    if (this.rootPlateCount >= this.rootPlates.instanceMatrix.count) return;
    this.position.set(placement.worldX, placement.y + lifecycle.scale * 0.22, placement.worldZ);
    this.quaternion.setFromAxisAngle(this.axis, placement.rotation);
    this.tiltEuler.set(0, 0, phenotype.fallBias * 0.14, 'XYZ');
    this.tilt.setFromEuler(this.tiltEuler);
    this.quaternion.multiply(this.tilt);
    this.scale.set(
      lifecycle.scale * (0.42 + Math.abs(phenotype.fallBias) * 0.08),
      lifecycle.scale * phenotype.girth * 0.86,
      lifecycle.scale * phenotype.girth * (0.72 + phenotype.fullness * 0.08),
    );
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.rootPlates.setMatrixAt(this.rootPlateCount, this.matrix);
    this.rootPlateCount += 1;
  }

  private foliageTint(placement: TreePlacement, lifecycle: ResolvedTreeLifecycle, phenotype: TreePhenotype): THREE.Color {
    const cell = cellAt(this.world, placement.worldX, placement.worldZ);
    const weather = cell ? this.world.weather?.cells[cell.z * this.world.size + cell.x] : undefined;
    const climate = cell ?? { temperature: 0.46, moisture: 0.5 };
    const phase = resolveTreePhenology(this.season, climate, weather ?? climate, placement.family, phenotype.phenology);
    treeFoliageColour(placement.family, phase, phenotype.pigment, this.tint, climate.moisture);
    const development = lifecycle.ageYears !== undefined && lifecycle.mortalityAge !== undefined
      ? clamp01(lifecycle.ageYears / Math.max(1, lifecycle.mortalityAge))
      : lifecycle.maturity;
    const establishment = smoothstep(0, 0.3, development);
    const senescence = smoothstep(0.76, 1, development);
    const vitality = lifecycle.foliageVisible ? (0.84 + establishment * 0.18) * (1 - senescence * 0.12) : 0.76;
    this.tint.multiplyScalar(vitality);
    const shade = 0.92 + clamp01(placement.scale - 0.6) * 0.16;
    this.tint.multiplyScalar(shade);
    return this.tint;
  }

  private isCleared(placement: TreePlacement): boolean {
    if (this.occupiedGround.some(plot => Math.hypot(placement.worldX - plot.x, placement.worldZ - plot.z) < plot.radius)) return true;
    for (const zone of this.disturbance) {
      if (placement.managedBy === zone.id) continue;
      const distance = Math.hypot(placement.worldX - zone.x, placement.worldZ - zone.z);
      if (distance < zone.radius && !(placement.family === 'ancient' && distance > zone.radius * 0.45)) return true;
    }
    return false;
  }
}

function distanceToGroundSegment(a: Vec2, b: Vec2, x: number, z: number): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

function bucketKey(family: TreeFamily, variant: number): string {
  return `${family}#${variant}`;
}

function triangleCount(variant: TreeVariant): number {
  const bark = variant.bark.getIndex()?.count ?? 0;
  const foliage = variant.foliage.getIndex()?.count ?? 0;
  return (bark + foliage) / 3;
}
