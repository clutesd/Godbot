import type { Biome, InfrastructureState, InstitutionKind, Occupation, KnowledgeDomain } from '../types';

export type ResourceCategory = 'plant' | 'timber' | 'mineral';

/**
 * A data-driven definition of a physically sited raw resource. New resources (coal, petroleum,
 * industrial minerals, uranium-equivalents, ...) are added here without touching simulation logic:
 * WorldResourceSystem and ResourceSystem both work generically off this catalog.
 */
export interface ResourceDefinition {
  id: string;
  name: string;
  category: ResourceCategory;
  renewable: boolean;
  description: string;
  /** Biomes where this resource can occur at all. */
  biomes: readonly Biome[];
  minFertility?: number;
  minMoisture?: number;
  minWood?: number;
  minMinerals?: number;
  minRockiness?: number;
  /** 0..1; lower means rarer deposits (scarcity like tin drives trade/dependence). */
  rarity: number;
  /** Typical intrinsic richness of a deposit, 0..1. */
  baseQuality: number;
  /** Renewables: fraction of capacity restored per month under healthy conditions. */
  regenRate: number;
  /** Abstract capacity units for a single deposit (original stock or sustainable standing stock). */
  depositCapacityRange: readonly [number, number];
  /** Which occupations can physically gather this resource. */
  gatherOccupations: readonly Occupation[];
  /** Units produced per gathering worker per month at quality 1 and full accessibility. */
  gatherYieldPerWorker: number;
  /**
   * Knowledge id that must be at least partly understood before this deposit can be meaningfully
   * recognised and worked (e.g. ore looks like ordinary rock without material-testing).
   */
  understandingKnowledge?: string;
  /** Deeper reserves require practical extraction knowledge and workshops. */
  extractionKnowledge?: string;
  surfaceShare?: number;
  researchDomain?: KnowledgeDomain;
  ecologicalDamage?: number;
}

export const RESOURCE_CATALOG: readonly ResourceDefinition[] = [
  {
    id: 'wild-herbs', name: 'Wild medicinal herbs', category: 'plant', renewable: true,
    description: 'Flowering, rooted, and aromatic plants gathered from healthy ground cover; a source of medicine, dye, and poison alike.',
    biomes: ['grassland', 'forest', 'wetland'], minFertility: 0.3, minMoisture: 0.3,
    rarity: 0.6, baseQuality: 0.55, regenRate: 0.025, depositCapacityRange: [40, 120], researchDomain: 'medicine',
    gatherOccupations: ['forager'], gatherYieldPerWorker: 0.9,
  },
  {
    id: 'timber', name: 'Standing timber', category: 'timber', renewable: true,
    description: 'Mature forest stands suitable for construction, fuel, and tool stock.',
    biomes: ['forest', 'grassland', 'wetland', 'highland'], minWood: 0.3,
    rarity: 0.7, baseQuality: 0.6, regenRate: 0, depositCapacityRange: [240, 600], researchDomain: 'materials',
    gatherOccupations: ['forager', 'builder'], gatherYieldPerWorker: 1.1,
  },
  {
    id: 'stone', name: 'Quarriable stone', category: 'mineral', renewable: false,
    description: 'Exposed rock and scree workable into masonry with only surface tools.',
    biomes: ['forest', 'grassland', 'dryland', 'highland', 'mountain'], minRockiness: 0.08,
    rarity: 0.6, baseQuality: 0.7, regenRate: 0, depositCapacityRange: [500, 1400],
    gatherOccupations: ['forager', 'builder'], gatherYieldPerWorker: 0.8,
    extractionKnowledge: 'leverage', surfaceShare: 0.3, ecologicalDamage: 0.035, researchDomain: 'materials',
  },
  {
    id: 'copper-ore', name: 'Copper ore', category: 'mineral', renewable: false,
    description: 'Native copper and oxidized ore bodies workable with early metallurgy.',
    biomes: ['highland', 'mountain', 'dryland'], minMinerals: 0.4, minRockiness: 0.3,
    rarity: 0.32, baseQuality: 0.5, regenRate: 0, depositCapacityRange: [180, 480],
    gatherOccupations: ['forager', 'artisan'], gatherYieldPerWorker: 0.55,
    understandingKnowledge: 'material-testing',
    extractionKnowledge: 'metal-smelting', surfaceShare: 0.25, ecologicalDamage: 0.08, researchDomain: 'materials',
  },
  {
    id: 'tin-ore', name: 'Tin ore', category: 'mineral', renewable: false,
    description: 'Rare cassiterite deposits essential for bronze alloying; scarcity drives long-distance trade.',
    biomes: ['highland', 'mountain'], minMinerals: 0.5, minRockiness: 0.4,
    rarity: 0.12, baseQuality: 0.45, regenRate: 0, depositCapacityRange: [70, 220],
    gatherOccupations: ['forager', 'artisan'], gatherYieldPerWorker: 0.4,
    understandingKnowledge: 'material-testing',
    extractionKnowledge: 'metal-smelting', surfaceShare: 0.22, ecologicalDamage: 0.08, researchDomain: 'materials',
  },
  {
    id: 'iron-ore', name: 'Iron ore', category: 'mineral', renewable: false,
    description: 'Iron-bearing rock that requires sustained heat and skill to reduce to usable metal.',
    biomes: ['highland', 'mountain'], minMinerals: 0.45, minRockiness: 0.35,
    rarity: 0.28, baseQuality: 0.5, regenRate: 0, depositCapacityRange: [220, 620],
    gatherOccupations: ['forager', 'artisan'], gatherYieldPerWorker: 0.5,
    understandingKnowledge: 'material-testing',
    extractionKnowledge: 'iron-working', surfaceShare: 0.25, ecologicalDamage: 0.1, researchDomain: 'materials',
  },
];

export const RESOURCE_BY_ID = new Map(RESOURCE_CATALOG.map((definition) => [definition.id, definition]));

/**
 * A learned process turning gathered/crafted materials into a more useful material or good.
 * Recipes are discoverable, not universal: a settlement can only run one once it holds the
 * required knowledge at sufficient practice, the necessary infrastructure, and the physical
 * inputs. This is the extension point for steel, gunpowder, glass, paper, pharmaceuticals, and
 * nuclear-fuel processing later without any change to ResourceSystem.
 */
export interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  /** All of these knowledge ids must be practiced to at least this level. */
  requiredKnowledge: ReadonlyArray<{ id: string; minPractice: number }>;
  /** Material ids consumed per craft cycle. */
  inputs: Readonly<Record<string, number>>;
  /** Material ids produced per craft cycle at full efficiency. */
  outputs: Readonly<Record<string, number>>;
  craftOccupations: readonly Occupation[];
  /** Minimum settlement infrastructure levels (e.g. workshops) required to run this recipe at all. */
  requiredInfrastructure?: Readonly<Partial<InfrastructureState>>;
  requiredInstitutions?: readonly InstitutionKind[];
  minIndustrialIntensity?: number;
  /** 0..1 fraction of theoretical output realised even at minimum viable mastery. */
  baseEfficiency: number;
  /** 0..1 chance a cycle wastes its inputs at minimum viable mastery; falls toward 0 with mastery. */
  failureRisk: number;
  labour?: number;
  researchWork?: number;
  energy?: { fuel: string; quantity: number; minimumHeat: number };
  byproducts?: Readonly<Record<string, number>>;
  unlocks?: readonly string[];
}

export const RECIPE_CATALOG: readonly RecipeDefinition[] = [
  {
    id: 'herbal-remedy', name: 'Herbal remedy preparation',
    description: 'Drying and compounding wild herbs into a usable medicine.',
    requiredKnowledge: [{ id: 'anatomical-observation', minPractice: 0.05 }],
    inputs: { 'wild-herbs': 3 }, outputs: { 'herbal-remedy': 2 },
    craftOccupations: ['keeper', 'elder'], baseEfficiency: 0.65, failureRisk: 0.15,
    labour: 0.5, researchWork: 1, unlocks: ['apothecary'],
  },
  {
    id: 'charcoal', name: 'Charcoal production',
    description: 'Slow, controlled burning of timber into dense fuel hot enough for smelting.',
    requiredKnowledge: [{ id: 'fire-control', minPractice: 0.2 }],
    inputs: { timber: 4 }, outputs: { charcoal: 2 },
    craftOccupations: ['forager', 'builder'], baseEfficiency: 0.7, failureRisk: 0.1,
    labour: 0.4, researchWork: 0.8, byproducts: { ash: 0.3 }, unlocks: ['fuel-yard'],
  },
  {
    id: 'bronze-ingot', name: 'Bronze casting',
    description: 'Alloying copper and tin under sustained charcoal heat.',
    requiredKnowledge: [{ id: 'metal-smelting', minPractice: 0.3 }],
    inputs: { 'copper-ore': 3, 'tin-ore': 1 }, outputs: { bronze: 2 },
    energy: { fuel: 'charcoal', quantity: 2, minimumHeat: 0.6 }, labour: 1, researchWork: 2,
    byproducts: { slag: 0.5 }, unlocks: ['bronze-foundry'],
    craftOccupations: ['artisan'], requiredInfrastructure: { workshops: 0.05 },
    baseEfficiency: 0.6, failureRisk: 0.2,
  },
  {
    id: 'iron-tools', name: 'Iron smelting and tool-making',
    description: 'Smelting iron ore into workable blooms and forging them into tools and weapons.',
    requiredKnowledge: [{ id: 'iron-working', minPractice: 0.3 }],
    inputs: { 'iron-ore': 4 }, outputs: { 'iron-tools': 2 },
    energy: { fuel: 'charcoal', quantity: 3, minimumHeat: 0.7 }, labour: 1.2, researchWork: 3,
    byproducts: { slag: 0.7 }, unlocks: ['smithy'],
    craftOccupations: ['artisan'], requiredInfrastructure: { workshops: 0.08 },
    baseEfficiency: 0.55, failureRisk: 0.22,
  },
  {
    id: 'timber-framing', name: 'Timber framing', description: 'Seasoned and joined structural timber.',
    requiredKnowledge: [{ id: 'stone-composites', minPractice: 0.18 }], inputs: { timber: 3 }, outputs: { 'timber-frame': 2 },
    craftOccupations: ['builder'], baseEfficiency: 0.8, failureRisk: 0.05, labour: 0.8, researchWork: 1.5, unlocks: ['carpentry'],
  },
  {
    id: 'masonry', name: 'Dressed masonry', description: 'Shaped and fitted stone for lasting structures.',
    requiredKnowledge: [{ id: 'leverage', minPractice: 0.25 }, { id: 'stone-composites', minPractice: 0.3 }],
    inputs: { stone: 3 }, outputs: { 'dressed-stone': 2 }, craftOccupations: ['builder'],
    baseEfficiency: 0.8, failureRisk: 0.06, labour: 0.8, researchWork: 2, unlocks: ['masonry'],
  },
];

export const RECIPE_BY_ID = new Map(RECIPE_CATALOG.map((definition) => [definition.id, definition]));

export interface MaterialDefinition { id: string; name: string; spoilage: number; fuelHeat?: number }
export const MATERIAL_CATALOG: readonly MaterialDefinition[] = [
  ...RESOURCE_CATALOG.map(r => ({ id: r.id, name: r.name, spoilage: r.category === 'plant' ? 0.015 : 0, fuelHeat: r.id === 'timber' ? 0.35 : undefined })),
  { id: 'charcoal', name: 'Charcoal', spoilage: 0, fuelHeat: 0.8 },
  { id: 'herbal-remedy', name: 'Herbal remedies', spoilage: 0.01 },
  { id: 'bronze', name: 'Bronze', spoilage: 0 }, { id: 'iron-tools', name: 'Forged iron', spoilage: 0 },
  { id: 'timber-frame', name: 'Timber frames', spoilage: 0 }, { id: 'dressed-stone', name: 'Dressed stone', spoilage: 0 },
  { id: 'ash', name: 'Wood ash', spoilage: 0.05 }, { id: 'slag', name: 'Slag', spoilage: 0.02 },
];
export const MATERIAL_BY_ID = new Map(MATERIAL_CATALOG.map(m => [m.id, m]));
