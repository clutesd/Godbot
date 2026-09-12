/**
 * AssetBuilder.ts
 * 
 * Factory and cache for procedural asset generation.
 * Ensures deterministic, reusable asset creation keyed by (type, culture, era, variant).
 */

import * as THREE from 'three';
import type { CultureStyle } from '../../sim/types';
import { MaterialPalette, type Era } from '../materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../style/CultureStyleProfile';
import type { CultureStyleProfile } from '../style/CultureStyleProfile';
import { ProceduralGeometry } from './ProceduralGeometry';
import { resolveBuildingGrammar, type BuildingGrammar, type BuildingRole } from './BuildingGrammar';
import { BUILD_STAGE, composeBuilding, type BuildStage } from './BuildingComposer';
import { SeededRandom } from '../../sim/prng';
import type { DevelopmentResponse } from '../../sim/development/types';
import { buildStructureComponentManifest } from './StructureComponents';
import { structureVisualHistorySignature } from './StructureVisualSignature';

export type AssetType = 'tree' | 'building' | 'humanoid' | 'terrain-deco' | 'infrastructure';

export interface AssetConfig {
  development?: DevelopmentResponse;
  seed: string;
  culture: CultureStyle;
  era: Era;
  variant?: string;
  scale?: number;
  customData?: Record<string, unknown>;
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

/** Share of the total structure height the crown occupies. Keeps LOD tiers the same height as full detail. */
function crownHeightShare(crown: BuildingGrammar['crown']): number {
  switch (crown) {
    case 'spire': return 0.44;
    case 'obelisk': return 0.4;
    case 'cooling-mass': return 0.42;
    case 'water-tank': return 0.36;
    case 'watch-tower': return 0.3;
    case 'observatory': return 0.22;
    case 'lantern-cupola': return 0.18;
    case 'roof-monitor': return 0.12;
    case 'stack-cluster':
    case 'none':
      return 0;
  }
}

/**
 * Mid-distance massing for the grammar's crown feature.
 * Approach views must still tell a spire from a watch tower from a cooling mass, so the crown
 * is the one piece of fine detail that is worth re-stating in simplified form.
 */
function buildCrownLod(
  grammar: BuildingGrammar,
  width: number,
  depth: number,
  roofY: number,
  crownHeight: number,
  roofMaterial: THREE.Material,
  stoneMaterial: THREE.Material,
  metalMaterial: THREE.Material,
): THREE.Object3D | undefined {
  const unit = Math.min(width, depth);
  switch (grammar.crown) {
    case 'spire': {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(unit * 0.24, crownHeight, 6), roofMaterial);
      spire.position.y = roofY + crownHeight * 0.5;
      return spire;
    }
    case 'obelisk': {
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(unit * 0.3, crownHeight, 4), stoneMaterial);
      shaft.position.y = roofY + crownHeight * 0.5;
      shaft.rotation.y = Math.PI / 4;
      return shaft;
    }
    case 'lantern-cupola': {
      const cupola = new THREE.Mesh(new THREE.CylinderGeometry(unit * 0.2, unit * 0.24, crownHeight, 6), roofMaterial);
      cupola.position.y = roofY + crownHeight * 0.5;
      return cupola;
    }
    case 'watch-tower': {
      const height = roofY + crownHeight;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.52, height, unit * 0.52), stoneMaterial);
      tower.position.set(-width * 0.34, height * 0.5, -depth * 0.3);
      return tower;
    }
    case 'observatory': {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(crownHeight, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        roofMaterial,
      );
      dome.position.y = roofY;
      return dome;
    }
    case 'stack-cluster':
      // Chimney massing is already emitted above; a second cluster would only double the cost.
      return undefined;
    case 'cooling-mass': {
      const group = new THREE.Group();
      for (const side of [-1, 1]) {
        const mass = new THREE.Mesh(new THREE.CylinderGeometry(unit * 0.3, unit * 0.42, crownHeight, 6), metalMaterial);
        mass.position.set(side * width * 0.26, roofY + crownHeight * 0.5, -depth * 0.15);
        group.add(mass);
      }
      return group;
    }
    case 'water-tank': {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(unit * 0.34, unit * 0.34, crownHeight * 0.55, 6), metalMaterial);
      tank.position.y = roofY + crownHeight * 0.72;
      return tank;
    }
    case 'roof-monitor': {
      const monitor = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, crownHeight, depth * 0.3), metalMaterial);
      monitor.position.y = roofY + crownHeight * 0.5;
      return monitor;
    }
    case 'none':
      return undefined;
  }
}

/** Skyline-only crown massing. One box at most, so the far tier stays a silhouette. */
function farCrownSilhouette(
  grammar: BuildingGrammar,
  width: number,
  depth: number,
  bodyTop: number,
  crownHeight: number,
  material: THREE.Material,
): THREE.Mesh | undefined {
  const unit = Math.min(width, depth);
  switch (grammar.crown) {
    case 'spire':
    case 'obelisk': {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.36, crownHeight, unit * 0.36), material);
      mesh.position.y = bodyTop + crownHeight * 0.5;
      return mesh;
    }
    case 'watch-tower': {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.55, bodyTop + crownHeight, unit * 0.55), material);
      mesh.position.set(-width * 0.3, (bodyTop + crownHeight) * 0.5, -depth * 0.28);
      return mesh;
    }
    case 'cooling-mass': {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, crownHeight, depth * 0.4), material);
      mesh.position.set(0, bodyTop + crownHeight * 0.5, -depth * 0.15);
      return mesh;
    }
    case 'water-tank': {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.7, crownHeight * 0.6, unit * 0.7), material);
      mesh.position.y = bodyTop + crownHeight * 0.7;
      return mesh;
    }
    case 'observatory': {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.64, crownHeight, unit * 0.64), material);
      mesh.position.y = bodyTop + crownHeight * 0.5;
      return mesh;
    }
    default:
      return undefined;
  }
}

/**
 * Central factory for creating procedural assets
 * Caches results to avoid redundant generation
 */
export class AssetBuilder {
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

  constructor(globalSeed: string = 'assets') {
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
    const profile = this.getOrCreateCultureProfile(config);
    const [roleName, stageName] = (config.variant ?? 'house').split('#');
    const role = (roleName || 'house') as BuildingRole;
    const stage = stageName === undefined ? BUILD_STAGE.DETAIL : (Number(stageName) as BuildStage);
    const grammar = resolveBuildingGrammar(profile, config.era, role, config.seed, config.development);
    const composed = composeBuilding(grammar, palette, config.seed, stage);
    const componentManifest = buildStructureComponentManifest(grammar, config.development, composed);
    const lods = stage === BUILD_STAGE.DETAIL
      ? this.generateBuildingLODs(grammar, composed.height, palette)
      : [];

    composed.group.name = 'building-full-detail';
    let root: THREE.Object3D = composed.group;
    if (lods.length >= 2) {
      const lod = new THREE.LOD();
      lod.name = 'building-lod';
      lod.autoUpdate = true;
      lod.addLevel(composed.group, 0);
      lods[0]!.name = 'building-mid-detail';
      lods[1]!.name = 'building-far-silhouette';
      // Documentary close/street shots remain full detail. Settlement approaches move to the
      // semantic massing LOD, and regional/world views use the skyline silhouette.
      lod.addLevel(lods[0]!, 20);
      lod.addLevel(lods[1]!, 42);
      root = lod;
    }

    root.userData['buildingHeight'] = composed.height;
    root.userData['footprintWidth'] = composed.extentX;
    root.userData['footprintDepth'] = composed.extentZ;
    root.userData['structureComponents'] = componentManifest;
    root.userData['structureComponentSignature'] = componentManifest.visualSignature;
    root.userData['buildingLodDistances'] = lods.length >= 2 ? [0, 20, 42] : [0];

    return {
      mesh: root,
      lods,
      material: palette.getSurfaceMaterial('plaster'),
    };
  }

  private generateBuildingLODs(
    grammar: BuildingGrammar,
    height: number,
    palette: MaterialPalette,
  ): THREE.Object3D[] {
    const width = grammar.width;
    const depth = grammar.depth;
    const bodyMaterial = palette.getSurfaceMaterial('plaster');
    const roofMaterial = palette.getRoofMaterial();
    const stoneMaterial = palette.getSurfaceMaterial('stone');
    const metalMaterial = palette.getSurfaceMaterial('metal');
    const lod1 = new THREE.Group();

    const bodyHeight = Math.max(height * 0.58, grammar.wallHeight * grammar.storeys * 0.72);
    const addBody = (x: number, z: number, sx: number, sz: number, sy = bodyHeight, y = sy / 2): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), bodyMaterial);
      mesh.position.set(x, y, z);
      lod1.add(mesh);
    };

    // Main volume.
    addBody(0, 0, width, depth);

    // Preserve the biggest Step 1/2 identity cue at mid-distance instead of reducing every
    // institution to one rectangular box.
    const wingHeight = bodyHeight * 0.72;
    if (grammar.massing === 'wing') {
      addBody(width * 0.34, -depth * 0.42, width * 0.44, depth * 0.58, wingHeight, wingHeight / 2);
    } else if (grammar.massing === 'twin') {
      addBody(-width * 0.43, depth * 0.28, width * 0.3, depth * 0.42, wingHeight, wingHeight / 2);
      addBody(width * 0.43, depth * 0.28, width * 0.3, depth * 0.42, wingHeight, wingHeight / 2);
    } else if (grammar.massing === 'court') {
      addBody(-width * 0.52, depth * 0.34, width * 0.24, depth * 0.7, wingHeight, wingHeight / 2);
      addBody(width * 0.52, depth * 0.34, width * 0.24, depth * 0.7, wingHeight, wingHeight / 2);
    }

    // Simplified roof language keeps sacred/industrial/civic skylines distinct.
    const crownHeight = height * crownHeightShare(grammar.crown);
    const roofHeight = Math.max(0.14, height - bodyHeight - crownHeight);
    let roof: THREE.Mesh;
    if (grammar.roofFamily === 'shell-dome' || grammar.roofFamily === 'canopy-shell') {
      roof = new THREE.Mesh(new THREE.SphereGeometry(Math.max(width, depth) * 0.48, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), roofMaterial);
      roof.scale.z = depth / Math.max(0.001, width);
      roof.position.y = bodyHeight;
    } else {
      const sides = grammar.roofFamily === 'hide-cone' ? 6 : 4;
      roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.72, roofHeight, sides), roofMaterial);
      roof.position.y = bodyHeight + roofHeight * 0.5;
      roof.rotation.y = sides === 4 ? Math.PI / 4 : 0;
      roof.scale.z = Math.max(0.45, depth / Math.max(0.001, width));
    }
    lod1.add(roof);

    if (grammar.forecourt) {
      const forecourt = new THREE.Mesh(new THREE.BoxGeometry(width * 1.45, 0.025, depth * 0.7), stoneMaterial);
      forecourt.position.set(0, 0.0125, depth * 0.82);
      lod1.add(forecourt);
    }
    if (grammar.gateway) {
      const gate = new THREE.Group();
      const gateHeight = Math.max(0.34, bodyHeight * 0.6);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(width * 0.045, gateHeight, width * 0.045), stoneMaterial);
        post.position.set(side * width * 0.24, gateHeight / 2, depth * 0.78);
        gate.add(post);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(width * 0.56, width * 0.055, width * 0.055), stoneMaterial);
      lintel.position.set(0, gateHeight, depth * 0.78);
      gate.add(lintel);
      lod1.add(gate);
    }

    if (grammar.chimneys > 0 || grammar.vents > 0) {
      const count = Math.min(3, Math.max(grammar.chimneys, grammar.vents));
      for (let index = 0; index < count; index++) {
        const x = count === 1 ? 0 : -width * 0.28 + (width * 0.56 * index) / (count - 1);
        const stackHeight = height * (grammar.chimneys > 0 ? 0.5 : 0.34);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.035, width * 0.045, stackHeight, 6), metalMaterial);
        stack.position.set(x, bodyHeight + stackHeight * 0.38, -depth * 0.18);
        lod1.add(stack);
      }
    }

    // Frontage and crown are the two cues the mid LOD must not throw away: they are what makes
    // a market, a council, a garrison and a foundry different shapes rather than different colours.
    const roofY = bodyHeight + roofHeight;
    switch (grammar.frontage) {
      case 'market-stalls': {
        const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 1.05, height * 0.035, depth * 0.8), roofMaterial);
        awning.position.set(0, bodyHeight * 0.86, depth * 0.86);
        lod1.add(awning);
        break;
      }
      case 'colonnade':
      case 'ward-pavilion': {
        const arcade = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, bodyHeight * 0.82, depth * 0.2), bodyMaterial);
        arcade.position.set(0, bodyHeight * 0.41, depth * 0.62);
        lod1.add(arcade);
        break;
      }
      case 'portico': {
        const block = new THREE.Mesh(new THREE.BoxGeometry(width * 0.62, bodyHeight * 1.12, depth * 0.44), stoneMaterial);
        block.position.set(0, bodyHeight * 0.56, depth * 0.6);
        lod1.add(block);
        break;
      }
      case 'loading-dock': {
        const dock = new THREE.Mesh(new THREE.BoxGeometry(width * 1.06, bodyHeight * 0.28, depth * 0.5), stoneMaterial);
        dock.position.set(0, bodyHeight * 0.14, depth * 0.74);
        lod1.add(dock);
        break;
      }
      case 'work-yard': {
        const shed = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, bodyHeight * 0.7, depth * 1.1), bodyMaterial);
        shed.position.set(width * 0.71, bodyHeight * 0.35, 0);
        lod1.add(shed);
        break;
      }
      case 'guard-screen': {
        const screen = new THREE.Mesh(new THREE.BoxGeometry(width * 1.12, bodyHeight * 0.9, depth * 0.14), stoneMaterial);
        screen.position.set(0, bodyHeight * 0.45, depth * 0.75);
        lod1.add(screen);
        break;
      }
      case 'none':
        break;
    }

    const crown = buildCrownLod(grammar, width, depth, roofY, crownHeight, roofMaterial, stoneMaterial, metalMaterial);
    if (crown) lod1.add(crown);

    const farBodyHeight = Math.max(0.1, (height - crownHeight) * 0.9);
    const lod2 = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.92, farBodyHeight, depth * 0.92),
      bodyMaterial,
    );
    // BoxGeometry is centred; lift it so the distant silhouette remains grounded.
    lod2.position.y = farBodyHeight * 0.5;
    const farCrown = farCrownSilhouette(grammar, width, depth, farBodyHeight, crownHeight, bodyMaterial);
    if (!farCrown) return [lod1, lod2];
    const far = new THREE.Group();
    far.add(lod2, farCrown);
    return [lod1, far];
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
    return `${type}:${config.seed}:${config.era}:${config.variant || 'default'}:${d ? [d.form, d.need, d.level, d.material, d.style.pattern, d.style.secondary, d.style.accent].join(':') : ''}:${history}`;
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
    this.cache.forEach(asset => {
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
