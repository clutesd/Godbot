/**
 * CultureStyleProfile.ts
 * 
 * Defines the architectural and visual grammar of a culture.
 * This grammar persists across all eras, ensuring cultural identity doesn't dissolve with technological advancement.
 * 
 * Key principle: An advanced-era Japanese-influenced civilization should still look Japanese.
 * An advanced-era African-inspired civilization should still look African.
 */

import type { CultureStyle } from '../../sim/types';
import type { Era } from '../materials/MaterialPalette';

export type RoofLanguage = 'layered-asian' | 'gable-geometric' | 'dome-organic' | 'pyramid-stepped';
export type MotifFamily = 'sun-step' | 'river-eye' | 'woven-moon' | 'mountain-knot' | 'seed-spiral';
export type PatternStyle = 'chevron' | 'diamond' | 'terrace' | 'crossweave' | 'wave';
export type TrimDensity = 'minimal' | 'restrained' | 'ornate' | 'elaborate';
export type MaterialBias = 'wood' | 'stone' | 'clay' | 'metal' | 'mixed';

/** How far the roof reaches past the wall. Deep eaves are the signature of the layered family. */
export type EaveDepth = 'shallow' | 'standard' | 'deep' | 'sweeping';
/** The curve of the roof plane between eave and ridge. */
export type RoofCurvature = 'straight' | 'gentle' | 'sweeping' | 'convex';
/** Where the culture puts its symbol on a building. */
export type SymbolPlacement = 'ridge' | 'gable' | 'band' | 'gate';

export interface EraInheritance {
  roofLanguage: RoofLanguage;
  trimDensityMultiplier: number; // How much trim detail to add relative to base
  materialBias: MaterialBias;
  scaleFactor: number; // How much larger/more massive buildings become
}

const ERA_ORDER: readonly Era[] = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'];

const EAVE_DEPTH_BY_ROOF: Record<RoofLanguage, EaveDepth> = {
  'layered-asian': 'sweeping',
  'gable-geometric': 'standard',
  'dome-organic': 'shallow',
  'pyramid-stepped': 'deep',
};

const ROOF_CURVATURE_BY_ROOF: Record<RoofLanguage, RoofCurvature> = {
  'layered-asian': 'sweeping',
  'gable-geometric': 'gentle',
  'dome-organic': 'convex',
  'pyramid-stepped': 'straight',
};

const SYMBOL_PLACEMENT_BY_ROOF: Record<RoofLanguage, SymbolPlacement> = {
  'layered-asian': 'ridge',
  'gable-geometric': 'gable',
  'dome-organic': 'band',
  'pyramid-stepped': 'gate',
};

const EAVE_DEPTH_VALUE: Record<EaveDepth, number> = {
  shallow: 0.16,
  standard: 0.28,
  deep: 0.34,
  sweeping: 0.42,
};

const ROOF_CURVATURE_VALUE: Record<RoofCurvature, number> = {
  straight: 0.1,
  gentle: 0.28,
  sweeping: 0.75,
  convex: -0.45,
};

/**
 * Encodes the visual grammar of a culture that persists across all eras
 */
export class CultureStyleProfile {
  readonly cultureId: string;
  readonly roofLanguage: RoofLanguage;
  readonly motifFamily: MotifFamily;
  readonly patternStyle: PatternStyle;
  readonly trimDensity: TrimDensity;
  readonly materialBias: MaterialBias;
  readonly eaveDepth: EaveDepth;
  readonly roofCurvature: RoofCurvature;
  readonly symbolPlacement: SymbolPlacement;

  private readonly eraProgression: Map<Era, EraInheritance>;

  constructor(
    cultureId: string,
    style: CultureStyle,
    roofLanguage?: RoofLanguage,
    trimDensity?: TrimDensity,
    materialBias?: MaterialBias,
  ) {
    this.cultureId = cultureId;
    this.roofLanguage = roofLanguage || this.inferRoofLanguage(style);
    this.motifFamily = style.symbol as MotifFamily;
    this.patternStyle = style.pattern as PatternStyle;
    this.trimDensity = trimDensity || this.inferTrimDensity(style);
    this.materialBias = materialBias || this.inferMaterialBias(style);
    this.eaveDepth = EAVE_DEPTH_BY_ROOF[this.roofLanguage];
    this.roofCurvature = ROOF_CURVATURE_BY_ROOF[this.roofLanguage];
    this.symbolPlacement = SYMBOL_PLACEMENT_BY_ROOF[this.roofLanguage];

    this.eraProgression = this.buildEraInheritance();
  }

  /** Eave overhang as a fraction of the half-footprint, growing slightly with construction skill. */
  getEaveOverhang(era: Era): number {
    const base = EAVE_DEPTH_VALUE[this.eaveDepth];
    return base + ERA_ORDER.indexOf(era) * 0.008;
  }

  /** Positive values sag the roof plane, negative values bulge it into a shell. */
  getRoofCurvatureValue(): number {
    return ROOF_CURVATURE_VALUE[this.roofCurvature];
  }

  /** Corner lift on the eave line, amplified by how ornate the structure is. */
  getEaveUpturn(ornament: number): number {
    switch (this.roofCurvature) {
      case 'sweeping':
        return 0.16 + ornament * 0.16;
      case 'convex':
        return 0.04;
      case 'gentle':
        return 0.05 + ornament * 0.08;
      case 'straight':
        return 0.02 + ornament * 0.05;
    }
  }

  /**
   * Infer roof language from cultural dimensions and symbols
   */
  private inferRoofLanguage(style: CultureStyle): RoofLanguage {
    const symbol = style.symbol;
    const pattern = style.pattern;

    // Mountain/mountain-knot cultures → layered Asian style (visually echo terracing)
    if (symbol === 'mountain-knot' || pattern === 'terrace') {
      return 'layered-asian';
    }

    // River/water/wave cultures → geometric, flowing roofs
    if (symbol === 'river-eye' || pattern === 'wave' || pattern === 'crossweave') {
      return 'gable-geometric';
    }

    // Moon/sun/spiral cultures → organic dome or pyramid
    if (symbol === 'woven-moon' || symbol === 'seed-spiral') {
      return 'dome-organic';
    }

    // Sun/step cultures → stepped/pyramid roofs
    if (symbol === 'sun-step') {
      return 'pyramid-stepped';
    }

    // Default
    return 'gable-geometric';
  }

  /**
   * Infer trim density from cultural cooperation/institutionalTrust
   */
  private inferTrimDensity(style: CultureStyle): TrimDensity {
    // African-inspired patterns (chevron, diamond, terrace) tend toward ornate
    if (style.pattern === 'chevron' || style.pattern === 'diamond' || style.pattern === 'terrace') {
      return 'ornate';
    }

    // Asian patterns (wave, crossweave) tend toward restrained
    if (style.pattern === 'wave' || style.pattern === 'crossweave') {
      return 'restrained';
    }

    return 'minimal';
  }

  /**
   * Infer primary material bias from cultural symbols
   */
  private inferMaterialBias(style: CultureStyle): MaterialBias {
    const symbol = style.symbol;

    // River cultures → wood (easier to work with water access)
    if (symbol === 'river-eye') {
      return 'wood';
    }

    // Mountain cultures → stone (natural availability)
    if (symbol === 'mountain-knot') {
      return 'stone';
    }

    // Sun/step cultures → clay (Africa-inspired, earthen)
    if (symbol === 'sun-step') {
      return 'clay';
    }

    // Mixed by default
    return 'mixed';
  }

  /**
   * Build era progression rules that maintain cultural identity
   */
  private buildEraInheritance(): Map<Era, EraInheritance> {
    const progression = new Map<Era, EraInheritance>();

    // Each era evolves the base grammar but maintains core identity
    progression.set('primitive', {
      roofLanguage: this.roofLanguage,
      trimDensityMultiplier: 0.2, // Very minimal detail
      materialBias: this.materialBias,
      scaleFactor: 1.0,
    });

    progression.set('early', {
      roofLanguage: this.roofLanguage,
      trimDensityMultiplier: 0.4,
      materialBias: this.materialBias,
      scaleFactor: 1.1,
    });

    progression.set('village', {
      roofLanguage: this.roofLanguage,
      trimDensityMultiplier: 0.6,
      materialBias: this.materialBias,
      scaleFactor: 1.2,
    });

    progression.set('preIndustrial', {
      roofLanguage: this.roofLanguage,
      trimDensityMultiplier: 0.8,
      materialBias: this.materialBias,
      scaleFactor: 1.3,
    });

    progression.set('industrial', {
      roofLanguage: this.roofLanguage, // ← STILL using culture's roof language!
      trimDensityMultiplier: 1.0,
      materialBias: this.materialBias === 'mixed' ? 'metal' : this.materialBias,
      scaleFactor: 1.5,
    });

    progression.set('advanced', {
      roofLanguage: this.roofLanguage, // ← STILL using culture's roof language!
      trimDensityMultiplier: 1.2,
      materialBias: 'metal', // Advanced eras show more metal/tech
      scaleFactor: 1.6,
    });

    return progression;
  }

  /**
   * Get era-specific inheritance for this culture
   */
  getEraInheritance(era: Era): EraInheritance {
    return this.eraProgression.get(era)!;
  }

  /**
   * Get trim density multiplier for era (controls detail/ornament density)
   */
  getTrimDensity(era: Era): number {
    const base = this.trimDensityToValue(this.trimDensity);
    const eraMultiplier = this.eraProgression.get(era)!.trimDensityMultiplier;
    return base * eraMultiplier;
  }

  /**
   * Convert trim density enum to numeric value
   */
  private trimDensityToValue(density: TrimDensity): number {
    switch (density) {
      case 'minimal':
        return 0.2;
      case 'restrained':
        return 0.5;
      case 'ornate':
        return 0.8;
      case 'elaborate':
        return 1.2;
    }
  }

  /**
   * Get material bias for this culture in a given era
   */
  getMaterialBias(era: Era): MaterialBias {
    return this.eraProgression.get(era)!.materialBias;
  }

  /**
   * Get building scale factor for era (how large buildings become as tech advances)
   */
  getScaleFactor(era: Era): number {
    return this.eraProgression.get(era)!.scaleFactor;
  }

  /**
   * Describe the motif pattern for banner/decorative placement
   */
  getMotifDescription(): string {
    const motifNames: Record<MotifFamily, string> = {
      'sun-step': 'stepped sun rays',
      'river-eye': 'flowing river forms',
      'woven-moon': 'lunar crescents',
      'mountain-knot': 'interlocked peaks',
      'seed-spiral': 'spiraling seeds/growth',
    };
    return motifNames[this.motifFamily];
  }

  /**
   * Describe the cultural style for documentation/debugging
   */
  describe(): string {
    return `${this.roofLanguage} roofs | ${this.trimDensity} trim | ${this.materialBias} materials | ${this.getMotifDescription()}`;
  }

  /**
   * Check if this culture preserves its identity through industrial/advanced eras
   * (Should always be true with proper inheritance rules)
   */
  preservesIdentityThroughEras(): boolean {
    const primitive = this.eraProgression.get('primitive')!;
    const industrial = this.eraProgression.get('industrial')!;
    const advanced = this.eraProgression.get('advanced')!;

    return (
      primitive.roofLanguage === industrial.roofLanguage &&
      industrial.roofLanguage === advanced.roofLanguage
    );
  }
}

/**
 * Factory for creating profiles from culture data
 * Allows automatic inference or manual override
 */
export class CultureStyleProfileFactory {
  /**
   * Create a profile with automatic inference from cultural data
   */
  static createFromCulture(
    cultureId: string,
    style: CultureStyle,
  ): CultureStyleProfile {
    return new CultureStyleProfile(cultureId, style);
  }

  /**
   * Create a profile with explicit customization
   */
  static createCustom(
    cultureId: string,
    style: CultureStyle,
    roofLanguage: RoofLanguage,
    trimDensity: TrimDensity,
    materialBias: MaterialBias,
  ): CultureStyleProfile {
    return new CultureStyleProfile(cultureId, style, roofLanguage, trimDensity, materialBias);
  }
}
