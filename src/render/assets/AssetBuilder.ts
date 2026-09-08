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
import { resolveBuildingGrammar, type BuildingRole } from './BuildingGrammar';
import { BUILD_STAGE, composeBuilding, type BuildStage } from './BuildingComposer';
import { SeededRandom } from '../../sim/prng';

export type AssetType = 'tree' | 'building' | 'humanoid' | 'terrain-deco' | 'infrastructure';

export interface AssetConfig {
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

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return {
        mesh: cached.mesh,
        lods: cached.lods,
      };
    }

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
   * All form comes from the resolved BuildingGrammar; the variant encodes `role#stage`, so
   * one cache entry serves every instance of a given culture/era/role/construction stage.
   */
  private generateBuilding(config: AssetConfig): {
    mesh: THREE.Group;
    lods: THREE.Object3D[];
    material: THREE.Material;
  } {
    const palette = this.getOrCreatePalette(config);
    const profile = this.getOrCreateCultureProfile(config);
    const [roleName, stageName] = (config.variant ?? 'house').split('#');
    const role = (roleName || 'house') as BuildingRole;
    const stage = stageName === undefined ? BUILD_STAGE.DETAIL : (Number(stageName) as BuildStage);
    const grammar = resolveBuildingGrammar(profile, config.era, role, config.seed);
    const composed = composeBuilding(grammar, palette, config.seed, stage);
    composed.group.userData['buildingHeight'] = composed.height;
    composed.group.userData['footprintWidth'] = composed.extentX;
    composed.group.userData['footprintDepth'] = composed.extentZ;

    return {
      mesh: composed.group,
      lods: this.generateBuildingLODs(grammar.width, grammar.depth, composed.height, palette),
      material: palette.getSurfaceMaterial('plaster'),
    };
  }

  private generateBuildingLODs(
    width: number,
    depth: number,
    height: number,
    palette: MaterialPalette,
  ): THREE.Object3D[] {
    const lods: THREE.Object3D[] = [];

    // LOD 1: massing block plus roof cap, enough to keep the skyline reading at range.
    const lod1 = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.6, depth), palette.getSurfaceMaterial('plaster'));
    body.position.y = height * 0.3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.72, height * 0.4, 4), palette.getRoofMaterial());
    cap.position.y = height * 0.78;
    cap.rotation.y = Math.PI / 4;
    lod1.add(body, cap);
    lods.push(lod1);

    // LOD 2: silhouette only.
    const lod2Geometry = new THREE.BoxGeometry(width * 0.9, height * 0.8, depth * 0.9);
    const lod2 = new THREE.Mesh(lod2Geometry, palette.getSurfaceMaterial('plaster'));
    lods.push(lod2);

    return lods;
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

    // LOD 1: Simplified (torso + head only)
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
   * Generate cache key
   */
  private getCacheKey(type: AssetType, config: AssetConfig): string {
    return `${type}:${config.seed}:${config.era}:${config.variant || 'default'}`;
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
    this.cache.set(key, {
      mesh,
      material,
      lods,
      config,
      createdAt: this.cacheClock++,
    });

    // Prune if cache is too large
    if (this.cache.size > this.maxCacheSize) {
      this.pruneCache();
    }
  }

  /**
   * Remove oldest cached items
   */
  private pruneCache(): void {
    const toRemove = Math.ceil(this.cache.size * 0.1); // Remove 10%
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );

    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) this.cache.delete(entry[0]);
    }
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
   * Get or create culture style profile
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
