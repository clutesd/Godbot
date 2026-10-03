import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';

import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, SettlementNeed, StructureForm, StructureMaterial } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { developmentBuildingRole, developmentPresentationEra, type BuildingRole } from '../src/render/assets/BuildingGrammar';
import type { Era } from '../src/render/materials/MaterialPalette';
import {
  BUILDING_ARCHETYPES,
  archetypeStageFor,
  buildingArchetype,
  type BuildingArchetype,
} from '../src/render/architecture/BuildingArchetype';
import {
  BUILDING_ROLES,
  SUBSYSTEM_OWNED_ARCHETYPES,
  archetypeForContext,
  archetypeForRole,
  routeArchetype,
} from '../src/render/architecture/ArchetypeRouting';
import { ARCHITECTURAL_PERIODS } from '../src/render/architecture/ArchitecturalPeriod';
import { resolveBuildingSpec } from '../src/render/architecture/BuildingSpec';
import { PERIOD_DRIVE, specContextFor } from './helpers/architecturePeriods';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

const INDUSTRIAL_CAPABILITIES = [
  'fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'metal-smelting',
  'material-testing', 'iron-working', 'high-temperature-ceramics', 'mechanical-power',
  'precision-tools', 'standardized-parts', 'rotary-machinery', 'thermodynamics',
  'industrial-chemistry', 'animal-husbandry', 'agrarian-surplus', 'wheel-axle',
];

/**
 * A development response shaped exactly as `responseForNeed` produces them.
 *
 * Routing is only meaningful if it reads the same fields the simulation actually fills in, so
 * these fixtures mirror the real (need, form, level) combinations from SettlementDevelopmentSystem.
 */
function response(need: SettlementNeed, form: StructureForm, level: number, material: StructureMaterial = 'masonry'): DevelopmentResponse {
  return {
    need,
    form,
    name: `${need}-${form}-${level}`,
    level,
    material,
    cultureId: 'test-culture',
    style: CULTURE,
    services: {},
    reasons: [],
    capabilities: INDUSTRIAL_CAPABILITIES,
    cost: { food: 0, wood: 8, minerals: 6, goods: 0, wealth: 0 },
    labor: 10,
  };
}

/**
 * Build through exactly the path GodboxRenderer uses: `getAsset('building', ...)` with the role
 * and stage encoded in the variant, the authoritative response attached, and the settlement's
 * own climate, prosperity, specialization and geography supplied.
 */
function productionAsset(options: {
  builder: AssetBuilder;
  response?: DevelopmentResponse;
  era?: Era;
  seed?: string;
  role?: string;
  waterfront?: boolean;
  specialization?: 'agriculture' | 'forestry' | 'mining' | 'craft' | 'exchange';
  archetype?: BuildingArchetype;
}): THREE.Object3D {
  const development = options.response;
  const role = options.role ?? (development ? developmentBuildingRole(development) : 'house');
  const era = options.era ?? (development ? developmentPresentationEra(development) : 'village');
  return options.builder.getAsset('building', {
    seed: options.seed ?? `route:${role}:${development?.name ?? 'ambient'}`,
    culture: CULTURE,
    era,
    variant: `${role}#${BUILD_STAGE.FINISH}`,
    development,
    prosperity: 0.6,
    specialization: options.specialization,
    waterfront: options.waterfront,
    archetype: options.archetype,
    grammarContext: { temperature: 0.5, moisture: 0.5 },
  }).mesh;
}

function archetypeOf(mesh: THREE.Object3D): string {
  return String(mesh.userData['architectureArchetype']);
}

// ---------------------------------------------------------------------------- the routing table

describe('Archetype routing', () => {
  it('never collapses several archetypes of one role onto the first declared', () => {
    // The bug this replaces: every granary-role building resolved to `barn`, because routing
    // walked the archetypes declared for the role and took the first whose lineage had begun.
    const farmstead = archetypeForContext({ role: 'granary', period: 'medieval', need: 'food', form: 'field', level: 2, capabilities: [] });
    const store = archetypeForContext({ role: 'granary', period: 'medieval', need: 'food', form: 'store', level: 2 });
    expect(farmstead).toBe('barn');
    expect(store).toBe('granary');
    expect(farmstead).not.toBe(store);
  });

  it('reads the authoritative need and form rather than the role', () => {
    const cases: { need: SettlementNeed; form: StructureForm; level: number; expected: BuildingArchetype }[] = [
      { need: 'housing', form: 'dwelling', level: 1, expected: 'house' },
      { need: 'food', form: 'field', level: 2, expected: 'barn' },
      { need: 'food', form: 'store', level: 2, expected: 'granary' },
      { need: 'trade', form: 'gathering', level: 2, expected: 'market' },
      { need: 'trade', form: 'store', level: 2, expected: 'warehouse' },
      { need: 'transport', form: 'store', level: 2, expected: 'warehouse' },
      { need: 'manufacturing', form: 'workshop', level: 2, expected: 'workshop' },
      { need: 'manufacturing', form: 'works', level: 3, expected: 'factory' },
      { need: 'energy', form: 'workshop', level: 2, expected: 'mill' },
      { need: 'energy', form: 'works', level: 3, expected: 'factory' },
      { need: 'government', form: 'hall', level: 2, expected: 'civic-hall' },
      { need: 'knowledge', form: 'hall', level: 2, expected: 'civic-hall' },
      { need: 'religion', form: 'sanctuary', level: 2, expected: 'shrine' },
      { need: 'security', form: 'tower', level: 2, expected: 'gatehouse' },
      { need: 'security', form: 'hall', level: 2, expected: 'civic-hall' },
      { need: 'water', form: 'works', level: 3, expected: 'factory' },
    ];
    for (const entry of cases) {
      const routed = archetypeForContext({
        role: 'granary', period: 'industrial',
        need: entry.need, form: entry.form, level: entry.level,
        capabilities: INDUSTRIAL_CAPABILITIES,
      });
      expect(routed, `${entry.need}/${entry.form} level ${entry.level}`).toBe(entry.expected);
    }
  });

  it('routes a waterfront freight store to a quay and an inland one to a warehouse', () => {
    const base = { role: 'warehouse' as const, period: 'industrial' as const, need: 'transport' as SettlementNeed, form: 'store' as StructureForm, level: 2 };
    expect(archetypeForContext({ ...base, waterfront: true })).toBe('dock');
    expect(archetypeForContext({ ...base, waterfront: false })).toBe('warehouse');
  });

  it('only reaches a silo once a settlement can build and fill one', () => {
    const base = { role: 'granary' as const, need: 'food' as SettlementNeed, form: 'store' as StructureForm };
    expect(archetypeForContext({ ...base, period: 'industrial', level: 3 })).toBe('silo');
    expect(archetypeForContext({ ...base, period: 'industrial', level: 2 })).toBe('granary');
    expect(archetypeForContext({ ...base, period: 'medieval', level: 3 })).toBe('granary');
  });

  it('only reaches livestock buildings where husbandry is actually practised', () => {
    const base = { role: 'granary' as const, period: 'medieval' as const, need: 'food' as SettlementNeed, form: 'field' as StructureForm, level: 2 };
    // Without husbandry a farmstead is always a barn, on every plot.
    for (let plot = 0; plot < 24; plot += 1) {
      expect(archetypeForContext({ ...base, capabilities: [], seed: `plot-${plot}` })).toBe('barn');
    }
    // With husbandry the farm shows a mix, and the barn stays the commonest building.
    const seen = new Map<string, number>();
    for (let plot = 0; plot < 120; plot += 1) {
      const routed = archetypeForContext({ ...base, capabilities: ['animal-husbandry'], seed: `plot-${plot}` });
      seen.set(routed, (seen.get(routed) ?? 0) + 1);
    }
    expect(new Set(seen.keys())).toEqual(new Set(['barn', 'byre', 'stable']));
    expect(seen.get('barn')!).toBeGreaterThan(seen.get('byre')!);
    expect(seen.get('barn')!).toBeGreaterThan(seen.get('stable')!);
  });

  it('is deterministic for identical authoritative state', () => {
    const context = {
      role: 'granary' as const, period: 'medieval' as const, need: 'food' as SettlementNeed,
      form: 'field' as StructureForm, level: 2, capabilities: ['animal-husbandry'], seed: 'plot-7',
    };
    expect(archetypeForContext(context)).toBe(archetypeForContext(context));
  });

  it('never invents an archetype another subsystem owns', () => {
    // Bridges and perimeter walls are TransportationSystem's and settlement dressing's calls.
    const needs: SettlementNeed[] = ['food', 'housing', 'trade', 'government', 'security', 'religion',
      'knowledge', 'healthcare', 'manufacturing', 'transport', 'energy', 'water', 'memory'];
    const forms: StructureForm[] = ['dwelling', 'field', 'store', 'gathering', 'hall', 'sanctuary', 'tower', 'workshop', 'works', 'marker'];
    for (const need of needs) {
      for (const form of forms) {
        for (const period of ARCHITECTURAL_PERIODS) {
          for (const waterfront of [false, true]) {
            const routed = archetypeForContext({
              role: 'granary', period, need, form, level: 3,
              capabilities: INDUSTRIAL_CAPABILITIES, waterfront, seed: 's',
            });
            expect(SUBSYSTEM_OWNED_ARCHETYPES, `${need}/${form}/${period} invented ${routed}`).not.toContain(routed);
          }
        }
      }
    }
  });

  it('keeps the right structure when its lineage has not begun, instead of substituting another', () => {
    // The fallback this replaces: routing used to demote an archetype whose lineage started later
    // to the role's default and then to `house`, so a primitive-era civic hall rendered as a
    // *house* rather than as the earliest civic hall. The archetype is a statement about what the
    // building is for; it must survive the period being early for it. Presenting the earliest
    // version of itself is the spec resolver's job, checked below.
    const early: { role: BuildingRole; need: SettlementNeed; form: StructureForm; expected: BuildingArchetype }[] = [
      { role: 'hall', need: 'government', form: 'hall', expected: 'civic-hall' },
      { role: 'market', need: 'trade', form: 'gathering', expected: 'market' },
      { role: 'warehouse', need: 'trade', form: 'store', expected: 'warehouse' },
      { role: 'factory', need: 'manufacturing', form: 'works', expected: 'factory' },
      { role: 'gate-tower', need: 'security', form: 'tower', expected: 'gatehouse' },
    ];
    for (const entry of early) {
      const decision = routeArchetype({
        role: entry.role, period: 'neolithic', need: entry.need, form: entry.form, level: 1, capabilities: [],
      });
      expect(decision.archetype, `${entry.role} in neolithic`).toBe(entry.expected);
      expect(decision.archetype).not.toBe('house');
      // Routing reports the mismatch rather than hiding it behind a different building.
      expect(decision.beforeLineage, `${entry.expected} should be flagged early in neolithic`).toBe(true);
    }
  });

  it('resolves every routed archetype to a buildable stage through the production spec path', () => {
    // The guarantee the demoting fallback used to provide, asserted where it now actually lives:
    // `resolveBuildingSpec` lifts the period to the archetype's earliest stage. Routing keeps the
    // identity; the resolver makes it buildable. Between them nothing is ever unbuildable, and
    // nothing is ever silently swapped for a different structure.
    const needs: SettlementNeed[] = ['food', 'housing', 'trade', 'government', 'security', 'religion',
      'knowledge', 'healthcare', 'manufacturing', 'transport', 'energy', 'water', 'memory'];
    const forms: StructureForm[] = ['dwelling', 'field', 'store', 'gathering', 'hall', 'sanctuary', 'tower', 'workshop', 'works', 'marker'];
    for (const need of needs) {
      for (const form of forms) {
        for (const period of ARCHITECTURAL_PERIODS) {
          const routed = archetypeForContext({ role: 'granary', period, need, form, level: 2, capabilities: INDUSTRIAL_CAPABILITIES });
          const spec = resolveBuildingSpec(specContextFor({
            role: 'granary', period, development: response(need, form, PERIOD_DRIVE[period].level),
          }));
          expect(archetypeStageFor(spec.archetype, spec.period), `${need}/${form} in ${period} -> ${spec.archetype}`).toBeDefined();
          expect(BUILDING_ARCHETYPES, `${need}/${form} in ${period}`).toContain(routed);
        }
      }
    }
  });

  it('falls back to a role unmarked reading when there is no response at all', () => {
    // Ambient fabric and founding shelters arrive with no development response.
    expect(archetypeForRole('granary')).toBe('granary');
    expect(archetypeForRole('workshop')).toBe('workshop');
    expect(archetypeForRole('hall')).toBe('civic-hall');
    expect(archetypeForContext({ role: 'granary', period: 'medieval' })).toBe('granary');
    expect(archetypeForContext({ role: 'house', period: 'primitive' as never })).toBe('house');
  });

  it('gives every renderer role an unmarked reading that stays itself in every period', () => {
    // Every role, derived rather than listed, so adding one cannot slip past this.
    for (const role of BUILDING_ROLES) {
      const unmarked = archetypeForRole(role);
      expect(BUILDING_ARCHETYPES, role).toContain(unmarked);
      for (const period of ARCHITECTURAL_PERIODS) {
        // Some functions genuinely do not exist early — there is no neolithic market hall. The
        // contract is that the role keeps resolving to *its own* archetype regardless, and that
        // the spec path then presents the earliest version of it.
        expect(archetypeForContext({ role, period }), `${role} in ${period}`).toBe(unmarked);
        const spec = resolveBuildingSpec(specContextFor({ role, period }));
        expect(archetypeStageFor(spec.archetype, spec.period), `${role} in ${period} -> ${spec.archetype}`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------- production path

describe('Production archetype routing through AssetBuilder', () => {
  it('resolves twelve distinct archetypes on the path GodboxRenderer uses', () => {
    const builder = new AssetBuilder('production-routing');

    // Ten routed purely from authoritative development state, plus the two archetypes their
    // owning subsystems request explicitly. All twelve through one AssetBuilder call path.
    const built: { label: string; expected: BuildingArchetype; mesh: THREE.Object3D }[] = [
      { label: 'house', expected: 'house', mesh: productionAsset({ builder, response: response('housing', 'dwelling', 1, 'timber') }) },
      { label: 'barn', expected: 'barn', mesh: productionAsset({ builder, response: response('food', 'field', 2, 'timber'), seed: 'farm-barn', specialization: 'agriculture' }) },
      { label: 'granary', expected: 'granary', mesh: productionAsset({ builder, response: response('food', 'store', 2) }) },
      { label: 'silo', expected: 'silo', mesh: productionAsset({ builder, response: response('food', 'store', 3, 'metal'), era: 'industrial' }) },
      { label: 'workshop', expected: 'workshop', mesh: productionAsset({ builder, response: response('manufacturing', 'workshop', 2, 'ceramic') }) },
      { label: 'mill', expected: 'mill', mesh: productionAsset({ builder, response: response('energy', 'workshop', 2, 'masonry') }) },
      { label: 'factory', expected: 'factory', mesh: productionAsset({ builder, response: response('manufacturing', 'works', 3, 'metal'), era: 'industrial' }) },
      { label: 'shrine', expected: 'shrine', mesh: productionAsset({ builder, response: response('religion', 'sanctuary', 2) }) },
      { label: 'dock', expected: 'dock', mesh: productionAsset({ builder, response: response('transport', 'store', 2), waterfront: true, seed: 'quay' }) },
      { label: 'stable', expected: 'stable', mesh: productionAsset({ builder, response: response('food', 'field', 2, 'timber'), seed: 'plot-10', specialization: 'agriculture' }) },
      { label: 'bridge', expected: 'bridge', mesh: productionAsset({ builder, response: response('transport', 'store', 2), archetype: 'bridge', seed: 'crossing' }) },
      { label: 'boundary-wall', expected: 'boundary-wall', mesh: productionAsset({ builder, response: response('security', 'hall', 2), archetype: 'boundary-wall', seed: 'perimeter' }) },
    ];

    for (const entry of built) {
      expect(archetypeOf(entry.mesh), `${entry.label} routed wrong`).toBe(entry.expected);
    }
    // All twelve must be genuinely different archetypes, not twelve labels on four buildings.
    expect(new Set(built.map(entry => archetypeOf(entry.mesh))).size).toBe(12);
    builder.dispose();
  });

  it('keeps the renderer role authoritative for placement while routing architecture separately', () => {
    const builder = new AssetBuilder('production-routing-role');
    const farmstead = response('food', 'field', 2, 'timber');
    const role = developmentBuildingRole(farmstead);
    expect(role).toBe('granary');

    const mesh = productionAsset({ builder, response: farmstead, seed: 'farm-role' });
    // Architecture reads 'barn'; the renderer still reports the role placement reserved for.
    expect(archetypeOf(mesh)).toBe('barn');
    expect(mesh.userData['grammarRole']).toBe('granary');
    builder.dispose();
  });

  it('does not share one cached mesh between differently routed structures of one role', () => {
    const builder = new AssetBuilder('production-routing-cache');
    const farmstead = productionAsset({ builder, response: response('food', 'field', 2, 'timber'), seed: 'same-seed' });
    const store = productionAsset({ builder, response: response('food', 'store', 2, 'timber'), seed: 'same-seed' });
    // Both are role 'granary' on the same seed. Before routing read need and form, they were one
    // cached mesh. The farm building may be a barn, byre or stable; the store is always a granary.
    expect(['barn', 'byre', 'stable']).toContain(archetypeOf(farmstead));
    expect(archetypeOf(store)).toBe('granary');
    expect(archetypeOf(farmstead)).not.toBe(archetypeOf(store));
    expect(farmstead).not.toBe(store);
    builder.dispose();
  });

  it('separates an explicitly requested archetype from the routed default in the cache', () => {
    const builder = new AssetBuilder('production-routing-explicit');
    const transport = response('transport', 'store', 2);
    const routed = productionAsset({ builder, response: transport, seed: 'shared' });
    const explicitBridge = productionAsset({ builder, response: transport, seed: 'shared', archetype: 'bridge' });
    expect(archetypeOf(routed)).toBe('warehouse');
    expect(archetypeOf(explicitBridge)).toBe('bridge');
    expect(routed).not.toBe(explicitBridge);
    builder.dispose();
  });

  it('publishes the resolved construction system alongside the archetype', () => {
    const builder = new AssetBuilder('production-routing-publish');
    const mesh = productionAsset({ builder, response: response('manufacturing', 'works', 3, 'metal'), era: 'industrial' });
    expect(mesh.userData['architectureArchetype']).toBe('factory');
    expect(typeof mesh.userData['structuralFamily']).toBe('string');
    expect(typeof mesh.userData['architecturePeriod']).toBe('string');
    expect(typeof mesh.userData['wallAssembly']).toBe('string');
    expect(typeof mesh.userData['foundationStyle']).toBe('string');
    const materials = mesh.userData['architectureMaterials'] as Record<string, string>;
    expect(materials['wall']).toBeDefined();
    expect(materials['roofCovering']).toBeDefined();
    builder.dispose();
  });

  it('routes every archetype the library declares to its own declared role consistently', () => {
    // A guard against the library and the routing table drifting apart: whatever an archetype
    // says it presents as must be a role the renderer actually has.
    const roles = new Set(['shelter', 'lean-to', 'ritual-marker', 'store-pit', 'hut', 'house',
      'compound', 'granary', 'shrine', 'market', 'workshop', 'hall', 'warehouse', 'gate-tower',
      'factory', 'foundry', 'research', 'energy']);
    for (const archetype of BUILDING_ARCHETYPES) {
      expect(roles, `${archetype} declares an unknown role`).toContain(buildingArchetype(archetype).role);
    }
  });
});
