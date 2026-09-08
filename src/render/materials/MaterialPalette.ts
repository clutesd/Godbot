/**
 * MaterialPalette.ts
 * 
 * Manages colors, materials, and material properties based on culture, era, and building type.
 * Ensures consistent visual language across all procedural assets.
 */

import * as THREE from 'three';
import type { CultureStyle } from '../../sim/types';

export type Era = 'primitive' | 'early' | 'village' | 'preIndustrial' | 'industrial' | 'advanced';

/**
 * Surfaces the architectural composer can ask for. Each maps to one shared material, so a
 * fully detailed building costs one draw call per surface it actually uses.
 */
export type SurfaceKey =
  | 'hide'
  | 'thatch'
  | 'daub'
  | 'plaster'
  | 'stone'
  | 'brick'
  | 'panel'
  | 'timber'
  | 'metal'
  | 'motif'
  | 'roof-thatch'
  | 'roof-tile'
  | 'roof-metal'
  | 'cloth'
  | 'shadow'
  | 'glow'
  | 'forge'
  | 'ground';

/**
 * The GODBOX built-environment colourway.
 * Warm earthen bodies and dark blue-grey tiles carry the Japanese half of the language;
 * terracotta, ochre, indigo, gold and turquoise carry the mosaic/textile half.
 */
const MOSAIC = {
  terracotta: 0xb0563b,
  ochre: 0xc9954c,
  indigo: 0x2c3763,
  gold: 0xe0b555,
  turquoise: 0x2f918c,
  plaster: 0xd8c6a4,
  daub: 0xa8845c,
  timber: 0x5c4131,
  charcoalTile: 0x3c4450,
  stone: 0x8b8579,
  hide: 0x9c7f5f,
  thatch: 0xa78a52,
  ash: 0x6f6a63,
} as const;

export interface PaletteConfig {
  culture: CultureStyle;
  era: Era;
  buildingType?: 'shelter' | 'house' | 'civic' | 'workshop' | 'factory' | 'advanced';
}

/**
 * Manages all material and color assets for a given culture and era
 */
export class MaterialPalette {
  private readonly baseColors: Map<string, THREE.Color>;
  private readonly materials: Map<string, THREE.MeshStandardMaterial>;
  private readonly config: PaletteConfig;
  private readonly emissiveBase = new Map<string, number>();
  private nightFactor = 0;

  constructor(config: PaletteConfig) {
    this.config = config;
    this.baseColors = new Map();
    this.materials = new Map();
    this.initializePalette();
    this.initializeSurfaces();
  }

  private initializePalette(): void {
    // Primary colors from culture
    const primary = new THREE.Color(this.config.culture.primary);
    const secondary = new THREE.Color(this.config.culture.secondary);
    const accent = new THREE.Color(this.config.culture.accent);

    this.baseColors.set('primary', primary);
    this.baseColors.set('secondary', secondary);
    this.baseColors.set('accent', accent);

    // Era-based material adjustments
    const roughnessBase = this.getEraRoughness();
    const metalnessBase = this.getEraMetalness();

    // Create material variants
    this.createMaterial('primary', primary, roughnessBase, metalnessBase);
    this.createMaterial('secondary', secondary, roughnessBase, metalnessBase);
    this.createMaterial('accent', accent, roughnessBase * 0.5, metalnessBase);

    // Neutral materials
    this.createMaterial('wood', new THREE.Color(0x6b5344), 0.8, 0);
    this.createMaterial('clay', new THREE.Color(0x9d6b3d), 0.75, 0);

    // Emissive materials for advanced structures
    if (this.config.era === 'industrial' || this.config.era === 'advanced') {
      const emissiveYellow = new THREE.Color(0xffdd00);
      const emissiveMaterial = new THREE.MeshStandardMaterial({
        color: emissiveYellow,
        emissive: emissiveYellow,
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0.1,
      });
      this.materials.set('emissive-glow', emissiveMaterial);

      // Electrical blue tint for advanced era
      if (this.config.era === 'advanced') {
        const electricalBlue = new THREE.Color(0x00ccff);
        const advancedMaterial = new THREE.MeshStandardMaterial({
          color: electricalBlue,
          emissive: electricalBlue,
          emissiveIntensity: 0.3,
          roughness: 0.2,
          metalness: 0.9,
        });
        this.materials.set('advanced-tech', advancedMaterial);
      }
    }

    // Damage/ruin materials
    this.createMaterial('damaged', new THREE.Color(0x5a4a3a), 0.95, 0); // Darkened
    this.createMaterial('ruined', new THREE.Color(0x4a3a2a), 0.98, 0); // Even darker
  }

  private createMaterial(
    key: string,
    color: THREE.Color,
    roughness: number,
    metalness: number,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      side: THREE.FrontSide,
    });

    material.userData['shared'] = true;
    this.materials.set(key, material);
    return material;
  }

  /**
   * Builds the architectural surface set.
   * Culture colour is blended into fixed earthen anchors rather than used raw, so every
   * civilisation stays inside the same family of terracotta, plaster, indigo tile and gold.
   */
  private initializeSurfaces(): void {
    const primary = this.baseColors.get('primary')!;
    const secondary = this.baseColors.get('secondary')!;
    const accent = this.baseColors.get('accent')!;
    const roughness = this.getEraRoughness();
    const metalness = this.getEraMetalness();
    const rank = this.eraRank();
    const blend = (hex: number, tint: THREE.Color, amount: number): THREE.Color =>
      new THREE.Color(hex).lerp(tint, amount);

    this.createMaterial('hide', blend(MOSAIC.hide, primary, 0.14), 0.98, 0);
    this.createMaterial('thatch', blend(MOSAIC.thatch, primary, 0.1), 0.97, 0);
    this.createMaterial('daub', blend(MOSAIC.daub, primary, 0.2), 0.93, 0);
    this.createMaterial('plaster', blend(MOSAIC.plaster, primary, 0.22), roughness, 0);
    this.createMaterial('stone', blend(MOSAIC.stone, secondary, 0.12), Math.min(0.95, roughness + 0.06), 0);
    this.createMaterial('brick', blend(MOSAIC.terracotta, primary, 0.3), roughness, 0.02);
    this.createMaterial('panel', blend(MOSAIC.plaster, secondary, 0.4), roughness * 0.72, Math.min(0.42, metalness));
    this.createMaterial('timber', blend(MOSAIC.timber, primary, 0.16), 0.92, 0);
    this.createMaterial('metal', blend(MOSAIC.ash, secondary, 0.32), Math.max(0.3, roughness * 0.55), Math.max(0.35, metalness));
    this.createMaterial('cloth', blend(0xffffff, primary, 0.86), 0.86, 0);
    this.createMaterial('shadow', new THREE.Color(0x1d1a1c), 0.99, 0);
    this.createMaterial('ground', blend(MOSAIC.stone, accent, 0.16), 0.94, 0);

    // Roof families: thatch early, deep blue-grey tile once the culture fires clay,
    // and a lighter alloy shell for industrial/advanced canopies.
    this.createMaterial('roof-thatch', blend(MOSAIC.thatch, secondary, 0.16), 0.96, 0);
    this.createMaterial('roof-tile', blend(MOSAIC.charcoalTile, secondary, 0.5), Math.min(0.9, roughness + 0.04), 0.04);
    this.createMaterial('roof-metal', blend(MOSAIC.ash, secondary, 0.45), Math.max(0.28, roughness * 0.5), Math.max(0.45, metalness));

    // Motif inlay is the load-bearing ornament of the style, so it always reads gold-warm
    // against the wall, and starts to self-illuminate once the civilisation has power.
    const motif = this.createMaterial('motif', blend(MOSAIC.gold, accent, 0.55), roughness * 0.6, Math.min(0.35, metalness + 0.05));
    if (rank >= 4) {
      motif.emissive = blend(MOSAIC.turquoise, accent, 0.5);
      this.emissiveBase.set('motif', rank >= 5 ? 0.35 : 0.16);
      motif.emissiveIntensity = 0;
    }

    const lantern = new THREE.Color(rank >= 4 ? 0xfff0c6 : 0xffcf8a).lerp(accent, 0.18);
    const glow = this.createMaterial('glow', lantern, 0.42, 0);
    glow.emissive = lantern;
    glow.emissiveIntensity = 0;
    this.emissiveBase.set('glow', 1.4 + rank * 0.42);

    const heat = rank >= 5 ? new THREE.Color(0x63d8ff).lerp(accent, 0.2) : new THREE.Color(0xff7326);
    const forge = this.createMaterial('forge', heat, 0.5, 0.1);
    forge.emissive = heat;
    forge.emissiveIntensity = 1.6;
    this.emissiveBase.set('forge', 1.6);
    this.applyNightFactor();
  }

  private eraRank(): number {
    switch (this.config.era) {
      case 'primitive':
        return 0;
      case 'early':
        return 1;
      case 'village':
        return 2;
      case 'preIndustrial':
        return 3;
      case 'industrial':
        return 4;
      case 'advanced':
        return 5;
    }
  }

  getSurfaceMaterial(surface: SurfaceKey): THREE.MeshStandardMaterial {
    return this.materials.get(surface) ?? this.materials.get('plaster')!;
  }

  /**
   * 0 at midday, 1 at deep night. Windows, lanterns and motif inlay light up so settlements
   * stay legible — and feel inhabited — after dark.
   */
  setNightFactor(factor: number): void {
    const clamped = Math.max(0, Math.min(1, factor));
    if (Math.abs(clamped - this.nightFactor) < 0.01) return;
    this.nightFactor = clamped;
    this.applyNightFactor();
  }

  private applyNightFactor(): void {
    for (const [key, base] of this.emissiveBase) {
      const material = this.materials.get(key);
      if (!material) continue;
      material.emissiveIntensity = key === 'forge' ? base * (0.55 + this.nightFactor * 0.75) : base * this.nightFactor;
    }
  }

  /**
   * Get material based on building type and current era
   */
  getMaterial(type: 'primary' | 'secondary' | 'accent' | 'wood' | 'stone' | 'clay' | 'metal' | 'thatch' | 'emissive-glow' | 'advanced-tech' | 'damaged' | 'ruined'): THREE.MeshStandardMaterial {
    const material = this.materials.get(type);
    if (!material) {
      console.warn(`Material not found: ${type}, returning primary`);
      return this.materials.get('primary')!;
    }
    return material;
  }

  /**
   * Get a color for decorative elements (banners, patterns, etc.)
   */
  getColor(
    type: 'primary' | 'secondary' | 'accent' | 'neutral',
  ): THREE.Color {
    if (type === 'neutral') {
      return new THREE.Color(0x999999);
    }
    const color = this.baseColors.get(type);
    if (!color) {
      console.warn(`Color not found: ${type}, returning white`);
      return new THREE.Color(0xffffff);
    }
    return color.clone();
  }

  /**
   * Get building base material based on era and culture
   */
  getBuildingBaseMaterial(): THREE.MeshStandardMaterial {
    // Early eras use natural materials
    if (this.config.era === 'primitive' || this.config.era === 'early') {
      return this.getMaterial('wood');
    }
    
    // Village and pre-industrial can mix materials
    if (this.config.era === 'village' || this.config.era === 'preIndustrial') {
      return this.getMaterial('clay');
    }
    
    // Industrial and advanced use more processed materials
    return this.getMaterial('stone');
  }

  /**
   * Get roof material based on culture and era
   */
  getRoofMaterial(): THREE.MeshStandardMaterial {
    if (this.config.era === 'primitive' || this.config.era === 'early') {
      return this.getSurfaceMaterial('roof-thatch');
    }
    return this.getSurfaceMaterial('roof-tile');
  }

  /**
   * Get accent lighting color for settlements
   */
  getAccentLightColor(): THREE.Color {
    return this.baseColors.get('accent')!.clone();
  }

  /**
   * Get material for routes/roads based on era
   */
  getRouteMaterial(): THREE.MeshStandardMaterial {
    if (this.config.era === 'primitive') {
      return this.getMaterial('clay');
    }
    if (this.config.era === 'early' || this.config.era === 'village') {
      return this.getMaterial('wood');
    }
    return this.getMaterial('stone');
  }

  /**
   * Get material for infrastructure elements
   */
  getInfrastructureMaterial(type: 'workshop' | 'archive' | 'port' | 'factory' | 'reactor'): THREE.MeshStandardMaterial {
    if (type === 'factory' || type === 'reactor') {
      return this.getMaterial('metal');
    }
    if (type === 'port') {
      return this.getMaterial('wood');
    }
    return this.getMaterial('stone');
  }

  /**
   * Determine roughness based on era progression
   */
  private getEraRoughness(): number {
    switch (this.config.era) {
      case 'primitive':
        return 0.95; // Very rough, natural finishes
      case 'early':
        return 0.90;
      case 'village':
        return 0.85;
      case 'preIndustrial':
        return 0.80;
      case 'industrial':
        return 0.70; // Slightly more refined
      case 'advanced':
        return 0.60; // Smoother, more processed
    }
  }

  /**
   * Determine metalness based on era progression
   */
  private getEraMetalness(): number {
    switch (this.config.era) {
      case 'primitive':
        return 0; // No metals visible
      case 'early':
        return 0;
      case 'village':
        return 0.05; // Small amounts of metalwork
      case 'preIndustrial':
        return 0.1;
      case 'industrial':
        return 0.3; // Industrial era shows metal more
      case 'advanced':
        return 0.5; // Advanced tech heavy on metal
    }
  }

  /**
   * Get damage-adjusted material for ruined structures
   */
  getDamagedMaterial(baseMaterial: THREE.MeshStandardMaterial, damageLevel: number): THREE.MeshStandardMaterial {
    // damageLevel: 0 (intact) to 1 (completely ruined)
    const darkened = new THREE.Color(baseMaterial.color);
    darkened.multiplyScalar(1 - damageLevel * 0.5);

    const material = new THREE.MeshStandardMaterial({
      color: darkened,
      roughness: baseMaterial.roughness + damageLevel * 0.2,
      metalness: Math.max(0, baseMaterial.metalness - damageLevel * 0.3),
    });
    return material;
  }

  /**
   * Clone the palette for a different era
   */
  cloneForEra(era: Era): MaterialPalette {
    return new MaterialPalette({
      ...this.config,
      era,
    });
  }

  /**
   * Dispose all materials (call on cleanup)
   */
  dispose(): void {
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.baseColors.clear();
  }
}
