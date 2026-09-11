import type { DevelopmentResponse, SettlementNeed, StructureForm, StructureMaterial } from '../../sim/development/types';
import type { BuildingGrammar } from './BuildingGrammar';
import { BUILD_STAGE, type BuildStage } from './BuildingComposer';
import { deriveStructureHeritage } from './StructureHeritage';

export type StructureComponentKind =
  | 'foundation'
  | 'frame'
  | 'core'
  | 'tower'
  | 'annex'
  | 'roof'
  | 'veranda'
  | 'gateway'
  | 'enclosure'
  | 'forecourt'
  | 'stack'
  | 'vent'
  | 'productive-ground'
  | 'market-fixture';

export type StructureFabricPhase = 'origin' | 'legacy' | 'current';

export interface ComponentBounds {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

export interface ComponentProvenance {
  phase: StructureFabricPhase;
  material: StructureMaterial;
  need?: SettlementNeed;
  form?: StructureForm;
  cultureId?: string;
  /** Why this fabric is considered part of this generation. Presentation-only provenance. */
  reason: 'original-fabric' | 'surviving-fabric' | 'current-construction';
}

/**
 * Stable logical component emitted alongside the batched geometry.
 *
 * `id` is local to one building and deliberately semantic rather than random. A placed building
 * gets its globally stable id by prefixing the plot id, e.g. `plot-17:roof:main`.
 * Geometry may remain merged by material/surface for performance; this contract is the durable
 * structural map future damage/repair code can use to recompose only the affected logical parts.
 */
export interface StructureComponent {
  id: string;
  kind: StructureComponentKind;
  bounds: ComponentBounds;
  buildStage: BuildStage;
  loadBearing: boolean;
  supportIds: string[];
  parentId?: string;
  provenance: ComponentProvenance;
}

export interface StructureComponentManifest {
  version: 1;
  role: string;
  era: string;
  components: StructureComponent[];
  /** Geometry-relevant signature only; intentionally excludes event months and narrative text. */
  visualSignature: string;
}

export interface StructureComponentMetrics {
  height: number;
  extentX: number;
  extentZ: number;
}

const clampPositive = (value: number, minimum = 0.01): number => Math.max(minimum, value);

function bounds(x: number, y: number, z: number, sx: number, sy: number, sz: number): ComponentBounds {
  return {
    center: { x, y, z },
    size: { x: clampPositive(sx), y: clampPositive(sy), z: clampPositive(sz) },
  };
}

function inferredMaterial(grammar: BuildingGrammar): StructureMaterial {
  if (grammar.postStyle === 'steel' || grammar.postStyle === 'composite' || grammar.wallLayer === 'panel') return 'metal';
  if (grammar.wallLayer === 'stone') return 'masonry';
  if (grammar.wallLayer === 'brick') return 'ceramic';
  if (grammar.wallLayer === 'daub' && grammar.postStyle === 'timber') return 'timber';
  return 'earth';
}

function currentProvenance(grammar: BuildingGrammar, development?: DevelopmentResponse): ComponentProvenance {
  return {
    phase: 'current',
    material: development?.material ?? inferredMaterial(grammar),
    need: development?.need,
    form: development?.form,
    cultureId: development?.cultureId,
    reason: 'current-construction',
  };
}

function inheritedProvenance(grammar: BuildingGrammar, development?: DevelopmentResponse): ComponentProvenance {
  if (!development) return currentProvenance(grammar, development);
  const heritage = deriveStructureHeritage(development);
  if (!heritage || heritage.preservation < 0.24 || !(heritage.materialShift || heritage.needShift || heritage.cultureShift || heritage.survivedRuin)) {
    return currentProvenance(grammar, development);
  }
  return {
    phase: heritage.legacyNeed === heritage.originNeed
      && heritage.legacyForm === heritage.originForm
      && heritage.legacyMaterial === heritage.originMaterial
      && heritage.legacyCultureId === heritage.originCultureId ? 'origin' : 'legacy',
    material: heritage.legacyMaterial,
    need: heritage.legacyNeed,
    form: heritage.legacyForm,
    cultureId: heritage.legacyCultureId,
    reason: heritage.survivedRuin ? 'surviving-fabric' : 'original-fabric',
  };
}

function add(
  components: StructureComponent[],
  component: Omit<StructureComponent, 'supportIds'> & { supportIds?: string[] },
): void {
  if (components.some(existing => existing.id === component.id)) throw new Error(`Duplicate structure component id: ${component.id}`);
  components.push({ ...component, supportIds: component.supportIds ?? [] });
}

function visualSignature(components: StructureComponent[]): string {
  return components.map(component => [
    component.id,
    component.kind,
    component.buildStage,
    component.loadBearing ? 1 : 0,
    component.provenance.phase,
    component.provenance.material,
    component.provenance.need ?? '-',
    component.provenance.form ?? '-',
    component.provenance.cultureId ?? '-',
    component.bounds.center.x.toFixed(2),
    component.bounds.center.y.toFixed(2),
    component.bounds.center.z.toFixed(2),
    component.bounds.size.x.toFixed(2),
    component.bounds.size.y.toFixed(2),
    component.bounds.size.z.toFixed(2),
  ].join('.')).join('|');
}

/**
 * Build the structural contract for one canonical procedural building.
 *
 * This function deliberately does not alter geometry. It mirrors the grammar's deterministic
 * massing into stable logical components while the existing composer keeps batching geometry by
 * material surface. Damage can later mask/recompose these ids without paying one draw call per bay.
 */
export function buildStructureComponentManifest(
  grammar: BuildingGrammar,
  development: DevelopmentResponse | undefined,
  metrics: StructureComponentMetrics,
): StructureComponentManifest {
  const components: StructureComponent[] = [];
  const current = currentProvenance(grammar, development);
  const inherited = inheritedProvenance(grammar, development);
  const halfWidth = grammar.width / 2;
  const halfDepth = grammar.depth / 2;
  const wallBottom = Math.max(0, grammar.plinthHeight);
  const wallHeight = grammar.wallHeight * grammar.storeys;
  const wallTop = wallBottom + wallHeight;
  const roofHeight = Math.max(0.08, metrics.height - wallTop);
  const coreKind: StructureComponentKind = development?.form === 'tower' || grammar.role === 'gate-tower' ? 'tower' : 'core';

  // Open productive / gathering sites use a different physical vocabulary but still receive
  // stable components so floods, fire and abandonment can target them later.
  if (development?.form === 'field' || development?.form === 'gathering' && development.level === 1) {
    add(components, {
      id: 'ground:site',
      kind: 'productive-ground',
      bounds: bounds(0, 0.012, 0, metrics.extentX, 0.03, metrics.extentZ),
      buildStage: BUILD_STAGE.FOUNDATION,
      loadBearing: false,
      provenance: current,
    });
    add(components, {
      id: development.form === 'field' ? 'field:rows' : 'gathering:fixtures',
      kind: development.form === 'field' ? 'productive-ground' : 'market-fixture',
      bounds: bounds(0, development.form === 'field' ? 0.06 : 0.22, 0, metrics.extentX * 0.82, development.form === 'field' ? 0.12 : 0.5, metrics.extentZ * 0.78),
      buildStage: development.form === 'field' ? BUILD_STAGE.WALLS : BUILD_STAGE.FRAME,
      loadBearing: false,
      supportIds: ['ground:site'],
      parentId: 'ground:site',
      provenance: current,
    });
    if (development.form === 'gathering' && development.need === 'trade') {
      add(components, {
        id: 'market:canopies',
        kind: 'market-fixture',
        bounds: bounds(0, 0.58, 0, metrics.extentX * 0.72, 0.12, metrics.extentZ * 0.68),
        buildStage: BUILD_STAGE.ROOF,
        loadBearing: false,
        supportIds: ['gathering:fixtures'],
        parentId: 'gathering:fixtures',
        provenance: current,
      });
    }
    return { version: 1, role: grammar.role, era: grammar.era, components, visualSignature: visualSignature(components) };
  }

  add(components, {
    id: 'foundation:main',
    kind: 'foundation',
    bounds: bounds(0, Math.max(0.025, grammar.plinthHeight / 2), 0, grammar.width * 1.08, Math.max(0.05, grammar.plinthHeight), grammar.depth * 1.08),
    buildStage: BUILD_STAGE.FOUNDATION,
    loadBearing: true,
    provenance: inherited.phase === 'current' ? current : inherited,
  });
  add(components, {
    id: 'frame:core',
    kind: 'frame',
    bounds: bounds(0, wallBottom + wallHeight / 2, 0, grammar.width, wallHeight, grammar.depth),
    buildStage: BUILD_STAGE.FRAME,
    loadBearing: true,
    supportIds: ['foundation:main'],
    parentId: 'foundation:main',
    provenance: inherited,
  });
  add(components, {
    id: 'core:main',
    kind: coreKind,
    bounds: bounds(0, wallBottom + wallHeight / 2, 0, grammar.width, wallHeight, grammar.depth),
    buildStage: BUILD_STAGE.WALLS,
    loadBearing: true,
    supportIds: ['foundation:main', 'frame:core'],
    parentId: 'frame:core',
    provenance: inherited,
  });
  add(components, {
    id: 'roof:main',
    kind: 'roof',
    bounds: bounds(0, wallTop + roofHeight / 2, 0, grammar.width * (1 + grammar.eaveOverhang * 1.6), roofHeight, grammar.depth * (1 + grammar.eaveOverhang * 1.6)),
    buildStage: BUILD_STAGE.ROOF,
    loadBearing: false,
    supportIds: ['frame:core', 'core:main'],
    parentId: 'core:main',
    provenance: inherited,
  });

  const annexHeight = wallHeight * 0.72;
  const annexRoofY = wallBottom + annexHeight + Math.max(0.05, roofHeight * 0.28) / 2;
  const addAnnex = (id: string, x: number, z: number, sx: number, sz: number): void => {
    add(components, {
      id: `annex:${id}`,
      kind: 'annex',
      bounds: bounds(x, wallBottom + annexHeight / 2, z, sx, annexHeight, sz),
      buildStage: BUILD_STAGE.WALLS,
      loadBearing: true,
      supportIds: ['foundation:main'],
      parentId: 'core:main',
      provenance: current,
    });
    add(components, {
      id: `roof:annex:${id}`,
      kind: 'roof',
      bounds: bounds(x, annexRoofY, z, sx * 1.08, Math.max(0.05, roofHeight * 0.28), sz * 1.08),
      buildStage: BUILD_STAGE.ROOF,
      loadBearing: false,
      supportIds: [`annex:${id}`],
      parentId: `annex:${id}`,
      provenance: current,
    });
  };

  if (grammar.massing === 'wing') {
    addAnnex('east', halfWidth * 0.72, -halfDepth * 0.95, grammar.width * 0.44, grammar.depth * 0.6);
  } else if (grammar.massing === 'twin') {
    addAnnex('west', -halfWidth * 0.86, halfDepth * 0.5, grammar.width * 0.34, grammar.depth * 0.38);
    addAnnex('east', halfWidth * 0.86, halfDepth * 0.5, grammar.width * 0.34, grammar.depth * 0.38);
  } else if (grammar.massing === 'court') {
    addAnnex('west', -halfWidth * 1.02, halfDepth * 1.1, grammar.width * 0.26, grammar.depth * 0.75);
    addAnnex('east', halfWidth * 1.02, halfDepth * 1.1, grammar.width * 0.26, grammar.depth * 0.75);
  }

  if (grammar.forecourt) {
    add(components, {
      id: 'forecourt:front',
      kind: 'forecourt',
      bounds: bounds(0, 0.015, halfDepth * 1.5, grammar.width * 1.9, 0.04, grammar.depth * 1.5),
      buildStage: BUILD_STAGE.FOUNDATION,
      loadBearing: false,
      provenance: current,
    });
  }
  if (grammar.veranda !== 'none') {
    add(components, {
      id: grammar.veranda === 'wrap' ? 'veranda:wrap' : 'veranda:front',
      kind: 'veranda',
      bounds: bounds(0, Math.max(0.05, grammar.plinthHeight / 2), grammar.veranda === 'front' ? halfDepth * 1.12 : 0, grammar.width * (grammar.veranda === 'wrap' ? 1.2 : 1.05), Math.max(0.1, grammar.plinthHeight + 0.08), grammar.depth * (grammar.veranda === 'wrap' ? 1.2 : 0.24)),
      buildStage: BUILD_STAGE.DETAIL,
      loadBearing: false,
      supportIds: ['foundation:main'],
      parentId: 'core:main',
      provenance: current,
    });
  }
  if (grammar.gateway) {
    add(components, {
      id: 'gateway:front',
      kind: 'gateway',
      bounds: bounds(0, wallTop * 0.52, halfDepth * (grammar.forecourt ? 2.5 : 1.75), grammar.width * 1.05, wallTop * 1.08, grammar.postThickness * 5),
      buildStage: BUILD_STAGE.DETAIL,
      loadBearing: false,
      supportIds: grammar.forecourt ? ['forecourt:front'] : ['foundation:main'],
      provenance: current,
    });
  }
  if (grammar.enclosure !== 'none') {
    add(components, {
      id: 'enclosure:perimeter',
      kind: 'enclosure',
      bounds: bounds(0, grammar.enclosure === 'court' ? 0.1 : 0.08, 0, grammar.width * (grammar.enclosure === 'court' ? 2.05 : 1.8), 0.22, grammar.depth * (grammar.enclosure === 'court' ? 2.05 : 1.8)),
      buildStage: BUILD_STAGE.DETAIL,
      loadBearing: false,
      provenance: inherited.phase === 'current' ? current : inherited,
    });
  }

  for (let index = 0; index < grammar.chimneys; index += 1) {
    const x = (index % 2 === 0 ? -1 : 1) * halfWidth * (0.3 + Math.floor(index / 2) * 0.22);
    add(components, {
      id: `stack:chimney:${index}`,
      kind: 'stack',
      bounds: bounds(x, metrics.height * 0.76, -halfDepth * 0.28, Math.max(0.08, grammar.postThickness * 2.2), metrics.height * 0.46, Math.max(0.08, grammar.postThickness * 2.2)),
      buildStage: BUILD_STAGE.ROOF,
      loadBearing: false,
      supportIds: ['roof:main'],
      parentId: 'roof:main',
      provenance: current,
    });
  }
  for (let index = 0; index < grammar.vents; index += 1) {
    const x = grammar.vents === 1 ? 0 : -halfWidth * 0.55 + (grammar.width * 0.55 * index) / Math.max(1, grammar.vents - 1);
    add(components, {
      id: `stack:vent:${index}`,
      kind: 'vent',
      bounds: bounds(x, metrics.height * 0.72, halfDepth * 0.08, Math.max(0.06, grammar.postThickness * 1.6), metrics.height * 0.3, Math.max(0.06, grammar.postThickness * 1.6)),
      buildStage: BUILD_STAGE.ROOF,
      loadBearing: false,
      supportIds: ['roof:main'],
      parentId: 'roof:main',
      provenance: current,
    });
  }

  return {
    version: 1,
    role: grammar.role,
    era: grammar.era,
    components,
    visualSignature: visualSignature(components),
  };
}

/** Prefix canonical local ids with the persistent plot id without changing cached geometry. */
export function instantiateStructureComponentIds(plotId: string, manifest: StructureComponentManifest): string[] {
  return manifest.components.map(component => `${plotId}:${component.id}`);
}
