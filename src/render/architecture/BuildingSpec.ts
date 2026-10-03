/**
 * BuildingSpec.ts
 *
 * The single contract between simulation authority and building geometry.
 *
 * A `BuildingSpec` is every renderer-relevant decision about one structure, resolved once,
 * deterministically, from authoritative simulation state. Downstream consumers — the composer,
 * the LOD builder, the construction presenter, the component manifest — read the spec and never
 * re-decide anything. That is what keeps a settlement coherent: there is exactly one place where
 * "what is this building?" is answered.
 *
 * The resolver below is the only thing that answers it. It reads period, practised capability,
 * the project's actual material consumption, climate, culture, wealth, function and history, and
 * selects a structural family and a material for every role. It never invents simulation state:
 * every input is something the simulation already published.
 *
 * Outside debug mode the resolver is required to produce a spec that `validateBuildingSpec`
 * accepts — no material before its period, no material in a role it cannot serve, no storey
 * count its walls cannot carry, no span its frame cannot reach. `tests/architecture-spec.test.ts`
 * asserts that across the whole archetype × period × climate × culture matrix.
 */

import type { Era } from '../materials/MaterialPalette';
import type { BuildingRole } from '../assets/BuildingGrammar';
import { BUILD_STAGE, type BuildStage } from '../assets/BuildingComposer';
import type { DevelopmentProject, DevelopmentResponse, StructureMaterial } from '../../sim/development/types';
import type { MaterialKind } from '../../sim/resources/MaterialEconomy';
import type { Biome } from '../../sim/types';
import type { MaterialBias, RoofLanguage } from '../style/CultureStyleProfile';
import type { StructureHeritage } from '../assets/StructureHeritage';
import { SeededRandom } from '../../sim/prng';

import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { architecturalPeriod, periodRank } from './ArchitecturalPeriod';
import type { ArchitecturalMaterialId, ClimateZone, MaterialRole } from './MaterialLibrary';
import {
  MATERIAL_LIBRARY,
  architecturalMaterial,
  climateSuitability,
  cultureAffinity,
  materialAvailable,
  materialHasRole,
  materialsForRole,
} from './MaterialLibrary';
import type { FamilySilhouette, FoundationStyle, StructuralFamily, WallAssembly } from './StructuralFamily';
import { familyCustom, familyPreferences, structuralFamily } from './StructuralFamily';
import type { BuildingArchetype, FunctionalEquipment, RoofArchetype } from './BuildingArchetype';
import {
  archetypeEarliestPeriod,
  archetypeStageFor,
  buildingArchetype,
} from './BuildingArchetype';
import { routeArchetype, type RoutingSource, type SettlementSpecialization } from './ArchetypeRouting';
import type { MaterialEvidence } from './MaterialSourcing';
import { classOnlyEvidence, consistentWithClass, deriveMaterialEvidence, evidenceFor } from './MaterialSourcing';

// ---------------------------------------------------------------------------- spec

/** One material per building role. The six structural roles are always resolved. */
export interface MaterialAssignment {
  foundation: ArchitecturalMaterialId;
  frame: ArchitecturalMaterialId;
  wall: ArchitecturalMaterialId;
  roofStructure: ArchitecturalMaterialId;
  roofCovering: ArchitecturalMaterialId;
  trim: ArchitecturalMaterialId;
  /** Panel material in a framed wall. Absent for monolithic and load-bearing walls. */
  infill?: ArchitecturalMaterialId;
  /** Applied finish over the wall — render, plaster, cladding. Absent when the wall is its own face. */
  finish?: ArchitecturalMaterialId;
  /** Window material. Absent before the culture glazes anything. */
  glazing?: ArchitecturalMaterialId;
  /** Fittings, straps, hinges, rails. */
  hardware?: ArchitecturalMaterialId;
}

export const STRUCTURAL_ASSIGNMENT_ROLES: readonly (keyof MaterialAssignment)[] = [
  'foundation', 'frame', 'wall', 'roofStructure', 'roofCovering', 'trim',
] as const;

/** Mapping from assignment slot to the library role it must satisfy. */
export const ASSIGNMENT_ROLE: Record<keyof MaterialAssignment, MaterialRole> = {
  foundation: 'foundation',
  frame: 'frame',
  wall: 'wall',
  roofStructure: 'roof-structure',
  roofCovering: 'roof-covering',
  trim: 'trim',
  infill: 'infill',
  finish: 'finish',
  glazing: 'glazing',
  hardware: 'hardware',
};

/** How the building answers its climate — geometry, not colour. */
export interface ClimateAdaptation {
  zone: ClimateZone;
  /** Multiplier on roof pitch. Snow sheds steep; desert roofs go flat and usable. */
  roofPitch: number;
  /** Multiplier on eave overhang. Deep in the wet, clipped in the dry. */
  eaveOverhang: number;
  /** Multiplier on wall thickness. Thermal mass against heat and cold. */
  wallThickness: number;
  /** Multiplier on opening density. Small openings keep heat in and sun out. */
  openingDensity: number;
  /** A recessed or hooded entrance — porches against snow, shaded thresholds against sun. */
  shelteredEntry: boolean;
  /** An enclosed court rather than an open frontage. */
  courtyard: boolean;
  /** Extra plinth height, for flood, snow drift and slope. */
  plinthBoost: number;
}

/** What time and use have done to this structure. */
export type BuildingCondition =
  | 'new'
  | 'sound'
  | 'weathered'
  | 'repaired'
  | 'expanded'
  | 'adapted'
  | 'damaged'
  | 'abandoned'
  | 'ruin';

export interface AgeState {
  condition: BuildingCondition;
  /** 0..1 accumulated weathering, driven by material weathering rate and elapsed history. */
  wear: number;
  /** 0..1 how well kept it is. Low maintenance shows as patched and sagging fabric. */
  maintenance: number;
  /** 0..1 structural damage. */
  damage: number;
  /** Visible later additions — annexes and raised storeys from real recorded expansion. */
  additions: number;
  /** True when the fabric visibly predates the current use. */
  adaptivelyReused: boolean;
  /** The material the structure was originally built in, when it genuinely differs. */
  originalMaterial?: ArchitecturalMaterialId;
}

export interface SpecRoof {
  archetype: RoofArchetype;
  /** Rise over half-span, after family bias and climate. */
  pitch: number;
  /** Eave projection in canonical units. */
  overhang: number;
  /** Clear span the roof must cover, in canonical units. */
  span: number;
  /** Stacked roof tiers, for layered and stepped languages. */
  tiers: number;
  /** True when the roof needs an intermediate support to reach its span. */
  intermediateSupport: boolean;
}

export interface SpecOpenings {
  /** 0..1 share of wall given to openings. */
  density: number;
  /** Opening width in canonical units. */
  width: number;
  /** Opening height in canonical units. */
  height: number;
  /** Openings per bay on the entrance elevation. */
  perBay: number;
  /** True when the family and period support an arched head rather than a lintel. */
  arched: boolean;
}

export interface SpecCulture {
  materialBias: MaterialBias;
  roofLanguage: RoofLanguage;
  /** 0..1 trim and ornament level. */
  ornament: number;
}

/** Why the resolver chose what it chose. Diagnostic only; never read by geometry. */
export interface SpecProvenance {
  evidenceGrade: MaterialEvidence['bestGrade'];
  familyScore: number;
  /** Families considered, best first, with their scores. */
  familyRanking: readonly { family: StructuralFamily; score: number }[];
  /** The archetype stage that supplied the proportions, and how old it is. */
  stageName: string;
  stageDefinedIn: ArchitecturalPeriod;
  stagePeriodsOld: number;
  /**
   * How this structure came to be the archetype it is.
   *
   * `explicit` means a subsystem named it; `response` that the authoritative development response
   * pinned it down; `role-default` that only the renderer role was available to go on. Recorded so
   * that "why is this building a warehouse?" is answerable from the asset rather than by
   * re-deriving the routing decision by hand.
   */
  routing: RoutingSource | 'explicit';
  /**
   * The archetype's lineage had not begun in the era's own period, so the period was lifted to its
   * earliest stage. Expected for an early-era civic hall or market; never a substitution.
   */
  periodLifted: boolean;
}

export interface BuildingSpec {
  archetype: BuildingArchetype;
  /** The renderer role this presents as. Unchanged from the existing grammar's vocabulary. */
  role: BuildingRole;
  era: Era;
  period: ArchitecturalPeriod;
  family: StructuralFamily;
  materials: MaterialAssignment;

  /** Canonical footprint in building units (one unit is roughly six metres). */
  width: number;
  depth: number;
  /** Wall height per storey. */
  storeyHeight: number;
  floors: number;
  /** Structural bays across the entrance elevation. */
  bays: number;
  /** Centre-to-centre bay spacing. */
  baySpacing: number;
  wallThickness: number;
  plinthHeight: number;

  roof: SpecRoof;
  openings: SpecOpenings;

  /** 0..1 how much load-bearing frame is visible on the elevation. */
  frameExposure: number;
  /** 0..1 density of posts, piers and braces within a bay. */
  supportDensity: number;
  foundation: FoundationStyle;
  silhouette: FamilySilhouette;
  wallAssembly: WallAssembly;
  parapet: boolean;

  annexes: number;
  /** 0..1 share of the plan that is unwalled. */
  openness: number;

  culture: SpecCulture;
  climate: ClimateAdaptation;

  /** Construction lifecycle stage. Parts above it are not yet built. */
  stage: BuildStage;
  age: AgeState;
  equipment: readonly FunctionalEquipment[];

  /** Deterministic variation seed. Everything random about this building derives from it. */
  seed: string;
  /** Relaxed validation. Debug specs may be absurd on purpose; production specs may not. */
  debug: boolean;
  provenance: SpecProvenance;
}

// ---------------------------------------------------------------------------- context

export interface SpecClimateInput {
  /** 0..1 cell temperature, as the world model stores it. */
  temperature?: number;
  /** 0..1 cell moisture. */
  moisture?: number;
  biome?: Biome;
  /** Legacy -1 (cold/wet) .. 1 (hot/dry) signal, used when temperature/moisture are absent. */
  signal?: number;
  /** Local flood depth at the plot. */
  floodDepth?: number;
}

export interface SpecCultureInput {
  materialBias: MaterialBias;
  roofLanguage: RoofLanguage;
  /** 0..1 trim density from the culture profile. */
  trimDensity: number;
  /** -1..1 settlement-level ornament drift. */
  ornamentBias?: number;
}

export interface BuildingSpecContext {
  /** Explicit archetype. When absent it is derived from the role and period. */
  archetype?: BuildingArchetype;
  role: BuildingRole;
  era: Era;
  seed: string;
  culture: SpecCultureInput;

  /** Authoritative local response. Carries level, need, form, material and capabilities. */
  development?: DevelopmentResponse;
  /** Live project, for the exact material-consumption record. */
  project?: DevelopmentProject;
  /** Derived structure history, for age, reuse and expansion. */
  heritage?: StructureHeritage;
  /** Settlement material stock, as a weak sourcing signal. */
  stock?: Partial<Record<MaterialKind, number>>;

  climate?: SpecClimateInput;
  /** 0..1 settlement prosperity. Gates expensive materials. */
  prosperity?: number;
  /** Economic specialization, which biases equipment and scale. */
  specialization?: SettlementSpecialization;
  /**
   * The settlement sits on a coast, lake or navigable river. Authoritative cell geography, and
   * the difference between a freight depot and a quay.
   */
  waterfront?: boolean;
  localSlopeDegrees?: number;

  /** Construction stage. Defaults to a finished building. */
  stage?: BuildStage;
  /** Allow combinations the validator would reject. Never set from the simulation path. */
  debug?: boolean;
}

// ---------------------------------------------------------------------------- climate

/**
 * Derive a climate zone from the settlement's own cell.
 *
 * Temperature and moisture are preferred because they are the physical fields the world model
 * actually integrates. The legacy single signal is supported so existing callers keep working,
 * but it cannot distinguish wet from snowy, so it resolves conservatively.
 */
export function climateZoneFrom(input: SpecClimateInput | undefined): ClimateZone {
  if (!input) return 'temperate';
  const { temperature, moisture, biome } = input;

  if (temperature !== undefined && moisture !== undefined) {
    if (temperature < 0.3) return moisture > 0.45 ? 'snowy' : 'cold';
    if (temperature > 0.7) return moisture < 0.38 ? 'arid' : 'tropical';
    if (moisture > 0.68) return 'wet';
    if (moisture < 0.26) return 'arid';
    return 'temperate';
  }

  // Biome is a coarse but authoritative stand-in when the fine fields are unavailable.
  if (biome === 'dryland') return 'arid';
  if (biome === 'wetland') return 'wet';
  if (biome === 'mountain') return 'snowy';
  if (biome === 'highland') return 'cold';

  const signal = input.signal;
  if (signal !== undefined) {
    if (signal > 0.45) return 'arid';
    if (signal < -0.45) return 'cold';
    if (signal < -0.15) return 'wet';
  }
  return 'temperate';
}

function climateAdaptationFor(zone: ClimateZone, floodDepth: number, slopeDegrees: number): ClimateAdaptation {
  const base = { zone, plinthBoost: 0, shelteredEntry: false, courtyard: false };
  let adaptation: ClimateAdaptation;
  switch (zone) {
    case 'snowy':
      // Steep to shed snow, deep eaves to throw meltwater clear, a hooded entry so the door
      // is not buried, small openings, and a raised floor above drift level.
      adaptation = { ...base, roofPitch: 1.42, eaveOverhang: 1.2, wallThickness: 1.18, openingDensity: 0.66, shelteredEntry: true, plinthBoost: 0.5 };
      break;
    case 'cold':
      adaptation = { ...base, roofPitch: 1.22, eaveOverhang: 1.05, wallThickness: 1.22, openingDensity: 0.74, shelteredEntry: true, plinthBoost: 0.22 };
      break;
    case 'wet':
      adaptation = { ...base, roofPitch: 1.2, eaveOverhang: 1.45, wallThickness: 1.0, openingDensity: 0.9, shelteredEntry: true, plinthBoost: 0.34 };
      break;
    case 'arid':
      // Thick mass against the diurnal swing, flat usable roofs, courtyards instead of windows.
      adaptation = { ...base, roofPitch: 0.46, eaveOverhang: 0.6, wallThickness: 1.4, openingDensity: 0.58, courtyard: true, shelteredEntry: true, plinthBoost: 0.05 };
      break;
    case 'tropical':
      adaptation = { ...base, roofPitch: 1.12, eaveOverhang: 1.5, wallThickness: 0.82, openingDensity: 1.3, plinthBoost: 0.4 };
      break;
    case 'temperate':
      adaptation = { ...base, roofPitch: 1, eaveOverhang: 1, wallThickness: 1, openingDensity: 1 };
      break;
  }
  // Flood and slope raise the plinth through the same mechanism rather than a second one.
  adaptation.plinthBoost += Math.min(1.5, floodDepth * 3) + Math.min(0.6, slopeDegrees / 30);
  return adaptation;
}

// ---------------------------------------------------------------------------- selection

/** Last-resort material per role, guaranteed buildable from the first period with no capability. */
const ROLE_FALLBACK: Partial<Record<MaterialRole, ArchitecturalMaterialId>> = {
  foundation: 'fieldstone',
  frame: 'rough-hewn-timber',
  wall: 'wattle-and-daub',
  infill: 'wattle-and-daub',
  'roof-structure': 'rough-hewn-timber',
  'roof-covering': 'thatch',
  trim: 'rough-hewn-timber',
  floor: 'rough-hewn-timber',
  finish: 'adobe',
};

interface SelectionContext {
  period: ArchitecturalPeriod;
  capabilities: readonly string[];
  zone: ClimateZone;
  bias: MaterialBias;
  evidence: MaterialEvidence;
  /** 0..1 what the settlement can afford to build with. */
  wealth: number;
  family: StructuralFamily;
  random: SeededRandom;
  debug: boolean;
}

/** 0..1 how affordable a material is at a given wealth. Expensive fabric needs a rich builder. */
function affordability(id: ArchitecturalMaterialId, wealth: number): number {
  const definition = architecturalMaterial(id);
  const burden = (definition.labour + definition.cost) / 2;
  // A builder can always afford fabric cheaper than their means; past that it falls away fast.
  return Math.max(0.05, Math.min(1, 1 - Math.max(0, burden - wealth) * 1.9));
}

/**
 * The minimum climate suitability structural fabric must have.
 *
 * Set deliberately above the validator's own threshold so there is margin: the selector refuses
 * mud brick in a rainforest rather than choosing it and letting validation complain.
 */
const CLIMATE_FLOOR = 0.2;

interface MaterialGates {
  /** Require consistency with the authoritative coarse material class. */
  class: boolean;
  /** Require the material to survive the local climate. */
  climate: boolean;
}

/** One scoring pass over the candidates for a role under a given set of gates. */
function scoreMaterials(
  role: MaterialRole,
  context: SelectionContext,
  gates: MaterialGates,
): ArchitecturalMaterialId | undefined {
  const preferred = familyPreferences(context.family, role);
  const universe = materialsForRole(role);
  // Family preferences first, then anything else that can serve the role. Order is stable, so
  // equal scores break deterministically toward the family's own vocabulary.
  const seen = new Set<ArchitecturalMaterialId>();
  const candidates: ArchitecturalMaterialId[] = [];
  for (const id of preferred) {
    if (!seen.has(id) && materialHasRole(id, role)) { seen.add(id); candidates.push(id); }
  }
  for (const id of universe) {
    if (!seen.has(id)) { seen.add(id); candidates.push(id); }
  }

  let best: ArchitecturalMaterialId | undefined;
  let bestScore = -Infinity;

  for (const id of candidates) {
    if (!materialAvailable(id, { period: context.period, capabilities: context.capabilities })) continue;

    const climate = climateSuitability(id, context.zone);
    if (gates.climate && climate < CLIMATE_FLOOR) continue;

    // When the record is the coarse class, the class is a gate on structural fabric: a structure
    // the simulation calls timber must not resolve to a brick wall.
    if (gates.class && !consistentWithClass(context.evidence, id)) continue;

    const rank = preferred.indexOf(id);
    const preference = rank < 0 ? 0.18 : Math.max(0.3, 1 - rank * 0.17);
    const attested = evidenceFor(context.evidence, id);
    const culture = cultureAffinity(id, context.bias);
    const afford = affordability(id, context.wealth);

    // Preference, attestation, climate and culture add; affordability scales. A settlement that
    // cannot pay for ashlar does not build in ashlar merely because its culture admires stone.
    const merit = preference * 0.38 + attested * 0.25 + climate * 0.2 + culture * 0.17;
    const score = merit * (0.3 + 0.7 * afford)
      // A small deterministic jitter so two neighbours with identical inputs are not forced to
      // identical fabric. Too small to reorder materially different candidates.
      * context.random.range(0.97, 1.03);

    if (score > bestScore) { bestScore = score; best = id; }
  }

  return best;
}

/**
 * Pick one material for one role.
 *
 * Preference order comes from the structural family; everything else reweights it. The material
 * the settlement is *attested* to have consumed gets a large bonus, which is the mechanism that
 * ties visible fabric to the simulation's own bill of materials.
 *
 * Gates are relaxed in a fixed order when nothing qualifies, so the resolver always returns
 * something and always returns the *same* something. Climate outranks class: a timber-classed
 * building in a desert may end up with an earthen wall, because a timber wall there would be a
 * worse lie than an earthen one.
 */
function selectMaterial(
  role: MaterialRole,
  context: SelectionContext,
  enforceClass: boolean,
  enforceClimate = role === 'wall' || role === 'roof-covering',
): ArchitecturalMaterialId | undefined {
  const attempts: MaterialGates[] = [
    { class: enforceClass, climate: enforceClimate },
    { class: false, climate: enforceClimate },
    { class: enforceClass, climate: false },
    { class: false, climate: false },
  ];
  const tried = new Set<string>();
  for (const gates of attempts) {
    const key = `${gates.class}:${gates.climate}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const chosen = scoreMaterials(role, context, gates);
    if (chosen) return chosen;
  }

  const fallback = ROLE_FALLBACK[role];
  if (fallback && materialAvailable(fallback, { period: context.period, capabilities: context.capabilities })) return fallback;
  return undefined;
}

interface FamilyScore {
  family: StructuralFamily;
  score: number;
}

/**
 * Choose the structural family.
 *
 * The archetype stage proposes the families its function was historically built with; this
 * scores them against how customary they still are, what the settlement is attested to have
 * consumed, what its culture reaches for, and whether the family can carry the storeys asked.
 */
function selectFamily(
  proposed: readonly StructuralFamily[],
  floors: number,
  context: Omit<SelectionContext, 'family'>,
): { chosen: StructuralFamily; ranking: FamilyScore[] } {
  const ranking: FamilyScore[] = [];

  for (let index = 0; index < proposed.length; index += 1) {
    const family = proposed[index]!;
    const definition = structuralFamily(family);
    if (periodRank(definition.earliestPeriod) > periodRank(context.period) && !context.debug) continue;

    const preference = Math.max(0.25, 1 - index * 0.22);
    const custom = familyCustom(family, context.period);

    // How well the settlement's attested materials support this way of building. Averaged over
    // the family's own first choices for the two roles that define it structurally.
    const structural: ArchitecturalMaterialId[] = [];
    for (const role of ['wall', 'frame'] as const) {
      const first = familyPreferences(family, role)[0];
      if (first) structural.push(first);
    }
    let attested = 0;
    let culture = 0;
    for (const id of structural) {
      attested += evidenceFor(context.evidence, id);
      culture += cultureAffinity(id, context.bias);
    }
    if (structural.length > 0) {
      attested /= structural.length;
      culture /= structural.length;
    }

    // Whether this way of building survives the local climate at all. An earthen family in a
    // rainforest has to be rejected here, not patched later by swapping in a different wall:
    // the whole family — thick monolithic walls, flat roof, tiny openings — is the wrong answer.
    const exposed: ArchitecturalMaterialId[] = [];
    for (const role of ['wall', 'roof-covering'] as const) {
      const first = familyPreferences(family, role)[0];
      if (first) exposed.push(first);
    }
    const climateFit = exposed.length > 0
      ? exposed.reduce((sum, id) => sum + climateSuitability(id, context.zone), 0) / exposed.length
      : 0.5;

    // Can it carry the storeys the stage wants, and is its wall fabric consistent with the
    // authoritative class? Both are penalties rather than exclusions, so a family is always
    // available even for an unusual combination.
    const storeyFit = definition.maxStoreys >= floors ? 1 : 0.2;
    const classFit = familyPreferences(family, 'wall').some(id => consistentWithClass(context.evidence, id)) ? 1 : 0.22;
    const afford = structural.length > 0
      ? structural.reduce((sum, id) => sum + affordability(id, context.wealth), 0) / structural.length
      : 0.5;

    const score = (preference * 0.34 + custom * 0.22 + attested * 0.24 + culture * 0.2)
      * storeyFit * classFit
      // Climate and affordability scale rather than add, so neither can be out-voted by a
      // family merely being the customary choice.
      * (0.25 + 0.75 * climateFit)
      * (0.3 + 0.7 * afford)
      * context.random.range(0.98, 1.02);
    ranking.push({ family, score });
  }

  ranking.sort((a, b) => b.score - a.score || proposed.indexOf(a.family) - proposed.indexOf(b.family));
  // A well-formed archetype stage always proposes a family available in its own earliest period,
  // so this fallback is defensive. It must still never hand back a family from the future, or
  // the spec would be invalid: `primitive-shelter` exists in every period.
  const chosen = ranking[0]?.family
    ?? proposed.find(family => periodRank(structuralFamily(family).earliestPeriod) <= periodRank(context.period))
    ?? 'primitive-shelter';
  return { chosen, ranking };
}

// ---------------------------------------------------------------------------- roof

/** Does the culture's roof language restate this roof as something of its own? */
function cultureRoof(archetype: RoofArchetype, language: RoofLanguage, ornament: number): RoofArchetype {
  // Functional roofs converge: a saw-tooth north light is a saw-tooth everywhere, because it
  // exists to face the sun, not to express a tradition.
  if (archetype === 'sawtooth' || archetype === 'monitor' || archetype === 'train-shed'
    || archetype === 'open-span' || archetype === 'flat' || archetype === 'flat-parapet') return archetype;
  switch (language) {
    case 'layered-asian':
      return archetype === 'gable' || archetype === 'hipped' ? 'layered' : archetype;
    case 'pyramid-stepped':
      return archetype === 'hipped' || archetype === 'dome' ? 'stepped' : archetype;
    case 'dome-organic':
      return archetype === 'hipped' && ornament > 0.5 ? 'dome' : archetype;
    case 'gable-geometric':
      return archetype === 'hipped' ? 'gable' : archetype;
  }
}

const ROOF_BASE_PITCH: Record<RoofArchetype, number> = {
  conical: 0.82,
  shed: 0.3,
  gable: 0.44,
  'steep-gable': 0.72,
  'low-gable': 0.24,
  hipped: 0.42,
  flat: 0.04,
  'flat-parapet': 0.04,
  monitor: 0.3,
  sawtooth: 0.26,
  layered: 0.46,
  stepped: 0.2,
  dome: 0.6,
  vault: 0.5,
  pediment: 0.34,
  'train-shed': 0.38,
  'open-span': 0.18,
};

// ---------------------------------------------------------------------------- age

function ageStateFor(
  heritage: StructureHeritage | undefined,
  development: DevelopmentResponse | undefined,
  wallMaterial: ArchitecturalMaterialId,
  period: ArchitecturalPeriod,
  stagePeriodsOld: number,
  random: SeededRandom,
): AgeState {
  const weatheringRate = architecturalMaterial(wallMaterial).weathering.rate;
  const status = (development as { status?: 'active' | 'abandoned' | 'ruin' } | undefined)?.status;

  if (!heritage) {
    // No recorded history: a building of its own time, lightly worn by material and chance.
    const wear = Math.min(1, weatheringRate * 0.3 * random.range(0.6, 1.3));
    return {
      condition: wear < 0.12 ? 'new' : 'sound',
      wear,
      maintenance: 1 - wear * 0.3,
      damage: 0,
      additions: 0,
      adaptivelyReused: false,
    };
  }

  // Elapsed architectural history drives wear through the material's own weathering rate, so a
  // thatched wall of the same age reads far older than a granite one.
  const elapsed = Math.min(1, (stagePeriodsOld * 0.26) + heritage.transitionCount * 0.07);
  const preserved = heritage.preservation;
  const wear = Math.min(1, Math.max(0, weatheringRate * (0.25 + elapsed * 1.1) * (1 - preserved * 0.5)));
  const damage = heritage.survivedRuin ? Math.min(0.6, 0.22 + elapsed * 0.3) : 0;
  const maintenance = Math.max(0.1, Math.min(1, 0.55 + preserved * 0.8 - elapsed * 0.3));

  let condition: BuildingCondition = 'sound';
  if (status === 'ruin') condition = 'ruin';
  else if (status === 'abandoned') condition = 'abandoned';
  else if (damage > 0.2) condition = 'damaged';
  else if (heritage.needShift || heritage.repurposed) condition = 'adapted';
  else if (heritage.upgradeCount > 0) condition = 'expanded';
  else if (heritage.survivedRuin || heritage.reused) condition = 'repaired';
  else if (wear > 0.4) condition = 'weathered';
  else if (elapsed < 0.1) condition = 'new';

  // The original fabric, only where history actually records a different material.
  let originalMaterial: ArchitecturalMaterialId | undefined;
  if (heritage.materialShift) {
    const legacy = heritage.legacyMaterial;
    const candidates = materialsForRole('wall')
      .filter(id => MATERIAL_LIBRARY[id].structureMaterial === legacy)
      .filter(id => materialAvailable(id, { period }));
    originalMaterial = candidates[0];
  }

  return {
    condition,
    wear,
    maintenance,
    damage,
    additions: heritage.upgradeCount,
    adaptivelyReused: heritage.repurposed || heritage.needShift,
    originalMaterial,
  };
}

// ---------------------------------------------------------------------------- resolver

/**
 * The archetype this structure is.
 *
 * An explicit archetype wins: the subsystem that owns a bridge or a perimeter wall knows better
 * than any routing table. Otherwise the authoritative response decides, via ArchetypeRouting.
 */
function pickArchetype(
  context: BuildingSpecContext,
  period: ArchitecturalPeriod,
): { archetype: BuildingArchetype; routing: RoutingSource | 'explicit' } {
  if (context.archetype) return { archetype: context.archetype, routing: 'explicit' };
  const development = context.development;
  const decision = routeArchetype({
    role: context.role,
    period,
    need: development?.need,
    form: development?.form,
    level: development?.level,
    capabilities: development?.capabilities,
    specialization: context.specialization,
    waterfront: context.waterfront,
    seed: context.seed,
  });
  return { archetype: decision.archetype, routing: decision.source };
}

/**
 * Resolve one structure's complete visual specification.
 *
 * Deterministic in every input: the same context yields a structurally equal spec, which is what
 * lets the asset cache key on the inputs rather than the output.
 */
export function resolveBuildingSpec(context: BuildingSpecContext): BuildingSpec {
  const development = context.development;
  const capabilities = development?.capabilities ?? [];
  const eraPeriod = architecturalPeriod({
    era: context.era,
    developmentLevel: development?.level,
    capabilities,
  });

  const { archetype: archetypeId, routing } = pickArchetype(context, eraPeriod);
  const archetypeDefinition = buildingArchetype(archetypeId);

  // An archetype whose lineage has not begun in this period is presented as the earliest version
  // of itself that ever existed. This is where that is handled for *every* caller: routing keeps
  // the archetype the response actually calls for — a primitive-era civic hall stays a civic hall
  // — and the period is lifted here so there is always a buildable stage. Routing used to demote
  // such a structure to the role default and then to a house, which silently replaced the
  // building with a different one. The lift is upward only, so it can never backdate a building.
  const earliest = archetypeEarliestPeriod(archetypeId);
  const periodLifted = periodRank(earliest) > periodRank(eraPeriod);
  const period = periodLifted ? earliest : eraPeriod;

  const resolvedStage = archetypeStageFor(archetypeId, period)!;
  const stage = resolvedStage.stage;

  const random = new SeededRandom(`${context.seed}:spec`);
  const zone = climateZoneFrom(context.climate);
  const climate = climateAdaptationFor(zone, context.climate?.floodDepth ?? 0, context.localSlopeDegrees ?? 0);

  const evidence = development
    ? deriveMaterialEvidence({ response: development, project: context.project, stock: context.stock })
    : classOnlyEvidence(presumedClass(period));

  // Wealth blends settlement prosperity with how far this particular response was developed:
  // a level-3 project in a poor settlement still commands more than a level-1 one.
  const level = development?.level ?? 1;
  const wealth = Math.max(0, Math.min(1,
    (context.prosperity ?? 0.4) * 0.6 + ((level - 1) / 2) * 0.3 + periodRank(period) / 7 * 0.1,
  ));

  const floorRange = stage.floors;
  const desired = random.int(floorRange[0], floorRange[1] + 1);
  const requestedFloors = Math.max(1, Math.min(floorRange[1], development ? Math.min(desired, level + 1) : desired));

  const selectionBase = {
    period,
    capabilities,
    zone,
    bias: context.culture.materialBias,
    evidence,
    wealth,
    random,
    debug: context.debug ?? false,
  };

  const { chosen: family, ranking } = selectFamily(stage.families, requestedFloors, selectionBase);
  const familyDefinition = structuralFamily(family);
  const selection: SelectionContext = { ...selectionBase, family };

  // Structural fabric is class-gated; finishes and fittings are not, because a timber building
  // may perfectly well have iron hinges and a tiled roof.
  const wall = selectMaterial('wall', selection, true) ?? ROLE_FALLBACK.wall!;
  const frame = selectMaterial('frame', selection, true) ?? ROLE_FALLBACK.frame!;
  const foundation = selectMaterial('foundation', selection, false) ?? ROLE_FALLBACK.foundation!;
  const roofStructure = selectMaterial('roof-structure', selection, false) ?? ROLE_FALLBACK['roof-structure']!;
  const roofCovering = selectMaterial('roof-covering', selection, false) ?? ROLE_FALLBACK['roof-covering']!;
  const trim = selectMaterial('trim', selection, false) ?? ROLE_FALLBACK.trim!;

  // Optional roles are only filled where the family actually uses them, so an absent finish
  // means "this wall is its own face" rather than "nothing was chosen".
  const assembly = familyDefinition.wallAssembly;
  const wantsInfill = assembly === 'infilled-frame' || assembly === 'clad-frame' || assembly === 'glazed-curtain';
  const wantsFinish = familyPreferences(family, 'finish').length > 0
    && (assembly === 'monolithic-earth' || assembly === 'infilled-frame' || assembly === 'coursed-masonry' || assembly === 'cast-monolith');

  const materials: MaterialAssignment = {
    foundation, frame, wall, roofStructure, roofCovering, trim,
    ...(wantsInfill ? { infill: selectMaterial('infill', selection, false) } : {}),
    ...(wantsFinish ? { finish: selectMaterial('finish', selection, false) } : {}),
    ...(stage.openingDensity > 0.05 ? { glazing: selectMaterial('glazing', selection, false) } : {}),
    hardware: selectMaterial('hardware', selection, false),
  };

  // ----- dimensions -----
  // Storeys are limited by whatever actually carries them. In a load-bearing wall that is the
  // wall material; in a framed building the cladding carries nothing, so clamping a steel-framed
  // silo to corrugated iron's one storey would be wrong — and squat.
  const loadBearingWall = assembly === 'coursed-masonry'
    || assembly === 'load-bearing-brick'
    || assembly === 'monolithic-earth'
    || assembly === 'stacked-log'
    || assembly === 'hide-and-brush';
  const wallLoad = architecturalMaterial(wall).structure;
  const carrying = loadBearingWall ? wallLoad : architecturalMaterial(frame).structure;
  const maxStoreys = Math.max(1, Math.min(familyDefinition.maxStoreys, carrying.maxStoreys));
  const floors = Math.max(1, Math.min(maxStoreys, requestedFloors));

  const scaleJitter = random.range(0.94, 1.07);
  const width = stage.width * scaleJitter;
  const depth = stage.depth * random.range(0.94, 1.07);
  const storeyHeight = stage.storeyHeight * random.range(0.96, 1.05);

  const wallThickness = familyDefinition.wallThickness * climate.wallThickness
    // A weaker wall material inside the same family must be built thicker to stand up.
    * (1 + (0.6 - Math.min(0.6, wallLoad.load)) * 0.5);
  const baySpacing = familyDefinition.baySpacing
    // The frame material's span capacity moves the rhythm: steel opens it, rubble closes it.
    * (0.72 + architecturalMaterial(frame).structure.span * 0.6);
  const bays = Math.max(1, Math.round(width / Math.max(0.12, baySpacing)));

  // ----- roof -----
  const roofArchetype = cultureRoof(stage.roof, context.culture.roofLanguage, context.culture.trimDensity);
  const span = depth;
  const roofStructureSpan = architecturalMaterial(roofStructure).structure.span;
  const maxSpan = familyDefinition.maxRoofSpan * (0.6 + roofStructureSpan * 0.8);
  const pitch = Math.max(0.04, Math.min(1.5,
    (ROOF_BASE_PITCH[roofArchetype] ?? 0.42) * familyDefinition.roofPitchBias * climate.roofPitch * random.range(0.95, 1.06),
  ));
  const ornament = Math.max(0, Math.min(1,
    context.culture.trimDensity * 0.8 + (context.culture.ornamentBias ?? 0) * 0.2,
  ));
  const roof: SpecRoof = {
    archetype: roofArchetype,
    pitch,
    overhang: 0.06 + ornament * 0.1 * climate.eaveOverhang + climate.eaveOverhang * 0.08,
    span,
    tiers: roofArchetype === 'layered' ? Math.max(2, Math.min(4, 1 + floors)) : roofArchetype === 'stepped' ? 3 : 1,
    intermediateSupport: span > maxSpan,
  };

  // ----- openings -----
  const openingDensity = Math.max(0, Math.min(1, stage.openingDensity * climate.openingDensity));
  const glazingMaterial = materials.glazing;
  const openings: SpecOpenings = {
    density: openingDensity,
    // The family sets the dare; the frame material sets the limit. A glazed opening can be
    // wider than an unglazed one because something fills it.
    width: Math.max(0.04, 0.1 * familyDefinition.openingWidth * (glazingMaterial ? 1.1 : 0.9)),
    height: Math.max(0.05, 0.14 * familyDefinition.openingHeight),
    perBay: openingDensity <= 0.02 ? 0 : Math.max(1, Math.round(openingDensity * 3)),
    arched: periodRank(period) >= periodRank('classical')
      && (assembly === 'coursed-masonry' || assembly === 'load-bearing-brick')
      && ornament > 0.3,
  };

  // ----- age and equipment -----
  const age = ageStateFor(context.heritage, development, wall, period, resolvedStage.periodsOld, random);

  const annexRange = stage.annexes;
  const annexes = Math.max(
    annexRange[0],
    Math.min(annexRange[1], annexRange[0] + random.int(0, annexRange[1] - annexRange[0] + 1) + (age.additions > 1 ? 1 : 0)),
  );

  // A settlement's specialization earns its working fittings; it never removes the archetype's.
  const equipment = specEquipment(stage.equipment, context.specialization, period, level);

  const spec: BuildingSpec = {
    archetype: archetypeId,
    role: archetypeDefinition.role,
    era: context.era,
    period,
    family,
    materials,
    width,
    depth,
    storeyHeight,
    floors,
    bays,
    baySpacing,
    wallThickness,
    plinthHeight: storeyHeight * familyDefinition.plinthShare * (1 + climate.plinthBoost * 0.5),
    roof,
    openings,
    frameExposure: familyDefinition.frameExposure,
    supportDensity: Math.max(0, Math.min(1,
      familyDefinition.supportDensity + (roof.intermediateSupport ? 0.2 : 0),
    )),
    foundation: familyDefinition.foundation,
    silhouette: familyDefinition.silhouette,
    wallAssembly: assembly,
    parapet: familyDefinition.parapetProne && periodRank(period) >= periodRank('classical'),
    annexes,
    openness: stage.openness,
    culture: {
      materialBias: context.culture.materialBias,
      roofLanguage: context.culture.roofLanguage,
      ornament,
    },
    climate,
    stage: context.stage ?? BUILD_STAGE.FINISH,
    age,
    equipment,
    seed: context.seed,
    debug: context.debug ?? false,
    provenance: {
      routing,
      periodLifted,
      evidenceGrade: evidence.bestGrade,
      familyScore: ranking[0]?.score ?? 0,
      familyRanking: ranking,
      stageName: stage.name,
      stageDefinedIn: resolvedStage.definedIn,
      stagePeriodsOld: resolvedStage.periodsOld,
    },
  };

  return spec;
}

/** The coarse class to presume for fabric with no development record at all. */
function presumedClass(period: ArchitecturalPeriod): StructureMaterial {
  const rank = periodRank(period);
  if (rank <= 1) return 'earth';
  if (rank <= 3) return 'timber';
  if (rank <= 4) return 'masonry';
  if (rank === 5) return 'ceramic';
  return 'metal';
}

/**
 * Equipment the structure actually carries.
 *
 * The archetype stage is the authority on what its function needs. Specialization adds a little
 * on top — a mining settlement's sheds get rail, an exchange settlement's get cart stands —
 * because that is a real simulation signal about what happens on this ground.
 */
function specEquipment(
  base: readonly FunctionalEquipment[],
  specialization: BuildingSpecContext['specialization'],
  period: ArchitecturalPeriod,
  level: number,
): readonly FunctionalEquipment[] {
  if (!specialization || level < 2) return base;
  const extra: FunctionalEquipment[] = [];
  const industrial = periodRank(period) >= periodRank('industrial');
  switch (specialization) {
    case 'mining':
      if (industrial) extra.push('rail-track', 'crate-stack');
      break;
    case 'exchange':
      extra.push('cart-stand', 'crate-stack');
      break;
    case 'agriculture':
      extra.push('wagon-apron');
      break;
    case 'forestry':
      extra.push('crate-stack');
      break;
    case 'craft':
      extra.push('workbench');
      break;
  }
  const merged = new Set<FunctionalEquipment>(base);
  for (const item of extra) merged.add(item);
  // Stable order: the archetype's own equipment first, then additions in declaration order.
  return [...base, ...extra.filter(item => !base.includes(item))].filter((item, index, all) => all.indexOf(item) === index && merged.has(item));
}

// ---------------------------------------------------------------------------- validation

export type SpecViolationCode =
  | 'material-before-period'
  | 'material-missing-capability'
  | 'material-wrong-role'
  | 'storeys-exceed-wall'
  | 'storeys-exceed-family'
  | 'span-without-support'
  | 'family-before-period'
  | 'archetype-before-period'
  | 'climate-implausible'
  | 'non-finite-dimension';

export interface SpecViolation {
  code: SpecViolationCode;
  detail: string;
}

/**
 * Every way a spec can be architecturally absurd.
 *
 * Production specs must come back clean. Debug specs are allowed to violate anything — that is
 * what debug mode is for — so the caller checks `spec.debug` before caring.
 */
export function validateBuildingSpec(spec: BuildingSpec, capabilities?: readonly string[]): SpecViolation[] {
  const violations: SpecViolation[] = [];

  for (const slot of Object.keys(ASSIGNMENT_ROLE) as (keyof MaterialAssignment)[]) {
    const id = spec.materials[slot];
    if (!id) continue;
    const role = ASSIGNMENT_ROLE[slot];
    const definition = architecturalMaterial(id);

    if (!materialHasRole(id, role)) {
      violations.push({ code: 'material-wrong-role', detail: `${id} cannot serve ${role} (slot ${slot})` });
    }
    if (periodRank(spec.period) < periodRank(definition.earliestPeriod)) {
      violations.push({ code: 'material-before-period', detail: `${id} is not available until ${definition.earliestPeriod}, spec is ${spec.period}` });
    }
    if (capabilities && definition.requiresCapabilities.length > 0) {
      const practised = new Set(capabilities);
      const missing = definition.requiresCapabilities.filter(capability => !practised.has(capability));
      if (missing.length > 0) {
        violations.push({ code: 'material-missing-capability', detail: `${id} requires ${missing.join(', ')}` });
      }
    }
    // Structural fabric in a climate that would destroy it is the single most visible error:
    // mud brick in a rainforest, thatch in deep snow.
    if ((slot === 'wall' || slot === 'roofCovering') && climateSuitability(id, spec.climate.zone) < 0.15) {
      violations.push({ code: 'climate-implausible', detail: `${id} is implausible in ${spec.climate.zone} as ${slot}` });
    }
  }

  const familyDefinition = structuralFamily(spec.family);
  if (periodRank(spec.period) < periodRank(familyDefinition.earliestPeriod)) {
    violations.push({ code: 'family-before-period', detail: `${spec.family} is not available until ${familyDefinition.earliestPeriod}` });
  }
  if (spec.floors > familyDefinition.maxStoreys) {
    violations.push({ code: 'storeys-exceed-family', detail: `${spec.floors} storeys exceeds ${spec.family} limit of ${familyDefinition.maxStoreys}` });
  }
  // Checked against the element that carries the load, exactly as the resolver chose it.
  const loadBearingWall = spec.wallAssembly === 'coursed-masonry'
    || spec.wallAssembly === 'load-bearing-brick'
    || spec.wallAssembly === 'monolithic-earth'
    || spec.wallAssembly === 'stacked-log'
    || spec.wallAssembly === 'hide-and-brush';
  const carrier = loadBearingWall ? spec.materials.wall : spec.materials.frame;
  const carrierMax = architecturalMaterial(carrier).structure.maxStoreys;
  if (spec.floors > carrierMax) {
    violations.push({ code: 'storeys-exceed-wall', detail: `${spec.floors} storeys exceeds ${carrier} limit of ${carrierMax}` });
  }
  if (spec.roof.intermediateSupport && spec.supportDensity <= familyDefinition.supportDensity) {
    violations.push({ code: 'span-without-support', detail: `span ${spec.roof.span.toFixed(2)} needs intermediate support but density was not raised` });
  }
  if (periodRank(spec.period) < periodRank(archetypeEarliestPeriod(spec.archetype))) {
    violations.push({ code: 'archetype-before-period', detail: `${spec.archetype} does not exist until ${archetypeEarliestPeriod(spec.archetype)}` });
  }

  for (const [name, value] of [
    ['width', spec.width], ['depth', spec.depth], ['storeyHeight', spec.storeyHeight],
    ['wallThickness', spec.wallThickness], ['baySpacing', spec.baySpacing], ['roof.pitch', spec.roof.pitch],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      violations.push({ code: 'non-finite-dimension', detail: `${name} is ${value}` });
    }
  }

  return violations;
}

/**
 * Compact deterministic signature of everything in a spec that changes geometry.
 *
 * The asset cache keys on this, so two structures that differ only in diagnostics share one
 * mesh while two that differ in any visible decision do not.
 */
export function buildingSpecSignature(spec: BuildingSpec): string {
  const materials = (Object.keys(ASSIGNMENT_ROLE) as (keyof MaterialAssignment)[])
    .map(slot => spec.materials[slot] ?? '-')
    .join(',');
  return [
    spec.archetype, spec.period, spec.family, materials,
    spec.floors, spec.bays, spec.roof.archetype,
    spec.roof.pitch.toFixed(3), spec.roof.tiers, spec.roof.intermediateSupport ? 1 : 0,
    spec.openings.density.toFixed(2), spec.openings.perBay, spec.openings.arched ? 1 : 0,
    spec.width.toFixed(3), spec.depth.toFixed(3), spec.storeyHeight.toFixed(3),
    spec.wallThickness.toFixed(4), spec.baySpacing.toFixed(3), spec.plinthHeight.toFixed(3),
    spec.frameExposure.toFixed(2), spec.supportDensity.toFixed(2),
    spec.foundation, spec.silhouette, spec.wallAssembly, spec.parapet ? 1 : 0,
    spec.annexes, spec.openness.toFixed(2),
    spec.climate.zone, spec.culture.ornament.toFixed(2),
    spec.stage, spec.age.condition, spec.age.wear.toFixed(2), spec.age.damage.toFixed(2),
    spec.age.originalMaterial ?? '-',
    spec.equipment.join('+'),
  ].join('|');
}
