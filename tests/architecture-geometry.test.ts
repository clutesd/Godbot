import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, StructureMaterial } from '../src/sim/development/types';
import { MaterialPalette, type Era } from '../src/render/materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { resolveBuildingGrammar, type BuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE, composeBuilding } from '../src/render/assets/BuildingComposer';
import { resolveBuildingSpec, type BuildingSpec } from '../src/render/architecture/BuildingSpec';
import { applySpecToGrammar } from '../src/render/architecture/SpecGrammarBridge';
import type { BuildingArchetype, FunctionalEquipment } from '../src/render/architecture/BuildingArchetype';
import type { FoundationStyle, WallAssembly } from '../src/render/architecture/StructuralFamily';
import { bridgeSpanSystem } from '../src/render/architecture/DedicatedStructures';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

const CAPABILITIES = [
  'fire-control', 'stone-composites', 'leverage', 'pottery-firing', 'metal-smelting',
  'material-testing', 'iron-working', 'high-temperature-ceramics', 'mechanical-power',
  'precision-tools', 'standardized-parts', 'rotary-machinery', 'thermodynamics',
  'industrial-chemistry', 'animal-husbandry',
];

function development(material: StructureMaterial, level: number): DevelopmentResponse {
  return {
    need: 'housing', form: 'dwelling', name: 'geometry-fixture', level, material,
    cultureId: 'test-culture', style: CULTURE, services: {}, reasons: [],
    capabilities: CAPABILITIES, cost: { food: 0, wood: 8, minerals: 6, goods: 0, wealth: 0 }, labor: 10,
  };
}

interface BuildOptions {
  archetype: BuildingArchetype;
  era?: Era;
  material?: StructureMaterial;
  level?: number;
  seed?: string;
  /** Overrides applied to the resolved spec, to isolate one decision at a time. */
  spec?: Partial<BuildingSpec>;
  /** Overrides applied to the grammar after the bridge has run. */
  grammar?: Partial<BuildingGrammar>;
  stage?: number;
}

interface Built {
  spec: BuildingSpec;
  group: THREE.Group;
  vertices: number;
  meshes: number;
  size: { x: number; y: number; z: number };
  box: THREE.Box3;
  height: number;
  surfaces: Set<string>;
}

/**
 * Compose one structure, optionally overriding a single spec field.
 *
 * Single-variable comparison is the only honest way to show a spec field reaches geometry: build
 * the same structure twice, change one decision, and measure what the composer emitted.
 */
function build(options: BuildOptions): Built {
  const era = options.era ?? 'preIndustrial';
  const seed = options.seed ?? `geom:${options.archetype}`;
  const profile = CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
  const response = development(options.material ?? 'masonry', options.level ?? 3);
  const resolved = resolveBuildingSpec({
    archetype: options.archetype,
    role: 'house',
    era,
    seed,
    culture: { materialBias: profile.materialBias, roofLanguage: profile.roofLanguage, trimDensity: 0.5 },
    development: response,
    climate: { temperature: 0.5, moisture: 0.5 },
    prosperity: 0.7,
    stage: (options.stage ?? BUILD_STAGE.FINISH) as never,
  });
  const spec: BuildingSpec = { ...resolved, ...options.spec };
  const grammar = resolveBuildingGrammar(profile, era, 'house', seed, response);
  applySpecToGrammar(grammar, spec);
  Object.assign(grammar, options.grammar ?? {});

  const palette = new MaterialPalette({ culture: CULTURE, era });
  const composed = composeBuilding(grammar, palette, seed, (options.stage ?? BUILD_STAGE.FINISH) as never);

  let vertices = 0;
  let meshes = 0;
  const surfaces = new Set<string>();
  composed.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    surfaces.add(object.name);
    vertices += object.geometry.getAttribute('position').count;
  });
  const box = new THREE.Box3().setFromObject(composed.group);
  return {
    spec,
    group: composed.group,
    vertices,
    meshes,
    size: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
    box,
    height: composed.height,
    surfaces,
  };
}

// ---------------------------------------------------------------------------- spec fields

describe('Spec fields reach visible geometry', () => {
  it('builds a different base for every foundation style', () => {
    const styles: FoundationStyle[] = ['none', 'packed-earth', 'stone-footing', 'sill-beam',
      'masonry-plinth', 'brick-footing', 'concrete-pad', 'concrete-raft', 'pile-cap'];
    const counts = new Map<FoundationStyle, number>();
    for (const foundation of styles) {
      counts.set(foundation, build({ archetype: 'workshop', spec: { foundation } }).vertices);
    }
    // 'none' emits nothing; every other style adds real geometry.
    const none = counts.get('none')!;
    for (const style of styles) {
      if (style === 'none') continue;
      expect(counts.get(style)!, `${style} added no geometry`).toBeGreaterThan(none);
    }
    // And they are not all the same base: at least six distinct footprints of geometry.
    expect(new Set(counts.values()).size).toBeGreaterThanOrEqual(6);
  });

  it('assembles the wall differently for every construction system', () => {
    const assemblies: WallAssembly[] = ['hide-and-brush', 'stacked-log', 'infilled-frame',
      'monolithic-earth', 'coursed-masonry', 'load-bearing-brick', 'clad-frame',
      'cast-monolith', 'glazed-curtain'];
    const counts = new Map<WallAssembly, number>();
    for (const wallAssembly of assemblies) {
      counts.set(wallAssembly, build({ archetype: 'workshop', spec: { wallAssembly } }).vertices);
    }
    // 'hide-and-brush' is the only assembly with no added character.
    const bare = counts.get('hide-and-brush')!;
    for (const assembly of assemblies) {
      if (assembly === 'hide-and-brush') continue;
      expect(counts.get(assembly)!, `${assembly} added no wall character`).toBeGreaterThan(bare);
    }
    expect(new Set(counts.values()).size).toBeGreaterThanOrEqual(7);
  });

  it('opens the plan as openness rises', () => {
    const closed = build({ archetype: 'market', spec: { openness: 0 } });
    const partly = build({ archetype: 'market', spec: { openness: 0.4 } });
    const open = build({ archetype: 'market', spec: { openness: 0.9 } });
    // Open bays are posts and lintels standing where a wall would be, so they add geometry.
    expect(partly.vertices).toBeGreaterThan(closed.vertices);
    expect(open.vertices).toBeGreaterThan(partly.vertices);
  });

  it('hangs one more annex off the building for every annex the spec gives it', () => {
    // Monotonic growth proves each annex emits its own volume and roof, rather than the set
    // merely being counted somewhere. Overall bounds are not asserted: yard props and frontage
    // already reach further than a lean-to does, so they, not the annex, set the footprint.
    const counts = [0, 1, 2, 3].map(annexes => build({ archetype: 'workshop', spec: { annexes } }).vertices);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]!, `annex ${index} added nothing`).toBeGreaterThan(counts[index - 1]!);
    }
  });

  it('emits geometry for the functional equipment the archetype carries', () => {
    const fitted = build({ archetype: 'barn', material: 'timber' });
    expect(fitted.spec.equipment.length).toBeGreaterThan(0);
    expect(fitted.vertices).toBeGreaterThan(build({ archetype: 'barn', material: 'timber', spec: { equipment: [] } }).vertices);

    // Equipment also strengthens the grammar's own yard and frontage reading, so isolating the
    // *geometry* of one fitting means pinning those down in both builds and varying nothing else.
    const neutral = { props: 'none', frontage: 'none', chimneys: 0, vents: 0, forgeGlow: 0 } as const;
    const bare = build({ archetype: 'barn', material: 'timber', spec: { equipment: [] }, grammar: neutral });

    const items: FunctionalEquipment[] = ['hay-loft', 'threshing-floor', 'grain-bin', 'manger',
      'stall-divider', 'water-trough', 'hitch-rail', 'bedding', 'pen-gate', 'fence-line',
      'wagon-apron', 'loading-platform', 'side-ramp', 'crate-stack', 'cart-stand', 'rail-track',
      'workbench', 'forge', 'kiln', 'millstone', 'waterwheel', 'windshaft', 'line-shaft',
      'machine-tool', 'conveyor', 'gantry-crane', 'silo-chute', 'pipework', 'transformer',
      'market-stall', 'awning', 'counter', 'arcade', 'quay-bollard', 'slipway', 'gate-leaf',
      'portcullis', 'battlement', 'watch-platform', 'hearth', 'ridge-vent', 'louver-vent'];
    for (const item of items) {
      const one = build({ archetype: 'barn', material: 'timber', spec: { equipment: [item] }, grammar: neutral });
      expect(one.vertices, `${item} emitted nothing`).toBeGreaterThan(bare.vertices);
    }
  });

  it('thickens posts and multiplies supports as support density rises', () => {
    const sparse = build({ archetype: 'warehouse', grammar: { supportDensity: 0.1 } });
    const dense = build({ archetype: 'warehouse', grammar: { supportDensity: 1 } });
    expect(dense.vertices).toBeGreaterThan(sparse.vertices);
  });

  it('braces the bays once the frame is exposed', () => {
    const hidden = build({ archetype: 'workshop', material: 'timber', grammar: { frameExposure: 0.1, reinforced: false, postStyle: 'timber' } });
    const exposed = build({ archetype: 'workshop', material: 'timber', grammar: { frameExposure: 0.95, reinforced: false, postStyle: 'timber' } });
    expect(exposed.vertices).toBeGreaterThan(hidden.vertices);
  });

  it('widens openings as the structural family dares wider spans', () => {
    const masonry = build({ archetype: 'barn', era: 'preIndustrial', material: 'masonry' });
    const steel = build({ archetype: 'barn', era: 'advanced', material: 'metal' });
    // A steel frame carries a far wider door than a masonry wall can span over.
    expect(steel.spec.openings.width).toBeGreaterThan(masonry.spec.openings.width * 1.5);
    expect(Number(steel.group.userData['doorWidth'])).toBeGreaterThan(Number(masonry.group.userData['doorWidth']));
  });

  it('publishes the construction system it actually built', () => {
    const built = build({ archetype: 'factory', era: 'industrial', material: 'metal' });
    expect(built.group.userData['structuralFamily']).toBe(built.spec.family);
    expect(built.group.userData['wallAssembly']).toBe(built.spec.wallAssembly);
    expect(built.group.userData['foundationStyle']).toBe(built.spec.foundation);
    expect(built.group.userData['architectureSilhouette']).toBe(built.spec.silhouette);
  });

  it('keeps spec geometry inside the construction lifecycle', () => {
    // Equipment and assembly detail must not appear on a site that is only half built.
    const site = build({ archetype: 'workshop', stage: BUILD_STAGE.SITE });
    const frame = build({ archetype: 'workshop', stage: BUILD_STAGE.FRAME });
    const roofed = build({ archetype: 'workshop', stage: BUILD_STAGE.ROOF });
    const fitted = build({ archetype: 'workshop', stage: BUILD_STAGE.FITOUT });
    expect(site.vertices).toBeLessThan(frame.vertices);
    expect(frame.vertices).toBeLessThan(roofed.vertices);
    expect(roofed.vertices).toBeLessThan(fitted.vertices);
  });
});

// ---------------------------------------------------------------------------- dedicated forms

describe('Structures that are not buildings', () => {
  it('reads a bridge as a crossing rather than a box', () => {
    const bridge = build({ archetype: 'bridge', era: 'industrial', material: 'metal' });
    // Long, low, and open: a deck spanning a gap, not a walled volume.
    expect(bridge.size.x).toBeGreaterThan(bridge.size.y * 3);
    expect(bridge.size.x).toBeGreaterThan(bridge.size.z * 1.5);
    // No roof of any kind.
    for (const surface of bridge.surfaces) {
      expect(surface, 'a bridge grew a roof').not.toMatch(/thatch|shingle|tile|slate|membrane/);
    }
    expect(bridge.group.userData['dedicatedStructure']).toBe('bridge');
  });

  it('builds a bridge the way its own materials span', () => {
    const masonry = build({ archetype: 'bridge', era: 'preIndustrial', material: 'masonry', seed: 'span-stone' });
    const steel = build({ archetype: 'bridge', era: 'industrial', material: 'metal', seed: 'span-steel' });
    const timber = build({ archetype: 'bridge', era: 'village', material: 'timber', seed: 'span-timber' });

    expect(bridgeSpanSystem(masonry.spec)).toBe('arch');
    expect(bridgeSpanSystem(steel.spec)).toBe('truss');
    expect(['trestle', 'log']).toContain(bridgeSpanSystem(timber.spec));

    // Three genuinely different structures, not one deck in three colours.
    expect(new Set([masonry.vertices, steel.vertices, timber.vertices]).size).toBe(3);
    // A through-truss stands above its deck; an arch does not.
    expect(steel.size.y).toBeGreaterThan(timber.size.y);
  });

  it('reads a boundary wall as a wall', () => {
    const wall = build({ archetype: 'boundary-wall', era: 'preIndustrial', material: 'masonry' });
    // A long, thin, low run of fabric.
    expect(wall.size.x).toBeGreaterThan(wall.size.z * 4);
    expect(wall.size.x).toBeGreaterThan(wall.size.y * 2);
    expect(wall.group.userData['dedicatedStructure']).toBe('boundary-wall');
    for (const surface of wall.surfaces) {
      expect(surface, 'a boundary wall grew a roof').not.toMatch(/thatch|shingle|tile|slate|membrane/);
    }
  });

  it('builds a palisade and a curtain wall differently', () => {
    const palisade = build({ archetype: 'boundary-wall', era: 'early', material: 'timber', seed: 'pal' });
    const curtain = build({ archetype: 'boundary-wall', era: 'preIndustrial', material: 'masonry', seed: 'cur' });
    // Close-set stakes are many small members; a curtain wall is few large ones.
    expect(palisade.vertices).not.toBe(curtain.vertices);
    expect(palisade.spec.materials.wall).not.toBe(curtain.spec.materials.wall);
  });

  it('reads an animal pen as an enclosure rather than a building', () => {
    const pen = build({ archetype: 'animal-pen', era: 'preIndustrial', material: 'timber', spec: { annexes: 0 } });
    const barn = build({ archetype: 'barn', era: 'preIndustrial', material: 'timber' });
    expect(pen.group.userData['dedicatedStructure']).toBe('animal-pen');
    // A pen stays fence-height even though its footprint is comparable to a farm building's.
    expect(pen.size.y).toBeLessThan(barn.size.y * 0.6);
    expect(pen.spec.equipment).toContain('pen-gate');
  });

  it('gives an animal pen a subordinate shelter, never a dominant one', () => {
    const sheltered = build({ archetype: 'animal-pen', era: 'preIndustrial', material: 'timber', spec: { annexes: 1 } });
    const unsheltered = build({ archetype: 'animal-pen', era: 'preIndustrial', material: 'timber', spec: { annexes: 0 } });
    expect(sheltered.vertices).toBeGreaterThan(unsheltered.vertices);
    // The shelter must not grow the pen into building-scale height.
    const barn = build({ archetype: 'barn', era: 'preIndustrial', material: 'timber' });
    expect(sheltered.size.y).toBeLessThan(barn.size.y * 0.75);
  });

  it('reaches a quay out over the water while keeping its shed', () => {
    const quay = build({ archetype: 'dock', era: 'industrial', material: 'masonry' });
    const inland = build({ archetype: 'warehouse', era: 'industrial', material: 'masonry' });
    // The quay works project well past the building, toward the water.
    expect(quay.box.max.z).toBeGreaterThan(quay.spec.depth);
    expect(quay.size.z / quay.size.y).toBeGreaterThan(inland.size.z / inland.size.y);
    // But it is still a building: it has a roof.
    expect(quay.meshes).toBeGreaterThan(3);
  });

  it('puts a waterwheel on a mill and nowhere else', () => {
    const mill = build({ archetype: 'mill', era: 'preIndustrial', material: 'masonry' });
    const workshop = build({ archetype: 'workshop', era: 'preIndustrial', material: 'masonry' });
    expect(mill.spec.equipment).toContain('waterwheel');
    expect(workshop.spec.equipment).not.toContain('waterwheel');
    // The wheel hangs off the gable, past the wall line.
    expect(mill.box.min.x).toBeLessThan(-mill.spec.width / 2);
    const withoutWheel = build({
      archetype: 'mill', era: 'preIndustrial', material: 'masonry',
      spec: { equipment: mill.spec.equipment.filter(item => item !== 'waterwheel') },
    });
    expect(mill.vertices).toBeGreaterThan(withoutWheel.vertices);
  });

  it('gives a windmill a sail cross and a narrow tower, not a mill with a different roof', () => {
    const windmill = build({ archetype: 'windmill', era: 'preIndustrial', material: 'timber' });
    const watermill = build({ archetype: 'mill', era: 'preIndustrial', material: 'masonry' });
    expect(windmill.spec.equipment).toContain('windshaft');
    expect(windmill.spec.equipment).not.toContain('waterwheel');
    expect(windmill.spec.roof.archetype).toBe('conical');
    expect(watermill.spec.roof.archetype).not.toBe('conical');
    // Narrow and roughly square in plan, the opposite of a watermill's wide, low range.
    expect(Math.abs(windmill.spec.width - windmill.spec.depth)).toBeLessThan(windmill.spec.width * 0.2);
    expect(watermill.spec.width).toBeGreaterThan(watermill.spec.depth * 1.1);
    const withoutSails = build({
      archetype: 'windmill', era: 'preIndustrial', material: 'timber',
      spec: { equipment: windmill.spec.equipment.filter(item => item !== 'windshaft') },
    });
    expect(windmill.vertices).toBeGreaterThan(withoutSails.vertices);
  });

  it('gives a barn its aisle posts, loft and threshing floor', () => {
    const barn = build({ archetype: 'barn', era: 'preIndustrial', material: 'timber' });
    expect(barn.spec.equipment).toContain('hay-loft');
    expect(barn.spec.equipment).toContain('threshing-floor');
    const stripped = build({
      archetype: 'barn', era: 'preIndustrial', material: 'timber',
      spec: { equipment: [] },
    });
    expect(barn.vertices).toBeGreaterThan(stripped.vertices);
  });

  it('gives a barn a wagon door, not a wide house window', () => {
    const barn = build({ archetype: 'barn', era: 'preIndustrial', material: 'timber' });
    const house = build({ archetype: 'house', era: 'preIndustrial', material: 'timber' });
    // doorBay alone adds a flat x2.2 to opening width, comfortably past ordinary family-to-family
    // variation, so this margin isolates it even though barn and house may resolve different
    // structural families.
    expect(barn.spec.openings.width).toBeGreaterThan(house.spec.openings.width * 1.3);
    expect(barn.spec.openings.perBay).toBe(1);
  });

  it('keeps every archetype inside a sane draw-call budget', () => {
    const archetypes: BuildingArchetype[] = ['house', 'barn', 'byre', 'stable', 'granary', 'silo',
      'workshop', 'mill', 'windmill', 'factory', 'market', 'warehouse', 'civic-hall', 'shrine',
      'gatehouse', 'bridge', 'dock', 'boundary-wall', 'animal-pen'];
    for (const archetype of archetypes) {
      const built = build({ archetype, era: 'industrial', material: 'ceramic' });
      expect(built.meshes, `${archetype} draw calls`).toBeLessThanOrEqual(14);
      expect(built.vertices, `${archetype} emitted nothing`).toBeGreaterThan(0);
    }
  });

  it('gives all nineteen archetypes distinct built geometry', () => {
    const archetypes: BuildingArchetype[] = ['house', 'barn', 'byre', 'stable', 'granary', 'silo',
      'workshop', 'mill', 'windmill', 'factory', 'market', 'warehouse', 'civic-hall', 'shrine',
      'gatehouse', 'bridge', 'dock', 'boundary-wall', 'animal-pen'];
    const signatures = archetypes.map(archetype => {
      const built = build({ archetype, era: 'industrial', material: 'ceramic' });
      return `${built.vertices}:${built.size.x.toFixed(2)}:${built.size.y.toFixed(2)}:${built.size.z.toFixed(2)}`;
    });
    expect(new Set(signatures).size).toBe(archetypes.length);
  });
});

// ---------------------------------------------------------------------------- confusable pairs

/**
 * The structural dimensions that must tell two archetypes apart.
 *
 * A vertex-count-and-bounding-box signature (above) proves two archetypes are not byte-identical,
 * but two timber gables of slightly different width would already pass that. This is the stronger
 * claim the task actually cares about: for each pair of archetypes a viewer could plausibly
 * confuse, at least a few of these *independent* structural axes must differ — never size or
 * material alone.
 */
interface SilhouetteProfile {
  archetype: BuildingArchetype;
  /** Footprint against overall height, not against depth — a tower and a long shed can share a
   * width/depth ratio while standing nothing alike. */
  aspectBucket: 'narrow-tall' | 'square' | 'wide-low';
  roof: string;
  crown: string;
  geometry: 'generic' | 'dedicated';
  opennessBucket: 'closed' | 'partial' | 'open';
  equipmentFamily: Set<string>;
}

function silhouetteProfile(archetype: BuildingArchetype, era: Era, material: StructureMaterial): SilhouetteProfile {
  const built = build({ archetype, era, material });
  const overallHeight = built.spec.storeyHeight * built.spec.floors;
  const ratio = built.spec.width / Math.max(0.01, overallHeight);
  return {
    archetype,
    aspectBucket: ratio < 1 ? 'narrow-tall' : ratio > 2.2 ? 'wide-low' : 'square',
    roof: built.spec.roof.archetype,
    crown: String(built.group.userData['grammarCrown'] ?? 'none'),
    geometry: built.group.userData['dedicatedStructure'] ? 'dedicated' : 'generic',
    opennessBucket: built.spec.openness < 0.12 ? 'closed' : built.spec.openness < 0.5 ? 'partial' : 'open',
    equipmentFamily: new Set(built.spec.equipment),
  };
}

/** How many of the independent structural axes differ between two profiles. */
function distinguishingAxes(a: SilhouetteProfile, b: SilhouetteProfile): number {
  let axes = 0;
  if (a.aspectBucket !== b.aspectBucket) axes += 1;
  if (a.roof !== b.roof) axes += 1;
  if (a.crown !== b.crown) axes += 1;
  if (a.geometry !== b.geometry) axes += 1;
  if (a.opennessBucket !== b.opennessBucket) axes += 1;
  // Equipment families differ if either carries something the other lacks.
  const symmetricDifference = [...a.equipmentFamily].some(item => !b.equipmentFamily.has(item))
    || [...b.equipmentFamily].some(item => !a.equipmentFamily.has(item));
  if (symmetricDifference) axes += 1;
  return axes;
}

describe('Previously-confusable archetypes stay apart', () => {
  // (archetype, archetype, minimum distinguishing axes, era, material) — the era/material pair is
  // chosen per pair so both sides resolve a real stage, not an off-era fallback.
  const PAIRS: readonly [BuildingArchetype, BuildingArchetype, number, Era, StructureMaterial][] = [
    ['barn', 'byre', 2, 'preIndustrial', 'timber'],
    ['byre', 'stable', 2, 'preIndustrial', 'timber'],
    ['barn', 'stable', 2, 'preIndustrial', 'timber'],
    ['mill', 'windmill', 3, 'preIndustrial', 'masonry'],
    ['mill', 'workshop', 2, 'industrial', 'metal'],
    ['civic-hall', 'shrine', 2, 'preIndustrial', 'masonry'],
    ['silo', 'granary', 2, 'industrial', 'ceramic'],
    ['animal-pen', 'barn', 3, 'preIndustrial', 'timber'],
  ];

  for (const [first, second, minimumAxes, era, material] of PAIRS) {
    it(`distinguishes ${first} from ${second} on at least ${minimumAxes} structural axes`, () => {
      const a = silhouetteProfile(first, era, material);
      const b = silhouetteProfile(second, era, material);
      const serialize = (p: SilhouetteProfile) => ({ ...p, equipmentFamily: [...p.equipmentFamily] });
      expect(distinguishingAxes(a, b), JSON.stringify({ a: serialize(a), b: serialize(b) }))
        .toBeGreaterThanOrEqual(minimumAxes);
    });
  }
});
