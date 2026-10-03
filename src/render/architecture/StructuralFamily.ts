/**
 * StructuralFamily.ts
 *
 * How a building stands up — the layer between materials and archetypes.
 *
 * A structural family is the reason a timber barn, a stone barn and a steel barn are not one
 * geometry with three textures. Each family carries the metrics that actually change form:
 * how thick its walls are, how far apart its bays sit, how wide an opening it dares, how much
 * of its frame shows on the outside, how far it can roof without a middle support, how steep
 * that roof wants to be, and what it stands on. The composer reads those numbers; it does not
 * special-case families.
 *
 * Material choice per role is expressed as a *ranked preference list*, not a fixed answer. The
 * resolver scores those candidates against period, practised capability, climate, culture,
 * wealth and — above all — what the settlement's project actually consumed. That is what keeps
 * one small set of families producing believable buildings across five thousand years instead
 * of needing a bespoke family per century.
 */

import type { ArchitecturalMaterialId, MaterialRole } from './MaterialLibrary';
import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { periodRank } from './ArchitecturalPeriod';

export const STRUCTURAL_FAMILIES = [
  'primitive-shelter',
  'timber-post-and-beam',
  'log-construction',
  'timber-frame',
  'mud-brick',
  'adobe',
  'stone-masonry',
  'classical-stone',
  'mixed-masonry',
  'brick-masonry',
  'heavy-industrial-brick',
  'steel-industrial-frame',
  'reinforced-concrete',
  'curtain-wall-frame',
] as const;

export type StructuralFamily = (typeof STRUCTURAL_FAMILIES)[number];

/** What the building sits on. Visible as much as structural. */
export type FoundationStyle =
  | 'none'
  | 'packed-earth'
  | 'stone-footing'
  | 'sill-beam'
  | 'masonry-plinth'
  | 'brick-footing'
  | 'concrete-pad'
  | 'concrete-raft'
  | 'pile-cap';

/**
 * The family's read at settlement distance, before any detail resolves. This is the single
 * strongest legibility cue, so it is named rather than derived.
 */
export type FamilySilhouette =
  | 'low-organic'
  | 'stacked-log'
  | 'framed-bay'
  | 'earthen-mass'
  | 'masonry-mass'
  | 'arcaded'
  | 'industrial-shed'
  | 'frame-grid'
  | 'slab-stack'
  | 'curtain-tower';

/** How the wall is put together, which decides what the composer emits for one wall bay. */
export type WallAssembly =
  | 'hide-and-brush'
  | 'stacked-log'
  | 'infilled-frame'
  | 'monolithic-earth'
  | 'coursed-masonry'
  | 'load-bearing-brick'
  | 'clad-frame'
  | 'cast-monolith'
  | 'glazed-curtain';

/** Ranked material candidates per role. Earlier entries are preferred when equally credible. */
export type MaterialPreferences = Partial<Record<MaterialRole, readonly ArchitecturalMaterialId[]>>;

export interface StructuralFamilyDefinition {
  id: StructuralFamily;
  label: string;
  /** First period this way of building exists. The resolver never selects it earlier. */
  earliestPeriod: ArchitecturalPeriod;
  /**
   * Last period in which this family is still the obvious choice. Past it the family remains
   * legal — vernacular persists — but the resolver stops preferring it for new, developed work.
   */
  customaryUntil: ArchitecturalPeriod;

  // ----- metrics that change geometry -----
  /** Wall thickness in canonical building units (one unit is roughly six metres). */
  wallThickness: number;
  /** Centre-to-centre structural bay spacing, same units. */
  baySpacing: number;
  /** Multiplier on the archetype's reference opening width. */
  openingWidth: number;
  /** Multiplier on the archetype's reference opening height. */
  openingHeight: number;
  /** 0..1 how much of the load-bearing frame is visible on the elevation. */
  frameExposure: number;
  /** 0..1 density of posts, piers and braces within a bay. */
  supportDensity: number;
  /** Clear roof span achievable without an intermediate support, in canonical units. */
  maxRoofSpan: number;
  /** Multiplier on the archetype's reference roof pitch. */
  roofPitchBias: number;
  /** Most storeys this family credibly carries. */
  maxStoreys: number;
  /** Plinth height as a share of one storey. */
  plinthShare: number;
  foundation: FoundationStyle;
  silhouette: FamilySilhouette;
  wallAssembly: WallAssembly;
  /** Families that finish at a parapet rather than an eave read as urban or industrial. */
  parapetProne: boolean;
  /** 0..1 how much the family tolerates being built by unskilled hands. */
  vernacular: number;

  preferences: MaterialPreferences;
}

const define = (definition: StructuralFamilyDefinition): StructuralFamilyDefinition => definition;

export const STRUCTURAL_FAMILY_LIBRARY: Record<StructuralFamily, StructuralFamilyDefinition> = {
  'primitive-shelter': define({
    id: 'primitive-shelter', label: 'Primitive shelter', earliestPeriod: 'neolithic', customaryUntil: 'neolithic',
    wallThickness: 0.018, baySpacing: 0.3, openingWidth: 0.6, openingHeight: 0.62,
    frameExposure: 0.85, supportDensity: 0.3, maxRoofSpan: 0.6, roofPitchBias: 1.55,
    maxStoreys: 1, plinthShare: 0, foundation: 'none',
    silhouette: 'low-organic', wallAssembly: 'hide-and-brush', parapetProne: false, vernacular: 1,
    preferences: {
      foundation: ['fieldstone'],
      frame: ['rough-hewn-timber', 'logs'],
      wall: ['wattle-and-daub', 'rough-hewn-timber'],
      infill: ['wattle-and-daub'],
      'roof-structure': ['rough-hewn-timber'],
      'roof-covering': ['thatch'],
      trim: ['rough-hewn-timber'],
    },
  }),

  'timber-post-and-beam': define({
    id: 'timber-post-and-beam', label: 'Timber post-and-beam', earliestPeriod: 'neolithic', customaryUntil: 'medieval',
    wallThickness: 0.026, baySpacing: 0.36, openingWidth: 0.85, openingHeight: 0.8,
    frameExposure: 0.78, supportDensity: 0.52, maxRoofSpan: 1.0, roofPitchBias: 1.18,
    maxStoreys: 2, plinthShare: 0.06, foundation: 'stone-footing',
    silhouette: 'framed-bay', wallAssembly: 'infilled-frame', parapetProne: false, vernacular: 0.86,
    preferences: {
      foundation: ['fieldstone', 'rubble-masonry'],
      frame: ['heavy-timber', 'rough-hewn-timber'],
      wall: ['wattle-and-daub', 'rough-hewn-timber'],
      infill: ['wattle-and-daub', 'mud-brick'],
      finish: ['adobe', 'plaster'],
      'roof-structure': ['heavy-timber', 'rough-hewn-timber'],
      'roof-covering': ['thatch', 'wood-shingle', 'clay-tile'],
      trim: ['finished-wood', 'rough-hewn-timber'],
      glazing: ['finished-wood'],
      hardware: ['wrought-iron', 'copper'],
    },
  }),

  'log-construction': define({
    id: 'log-construction', label: 'Log construction', earliestPeriod: 'neolithic', customaryUntil: 'industrial',
    wallThickness: 0.052, baySpacing: 0.48, openingWidth: 0.6, openingHeight: 0.68,
    frameExposure: 0.3, supportDensity: 0.28, maxRoofSpan: 0.85, roofPitchBias: 1.42,
    maxStoreys: 2, plinthShare: 0.08, foundation: 'stone-footing',
    silhouette: 'stacked-log', wallAssembly: 'stacked-log', parapetProne: false, vernacular: 0.92,
    preferences: {
      foundation: ['fieldstone', 'rubble-masonry'],
      frame: ['logs', 'heavy-timber'],
      wall: ['logs'],
      infill: ['wattle-and-daub'],
      'roof-structure': ['heavy-timber', 'rough-hewn-timber'],
      'roof-covering': ['wood-shingle', 'thatch', 'slate'],
      trim: ['finished-wood', 'rough-hewn-timber'],
      glazing: ['finished-wood', 'glass'],
      hardware: ['wrought-iron'],
    },
  }),

  'timber-frame': define({
    id: 'timber-frame', label: 'Timber frame', earliestPeriod: 'classical', customaryUntil: 'earlyModern',
    wallThickness: 0.03, baySpacing: 0.28, openingWidth: 0.95, openingHeight: 0.92,
    frameExposure: 0.92, supportDensity: 0.72, maxRoofSpan: 1.25, roofPitchBias: 1.3,
    maxStoreys: 3, plinthShare: 0.1, foundation: 'masonry-plinth',
    silhouette: 'framed-bay', wallAssembly: 'infilled-frame', parapetProne: false, vernacular: 0.62,
    preferences: {
      foundation: ['rubble-masonry', 'fieldstone', 'dressed-stone', 'fired-brick'],
      frame: ['heavy-timber', 'sawn-lumber', 'rough-hewn-timber'],
      wall: ['wattle-and-daub', 'fired-brick', 'sawn-lumber'],
      infill: ['wattle-and-daub', 'fired-brick', 'mud-brick'],
      finish: ['plaster', 'adobe'],
      'roof-structure': ['heavy-timber', 'sawn-lumber'],
      'roof-covering': ['clay-tile', 'slate', 'wood-shingle', 'thatch'],
      trim: ['finished-wood', 'sawn-lumber'],
      glazing: ['glass', 'finished-wood'],
      hardware: ['wrought-iron', 'copper'],
    },
  }),

  'mud-brick': define({
    id: 'mud-brick', label: 'Mud brick', earliestPeriod: 'neolithic', customaryUntil: 'classical',
    wallThickness: 0.078, baySpacing: 0.4, openingWidth: 0.5, openingHeight: 0.6,
    frameExposure: 0.12, supportDensity: 0.22, maxRoofSpan: 0.6, roofPitchBias: 0.42,
    maxStoreys: 2, plinthShare: 0.1, foundation: 'stone-footing',
    silhouette: 'earthen-mass', wallAssembly: 'monolithic-earth', parapetProne: true, vernacular: 0.95,
    preferences: {
      foundation: ['fieldstone', 'rubble-masonry'],
      frame: ['rough-hewn-timber', 'heavy-timber'],
      wall: ['mud-brick', 'adobe'],
      infill: ['mud-brick'],
      finish: ['adobe', 'plaster'],
      'roof-structure': ['rough-hewn-timber', 'heavy-timber'],
      'roof-covering': ['adobe', 'thatch', 'clay-tile'],
      trim: ['finished-wood', 'rough-hewn-timber'],
      glazing: ['finished-wood'],
      hardware: ['copper', 'wrought-iron'],
    },
  }),

  adobe: define({
    id: 'adobe', label: 'Adobe', earliestPeriod: 'neolithic', customaryUntil: 'industrial',
    wallThickness: 0.088, baySpacing: 0.42, openingWidth: 0.46, openingHeight: 0.58,
    frameExposure: 0.08, supportDensity: 0.2, maxRoofSpan: 0.65, roofPitchBias: 0.34,
    maxStoreys: 2, plinthShare: 0.12, foundation: 'stone-footing',
    silhouette: 'earthen-mass', wallAssembly: 'monolithic-earth', parapetProne: true, vernacular: 0.9,
    preferences: {
      foundation: ['fieldstone', 'rubble-masonry', 'limestone'],
      frame: ['heavy-timber', 'rough-hewn-timber'],
      wall: ['adobe', 'mud-brick'],
      infill: ['adobe'],
      finish: ['adobe', 'plaster'],
      'roof-structure': ['heavy-timber', 'rough-hewn-timber'],
      'roof-covering': ['adobe', 'clay-tile', 'terracotta'],
      trim: ['finished-wood'],
      glazing: ['finished-wood', 'glass'],
      hardware: ['copper', 'wrought-iron'],
    },
  }),

  'stone-masonry': define({
    id: 'stone-masonry', label: 'Stone masonry', earliestPeriod: 'bronzeIron', customaryUntil: 'earlyModern',
    wallThickness: 0.095, baySpacing: 0.46, openingWidth: 0.52, openingHeight: 0.72,
    frameExposure: 0.1, supportDensity: 0.34, maxRoofSpan: 0.95, roofPitchBias: 1.22,
    maxStoreys: 4, plinthShare: 0.14, foundation: 'masonry-plinth',
    silhouette: 'masonry-mass', wallAssembly: 'coursed-masonry', parapetProne: false, vernacular: 0.5,
    preferences: {
      foundation: ['rubble-masonry', 'fieldstone', 'granite', 'dressed-stone'],
      frame: ['dressed-stone', 'heavy-timber', 'ashlar'],
      wall: ['fieldstone', 'rubble-masonry', 'sandstone', 'limestone', 'dressed-stone'],
      infill: ['rubble-masonry'],
      finish: ['plaster'],
      'roof-structure': ['heavy-timber', 'rough-hewn-timber'],
      'roof-covering': ['slate', 'clay-tile', 'wood-shingle', 'thatch'],
      trim: ['dressed-stone', 'finished-wood'],
      glazing: ['glass', 'finished-wood'],
      hardware: ['wrought-iron', 'copper'],
    },
  }),

  'classical-stone': define({
    id: 'classical-stone', label: 'Classical dressed stone', earliestPeriod: 'classical', customaryUntil: 'earlyModern',
    wallThickness: 0.082, baySpacing: 0.52, openingWidth: 0.72, openingHeight: 1.05,
    frameExposure: 0.46, supportDensity: 0.58, maxRoofSpan: 1.1, roofPitchBias: 0.86,
    maxStoreys: 3, plinthShare: 0.22, foundation: 'masonry-plinth',
    silhouette: 'arcaded', wallAssembly: 'coursed-masonry', parapetProne: true, vernacular: 0.14,
    preferences: {
      foundation: ['ashlar', 'dressed-stone', 'granite', 'rubble-masonry'],
      frame: ['ashlar', 'dressed-stone', 'granite'],
      wall: ['ashlar', 'dressed-stone', 'limestone', 'sandstone'],
      infill: ['rubble-masonry', 'fired-brick'],
      finish: ['plaster', 'terracotta'],
      'roof-structure': ['heavy-timber'],
      'roof-covering': ['clay-tile', 'terracotta', 'copper', 'slate'],
      trim: ['ashlar', 'dressed-stone', 'terracotta'],
      glazing: ['glass', 'finished-wood'],
      hardware: ['copper', 'wrought-iron'],
    },
  }),

  'mixed-masonry': define({
    id: 'mixed-masonry', label: 'Mixed masonry', earliestPeriod: 'medieval', customaryUntil: 'industrial',
    wallThickness: 0.07, baySpacing: 0.42, openingWidth: 0.7, openingHeight: 0.88,
    frameExposure: 0.26, supportDensity: 0.42, maxRoofSpan: 1.05, roofPitchBias: 1.12,
    maxStoreys: 4, plinthShare: 0.14, foundation: 'masonry-plinth',
    silhouette: 'masonry-mass', wallAssembly: 'coursed-masonry', parapetProne: false, vernacular: 0.44,
    preferences: {
      foundation: ['dressed-stone', 'rubble-masonry', 'fired-brick', 'concrete'],
      frame: ['heavy-timber', 'dressed-stone', 'wrought-iron'],
      wall: ['dressed-stone', 'fired-brick', 'limestone', 'rubble-masonry'],
      infill: ['fired-brick', 'rubble-masonry'],
      finish: ['plaster'],
      'roof-structure': ['heavy-timber', 'sawn-lumber'],
      'roof-covering': ['slate', 'clay-tile', 'wood-shingle'],
      trim: ['dressed-stone', 'finished-wood'],
      glazing: ['glass'],
      hardware: ['wrought-iron', 'copper'],
    },
  }),

  'brick-masonry': define({
    id: 'brick-masonry', label: 'Brick masonry', earliestPeriod: 'classical', customaryUntil: 'modern',
    wallThickness: 0.058, baySpacing: 0.38, openingWidth: 0.82, openingHeight: 0.95,
    frameExposure: 0.18, supportDensity: 0.4, maxRoofSpan: 1.1, roofPitchBias: 1.0,
    maxStoreys: 5, plinthShare: 0.12, foundation: 'brick-footing',
    silhouette: 'masonry-mass', wallAssembly: 'load-bearing-brick', parapetProne: true, vernacular: 0.36,
    preferences: {
      foundation: ['concrete', 'dressed-stone', 'fired-brick', 'rubble-masonry'],
      frame: ['cast-iron', 'heavy-timber', 'sawn-lumber', 'wrought-iron'],
      wall: ['fired-brick', 'buff-brick'],
      infill: ['fired-brick'],
      finish: ['plaster', 'terracotta'],
      'roof-structure': ['sawn-lumber', 'heavy-timber', 'steel'],
      'roof-covering': ['slate', 'clay-tile', 'sheet-metal'],
      trim: ['dressed-stone', 'terracotta', 'finished-wood'],
      glazing: ['glass', 'wrought-iron'],
      hardware: ['wrought-iron', 'cast-iron'],
    },
  }),

  'heavy-industrial-brick': define({
    id: 'heavy-industrial-brick', label: 'Heavy industrial brick', earliestPeriod: 'industrial', customaryUntil: 'modern',
    wallThickness: 0.072, baySpacing: 0.62, openingWidth: 1.25, openingHeight: 1.3,
    frameExposure: 0.34, supportDensity: 0.5, maxRoofSpan: 1.7, roofPitchBias: 0.6,
    maxStoreys: 4, plinthShare: 0.1, foundation: 'concrete-pad',
    silhouette: 'industrial-shed', wallAssembly: 'load-bearing-brick', parapetProne: true, vernacular: 0.1,
    preferences: {
      foundation: ['concrete', 'dressed-stone', 'fired-brick'],
      frame: ['cast-iron', 'steel', 'wrought-iron'],
      wall: ['fired-brick', 'buff-brick'],
      infill: ['fired-brick', 'corrugated-metal'],
      finish: ['fired-brick'],
      'roof-structure': ['steel', 'cast-iron', 'heavy-timber'],
      'roof-covering': ['sheet-metal', 'corrugated-metal', 'slate'],
      trim: ['dressed-stone', 'cast-iron'],
      glazing: ['glass', 'steel', 'wrought-iron'],
      hardware: ['cast-iron', 'steel'],
    },
  }),

  'steel-industrial-frame': define({
    id: 'steel-industrial-frame', label: 'Steel industrial frame', earliestPeriod: 'industrial', customaryUntil: 'contemporary',
    wallThickness: 0.022, baySpacing: 0.95, openingWidth: 1.7, openingHeight: 1.5,
    frameExposure: 0.68, supportDensity: 0.3, maxRoofSpan: 2.8, roofPitchBias: 0.42,
    maxStoreys: 3, plinthShare: 0.06, foundation: 'concrete-pad',
    silhouette: 'industrial-shed', wallAssembly: 'clad-frame', parapetProne: false, vernacular: 0.06,
    preferences: {
      foundation: ['concrete', 'reinforced-concrete'],
      frame: ['structural-steel', 'steel', 'cast-iron'],
      wall: ['corrugated-metal', 'fired-brick', 'concrete'],
      infill: ['corrugated-metal', 'fired-brick'],
      finish: ['corrugated-metal', 'sheet-metal'],
      'roof-structure': ['structural-steel', 'steel'],
      'roof-covering': ['corrugated-metal', 'sheet-metal', 'asphalt-membrane'],
      trim: ['steel', 'aluminium'],
      glazing: ['glass', 'steel'],
      hardware: ['steel', 'cast-iron'],
    },
  }),

  'reinforced-concrete': define({
    id: 'reinforced-concrete', label: 'Reinforced concrete', earliestPeriod: 'modern', customaryUntil: 'contemporary',
    wallThickness: 0.042, baySpacing: 0.72, openingWidth: 1.3, openingHeight: 1.18,
    frameExposure: 0.5, supportDensity: 0.36, maxRoofSpan: 2.0, roofPitchBias: 0.26,
    maxStoreys: 12, plinthShare: 0.05, foundation: 'concrete-raft',
    silhouette: 'slab-stack', wallAssembly: 'cast-monolith', parapetProne: true, vernacular: 0.04,
    preferences: {
      foundation: ['reinforced-concrete', 'concrete'],
      frame: ['reinforced-concrete', 'structural-steel'],
      wall: ['concrete', 'reinforced-concrete', 'fired-brick'],
      infill: ['concrete', 'fired-brick'],
      finish: ['plaster', 'concrete', 'aluminium'],
      'roof-structure': ['reinforced-concrete', 'structural-steel'],
      'roof-covering': ['asphalt-membrane', 'sheet-metal'],
      trim: ['concrete', 'aluminium'],
      glazing: ['glass', 'curtain-glass', 'aluminium'],
      hardware: ['steel'],
    },
  }),

  'curtain-wall-frame': define({
    id: 'curtain-wall-frame', label: 'Curtain-wall frame', earliestPeriod: 'modern', customaryUntil: 'contemporary',
    wallThickness: 0.016, baySpacing: 0.62, openingWidth: 1.9, openingHeight: 1.6,
    frameExposure: 0.4, supportDensity: 0.26, maxRoofSpan: 2.4, roofPitchBias: 0.12,
    maxStoreys: 30, plinthShare: 0.04, foundation: 'pile-cap',
    silhouette: 'curtain-tower', wallAssembly: 'glazed-curtain', parapetProne: true, vernacular: 0,
    preferences: {
      foundation: ['reinforced-concrete'],
      frame: ['structural-steel', 'reinforced-concrete'],
      wall: ['curtain-glass', 'concrete'],
      infill: ['curtain-glass', 'aluminium'],
      finish: ['aluminium', 'curtain-glass'],
      'roof-structure': ['structural-steel', 'reinforced-concrete'],
      'roof-covering': ['asphalt-membrane', 'sheet-metal'],
      trim: ['aluminium'],
      glazing: ['curtain-glass', 'glass'],
      hardware: ['steel', 'aluminium'],
    },
  }),
};

export function structuralFamily(id: StructuralFamily): StructuralFamilyDefinition {
  return STRUCTURAL_FAMILY_LIBRARY[id];
}

export function isStructuralFamily(id: string): id is StructuralFamily {
  return Object.prototype.hasOwnProperty.call(STRUCTURAL_FAMILY_LIBRARY, id);
}

/** Families that could physically be built in a period, in library order. */
export function familiesAvailableIn(period: ArchitecturalPeriod): readonly StructuralFamily[] {
  return STRUCTURAL_FAMILIES.filter(id => periodRank(STRUCTURAL_FAMILY_LIBRARY[id].earliestPeriod) <= periodRank(period));
}

/**
 * 0..1 how customary a family still is in a period.
 *
 * 1 while the family is in its own window, then decaying rather than cutting off: a log barn in
 * an industrial valley is unusual but not impossible, and vernacular families decay slowest.
 */
export function familyCustom(id: StructuralFamily, period: ArchitecturalPeriod): number {
  const definition = STRUCTURAL_FAMILY_LIBRARY[id];
  const now = periodRank(period);
  const earliest = periodRank(definition.earliestPeriod);
  if (now < earliest) return 0;
  const customary = periodRank(definition.customaryUntil);
  if (now <= customary) return 1;
  const overdue = now - customary;
  // A highly vernacular family persists for centuries; a specialised one is quickly superseded.
  const persistence = 0.3 + definition.vernacular * 0.55;
  return Math.max(0, 1 - overdue * (1 - persistence));
}

/** Ranked candidates this family offers for a role, or an empty list if it has no opinion. */
export function familyPreferences(id: StructuralFamily, role: MaterialRole): readonly ArchitecturalMaterialId[] {
  return STRUCTURAL_FAMILY_LIBRARY[id].preferences[role] ?? [];
}
