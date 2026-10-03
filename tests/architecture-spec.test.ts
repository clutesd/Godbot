import { describe, expect, it } from 'vitest';
import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, StructureMaterial } from '../src/sim/development/types';
import type { MaterialKind } from '../src/sim/resources/MaterialEconomy';
import type { Era } from '../src/render/materials/MaterialPalette';

import {
  ARCHITECTURAL_PERIODS,
  architecturalPeriod,
  eraPeriodCeiling,
  eraPeriodFloor,
  periodRank,
  type ArchitecturalPeriod,
} from '../src/render/architecture/ArchitecturalPeriod';
import {
  ARCHITECTURAL_MATERIALS,
  MATERIAL_LIBRARY,
  MATERIAL_ROLES,
  SURFACE_PROGRAMS,
  architecturalMaterial,
  materialAvailable,
  materialHasRole,
  materialsForRole,
  materialsFromKind,
  climateSuitability,
  type ArchitecturalMaterialId,
  type ClimateZone,
} from '../src/render/architecture/MaterialLibrary';
import {
  STRUCTURAL_FAMILIES,
  familyCustom,
  familyPreferences,
  structuralFamily,
} from '../src/render/architecture/StructuralFamily';
import {
  ARCHETYPE_LIBRARY,
  BUILDING_ARCHETYPES,
  archetypeStageFor,
  type BuildingArchetype,
} from '../src/render/architecture/BuildingArchetype';
import {
  buildingSpecSignature,
  climateZoneFrom,
  resolveBuildingSpec,
  validateBuildingSpec,
  type BuildingSpecContext,
  type MaterialAssignment,
} from '../src/render/architecture/BuildingSpec';
import { deriveMaterialEvidence, materialsForStructureClass } from '../src/render/architecture/MaterialSourcing';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

const ERAS: Era[] = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'];
const ZONES: ClimateZone[] = ['arid', 'temperate', 'wet', 'cold', 'snowy', 'tropical'];

/** Climate inputs that resolve to each zone, so tests can drive zones through real fields. */
const ZONE_INPUT: Record<ClimateZone, { temperature: number; moisture: number }> = {
  arid: { temperature: 0.82, moisture: 0.2 },
  temperate: { temperature: 0.5, moisture: 0.5 },
  wet: { temperature: 0.5, moisture: 0.82 },
  cold: { temperature: 0.18, moisture: 0.3 },
  snowy: { temperature: 0.14, moisture: 0.7 },
  tropical: { temperature: 0.84, moisture: 0.7 },
};

/** Every capability the knowledge catalog can report, so period/material gates open fully. */
const ALL_CAPABILITIES = [
  'fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'material-testing',
  'high-temperature-ceramics', 'metal-smelting', 'iron-working', 'mechanical-power',
  'precision-tools', 'standardized-parts', 'rotary-machinery', 'thermodynamics',
  'industrial-chemistry', 'precision-manufacturing', 'electromagnetism', 'electrical-generation',
  'electric-grid', 'rail-transport', 'automation', 'computation',
];

function development(overrides: Partial<DevelopmentResponse> = {}): DevelopmentResponse {
  return {
    need: 'housing',
    form: 'dwelling',
    name: 'test-response',
    level: 2,
    material: 'timber',
    cultureId: 'test-culture',
    style: CULTURE,
    services: {},
    reasons: [],
    capabilities: ALL_CAPABILITIES,
    cost: { food: 0, wood: 10, minerals: 0, goods: 0, wealth: 0 },
    labor: 12,
    ...overrides,
  };
}

function context(overrides: Partial<BuildingSpecContext> = {}): BuildingSpecContext {
  return {
    role: 'house',
    era: 'preIndustrial',
    seed: 'plot-1',
    culture: { materialBias: 'mixed', roofLanguage: 'gable-geometric', trimDensity: 0.5 },
    development: development(),
    prosperity: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------- library

describe('Architectural material library', () => {
  it('gives every material at least one role it can serve', () => {
    for (const id of ARCHITECTURAL_MATERIALS) {
      expect(MATERIAL_LIBRARY[id].roles.length, id).toBeGreaterThan(0);
      for (const role of MATERIAL_LIBRARY[id].roles) {
        expect(MATERIAL_ROLES, `${id} declares unknown role ${role}`).toContain(role);
      }
    }
  });

  it('keeps every id, label and metadata range self-consistent', () => {
    for (const id of ARCHITECTURAL_MATERIALS) {
      const definition = MATERIAL_LIBRARY[id];
      expect(definition.id).toBe(id);
      expect(definition.label.length).toBeGreaterThan(0);
      for (const [name, value] of [
        ['durability', definition.durability],
        ['fireResistance', definition.fireResistance],
        ['labour', definition.labour],
        ['cost', definition.cost],
        ['weathering.rate', definition.weathering.rate],
        ['roughness', definition.appearance.roughness],
        ['metalness', definition.appearance.metalness],
        ['transparency', definition.appearance.transparency],
      ] as const) {
        expect(value, `${id}.${name}`).toBeGreaterThanOrEqual(0);
        expect(value, `${id}.${name}`).toBeLessThanOrEqual(1);
      }
      expect(definition.appearance.textureScale, id).toBeGreaterThan(0);
      expect(definition.structure.maxStoreys, id).toBeGreaterThanOrEqual(1);
      for (const value of Object.values(definition.climate)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers the whole construction vocabulary the architecture asks for', () => {
    // These are the real material names a builder would use, and the resolver must be able to
    // reach every one of them. A missing entry here is a hole in the architectural language.
    const expected: ArchitecturalMaterialId[] = [
      'fieldstone', 'rubble-masonry', 'dressed-stone', 'ashlar', 'limestone', 'sandstone', 'granite',
      'mud-brick', 'adobe', 'wattle-and-daub', 'logs', 'rough-hewn-timber', 'heavy-timber',
      'sawn-lumber', 'finished-wood', 'thatch', 'wood-shingle', 'clay-tile', 'terracotta', 'slate',
      'fired-brick', 'buff-brick', 'plaster', 'wrought-iron', 'cast-iron', 'steel',
      'structural-steel', 'corrugated-metal', 'sheet-metal', 'concrete', 'reinforced-concrete',
      'glass', 'curtain-glass', 'copper', 'aluminium', 'asphalt-membrane',
    ];
    for (const id of expected) expect(ARCHITECTURAL_MATERIALS).toContain(id);
  });

  it('shares surface programs across materials so GPU programs stay far below material count', () => {
    expect(SURFACE_PROGRAMS.length).toBeLessThan(ARCHITECTURAL_MATERIALS.length);
    expect(new Set(SURFACE_PROGRAMS).size).toBe(SURFACE_PROGRAMS.length);
  });

  it('offers at least one buildable material for every structural role in the first period', () => {
    // Without this the resolver could not produce a neolithic building at all.
    for (const role of ['foundation', 'frame', 'wall', 'infill', 'roof-structure', 'roof-covering', 'trim'] as const) {
      const available = materialsForRole(role)
        .filter(id => materialAvailable(id, { period: 'neolithic', capabilities: [] }));
      expect(available.length, `no neolithic material for ${role}`).toBeGreaterThan(0);
    }
  });

  it('never claims a capability-gated material is available without the capability', () => {
    for (const id of ARCHITECTURAL_MATERIALS) {
      const definition = MATERIAL_LIBRARY[id];
      if (definition.requiresCapabilities.length === 0) continue;
      expect(materialAvailable(id, { period: 'contemporary', capabilities: [] }), id).toBe(false);
      expect(materialAvailable(id, { period: 'contemporary', capabilities: ALL_CAPABILITIES }), id).toBe(true);
    }
  });

  it('indexes simulation material kinds back to the materials they become', () => {
    expect(materialsFromKind('brick')).toContain('fired-brick');
    expect(materialsFromKind('timber')).toContain('rough-hewn-timber');
    expect(materialsFromKind('steel')).toContain('structural-steel');
    expect(materialsFromKind('clay')).toContain('mud-brick');
    expect(materialsFromKind('plant-fiber')).toContain('thatch');
  });
});

// ---------------------------------------------------------------------------- period

describe('Architectural period', () => {
  it('stays inside the band its era allows, whatever the development level', () => {
    for (const era of ERAS) {
      const floor = periodRank(eraPeriodFloor(era));
      const ceiling = periodRank(eraPeriodCeiling(era));
      for (const level of [1, 2, 3]) {
        const period = architecturalPeriod({ era, developmentLevel: level, capabilities: ALL_CAPABILITIES });
        expect(periodRank(period), `${era} level ${level}`).toBeGreaterThanOrEqual(floor);
        expect(periodRank(period), `${era} level ${level}`).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('never regresses as development level rises', () => {
    for (const era of ERAS) {
      const ranks = [1, 2, 3].map(level => periodRank(architecturalPeriod({ era, developmentLevel: level })));
      expect(ranks[0]!).toBeLessThanOrEqual(ranks[1]!);
      expect(ranks[1]!).toBeLessThanOrEqual(ranks[2]!);
    }
  });

  it('lets practised capability raise the period but never past the era ceiling', () => {
    const withoutCapability = architecturalPeriod({ era: 'village', developmentLevel: 1 });
    const withCapability = architecturalPeriod({ era: 'village', developmentLevel: 1, capabilities: ['iron-working'] });
    expect(periodRank(withCapability)).toBeGreaterThanOrEqual(periodRank(withoutCapability));

    const ceiling = eraPeriodCeiling('village');
    const overreaching = architecturalPeriod({ era: 'village', developmentLevel: 3, capabilities: ALL_CAPABILITIES });
    expect(periodRank(overreaching)).toBeLessThanOrEqual(periodRank(ceiling));
  });

  it('is deterministic', () => {
    for (const era of ERAS) {
      const a = architecturalPeriod({ era, developmentLevel: 2, capabilities: ['pottery-firing'] });
      const b = architecturalPeriod({ era, developmentLevel: 2, capabilities: ['pottery-firing'] });
      expect(a).toBe(b);
    }
  });
});

// ---------------------------------------------------------------------------- families

describe('Structural families', () => {
  it('declares coherent geometric metrics for every family', () => {
    for (const id of STRUCTURAL_FAMILIES) {
      const definition = structuralFamily(id);
      expect(definition.id).toBe(id);
      expect(definition.wallThickness, id).toBeGreaterThan(0);
      expect(definition.baySpacing, id).toBeGreaterThan(0);
      expect(definition.maxRoofSpan, id).toBeGreaterThan(0);
      expect(definition.maxStoreys, id).toBeGreaterThanOrEqual(1);
      expect(definition.frameExposure, id).toBeGreaterThanOrEqual(0);
      expect(definition.frameExposure, id).toBeLessThanOrEqual(1);
      expect(periodRank(definition.customaryUntil), id).toBeGreaterThanOrEqual(periodRank(definition.earliestPeriod));
    }
  });

  it('only prefers materials that can actually serve the role it asks for', () => {
    for (const id of STRUCTURAL_FAMILIES) {
      for (const role of MATERIAL_ROLES) {
        for (const material of familyPreferences(id, role)) {
          expect(materialHasRole(material, role), `${id} wants ${material} for ${role}`).toBe(true);
        }
      }
    }
  });

  it('can build its own structural roles in its own earliest period', () => {
    // A family must be buildable the moment it appears, or it can never be selected.
    for (const id of STRUCTURAL_FAMILIES) {
      const definition = structuralFamily(id);
      for (const role of ['wall', 'frame', 'roof-covering'] as const) {
        const buildable = familyPreferences(id, role)
          .some(material => materialAvailable(material, { period: definition.earliestPeriod, capabilities: ALL_CAPABILITIES }));
        expect(buildable, `${id} has no buildable ${role} in ${definition.earliestPeriod}`).toBe(true);
      }
    }
  });

  it('separates timber, masonry and steel ways of building on real metrics', () => {
    const timber = structuralFamily('timber-frame');
    const stone = structuralFamily('stone-masonry');
    const steel = structuralFamily('steel-industrial-frame');

    // Masonry is thick and closed; timber is thin and open; steel spans far beyond both.
    expect(stone.wallThickness).toBeGreaterThan(timber.wallThickness * 2);
    expect(timber.frameExposure).toBeGreaterThan(stone.frameExposure * 2);
    expect(steel.maxRoofSpan).toBeGreaterThan(timber.maxRoofSpan * 2);
    expect(steel.baySpacing).toBeGreaterThan(stone.baySpacing * 1.5);
    expect(steel.openingWidth).toBeGreaterThan(stone.openingWidth * 2);
  });

  it('decays out of fashion without ever becoming impossible for vernacular families', () => {
    expect(familyCustom('timber-frame', 'medieval')).toBe(1);
    expect(familyCustom('steel-industrial-frame', 'medieval')).toBe(0);
    // A log barn in an industrial valley is unusual, not impossible.
    expect(familyCustom('log-construction', 'contemporary')).toBeGreaterThan(0);
    expect(familyCustom('log-construction', 'contemporary')).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------- archetypes

describe('Building archetypes', () => {
  it('gives every archetype a non-empty lineage of coherent stages', () => {
    for (const id of BUILDING_ARCHETYPES) {
      const definition = ARCHETYPE_LIBRARY[id];
      const stages = Object.values(definition.lineage);
      expect(stages.length, id).toBeGreaterThan(0);
      for (const stage of stages) {
        expect(stage!.name.length, id).toBeGreaterThan(0);
        expect(stage!.families.length, `${id}/${stage!.name}`).toBeGreaterThan(0);
        expect(stage!.width, id).toBeGreaterThan(0);
        expect(stage!.depth, id).toBeGreaterThan(0);
        expect(stage!.storeyHeight, id).toBeGreaterThan(0);
        expect(stage!.floors[0]!).toBeGreaterThanOrEqual(1);
        expect(stage!.floors[1]!).toBeGreaterThanOrEqual(stage!.floors[0]!);
        expect(stage!.annexes[1]!).toBeGreaterThanOrEqual(stage!.annexes[0]!);
      }
    }
  });

  it('only proposes families that exist by the stage that proposes them', () => {
    for (const id of BUILDING_ARCHETYPES) {
      const lineage = ARCHETYPE_LIBRARY[id].lineage;
      for (const period of ARCHITECTURAL_PERIODS) {
        const stage = lineage[period];
        if (!stage) continue;
        const usable = stage.families.filter(family => periodRank(structuralFamily(family).earliestPeriod) <= periodRank(period));
        expect(usable.length, `${id} in ${period} proposes no family that exists yet`).toBeGreaterThan(0);
      }
    }
  });

  it('inherits the most recent earlier stage for a period with no entry of its own', () => {
    // The barn lineage has no `classical`-to-`medieval` gap, so use an archetype that does.
    const silo = archetypeStageFor('silo', 'contemporary');
    expect(silo?.definedIn).toBe('modern');
    expect(silo?.periodsOld).toBe(1);
    expect(archetypeStageFor('silo', 'medieval')).toBeUndefined();
  });

  it('makes the same function visibly evolve through history', () => {
    const names = ARCHITECTURAL_PERIODS
      .map(period => archetypeStageFor('barn', period)?.stage.name)
      .filter((name): name is string => name !== undefined);
    // A barn is a different building in every period of its lineage.
    expect(new Set(names).size).toBeGreaterThanOrEqual(7);
    expect(names[0]).toContain('Byre');
    expect(names).toContain('High-roof threshing barn');
    expect(names).toContain('Monitor-roof barn');
  });
});

// ---------------------------------------------------------------------------- climate

describe('Climate zoning', () => {
  it('derives each zone from the settlement cell fields it was given', () => {
    for (const zone of ZONES) {
      expect(climateZoneFrom(ZONE_INPUT[zone])).toBe(zone);
    }
  });

  it('falls back to biome and then to the legacy signal', () => {
    expect(climateZoneFrom({ biome: 'dryland' })).toBe('arid');
    expect(climateZoneFrom({ biome: 'wetland' })).toBe('wet');
    expect(climateZoneFrom({ biome: 'mountain' })).toBe('snowy');
    expect(climateZoneFrom({ signal: 0.8 })).toBe('arid');
    expect(climateZoneFrom({ signal: -0.8 })).toBe('cold');
    expect(climateZoneFrom(undefined)).toBe('temperate');
  });
});

// ---------------------------------------------------------------------------- resolver

describe('Building spec resolver', () => {
  it('resolves identically for identical context', () => {
    for (const era of ERAS) {
      const a = resolveBuildingSpec(context({ era }));
      const b = resolveBuildingSpec(context({ era }));
      expect(buildingSpecSignature(a)).toBe(buildingSpecSignature(b));
      expect(a).toEqual(b);
    }
  });

  it('varies between plots so a street is not one repeated building', () => {
    const a = resolveBuildingSpec(context({ seed: 'plot-1' }));
    const b = resolveBuildingSpec(context({ seed: 'plot-2' }));
    expect(buildingSpecSignature(a)).not.toBe(buildingSpecSignature(b));
  });

  it('produces no architectural violations anywhere in the full matrix', () => {
    // The real contract: every combination of function, era, climate and culture the simulation
    // can present must resolve to a building that is not absurd.
    const biases = ['wood', 'stone', 'clay', 'metal', 'mixed'] as const;
    const materials: StructureMaterial[] = ['earth', 'timber', 'masonry', 'ceramic', 'metal'];
    let checked = 0;

    for (const archetype of BUILDING_ARCHETYPES) {
      for (const era of ERAS) {
        for (const zone of ZONES) {
          for (let index = 0; index < biases.length; index += 1) {
            const bias = biases[index]!;
            const material = materials[index % materials.length]!;
            const spec = resolveBuildingSpec(context({
              archetype,
              era,
              seed: `${archetype}:${era}:${zone}:${bias}`,
              culture: { materialBias: bias, roofLanguage: 'gable-geometric', trimDensity: 0.5 },
              climate: ZONE_INPUT[zone],
              development: development({ material, level: (index % 3) + 1 }),
              prosperity: 0.2 + (index % 4) * 0.25,
            }));
            const violations = validateBuildingSpec(spec, ALL_CAPABILITIES);
            expect(
              violations,
              `${archetype}/${era}/${zone}/${bias}: ${violations.map(v => `${v.code} ${v.detail}`).join('; ')}`,
            ).toEqual([]);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(BUILDING_ARCHETYPES.length * ERAS.length * ZONES.length * biases.length);
  });

  it('never selects a material or family before its period', () => {
    for (const archetype of BUILDING_ARCHETYPES) {
      for (const era of ERAS) {
        const spec = resolveBuildingSpec(context({ archetype, era, seed: `${archetype}:${era}` }));
        expect(periodRank(structuralFamily(spec.family).earliestPeriod)).toBeLessThanOrEqual(periodRank(spec.period));
        for (const slot of Object.keys(spec.materials) as (keyof MaterialAssignment)[]) {
          const id = spec.materials[slot];
          if (!id) continue;
          expect(
            periodRank(architecturalMaterial(id).earliestPeriod),
            `${archetype}/${era} chose ${id} for ${slot} in ${spec.period}`,
          ).toBeLessThanOrEqual(periodRank(spec.period));
        }
      }
    }
  });

  it('keeps structural fabric consistent with the simulation material class', () => {
    // A structure the simulation calls timber must not come back with a brick wall — but only
    // where that class can actually be walled in this period and climate. A village has no
    // metal walls available at all, and the resolver is right to substitute rather than invent
    // corrugated iron centuries early.
    for (const material of ['earth', 'timber', 'masonry', 'ceramic', 'metal'] as StructureMaterial[]) {
      for (const era of ['village', 'preIndustrial', 'industrial', 'advanced'] as Era[]) {
        const spec = resolveBuildingSpec(context({
          era,
          seed: `class:${material}:${era}`,
          development: development({ material }),
        }));
        const classWalls = materialsForStructureClass(material).filter(id =>
          materialHasRole(id, 'wall')
          && materialAvailable(id, { period: spec.period, capabilities: ALL_CAPABILITIES })
          && climateSuitability(id, spec.climate.zone) >= 0.2);
        if (classWalls.length === 0) continue;
        expect(
          classWalls,
          `${material} in ${era} (period ${spec.period}) produced ${spec.materials.wall}`,
        ).toContain(spec.materials.wall);
      }
    }
  });

  it('substitutes honestly when a material class cannot be walled in the period at all', () => {
    // A village told to build in metal cannot have metal walls. It must fall back to something
    // it could actually build, not to corrugated iron a thousand years early.
    const spec = resolveBuildingSpec(context({
      era: 'village',
      seed: 'impossible-class',
      development: development({ material: 'metal' }),
    }));
    expect(validateBuildingSpec(spec, ALL_CAPABILITIES)).toEqual([]);
    expect(periodRank(architecturalMaterial(spec.materials.wall).earliestPeriod))
      .toBeLessThanOrEqual(periodRank(spec.period));
  });

  it('derives fabric from the materials a project actually consumed', () => {
    const spent: Partial<Record<MaterialKind, number>> = { brick: 90, lumber: 10 };
    const brickSpec = resolveBuildingSpec(context({
      era: 'industrial',
      seed: 'evidence',
      development: development({ material: 'ceramic', level: 3 }),
      project: { plotId: 'p', response: development({ material: 'ceramic' }), action: 'founded', startedMonth: 0, progress: 1, spent: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, materialSpent: spent } as never,
    }));
    expect(brickSpec.provenance.evidenceGrade).toBe('spent');
    expect(['fired-brick', 'buff-brick']).toContain(brickSpec.materials.wall);

    const timberSpec = resolveBuildingSpec(context({
      era: 'industrial',
      seed: 'evidence',
      development: development({ material: 'timber', level: 3 }),
      project: { plotId: 'p', response: development({ material: 'timber' }), action: 'founded', startedMonth: 0, progress: 1, spent: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, materialSpent: { timber: 80, lumber: 40 } } as never,
    }));
    expect(architecturalMaterial(timberSpec.materials.wall).family).toMatch(/timber|earth/);
    expect(buildingSpecSignature(brickSpec)).not.toBe(buildingSpecSignature(timberSpec));
  });

  it('grades evidence from the strongest record available', () => {
    const response = development({ material: 'ceramic', materialCost: { brick: 40 } });
    expect(deriveMaterialEvidence({ response }).bestGrade).toBe('billed');
    expect(deriveMaterialEvidence({ response: development({ material: 'timber' }) }).bestGrade).toBe('class');
    expect(deriveMaterialEvidence({ response: development(), stock: { stone: 20 } }).bestGrade).toBe('stocked');
  });

  it('answers climate with geometry, not colour', () => {
    const base = { archetype: 'house' as BuildingArchetype, era: 'preIndustrial' as Era, seed: 'climate' };
    const snowy = resolveBuildingSpec(context({ ...base, climate: ZONE_INPUT.snowy }));
    const arid = resolveBuildingSpec(context({ ...base, climate: ZONE_INPUT.arid }));
    const wet = resolveBuildingSpec(context({ ...base, climate: ZONE_INPUT.wet }));

    // Snow sheds steeply; desert roofs go flat and usable.
    expect(snowy.roof.pitch).toBeGreaterThan(arid.roof.pitch * 1.5);
    // Arid building masses up against the diurnal swing.
    expect(arid.wallThickness).toBeGreaterThan(snowy.wallThickness);
    // Wet climates throw water clear of the wall.
    expect(wet.roof.overhang).toBeGreaterThan(arid.roof.overhang);
    // Cold and hot both close down openings relative to temperate.
    const temperate = resolveBuildingSpec(context({ ...base, climate: ZONE_INPUT.temperate }));
    expect(snowy.openings.density).toBeLessThan(temperate.openings.density);
    expect(arid.openings.density).toBeLessThan(temperate.openings.density);
    expect(arid.climate.courtyard).toBe(true);
    expect(snowy.climate.shelteredEntry).toBe(true);
  });

  it('makes the same function materially distinct across eras', () => {
    const early = resolveBuildingSpec(context({
      archetype: 'barn', era: 'village', seed: 'barn',
      development: development({ material: 'timber', level: 2 }),
    }));
    const industrial = resolveBuildingSpec(context({
      archetype: 'barn', era: 'industrial', seed: 'barn',
      development: development({ material: 'metal', level: 3 }),
    }));

    expect(early.family).not.toBe(industrial.family);
    expect(early.silhouette).not.toBe(industrial.silhouette);
    expect(industrial.baySpacing).toBeGreaterThan(early.baySpacing);
    expect(industrial.openings.width).toBeGreaterThan(early.openings.width);
    expect(early.provenance.stageName).not.toBe(industrial.provenance.stageName);
  });

  it('separates a timber barn, a masonry barn and a steel barn in geometry, not texture', () => {
    const build = (material: StructureMaterial, era: Era) => resolveBuildingSpec(context({
      archetype: 'barn', era, seed: 'barn-compare',
      development: development({ material, level: 3 }),
    }));
    const timber = build('timber', 'preIndustrial');
    const masonry = build('masonry', 'preIndustrial');
    const steel = build('metal', 'advanced');

    expect(new Set([timber.family, masonry.family, steel.family]).size).toBe(3);
    expect(masonry.wallThickness).toBeGreaterThan(timber.wallThickness);
    expect(steel.wallThickness).toBeLessThan(masonry.wallThickness);
    expect(steel.roof.span / steel.supportDensity).not.toBeCloseTo(timber.roof.span / timber.supportDensity, 2);
    expect(timber.frameExposure).toBeGreaterThan(masonry.frameExposure);
  });

  it('never exceeds the storeys its load-bearing element can carry', () => {
    // Which element carries the storeys depends on how the wall is assembled. In a load-bearing
    // wall it is the wall itself; in a framed building the cladding carries nothing, so a
    // steel-framed silo is limited by its frame and not by the corrugated sheet hung on it.
    const loadBearing = ['coursed-masonry', 'load-bearing-brick', 'monolithic-earth', 'stacked-log', 'hide-and-brush'];
    for (const archetype of BUILDING_ARCHETYPES) {
      for (const era of ERAS) {
        const spec = resolveBuildingSpec(context({ archetype, era, seed: `storeys:${archetype}:${era}`, development: development({ level: 3 }) }));
        expect(spec.floors).toBeLessThanOrEqual(structuralFamily(spec.family).maxStoreys);
        const carrier = loadBearing.includes(spec.wallAssembly) ? spec.materials.wall : spec.materials.frame;
        expect(
          spec.floors,
          `${archetype}/${era}: ${spec.floors} storeys on ${carrier} (${spec.wallAssembly})`,
        ).toBeLessThanOrEqual(architecturalMaterial(carrier).structure.maxStoreys);
      }
    }
  });

  it('lets a framed structure rise above what its cladding could ever carry', () => {
    // The regression this guards: a steel-framed silo clamped to corrugated iron's single
    // storey, which made every clad-frame structure squat.
    const silo = resolveBuildingSpec(context({
      archetype: 'silo', era: 'advanced', seed: 'silo-height',
      development: development({ material: 'metal', level: 3 }),
    }));
    expect(silo.wallAssembly).toBe('clad-frame');
    expect(architecturalMaterial(silo.materials.wall).structure.maxStoreys).toBe(1);
    expect(silo.floors).toBeGreaterThan(1);
    expect(validateBuildingSpec(silo, ALL_CAPABILITIES)).toEqual([]);
  });

  it('raises support density whenever the roof outspans its structure', () => {
    for (const archetype of BUILDING_ARCHETYPES) {
      const spec = resolveBuildingSpec(context({ archetype, era: 'industrial', seed: `span:${archetype}` }));
      if (!spec.roof.intermediateSupport) continue;
      expect(spec.supportDensity).toBeGreaterThan(structuralFamily(spec.family).supportDensity);
    }
  });

  it('lets poor settlements build only what they can afford', () => {
    const poor = resolveBuildingSpec(context({
      archetype: 'civic-hall', era: 'preIndustrial', seed: 'wealth', prosperity: 0.02,
      development: development({ need: 'government', form: 'hall', material: 'masonry', level: 1 }),
    }));
    const rich = resolveBuildingSpec(context({
      archetype: 'civic-hall', era: 'preIndustrial', seed: 'wealth', prosperity: 1,
      development: development({ need: 'government', form: 'hall', material: 'masonry', level: 3 }),
    }));
    const burden = (id: ArchitecturalMaterialId) => architecturalMaterial(id).labour + architecturalMaterial(id).cost;
    expect(burden(rich.materials.wall)).toBeGreaterThan(burden(poor.materials.wall));
  });

  it('reads age from recorded history rather than inventing it', () => {
    const fresh = resolveBuildingSpec(context({ seed: 'age' }));
    expect(fresh.age.additions).toBe(0);
    expect(['new', 'sound']).toContain(fresh.age.condition);

    const aged = resolveBuildingSpec(context({
      seed: 'age',
      heritage: {
        originNeed: 'housing', originForm: 'dwelling', originLevel: 1, originMaterial: 'timber',
        originCultureId: 'test-culture', legacyNeed: 'housing', legacyForm: 'dwelling',
        legacyMaterial: 'timber', legacyCultureId: 'test-culture',
        transitionCount: 6, upgradeCount: 3, repurposed: false, reused: true, survivedRuin: true,
        cultureShift: false, materialShift: false, needShift: false,
        ceremonialMemory: false, industrialMemory: false, preservation: 0.3, fingerprint: 'f',
      },
    }));
    expect(aged.age.additions).toBe(3);
    expect(aged.age.wear).toBeGreaterThan(fresh.age.wear);
    expect(aged.age.damage).toBeGreaterThan(0);
    expect(aged.annexes).toBeGreaterThanOrEqual(fresh.annexes);
  });

  it('records which original material survives when history shows a real material shift', () => {
    const spec = resolveBuildingSpec(context({
      era: 'industrial',
      seed: 'shift',
      development: development({ material: 'ceramic' }),
      heritage: {
        originNeed: 'housing', originForm: 'dwelling', originLevel: 1, originMaterial: 'timber',
        originCultureId: 'c', legacyNeed: 'housing', legacyForm: 'dwelling',
        legacyMaterial: 'timber', legacyCultureId: 'c',
        transitionCount: 3, upgradeCount: 1, repurposed: false, reused: false, survivedRuin: false,
        cultureShift: false, materialShift: true, needShift: false,
        ceremonialMemory: false, industrialMemory: false, preservation: 0.4, fingerprint: 'f',
      },
    }));
    expect(spec.age.originalMaterial).toBeDefined();
    expect(architecturalMaterial(spec.age.originalMaterial!).structureMaterial).toBe('timber');
  });

  it('carries the archetype function as equipment, extended by specialization', () => {
    const plain = resolveBuildingSpec(context({ archetype: 'barn', era: 'industrial', seed: 'equip' }));
    const mining = resolveBuildingSpec(context({
      archetype: 'barn', era: 'industrial', seed: 'equip',
      specialization: 'mining', development: development({ level: 3 }),
    }));
    expect(plain.equipment).toContain('hay-loft');
    expect(mining.equipment).toContain('rail-track');
    // Specialization only ever adds; it never strips the archetype's own fittings.
    for (const item of plain.equipment) expect(mining.equipment).toContain(item);
  });

  it('keeps the signature sensitive to every visible decision and nothing else', () => {
    const base = resolveBuildingSpec(context({ seed: 'sig' }));
    const sameSpec = resolveBuildingSpec(context({ seed: 'sig' }));
    expect(buildingSpecSignature(base)).toBe(buildingSpecSignature(sameSpec));

    const colderSignature = buildingSpecSignature(resolveBuildingSpec(context({ seed: 'sig', climate: ZONE_INPUT.snowy })));
    expect(colderSignature).not.toBe(buildingSpecSignature(base));
  });

  it('flags absurd combinations instead of silently accepting them', () => {
    // Hand-built nonsense: thatch walls on a contemporary tower, in snow.
    const spec = resolveBuildingSpec(context({ archetype: 'house', era: 'advanced', seed: 'absurd' }));
    const broken = {
      ...spec,
      period: 'neolithic' as ArchitecturalPeriod,
      floors: 40,
      materials: { ...spec.materials, wall: 'curtain-glass' as ArchitecturalMaterialId },
    };
    const violations = validateBuildingSpec(broken, []);
    const codes = violations.map(violation => violation.code);
    expect(codes).toContain('material-before-period');
    expect(codes).toContain('storeys-exceed-wall');
    expect(violations.length).toBeGreaterThan(2);
  });
});
