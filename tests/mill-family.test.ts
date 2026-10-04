import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, StructureMaterial } from '../src/sim/development/types';
import { MaterialPalette, type Era } from '../src/render/materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE, composeBuilding } from '../src/render/assets/BuildingComposer';
import { resolveBuildingSpec } from '../src/render/architecture/BuildingSpec';
import { applySpecToGrammar } from '../src/render/architecture/SpecGrammarBridge';
import {
  ARCHETYPE_LIBRARY, BUILDING_ARCHETYPES, archetypeStageFor, type BuildingArchetype,
} from '../src/render/architecture/BuildingArchetype';
import { archetypeForContext } from '../src/render/architecture/ArchetypeRouting';
import {
  MILL_COARSE_INTERVAL, MILL_FULL_MOTION_RANGE, MillMotionSystem, SAIL_CUT_IN, SAIL_FURL, SAIL_GOVERNOR,
  sailAlignment, waterWheelRate, windSailRate,
} from '../src/render/architecture/MillMotion';

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

const MILL_FAMILY: BuildingArchetype[] = ['mill', 'windmill', 'hand-mill', 'sawmill', 'wind-pump', 'smock-mill'];

function development(material: StructureMaterial, level: number): DevelopmentResponse {
  return {
    need: 'housing', form: 'dwelling', name: 'mill-fixture', level, material,
    cultureId: 'test-culture', style: CULTURE, services: {}, reasons: [],
    capabilities: CAPABILITIES, cost: { food: 0, wood: 8, minerals: 6, goods: 0, wealth: 0 }, labor: 10,
  };
}

/** Compose one structure through the same path production uses, and return its group. */
function compose(archetype: BuildingArchetype, era: Era, material: StructureMaterial, seed = `mill:${archetype}`) {
  const profile = CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
  const response = development(material, 3);
  const resolved = resolveBuildingSpec({
    archetype,
    role: 'workshop',
    era,
    seed,
    culture: { materialBias: profile.materialBias, roofLanguage: profile.roofLanguage, trimDensity: 0.5 },
    development: response,
    climate: { temperature: 0.5, moisture: 0.5 },
    prosperity: 0.7,
    stage: BUILD_STAGE.FINISH as never,
  });
  const grammar = resolveBuildingGrammar(profile, era, 'workshop', seed, response);
  applySpecToGrammar(grammar, resolved);
  const palette = new MaterialPalette({ culture: CULTURE, era });
  return { spec: resolved, group: composeBuilding(grammar, palette, seed, BUILD_STAGE.FINISH as never).group };
}

function rotorsIn(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse(object => {
    if (object.userData['millRotor']) found.push(object);
  });
  return found;
}

// ---------------------------------------------------------------------------- family and lineage

describe('the mill family', () => {
  it('gives every subtype its own archetype, and every one a lineage', () => {
    for (const id of MILL_FAMILY) {
      expect(BUILDING_ARCHETYPES, id).toContain(id);
      expect(Object.keys(ARCHETYPE_LIBRARY[id].lineage).length, id).toBeGreaterThan(0);
    }
  });

  it('keeps the new subtypes unrouted, so the simulation does not change what it builds', () => {
    for (const id of ['hand-mill', 'sawmill', 'wind-pump', 'smock-mill'] as const) {
      expect(ARCHETYPE_LIBRARY[id].status, id).toBe('planned');
    }
    // Routing still answers with the archetypes it answered with before this family grew.
    const dry = { role: 'energy' as const, period: 'medieval' as const, need: 'energy' as const, form: 'workshop' as const, level: 2 };
    for (let plot = 0; plot < 20; plot += 1) {
      expect(['mill', 'windmill']).toContain(archetypeForContext({ ...dry, seed: `plot-${plot}` }));
    }
  });

  it('gives no two stages of the family the same massing', () => {
    const seen = new Map<string, string>();
    for (const id of MILL_FAMILY) {
      for (const [period, stage] of Object.entries(ARCHETYPE_LIBRARY[id].lineage)) {
        if (!stage) continue;
        const key = [stage.roof, stage.width.toFixed(2), stage.depth.toFixed(2), stage.storeyHeight.toFixed(2), stage.floors.join('-')].join('|');
        const previous = seen.get(key);
        expect(previous, `${id}.${period} duplicates ${previous}`).toBeUndefined();
        seen.set(key, `${id}.${period}`);
      }
    }
  });

  it('composes each new subtype with its own working equipment', () => {
    const expectations: Array<[BuildingArchetype, Era, StructureMaterial, string[]]> = [
      ['hand-mill', 'primitive', 'timber', ['millstone']],
      ['sawmill', 'preIndustrial', 'timber', ['waterwheel', 'saw-carriage']],
      ['wind-pump', 'preIndustrial', 'masonry', ['windshaft', 'pump-rod']],
      ['smock-mill', 'preIndustrial', 'timber', ['millstone', 'windshaft']],
    ];
    for (const [archetype, era, material, items] of expectations) {
      const { spec, group } = compose(archetype, era, material);
      for (const item of items) expect(spec.equipment, `${archetype} carries ${item}`).toContain(item);
      expect(group.children.length, archetype).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------- rotors

describe('moving parts are real rotors', () => {
  it('pivots a windmill sail cross about its hub on the entrance axis', () => {
    const { spec, group } = compose('windmill', 'preIndustrial', 'timber');
    expect(spec.equipment).toContain('windshaft');
    const [sails] = rotorsIn(group);
    expect(sails, 'the sail cross is a rotor').toBeDefined();
    const info = sails!.userData['millRotor'] as { axis: string; drive: string; pivot: THREE.Vector3Like };
    expect(info.axis).toBe('z');
    expect(info.drive).toBe('wind-sails');
    // The rotor's own geometry is local to its pivot: its bounding sphere is centred on the hub.
    const mesh = sails!.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere!;
    expect(sphere.center.length()).toBeLessThan(sphere.radius * 0.05);
    expect(sphere.radius).toBeGreaterThan(0.2);
  });

  it('turns a watermill wheel about its axle, which runs across the race', () => {
    const { spec, group } = compose('mill', 'preIndustrial', 'masonry');
    expect(spec.equipment).toContain('waterwheel');
    const wheel = rotorsIn(group).find(object => object.name === 'Waterwheel');
    expect(wheel).toBeDefined();
    expect(wheel!.userData['millRotor'].axis).toBe('x');
    expect(wheel!.userData['millRotor'].drive).toBe('water-wheel');
  });

  it('carries no rotors on a building that has no moving parts', () => {
    const { group } = compose('house', 'preIndustrial', 'timber');
    expect(rotorsIn(group)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------- motion curves

describe('motion is driven by the simulation', () => {
  it('leaves a sail still below cut-in and turns it faster as the wind rises to governed speed', () => {
    expect(windSailRate(0)).toBe(0);
    expect(windSailRate(SAIL_CUT_IN * 0.5)).toBe(0);
    let previous = windSailRate(SAIL_CUT_IN);
    expect(previous).toBeGreaterThan(0);
    for (let wind = SAIL_CUT_IN + 0.02; wind <= SAIL_GOVERNOR; wind += 0.02) {
      const rate = windSailRate(wind);
      expect(rate).toBeGreaterThanOrEqual(previous);
      previous = rate;
    }
  });

  it('governs the sails past reefing and furls them in a storm', () => {
    const governed = windSailRate(SAIL_GOVERNOR);
    expect(windSailRate(SAIL_GOVERNOR + 0.2)).toBeLessThan(governed);
    const furled = windSailRate(SAIL_FURL);
    expect(windSailRate(1)).toBeCloseTo(furled, 9);
    expect(furled).toBeLessThan(governed);
  });

  it('is continuous through governing and furling, so gusts never snap the sails', () => {
    // Cut-in is a deliberate step from still to turning, and the sail's inertia is what absorbs it.
    for (const boundary of [SAIL_GOVERNOR, SAIL_FURL]) {
      expect(Math.abs(windSailRate(boundary + 1e-6) - windSailRate(boundary - 1e-6))).toBeLessThan(0.01);
    }
  });

  it('drives a sail best when the wind meets the entrance square on, and still a little from behind', () => {
    // Facing +Z (out of the entrance). Air travelling -Z is the wind meeting the entrance head on.
    expect(sailAlignment(0, 1, 0, -1)).toBeCloseTo(1, 9);
    expect(sailAlignment(0, 1, 0, 1)).toBeCloseTo(0.35, 9);
    expect(sailAlignment(0, 1, 1, 0)).toBeCloseTo(0.35, 9);
  });

  it('turns a waterwheel only on a river with flow, and faster with more flow', () => {
    expect(waterWheelRate(0.5, false)).toBe(0);
    expect(waterWheelRate(0.01, true)).toBe(0);
    expect(waterWheelRate(0.2, true)).toBeLessThan(waterWheelRate(0.6, true));
    expect(waterWheelRate(100, true)).toBeLessThanOrEqual(0.9);
  });
});

// ---------------------------------------------------------------------------- controller

interface FakeWorld {
  size: number;
  cellSize: number;
  cells: Array<{ flow: number; river: boolean }>;
}

/** A minimal world with one cell under the origin, where a structure stands. */
function worldWith(flow: number, river: boolean): FakeWorld {
  const size = 4;
  const cells = Array.from({ length: size * size }, () => ({ flow: 0, river: false }));
  cells[2 * size + 2] = { flow, river };
  return { size, cellSize: 10, cells };
}

function weatherWith(wind: number, windX: number, windZ: number) {
  const cells = Array.from({ length: 16 }, () => ({ wind: 0, windX: 1, windZ: 0 }));
  cells[10] = { wind, windX, windZ };
  return { wind, windX, windZ, cells } as never;
}

/** A structure root holding one rotor at the origin, attached to a scene. */
function fixture(drive: 'wind-sails' | 'water-wheel' = 'wind-sails') {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.userData['millRotor'] = { axis: drive === 'wind-sails' ? 'z' : 'x', drive, pivot: { x: 0, y: 0, z: 0 } };
  root.add(holder);
  scene.add(root);
  return { scene, root, holder };
}

function frame(overrides: Partial<Parameters<MillMotionSystem['update']>[0]>) {
  return {
    deltaSeconds: 0.1,
    elapsedSeconds: 0,
    camera: new THREE.Vector3(0, 0, 0),
    world: worldWith(0, false) as never,
    weather: weatherWith(0.8, 0, -1),
    ...overrides,
  };
}

describe('MillMotionSystem', () => {
  it('turns a sail under a steady wind and holds it still in a calm', () => {
    const windy = fixture();
    const windySystem = new MillMotionSystem(windy.scene);
    expect(windySystem.adopt(windy.root)).toBe(1);
    for (let step = 0; step < 40; step += 1) windySystem.update(frame({ elapsedSeconds: step * 0.1 }));
    expect(windy.holder.rotation.z).not.toBe(0);

    const calm = fixture();
    const calmSystem = new MillMotionSystem(calm.scene);
    calmSystem.adopt(calm.root);
    for (let step = 0; step < 40; step += 1) {
      calmSystem.update(frame({ elapsedSeconds: step * 0.1, weather: weatherWith(0, 0, -1) }));
    }
    expect(calm.holder.rotation.z).toBe(0);
  });

  it('accelerates with inertia rather than snapping to the target speed', () => {
    const { scene, root, holder } = fixture();
    const system = new MillMotionSystem(scene);
    system.adopt(root);
    system.update(frame({ deltaSeconds: 0.1 }));
    const first = holder.rotation.z;
    // One tenth of a second cannot reach the full sail speed, so the first step is small.
    expect(Math.abs(first)).toBeLessThan(0.05);
  });

  it('is deterministic: the same conditions produce the same motion', () => {
    const run = () => {
      const { scene, root, holder } = fixture();
      const system = new MillMotionSystem(scene);
      system.adopt(root);
      for (let step = 0; step < 60; step += 1) system.update(frame({ elapsedSeconds: step * 0.1 }));
      return holder.rotation.z;
    };
    expect(run()).toBe(run());
  });

  it('advances a rotor far from the camera only at the coarse interval', () => {
    const { scene, root, holder } = fixture();
    const system = new MillMotionSystem(scene);
    system.adopt(root);
    const far = new THREE.Vector3(MILL_FULL_MOTION_RANGE + 10, 0, 0);
    system.update(frame({ camera: far, deltaSeconds: 0.2 }));
    expect(holder.rotation.z).toBe(0);
    for (let step = 0; step < Math.ceil(MILL_COARSE_INTERVAL / 0.2) + 2; step += 1) {
      system.update(frame({ camera: far, deltaSeconds: 0.2, elapsedSeconds: step * 0.2 }));
    }
    expect(holder.rotation.z).not.toBe(0);
  });

  it('does nothing at all while the rotor sits in a hidden level of detail', () => {
    const { scene, root, holder } = fixture();
    root.visible = false;
    const system = new MillMotionSystem(scene);
    system.adopt(root);
    for (let step = 0; step < 20; step += 1) system.update(frame({ elapsedSeconds: step * 0.1 }));
    expect(holder.rotation.z).toBe(0);
  });

  it('adopts each structure once, and prunes rotors whose structure has left the scene', () => {
    const { scene, root } = fixture();
    const system = new MillMotionSystem(scene);
    expect(system.adopt(root)).toBe(1);
    expect(system.adopt(root)).toBe(0);
    expect(system.rotorCount).toBe(1);
    scene.remove(root);
    // Pruning runs once a second of simulated time.
    for (let step = 0; step < 12; step += 1) system.update(frame({ deltaSeconds: 0.1 }));
    expect(system.rotorCount).toBe(0);
  });

  it('turns a water wheel only where the river runs', () => {
    const { scene, root, holder } = fixture('water-wheel');
    const system = new MillMotionSystem(scene);
    system.adopt(root);
    for (let step = 0; step < 40; step += 1) {
      system.update(frame({ world: worldWith(0, false) as never, elapsedSeconds: step * 0.1 }));
    }
    expect(holder.rotation.x).toBe(0);
    for (let step = 0; step < 40; step += 1) {
      system.update(frame({ world: worldWith(0.6, true) as never, elapsedSeconds: step * 0.1 }));
    }
    expect(holder.rotation.x).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------- construction clashes

describe('a waterwheel keeps its race clear', () => {
  it('never builds an annex on the wheel side, so a lean-to cannot bury the wheel', async () => {
    const { emitAnnexes, structureFrame } = await import('../src/render/architecture/StructureGeometry');
    const { SeededRandom } = await import('../src/sim/prng');
    const spec = { annexes: 2, width: 1.2, depth: 0.9, wallThickness: 0.04, equipment: ['waterwheel'] } as never;
    const frame = structureFrame(spec, 0.1, 0.6);
    const westBoxes: number[] = [];
    const recorder = () => ({
      addBox: (x: number) => { if (x < -frame.halfWidth) westBoxes.push(x); },
      addQuad: () => undefined,
      addBeam: () => undefined,
    });
    const sink = { at: recorder, stain: () => undefined, clean: () => undefined };
    emitAnnexes(sink as never, spec, frame, new SeededRandom('race'));
    expect(westBoxes).toHaveLength(0);
  });
});
