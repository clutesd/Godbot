import type { FacilityFamilyId, FacilityFamilySpec, FacilityTierSpec, RecipeRef } from './types';
import { recipeKey } from './types';

const catalog = (id: string): RecipeRef => ({ source: 'catalog', id });
const material = (id: string): RecipeRef => ({ source: 'material', id });

/**
 * Wood processing reference industry.
 *   saw pit / carpentry yard -> powered sawmill -> industrial timber works
 * All three tiers run the same existing recipes (`saw-lumber`, `timber-framing`, `charcoal`);
 * higher tiers only add capacity, labour productivity and a power/knowledge requirement.
 * Charcoal burning is a wood-yard trade, so metallurgy draws its fuel from a wood facility
 * through the settlement store like any other freight.
 */
const WOOD_RECIPES: readonly RecipeRef[] = [material('saw-lumber'), catalog('timber-framing'), catalog('charcoal')];
const WOOD: FacilityFamilySpec = {
  id: 'wood',
  name: 'Wood processing',
  description: 'Felled timber becomes lumber, framing and charcoal at a physical yard.',
  triggerMaterials: ['timber'],
  tiers: [
    {
      tier: 1, kind: 'saw-pit', name: 'saw pit and carpentry yard', form: 'workshop', material: 'timber',
      capacity: 3, workers: 3, occupations: ['builder', 'artisan', 'forager'], yard: 24,
      knowledge: [], power: { mode: 'none', demand: 0, fallback: 1, minimumCoverage: 0 }, yieldBonus: 0,
      recipes: WOOD_RECIPES,
      build: { lines: [{ options: ['timber', 'lumber'], amount: 4 }], work: 2 },
      maintenance: { lines: [{ options: ['timber', 'lumber'], amount: 0.15 }], work: 0.2 },
      service: 0.5,
    },
    {
      tier: 2, kind: 'sawmill', name: 'powered sawmill', form: 'works', material: 'timber',
      capacity: 12, workers: 5, occupations: ['builder', 'artisan', 'carrier'], yard: 60,
      knowledge: [{ id: 'rotary-machinery', minPractice: 0.3 }],
      power: { mode: 'either', demand: 6, fallback: 0.25, minimumCoverage: 0.35 }, yieldBonus: 0.05,
      recipes: WOOD_RECIPES,
      build: { lines: [{ options: ['timber', 'lumber'], amount: 8 }, { options: ['iron', 'iron-tools', 'bronze', 'steel'], amount: 2 }], work: 8 },
      maintenance: { lines: [{ options: ['timber', 'lumber'], amount: 0.2 }, { options: ['machine-parts', 'iron', 'iron-tools', 'bronze'], amount: 0.06 }], work: 0.25 },
      service: 1.1,
    },
    {
      tier: 3, kind: 'timber-works', name: 'industrial timber works', form: 'works', material: 'masonry',
      capacity: 36, workers: 8, occupations: ['artisan', 'builder', 'carrier'], yard: 160,
      knowledge: [{ id: 'mechanical-power', minPractice: 0.4 }, { id: 'precision-manufacturing', minPractice: 0.3 }],
      power: { mode: 'electric', demand: 12, fallback: 0.05, minimumCoverage: 0.5 }, yieldBonus: 0.1,
      recipes: WOOD_RECIPES,
      build: { lines: [{ options: ['steel', 'iron'], amount: 5 }, { options: ['brick', 'stone'], amount: 8 }, { options: ['copper'], amount: 2 }, { options: ['timber', 'lumber'], amount: 8 }], work: 16 },
      maintenance: { lines: [{ options: ['machine-parts', 'steel', 'iron'], amount: 0.12 }, { options: ['copper'], amount: 0.03 }], work: 0.35 },
      service: 2,
    },
  ],
};

/**
 * Metallurgy reference industry.
 *   bloomery / smithy -> foundry / ironworks -> steelworks
 * Copper, bronze, iron and steel are all existing recipes. Steel is only reachable once a tier-3
 * works stands, needs the iron a smelter produced (often in the same works) plus coal, and is the
 * heaviest electrical and freight load in the reference set.
 */
const SMELT: readonly RecipeRef[] = [catalog('bronze-ingot'), catalog('iron-tools'), material('smelt-copper'), material('smelt-iron')];
const METALLURGY: FacilityFamilySpec = {
  id: 'metallurgy',
  name: 'Metallurgy',
  description: 'Ore, fuel and skilled labour become copper, bronze, iron and steel in furnaces.',
  triggerMaterials: ['copper-ore', 'iron-ore', 'tin-ore'],
  tiers: [
    {
      tier: 1, kind: 'bloomery-smithy', name: 'bloomery and smithy', form: 'workshop', material: 'masonry',
      capacity: 3, workers: 3, occupations: ['artisan'], yard: 20,
      knowledge: [{ id: 'metal-smelting', minPractice: 0.3 }],
      power: { mode: 'none', demand: 0, fallback: 1, minimumCoverage: 0 },
      heat: { minimum: 0.6, warmup: 0.6 }, yieldBonus: 0,
      recipes: SMELT,
      build: { lines: [{ options: ['stone', 'brick'], amount: 6 }, { options: ['timber', 'lumber'], amount: 3 }], work: 3 },
      maintenance: { lines: [{ options: ['stone', 'brick'], amount: 0.1 }, { options: ['timber', 'lumber'], amount: 0.08 }], work: 0.2 },
      service: 0.6,
    },
    {
      tier: 2, kind: 'foundry-ironworks', name: 'foundry and ironworks', form: 'works', material: 'masonry',
      capacity: 9, workers: 6, occupations: ['artisan', 'builder', 'carrier'], yard: 60,
      knowledge: [{ id: 'iron-working', minPractice: 0.4 }, { id: 'high-temperature-ceramics', minPractice: 0.3 }, { id: 'rotary-machinery', minPractice: 0.25 }],
      power: { mode: 'either', demand: 8, fallback: 0.3, minimumCoverage: 0.3 },
      heat: { minimum: 0.7, warmup: 1.5 }, yieldBonus: 0.06,
      recipes: SMELT,
      build: { lines: [{ options: ['brick', 'stone'], amount: 10 }, { options: ['iron', 'iron-tools', 'bronze'], amount: 3 }, { options: ['timber', 'lumber'], amount: 6 }], work: 10 },
      maintenance: { lines: [{ options: ['brick', 'stone'], amount: 0.15 }, { options: ['machine-parts', 'iron', 'iron-tools', 'bronze'], amount: 0.08 }], work: 0.3 },
      service: 1.4,
    },
    {
      tier: 3, kind: 'steelworks', name: 'steelworks', form: 'works', material: 'metal',
      capacity: 30, workers: 12, occupations: ['artisan', 'builder', 'carrier'], yard: 200,
      knowledge: [{ id: 'industrial-chemistry', minPractice: 0.45 }, { id: 'mechanical-power', minPractice: 0.4 }, { id: 'precision-manufacturing', minPractice: 0.3 }],
      power: { mode: 'electric', demand: 30, fallback: 0, minimumCoverage: 0.5 },
      heat: { minimum: 0.75, warmup: 4 }, yieldBonus: 0.1,
      recipes: [...SMELT, material('make-steel')],
      build: { lines: [{ options: ['steel', 'iron'], amount: 10 }, { options: ['brick', 'stone'], amount: 10 }, { options: ['copper'], amount: 4 }, { options: ['timber', 'lumber'], amount: 4 }], work: 24 },
      maintenance: { lines: [{ options: ['machine-parts', 'steel', 'iron'], amount: 0.25 }, { options: ['brick', 'stone'], amount: 0.2 }, { options: ['copper'], amount: 0.05 }], work: 0.5 },
      service: 2.6,
    },
  ],
};

/**
 * Machinery reference industry.
 *   millwright and machine workshop -> machine shop -> precision engine works
 * The family turns the metals metallurgy makes into the parts the rest of industry wears out, so
 * it is the first family whose inputs are another family's outputs. `machine-parts` is made at
 * every tier (capacity, power and yield are what a tier buys); engines are only assembled in a
 * tier-3 works with electricity, a hot forge and precision practice.
 */
const MACHINE_RECIPES: readonly RecipeRef[] = [catalog('machine-parts')];
const MACHINERY: FacilityFamilySpec = {
  id: 'machinery',
  name: 'Machinery',
  description: 'Metal becomes gears, shafts, castings and finally engines at a machine shop.',
  triggerMaterials: ['iron', 'bronze', 'copper'],
  tiers: [
    {
      tier: 1, kind: 'mechanical-workshop', name: 'millwright and machine workshop', form: 'workshop', material: 'timber',
      capacity: 3, workers: 3, occupations: ['artisan', 'builder'], yard: 20,
      knowledge: [{ id: 'precision-tools', minPractice: 0.3 }, { id: 'rotary-machinery', minPractice: 0.25 }],
      power: { mode: 'either', demand: 2, fallback: 0.55, minimumCoverage: 0 },
      heat: { minimum: 0.6, warmup: 0.5 }, yieldBonus: 0,
      recipes: MACHINE_RECIPES,
      build: { lines: [{ options: ['timber', 'lumber'], amount: 5 }, { options: ['iron', 'iron-tools', 'bronze'], amount: 2 }], work: 3 },
      maintenance: { lines: [{ options: ['timber', 'lumber'], amount: 0.12 }, { options: ['iron', 'iron-tools', 'bronze'], amount: 0.05 }], work: 0.2 },
      service: 0.7,
    },
    {
      tier: 2, kind: 'machine-shop', name: 'machine shop', form: 'works', material: 'masonry',
      capacity: 10, workers: 6, occupations: ['artisan', 'builder', 'carrier'], yard: 60,
      knowledge: [{ id: 'standardized-parts', minPractice: 0.35 }, { id: 'rotary-machinery', minPractice: 0.4 }, { id: 'mechanical-power', minPractice: 0.3 }],
      power: { mode: 'either', demand: 8, fallback: 0.2, minimumCoverage: 0.3 },
      heat: { minimum: 0.6, warmup: 1.2 }, yieldBonus: 0.06,
      recipes: MACHINE_RECIPES,
      build: { lines: [{ options: ['brick', 'stone'], amount: 8 }, { options: ['iron', 'steel', 'iron-tools'], amount: 4 }, { options: ['timber', 'lumber'], amount: 5 }], work: 10 },
      maintenance: { lines: [{ options: ['machine-parts', 'iron', 'steel'], amount: 0.07 }, { options: ['brick', 'stone'], amount: 0.1 }], work: 0.3 },
      service: 1.5,
    },
    {
      tier: 3, kind: 'engine-works', name: 'precision engine works', form: 'works', material: 'metal',
      capacity: 26, workers: 12, occupations: ['artisan', 'builder', 'carrier'], yard: 160,
      knowledge: [{ id: 'precision-manufacturing', minPractice: 0.45 }, { id: 'mechanical-power', minPractice: 0.4 }, { id: 'standardized-parts', minPractice: 0.5 }],
      power: { mode: 'electric', demand: 22, fallback: 0.05, minimumCoverage: 0.5 },
      heat: { minimum: 0.7, warmup: 3 }, yieldBonus: 0.1,
      recipes: [...MACHINE_RECIPES, catalog('engine-assembly')],
      build: { lines: [{ options: ['steel', 'iron'], amount: 8 }, { options: ['brick', 'stone'], amount: 10 }, { options: ['copper'], amount: 3 }, { options: ['timber', 'lumber'], amount: 4 }], work: 20 },
      maintenance: { lines: [{ options: ['machine-parts', 'steel', 'iron'], amount: 0.2 }, { options: ['copper'], amount: 0.04 }], work: 0.45 },
      service: 2.4,
    },
  ],
};

/**
 * Ceramics reference industry.
 *   pottery yard and clamp kiln -> bottle kiln works -> industrial ceramics works
 * All three tiers run the same `pottery-vessels` recipe (clay + timber -> pottery); higher tiers
 * only add capacity, heat, power and yield, mirroring the wood/metallurgy ladders. Firing needs a
 * warmed kiln like a furnace, so the family carries a heat spec even though it never smelts ore.
 */
const CERAMICS_RECIPES: readonly RecipeRef[] = [catalog('pottery-vessels')];
const CERAMICS: FacilityFamilySpec = {
  id: 'ceramics',
  name: 'Ceramics',
  description: 'Clay is dug, prepared, shaped, dried and fired into household, storage and trade pottery at a kiln yard.',
  triggerMaterials: ['clay'],
  tiers: [
    {
      tier: 1, kind: 'pottery-yard', name: 'pottery yard and clamp kiln', form: 'workshop', material: 'timber',
      capacity: 3, workers: 3, occupations: ['artisan', 'forager'], yard: 20,
      knowledge: [{ id: 'pottery-firing', minPractice: 0.18 }],
      power: { mode: 'none', demand: 0, fallback: 1, minimumCoverage: 0 },
      heat: { minimum: 0.45, warmup: 0.3 }, yieldBonus: 0,
      recipes: CERAMICS_RECIPES,
      build: { lines: [{ options: ['timber', 'lumber'], amount: 4 }, { options: ['clay'], amount: 2 }], work: 2 },
      maintenance: { lines: [{ options: ['timber', 'lumber'], amount: 0.1 }, { options: ['clay'], amount: 0.05 }], work: 0.2 },
      service: 0.5,
    },
    {
      tier: 2, kind: 'bottle-kiln-works', name: 'bottle kiln works', form: 'works', material: 'masonry',
      capacity: 9, workers: 5, occupations: ['artisan', 'carrier'], yard: 50,
      knowledge: [{ id: 'high-temperature-ceramics', minPractice: 0.3 }],
      power: { mode: 'either', demand: 4, fallback: 0.4, minimumCoverage: 0.3 },
      heat: { minimum: 0.6, warmup: 0.8 }, yieldBonus: 0.06,
      recipes: CERAMICS_RECIPES,
      build: { lines: [{ options: ['brick', 'stone'], amount: 8 }, { options: ['timber', 'lumber'], amount: 4 }], work: 8 },
      maintenance: { lines: [{ options: ['brick', 'stone'], amount: 0.12 }, { options: ['timber', 'lumber'], amount: 0.08 }], work: 0.25 },
      service: 1.1,
    },
    {
      tier: 3, kind: 'ceramics-works', name: 'industrial ceramics works', form: 'works', material: 'masonry',
      capacity: 24, workers: 8, occupations: ['artisan', 'carrier'], yard: 120,
      knowledge: [{ id: 'high-temperature-ceramics', minPractice: 0.45 }, { id: 'precision-manufacturing', minPractice: 0.25 }],
      power: { mode: 'electric', demand: 10, fallback: 0.1, minimumCoverage: 0.5 },
      heat: { minimum: 0.7, warmup: 2 }, yieldBonus: 0.1,
      recipes: CERAMICS_RECIPES,
      build: { lines: [{ options: ['brick', 'stone'], amount: 10 }, { options: ['iron', 'iron-tools'], amount: 2 }, { options: ['timber', 'lumber'], amount: 4 }], work: 16 },
      maintenance: { lines: [{ options: ['machine-parts', 'iron'], amount: 0.08 }, { options: ['brick', 'stone'], amount: 0.15 }], work: 0.35 },
      service: 2,
    },
  ],
};

/** Families reserved for later passes. They are declared so ids, saves and UI never have to change. */
const reserved = (id: FacilityFamilyId, name: string, description: string): FacilityFamilySpec =>
  ({ id, name, description, tiers: [], triggerMaterials: [] });

const RESERVED: readonly FacilityFamilySpec[] = [
  reserved('textiles', 'Textiles', 'Retting, spinning and weaving of plant fibre.'),
  reserved('chemicals', 'Chemicals', 'Reaction vessels and refineries.'),
  reserved('electrical-equipment', 'Electrical equipment', 'Wire, motors, cells and semiconductors.'),
  reserved('strategic', 'Strategic processing', 'Fuel fabrication and other safeguarded processing.'),
];

const registry = new Map<FacilityFamilyId, FacilityFamilySpec>();
for (const family of [WOOD, METALLURGY, MACHINERY, CERAMICS, ...RESERVED]) registry.set(family.id, family);

/** Replaces a family definition (used by later passes and tests) and returns a restorer. */
export function registerFacilityFamily(spec: FacilityFamilySpec): () => void {
  const previous = registry.get(spec.id);
  registry.set(spec.id, spec);
  invalidate();
  return () => { if (previous) registry.set(spec.id, previous); else registry.delete(spec.id); invalidate(); };
}

export function facilityFamilies(): readonly FacilityFamilySpec[] {
  return [...registry.values()].filter(family => family.tiers.length > 0);
}
export function facilityFamily(id: FacilityFamilyId): FacilityFamilySpec | undefined { return registry.get(id); }
export function facilityTierSpec(family: FacilityFamilyId, tier: number): FacilityTierSpec | undefined {
  return registry.get(family)?.tiers.find(spec => spec.tier === tier);
}
export function maxFacilityTier(family: FacilityFamilyId): number {
  return Math.max(0, ...(registry.get(family)?.tiers.map(spec => spec.tier) ?? []));
}

let owned: { catalog: ReadonlySet<string>; material: ReadonlySet<string> } | undefined;
function invalidate(): void { owned = undefined; }

/**
 * Recipes whose transformation is performed by a facility once a settlement is facility-governed.
 * Derived from the family ladders, so the settlement-level pipelines can never disagree with them.
 */
export function facilityOwnedRecipes(): { catalog: ReadonlySet<string>; material: ReadonlySet<string> } {
  if (owned) return owned;
  const catalogIds = new Set<string>(), materialIds = new Set<string>();
  for (const family of registry.values()) for (const tier of family.tiers) for (const ref of tier.recipes) {
    (ref.source === 'catalog' ? catalogIds : materialIds).add(ref.id);
  }
  return owned = { catalog: catalogIds, material: materialIds };
}

export function facilityRecipeKeys(family: FacilityFamilyId, tier: number): readonly string[] {
  return (facilityTierSpec(family, tier)?.recipes ?? []).map(recipeKey);
}
