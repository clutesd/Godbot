/**
 * MaterialLibrary.ts
 *
 * The construction-material vocabulary of GODBOX.
 *
 * This is deliberately a library of *building materials*, not a palette of colours. A material
 * here knows when it could first be made, what it can hold up, how far it can span, how it
 * fails, how it ages, what it costs in labour, which climates it suits, which cultures reach
 * for it, and — critically — which simulation material kinds evidence it. That last field is
 * what keeps the renderer honest: a settlement whose project actually consumed fired brick gets
 * brick walls, and one that consumed only timber and stone cannot.
 *
 * Nothing in here invents gameplay state. It is a lookup table plus pure query functions over
 * it. The authority for what a settlement has, knows and spent stays in the simulation; this
 * module only answers "given that, which construction materials are credible?".
 *
 * Rendering note: `appearance.program` is the identity of the procedural shader pattern (brick
 * coursing, log stacking, standing seam...), while the rest of `appearance` carries per-material
 * colour and finish. Many materials share one program and differ only in appearance, so the
 * number of compiled GPU programs stays far below the number of materials. See SurfaceDetail.ts.
 */

import type { MaterialKind } from '../../sim/resources/MaterialEconomy';
import type { StructureMaterial } from '../../sim/development/types';
import type { MaterialBias } from '../style/CultureStyleProfile';
import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { periodAtLeast, periodRank } from './ArchitecturalPeriod';

/** Every construction material the architecture system can specify. */
export const ARCHITECTURAL_MATERIALS = [
  // Stone
  'fieldstone',
  'rubble-masonry',
  'dressed-stone',
  'ashlar',
  'limestone',
  'sandstone',
  'granite',
  'slate',
  // Earth
  'mud-brick',
  'adobe',
  'wattle-and-daub',
  // Timber
  'logs',
  'rough-hewn-timber',
  'heavy-timber',
  'sawn-lumber',
  'finished-wood',
  'wood-shingle',
  // Organic
  'thatch',
  // Ceramic
  'fired-brick',
  'buff-brick',
  'clay-tile',
  'terracotta',
  // Binder
  'plaster',
  'concrete',
  'reinforced-concrete',
  // Metal
  'wrought-iron',
  'cast-iron',
  'steel',
  'structural-steel',
  'corrugated-metal',
  'sheet-metal',
  'copper',
  'aluminium',
  // Glazing and membrane
  'glass',
  'curtain-glass',
  'asphalt-membrane',
] as const;

export type ArchitecturalMaterialId = (typeof ARCHITECTURAL_MATERIALS)[number];

/** Broad material family. Drives substitution: a family peer is the most believable swap. */
export type MaterialFamily =
  | 'stone'
  | 'earth'
  | 'earth-timber'
  | 'timber'
  | 'organic'
  | 'ceramic'
  | 'binder'
  | 'metal'
  | 'glass'
  | 'membrane';

/**
 * What part of a building a material can credibly be. A material is only ever offered for a
 * role it declares, which is what stops the resolver thatching a foundation.
 */
export type MaterialRole =
  | 'foundation'
  | 'frame'
  | 'wall'
  | 'infill'
  | 'finish'
  | 'roof-structure'
  | 'roof-covering'
  | 'floor'
  | 'trim'
  | 'glazing'
  | 'hardware';

export const MATERIAL_ROLES: readonly MaterialRole[] = [
  'foundation', 'frame', 'wall', 'infill', 'finish',
  'roof-structure', 'roof-covering', 'floor', 'trim', 'glazing', 'hardware',
] as const;

/** Climate bands derived from the settlement's own cell temperature and moisture. */
export type ClimateZone = 'arid' | 'temperate' | 'wet' | 'cold' | 'snowy' | 'tropical';

export const CLIMATE_ZONES: readonly ClimateZone[] = ['arid', 'temperate', 'wet', 'cold', 'snowy', 'tropical'] as const;

/** How a material visibly ages. The shared surface shader reads this, not the material id. */
export type WeatheringMode =
  | 'none'
  | 'soot'
  | 'bleach'
  | 'moss'
  | 'rust'
  | 'patina'
  | 'erode'
  | 'silver'
  | 'stain';

/** Coarse hue family, for keeping a settlement's materials inside one colourway. */
export type ColorFamily =
  | 'grey'
  | 'warm-grey'
  | 'buff'
  | 'red'
  | 'brown'
  | 'ochre'
  | 'white'
  | 'green'
  | 'black'
  | 'silver'
  | 'clear';

/**
 * Identity of a procedural surface pattern. Materials sharing a program share one compiled
 * shader and differ only by the rest of `appearance`, so adding materials is cheap on the GPU.
 */
export type SurfaceProgram =
  | 'rubble'
  | 'coursed-stone'
  | 'ashlar'
  | 'slate-course'
  | 'mud-brick'
  | 'adobe-render'
  | 'daub-panel'
  | 'plaster'
  | 'log-stack'
  | 'hewn-timber'
  | 'sawn-board'
  | 'thatch'
  | 'shingle'
  | 'brick-coursing'
  | 'tile-course'
  | 'terracotta'
  | 'concrete-form'
  | 'wrought-metal'
  | 'cast-metal'
  | 'rolled-steel'
  | 'corrugated-sheet'
  | 'standing-seam'
  | 'sheet-panel'
  | 'glazing'
  | 'curtain-wall'
  | 'membrane';

export interface MaterialStructure {
  /** 0..1 compressive capacity. Drives wall thickness and how many storeys are credible. */
  load: number;
  /** 0..1 span/tensile capacity. Drives bay spacing, roof span and opening width. */
  span: number;
  /** Most storeys this material can credibly carry as the primary wall or frame. */
  maxStoreys: number;
}

export interface MaterialWeathering {
  /** 0..1 how fast visible age accumulates relative to a notional century. */
  rate: number;
  mode: WeatheringMode;
}

export interface MaterialAppearance {
  /** Procedural pattern family. Shared across materials wherever the pattern is the same. */
  program: SurfaceProgram;
  /** Base colour before culture tinting. */
  color: number;
  roughness: number;
  metalness: number;
  /** 0 opaque .. 1 fully transparent. */
  transparency: number;
  colorFamily: ColorFamily;
  /** Characteristic feature size in metres — a brick course, a plank width, a tile lap. */
  textureScale: number;
}

export interface ArchitecturalMaterialDefinition {
  id: ArchitecturalMaterialId;
  label: string;
  family: MaterialFamily;
  roles: readonly MaterialRole[];
  /** First period in which this material can be made at all. */
  earliestPeriod: ArchitecturalPeriod;
  /**
   * Capability ids that must be in practice before this material is credible. Era alone is not
   * enough for the materials that depend on a specific process (firing, smelting, rolling).
   */
  requiresCapabilities: readonly string[];
  /**
   * Simulation material kinds whose consumption evidences this material. Empty means the
   * material is won directly from the site (earth, reed, cleared fieldstone) and needs no
   * entry in a project's bill of materials.
   */
  sourcedFrom: readonly MaterialKind[];
  /** The coarse simulation-facing material class this reads as. */
  structureMaterial: StructureMaterial;
  structure: MaterialStructure;
  /** 0..1 resistance to time and use. */
  durability: number;
  /** 0..1 resistance to fire. */
  fireResistance: number;
  weathering: MaterialWeathering;
  /** 0..1 worker-months implied per unit of fabric. Drives who can afford it. */
  labour: number;
  /** 0..1 material cost implied, independent of labour. */
  cost: number;
  /** 0..1 suitability per climate. Unlisted zones default to 0.5 — workable, unremarkable. */
  climate: Partial<Record<ClimateZone, number>>;
  /** Culture material biases that reach for this material first. */
  cultureAffinity: readonly MaterialBias[];
  appearance: MaterialAppearance;
}

const define = (definition: ArchitecturalMaterialDefinition): ArchitecturalMaterialDefinition => definition;

/**
 * The library itself.
 *
 * Numbers are chosen relative to each other rather than from engineering tables: what matters
 * is that ashlar out-spans rubble, that thatch burns and slate does not, and that a steel frame
 * reaches storeys mud brick cannot. The resolver only ever compares these values.
 */
export const MATERIAL_LIBRARY: Record<ArchitecturalMaterialId, ArchitecturalMaterialDefinition> = {
  // ---------------------------------------------------------------- stone
  fieldstone: define({
    id: 'fieldstone', label: 'Fieldstone', family: 'stone',
    roles: ['foundation', 'wall', 'trim'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.72, span: 0.16, maxStoreys: 2 },
    durability: 0.82, fireResistance: 0.96,
    weathering: { rate: 0.3, mode: 'moss' },
    labour: 0.34, cost: 0.18,
    climate: { cold: 0.8, snowy: 0.78, wet: 0.72, temperate: 0.75, arid: 0.6 },
    cultureAffinity: ['stone', 'mixed'],
    appearance: { program: 'rubble', color: 0x8b8579, roughness: 0.93, metalness: 0, transparency: 0, colorFamily: 'warm-grey', textureScale: 0.33 },
  }),
  'rubble-masonry': define({
    id: 'rubble-masonry', label: 'Rubble masonry', family: 'stone',
    // Also the hidden core packed between two dressed facings.
    roles: ['foundation', 'wall', 'infill'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.76, span: 0.18, maxStoreys: 3 },
    durability: 0.78, fireResistance: 0.97,
    weathering: { rate: 0.34, mode: 'moss' },
    labour: 0.4, cost: 0.22,
    climate: { cold: 0.78, snowy: 0.76, wet: 0.7, temperate: 0.76, arid: 0.64 },
    cultureAffinity: ['stone'],
    appearance: { program: 'rubble', color: 0x857f73, roughness: 0.95, metalness: 0, transparency: 0, colorFamily: 'warm-grey', textureScale: 0.26 },
  }),
  'dressed-stone': define({
    id: 'dressed-stone', label: 'Dressed stone', family: 'stone',
    roles: ['foundation', 'wall', 'frame', 'trim', 'floor'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: ['leverage'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.9, span: 0.3, maxStoreys: 4 },
    durability: 0.94, fireResistance: 0.98,
    weathering: { rate: 0.2, mode: 'bleach' },
    labour: 0.7, cost: 0.52,
    climate: { cold: 0.82, snowy: 0.8, wet: 0.76, temperate: 0.84, arid: 0.8 },
    cultureAffinity: ['stone', 'mixed'],
    appearance: { program: 'coursed-stone', color: 0x968f81, roughness: 0.84, metalness: 0, transparency: 0, colorFamily: 'warm-grey', textureScale: 0.42 },
  }),
  ashlar: define({
    id: 'ashlar', label: 'Ashlar', family: 'stone',
    roles: ['foundation', 'wall', 'frame', 'trim'],
    earliestPeriod: 'classical', requiresCapabilities: ['stone-composites'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.95, span: 0.36, maxStoreys: 5 },
    durability: 0.96, fireResistance: 0.98,
    weathering: { rate: 0.15, mode: 'bleach' },
    labour: 0.88, cost: 0.74,
    climate: { cold: 0.84, snowy: 0.82, wet: 0.8, temperate: 0.88, arid: 0.86 },
    cultureAffinity: ['stone'],
    appearance: { program: 'ashlar', color: 0xa39a8a, roughness: 0.72, metalness: 0, transparency: 0, colorFamily: 'buff', textureScale: 0.55 },
  }),
  limestone: define({
    id: 'limestone', label: 'Limestone', family: 'stone',
    roles: ['foundation', 'wall', 'trim'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: ['leverage'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.82, span: 0.28, maxStoreys: 4 },
    durability: 0.82, fireResistance: 0.98,
    weathering: { rate: 0.34, mode: 'erode' },
    labour: 0.62, cost: 0.44,
    climate: { arid: 0.86, temperate: 0.8, wet: 0.56, cold: 0.62, snowy: 0.58 },
    cultureAffinity: ['stone', 'mixed'],
    appearance: { program: 'coursed-stone', color: 0xc3b696, roughness: 0.8, metalness: 0, transparency: 0, colorFamily: 'buff', textureScale: 0.46 },
  }),
  sandstone: define({
    id: 'sandstone', label: 'Sandstone', family: 'stone',
    roles: ['foundation', 'wall', 'trim'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: ['leverage'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.78, span: 0.26, maxStoreys: 3 },
    durability: 0.8, fireResistance: 0.97,
    weathering: { rate: 0.42, mode: 'erode' },
    labour: 0.56, cost: 0.38,
    climate: { arid: 0.9, temperate: 0.76, wet: 0.5, cold: 0.56, snowy: 0.5 },
    cultureAffinity: ['stone', 'clay'],
    appearance: { program: 'coursed-stone', color: 0xb98a5e, roughness: 0.86, metalness: 0, transparency: 0, colorFamily: 'ochre', textureScale: 0.44 },
  }),
  granite: define({
    id: 'granite', label: 'Granite', family: 'stone',
    roles: ['foundation', 'wall', 'frame', 'trim'],
    earliestPeriod: 'classical', requiresCapabilities: ['leverage', 'material-testing'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.99, span: 0.34, maxStoreys: 5 },
    durability: 0.99, fireResistance: 0.99,
    weathering: { rate: 0.08, mode: 'moss' },
    labour: 0.95, cost: 0.8,
    climate: { cold: 0.92, snowy: 0.9, wet: 0.86, temperate: 0.84, arid: 0.78 },
    cultureAffinity: ['stone'],
    appearance: { program: 'ashlar', color: 0x79787a, roughness: 0.66, metalness: 0.03, transparency: 0, colorFamily: 'grey', textureScale: 0.5 },
  }),
  slate: define({
    id: 'slate', label: 'Slate', family: 'stone',
    roles: ['roof-covering', 'floor'],
    earliestPeriod: 'medieval', requiresCapabilities: ['leverage'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.4, span: 0.12, maxStoreys: 1 },
    durability: 0.92, fireResistance: 0.99,
    weathering: { rate: 0.12, mode: 'moss' },
    labour: 0.62, cost: 0.56,
    climate: { wet: 0.95, snowy: 0.92, cold: 0.9, temperate: 0.8, arid: 0.4 },
    cultureAffinity: ['stone'],
    appearance: { program: 'slate-course', color: 0x454b54, roughness: 0.62, metalness: 0.04, transparency: 0, colorFamily: 'grey', textureScale: 0.2 },
  }),

  // ---------------------------------------------------------------- earth
  'mud-brick': define({
    id: 'mud-brick', label: 'Mud brick', family: 'earth',
    roles: ['wall', 'infill'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['clay'],
    structureMaterial: 'earth',
    structure: { load: 0.42, span: 0.08, maxStoreys: 2 },
    durability: 0.46, fireResistance: 0.8,
    weathering: { rate: 0.72, mode: 'erode' },
    labour: 0.22, cost: 0.1,
    climate: { arid: 0.95, temperate: 0.52, wet: 0.14, cold: 0.3, snowy: 0.1, tropical: 0.24 },
    cultureAffinity: ['clay', 'mixed'],
    appearance: { program: 'mud-brick', color: 0xa8845c, roughness: 0.95, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.3 },
  }),
  adobe: define({
    id: 'adobe', label: 'Adobe', family: 'earth',
    roles: ['wall', 'infill', 'finish', 'roof-covering'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['clay'],
    structureMaterial: 'earth',
    structure: { load: 0.48, span: 0.08, maxStoreys: 2 },
    durability: 0.54, fireResistance: 0.88,
    weathering: { rate: 0.62, mode: 'erode' },
    labour: 0.26, cost: 0.12,
    climate: { arid: 0.98, temperate: 0.56, wet: 0.16, cold: 0.34, snowy: 0.12, tropical: 0.28 },
    cultureAffinity: ['clay'],
    appearance: { program: 'adobe-render', color: 0xc0996c, roughness: 0.92, metalness: 0, transparency: 0, colorFamily: 'buff', textureScale: 0.6 },
  }),
  'wattle-and-daub': define({
    id: 'wattle-and-daub', label: 'Wattle and daub', family: 'earth-timber',
    roles: ['wall', 'infill'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['clay', 'plant-fiber'],
    structureMaterial: 'earth',
    structure: { load: 0.2, span: 0.06, maxStoreys: 2 },
    durability: 0.4, fireResistance: 0.32,
    weathering: { rate: 0.78, mode: 'stain' },
    labour: 0.18, cost: 0.06,
    climate: { temperate: 0.82, wet: 0.56, cold: 0.6, snowy: 0.44, arid: 0.5, tropical: 0.7 },
    cultureAffinity: ['wood', 'clay', 'mixed'],
    appearance: { program: 'daub-panel', color: 0xb49a74, roughness: 0.94, metalness: 0, transparency: 0, colorFamily: 'buff', textureScale: 0.5 },
  }),

  // ---------------------------------------------------------------- timber
  logs: define({
    id: 'logs', label: 'Logs', family: 'timber',
    roles: ['wall', 'frame', 'foundation'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['timber'],
    structureMaterial: 'timber',
    structure: { load: 0.6, span: 0.3, maxStoreys: 2 },
    durability: 0.66, fireResistance: 0.2,
    weathering: { rate: 0.4, mode: 'silver' },
    labour: 0.3, cost: 0.18,
    climate: { cold: 0.96, snowy: 0.95, temperate: 0.74, wet: 0.6, arid: 0.22 },
    cultureAffinity: ['wood'],
    appearance: { program: 'log-stack', color: 0x8a6a46, roughness: 0.9, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.28 },
  }),
  'rough-hewn-timber': define({
    id: 'rough-hewn-timber', label: 'Rough-hewn timber', family: 'timber',
    // Carries 'trim' as well as structure: a hewn lintel or door frame is the only trim a
    // neolithic building has, and it is the library's guaranteed early fallback for that role.
    roles: ['frame', 'wall', 'roof-structure', 'floor', 'trim'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['timber'],
    structureMaterial: 'timber',
    structure: { load: 0.5, span: 0.4, maxStoreys: 2 },
    durability: 0.55, fireResistance: 0.18,
    weathering: { rate: 0.48, mode: 'silver' },
    labour: 0.28, cost: 0.16,
    climate: { temperate: 0.86, cold: 0.82, wet: 0.62, snowy: 0.76, arid: 0.3, tropical: 0.7 },
    cultureAffinity: ['wood', 'mixed'],
    appearance: { program: 'hewn-timber', color: 0x7d5e3e, roughness: 0.92, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.2 },
  }),
  'heavy-timber': define({
    id: 'heavy-timber', label: 'Heavy timber', family: 'timber',
    roles: ['frame', 'roof-structure', 'floor'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: [], sourcedFrom: ['timber', 'lumber'],
    structureMaterial: 'timber',
    structure: { load: 0.68, span: 0.62, maxStoreys: 3 },
    durability: 0.72, fireResistance: 0.26,
    weathering: { rate: 0.32, mode: 'silver' },
    labour: 0.46, cost: 0.32,
    climate: { temperate: 0.9, cold: 0.86, wet: 0.68, snowy: 0.82, arid: 0.34, tropical: 0.66 },
    cultureAffinity: ['wood', 'mixed'],
    appearance: { program: 'hewn-timber', color: 0x6d5236, roughness: 0.88, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.26 },
  }),
  'sawn-lumber': define({
    id: 'sawn-lumber', label: 'Sawn lumber', family: 'timber',
    roles: ['frame', 'wall', 'roof-structure', 'floor', 'trim'],
    earliestPeriod: 'earlyModern', requiresCapabilities: ['mechanical-power'], sourcedFrom: ['lumber'],
    structureMaterial: 'timber',
    structure: { load: 0.58, span: 0.56, maxStoreys: 3 },
    durability: 0.64, fireResistance: 0.22,
    weathering: { rate: 0.36, mode: 'silver' },
    labour: 0.3, cost: 0.3,
    climate: { temperate: 0.9, cold: 0.84, snowy: 0.8, wet: 0.66, arid: 0.4 },
    cultureAffinity: ['wood', 'mixed'],
    appearance: { program: 'sawn-board', color: 0x9a7a52, roughness: 0.84, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.18 },
  }),
  'finished-wood': define({
    id: 'finished-wood', label: 'Finished wood', family: 'timber',
    roles: ['trim', 'glazing', 'floor', 'finish'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: [], sourcedFrom: ['lumber', 'timber'],
    structureMaterial: 'timber',
    structure: { load: 0.4, span: 0.3, maxStoreys: 1 },
    durability: 0.62, fireResistance: 0.2,
    weathering: { rate: 0.38, mode: 'bleach' },
    labour: 0.54, cost: 0.36,
    climate: { temperate: 0.86, cold: 0.8, snowy: 0.76, wet: 0.6, arid: 0.5 },
    cultureAffinity: ['wood', 'mixed'],
    appearance: { program: 'sawn-board', color: 0x6b4a2c, roughness: 0.66, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.12 },
  }),
  'wood-shingle': define({
    id: 'wood-shingle', label: 'Wood shingles', family: 'timber',
    roles: ['roof-covering', 'finish'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: [], sourcedFrom: ['timber', 'lumber'],
    structureMaterial: 'timber',
    structure: { load: 0.2, span: 0.1, maxStoreys: 1 },
    durability: 0.52, fireResistance: 0.14,
    weathering: { rate: 0.5, mode: 'silver' },
    labour: 0.4, cost: 0.24,
    climate: { cold: 0.88, snowy: 0.9, wet: 0.82, temperate: 0.8, arid: 0.3 },
    cultureAffinity: ['wood'],
    appearance: { program: 'shingle', color: 0x6f5840, roughness: 0.9, metalness: 0, transparency: 0, colorFamily: 'brown', textureScale: 0.16 },
  }),

  // ---------------------------------------------------------------- organic
  thatch: define({
    id: 'thatch', label: 'Thatch', family: 'organic',
    roles: ['roof-covering'],
    earliestPeriod: 'neolithic', requiresCapabilities: [], sourcedFrom: ['plant-fiber'],
    structureMaterial: 'earth',
    structure: { load: 0.08, span: 0.06, maxStoreys: 1 },
    durability: 0.26, fireResistance: 0.04,
    weathering: { rate: 0.85, mode: 'stain' },
    labour: 0.22, cost: 0.05,
    climate: { temperate: 0.84, wet: 0.74, tropical: 0.86, cold: 0.6, snowy: 0.34, arid: 0.44 },
    cultureAffinity: ['wood', 'clay', 'mixed'],
    appearance: { program: 'thatch', color: 0xa78a52, roughness: 0.97, metalness: 0, transparency: 0, colorFamily: 'ochre', textureScale: 0.33 },
  }),

  // ---------------------------------------------------------------- ceramic
  'fired-brick': define({
    id: 'fired-brick', label: 'Fired brick', family: 'ceramic',
    // Brick nogging panels a timber frame, and exposed brickwork is its own finish.
    roles: ['wall', 'foundation', 'frame', 'trim', 'infill', 'finish'],
    earliestPeriod: 'classical', requiresCapabilities: ['pottery-firing'], sourcedFrom: ['brick'],
    structureMaterial: 'ceramic',
    structure: { load: 0.82, span: 0.26, maxStoreys: 5 },
    durability: 0.88, fireResistance: 0.98,
    weathering: { rate: 0.26, mode: 'soot' },
    labour: 0.46, cost: 0.4,
    climate: { temperate: 0.9, wet: 0.8, cold: 0.82, snowy: 0.78, arid: 0.76, tropical: 0.74 },
    cultureAffinity: ['clay', 'mixed'],
    appearance: { program: 'brick-coursing', color: 0xa8543a, roughness: 0.82, metalness: 0.02, transparency: 0, colorFamily: 'red', textureScale: 0.075 },
  }),
  'buff-brick': define({
    id: 'buff-brick', label: 'Buff brick', family: 'ceramic',
    roles: ['wall', 'trim'],
    earliestPeriod: 'industrial', requiresCapabilities: ['pottery-firing', 'high-temperature-ceramics'], sourcedFrom: ['brick'],
    structureMaterial: 'ceramic',
    structure: { load: 0.82, span: 0.26, maxStoreys: 5 },
    durability: 0.88, fireResistance: 0.98,
    weathering: { rate: 0.3, mode: 'soot' },
    labour: 0.46, cost: 0.44,
    climate: { temperate: 0.88, wet: 0.78, cold: 0.8, snowy: 0.76, arid: 0.8 },
    cultureAffinity: ['clay'],
    appearance: { program: 'brick-coursing', color: 0xc3a572, roughness: 0.8, metalness: 0.02, transparency: 0, colorFamily: 'buff', textureScale: 0.075 },
  }),
  'clay-tile': define({
    id: 'clay-tile', label: 'Clay tile', family: 'ceramic',
    roles: ['roof-covering'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: ['pottery-firing'], sourcedFrom: ['brick', 'clay'],
    structureMaterial: 'ceramic',
    structure: { load: 0.3, span: 0.1, maxStoreys: 1 },
    durability: 0.82, fireResistance: 0.98,
    weathering: { rate: 0.24, mode: 'moss' },
    labour: 0.42, cost: 0.34,
    climate: { temperate: 0.9, arid: 0.86, wet: 0.74, cold: 0.72, snowy: 0.6, tropical: 0.8 },
    cultureAffinity: ['clay', 'mixed'],
    appearance: { program: 'tile-course', color: 0x3c4450, roughness: 0.74, metalness: 0.04, transparency: 0, colorFamily: 'grey', textureScale: 0.19 },
  }),
  terracotta: define({
    id: 'terracotta', label: 'Terracotta', family: 'ceramic',
    roles: ['roof-covering', 'finish', 'trim'],
    earliestPeriod: 'classical', requiresCapabilities: ['pottery-firing'], sourcedFrom: ['brick', 'clay'],
    structureMaterial: 'ceramic',
    structure: { load: 0.3, span: 0.1, maxStoreys: 1 },
    durability: 0.82, fireResistance: 0.98,
    weathering: { rate: 0.26, mode: 'bleach' },
    labour: 0.46, cost: 0.38,
    climate: { arid: 0.92, temperate: 0.88, tropical: 0.84, wet: 0.7, cold: 0.62, snowy: 0.5 },
    cultureAffinity: ['clay'],
    appearance: { program: 'terracotta', color: 0xb0563b, roughness: 0.78, metalness: 0.02, transparency: 0, colorFamily: 'red', textureScale: 0.2 },
  }),

  // ---------------------------------------------------------------- binder
  plaster: define({
    id: 'plaster', label: 'Plaster / stucco', family: 'binder',
    roles: ['finish', 'wall'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: ['stone-composites'], sourcedFrom: ['stone', 'clay'],
    structureMaterial: 'earth',
    structure: { load: 0.14, span: 0.04, maxStoreys: 1 },
    durability: 0.6, fireResistance: 0.92,
    weathering: { rate: 0.46, mode: 'stain' },
    labour: 0.34, cost: 0.2,
    climate: { arid: 0.88, temperate: 0.84, wet: 0.5, cold: 0.62, snowy: 0.52, tropical: 0.68 },
    cultureAffinity: ['clay', 'stone', 'mixed'],
    appearance: { program: 'plaster', color: 0xd8c6a4, roughness: 0.86, metalness: 0, transparency: 0, colorFamily: 'white', textureScale: 0.9 },
  }),
  concrete: define({
    id: 'concrete', label: 'Concrete', family: 'binder',
    roles: ['foundation', 'wall', 'floor', 'roof-structure', 'infill', 'finish', 'trim'],
    earliestPeriod: 'industrial', requiresCapabilities: ['industrial-chemistry'], sourcedFrom: ['stone'],
    structureMaterial: 'masonry',
    structure: { load: 0.9, span: 0.4, maxStoreys: 6 },
    durability: 0.9, fireResistance: 0.99,
    weathering: { rate: 0.4, mode: 'stain' },
    labour: 0.36, cost: 0.42,
    climate: { temperate: 0.86, arid: 0.86, wet: 0.74, cold: 0.78, snowy: 0.74, tropical: 0.8 },
    cultureAffinity: ['stone', 'mixed'],
    appearance: { program: 'concrete-form', color: 0x9b9890, roughness: 0.8, metalness: 0.02, transparency: 0, colorFamily: 'grey', textureScale: 1.2 },
  }),
  'reinforced-concrete': define({
    id: 'reinforced-concrete', label: 'Reinforced concrete', family: 'binder',
    roles: ['foundation', 'frame', 'wall', 'floor', 'roof-structure'],
    earliestPeriod: 'modern', requiresCapabilities: ['industrial-chemistry', 'standardized-parts'], sourcedFrom: ['stone', 'steel', 'iron'],
    structureMaterial: 'masonry',
    structure: { load: 0.97, span: 0.82, maxStoreys: 20 },
    durability: 0.96, fireResistance: 0.98,
    weathering: { rate: 0.34, mode: 'stain' },
    labour: 0.5, cost: 0.6,
    climate: { temperate: 0.9, arid: 0.88, wet: 0.8, cold: 0.84, snowy: 0.82, tropical: 0.84 },
    cultureAffinity: ['stone', 'metal', 'mixed'],
    appearance: { program: 'concrete-form', color: 0x8f8d88, roughness: 0.72, metalness: 0.04, transparency: 0, colorFamily: 'grey', textureScale: 1.6 },
  }),

  // ---------------------------------------------------------------- metal
  'wrought-iron': define({
    id: 'wrought-iron', label: 'Wrought iron', family: 'metal',
    roles: ['frame', 'hardware', 'trim', 'glazing'],
    earliestPeriod: 'medieval', requiresCapabilities: ['iron-working'], sourcedFrom: ['iron'],
    structureMaterial: 'metal',
    structure: { load: 0.7, span: 0.66, maxStoreys: 3 },
    durability: 0.8, fireResistance: 0.99,
    weathering: { rate: 0.5, mode: 'rust' },
    labour: 0.78, cost: 0.68,
    climate: { temperate: 0.8, arid: 0.86, cold: 0.78, snowy: 0.74, wet: 0.5 },
    cultureAffinity: ['metal'],
    appearance: { program: 'wrought-metal', color: 0x4a443e, roughness: 0.66, metalness: 0.52, transparency: 0, colorFamily: 'black', textureScale: 0.1 },
  }),
  'cast-iron': define({
    id: 'cast-iron', label: 'Cast iron', family: 'metal',
    // Cast-iron roof trusses carried the great industrial mill sheds.
    roles: ['frame', 'hardware', 'trim', 'roof-structure'],
    earliestPeriod: 'industrial', requiresCapabilities: ['iron-working', 'thermodynamics'], sourcedFrom: ['iron'],
    structureMaterial: 'metal',
    structure: { load: 0.88, span: 0.6, maxStoreys: 5 },
    durability: 0.84, fireResistance: 0.99,
    weathering: { rate: 0.44, mode: 'rust' },
    labour: 0.6, cost: 0.62,
    climate: { temperate: 0.82, arid: 0.86, cold: 0.8, snowy: 0.76, wet: 0.54 },
    cultureAffinity: ['metal'],
    appearance: { program: 'cast-metal', color: 0x44464a, roughness: 0.58, metalness: 0.6, transparency: 0, colorFamily: 'black', textureScale: 0.22 },
  }),
  steel: define({
    id: 'steel', label: 'Steel', family: 'metal',
    roles: ['frame', 'roof-structure', 'hardware', 'glazing', 'trim'],
    earliestPeriod: 'industrial', requiresCapabilities: ['thermodynamics', 'standardized-parts'], sourcedFrom: ['steel'],
    structureMaterial: 'metal',
    structure: { load: 0.92, span: 0.86, maxStoreys: 8 },
    durability: 0.92, fireResistance: 0.99,
    weathering: { rate: 0.38, mode: 'rust' },
    labour: 0.52, cost: 0.66,
    climate: { temperate: 0.86, arid: 0.88, cold: 0.84, snowy: 0.82, wet: 0.6 },
    cultureAffinity: ['metal', 'mixed'],
    appearance: { program: 'rolled-steel', color: 0x6f7882, roughness: 0.5, metalness: 0.68, transparency: 0, colorFamily: 'silver', textureScale: 0.3 },
  }),
  'structural-steel': define({
    id: 'structural-steel', label: 'Structural steel', family: 'metal',
    roles: ['frame', 'roof-structure'],
    earliestPeriod: 'industrial', requiresCapabilities: ['thermodynamics', 'standardized-parts', 'precision-manufacturing'], sourcedFrom: ['steel'],
    structureMaterial: 'metal',
    structure: { load: 0.97, span: 0.96, maxStoreys: 30 },
    durability: 0.96, fireResistance: 0.99,
    weathering: { rate: 0.3, mode: 'rust' },
    labour: 0.6, cost: 0.76,
    climate: { temperate: 0.88, arid: 0.9, cold: 0.86, snowy: 0.84, wet: 0.66 },
    cultureAffinity: ['metal'],
    appearance: { program: 'rolled-steel', color: 0x5f6974, roughness: 0.44, metalness: 0.74, transparency: 0, colorFamily: 'silver', textureScale: 0.4 },
  }),
  'corrugated-metal': define({
    id: 'corrugated-metal', label: 'Corrugated metal', family: 'metal',
    roles: ['wall', 'roof-covering', 'finish', 'infill'],
    earliestPeriod: 'industrial', requiresCapabilities: ['thermodynamics', 'rotary-machinery'], sourcedFrom: ['steel', 'iron'],
    structureMaterial: 'metal',
    structure: { load: 0.14, span: 0.2, maxStoreys: 1 },
    durability: 0.78, fireResistance: 0.99,
    weathering: { rate: 0.56, mode: 'rust' },
    labour: 0.18, cost: 0.26,
    climate: { arid: 0.84, temperate: 0.78, tropical: 0.7, cold: 0.6, snowy: 0.56, wet: 0.5 },
    cultureAffinity: ['metal', 'mixed'],
    appearance: { program: 'corrugated-sheet', color: 0x7b8289, roughness: 0.56, metalness: 0.62, transparency: 0, colorFamily: 'silver', textureScale: 0.11 },
  }),
  'sheet-metal': define({
    id: 'sheet-metal', label: 'Sheet metal', family: 'metal',
    roles: ['roof-covering', 'finish', 'trim'],
    earliestPeriod: 'industrial', requiresCapabilities: ['rotary-machinery'], sourcedFrom: ['steel', 'iron', 'copper'],
    structureMaterial: 'metal',
    structure: { load: 0.12, span: 0.18, maxStoreys: 1 },
    durability: 0.76, fireResistance: 0.99,
    weathering: { rate: 0.5, mode: 'rust' },
    labour: 0.26, cost: 0.3,
    climate: { temperate: 0.82, arid: 0.86, cold: 0.78, snowy: 0.78, wet: 0.6 },
    cultureAffinity: ['metal'],
    appearance: { program: 'standing-seam', color: 0x8a9298, roughness: 0.46, metalness: 0.68, transparency: 0, colorFamily: 'silver', textureScale: 0.5 },
  }),
  copper: define({
    id: 'copper', label: 'Copper', family: 'metal',
    roles: ['roof-covering', 'trim', 'hardware'],
    earliestPeriod: 'bronzeIron', requiresCapabilities: ['metal-smelting'], sourcedFrom: ['copper', 'bronze'],
    structureMaterial: 'metal',
    structure: { load: 0.14, span: 0.16, maxStoreys: 1 },
    durability: 0.88, fireResistance: 0.99,
    weathering: { rate: 0.4, mode: 'patina' },
    labour: 0.7, cost: 0.82,
    climate: { temperate: 0.86, wet: 0.8, cold: 0.82, snowy: 0.8, arid: 0.8 },
    cultureAffinity: ['metal'],
    appearance: { program: 'standing-seam', color: 0x8c6a43, roughness: 0.42, metalness: 0.72, transparency: 0, colorFamily: 'ochre', textureScale: 0.46 },
  }),
  aluminium: define({
    id: 'aluminium', label: 'Aluminium', family: 'metal',
    roles: ['finish', 'trim', 'glazing', 'infill', 'hardware'],
    earliestPeriod: 'modern', requiresCapabilities: ['industrial-chemistry', 'electrical-generation'], sourcedFrom: ['machine-parts', 'steel'],
    structureMaterial: 'metal',
    structure: { load: 0.2, span: 0.3, maxStoreys: 1 },
    durability: 0.86, fireResistance: 0.99,
    weathering: { rate: 0.18, mode: 'none' },
    labour: 0.3, cost: 0.56,
    climate: { temperate: 0.88, arid: 0.9, wet: 0.84, cold: 0.84, snowy: 0.82, tropical: 0.86 },
    cultureAffinity: ['metal'],
    appearance: { program: 'sheet-panel', color: 0xaeb4b8, roughness: 0.34, metalness: 0.74, transparency: 0, colorFamily: 'silver', textureScale: 0.8 },
  }),

  // ---------------------------------------------------------------- glazing / membrane
  glass: define({
    id: 'glass', label: 'Glass', family: 'glass',
    roles: ['glazing'],
    earliestPeriod: 'classical', requiresCapabilities: ['high-temperature-ceramics'], sourcedFrom: ['clay', 'stone'],
    structureMaterial: 'ceramic',
    structure: { load: 0.06, span: 0.12, maxStoreys: 1 },
    durability: 0.46, fireResistance: 0.94,
    weathering: { rate: 0.3, mode: 'stain' },
    labour: 0.72, cost: 0.74,
    climate: { cold: 0.9, snowy: 0.88, temperate: 0.84, wet: 0.82, arid: 0.6 },
    cultureAffinity: ['clay', 'metal', 'mixed'],
    appearance: { program: 'glazing', color: 0x9fb4b8, roughness: 0.14, metalness: 0.1, transparency: 0.5, colorFamily: 'clear', textureScale: 0.4 },
  }),
  'curtain-glass': define({
    id: 'curtain-glass', label: 'Curtain-wall glass', family: 'glass',
    roles: ['glazing', 'wall', 'finish', 'infill'],
    earliestPeriod: 'modern', requiresCapabilities: ['precision-manufacturing', 'industrial-chemistry'], sourcedFrom: ['clay', 'machine-parts'],
    structureMaterial: 'metal',
    structure: { load: 0.08, span: 0.2, maxStoreys: 1 },
    durability: 0.62, fireResistance: 0.94,
    weathering: { rate: 0.2, mode: 'stain' },
    labour: 0.5, cost: 0.78,
    climate: { temperate: 0.86, cold: 0.8, snowy: 0.78, arid: 0.64, wet: 0.84, tropical: 0.6 },
    cultureAffinity: ['metal'],
    appearance: { program: 'curtain-wall', color: 0x6e8894, roughness: 0.08, metalness: 0.24, transparency: 0.42, colorFamily: 'clear', textureScale: 1.4 },
  }),
  'asphalt-membrane': define({
    id: 'asphalt-membrane', label: 'Membrane roofing', family: 'membrane',
    roles: ['roof-covering'],
    earliestPeriod: 'modern', requiresCapabilities: ['industrial-chemistry'], sourcedFrom: ['coal', 'machine-parts'],
    structureMaterial: 'metal',
    structure: { load: 0.06, span: 0.08, maxStoreys: 1 },
    durability: 0.7, fireResistance: 0.5,
    weathering: { rate: 0.44, mode: 'bleach' },
    labour: 0.2, cost: 0.3,
    climate: { arid: 0.9, temperate: 0.84, tropical: 0.8, wet: 0.72, cold: 0.66, snowy: 0.5 },
    cultureAffinity: ['metal', 'mixed'],
    appearance: { program: 'membrane', color: 0x4b4a48, roughness: 0.88, metalness: 0.02, transparency: 0, colorFamily: 'black', textureScale: 2 },
  }),
};

/** Stable, de-duplicated list of every surface program the library uses. */
export const SURFACE_PROGRAMS: readonly SurfaceProgram[] = (() => {
  const seen = new Set<SurfaceProgram>();
  const order: SurfaceProgram[] = [];
  for (const id of ARCHITECTURAL_MATERIALS) {
    const program = MATERIAL_LIBRARY[id].appearance.program;
    if (seen.has(program)) continue;
    seen.add(program);
    order.push(program);
  }
  return order;
})();

export function architecturalMaterial(id: ArchitecturalMaterialId): ArchitecturalMaterialDefinition {
  return MATERIAL_LIBRARY[id];
}

export function isArchitecturalMaterial(id: string): id is ArchitecturalMaterialId {
  return Object.prototype.hasOwnProperty.call(MATERIAL_LIBRARY, id);
}

export function materialHasRole(id: ArchitecturalMaterialId, role: MaterialRole): boolean {
  return MATERIAL_LIBRARY[id].roles.includes(role);
}

/** Every material that can serve a role, in library order. */
export function materialsForRole(role: MaterialRole): readonly ArchitecturalMaterialId[] {
  return ARCHITECTURAL_MATERIALS.filter(id => MATERIAL_LIBRARY[id].roles.includes(role));
}

export interface MaterialAvailability {
  period: ArchitecturalPeriod;
  /** Capability ids in practice. Omitted means "do not gate on capability", for previews. */
  capabilities?: readonly string[];
}

/**
 * Can this material exist at all here? Period and process knowledge only — affordability and
 * local stock are separate questions answered by the resolver.
 */
export function materialAvailable(id: ArchitecturalMaterialId, availability: MaterialAvailability): boolean {
  const definition = MATERIAL_LIBRARY[id];
  if (!periodAtLeast(availability.period, definition.earliestPeriod)) return false;
  if (availability.capabilities === undefined) return true;
  if (definition.requiresCapabilities.length === 0) return true;
  const practised = new Set(availability.capabilities);
  return definition.requiresCapabilities.every(capability => practised.has(capability));
}

/** 0..1 suitability of a material for a climate. Unlisted zones are workable but unremarkable. */
export function climateSuitability(id: ArchitecturalMaterialId, zone: ClimateZone): number {
  return MATERIAL_LIBRARY[id].climate[zone] ?? 0.5;
}

/** 0..1 how strongly a culture's material bias reaches for this material. */
export function cultureAffinity(id: ArchitecturalMaterialId, bias: MaterialBias): number {
  const affinity = MATERIAL_LIBRARY[id].cultureAffinity;
  if (affinity.includes(bias)) return 1;
  if (affinity.includes('mixed') || bias === 'mixed') return 0.6;
  return 0.25;
}

/**
 * Index from simulation material kind to the architectural materials it evidences.
 * Built once; the resolver uses it to turn a project's bill of materials into a palette.
 */
export const MATERIALS_BY_SOURCE: ReadonlyMap<MaterialKind, readonly ArchitecturalMaterialId[]> = (() => {
  const index = new Map<MaterialKind, ArchitecturalMaterialId[]>();
  for (const id of ARCHITECTURAL_MATERIALS) {
    for (const kind of MATERIAL_LIBRARY[id].sourcedFrom) {
      const list = index.get(kind) ?? [];
      list.push(id);
      index.set(kind, list);
    }
  }
  return index;
})();

/** Materials a given simulation material kind can be built into. */
export function materialsFromKind(kind: MaterialKind): readonly ArchitecturalMaterialId[] {
  return MATERIALS_BY_SOURCE.get(kind) ?? [];
}

/**
 * Site-won materials need no entry in a bill of materials: earth, reed and cleared fieldstone
 * are gathered by the same hands that build. The resolver may always fall back to these.
 */
export function isSiteWon(id: ArchitecturalMaterialId): boolean {
  const definition = MATERIAL_LIBRARY[id];
  return definition.labour <= 0.35 && definition.cost <= 0.2 && periodRank(definition.earliestPeriod) === 0;
}
