import { deriveDetailTier, type TierOptions } from './DerivedLod';
/**
 * AssetBuilder.ts
 * 
 * Factory and cache for procedural asset generation.
 * Ensures deterministic, reusable asset creation keyed by (type, culture, era, variant).
 */

import * as THREE from 'three';
import type { CultureStyle } from '../../sim/types';
import type { GeneratorKind } from '../../sim/energy/types';
import { MaterialPalette, type Era } from '../materials/MaterialPalette';
import { CultureStyleProfileFactory, SettlementStyleProfile } from '../style/CultureStyleProfile';
import type { CultureStyleProfile } from '../style/CultureStyleProfile';
import { ProceduralGeometry } from './ProceduralGeometry';
import { developmentBuildingRole, developmentPresentationEra, priorFabricGeneration, resolveBuildingGrammar, type BuildingGrammar, type BuildingGrammarContext, type BuildingRole } from './BuildingGrammar';
import { BUILD_STAGE, composeBuilding, type BuildStage } from './BuildingComposer';
import { SeededRandom } from '../../sim/prng';
import type { DevelopmentProject, DevelopmentResponse, StructureMaterial } from '../../sim/development/types';
import type { SettlementArchitecturalIdentity } from '../../sim/development/SettlementIdentity';
import { buildStructureComponentManifest } from './StructureComponents';
import { structureVisualHistorySignature } from './StructureVisualSignature';
import { deriveArchitecturalGenerations, generationForCurrentFabric, generationForOriginFabric } from './StructureGenerations';
import { deriveStructureHeritage } from './StructureHeritage';
import { resolveBuildingSpec, type BuildingSpec, type BuildingSpecContext } from '../architecture/BuildingSpec';
import type { BuildingArchetype } from '../architecture/BuildingArchetype';
import { grammarFromBuildingSpec } from '../architecture/SpecGrammarBridge';
import { dedicatedGeometryKind } from '../architecture/DedicatedStructures';
import { materialBillSignature } from '../architecture/MaterialSourcing';
import { FacadeTextureCache } from '../architecture/FacadeTextures';
import { PreparationWorker } from './PreparationWorker';
import { ProgressiveBuildingLod } from './ProgressiveBuildingLod';
import { unpackGeometry, type PreparedMesh } from './PreparedGeometry';
import { unpackBuilding, type PreparedBuilding } from './PreparedBuilding';

/** Free a composition that was superseded before it was ever cached or shared. */
function disposeComposed(group: THREE.Object3D): void {
  group.traverse(object => { if (object instanceof THREE.Mesh && !object.geometry.userData['shared']) object.geometry.dispose(); });
}

/** The generation an upgrade grows out from, compactly: it bounds the new spec's envelope. */
function priorSignature(development: DevelopmentResponse | undefined): string {
  const prior = development ? priorFabricGeneration(development) : undefined;
  return prior ? `${prior.need}/${prior.form}/${prior.level}/${prior.material}/${[...(prior.technology ?? [])].sort().join(',')}` : '';
}

/** Response reasons that change which archetype routing picks, and so belong in the cache key. */
const ROUTING_REASONS = new Set(['hand-milled-grain', 'perimeter-defence']);

export type AssetType = 'tree' | 'building' | 'humanoid' | 'terrain-deco' | 'infrastructure';

export interface AssetConfig {
  /** Authoritative generator, when this building belongs to an energy plant. */
  energyKind?: GeneratorKind;
  /**
   * Banded fabric condition of the plot (`conditionBand`). Drives surface weathering only; the
   * building's dimensions never depend on it.
   */
  condition?: number;
  development?: DevelopmentResponse;
  seed: string;
  culture: CultureStyle;
  era: Era;
  variant?: string;
  scale?: number;
  customData?: Record<string, unknown>;
  /** Settlement-specific architectural drift layered on the culture's baseline style. */
  settlementIdentity?: SettlementArchitecturalIdentity;
  /** Average terrain slope under the plot's footprint, for a slope-responsive foundation. */
  localSlopeDegrees?: number;
  /** Climate/flood/landmark context that further shapes grammar beyond culture and identity. */
  grammarContext?: BuildingGrammarContext;
  /**
   * The live construction project, when there is one. Carries the exact bill of materials the
   * settlement consumed, which is the strongest evidence the architecture system has for what a
   * building is actually made of.
   */
  project?: DevelopmentProject;
  /** 0..1 settlement prosperity. Gates expensive construction materials. */
  prosperity?: number;
  /** Economic specialization, which earns a structure its working fittings. */
  specialization?: 'agriculture' | 'forestry' | 'mining' | 'craft' | 'exchange';
  /**
   * The settlement sits on a coast, lake or navigable river. Routes a freight depot to a quay.
   */
  waterfront?: boolean;
  /**
   * Request one specific architectural archetype.
   *
   * Only for the subsystems that own a structure the development system never produces — a
   * bridge belongs to TransportationSystem, a perimeter wall to settlement dressing. Ordinary
   * buildings leave this unset and are routed from their authoritative response instead.
   */
  archetype?: BuildingArchetype;
}

export interface CachedAsset {
  mesh: THREE.Object3D;
  material: THREE.Material;
  lods: THREE.Object3D[]; // LOD variants
  config: AssetConfig;
  createdAt: number;
  lastAccessedAt: number;
}

export interface AssetCacheStats {
  entries: number;
  maxEntries: number;
  buildingEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  prunes: number;
  evictions: number;
  materialPalettes: number;
  cultureProfiles: number;
}

/** Switching distances (world units) for full detail, street, settlement and skyline tiers. */
export const LOD_DISTANCES = [0, 20, 42, 96] as const;
/** Fraction of each switching distance kept as a dead band, so a slow camera never flickers a tier. */
const LOD_HYSTERESIS = 0.08;
/** Narrowest solid (canonical units) kept in each derived tier: about 1.5 px at its switching distance. */
export const LOD_TIERS: readonly TierOptions[] = [{ minFeature: 0.016 }, { minFeature: 0.04, merge: false }, { minFeature: 0.07, fillOpenings: true }];



/**
 * Central factory for creating procedural assets
 * Caches results to avoid redundant generation
 */
export class AssetBuilder {
  readonly facadeTextures: FacadeTextureCache;
  private readonly cache: Map<string, CachedAsset>;
  private readonly materialPalettes: Map<string, MaterialPalette>;
  private readonly cultureProfiles: Map<string, CultureStyleProfile>;
  private maxCacheSize: number = 900; // Prevent unbounded memory growth
  private cacheClock = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private cachePrunes = 0;
  private cacheEvictions = 0;
  private nightFactor = 0;
  private readonly lodWorker?: PreparationWorker;
  private disposed = false;
  private pendingLods = 0;
  private failedLods = 0;
  private readonly pendingBuildings = new Map<string, Promise<void>>();
  private readonly adoptionTimes: number[] = [];
  private preparationFailed = false;
  private readonly preparationOwners = new Map<string, Set<string>>();

  constructor(globalSeed: string = 'assets', options: { facadeEntries?: number; facadeResolution?: number; backgroundPreparation?: boolean } = {}) {
    this.facadeTextures = new FacadeTextureCache(options.facadeEntries, options.facadeResolution, undefined, options.backgroundPreparation);
    if (options.backgroundPreparation !== false && PreparationWorker.available()) this.lodWorker = new PreparationWorker();
    void globalSeed;
    this.cache = new Map();
    this.materialPalettes = new Map();
    this.cultureProfiles = new Map();
  }

  /**
   * Generate or retrieve a cached asset
   */
  getAsset(
    type: AssetType,
    config: AssetConfig,
  ): { mesh: THREE.Object3D; lods: THREE.Object3D[] } {
    const cacheKey = this.getCacheKey(type, config);

    // Check cache first. Touching the entry turns pruning into LRU rather than creation-order FIFO.
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      cached.lastAccessedAt = this.cacheClock++;
      this.cacheHits++;
      return {
        mesh: cached.mesh,
        lods: cached.lods,
      };
    }
    this.cacheMisses++;

    // Generate new asset
    let asset: { mesh: THREE.Object3D; lods: THREE.Object3D[]; material: THREE.Material } | null =
      null;

    switch (type) {
      case 'tree':
        asset = this.generateTree(config);
        break;
      case 'building':
        asset = this.generateBuilding(config);
        break;
      case 'humanoid':
        asset = this.generateHumanoid(config);
        break;
      case 'terrain-deco':
        asset = this.generateTerrainDeco(config);
        break;
      case 'infrastructure':
        asset = this.generateInfrastructure(config);
        break;
    }

    if (!asset) {
      console.warn(`Failed to generate asset: ${type}`);
      // Return a fallback
      return {
        mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)),
        lods: [],
      };
    }

    // Cache the result
    this.cacheAsset(cacheKey, asset.mesh, asset.material, asset.lods, config);

    return {
      mesh: asset.mesh,
      lods: asset.lods,
    };
  }

  /** Prepare complete production geometry off-thread; callers can retain their current visual until ready. */
  prepareBuilding(config: AssetConfig, required?: () => boolean): Promise<void> {
    const key = this.getCacheKey('building', config);
    if (this.cache.has(key)) return Promise.resolve();
    const pending = this.pendingBuildings.get(key);
    if (pending) return pending;
    if (!this.lodWorker || this.preparationFailed) { this.getAsset('building', config); return Promise.resolve(); }
    const snapshot = structuredClone(config);
    this.cacheMisses++;
    const request = this.lodWorker.run<PreparedBuilding>({ kind: 'building', config: snapshot }, [], required).then(data => {
      if (this.disposed || this.cache.has(key) || required && !required()) return;
      const adoptionStarted = performance.now();
      const palette = this.getOrCreatePalette(snapshot), root = unpackBuilding(data, palette);
      const full = root instanceof THREE.LOD ? root.levels[0]!.object as THREE.Group : root as THREE.Group;
      this.facadeTextures.apply(full, true);
      const lods = root instanceof THREE.LOD ? root.levels.slice(1).map(l => l.object) : [];
      for (const tier of lods) this.facadeTextures.applyPrepared(tier as THREE.Group, full, true);
      this.cacheAsset(key, root, palette.getSurfaceMaterial('plaster'), lods, snapshot);
      this.adoptionTimes.push(performance.now() - adoptionStarted);
      if (this.adoptionTimes.length > 128) this.adoptionTimes.shift();
    }).catch(error => { if (!this.disposed && error?.name !== 'AbortError') { this.preparationFailed = true; this.failedLods++; } throw error; })
      .finally(() => { this.pendingBuildings.delete(key); });
    this.pendingBuildings.set(key, request);
    return request;
  }

  hasBuilding(config: AssetConfig): boolean { return this.cache.has(this.getCacheKey('building', config)); }

  /** Nonblocking reconciliation gate: keep the old visual until every required shell is cached. */
  prepareBuildings(configs: readonly AssetConfig[], owner = 'default'): boolean {
    if (!this.getPreparationStats().background) return true;
    this.preparationOwners.set(owner, new Set(configs.map(config => this.getCacheKey('building', config))));
    this.lodWorker?.prune();
    let ready = true;
    for (const config of configs) if (!this.hasBuilding(config)) {
      ready = false;
      const key = this.getCacheKey('building', config);
      if (!this.pendingBuildings.has(key))
        void this.prepareBuilding(config, () => [...this.preparationOwners.values()].some(keys => keys.has(key)))
          .catch(error => { if (!this.disposed && error?.name !== 'AbortError') console.error('Building preparation failed', error); });
    }
    return ready;
  }
  releasePreparationOwner(owner: string): void { this.preparationOwners.delete(owner); this.lodWorker?.prune(); }

  /**
   * Generate a tree asset with LODs
   */
  private generateTree(config: AssetConfig): {
    mesh: THREE.Group;
    lods: THREE.Object3D[];
    material: THREE.Material;
  } {
    const group = new THREE.Group();
    const random = new SeededRandom(config.seed);

    const palette = this.getOrCreatePalette(config);
    const scale = config.scale || 1.0;

    // Determine tree type based on variant
    const treeType = config.variant || 'broadleaf';
    const trunkHeight = (1.5 + random.float() * 0.5) * scale;
    const trunkRadius = (0.15 + random.float() * 0.05) * scale;
    const canopyRadius = (1.0 + random.float() * 0.3) * scale;

    // Create trunk
    const trunkGeometry = ProceduralGeometry.createTreeTrunk(
      trunkHeight,
      trunkRadius * 1.2,
      trunkRadius * 0.4,
      8,
      4,
    );
    const trunkMaterial = palette.getMaterial('wood');
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    group.add(trunk);

    // Create canopy based on type
    let canopyGeometry: THREE.BufferGeometry;
    let canopyMaterial: THREE.Material;

    if (treeType === 'cherry') {
      // Cherry blossom: pinkish, slightly wider
      const cherryColor = new THREE.Color(0xffb6d9);
      canopyMaterial = new THREE.MeshStandardMaterial({
        color: cherryColor,
        roughness: 0.7,
        metalness: 0,
      });
      canopyGeometry = ProceduralGeometry.createTreeCanopy(canopyRadius * 1.1, 0.8);
    } else if (treeType === 'conifer') {
      // Conifer: cone-shaped
      canopyGeometry = new THREE.ConeGeometry(canopyRadius * 0.8, trunkHeight * 1.2, 8);
      canopyMaterial = palette.getMaterial('primary');
    } else {
      // Default broadleaf
      canopyGeometry = ProceduralGeometry.createTreeCanopy(canopyRadius, 0.7);
      canopyMaterial = palette.getMaterial('primary');
    }

    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.y = trunkHeight * 0.5 + canopyRadius * 0.3;
    group.add(canopy);

    // Apply variation
    ProceduralGeometry.applyVariation(trunkGeometry, random, 0.02);

    // Generate LODs
    const lods = this.generateTreeLODs(trunkHeight, canopyRadius, palette);

    return {
      mesh: group,
      lods,
      material: canopyMaterial,
    };
  }

  private generateTreeLODs(
    height: number,
    radius: number,
    palette: MaterialPalette,
  ): THREE.Object3D[] {
    const lods: THREE.Object3D[] = [];

    // LOD 1: Simpler canopy
    const lod1Geometry = new THREE.SphereGeometry(radius * 0.9, 8, 6);
    const lod1 = new THREE.Mesh(lod1Geometry, palette.getMaterial('primary'));
    lod1.position.y = height * 0.5;
    lods.push(lod1);

    // LOD 2: Very simple (distant)
    const lod2Geometry = new THREE.SphereGeometry(radius * 0.7, 4, 3);
    const lod2 = new THREE.Mesh(lod2Geometry, palette.getMaterial('primary'));
    lod2.position.y = height * 0.3;
    lods.push(lod2);

    return lods;
  }

  /**
   * The building's origin-fabric material, so its core can render older than a later massing
   * annex instead of an identical copy of the current wall. Only set when there is genuine
   * multi-generation history (several upgrades/repurposes) AND the origin material actually
   * differs from the current one — a building whose material never changed is left untouched.
   */
  /**
   * Resolve the architectural specification for one building.
   *
   * Reads only authoritative state: era, the local development response and its practised
   * capabilities, the project's material consumption, the settlement's own cell climate, its
   * prosperity and specialization, and the structure's recorded history.
   *
   * Settlement material *stock* is deliberately not consulted. It changes every month, and
   * keying buildings on it would thrash the asset cache for no visual gain — the project's bill
   * of materials is both stabler and stronger evidence.
   */
  /** Built mass of the generation this upgrade replaced, composed (and cached) like any building. */
  private priorGenerationMass(config: AssetConfig): { width: number; depth: number; height: number } | undefined {
    const prior = config.development ? priorFabricGeneration(config.development) : undefined;
    if (!prior) return undefined;
    const asset = this.getAsset('building', { ...config, development: prior, era: developmentPresentationEra(prior),
      variant: `${developmentBuildingRole(prior)}#${BUILD_STAGE.DETAIL}`, project: undefined, condition: undefined });
    return { width: Number(asset.mesh.userData['massWidth'] ?? 0), depth: Number(asset.mesh.userData['massDepth'] ?? 0),
      height: Number(asset.mesh.userData['buildingHeight'] ?? 0) };
  }

  private specFor(
    config: AssetConfig,
    role: BuildingRole,
    stage: BuildStage,
    profile: CultureStyleProfile,
    minimum?: BuildingSpecContext['envelope'],
  ): BuildingSpec {
    const context = config.grammarContext;
    const resolve = (development: DevelopmentResponse | undefined, envelope?: BuildingSpecContext['envelope'],
      generation?: { role: BuildingRole; era: Era }) => resolveBuildingSpec({
      archetype: config.archetype,
      energyKind: config.energyKind,
      role: generation?.role ?? role,
      era: generation?.era ?? config.era,
      seed: config.seed,
      culture: {
        materialBias: profile.materialBias,
        roofLanguage: profile.roofLanguage,
        trimDensity: profile.getTrimDensity(config.era),
        ornamentBias: config.settlementIdentity?.ornamentBias,
      },
      development,
      project: config.project,
      condition: config.condition,
      envelope,
      heritage: development ? deriveStructureHeritage(development) : undefined,
      climate: context
        ? {
          temperature: context.temperature,
          moisture: context.moisture,
          biome: context.biome,
          signal: context.climateSignal,
          floodDepth: context.floodDepth,
        }
        : undefined,
      prosperity: config.prosperity,
      specialization: config.specialization,
      waterfront: config.waterfront,
      localSlopeDegrees: config.localSlopeDegrees,
      stage,
    });
    // An in-place upgrade grows out from the generation it replaced: resolve that generation the
    // same way and hand its plan and wall height to the new spec as a floor.
    const prior = config.development ? priorFabricGeneration(config.development) : undefined;
    if (!prior) return resolve(config.development, minimum);
    // The earlier generation in its own era and role, exactly as it stood before this upgrade.
    const before = resolve(prior, undefined, { role: developmentBuildingRole(prior), era: developmentPresentationEra(prior) });
    return resolve(config.development, { width: Math.max(before.width, minimum?.width ?? 0), depth: Math.max(before.depth, minimum?.depth ?? 0),
      height: Math.max(before.floors * before.storeyHeight, minimum?.height ?? 0) });
  }

  private coreMaterialFor(grammar: BuildingGrammar, development?: DevelopmentResponse): StructureMaterial | undefined {
    if (grammar.massing === 'single' || !development) return undefined;
    const generationModel = deriveArchitecturalGenerations(development);
    if (generationModel.generations.length <= 1) return undefined;
    const origin = generationForOriginFabric(generationModel).material;
    const current = generationForCurrentFabric(generationModel).material;
    return origin !== current ? origin : undefined;
  }

  /**
   * Generate a building asset with LODs.
   *
   * Completed structures return a THREE.LOD root, so the existing renderer automatically swaps
   * full procedural geometry for semantic mid-distance massing and a far silhouette. In-progress
   * construction remains a single stage-specific mesh so distant sites never appear complete.
   */
  private generateBuilding(config: AssetConfig): {
    mesh: THREE.Object3D;
    lods: THREE.Object3D[];
    material: THREE.Material;
  } {
    const palette = this.getOrCreatePalette(config);
    const cultureProfile = this.getOrCreateCultureProfile(config);
    // The shared, cached culture profile stays culture-only; settlement drift wraps it per call
    // rather than multiplying the cached base profiles, so related-culture settlements still
    // share one cheap base object and only differ by this lightweight wrapper.
    const profile = config.settlementIdentity ? new SettlementStyleProfile(cultureProfile, config.settlementIdentity) : cultureProfile;
    const [roleName, stageName] = (config.variant ?? 'house').split('#');
    const role = (roleName || 'house') as BuildingRole;
    const stage = stageName === undefined ? BUILD_STAGE.DETAIL : (Number(stageName) as BuildStage);
    // Architectural authority resolves first. BuildingRole survives only as a compatibility label
    // for placement, sleeping-area and legacy diagnostics. Memorials are non-building ceremonial
    // compositions and therefore keep the compatibility-only grammar resolver.
    let spec = config.development?.memorial ? undefined : this.specFor(config, role, stage, profile);
    let grammar = spec
      ? grammarFromBuildingSpec(profile, spec, role)
      : resolveBuildingGrammar(profile, config.era, role, config.seed, config.development, config.settlementIdentity, config.localSlopeDegrees, config.grammarContext);
    const coreMaterial = this.coreMaterialFor(grammar, config.development);
    let composed = composeBuilding(grammar, palette, config.seed, stage, coreMaterial);
    // An upgrade must be at least as large, built, as the generation it replaced. Stages compose
    // their spec differently (a compound adds courts a townhouse does not), so the spec envelope is
    // checked against the composed mass and widened once or twice until it holds.
    const prior = spec && config.development ? this.priorGenerationMass(config) : undefined;
    for (let pass = 0; prior && spec && pass < 3; pass++) {
      const rx = prior.width / Math.max(1e-6, composed.massX), rz = prior.depth / Math.max(1e-6, composed.massZ);
      const rh = prior.height / Math.max(1e-6, composed.height);
      if (Math.max(rx, rz, rh) <= 1.0005) break;
      disposeComposed(composed.group);
      spec = this.specFor(config, role, stage, profile, { width: spec.width * Math.max(1, rx) * 1.002, depth: spec.depth * Math.max(1, rz) * 1.002,
        height: spec.floors * spec.storeyHeight * Math.max(1, rh) * 1.002 });
      grammar = grammarFromBuildingSpec(profile, spec, role);
      composed = composeBuilding(grammar, palette, config.seed, stage, coreMaterial);
    }
    this.facadeTextures.apply(composed.group);
    const componentManifest = buildStructureComponentManifest(grammar, config.development, composed);
    // A machine building's silhouette is its machinery — sails, wheel, stack — which a massing box
    // would erase exactly at the distances where it should be recognised. Mills are few, so they keep
    // their full geometry at range and let the motion system throttle their moving parts instead.
    const machine = grammar.spec ? dedicatedGeometryKind(grammar.spec.archetype) === 'machine' : false;
    // Distance tiers are the full composition with sub-pixel solids removed, in the same decorated
    // materials, so walls, openings, roofs, chimneys and towers keep their material and artwork.
    // They are cut from an unsectioned recomposition: identical surfaces without the construction
    // pieces, so a wall is a handful of triangles rather than a grid of build steps.
    let lods: THREE.Group[] = [];
    const needsLods = stage === BUILD_STAGE.DETAIL && !config.development?.memorial && !machine;
    if (needsLods && (!this.lodWorker || this.preparationFailed)) {
      const started = performance.now();
      const coarse = composeBuilding(grammar, palette, config.seed, stage, coreMaterial, false);
      this.facadeTextures.apply(coarse.group);
      // Each tier is cut from the one before it, which is already merged and smaller.
      let source: THREE.Object3D = coarse.group;
      lods = LOD_TIERS.map(tier => {
        const derived = deriveDetailTier(source, tier, undefined, (mesh, from) => this.facadeTextures.inherit(mesh, from));
        source = derived;
        return derived;
      });
      disposeComposed(coarse.group);
      composed.group.userData['lodBuildMs'] = performance.now() - started;
    }

    composed.group.name = 'building-full-detail';
    let root: THREE.Object3D = composed.group;
    if (needsLods) {
      const lod = new ProgressiveBuildingLod();
      lod.name = 'building-lod';
      lod.autoUpdate = true;
      lod.addLevel(composed.group, 0);
      if (lods.length) {
        lods[0]!.name = 'building-mid-detail';
        lods[1]!.name = 'building-far-detail';
        lods[2]!.name = 'building-skyline';
        // Documentary close and street shots remain full detail. Each later tier is the same
        // building with features below a pixel removed; the skyline tier also closes its openings.
        lod.addLevel(lods[0]!, LOD_DISTANCES[1], LOD_HYSTERESIS);
        lod.addLevel(lods[1]!, LOD_DISTANCES[2], LOD_HYSTERESIS);
        lod.addLevel(lods[2]!, LOD_DISTANCES[3], LOD_HYSTERESIS);
      }
      root = lod;
    }

    Object.assign(root.userData, composed.group.userData);
    root.userData['buildingHeight'] = composed.height;
    root.userData['footprintWidth'] = composed.extentX;
    root.userData['footprintDepth'] = composed.extentZ;
    // The built mass, excluding the yards, paving and water a structure lays around itself. This
    // is what the renderer fits against; the site extent above is what the plot reserves.
    root.userData['massWidth'] = composed.massX;
    root.userData['massDepth'] = composed.massZ;
    root.userData['structureComponents'] = componentManifest;
    root.userData['structureComponentSignature'] = componentManifest.visualSignature;
    root.userData['buildingLodDistances'] = needsLods ? [...LOD_DISTANCES] : [0];
    if (needsLods && this.lodWorker && !this.preparationFailed) {
      root.userData['lodPreparation'] = 'pending';
      this.pendingLods++;
      void this.lodWorker.run<{ tiers: PreparedMesh[][]; ms: number }>({ kind: 'lod', grammar, culture: config.culture,
        seed: config.seed, coreMaterial, tiers: LOD_TIERS }).then(result => {
        if (this.disposed) return;
        const tiers = result.tiers.map(data => unpackGeometry(data, composed.group, (mesh, from) => this.facadeTextures.inherit(mesh, from)));
        tiers.forEach(tier => this.facadeTextures.applyPrepared(tier, composed.group));
        tiers.forEach((tier, i) => { tier.name = ['building-mid-detail', 'building-far-detail', 'building-skyline'][i]!; });
        lods.push(...tiers);
        (root as ProgressiveBuildingLod).install(tiers, LOD_DISTANCES.slice(1), LOD_HYSTERESIS);
        root.userData['lodBuildMs'] = result.ms;
      }).catch(error => {
        if (!this.disposed) { this.failedLods++; root.userData['lodPreparation'] = 'failed'; console.error('Building tier preparation failed', error); }
      }).finally(() => { this.pendingLods--; });
    }

    return {
      mesh: root,
      lods,
      material: palette.getSurfaceMaterial('plaster'),
    };
  }

  /**
   * Generate a humanoid character
   */
  private generateHumanoid(config: AssetConfig): {
    mesh: THREE.Group;
    lods: THREE.Object3D[];
    material: THREE.Material;
  } {
    const group = new THREE.Group();
    const palette = this.getOrCreatePalette(config);
    const scale = config.scale || 1.0;

    ProceduralGeometry.createBoneStructure();

    // Create body segments
    const torsoGeometry = ProceduralGeometry.createBodySegment(0.3 * scale, 0.4 * scale, 0.2 * scale);
    const torsoMaterial = palette.getMaterial('primary');
    const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
    group.add(torso);

    // Head
    const headGeometry = ProceduralGeometry.createHead(0.25 * scale);
    const head = new THREE.Mesh(headGeometry, torsoMaterial);
    head.position.y = 0.35 * scale;
    group.add(head);

    // Limbs
    const limbMaterial = palette.getMaterial('primary');

    const leftArm = new THREE.Mesh(
      ProceduralGeometry.createLimb(0.1 * scale, 0.6 * scale, 4),
      limbMaterial,
    );
    leftArm.position.set(-0.2 * scale, 0.15 * scale, 0);
    group.add(leftArm);

    const rightArm = new THREE.Mesh(
      ProceduralGeometry.createLimb(0.1 * scale, 0.6 * scale, 4),
      limbMaterial,
    );
    rightArm.position.set(0.2 * scale, 0.15 * scale, 0);
    group.add(rightArm);

    const leftLeg = new THREE.Mesh(
      ProceduralGeometry.createLimb(0.12 * scale, 0.8 * scale, 4),
      limbMaterial,
    );
    leftLeg.position.set(-0.12 * scale, -0.4 * scale, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(
      ProceduralGeometry.createLimb(0.12 * scale, 0.8 * scale, 4),
      limbMaterial,
    );
    rightLeg.position.set(0.12 * scale, -0.4 * scale, 0);
    group.add(rightLeg);

    // LODs
    const lods = this.generateHumanoidLODs(palette, scale);

    return {
      mesh: group,
      lods,
      material: torsoMaterial,
    };
  }

  private generateHumanoidLODs(palette: MaterialPalette, scale: number): THREE.Object3D[] {
    const lods: THREE.Object3D[] = [];

    // LOD 1: Simplified torso + head only.
    const lod1 = new THREE.Group();
    const lod1Torso = new THREE.Mesh(
      ProceduralGeometry.createBodySegment(0.3 * scale, 0.5 * scale, 0.25 * scale),
      palette.getMaterial('primary'),
    );
    const lod1Head = new THREE.Mesh(
      ProceduralGeometry.createHead(0.2 * scale),
      palette.getMaterial('primary'),
    );
    lod1Head.position.y = 0.35 * scale;
    lod1.add(lod1Torso, lod1Head);
    lods.push(lod1);

    // LOD 2: Very simple (capsule-like)
    const lod2Geometry = new THREE.CapsuleGeometry(0.1 * scale, 1.0 * scale, 2, 3);
    const lod2 = new THREE.Mesh(lod2Geometry, palette.getMaterial('primary'));
    lods.push(lod2);

    return lods;
  }

  /**
   * Generate terrain decoration (rocks, small objects)
   */
  private generateTerrainDeco(config: AssetConfig): {
    mesh: THREE.Mesh;
    lods: THREE.Object3D[];
    material: THREE.Material;
  } {
    const palette = this.getOrCreatePalette(config);
    const scale = config.scale || 1.0;

    // Simple rock/boulder
    const rockGeometry = new THREE.DodecahedronGeometry(0.5 * scale, 0);
    ProceduralGeometry.applyVariation(rockGeometry, new SeededRandom(config.seed), 0.1);

    const rockMaterial = palette.getMaterial('stone');
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    rock.castShadow = true;

    const lods = [
      new THREE.Mesh(new THREE.SphereGeometry(0.4 * scale, 8, 6), rockMaterial),
      new THREE.Mesh(new THREE.SphereGeometry(0.3 * scale, 4, 3), rockMaterial),
    ];

    return {
      mesh: rock,
      lods,
      material: rockMaterial,
    };
  }

  /**
   * Generate infrastructure (tower, sign, etc.)
   */
  private generateInfrastructure(config: AssetConfig): {
    mesh: THREE.Group;
    lods: THREE.Object3D[];
    material: THREE.Material;
  } {
    const group = new THREE.Group();
    const palette = this.getOrCreatePalette(config);
    const scale = config.scale || 1.0;

    const infraType = config.variant || 'generic';

    if (infraType === 'banner-pole') {
      const pole = ProceduralGeometry.createBannerPole(0.1 * scale, 3 * scale, 2);
      group.add(pole);
    } else {
      // Default: simple post
      const postGeometry = ProceduralGeometry.createPost(0.15 * scale, 3 * scale);
      const postMaterial = palette.getMaterial('metal');
      const post = new THREE.Mesh(postGeometry, postMaterial);
      group.add(post);

      return {
        mesh: group,
        lods: [],
        material: postMaterial,
      };
    }

    return {
      mesh: group,
      lods: [],
      material: palette.getMaterial('metal'),
    };
  }

  /**
   * Generate a cache key from facts that can actually change the shared asset. Historical event
   * timing and instance ownership are excluded; geometry-changing heritage and generation facts
   * remain part of the key.
   */
  private getCacheKey(type: AssetType, config: AssetConfig): string {
    const d = config.development;
    const history = type === 'building' ? structureVisualHistorySignature(d) : 'na';
    // Bucketed (not raw) so nearly-identical slopes/climate keep reusing one cached shape; the
    // seed alone can otherwise be shared by several plots of the same role/variation within one
    // settlement, and these are the per-plot/per-call dimensions that still vary beneath it.
    const slopeBucket = type === 'building' && config.localSlopeDegrees !== undefined ? `:s${Math.round(config.localSlopeDegrees / 5)}` : '';
    const ctx = config.grammarContext;
    const contextBucket = type === 'building' && ctx
      ? `:c${ctx.climateSignal !== undefined ? Math.round(ctx.climateSignal * 5) : ''}.${ctx.floodDepth !== undefined ? Math.round(ctx.floodDepth * 5) : ''}.${ctx.isLandmark ? 1 : 0}`
      : '';
    // The architectural spec's own inputs. Climate and prosperity are bucketed so neighbouring
    // plots keep sharing one cached mesh, and the material bill contributes a compact signature
    // rather than its raw quantities.
    const specBucket = type === 'building'
      ? `:a${ctx?.temperature !== undefined ? Math.round(ctx.temperature * 8) : ''}.${ctx?.moisture !== undefined ? Math.round(ctx.moisture * 8) : ''}.${ctx?.biome ?? ''}`
        + `.${config.prosperity !== undefined ? Math.round(config.prosperity * 4) : ''}.${config.specialization ?? ''}`
        + `.${config.waterfront ? 'w' : ''}.${config.archetype ?? ''}.${config.energyKind ?? ''}`
        + `.${materialBillSignature(config.project, d)}.${[...(d?.capabilities ?? [])].sort().join(',')}`
        + `.${[...(d?.technology ?? [])].sort().join(',')}.${d?.facilityFamily ?? ''}${d?.facilityTier ?? ''}`
        + `.${(d?.reasons ?? []).filter(r => ROUTING_REASONS.has(r)).sort().join(',')}.${config.condition ?? 1}`
        + `.${priorSignature(d)}`
      : '';
    return `${type}:${config.seed}:${config.era}:${config.variant || 'default'}:${d ? [d.form, d.need, d.level, d.material, d.adaptation ?? '', d.temporary ? 1 : 0, d.style.pattern, d.style.secondary, d.style.accent].join(':') : ''}:${history}${slopeBucket}${contextBucket}${specBucket}`;
  }

  /**
   * Cache an asset
   */
  private cacheAsset(
    key: string,
    mesh: THREE.Object3D,
    material: THREE.Material,
    lods: THREE.Object3D[],
    config: AssetConfig,
  ): void {
    const access = this.cacheClock++;
    this.cache.set(key, {
      mesh,
      material,
      lods,
      config,
      createdAt: access,
      lastAccessedAt: access,
    });

    // Prune if cache is too large
    if (this.cache.size > this.maxCacheSize) {
      this.pruneCache();
    }
  }

  /**
   * Remove least-recently-used cached items. Active architectural families survive churn from
   * rarely revisited historical variants instead of being evicted purely because they are old.
   */
  private pruneCache(): void {
    const toRemove = Math.ceil(this.cache.size * 0.1); // Remove 10%
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt || a[1].createdAt - b[1].createdAt,
    );

    this.cachePrunes++;
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) {
        this.cache.delete(entry[0]);
        this.cacheEvictions++;
      }
    }
  }

  /** Renderer/validation diagnostics. No cache keys or mutable internals are exposed. */
  getCacheStats(): AssetCacheStats {
    const requests = this.cacheHits + this.cacheMisses;
    let buildingEntries = 0;
    for (const key of this.cache.keys()) if (key.startsWith('building:')) buildingEntries++;
    return {
      entries: this.cache.size,
      maxEntries: this.maxCacheSize,
      buildingEntries,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: requests === 0 ? 0 : this.cacheHits / requests,
      prunes: this.cachePrunes,
      evictions: this.cacheEvictions,
      materialPalettes: this.materialPalettes.size,
      cultureProfiles: this.cultureProfiles.size,
    };
  }

  getPreparationStats() { return { pending: this.pendingLods + this.pendingBuildings.size, failed: this.failedLods,
    background: !!this.lodWorker && !this.preparationFailed, maxAdoptMs: Math.max(0, ...this.adoptionTimes) }; }

  /** 0 at midday, 1 at deep night. Drives window, lantern and motif emissives. */
  setNightFactor(factor: number): void {
    if (Math.abs(factor - this.nightFactor) < 0.01) return;
    this.nightFactor = factor;
    this.materialPalettes.forEach(palette => palette.setNightFactor(factor));
  }

  /**
   * Get or create material palette for a culture
   */
  private getOrCreatePalette(config: AssetConfig): MaterialPalette {
    const key = `${config.culture.primary}:${config.culture.secondary}:${config.culture.accent}:${config.era}`;
    if (!this.materialPalettes.has(key)) {
      const palette = new MaterialPalette({ culture: config.culture, era: config.era });
      palette.setNightFactor(this.nightFactor);
      this.materialPalettes.set(key, palette);
    }
    return this.materialPalettes.get(key)!;
  }

  /**
   * Get or create culture style profile for a culture
   */
  private getOrCreateCultureProfile(config: AssetConfig): CultureStyleProfile {
    const key = `${config.culture.primary}:${config.culture.symbol}:${config.culture.pattern}`;
    if (!this.cultureProfiles.has(key)) {
      this.cultureProfiles.set(
        key,
        CultureStyleProfileFactory.createFromCulture(key, config.culture),
      );
    }
    return this.cultureProfiles.get(key)!;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.disposed = true;
    this.lodWorker?.dispose();
    this.preparationOwners.clear();
    this.facadeTextures.dispose();
    this.cache.forEach(asset => {
      disposeComposed(asset.mesh);
      for (const lod of asset.lods) disposeComposed(lod);
      if ('dispose' in asset.mesh) {
        const disposable = asset.mesh as THREE.Object3D & { dispose?: () => void };
        disposable.dispose?.();
      }
      asset.material.dispose();
    });
    this.cache.clear();

    this.materialPalettes.forEach(p => p.dispose());
    this.materialPalettes.clear();

    this.cultureProfiles.clear();
  }
}
