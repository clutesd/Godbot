import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, StructureMaterial } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { MaterialPalette, type Era } from '../src/render/materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { resolveBuildingGrammar, type BuildingRole } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE, composeBuilding, type BuildStage } from '../src/render/assets/BuildingComposer';
import { resolveBuildingSpec, buildingSpecSignature, type BuildingSpec, type BuildingSpecContext } from '../src/render/architecture/BuildingSpec';
import { applySpecToGrammar } from '../src/render/architecture/SpecGrammarBridge';
import { architecturalMaterial, type ArchitecturalMaterialId } from '../src/render/architecture/MaterialLibrary';
import type { BuildingArchetype } from '../src/render/architecture/BuildingArchetype';
import { CONSTRUCTION_STAGE_SEQUENCE } from '../src/render/construction/ConstructionVisualGrammar';
import { PERIOD_DRIVE, periodRank } from '../src/render/architecture/ArchitecturalPeriod';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

/**
 * Capabilities a settlement of each era would plausibly be practising.
 *
 * Handing every era the full catalogue would let a neolithic hamlet roof itself in sheet metal,
 * and would make every assertion about historical progression vacuous.
 */
const ERA_CAPABILITIES: Record<Era, string[]> = {
  primitive: ['fire-control'],
  early: ['fire-control', 'stone-composites'],
  village: ['fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'metal-smelting'],
  preIndustrial: ['fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'metal-smelting',
    'material-testing', 'iron-working', 'high-temperature-ceramics', 'mechanical-power'],
  industrial: ['fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'metal-smelting',
    'material-testing', 'iron-working', 'high-temperature-ceramics', 'mechanical-power',
    'precision-tools', 'standardized-parts', 'rotary-machinery', 'thermodynamics',
    'industrial-chemistry'],
  advanced: ['fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'metal-smelting',
    'material-testing', 'iron-working', 'high-temperature-ceramics', 'mechanical-power',
    'precision-tools', 'standardized-parts', 'rotary-machinery', 'thermodynamics',
    'industrial-chemistry', 'precision-manufacturing', 'electrical-generation'],
};

/** The material class a settlement of each era would typically be building in. */
const ERA_MATERIAL: Record<Era, StructureMaterial> = {
  primitive: 'earth',
  early: 'timber',
  village: 'timber',
  preIndustrial: 'masonry',
  industrial: 'ceramic',
  advanced: 'metal',
};

const CLIMATE = {
  temperate: { temperature: 0.5, moisture: 0.5 },
  arid: { temperature: 0.82, moisture: 0.2 },
  snowy: { temperature: 0.14, moisture: 0.7 },
  wet: { temperature: 0.5, moisture: 0.82 },
};

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
    capabilities: ERA_CAPABILITIES.industrial,
    cost: { food: 0, wood: 10, minerals: 0, goods: 0, wealth: 0 },
    labor: 12,
    ...overrides,
  };
}

function profile() {
  return CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
}

/** Resolve a spec and the grammar it drives, exactly as AssetBuilder does. */
function resolve(options: {
  archetype?: BuildingArchetype;
  role: BuildingRole;
  era: Era;
  seed?: string;
  material?: StructureMaterial;
  level?: number;
  climate?: { temperature: number; moisture: number };
  prosperity?: number;
  stage?: BuildStage;
  capabilities?: string[];
}): { spec: BuildingSpec; grammar: ReturnType<typeof resolveBuildingGrammar> } {
  const styleProfile = profile();
  const seed = options.seed ?? `${options.role}:${options.era}`;
  const response = development({
    material: options.material ?? 'timber',
    level: options.level ?? 2,
    capabilities: options.capabilities ?? ERA_CAPABILITIES[options.era],
  });
  const context: BuildingSpecContext = {
    archetype: options.archetype,
    role: options.role,
    era: options.era,
    seed,
    culture: {
      materialBias: styleProfile.materialBias,
      roofLanguage: styleProfile.roofLanguage,
      trimDensity: styleProfile.getTrimDensity(options.era),
    },
    development: response,
    climate: options.climate ?? CLIMATE.temperate,
    prosperity: options.prosperity ?? 0.5,
    stage: options.stage,
  };
  const spec = resolveBuildingSpec(context);
  const grammar = resolveBuildingGrammar(styleProfile, options.era, options.role, seed, response);
  applySpecToGrammar(grammar, spec);
  return { spec, grammar };
}

function compose(options: Parameters<typeof resolve>[0]): { group: THREE.Group; spec: BuildingSpec } {
  const { spec, grammar } = resolve(options);
  const palette = new MaterialPalette({ culture: CULTURE, era: options.era });
  const composed = composeBuilding(grammar, palette, options.seed ?? `${options.role}:${options.era}`, options.stage ?? BUILD_STAGE.FINISH);
  return { group: composed.group, spec };
}

function meshes(group: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh) found.push(object); });
  return found;
}

function vertexCount(group: THREE.Object3D): number {
  return meshes(group).reduce((total, mesh) => total + mesh.geometry.getAttribute('position').count, 0);
}

/** The construction materials a composed building is actually made of. */
function materialNames(group: THREE.Object3D): Set<string> {
  return new Set(meshes(group).map(mesh => mesh.name));
}

function bounds(group: THREE.Object3D): { x: number; y: number; z: number } {
  const box = new THREE.Box3().setFromObject(group);
  return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
}

// ---------------------------------------------------------------------------- the chain works

describe('Spec-driven building pipeline', () => {
  it('drives the grammar from the spec rather than from era and role alone', () => {
    const { spec, grammar } = resolve({ role: 'house', era: 'preIndustrial' });
    expect(grammar.spec).toBe(spec);
    expect(grammar.width).toBe(spec.width);
    expect(grammar.bays).toBe(spec.bays);
    expect(grammar.storeys).toBe(spec.floors);
    expect(grammar.roofPitch).toBe(spec.roof.pitch);
    expect(grammar.wallThickness).toBe(spec.wallThickness);
    expect(grammar.frameExposure).toBe(spec.frameExposure);
    expect(grammar.supportDensity).toBe(spec.supportDensity);
    expect(grammar.wear).toBe(spec.age.wear);
  });

  it('renders a building out of the construction materials the spec selected', () => {
    const { group, spec } = compose({ role: 'house', era: 'preIndustrial' });
    const names = materialNames(group);
    // Every mesh is named for the material it is made of, and the wall material must be present.
    expect(names.has(spec.materials.wall)).toBe(true);
    expect(names.has(spec.materials.roofCovering)).toBe(true);
    for (const name of names) {
      // Anything not an architectural material must be one of the legacy ornament surfaces.
      const architectural = (['glow', 'forge', 'shadow', 'motif', 'cloth', 'garden', 'ground'] as string[]).includes(name);
      if (!architectural) expect(() => architecturalMaterial(name as ArchitecturalMaterialId)).not.toThrow();
    }
  });

  it('keeps a building inside a tight draw-call budget', () => {
    // The whole point of batching by material: a fully detailed building is a handful of meshes,
    // not one per plank. A regression here is a performance regression.
    for (const role of ['house', 'granary', 'workshop', 'factory', 'market', 'hall'] as BuildingRole[]) {
      const { group } = compose({ role, era: 'industrial', material: 'ceramic', level: 3 });
      expect(meshes(group).length, `${role} draw calls`).toBeLessThanOrEqual(14);
      expect(meshes(group).length, `${role} produced nothing`).toBeGreaterThan(0);
    }
  });

  it('shares one material instance across every building in a settlement', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'industrial' });
    const first = resolve({ role: 'house', era: 'industrial', seed: 'plot-a', material: 'ceramic' });
    const second = resolve({ role: 'house', era: 'industrial', seed: 'plot-b', material: 'ceramic' });
    const a = composeBuilding(first.grammar, palette, 'plot-a', BUILD_STAGE.FINISH).group;
    const b = composeBuilding(second.grammar, palette, 'plot-b', BUILD_STAGE.FINISH).group;

    const byName = new Map<string, THREE.Material>();
    let shared = 0;
    for (const mesh of [...meshes(a), ...meshes(b)]) {
      const existing = byName.get(mesh.name);
      if (existing) {
        // Two buildings using the same material must point at the same object, not a clone.
        expect(mesh.material, `${mesh.name} was cloned`).toBe(existing);
        shared += 1;
      } else {
        byName.set(mesh.name, mesh.material as THREE.Material);
      }
    }
    expect(shared).toBeGreaterThan(0);
    palette.dispose();
  });
});

// ---------------------------------------------------------------------------- migrated archetypes

describe('Migrated archetypes', () => {
  const MIGRATED: { archetype: BuildingArchetype; role: BuildingRole; era: Era; material: StructureMaterial }[] = [
    { archetype: 'house', role: 'house', era: 'preIndustrial', material: 'masonry' },
    { archetype: 'barn', role: 'granary', era: 'preIndustrial', material: 'timber' },
    { archetype: 'workshop', role: 'workshop', era: 'industrial', material: 'ceramic' },
    { archetype: 'factory', role: 'factory', era: 'industrial', material: 'metal' },
    { archetype: 'bridge', role: 'gate-tower', era: 'industrial', material: 'metal' },
    { archetype: 'market', role: 'market', era: 'preIndustrial', material: 'masonry' },
  ];

  it('gives each migrated archetype its own structural identity', () => {
    const specs = MIGRATED.map(entry => resolve({ ...entry, level: 3, seed: entry.archetype }).spec);

    // No two of the six may be the same building. Distinctness is measured across the decisions
    // that actually reach geometry rather than the structural family alone: two masonry civic
    // buildings may legitimately share a family while differing in span, openness and frontage.
    const identities = specs.map(spec => [
      spec.family, spec.silhouette, spec.roof.archetype, spec.wallAssembly,
      spec.bays, spec.openness.toFixed(2), spec.openings.density.toFixed(2),
      spec.width.toFixed(2), spec.floors,
    ].join('/'));
    expect(new Set(identities).size).toBe(MIGRATED.length);

    // And at least four distinct structural families across the six, so they are not one
    // construction system wearing six hats.
    expect(new Set(specs.map(spec => spec.family)).size).toBeGreaterThanOrEqual(4);

    // Each carries the equipment its function implies.
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]!;
      expect(spec.archetype).toBe(MIGRATED[index]!.archetype);
      expect(spec.provenance.stageName.length).toBeGreaterThan(0);
    }
  });

  it('builds each migrated archetype out of a different set of materials', () => {
    const sets = MIGRATED.map(entry => {
      const { group } = compose({ ...entry, level: 3, seed: entry.archetype });
      return materialNames(group);
    });
    const signatures = sets.map(set => [...set].sort().join(','));
    // At least five of the six material palettes must be outright different.
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(5);
  });

  it('gives each migrated archetype its own proportions', () => {
    const shapes = MIGRATED.map(entry => {
      const { group } = compose({ ...entry, level: 3, seed: entry.archetype });
      const size = bounds(group);
      return `${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`;
    });
    expect(new Set(shapes).size).toBe(MIGRATED.length);
  });

  it('separates a timber barn, a masonry barn and a steel barn in built geometry', () => {
    const timber = compose({ archetype: 'barn', role: 'granary', era: 'preIndustrial', material: 'timber', level: 3, seed: 'barn' });
    const masonry = compose({ archetype: 'barn', role: 'granary', era: 'preIndustrial', material: 'masonry', level: 3, seed: 'barn' });
    const steel = compose({ archetype: 'barn', role: 'granary', era: 'advanced', material: 'metal', level: 3, seed: 'barn' });

    // Not the same geometry with different textures: different families, different walls,
    // different spans, different vertex budgets.
    expect(new Set([timber.spec.family, masonry.spec.family, steel.spec.family]).size).toBe(3);
    expect(masonry.spec.wallThickness).toBeGreaterThan(timber.spec.wallThickness);
    expect(steel.spec.baySpacing).toBeGreaterThan(timber.spec.baySpacing);
    expect(materialNames(timber.group)).not.toEqual(materialNames(masonry.group));
    expect(materialNames(masonry.group)).not.toEqual(materialNames(steel.group));
    const counts = [vertexCount(timber.group), vertexCount(masonry.group), vertexCount(steel.group)];
    expect(new Set(counts).size).toBe(3);
  });
});

describe('Functional equipment', () => {
  it('shows a building’s working fittings through frontage, flues and yard dressing', () => {
    const forge = resolve({ archetype: 'workshop', role: 'workshop', era: 'preIndustrial', level: 3, seed: 'equip-forge' });
    expect(forge.spec.equipment).toContain('forge');
    // A forge means a flue and a hot interior, whatever else the building is.
    expect(forge.grammar.chimneys).toBeGreaterThan(0);
    expect(forge.grammar.forgeGlow).toBeGreaterThan(0);

    const market = resolve({ archetype: 'market', role: 'market', era: 'preIndustrial', level: 3, seed: 'equip-market' });
    expect(market.spec.equipment).toContain('market-stall');
    expect(['market-stalls', 'colonnade']).toContain(market.grammar.frontage);

    const barn = resolve({ archetype: 'barn', role: 'granary', era: 'industrial', level: 3, seed: 'equip-barn', material: 'ceramic' });
    expect(barn.spec.equipment).toContain('loading-platform');
    expect(barn.grammar.vents).toBeGreaterThan(0);
  });

  it('never lets equipment overwrite what the development response established', () => {
    // The response's social reading of the building stays authoritative; equipment may only fill
    // in what it left blank or raise a count.
    const government = development({ need: 'government', form: 'hall', material: 'masonry', level: 3 });
    const styleProfile = profile();
    const grammar = resolveBuildingGrammar(styleProfile, 'preIndustrial', 'hall', 'equip-civic', government);
    const frontageBefore = grammar.frontage;
    const spec = resolveBuildingSpec({
      archetype: 'civic-hall',
      role: 'hall',
      era: 'preIndustrial',
      seed: 'equip-civic',
      culture: {
        materialBias: styleProfile.materialBias,
        roofLanguage: styleProfile.roofLanguage,
        trimDensity: styleProfile.getTrimDensity('preIndustrial'),
      },
      development: government,
      climate: CLIMATE.temperate,
      prosperity: 0.8,
    });
    applySpecToGrammar(grammar, spec);
    expect(frontageBefore).toBe('portico');
    expect(grammar.frontage).toBe('portico');
  });
});

// ---------------------------------------------------------------------------- legibility

describe('Architectural legibility', () => {
  it('makes a barn visibly evolve across the whole timeline', () => {
    const eras: Era[] = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'];
    const seen = eras.map(era => {
      // The material class moves with the era, exactly as the simulation's own would: a
      // settlement does not keep building its barns out of earth once it can fire brick.
      const { spec, grammar } = resolve({
        archetype: 'barn', role: 'granary', era, level: 3, seed: 'barn-line',
        material: ERA_MATERIAL[era],
      });
      return {
        era,
        stage: spec.provenance.stageName,
        family: spec.family,
        wall: spec.materials.wall,
        roof: spec.materials.roofCovering,
        width: grammar.width,
        baySpacing: spec.baySpacing,
      };
    });

    // The same function must not look the same in every century.
    expect(new Set(seen.map(entry => entry.stage)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(seen.map(entry => entry.family)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(seen.map(entry => entry.wall)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(seen.map(entry => entry.roof)).size).toBeGreaterThanOrEqual(4);

    // A barn grows, and its structure learns to span further. Bay *count* is deliberately not
    // asserted to rise: a modern steel shed covers more ground with fewer, far wider bays than
    // a medieval timber barn, and that widening rhythm is the point.
    const first = seen[0]!;
    const last = seen[seen.length - 1]!;
    expect(last.width).toBeGreaterThan(first.width);
    expect(last.baySpacing).toBeGreaterThan(first.baySpacing * 1.5);
  });

  it('lets a pause in any era reveal the local climate from geometry alone', () => {
    const snowy = resolve({ role: 'house', era: 'preIndustrial', seed: 'clim', climate: CLIMATE.snowy });
    const arid = resolve({ role: 'house', era: 'preIndustrial', seed: 'clim', climate: CLIMATE.arid });
    const wet = resolve({ role: 'house', era: 'preIndustrial', seed: 'clim', climate: CLIMATE.wet });

    expect(snowy.grammar.roofPitch).toBeGreaterThan(arid.grammar.roofPitch * 1.5);
    expect(wet.grammar.eaveOverhang).toBeGreaterThan(arid.grammar.eaveOverhang);
    expect(arid.grammar.wallThickness!).toBeGreaterThan(snowy.grammar.wallThickness!);
    expect(arid.spec.climate.zone).toBe('arid');
    expect(snowy.spec.climate.zone).toBe('snowy');
  });

  it('lets a pause reveal local construction technology from the materials used', () => {
    const early = resolve({ role: 'house', era: 'early', seed: 'tech', material: 'earth', level: 1 }).spec;
    const late = resolve({ role: 'house', era: 'advanced', seed: 'tech', material: 'metal', level: 3 }).spec;
    // Early fabric is site-won and cheap; late fabric is processed and expensive.
    const burden = (spec: BuildingSpec): number =>
      architecturalMaterial(spec.materials.wall).labour + architecturalMaterial(spec.materials.wall).cost;
    expect(burden(late)).toBeGreaterThan(burden(early));
    // A settlement that only knows how to keep a fire cannot build out of anything processed.
    expect(periodRank(architecturalMaterial(early.materials.roofCovering).earliestPeriod))
      .toBeLessThanOrEqual(periodRank('bronzeIron'));
    expect(architecturalMaterial(early.materials.wall).requiresCapabilities).toEqual([]);
  });

  it('lets a pause reveal whether a structure is new, old, expanded or damaged', () => {
    const fresh = resolve({ role: 'house', era: 'preIndustrial', seed: 'hist' }).spec;
    expect(['new', 'sound']).toContain(fresh.age.condition);
    expect(fresh.age.additions).toBe(0);
    expect(fresh.age.damage).toBe(0);
    // The age framework is driven by recorded history, and its outputs reach the grammar.
    const { grammar } = resolve({ role: 'house', era: 'preIndustrial', seed: 'hist' });
    expect(grammar.wear).toBe(fresh.age.wear);
  });
});

// ---------------------------------------------------------------------------- construction

describe('Incremental construction', () => {
  it('reveals a building through all eight stages without ever shrinking', () => {
    let previous = -1;
    const counts: number[] = [];
    for (const stage of CONSTRUCTION_STAGE_SEQUENCE) {
      const { group } = compose({ role: 'workshop', era: 'industrial', material: 'ceramic', level: 3, seed: 'staged', stage });
      const count = vertexCount(group);
      counts.push(count);
      expect(count, `stage ${stage} shrank`).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    // The sequence must actually build something, not jump straight to complete.
    expect(counts[counts.length - 1]!).toBeGreaterThan(counts[0]!);
    expect(new Set(counts).size).toBeGreaterThanOrEqual(5);
  });

  it('raises a timber frame before its walls close', () => {
    const frame = compose({ role: 'house', era: 'village', material: 'timber', seed: 'order', stage: BUILD_STAGE.FRAME });
    const walls = compose({ role: 'house', era: 'village', material: 'timber', seed: 'order', stage: BUILD_STAGE.WALLS });
    // The frame stage must already carry structure, and the wall stage must add to it.
    expect(vertexCount(frame.group)).toBeGreaterThan(0);
    expect(vertexCount(walls.group)).toBeGreaterThan(vertexCount(frame.group));
    expect(materialNames(frame.group).has(frame.spec.materials.frame)).toBe(true);
  });

  it('fits equipment and services only after the shell is roofed', () => {
    const roof = compose({ role: 'factory', era: 'industrial', material: 'metal', level: 3, seed: 'ind', stage: BUILD_STAGE.ROOF });
    const utilities = compose({ role: 'factory', era: 'industrial', material: 'metal', level: 3, seed: 'ind', stage: BUILD_STAGE.UTILITIES });
    const fitout = compose({ role: 'factory', era: 'industrial', material: 'metal', level: 3, seed: 'ind', stage: BUILD_STAGE.FITOUT });
    // Flues and stacks arrive with utilities; joinery and glazing with fit-out.
    expect(vertexCount(utilities.group)).toBeGreaterThan(vertexCount(roof.group));
    expect(vertexCount(fitout.group)).toBeGreaterThanOrEqual(vertexCount(utilities.group));
  });
});

// ---------------------------------------------------------------------------- caching

describe('Asset caching with specifications', () => {
  it('reuses one mesh for identical inputs', () => {
    const builder = new AssetBuilder('arch-cache');
    const config = {
      seed: 'cache:house',
      culture: CULTURE,
      era: 'preIndustrial' as Era,
      variant: `house#${BUILD_STAGE.FINISH}`,
      development: development({ material: 'masonry', level: 2 }),
      prosperity: 0.5,
      grammarContext: { temperature: 0.5, moisture: 0.5 },
    };
    const first = builder.getAsset('building', config);
    const second = builder.getAsset('building', config);
    expect(second.mesh).toBe(first.mesh);
    expect(builder.getCacheStats().hits).toBeGreaterThan(0);
    builder.dispose();
  });

  it('does not share one mesh between buildings of different climate or wealth', () => {
    const builder = new AssetBuilder('arch-cache-vary');
    const base = {
      seed: 'cache:vary',
      culture: CULTURE,
      era: 'preIndustrial' as Era,
      variant: `house#${BUILD_STAGE.FINISH}`,
      development: development({ material: 'masonry', level: 2 }),
    };
    const temperate = builder.getAsset('building', { ...base, prosperity: 0.5, grammarContext: { temperature: 0.5, moisture: 0.5 } });
    const snowy = builder.getAsset('building', { ...base, prosperity: 0.5, grammarContext: { temperature: 0.14, moisture: 0.7 } });
    const rich = builder.getAsset('building', { ...base, prosperity: 1, grammarContext: { temperature: 0.5, moisture: 0.5 } });
    expect(snowy.mesh).not.toBe(temperate.mesh);
    expect(rich.mesh).not.toBe(temperate.mesh);
    builder.dispose();
  });

  it('keeps memorials on their own ceremonial path, untouched by the spec', () => {
    const builder = new AssetBuilder('arch-memorial');
    const memorial = development({
      need: 'memory',
      form: 'marker',
      material: 'masonry',
      memorial: {
        form: 'stone-cairns', sacred: true, ageBand: 2,
        cultureId: 'test-culture', firstMonth: 0, deaths: 12, people: [], events: [],
      },
    });
    const asset = builder.getAsset('building', {
      seed: 'memorial', culture: CULTURE, era: 'village',
      variant: `ritual-marker#${BUILD_STAGE.FINISH}`, development: memorial,
    });
    expect(vertexCount(asset.mesh)).toBeGreaterThan(0);
    builder.dispose();
  });
});


describe('Resolved architectural glazing', () => {
  it.each(['glass', 'curtain-glass'] as const)('emits shared %s panes at FITOUT and lights them independently', id => {
    const { spec, grammar } = resolve({ role: 'house', era: 'industrial', material: 'metal' });
    spec.materials.glazing = id;
    grammar.massing = 'single';
    grammar.patternBands = 0;
    grammar.bays = 3;
    const palette = new MaterialPalette({ culture: CULTURE, era: 'industrial' });
    const before = composeBuilding(grammar, palette, 'glazing', BUILD_STAGE.WALLS).group;
    expect(materialNames(before).has(id)).toBe(false);
    const group = composeBuilding(grammar, palette, 'glazing', BUILD_STAGE.FITOUT).group;
    const pane = meshes(group).find(mesh => mesh.name === id);
    expect(pane).toBeDefined();
    const material = palette.getArchitecturalMaterial(id);
    expect(pane!.material).toBe(material);
    expect(material.transparent).toBe(true);
    expect(material.emissiveIntensity).toBe(0);
    const pieces = pane!.geometry.userData['assemblyPieces'];
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((piece: { stage: number }) => piece.stage === BUILD_STAGE.FITOUT)).toBe(true);
    // Raycast from outside a rear window: the pane must precede the opaque recess.
    const rearPiece = pieces.find((piece: { min: THREE.Vector3; max: THREE.Vector3 }) => piece.max.z < 0 && piece.max.z - piece.min.z < piece.max.x - piece.min.x);
    expect(rearPiece).toBeDefined();
    const paneWidth = spec.openings.facade ? grammar.openingWidth! * 0.98
      : Math.max(0.02, Math.min(grammar.openingWidth!, grammar.width / grammar.bays * 0.8)) * 0.88;
    expect(rearPiece.max.x - rearPiece.min.x).toBeCloseTo(paneWidth);
    const target = new THREE.Vector3(
      rearPiece.min.x + (rearPiece.max.x - rearPiece.min.x) * 0.3,
      rearPiece.min.y + (rearPiece.max.y - rearPiece.min.y) * 0.3,
      rearPiece.min.z,
    );
    const ray = new THREE.Raycaster(target.clone().add(new THREE.Vector3(0, 0, -1)), new THREE.Vector3(0, 0, 1));
    group.updateMatrixWorld(true);
    const recessMeshes = meshes(group).filter(mesh => mesh === pane || mesh.name === 'shadow');
    expect(ray.intersectObjects(recessMeshes, true)[0]?.object.name).toBe(id);
    palette.setNightFactor(1);
    expect(pane!.material).toBe(material);
    expect(material.emissiveIntensity).toBeGreaterThan(0);
    expect(palette.getSurfaceMaterial('glow')).not.toBe(material);
    palette.setNightFactor(0);
    expect(material.emissiveIntensity).toBe(0);
    palette.dispose();
  });

  it('does not invent glazing when the spec omits it', () => {
    const { spec, grammar } = resolve({ role: 'house', era: 'early' });
    delete spec.materials.glazing;
    const palette = new MaterialPalette({ culture: CULTURE, era: 'early' });
    const group = composeBuilding(grammar, palette, 'unglazed', BUILD_STAGE.FITOUT).group;
    expect(materialNames(group).has('glass')).toBe(false);
    expect(materialNames(group).has('curtain-glass')).toBe(false);
    palette.dispose();
  });
});


describe('Facade glazing evolution', () => {
  it.each([
    ['earlyModern', 'house', 'house', 'masonry', 'divided'],
    ['industrial', 'factory', 'factory', 'ceramic', 'factory'],
    ['modern', 'house', 'house', 'metal', 'grid'],
    ['modern', 'civic-hall', 'hall', 'masonry', 'ribbon'],
    ['contemporary', 'house', 'house', 'metal', 'curtain'],
    ['contemporary', 'civic-hall', 'hall', 'metal', 'curtain'],
    ['contemporary', 'market', 'market', 'metal', 'curtain'],
  ] as const)('%s %s resolves scaled facade glazing', (period, archetype, role, material, facade) => {
    const drive = PERIOD_DRIVE[period];
    const { spec, grammar } = resolve({ archetype, role, material, ...drive, seed: `facade:${archetype}:${period}` });
    expect(spec.period).toBe(period);
    expect(spec.openings.facade).toBe(facade);
    expect(spec.openings.rows).toBe(spec.floors);
    expect(spec.openings.height / spec.storeyHeight).toBeGreaterThan(0.6);
    const coverage = spec.openings.width * spec.openings.height * spec.openings.columns! / (spec.width * spec.storeyHeight);
    expect(coverage).toBeCloseTo(spec.openings.density);
    expect(coverage).toBeGreaterThan(period === 'earlyModern' ? 0.35 : 0.45);
    if (facade === 'curtain') {
      expect(spec.family).toBe('curtain-wall-frame');
      expect(spec.materials.glazing).toBe('curtain-glass');
      expect(coverage).toBeGreaterThan(0.8);
    }
    const palette = new MaterialPalette({ culture: CULTURE, era: drive.era });
    const group = composeBuilding(grammar, palette, 'facade', BUILD_STAGE.FITOUT).group;
    const glass = meshes(group).find(mesh => mesh.name === spec.materials.glazing);
    expect(glass).toBeDefined();
    expect(glass!.material).toBe(palette.getArchitecturalMaterial(spec.materials.glazing!));
    expect(meshes(group).length).toBeLessThan(20);
    // Several clear facade samples must actually see glass before opaque fabric.
    group.updateMatrixWorld(true);
    const pieces = glass!.geometry.userData['assemblyPieces'] as { min: THREE.Vector3; max: THREE.Vector3; stage: number }[];
    const rearPanes = pieces.filter(piece => piece.stage === BUILD_STAGE.FITOUT && piece.max.z < 0 && piece.max.z - piece.min.z < 0.02);
    let visible = 0;
    for (const piece of rearPanes) {
      const origin = new THREE.Vector3(piece.min.x + (piece.max.x - piece.min.x) * 0.27,
        piece.min.y + (piece.max.y - piece.min.y) * 0.37, piece.min.z - 0.1);
      const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, 1)).intersectObjects(group.children, true)[0];
      if (hit?.object === glass) visible++;
    }
    expect(visible).toBeGreaterThan(0);
    const again = resolve({ archetype, role, material, ...drive, seed: `facade:${archetype}:${period}` });
    expect(again.spec).toEqual(spec);
    palette.dispose();
  });

  it('includes pane span and facade rhythm in the geometry signature', () => {
    const { spec } = resolve({ archetype: 'house', role: 'house', era: 'advanced', level: 3, material: 'metal' });
    const original = buildingSpecSignature(spec);
    for (const openings of [
      { ...spec.openings, width: spec.openings.width * 1.1 },
      { ...spec.openings, height: spec.openings.height * 1.1 },
      { ...spec.openings, columns: spec.openings.columns! + 1 },
      { ...spec.openings, rows: spec.openings.rows! + 1 },
      { ...spec.openings, divisions: 3 },
    ]) expect(buildingSpecSignature({ ...spec, openings })).not.toBe(original);
  });

  it.each(['barn', 'warehouse', 'granary', 'shrine', 'boundary-wall'] as const)('keeps %s out of tower facade rules', archetype => {
    const { spec } = resolve({ archetype, role: 'house', era: 'advanced', level: 3, material: 'metal' });
    expect(spec.openings.facade).toBeUndefined();
    expect(spec.family).not.toBe('curtain-wall-frame');
  });
});


describe('Curtain facade authority gates', () => {
  it.each(['timber', 'masonry'] as const)('does not substitute a glass tower for authoritative %s', material => {
    const { spec } = resolve({ archetype: 'house', role: 'house', era: 'advanced', level: 3, material });
    expect(spec.family).not.toBe('curtain-wall-frame');
    expect(spec.openings.facade).not.toBe('curtain');
  });
  it('requires the observed curtain-glass manufacturing capabilities', () => {
    const { spec } = resolve({ archetype: 'house', role: 'house', era: 'advanced', level: 3, material: 'metal', capabilities: ['iron-working'] });
    expect(spec.family).not.toBe('curtain-wall-frame');
    expect(spec.materials.glazing).not.toBe('curtain-glass');
    expect(spec.openings.facade).toBeUndefined();
  });
});
