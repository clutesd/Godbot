/**
 * StructureCatalogue.ts
 *
 * The one discoverable answer to "what structures exist, and how does each one get built?"
 *
 * Nothing here is hand-written content. Every field is derived from the modules that already own
 * the decision — `ARCHETYPE_LIBRARY` for what a structure is and how it looked in each period,
 * `ArchetypeRouting` for what reaches it, `DedicatedStructures` for whether it needs geometry of
 * its own. That is deliberate: a second hand-maintained list would drift, and the drift would be
 * invisible. Adding an archetype makes it appear here, in the architecture browser and in the
 * acceptance tests without anyone editing a switch statement.
 *
 * Routing facts in particular are *measured*, not declared. The catalogue runs the real router
 * over the authoritative input space and records what came back, so "which roles and responses
 * route to a barn" is answered by the router itself rather than by a comment about the router.
 * That is what lets `validateStructureCatalogue` catch an archetype whose declared status and
 * actual reachability have come apart.
 */

import type { SettlementNeed, StructureForm } from '../../sim/development/types';
import { SETTLEMENT_NEEDS } from '../../sim/development/types';
import type { DevelopmentResponse } from '../../sim/development/types';
import type { BuildingRole } from '../assets/BuildingGrammar';
import { developmentBuildingRole } from '../assets/BuildingGrammar';
import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { ARCHITECTURAL_PERIODS, PERIOD_LABELS, periodRank } from './ArchitecturalPeriod';
import type { ArchetypeStatus, BuildingArchetype, FunctionalEquipment } from './BuildingArchetype';
import {
  ARCHETYPE_LIBRARY, BUILDING_ARCHETYPES, archetypeEarliestPeriod, archetypeStageFor,
} from './BuildingArchetype';
import { BUILDING_ROLES, archetypeForRole, routeArchetype } from './ArchetypeRouting';
import type { StructuralFamily } from './StructuralFamily';
import { structuralFamily } from './StructuralFamily';
import { DEDICATED_ARCHETYPES, dedicatedGeometryKind, type DedicatedGeometryKind } from './DedicatedStructures';

/**
 * Every structure form, at runtime, exhaustively.
 *
 * `StructureForm` is a bare union in the simulation's own types. Routing it through a record the
 * compiler must fill makes adding a form a compile error here, rather than a form the routing
 * sweep quietly never tries.
 */
const FORM_PRESENT: Record<StructureForm, true> = {
  dwelling: true, field: true, store: true, gathering: true, hall: true,
  sanctuary: true, tower: true, workshop: true, works: true, marker: true,
};
export const STRUCTURE_FORMS: readonly StructureForm[] = Object.keys(FORM_PRESENT) as StructureForm[];

/**
 * The forms `responseForNeed` can actually give each need.
 *
 * Mirrors the switch in SettlementDevelopmentSystem. It is declared rather than derived because
 * deriving it would mean standing up a whole DevelopmentContext — a settlement, a culture, its
 * institutions and its practised capabilities — for every branch, which is a simulation fixture,
 * not an architecture one.
 *
 * Sweeping arbitrary need/form pairs instead would be worse than redundant: the development
 * system never produces a `food` need as a `dwelling`, so routing it would report routes that
 * cannot happen and bury the real ones. Typed as a total record over `SettlementNeed`, so adding
 * a need to the simulation is a compile error here rather than a silently unswept need.
 *
 * `works` appears for manufacturing, energy and water because `responseForNeed` overrides the
 * form to `works` at level three for exactly those needs.
 */
const NEED_FORMS: Record<SettlementNeed, readonly StructureForm[]> = {
  housing: ['dwelling'],
  food: ['field', 'store'],
  trade: ['store', 'gathering'],
  government: ['gathering', 'hall'],
  security: ['sanctuary', 'tower', 'gathering', 'hall'],
  religion: ['sanctuary', 'marker'],
  knowledge: ['sanctuary', 'hall'],
  healthcare: ['sanctuary', 'hall'],
  manufacturing: ['workshop', 'works'],
  transport: ['store'],
  energy: ['workshop', 'works'],
  water: ['store', 'works'],
  memory: ['marker'],
};

/**
 * Every response the development system can produce, as (need, form, level) triples.
 *
 * Exported because the acceptance tests build real assets from exactly this list: proving every
 * active archetype resolves through the production AssetBuilder means driving it with responses
 * the simulation could really hand over, not with invented ones.
 */
export const DEVELOPMENT_RESPONSE_SHAPES: readonly { need: SettlementNeed; form: StructureForm; level: number }[] =
  SETTLEMENT_NEEDS.flatMap(need => NEED_FORMS[need].flatMap(
    form => [1, 2, 3].map(level => ({ need, form, level })),
  ));

/**
 * The capability sets the sweep tries.
 *
 * Not every combination — that is exponential and pointless. These are the three that actually
 * discriminate: nothing practised, husbandry (which splits a farmstead between barn, byre and
 * stable), and a full industrial toolkit (which is what lifts a period to its era ceiling).
 */
const SWEEP_CAPABILITIES: readonly (readonly string[])[] = [
  [],
  ['animal-husbandry'],
  ['metal-smelting', 'iron-working', 'mechanical-power', 'rotary-machinery', 'thermodynamics', 'automation'],
];

/**
 * Plot seeds the sweep tries.
 *
 * Only one routing decision is seeded — which livestock building a farm shows — and it draws
 * three outcomes from one uniform. Thirty-two seeds make missing any of them vanishingly
 * unlikely while keeping the sweep cheap enough to run inside a test.
 */
const SWEEP_SEEDS: readonly string[] = Array.from({ length: 32 }, (_, index) => `catalogue-plot-${index}`);

/** One period's entry in a lineage, flattened for display and for assertions. */
export interface CatalogueStage {
  period: ArchitecturalPeriod;
  /** Human label for the period, so a caller never has to re-import the period tables. */
  periodLabel: string;
  /** What this structure is called when built this way. */
  name: string;
  /** True when this period defines a new stage rather than inheriting an earlier one. */
  distinct: boolean;
  /** The period whose lineage entry actually supplied it. */
  definedIn: ArchitecturalPeriod;
  families: readonly StructuralFamily[];
  equipment: readonly FunctionalEquipment[];
  floors: readonly [number, number];
}

/** One authoritative response shape that reaches an archetype. */
export interface CatalogueRoute {
  role: BuildingRole;
  need: SettlementNeed;
  form: StructureForm;
  /** True when the route only fires for a waterfront settlement. */
  waterfrontOnly: boolean;
}

export interface StructureCatalogueEntry {
  id: BuildingArchetype;
  label: string;
  category: string;
  /** The renderer role this archetype presents as. Authoritative for placement and LOD. */
  role: BuildingRole;
  /** The declared answer to "can production produce this?". */
  status: ArchetypeStatus;
  /** The measured answer. A disagreement with `status` is a validation failure. */
  routable: boolean;
  /** Whether this archetype is what the bare role resolves to with no response at all. */
  roleDefault: boolean;
  earliestPeriod: ArchitecturalPeriod;
  /** Every period the archetype exists in, earliest onward. */
  periods: readonly ArchitecturalPeriod[];
  /** The stage in force in each of those periods, inherited entries included. */
  stages: readonly CatalogueStage[];
  /** Every structural family any stage of the lineage can be built with. */
  families: readonly StructuralFamily[];
  /** Generic shell, or geometry of its own because it is not a building. */
  geometry: 'generic' | 'dedicated';
  /** Which dedicated composition, when the geometry is dedicated. */
  dedicatedKind: DedicatedGeometryKind | undefined;
  /** Every response shape the router actually resolves to this archetype. */
  routes: readonly CatalogueRoute[];
  /** Renderer roles whose responses can reach this archetype, measured. */
  reachedFromRoles: readonly BuildingRole[];
  equipment: readonly FunctionalEquipment[];
}

// ---------------------------------------------------------------------------- routing sweep

interface SweepResult {
  /** archetype -> the response shapes that reached it. */
  routes: Map<BuildingArchetype, CatalogueRoute[]>;
  /** Routing outcomes whose archetype declares a different renderer role than was asked for. */
  roleDivergences: { role: BuildingRole; need: SettlementNeed; form: StructureForm; archetype: BuildingArchetype }[];
}

/**
 * Run the real router over the authoritative input space.
 *
 * Deterministic and self-contained: it consumes no simulation state and allocates no geometry, so
 * it is safe to call from a test, from the browser, or from a diagnostic overlay.
 */
function sweepRouting(): SweepResult {
  const routes = new Map<BuildingArchetype, CatalogueRoute[]>();
  const seen = new Set<string>();
  const roleDivergences: SweepResult['roleDivergences'] = [];
  const divergenceSeen = new Set<string>();

  const record = (route: CatalogueRoute, archetype: BuildingArchetype): void => {
    const key = `${archetype}|${route.role}|${route.need}|${route.form}`;
    const bucket = routes.get(archetype) ?? [];
    if (!seen.has(key)) {
      seen.add(key);
      bucket.push(route);
      routes.set(archetype, bucket);
    } else if (!route.waterfrontOnly) {
      // A route first seen only on the waterfront, now reached inland too: widen it.
      const existing = bucket.find(entry => entry.role === route.role && entry.need === route.need && entry.form === route.form);
      if (existing) existing.waterfrontOnly = false;
    }
    // A divergence worth reporting: the development system assigned this response one renderer
    // role, and routing resolved an archetype that declares a different one. The renderer role
    // wins for placement and LOD while the archetype's stage supplies the massing, so this is a
    // seam rather than a bug — but it is the seam to look at first when a building is the wrong
    // size for its plot, which is why it is surfaced instead of left implicit.
    if (ARCHETYPE_LIBRARY[archetype].role === route.role) return;
    const divergenceKey = `${archetype}|${route.role}`;
    if (divergenceSeen.has(divergenceKey)) return;
    divergenceSeen.add(divergenceKey);
    roleDivergences.push({ role: route.role, need: route.need, form: route.form, archetype });
  };

  // Every response the development system can actually produce, paired with the renderer role it
  // would itself assign to it. Those two together are the authoritative input the architecture
  // layer receives in production, so routing them is what makes these measured facts rather than
  // a sweep of combinations the simulation cannot reach.
  for (const shape of DEVELOPMENT_RESPONSE_SHAPES) {
    const { need, form, level } = shape;
    const role = developmentBuildingRole({ need, form, level } as DevelopmentResponse);
    for (const period of ARCHITECTURAL_PERIODS) {
      for (const capabilities of SWEEP_CAPABILITIES) {
        for (const waterfront of [false, true]) {
          // Seeds only matter where routing actually draws on one; everything else is identical
          // across them, so the cheap case is tried once.
          const seeds = form === 'field' && capabilities.includes('animal-husbandry')
            ? SWEEP_SEEDS
            : SWEEP_SEEDS.slice(0, 1);
          for (const seed of seeds) {
            const decision = routeArchetype({
              role, period, need, form, level, capabilities, waterfront, seed,
            });
            record({ role, need, form, waterfrontOnly: waterfront }, decision.archetype);
          }
        }
      }
    }
  }

  // The no-response reading of every role, which ambient settlement fabric, founding-era
  // shelters and landmarks all arrive as. These carry no need or form at all, so they are swept
  // separately rather than folded into the response loop above.
  for (const role of BUILDING_ROLES) {
    for (const period of ARCHITECTURAL_PERIODS) {
      record(
        { role, need: 'housing', form: 'dwelling', waterfrontOnly: false },
        routeArchetype({ role, period }).archetype,
      );
    }
  }

  return { routes, roleDivergences };
}

let cachedSweep: SweepResult | undefined;

function routingSweep(): SweepResult {
  cachedSweep ??= sweepRouting();
  return cachedSweep;
}

// ---------------------------------------------------------------------------- catalogue

function stagesFor(id: BuildingArchetype): CatalogueStage[] {
  const earliest = periodRank(archetypeEarliestPeriod(id));
  const stages: CatalogueStage[] = [];
  for (const period of ARCHITECTURAL_PERIODS) {
    if (periodRank(period) < earliest) continue;
    const resolved = archetypeStageFor(id, period);
    if (!resolved) continue;
    stages.push({
      period,
      periodLabel: PERIOD_LABELS[period].label,
      name: resolved.stage.name,
      distinct: resolved.periodsOld === 0,
      definedIn: resolved.definedIn,
      families: resolved.stage.families,
      equipment: resolved.stage.equipment,
      floors: resolved.stage.floors,
    });
  }
  return stages;
}

function buildEntry(id: BuildingArchetype, sweep: SweepResult): StructureCatalogueEntry {
  const definition = ARCHETYPE_LIBRARY[id];
  const stages = stagesFor(id);
  const routes = sweep.routes.get(id) ?? [];
  const families = [...new Set(stages.flatMap(stage => [...stage.families]))];
  const equipment = [...new Set(stages.flatMap(stage => [...stage.equipment]))];
  const dedicatedKind = dedicatedGeometryKind(id);

  return {
    id,
    label: definition.label,
    category: definition.category,
    role: definition.role,
    status: definition.status,
    routable: routes.length > 0,
    roleDefault: archetypeForRole(definition.role) === id,
    earliestPeriod: archetypeEarliestPeriod(id),
    periods: stages.map(stage => stage.period),
    stages,
    families,
    geometry: dedicatedKind ? 'dedicated' : 'generic',
    dedicatedKind,
    routes,
    reachedFromRoles: [...new Set(routes.map(route => route.role))],
    equipment,
  };
}

let cachedCatalogue: readonly StructureCatalogueEntry[] | undefined;

/**
 * Every structure the architecture engine knows how to build.
 *
 * Built once and memoised. Pure: no simulation state, no geometry, no THREE objects — so a test
 * or a diagnostic can call it freely.
 */
export function structureCatalogue(): readonly StructureCatalogueEntry[] {
  cachedCatalogue ??= BUILDING_ARCHETYPES.map(id => buildEntry(id, routingSweep()));
  return cachedCatalogue;
}

export function catalogueEntry(id: BuildingArchetype): StructureCatalogueEntry {
  const entry = structureCatalogue().find(candidate => candidate.id === id);
  // Unreachable while the catalogue is derived from BUILDING_ARCHETYPES; thrown rather than
  // returned as undefined so a future partial catalogue fails loudly instead of silently.
  if (!entry) throw new Error(`No catalogue entry for archetype '${id}'.`);
  return entry;
}

/** The catalogue grouped by declared status, which is how the browser lays out its sections. */
export function catalogueByStatus(status: ArchetypeStatus): readonly StructureCatalogueEntry[] {
  return structureCatalogue().filter(entry => entry.status === status);
}

/** Every category in the catalogue, for filter menus. Sorted, so the menu order is stable. */
export function catalogueCategories(): readonly string[] {
  return [...new Set(structureCatalogue().map(entry => entry.category))].sort();
}

// ---------------------------------------------------------------------------- validation

export type CatalogueDiagnosticCode =
  /** Declared `active` but no response shape in the whole input space reaches it. */
  | 'unreachable-active-archetype'
  /** Declared not-active but routing reaches it anyway — an undeclared behaviour change. */
  | 'undeclared-routing'
  /** The lineage is empty, so the archetype can never be built in any period. */
  | 'no-historical-stage'
  /** A role's unmarked reading names an archetype that is not active. */
  | 'role-default-not-active'
  /** A dedicated composition exists for something no archetype declares. */
  | 'orphan-dedicated-geometry'
  /** A stage names a structural family that does not exist in the period that stage covers. */
  | 'stage-family-before-period'
  /** A stage lists no structural family at all, so no material can be resolved. */
  | 'stage-without-family'
  /** Routing resolves an archetype that presents as a different renderer role than was asked for. */
  | 'role-divergence';

export interface CatalogueDiagnostic {
  code: CatalogueDiagnosticCode;
  /** The archetype at fault, where there is one. */
  archetype?: BuildingArchetype;
  detail: string;
  /**
   * `error` must be empty for the catalogue to be considered sound. `info` records a seam that is
   * intentional today but worth seeing — role divergence is the only one, and ARCHITECTURE.md
   * explains why it is allowed.
   */
  severity: 'error' | 'info';
}

/**
 * Everything that can be wrong with the set of structures, checked without building geometry.
 *
 * This is the guard that makes adding and removing a structure safe. The expensive half of the
 * contract — that every active archetype really does come out of the production `AssetBuilder`
 * path — needs a renderer and lives in `tests/architecture-catalogue.test.ts` instead.
 */
export function validateStructureCatalogue(): CatalogueDiagnostic[] {
  const diagnostics: CatalogueDiagnostic[] = [];
  const catalogue = structureCatalogue();

  for (const entry of catalogue) {
    if (entry.stages.length === 0) {
      diagnostics.push({
        code: 'no-historical-stage', archetype: entry.id, severity: 'error',
        detail: `${entry.id} declares no lineage entry, so it can never be built.`,
      });
    }

    if (entry.status === 'active' && !entry.routable) {
      diagnostics.push({
        code: 'unreachable-active-archetype', archetype: entry.id, severity: 'error',
        detail: `${entry.id} is declared active but no role, need or form in the authoritative `
          + 'input space routes to it. Either give it a routing rule in ArchetypeRouting or '
          + "declare it 'planned'.",
      });
    }

    if (entry.status !== 'active' && entry.routable) {
      const example = entry.routes[0]!;
      diagnostics.push({
        code: 'undeclared-routing', archetype: entry.id, severity: 'error',
        detail: `${entry.id} is declared '${entry.status}' but routing reaches it from `
          + `${example.role}/${example.need}/${example.form}. Declare it active or remove the rule.`,
      });
    }

    for (const stage of entry.stages) {
      if (stage.families.length === 0) {
        diagnostics.push({
          code: 'stage-without-family', archetype: entry.id, severity: 'error',
          detail: `${entry.id} stage '${stage.name}' (${stage.definedIn}) lists no structural family.`,
        });
        continue;
      }
      // Only the period that *defines* a stage has to be able to build it. A later period
      // inheriting it is surviving older fabric, which is the point of a sparse lineage.
      if (stage.period !== stage.definedIn) continue;
      const buildable = stage.families.filter(
        family => periodRank(stage.period) >= periodRank(structuralFamily(family).earliestPeriod),
      );
      if (buildable.length === 0) {
        diagnostics.push({
          code: 'stage-family-before-period', archetype: entry.id, severity: 'error',
          detail: `${entry.id} stage '${stage.name}' is defined in ${stage.definedIn} but every `
            + `family it names (${stage.families.join(', ')}) appears later.`,
        });
      }
    }
  }

  for (const role of BUILDING_ROLES) {
    const fallback = archetypeForRole(role);
    if (ARCHETYPE_LIBRARY[fallback].status === 'active') continue;
    diagnostics.push({
      code: 'role-default-not-active', archetype: fallback, severity: 'error',
      detail: `Role '${role}' falls back to '${fallback}', which is declared `
        + `'${ARCHETYPE_LIBRARY[fallback].status}'. A role's unmarked reading must be a structure `
        + 'production can build.',
    });
  }

  const declared = new Set<string>(DEDICATED_ARCHETYPES);
  for (const id of declared) {
    if (BUILDING_ARCHETYPES.includes(id as BuildingArchetype)) continue;
    diagnostics.push({
      code: 'orphan-dedicated-geometry', severity: 'error',
      detail: `DedicatedStructures composes '${id}', which no archetype declares.`,
    });
  }

  for (const divergence of routingSweep().roleDivergences) {
    diagnostics.push({
      code: 'role-divergence', archetype: divergence.archetype, severity: 'info',
      detail: `Role '${divergence.role}' with ${divergence.need}/${divergence.form} routes to `
        + `'${divergence.archetype}', which presents as '${ARCHETYPE_LIBRARY[divergence.archetype].role}'. `
        + 'The renderer role stays authoritative for placement and LOD; the spec supplies the massing.',
    });
  }

  return diagnostics;
}

/** The subset that must be empty. Convenience for tests and for the browser's status line. */
export function catalogueErrors(): CatalogueDiagnostic[] {
  return validateStructureCatalogue().filter(diagnostic => diagnostic.severity === 'error');
}

/**
 * Reset the memoised sweep.
 *
 * Only for tests that register a structure at runtime to prove the catalogue discovers it
 * without renderer changes. Production never mutates the library, so nothing else needs this.
 */
export function resetStructureCatalogue(): void {
  cachedSweep = undefined;
  cachedCatalogue = undefined;
}
