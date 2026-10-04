/**
 * ArchetypeRouting.ts
 *
 * Which architectural archetype a real simulation building is.
 *
 * This exists because `BuildingRole` is a coarser vocabulary than architecture needs. The
 * development system produces a farmstead, a granary, a freight depot and a grain silo, and
 * `developmentBuildingRole` collapses all four onto the role `granary`, because that is all the
 * placement and LOD systems need to know. Routing on role alone therefore made every
 * agricultural building render as the same archetype — the first one declared for the role.
 *
 * So routing reads the authoritative response instead: the settlement's own `need` and `form`,
 * the level it was developed to, the capabilities it was observed practising, its specialization
 * and its geography. Those are the same fields the simulation used to decide what to build, which
 * is what makes this interpretation rather than invention.
 *
 * Some archetypes are deliberately *not* derivable here. Bridges and boundary walls belong to
 * TransportationSystem and to settlement perimeter dressing, not to settlement development —
 * `responseForNeed` says so in its own comment for the transport need. Those are requested
 * explicitly, and each one declares that for itself through its `status` in `BuildingArchetype`.
 * `validateStructureCatalogue` checks the declarations against this router's real behaviour.
 */

import type { SettlementNeed, StructureForm } from '../../sim/development/types';
import type { BuildingRole } from '../assets/BuildingGrammar';
import { SeededRandom } from '../../sim/prng';
import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { periodRank } from './ArchitecturalPeriod';
import type { BuildingArchetype } from './BuildingArchetype';
import { ARCHETYPE_LIBRARY, BUILDING_ARCHETYPES, archetypeStageFor } from './BuildingArchetype';

export type SettlementSpecialization = 'agriculture' | 'forestry' | 'mining' | 'craft' | 'exchange';

export interface ArchetypeRoutingContext {
  energyKind?: import('../../sim/energy/types').GeneratorKind;
  /** The renderer role, which stays authoritative for placement and LOD. */
  role: BuildingRole;
  period: ArchitecturalPeriod;
  /** Authoritative social purpose of the local response. */
  need?: SettlementNeed;
  /** Authoritative physical arrangement of the local response. */
  form?: StructureForm;
  /** How far the response was developed, 1..3. */
  level?: number;
  /** Capability ids the simulation observed in practice. */
  capabilities?: readonly string[];
  specialization?: SettlementSpecialization;
  /** The settlement sits on a coast, lake or river — authoritative cell geography. */
  waterfront?: boolean;
  /** Plot seed, used only to vary between archetypes the state supports equally. */
  seed?: string;
}

/**
 * The archetype a role presents as when there is no development response at all.
 *
 * Ambient settlement fabric, founding-era shelters and landmarks arrive without one, and still
 * have to resolve to something sensible. These are the *unmarked* reading of each role: a
 * granary-role building with no further information is a store, not a farmstead.
 */
const ROLE_DEFAULT: Record<BuildingRole, BuildingArchetype> = {
  shelter: 'house',
  'lean-to': 'house',
  hut: 'house',
  house: 'house',
  compound: 'house',
  'ritual-marker': 'shrine',
  'store-pit': 'granary',
  granary: 'granary',
  shrine: 'shrine',
  market: 'market',
  workshop: 'workshop',
  hall: 'civic-hall',
  warehouse: 'warehouse',
  'gate-tower': 'gatehouse',
  factory: 'factory',
  foundry: 'factory',
  research: 'civic-hall',
  energy: 'factory',
};

export function archetypeForRole(role: BuildingRole): BuildingArchetype {
  const archetype = ROLE_DEFAULT[role];
  if (!archetype) throw new Error(`Unknown building role: ${String(role)}`);
  return archetype;
}

/**
 * Every renderer role, at runtime.
 *
 * `BuildingRole` is a union with no runtime form of its own, and `ROLE_DEFAULT` is the one table
 * the compiler already forces to be exhaustive over it. Deriving the list from those keys means
 * adding a role is a compile error here rather than a role the catalogue silently never sweeps.
 */
export const BUILDING_ROLES: readonly BuildingRole[] = Object.keys(ROLE_DEFAULT) as BuildingRole[];

/** Is this capability being practised at all? */
function practises(context: ArchetypeRoutingContext, capability: string): boolean {
  return context.capabilities?.includes(capability) ?? false;
}

/**
 * The livestock building a farmstead shows on this plot.
 *
 * The simulation models husbandry as a capability, not as a per-building fact, so it cannot say
 * "this one is the stable". What it does say is whether the settlement keeps animals at all, and
 * a farm that keeps animals has a mix of buildings rather than three identical barns. The choice
 * among them is therefore deterministic presentation variation, seeded per plot — never a
 * gameplay decision, and never reached unless husbandry is actually practised.
 */
function farmBuilding(context: ArchetypeRoutingContext): BuildingArchetype {
  if (!practises(context, 'animal-husbandry')) return 'barn';
  const random = new SeededRandom(`${context.seed ?? 'plot'}:farm-building`);
  const draw = random.float();
  // The barn stays the commonest building on any farm; byres, stables and open pens split the
  // rest. The pen is the only one of the four whose lineage reaches back to the neolithic, so it
  // is also what lets a pre-bronzeIron farm show anything but a barn.
  if (draw < 0.45) return 'barn';
  if (draw < 0.65) return 'byre';
  if (draw < 0.8) return 'animal-pen';
  return periodRank(context.period) >= periodRank('bronzeIron') ? 'stable' : 'byre';
}

/** Where a routing decision came from. Published so a wrong building is diagnosable, not a mystery. */
export type RoutingSource =
  /** The authoritative development response pinned the answer down. */
  | 'response'
  /** No response, or a response that does not discriminate: the role's unmarked reading. */
  | 'role-default';

export interface RoutingDecision {
  archetype: BuildingArchetype;
  source: RoutingSource;
  /**
   * The archetype is right, but its lineage has not begun in the period asked for.
   *
   * This is *not* a failure and deliberately does not change the archetype. `resolveBuildingSpec`
   * lifts the period to the archetype's earliest stage, so a primitive-era civic hall is the
   * earliest civic hall rather than — as it was until this was removed — a house. Demoting here
   * silently replaced the building with a different one, which is exactly the fallback this
   * routing layer must not have.
   */
  beforeLineage: boolean;
}

/**
 * Route one structure to its architectural archetype, with the reasoning attached.
 *
 * Deterministic in every input. Always resolves: the role's unmarked reading is a total map, so
 * there is no "unknown structure" case to absorb. The one thing routing will not do is swap in a
 * different archetype because the chosen one is early for its period — that decision belongs to
 * the spec resolver, which handles it by presenting the archetype's earliest stage.
 */
export function routeArchetype(context: ArchetypeRoutingContext): RoutingDecision {
  const chosen = context.energyKind === 'waterwheel' ? 'mill'
    : context.energyKind === 'windmill' ? 'windmill' : routeByResponse(context);
  const archetype = chosen ?? archetypeForRole(context.role);
  return {
    archetype,
    source: chosen ? 'response' : 'role-default',
    beforeLineage: archetypeStageFor(archetype, context.period) === undefined,
  };
}

/** The archetype alone, for callers that do not need the reasoning. */
export function archetypeForContext(context: ArchetypeRoutingContext): BuildingArchetype {
  return routeArchetype(context).archetype;
}

function routeByResponse(context: ArchetypeRoutingContext): BuildingArchetype | undefined {
  const { need, form } = context;
  if (!need || !form) return undefined;
  const level = Math.max(1, Math.min(3, context.level ?? 1));
  const industrial = periodRank(context.period) >= periodRank('industrial');

  // A sanctuary is a sanctuary whoever sponsored it: a temple watch and a temple infirmary are
  // both religious buildings before they are military or medical ones.
  if (form === 'sanctuary') return 'shrine';
  if (form === 'marker') return 'shrine';

  switch (need) {
    case 'housing':
      return 'house';

    case 'food':
      // 'field' is the development system's farmstead; 'store' is its granary.
      if (form === 'field') return farmBuilding(context);
      // Bulk vertical storage only once a settlement can build and fill it.
      if (industrial && level >= 3) return 'silo';
      return 'granary';

    case 'trade':
      if (form === 'gathering') return 'market';
      // A trade store on the water is a dock; inland it is a warehouse.
      return context.waterfront ? 'dock' : 'warehouse';

    case 'transport':
      // Freight depots on the water are quays. Routes, bridges and rail stay
      // TransportationSystem's authority and never arrive through here.
      return context.waterfront ? 'dock' : 'warehouse';

    case 'manufacturing':
      return form === 'works' ? 'factory' : 'workshop';

    case 'energy':
      // A fuel yard does not establish a prime mover. EnergyPlant owns that choice.
      return form === 'works' ? 'factory' : 'workshop';

    case 'water':
      // A sanitation works is industrial plant; a cistern and wash court is a store building.
      return form === 'works' ? 'factory' : 'granary';

    case 'government':
    case 'knowledge':
    case 'healthcare':
      return 'civic-hall';

    case 'religion':
      return 'shrine';

    case 'security':
      // A watch tower is a gatehouse. A guard house or a watch assembly is a building, not a
      // perimeter — routing those to a wall would render a hall as a wall segment.
      return form === 'tower' ? 'gatehouse' : 'civic-hall';

    case 'memory':
      return 'shrine';
  }
}

/**
 * Archetypes no development response may produce.
 *
 * Derived from each archetype's own declared status rather than listed again here, so adding or
 * retiring one is a single edit in `BuildingArchetype`. `validateStructureCatalogue` asserts the
 * declaration and this router actually agree, which is what stops a routing rule from quietly
 * claiming a structure another system owns.
 */
export const SUBSYSTEM_OWNED_ARCHETYPES: readonly BuildingArchetype[] = BUILDING_ARCHETYPES
  .filter(id => ARCHETYPE_LIBRARY[id].status !== 'active');

export function isSubsystemOwned(archetype: BuildingArchetype): boolean {
  return SUBSYSTEM_OWNED_ARCHETYPES.includes(archetype);
}
