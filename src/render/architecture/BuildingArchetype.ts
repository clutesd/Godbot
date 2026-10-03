/**
 * BuildingArchetype.ts
 *
 * What a building is *for*, and how that function has looked across history.
 *
 * An archetype is a functional class — a barn, a workshop, a market — and a lineage of stages
 * describing how that class was actually built in each period. The point is that the same
 * function visibly evolves: a barn is a byre shelter in the neolithic, a high-roofed threshing
 * barn in the medieval period, a monitor-roofed barn in the industrial one, and a wide-span pole
 * shed today. None of those are separate hard-coded buildings. They are stages of one lineage,
 * each naming the structural families it was built with and the equipment it carried.
 *
 * Archetypes sit *above* the renderer's existing `BuildingRole`, which stays authoritative for
 * placement, LOD, component manifests and everything else downstream. Every archetype declares
 * the role it presents as, so adding an archetype never destabilises those systems.
 */

import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { ARCHITECTURAL_PERIODS, periodRank } from './ArchitecturalPeriod';
import type { StructuralFamily } from './StructuralFamily';
import type { BuildingRole } from '../assets/BuildingGrammar';

export const BUILDING_ARCHETYPES = [
  'house',
  'barn',
  'byre',
  'stable',
  'animal-pen',
  'granary',
  'silo',
  'workshop',
  'mill',
  'factory',
  'market',
  'warehouse',
  'civic-hall',
  'shrine',
  'gatehouse',
  'bridge',
  'dock',
  'boundary-wall',
] as const;

export type BuildingArchetype = (typeof BUILDING_ARCHETYPES)[number];

/** Roof form as a functional archetype decision, before the structural family biases its pitch. */
export type RoofArchetype =
  | 'conical'
  | 'shed'
  | 'gable'
  | 'steep-gable'
  | 'low-gable'
  | 'hipped'
  | 'flat'
  | 'flat-parapet'
  | 'monitor'
  | 'sawtooth'
  | 'layered'
  | 'stepped'
  | 'dome'
  | 'vault'
  | 'pediment'
  | 'train-shed'
  | 'open-span';

/**
 * Functional equipment: the machinery and fittings that say what happens inside, layered onto
 * an architectural shell rather than modelled as part of it. The existing industry presentation
 * owns process detail; this is the architectural hook it hangs from.
 */
export type FunctionalEquipment =
  | 'hearth'
  | 'chimney'
  | 'ridge-vent'
  | 'louver-vent'
  | 'hay-loft'
  | 'grain-bin'
  | 'threshing-floor'
  | 'manger'
  | 'stall-divider'
  | 'water-trough'
  | 'hitch-rail'
  | 'bedding'
  | 'pen-gate'
  | 'fence-line'
  | 'wagon-apron'
  | 'loading-platform'
  | 'side-ramp'
  | 'workbench'
  | 'forge'
  | 'kiln'
  | 'millstone'
  | 'waterwheel'
  | 'windshaft'
  | 'line-shaft'
  | 'machine-tool'
  | 'conveyor'
  | 'gantry-crane'
  | 'silo-chute'
  | 'pipework'
  | 'transformer'
  | 'market-stall'
  | 'awning'
  | 'counter'
  | 'crate-stack'
  | 'cart-stand'
  | 'arcade'
  | 'quay-bollard'
  | 'slipway'
  | 'rail-track'
  | 'gate-leaf'
  | 'portcullis'
  | 'battlement'
  | 'watch-platform';

export interface ArchetypeStage {
  /** What this functional class is called when built this way. Shown in debug and documentation. */
  name: string;
  /** Ranked structural families this stage was actually built with. */
  families: readonly StructuralFamily[];
  /** Canonical footprint in building units (one unit is roughly six metres). */
  width: number;
  depth: number;
  /** Wall height per storey, same units. */
  storeyHeight: number;
  /** Inclusive floor-count range this stage supports. */
  floors: readonly [number, number];
  /** 0..1 reference share of wall given over to openings. */
  openingDensity: number;
  roof: RoofArchetype;
  /** 0..1 share of the plan that is unwalled — market arcades, open pens, loading faces. */
  openness: number;
  /** Inclusive range of subordinate annexes, lean-tos and service wings. */
  annexes: readonly [number, number];
  equipment: readonly FunctionalEquipment[];
}

export interface BuildingArchetypeDefinition {
  id: BuildingArchetype;
  label: string;
  category: string;
  /** The renderer role this archetype presents as. Keeps placement and LOD untouched. */
  role: BuildingRole;
  /**
   * Lineage by period. Sparse on purpose: a period with no entry inherits the most recent
   * earlier stage, which is exactly how vernacular building behaves. The earliest entry is
   * also the archetype's first appearance — nothing resolves to it before then.
   */
  lineage: Partial<Record<ArchitecturalPeriod, ArchetypeStage>>;
}

const define = (definition: BuildingArchetypeDefinition): BuildingArchetypeDefinition => definition;

export const ARCHETYPE_LIBRARY: Record<BuildingArchetype, BuildingArchetypeDefinition> = {
  // ------------------------------------------------------------------ dwelling
  house: define({
    id: 'house', label: 'House / dwelling', category: 'Settlement', role: 'house',
    lineage: {
      neolithic: {
        name: 'Round hut', families: ['primitive-shelter', 'timber-post-and-beam', 'mud-brick'],
        width: 0.78, depth: 0.74, storeyHeight: 0.34, floors: [1, 1], openingDensity: 0.08,
        roof: 'conical', openness: 0, annexes: [0, 1], equipment: ['hearth'],
      },
      bronzeIron: {
        name: 'Longhouse', families: ['timber-post-and-beam', 'mud-brick', 'adobe', 'log-construction'],
        width: 1.04, depth: 0.7, storeyHeight: 0.42, floors: [1, 1], openingDensity: 0.14,
        roof: 'gable', openness: 0, annexes: [0, 1], equipment: ['hearth'],
      },
      classical: {
        name: 'Courtyard house', families: ['mud-brick', 'adobe', 'stone-masonry', 'timber-frame', 'brick-masonry'],
        width: 1.1, depth: 0.92, storeyHeight: 0.44, floors: [1, 2], openingDensity: 0.2,
        roof: 'hipped', openness: 0.14, annexes: [0, 2], equipment: ['hearth', 'chimney'],
      },
      medieval: {
        name: 'Framed townhouse', families: ['timber-frame', 'stone-masonry', 'mixed-masonry', 'log-construction'],
        width: 0.98, depth: 0.84, storeyHeight: 0.46, floors: [1, 3], openingDensity: 0.26,
        roof: 'steep-gable', openness: 0, annexes: [0, 2], equipment: ['hearth', 'chimney'],
      },
      earlyModern: {
        name: 'Masonry dwelling', families: ['mixed-masonry', 'brick-masonry', 'timber-frame', 'stone-masonry'],
        width: 1.06, depth: 0.9, storeyHeight: 0.46, floors: [2, 3], openingDensity: 0.32,
        roof: 'gable', openness: 0, annexes: [0, 2], equipment: ['hearth', 'chimney'],
      },
      industrial: {
        name: 'Terrace house', families: ['brick-masonry', 'mixed-masonry'],
        width: 0.84, depth: 1.0, storeyHeight: 0.46, floors: [2, 3], openingDensity: 0.36,
        roof: 'low-gable', openness: 0, annexes: [0, 1], equipment: ['chimney'],
      },
      modern: {
        name: 'Apartment block', families: ['reinforced-concrete', 'brick-masonry', 'steel-industrial-frame'],
        width: 1.2, depth: 1.0, storeyHeight: 0.44, floors: [3, 6], openingDensity: 0.42,
        roof: 'flat-parapet', openness: 0, annexes: [0, 1], equipment: [],
      },
      contemporary: {
        name: 'Residential tower', families: ['reinforced-concrete', 'curtain-wall-frame'],
        width: 1.14, depth: 1.04, storeyHeight: 0.42, floors: [5, 12], openingDensity: 0.52,
        roof: 'flat-parapet', openness: 0, annexes: [0, 1], equipment: [],
      },
    },
  }),

  // ------------------------------------------------------------------ agriculture
  barn: define({
    id: 'barn', label: 'Barn', category: 'Agriculture & storage', role: 'granary',
    lineage: {
      neolithic: {
        name: 'Byre shelter', families: ['primitive-shelter', 'timber-post-and-beam'],
        width: 0.96, depth: 0.72, storeyHeight: 0.3, floors: [1, 1], openingDensity: 0.05,
        roof: 'shed', openness: 0.42, annexes: [0, 1],
        equipment: ['bedding', 'fence-line', 'water-trough'],
      },
      bronzeIron: {
        name: 'Framed livestock and storage barn', families: ['timber-post-and-beam', 'log-construction', 'mud-brick'],
        width: 1.22, depth: 0.82, storeyHeight: 0.4, floors: [1, 1], openingDensity: 0.08,
        roof: 'gable', openness: 0.22, annexes: [0, 1],
        equipment: ['bedding', 'manger', 'water-trough', 'fence-line', 'grain-bin'],
      },
      classical: {
        name: 'Estate barn', families: ['timber-post-and-beam', 'stone-masonry', 'mud-brick', 'adobe'],
        width: 1.38, depth: 0.9, storeyHeight: 0.44, floors: [1, 2], openingDensity: 0.1,
        roof: 'gable', openness: 0.16, annexes: [0, 2],
        equipment: ['threshing-floor', 'grain-bin', 'manger', 'wagon-apron', 'hay-loft'],
      },
      medieval: {
        // The great threshing barn: tall, wide-doored, cathedral-framed, roofed high enough to
        // swing a flail. This is the stage that most needs its own silhouette.
        name: 'High-roof threshing barn', families: ['timber-frame', 'timber-post-and-beam', 'stone-masonry'],
        width: 1.62, depth: 0.98, storeyHeight: 0.62, floors: [1, 2], openingDensity: 0.07,
        roof: 'steep-gable', openness: 0.1, annexes: [0, 2],
        equipment: ['threshing-floor', 'hay-loft', 'grain-bin', 'wagon-apron', 'manger', 'ridge-vent'],
      },
      earlyModern: {
        name: 'Bank barn', families: ['mixed-masonry', 'timber-frame', 'stone-masonry', 'brick-masonry'],
        width: 1.7, depth: 1.04, storeyHeight: 0.54, floors: [2, 2], openingDensity: 0.12,
        roof: 'gable', openness: 0.12, annexes: [1, 2],
        equipment: ['threshing-floor', 'hay-loft', 'grain-bin', 'side-ramp', 'loading-platform', 'manger', 'stall-divider'],
      },
      industrial: {
        // Brick stays the customary industrial barn, but iron- and steel-framed agricultural
        // buildings are real by this point, so a settlement working in metal can reach one.
        name: 'Monitor-roof barn', families: ['heavy-industrial-brick', 'timber-frame', 'brick-masonry', 'steel-industrial-frame'],
        width: 1.84, depth: 1.1, storeyHeight: 0.56, floors: [1, 2], openingDensity: 0.16,
        roof: 'monitor', openness: 0.1, annexes: [1, 3],
        equipment: ['hay-loft', 'grain-bin', 'loading-platform', 'side-ramp', 'louver-vent', 'manger', 'stall-divider', 'rail-track'],
      },
      modern: {
        name: 'Pole barn', families: ['steel-industrial-frame', 'reinforced-concrete'],
        width: 2.0, depth: 1.2, storeyHeight: 0.5, floors: [1, 1], openingDensity: 0.1,
        roof: 'low-gable', openness: 0.2, annexes: [0, 2],
        equipment: ['loading-platform', 'conveyor', 'silo-chute', 'louver-vent', 'water-trough'],
      },
      contemporary: {
        name: 'Mechanised agricultural shed', families: ['steel-industrial-frame'],
        width: 2.2, depth: 1.32, storeyHeight: 0.52, floors: [1, 1], openingDensity: 0.08,
        roof: 'open-span', openness: 0.26, annexes: [0, 2],
        equipment: ['loading-platform', 'conveyor', 'silo-chute', 'gantry-crane', 'louver-vent'],
      },
    },
  }),

  byre: define({
    id: 'byre', label: 'Byre / cattle shed', category: 'Agriculture & livestock', role: 'granary',
    lineage: {
      neolithic: {
        name: 'Stock shelter', families: ['primitive-shelter', 'timber-post-and-beam'],
        width: 0.9, depth: 0.6, storeyHeight: 0.28, floors: [1, 1], openingDensity: 0.04,
        roof: 'shed', openness: 0.5, annexes: [0, 0],
        equipment: ['bedding', 'fence-line', 'water-trough'],
      },
      bronzeIron: {
        name: 'Byre', families: ['timber-post-and-beam', 'mud-brick', 'log-construction'],
        width: 1.14, depth: 0.66, storeyHeight: 0.36, floors: [1, 1], openingDensity: 0.06,
        roof: 'gable', openness: 0.26, annexes: [0, 1],
        equipment: ['bedding', 'manger', 'water-trough', 'stall-divider', 'pen-gate'],
      },
      medieval: {
        name: 'Cattle byre', families: ['stone-masonry', 'timber-frame', 'timber-post-and-beam'],
        width: 1.26, depth: 0.72, storeyHeight: 0.4, floors: [1, 1], openingDensity: 0.08,
        roof: 'gable', openness: 0.18, annexes: [0, 1],
        equipment: ['bedding', 'manger', 'water-trough', 'stall-divider', 'pen-gate', 'ridge-vent'],
      },
      industrial: {
        name: 'Dairy byre', families: ['brick-masonry', 'heavy-industrial-brick', 'timber-frame'],
        width: 1.38, depth: 0.78, storeyHeight: 0.44, floors: [1, 1], openingDensity: 0.14,
        roof: 'low-gable', openness: 0.14, annexes: [1, 2],
        equipment: ['manger', 'water-trough', 'stall-divider', 'louver-vent', 'loading-platform'],
      },
      modern: {
        name: 'Livestock shed', families: ['steel-industrial-frame', 'reinforced-concrete'],
        width: 1.6, depth: 0.9, storeyHeight: 0.44, floors: [1, 1], openingDensity: 0.1,
        roof: 'open-span', openness: 0.3, annexes: [0, 1],
        equipment: ['manger', 'water-trough', 'conveyor', 'louver-vent'],
      },
    },
  }),

  stable: define({
    id: 'stable', label: 'Stable', category: 'Agriculture & livestock', role: 'granary',
    lineage: {
      bronzeIron: {
        name: 'Horse shelter', families: ['timber-post-and-beam', 'mud-brick', 'adobe'],
        width: 1.06, depth: 0.68, storeyHeight: 0.38, floors: [1, 1], openingDensity: 0.08,
        roof: 'gable', openness: 0.28, annexes: [0, 1],
        equipment: ['bedding', 'manger', 'hitch-rail', 'water-trough'],
      },
      classical: {
        name: 'Stable block', families: ['stone-masonry', 'timber-post-and-beam', 'brick-masonry'],
        width: 1.2, depth: 0.74, storeyHeight: 0.42, floors: [1, 1], openingDensity: 0.12,
        roof: 'hipped', openness: 0.2, annexes: [0, 1],
        equipment: ['bedding', 'manger', 'stall-divider', 'hitch-rail', 'water-trough'],
      },
      medieval: {
        name: 'Courtyard stable', families: ['stone-masonry', 'timber-frame', 'mixed-masonry'],
        width: 1.3, depth: 0.8, storeyHeight: 0.46, floors: [1, 2], openingDensity: 0.14,
        roof: 'gable', openness: 0.16, annexes: [0, 2],
        equipment: ['bedding', 'manger', 'stall-divider', 'hitch-rail', 'water-trough', 'hay-loft'],
      },
      industrial: {
        name: 'Carriage stable', families: ['brick-masonry', 'mixed-masonry', 'heavy-industrial-brick'],
        width: 1.42, depth: 0.86, storeyHeight: 0.48, floors: [1, 2], openingDensity: 0.2,
        roof: 'monitor', openness: 0.12, annexes: [1, 2],
        equipment: ['manger', 'stall-divider', 'hitch-rail', 'hay-loft', 'louver-vent', 'cart-stand'],
      },
      modern: {
        name: 'Equestrian barn', families: ['steel-industrial-frame', 'brick-masonry'],
        width: 1.5, depth: 0.92, storeyHeight: 0.46, floors: [1, 1], openingDensity: 0.18,
        roof: 'low-gable', openness: 0.18, annexes: [0, 2],
        equipment: ['manger', 'stall-divider', 'water-trough', 'louver-vent'],
      },
    },
  }),

  'animal-pen': define({
    id: 'animal-pen', label: 'Animal pen', category: 'Agriculture & livestock', role: 'store-pit',
    lineage: {
      neolithic: {
        name: 'Stake pen', families: ['primitive-shelter'],
        width: 1.2, depth: 0.9, storeyHeight: 0.14, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.92, annexes: [0, 0],
        equipment: ['fence-line', 'pen-gate', 'water-trough', 'bedding'],
      },
      bronzeIron: {
        name: 'Enclosed pen', families: ['timber-post-and-beam', 'stone-masonry'],
        width: 1.38, depth: 1.0, storeyHeight: 0.18, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.88, annexes: [0, 1],
        equipment: ['fence-line', 'pen-gate', 'water-trough', 'manger', 'bedding'],
      },
      industrial: {
        name: 'Stock yard', families: ['steel-industrial-frame', 'brick-masonry'],
        width: 1.6, depth: 1.1, storeyHeight: 0.2, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.84, annexes: [0, 1],
        equipment: ['fence-line', 'pen-gate', 'water-trough', 'manger', 'loading-platform', 'rail-track'],
      },
    },
  }),

  granary: define({
    id: 'granary', label: 'Granary', category: 'Agriculture & storage', role: 'granary',
    lineage: {
      neolithic: {
        name: 'Storage pit', families: ['primitive-shelter', 'mud-brick'],
        width: 0.5, depth: 0.5, storeyHeight: 0.26, floors: [1, 1], openingDensity: 0.02,
        roof: 'conical', openness: 0, annexes: [0, 0], equipment: ['grain-bin'],
      },
      bronzeIron: {
        name: 'Raised granary', families: ['timber-post-and-beam', 'mud-brick', 'adobe'],
        width: 0.58, depth: 0.58, storeyHeight: 0.52, floors: [1, 1], openingDensity: 0.04,
        roof: 'steep-gable', openness: 0, annexes: [0, 0], equipment: ['grain-bin', 'side-ramp'],
      },
      classical: {
        name: 'Masonry granary', families: ['stone-masonry', 'mud-brick', 'brick-masonry'],
        width: 0.66, depth: 0.66, storeyHeight: 0.56, floors: [1, 2], openingDensity: 0.05,
        roof: 'hipped', openness: 0, annexes: [0, 1], equipment: ['grain-bin', 'loading-platform'],
      },
      earlyModern: {
        name: 'Granary store', families: ['mixed-masonry', 'brick-masonry', 'timber-frame'],
        width: 0.74, depth: 0.7, storeyHeight: 0.52, floors: [2, 3], openingDensity: 0.08,
        roof: 'gable', openness: 0, annexes: [0, 1], equipment: ['grain-bin', 'loading-platform', 'louver-vent'],
      },
      industrial: {
        name: 'Grain store', families: ['heavy-industrial-brick', 'brick-masonry'],
        width: 0.82, depth: 0.76, storeyHeight: 0.54, floors: [2, 4], openingDensity: 0.1,
        roof: 'low-gable', openness: 0, annexes: [1, 2],
        equipment: ['grain-bin', 'loading-platform', 'conveyor', 'louver-vent', 'rail-track'],
      },
      modern: {
        name: 'Bulk grain store', families: ['reinforced-concrete', 'steel-industrial-frame'],
        width: 0.9, depth: 0.84, storeyHeight: 0.52, floors: [2, 4], openingDensity: 0.06,
        roof: 'flat', openness: 0, annexes: [1, 2],
        equipment: ['silo-chute', 'conveyor', 'loading-platform'],
      },
    },
  }),

  silo: define({
    id: 'silo', label: 'Silo', category: 'Agriculture & storage', role: 'granary',
    lineage: {
      industrial: {
        name: 'Stave silo', families: ['brick-masonry', 'heavy-industrial-brick', 'timber-frame'],
        width: 0.42, depth: 0.42, storeyHeight: 0.44, floors: [3, 5], openingDensity: 0.03,
        roof: 'conical', openness: 0, annexes: [0, 1], equipment: ['silo-chute', 'conveyor'],
      },
      modern: {
        name: 'Concrete silo', families: ['reinforced-concrete', 'steel-industrial-frame'],
        width: 0.46, depth: 0.46, storeyHeight: 0.46, floors: [4, 8], openingDensity: 0.02,
        roof: 'flat', openness: 0, annexes: [0, 2],
        equipment: ['silo-chute', 'conveyor', 'loading-platform', 'pipework'],
      },
    },
  }),

  // ------------------------------------------------------------------ production
  workshop: define({
    id: 'workshop', label: 'Workshop', category: 'Production', role: 'workshop',
    lineage: {
      neolithic: {
        name: 'Working shelter', families: ['primitive-shelter', 'timber-post-and-beam'],
        width: 0.84, depth: 0.68, storeyHeight: 0.3, floors: [1, 1], openingDensity: 0.06,
        roof: 'shed', openness: 0.46, annexes: [0, 1], equipment: ['hearth', 'workbench'],
      },
      bronzeIron: {
        name: 'Smithy', families: ['timber-post-and-beam', 'mud-brick', 'stone-masonry'],
        width: 1.0, depth: 0.8, storeyHeight: 0.4, floors: [1, 1], openingDensity: 0.12,
        roof: 'gable', openness: 0.3, annexes: [0, 1],
        equipment: ['forge', 'chimney', 'workbench', 'kiln'],
      },
      classical: {
        name: 'Craft workshop', families: ['stone-masonry', 'mud-brick', 'brick-masonry', 'timber-post-and-beam'],
        width: 1.1, depth: 0.86, storeyHeight: 0.44, floors: [1, 2], openingDensity: 0.18,
        roof: 'hipped', openness: 0.26, annexes: [0, 2],
        equipment: ['forge', 'chimney', 'workbench', 'kiln', 'crate-stack'],
      },
      medieval: {
        name: 'Guild workshop', families: ['timber-frame', 'stone-masonry', 'mixed-masonry'],
        width: 1.16, depth: 0.9, storeyHeight: 0.46, floors: [1, 2], openingDensity: 0.22,
        roof: 'steep-gable', openness: 0.24, annexes: [0, 2],
        equipment: ['forge', 'chimney', 'workbench', 'kiln', 'counter', 'crate-stack'],
      },
      earlyModern: {
        name: 'Millwright workshop', families: ['mixed-masonry', 'brick-masonry', 'timber-frame'],
        width: 1.24, depth: 0.94, storeyHeight: 0.48, floors: [1, 2], openingDensity: 0.28,
        roof: 'gable', openness: 0.2, annexes: [1, 2],
        equipment: ['forge', 'chimney', 'workbench', 'line-shaft', 'machine-tool', 'crate-stack'],
      },
      industrial: {
        name: 'Machine shop', families: ['heavy-industrial-brick', 'brick-masonry', 'steel-industrial-frame'],
        width: 1.4, depth: 1.0, storeyHeight: 0.56, floors: [1, 2], openingDensity: 0.4,
        roof: 'monitor', openness: 0.14, annexes: [1, 3],
        equipment: ['chimney', 'workbench', 'line-shaft', 'machine-tool', 'gantry-crane', 'crate-stack', 'loading-platform'],
      },
      modern: {
        name: 'Fabrication shop', families: ['steel-industrial-frame', 'reinforced-concrete'],
        width: 1.56, depth: 1.1, storeyHeight: 0.56, floors: [1, 1], openingDensity: 0.3,
        roof: 'low-gable', openness: 0.12, annexes: [1, 2],
        equipment: ['workbench', 'machine-tool', 'conveyor', 'gantry-crane', 'loading-platform', 'transformer'],
      },
    },
  }),

  mill: define({
    id: 'mill', label: 'Mill', category: 'Production', role: 'workshop',
    lineage: {
      classical: {
        name: 'Water mill', families: ['stone-masonry', 'timber-post-and-beam', 'timber-frame'],
        width: 0.96, depth: 0.78, storeyHeight: 0.46, floors: [1, 2], openingDensity: 0.14,
        roof: 'gable', openness: 0.1, annexes: [1, 2],
        equipment: ['waterwheel', 'millstone', 'grain-bin', 'loading-platform'],
      },
      medieval: {
        name: 'Manorial mill', families: ['stone-masonry', 'timber-frame', 'mixed-masonry'],
        width: 1.04, depth: 0.82, storeyHeight: 0.5, floors: [2, 3], openingDensity: 0.16,
        roof: 'steep-gable', openness: 0.08, annexes: [1, 2],
        equipment: ['waterwheel', 'millstone', 'grain-bin', 'hay-loft', 'loading-platform'],
      },
      earlyModern: {
        name: 'Powered mill', families: ['mixed-masonry', 'brick-masonry', 'timber-frame'],
        width: 1.16, depth: 0.88, storeyHeight: 0.5, floors: [2, 3], openingDensity: 0.24,
        roof: 'gable', openness: 0.06, annexes: [1, 3],
        equipment: ['waterwheel', 'millstone', 'line-shaft', 'grain-bin', 'loading-platform', 'louver-vent'],
      },
      industrial: {
        name: 'Industrial mill', families: ['heavy-industrial-brick', 'brick-masonry'],
        width: 1.34, depth: 0.96, storeyHeight: 0.56, floors: [3, 5], openingDensity: 0.42,
        roof: 'low-gable', openness: 0.04, annexes: [1, 3],
        equipment: ['chimney', 'line-shaft', 'machine-tool', 'conveyor', 'grain-bin', 'loading-platform', 'rail-track'],
      },
      modern: {
        name: 'Processing plant', families: ['reinforced-concrete', 'steel-industrial-frame'],
        width: 1.5, depth: 1.08, storeyHeight: 0.54, floors: [2, 4], openingDensity: 0.28,
        roof: 'flat-parapet', openness: 0.04, annexes: [1, 3],
        equipment: ['conveyor', 'pipework', 'silo-chute', 'transformer', 'loading-platform'],
      },
    },
  }),

  factory: define({
    id: 'factory', label: 'Factory', category: 'Industry', role: 'factory',
    lineage: {
      earlyModern: {
        name: 'Manufactory', families: ['mixed-masonry', 'brick-masonry', 'timber-frame'],
        width: 1.5, depth: 1.0, storeyHeight: 0.52, floors: [2, 3], openingDensity: 0.34,
        roof: 'gable', openness: 0.06, annexes: [1, 2],
        equipment: ['chimney', 'workbench', 'line-shaft', 'crate-stack', 'loading-platform'],
      },
      industrial: {
        // The defining industrial shell: wide brick bays, iron frame, saw-tooth north light,
        // and a stack. Openings are large because mechanised work needs daylight.
        name: 'Steam factory', families: ['heavy-industrial-brick', 'steel-industrial-frame', 'brick-masonry'],
        width: 1.9, depth: 1.18, storeyHeight: 0.62, floors: [1, 3], openingDensity: 0.52,
        roof: 'sawtooth', openness: 0.06, annexes: [2, 3],
        equipment: ['chimney', 'line-shaft', 'machine-tool', 'conveyor', 'gantry-crane', 'loading-platform', 'rail-track', 'pipework'],
      },
      modern: {
        name: 'Assembly plant', families: ['steel-industrial-frame', 'reinforced-concrete'],
        width: 2.2, depth: 1.34, storeyHeight: 0.6, floors: [1, 2], openingDensity: 0.32,
        roof: 'low-gable', openness: 0.08, annexes: [2, 3],
        equipment: ['conveyor', 'gantry-crane', 'machine-tool', 'loading-platform', 'transformer', 'pipework'],
      },
      contemporary: {
        name: 'Automated plant', families: ['steel-industrial-frame', 'reinforced-concrete'],
        width: 2.4, depth: 1.46, storeyHeight: 0.58, floors: [1, 2], openingDensity: 0.22,
        roof: 'open-span', openness: 0.06, annexes: [1, 3],
        equipment: ['conveyor', 'gantry-crane', 'loading-platform', 'transformer', 'pipework'],
      },
    },
  }),

  // ------------------------------------------------------------------ exchange
  market: define({
    id: 'market', label: 'Market', category: 'Exchange', role: 'market',
    lineage: {
      bronzeIron: {
        name: 'Open market ground', families: ['timber-post-and-beam', 'primitive-shelter'],
        width: 1.3, depth: 0.92, storeyHeight: 0.26, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.86, annexes: [0, 1],
        equipment: ['market-stall', 'awning', 'counter', 'cart-stand'],
      },
      classical: {
        // A colonnaded market: the arcade is the building. Openness stays high because the
        // perimeter is columns, not wall.
        name: 'Colonnaded market', families: ['classical-stone', 'stone-masonry', 'brick-masonry'],
        width: 1.46, depth: 1.0, storeyHeight: 0.52, floors: [1, 1], openingDensity: 0.1,
        roof: 'hipped', openness: 0.64, annexes: [0, 2],
        equipment: ['arcade', 'market-stall', 'counter', 'awning', 'crate-stack'],
      },
      medieval: {
        name: 'Market cross and hall', families: ['timber-frame', 'stone-masonry', 'mixed-masonry'],
        width: 1.4, depth: 0.96, storeyHeight: 0.5, floors: [1, 2], openingDensity: 0.16,
        roof: 'steep-gable', openness: 0.56, annexes: [0, 2],
        equipment: ['arcade', 'market-stall', 'counter', 'awning', 'cart-stand', 'crate-stack'],
      },
      earlyModern: {
        // A market hall is a columnar building before it is a walled one, so the arcaded
        // family leads: without this a covered market resolves to the same masonry mass
        // as an ordinary house of the same period.
        name: 'Covered market hall', families: ['classical-stone', 'mixed-masonry', 'brick-masonry'],
        width: 1.58, depth: 1.04, storeyHeight: 0.54, floors: [1, 2], openingDensity: 0.26,
        roof: 'gable', openness: 0.4, annexes: [0, 2],
        equipment: ['arcade', 'market-stall', 'counter', 'awning', 'crate-stack'],
      },
      industrial: {
        name: 'Iron-and-glass market hall', families: ['steel-industrial-frame', 'heavy-industrial-brick', 'brick-masonry'],
        width: 1.78, depth: 1.12, storeyHeight: 0.66, floors: [1, 1], openingDensity: 0.58,
        roof: 'train-shed', openness: 0.28, annexes: [1, 2],
        equipment: ['arcade', 'market-stall', 'counter', 'crate-stack', 'loading-platform'],
      },
      modern: {
        name: 'Market building', families: ['reinforced-concrete', 'steel-industrial-frame'],
        width: 1.84, depth: 1.16, storeyHeight: 0.56, floors: [1, 2], openingDensity: 0.44,
        roof: 'flat-parapet', openness: 0.24, annexes: [0, 2],
        equipment: ['market-stall', 'counter', 'crate-stack', 'loading-platform'],
      },
    },
  }),

  warehouse: define({
    id: 'warehouse', label: 'Warehouse', category: 'Exchange', role: 'warehouse',
    lineage: {
      classical: {
        name: 'Store range', families: ['stone-masonry', 'mud-brick', 'brick-masonry'],
        width: 1.4, depth: 0.92, storeyHeight: 0.46, floors: [1, 2], openingDensity: 0.08,
        roof: 'gable', openness: 0.08, annexes: [0, 1],
        equipment: ['crate-stack', 'loading-platform'],
      },
      earlyModern: {
        name: 'Merchant warehouse', families: ['mixed-masonry', 'brick-masonry', 'timber-frame'],
        width: 1.56, depth: 1.0, storeyHeight: 0.5, floors: [2, 4], openingDensity: 0.16,
        roof: 'gable', openness: 0.06, annexes: [0, 2],
        equipment: ['crate-stack', 'loading-platform', 'gantry-crane'],
      },
      industrial: {
        name: 'Goods warehouse', families: ['heavy-industrial-brick', 'brick-masonry', 'steel-industrial-frame'],
        width: 1.86, depth: 1.14, storeyHeight: 0.56, floors: [1, 4], openingDensity: 0.24,
        roof: 'monitor', openness: 0.06, annexes: [1, 3],
        equipment: ['crate-stack', 'loading-platform', 'gantry-crane', 'rail-track', 'louver-vent'],
      },
      modern: {
        name: 'Distribution shed', families: ['steel-industrial-frame', 'reinforced-concrete'],
        width: 2.3, depth: 1.4, storeyHeight: 0.6, floors: [1, 1], openingDensity: 0.1,
        roof: 'low-gable', openness: 0.06, annexes: [0, 2],
        equipment: ['loading-platform', 'conveyor', 'gantry-crane'],
      },
    },
  }),

  // ------------------------------------------------------------------ civic
  'civic-hall': define({
    id: 'civic-hall', label: 'Civic hall', category: 'Civic', role: 'hall',
    lineage: {
      bronzeIron: {
        name: 'Chief’s hall', families: ['timber-post-and-beam', 'mud-brick', 'log-construction'],
        width: 1.3, depth: 0.9, storeyHeight: 0.5, floors: [1, 1], openingDensity: 0.1,
        roof: 'gable', openness: 0.08, annexes: [0, 1], equipment: ['hearth'],
      },
      classical: {
        name: 'Basilica', families: ['classical-stone', 'stone-masonry', 'brick-masonry'],
        width: 1.62, depth: 1.08, storeyHeight: 0.66, floors: [1, 2], openingDensity: 0.2,
        roof: 'pediment', openness: 0.3, annexes: [0, 2], equipment: ['arcade'],
      },
      medieval: {
        name: 'Guildhall', families: ['stone-masonry', 'timber-frame', 'mixed-masonry'],
        width: 1.5, depth: 1.04, storeyHeight: 0.58, floors: [2, 3], openingDensity: 0.24,
        roof: 'steep-gable', openness: 0.14, annexes: [0, 2], equipment: ['hearth', 'chimney', 'arcade'],
      },
      earlyModern: {
        name: 'Town hall', families: ['classical-stone', 'mixed-masonry', 'brick-masonry'],
        width: 1.62, depth: 1.12, storeyHeight: 0.56, floors: [2, 3], openingDensity: 0.3,
        roof: 'hipped', openness: 0.18, annexes: [0, 2], equipment: ['chimney', 'arcade'],
      },
      industrial: {
        name: 'Civic institute', families: ['brick-masonry', 'classical-stone', 'mixed-masonry'],
        width: 1.72, depth: 1.18, storeyHeight: 0.58, floors: [2, 4], openingDensity: 0.38,
        roof: 'flat-parapet', openness: 0.14, annexes: [1, 2], equipment: ['chimney', 'arcade'],
      },
      modern: {
        name: 'Civic centre', families: ['reinforced-concrete', 'curtain-wall-frame'],
        width: 1.8, depth: 1.22, storeyHeight: 0.52, floors: [2, 5], openingDensity: 0.5,
        roof: 'flat-parapet', openness: 0.12, annexes: [0, 2], equipment: [],
      },
    },
  }),

  shrine: define({
    id: 'shrine', label: 'Shrine / temple', category: 'Religion', role: 'shrine',
    lineage: {
      neolithic: {
        name: 'Ritual enclosure', families: ['primitive-shelter', 'stone-masonry'],
        width: 0.7, depth: 0.7, storeyHeight: 0.3, floors: [1, 1], openingDensity: 0.04,
        roof: 'conical', openness: 0.4, annexes: [0, 0], equipment: [],
      },
      bronzeIron: {
        name: 'Temple platform', families: ['mud-brick', 'stone-masonry', 'adobe'],
        width: 0.96, depth: 0.96, storeyHeight: 0.48, floors: [1, 1], openingDensity: 0.06,
        roof: 'stepped', openness: 0.2, annexes: [0, 1], equipment: [],
      },
      classical: {
        name: 'Peristyle temple', families: ['classical-stone', 'stone-masonry'],
        width: 1.12, depth: 0.96, storeyHeight: 0.62, floors: [1, 1], openingDensity: 0.08,
        roof: 'pediment', openness: 0.52, annexes: [0, 1], equipment: ['arcade'],
      },
      medieval: {
        name: 'Stone church', families: ['stone-masonry', 'mixed-masonry', 'timber-frame'],
        width: 1.1, depth: 1.04, storeyHeight: 0.72, floors: [1, 2], openingDensity: 0.14,
        roof: 'steep-gable', openness: 0.08, annexes: [0, 2], equipment: [],
      },
      earlyModern: {
        name: 'Domed sanctuary', families: ['classical-stone', 'mixed-masonry', 'brick-masonry'],
        width: 1.2, depth: 1.12, storeyHeight: 0.68, floors: [1, 2], openingDensity: 0.18,
        roof: 'dome', openness: 0.12, annexes: [0, 2], equipment: [],
      },
      modern: {
        name: 'Modern sanctuary', families: ['reinforced-concrete', 'brick-masonry'],
        width: 1.16, depth: 1.08, storeyHeight: 0.6, floors: [1, 2], openingDensity: 0.26,
        roof: 'vault', openness: 0.1, annexes: [0, 1], equipment: [],
      },
    },
  }),

  // ------------------------------------------------------------------ infrastructure
  gatehouse: define({
    id: 'gatehouse', label: 'Gatehouse', category: 'Defence', role: 'gate-tower',
    lineage: {
      bronzeIron: {
        name: 'Timber gate tower', families: ['timber-post-and-beam', 'log-construction'],
        width: 0.74, depth: 0.74, storeyHeight: 0.46, floors: [1, 2], openingDensity: 0.06,
        roof: 'shed', openness: 0.2, annexes: [0, 1],
        equipment: ['gate-leaf', 'watch-platform', 'fence-line'],
      },
      classical: {
        name: 'Masonry gate', families: ['stone-masonry', 'classical-stone', 'brick-masonry'],
        width: 0.82, depth: 0.82, storeyHeight: 0.56, floors: [2, 3], openingDensity: 0.06,
        roof: 'flat-parapet', openness: 0.16, annexes: [0, 1],
        equipment: ['gate-leaf', 'watch-platform', 'battlement'],
      },
      medieval: {
        name: 'Fortified gatehouse', families: ['stone-masonry', 'mixed-masonry'],
        width: 0.9, depth: 0.88, storeyHeight: 0.62, floors: [2, 4], openingDensity: 0.05,
        roof: 'flat-parapet', openness: 0.12, annexes: [0, 2],
        equipment: ['gate-leaf', 'portcullis', 'battlement', 'watch-platform'],
      },
      industrial: {
        name: 'Checkpoint gate', families: ['brick-masonry', 'steel-industrial-frame'],
        width: 0.86, depth: 0.78, storeyHeight: 0.46, floors: [1, 2], openingDensity: 0.22,
        roof: 'low-gable', openness: 0.26, annexes: [0, 1],
        equipment: ['gate-leaf', 'watch-platform', 'fence-line'],
      },
    },
  }),

  bridge: define({
    id: 'bridge', label: 'Bridge', category: 'Transport', role: 'gate-tower',
    lineage: {
      neolithic: {
        name: 'Log footbridge', families: ['primitive-shelter', 'timber-post-and-beam'],
        width: 1.5, depth: 0.3, storeyHeight: 0.18, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 1, annexes: [0, 0], equipment: [],
      },
      bronzeIron: {
        name: 'Timber trestle bridge', families: ['timber-post-and-beam', 'log-construction'],
        width: 1.9, depth: 0.36, storeyHeight: 0.24, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 1, annexes: [0, 0], equipment: [],
      },
      classical: {
        // Arcuated masonry: the arch ring and cutwater piers are the whole architecture.
        name: 'Stone arch bridge', families: ['classical-stone', 'stone-masonry'],
        width: 2.3, depth: 0.42, storeyHeight: 0.3, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 1, annexes: [0, 0], equipment: ['arcade'],
      },
      medieval: {
        name: 'Fortified stone bridge', families: ['stone-masonry', 'mixed-masonry'],
        width: 2.4, depth: 0.46, storeyHeight: 0.34, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 1, annexes: [0, 1], equipment: ['arcade', 'watch-platform'],
      },
      industrial: {
        name: 'Iron truss bridge', families: ['steel-industrial-frame', 'heavy-industrial-brick'],
        width: 2.8, depth: 0.5, storeyHeight: 0.42, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 1, annexes: [0, 1], equipment: ['rail-track'],
      },
      modern: {
        name: 'Concrete span bridge', families: ['reinforced-concrete', 'steel-industrial-frame'],
        width: 3.1, depth: 0.52, storeyHeight: 0.46, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 1, annexes: [0, 1], equipment: [],
      },
    },
  }),

  dock: define({
    id: 'dock', label: 'Dock / quay', category: 'Transport', role: 'warehouse',
    lineage: {
      bronzeIron: {
        name: 'Timber jetty', families: ['timber-post-and-beam', 'log-construction'],
        width: 1.6, depth: 0.5, storeyHeight: 0.2, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.9, annexes: [0, 1],
        equipment: ['quay-bollard', 'crate-stack', 'slipway'],
      },
      classical: {
        name: 'Stone quay', families: ['stone-masonry', 'classical-stone'],
        width: 1.9, depth: 0.6, storeyHeight: 0.26, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.82, annexes: [0, 2],
        equipment: ['quay-bollard', 'crate-stack', 'slipway', 'arcade'],
      },
      industrial: {
        name: 'Dock works', families: ['heavy-industrial-brick', 'steel-industrial-frame'],
        width: 2.2, depth: 0.78, storeyHeight: 0.4, floors: [1, 2], openingDensity: 0.14,
        roof: 'monitor', openness: 0.5, annexes: [1, 3],
        equipment: ['quay-bollard', 'gantry-crane', 'crate-stack', 'rail-track', 'loading-platform'],
      },
      modern: {
        name: 'Container quay', families: ['reinforced-concrete', 'steel-industrial-frame'],
        width: 2.6, depth: 0.9, storeyHeight: 0.42, floors: [1, 1], openingDensity: 0.06,
        roof: 'open-span', openness: 0.6, annexes: [0, 2],
        equipment: ['quay-bollard', 'gantry-crane', 'crate-stack', 'rail-track'],
      },
    },
  }),

  'boundary-wall': define({
    id: 'boundary-wall', label: 'Boundary wall', category: 'Defence', role: 'gate-tower',
    lineage: {
      neolithic: {
        name: 'Stake palisade', families: ['primitive-shelter', 'timber-post-and-beam'],
        width: 1.8, depth: 0.2, storeyHeight: 0.3, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.6, annexes: [0, 0], equipment: ['fence-line', 'gate-leaf'],
      },
      bronzeIron: {
        name: 'Timber wall', families: ['timber-post-and-beam', 'log-construction', 'mud-brick'],
        width: 2.0, depth: 0.26, storeyHeight: 0.4, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.5, annexes: [0, 1],
        equipment: ['fence-line', 'gate-leaf', 'watch-platform'],
      },
      classical: {
        name: 'Curtain wall', families: ['stone-masonry', 'classical-stone', 'brick-masonry'],
        width: 2.2, depth: 0.34, storeyHeight: 0.52, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.3, annexes: [0, 1],
        equipment: ['battlement', 'gate-leaf', 'watch-platform'],
      },
      medieval: {
        name: 'Battlemented wall', families: ['stone-masonry', 'mixed-masonry'],
        width: 2.3, depth: 0.4, storeyHeight: 0.6, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.26, annexes: [0, 2],
        equipment: ['battlement', 'portcullis', 'gate-leaf', 'watch-platform'],
      },
      industrial: {
        name: 'Security line', families: ['brick-masonry', 'steel-industrial-frame', 'reinforced-concrete'],
        width: 2.2, depth: 0.22, storeyHeight: 0.4, floors: [1, 1], openingDensity: 0,
        roof: 'open-span', openness: 0.44, annexes: [0, 1], equipment: ['fence-line', 'gate-leaf'],
      },
    },
  }),
};

export function buildingArchetype(id: BuildingArchetype): BuildingArchetypeDefinition {
  return ARCHETYPE_LIBRARY[id];
}

export function isBuildingArchetype(id: string): id is BuildingArchetype {
  return Object.prototype.hasOwnProperty.call(ARCHETYPE_LIBRARY, id);
}

/** The first period in which an archetype exists at all. */
export function archetypeEarliestPeriod(id: BuildingArchetype): ArchitecturalPeriod {
  const lineage = ARCHETYPE_LIBRARY[id].lineage;
  for (const period of ARCHITECTURAL_PERIODS) {
    if (lineage[period]) return period;
  }
  // Unreachable for a well-formed library; the archetype tests assert every lineage is non-empty.
  return 'neolithic';
}

export function archetypeExistsIn(id: BuildingArchetype, period: ArchitecturalPeriod): boolean {
  return periodRank(period) >= periodRank(archetypeEarliestPeriod(id));
}

export interface ResolvedArchetypeStage {
  stage: ArchetypeStage;
  /** The period whose entry supplied this stage — may be earlier than the one asked for. */
  definedIn: ArchitecturalPeriod;
  /** Periods elapsed since the stage was defined. A long gap means surviving older fabric. */
  periodsOld: number;
}

/**
 * The stage of a lineage in force at a period: the most recent entry at or before it.
 *
 * A sparse lineage is the point. A barn built in a period with no new entry is still the barn
 * its grandparents built, which is how vernacular architecture actually persists — and it means
 * adding a period costs nothing for archetypes that did not change in it.
 */
export function archetypeStageFor(id: BuildingArchetype, period: ArchitecturalPeriod): ResolvedArchetypeStage | undefined {
  const lineage = ARCHETYPE_LIBRARY[id].lineage;
  const target = periodRank(period);
  let found: { stage: ArchetypeStage; definedIn: ArchitecturalPeriod } | undefined;
  for (const candidate of ARCHITECTURAL_PERIODS) {
    if (periodRank(candidate) > target) break;
    const stage = lineage[candidate];
    if (stage) found = { stage, definedIn: candidate };
  }
  if (!found) return undefined;
  return { stage: found.stage, definedIn: found.definedIn, periodsOld: target - periodRank(found.definedIn) };
}

/** Every archetype that presents as a given renderer role. */
export function archetypesForRole(role: BuildingRole): readonly BuildingArchetype[] {
  return BUILDING_ARCHETYPES.filter(id => ARCHETYPE_LIBRARY[id].role === role);
}
