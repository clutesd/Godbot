import type { DevelopmentResponse, SettlementNeed, StructureForm, StructureMaterial } from '../../sim/development/types';
import type { BuildingGrammar } from './BuildingGrammar';
import { BUILD_STAGE, type BuildStage } from './BuildingComposer';
import {
  deriveArchitecturalGenerations,
  generationForAnnex,
  generationForCurrentFabric,
  generationForOriginFabric,
  type ArchitecturalGeneration,
  type ArchitecturalGenerationKind,
  type ArchitecturalGenerationModel,
} from './StructureGenerations';

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
  generationId: string;
  generationOrdinal: number;
  generationKind: ArchitecturalGenerationKind;
  material: StructureMaterial;
  need?: SettlementNeed;
  form?: StructureForm;
  cultureId?: string;
  /** Why this component belongs to this generation. */
  reason: 'original-fabric' | 'surviving-fabric' | 'generation-addition' | 'current-construction';
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

export interface DevelopmentEnvelopeStage {
  generationId: string;
  share: number;
  extentX: number;
  extentZ: number;
}

export interface StructureDevelopmentEnvelope {
  /** Full canonical site reach already reserved by the structure's persistent plot. */
  extentX: number;
  extentZ: number;
  stages: DevelopmentEnvelopeStage[];
}

export interface StructureComponentManifest {
  version: 2;
  role: string;
  era: string;
  components: StructureComponent[];
  generations: ArchitecturalGeneration[];
  omittedTransitionCount: number;
  developmentEnvelope: StructureDevelopmentEnvelope;
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

function fallbackGeneration(grammar: BuildingGrammar, development?: DevelopmentResponse): ArchitecturalGeneration {
  return {
    id: 'g0-current', ordinal: 0, kind: 'current', action: 'current',
    need: development?.need ?? 'housing',
    form: development?.form ?? 'dwelling',
    level: development?.level ?? 1,
    material: development?.material ?? inferredMaterial(grammar),
    cultureId: development?.cultureId ?? 'unrecorded',
    institutionId: development?.institutionId,
    envelopeShare: 1,
    rebuiltAfterLoss: false,
  };
}

function provenanceForGeneration(
  generation: ArchitecturalGeneration,
  model: ArchitecturalGenerationModel,
): ComponentProvenance {
  const last = generationForCurrentFabric(model);
  const phase: StructureFabricPhase = generation.ordinal === 0 && model.generations.length > 1
    ? 'origin'
    : generation.id === last.id
      ? 'current'
      : 'legacy';
  return {
    phase,
    generationId: generation.id,
    generationOrdinal: generation.ordinal,
    generationKind: generation.kind,
    material: generation.material,
    need: generation.need,
    form: generation.form,
    cultureId: generation.cultureId,
    reason: generation.rebuiltAfterLoss
      ? 'surviving-fabric'
      : phase === 'origin'
        ? 'original-fabric'
        : phase === 'current'
          ? 'current-construction'
          : 'generation-addition',
  };
}

function add(
  components: StructureComponent[],
  component: Omit<StructureComponent, 'supportIds'> & { supportIds?: string[] },
): void {
  if (components.some(existing => existing.id === component.id)) throw new Error(`Duplicate structure component id: ${component.id}`);
  components.push({ ...component, supportIds: component.supportIds ?? [] });
}

function visualSignature(
  components: StructureComponent[],
  generationModel: ArchitecturalGenerationModel,
): string {
  return [generationModel.visualSignature, ...components.map(component => [
    component.id,
    component.kind,
    component.buildStage,
    component.loadBearing ? 1 : 0,
    component.provenance.phase,
    component.provenance.generationId,
    component.provenance.generationKind,
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
  ].join('.'))].join('||');
}

function developmentEnvelope(model: ArchitecturalGenerationModel, metrics: StructureComponentMetrics): StructureDevelopmentEnvelope {
  return {
    extentX: metrics.extentX,
    extentZ: metrics.extentZ,
    stages: model.generations.map(generation => ({
      generationId: generation.id,
      share: generation.envelopeShare,
      extentX: metrics.extentX * generation.envelopeShare,
      extentZ: metrics.extentZ * generation.envelopeShare,
    })),
  };
}

/**
 * Build the structural contract for one canonical procedural building.
 *
 * This function deliberately does not alter geometry. It mirrors the grammar's deterministic
 * massing into stable logical components while the existing composer keeps batching geometry by
 * material surface. Each component is assigned to a compact architectural generation, allowing
 * later damage and repair to target a specific century of fabric rather than the whole building.
 */
export function buildStructureComponentManifest(
  grammar: BuildingGrammar,
  development: DevelopmentResponse | undefined,
  metrics: StructureComponentMetrics,
): StructureComponentManifest {
  const components: StructureComponent[] = [];
  const generationModel = development
    ? deriveArchitecturalGenerations(development)
    : { generations: [fallbackGeneration(grammar)], omittedTransitionCount: 0, nonFabricTransitionCount: 0, visualSignature: 'unrecorded' };
  const originGeneration = generationForOriginFabric(generationModel);
  const currentGeneration = generationForCurrentFabric(generationModel);
  const origin = provenanceForGeneration(originGeneration, generationModel);
  const current = provenanceForGeneration(currentGeneration, generationModel);
  const halfWidth = grammar.width / 2;
  const halfDepth = grammar.depth / 2;
  const wallBottom = Math.max(0, grammar.plinthHeight);
  const wallHeight = grammar.wallHeight * grammar.storeys;
  const wallTop = wallBottom + wallHeight;
  const roofHeight = Math.max(0.08, metrics.height - wallTop);
  const coreKind: StructureComponentKind = development?.form === 'tower' || grammar.role === 'gate-tower' ? 'tower' : 'core';

  // Open productive / gathering sites still have architectural generations: the ground belongs
  // to the founding fabric while rebuilt fixtures and later market canopies can belong to newer layers.
  if (development?.form === 'field' || development?.form === 'gathering' && development.level === 1) {
    add(components, {
      id: 'ground:site',
      kind: 'productive-ground',
      bounds: bounds(0, 0.012, 0, metrics.extentX, 0.03, metrics.extentZ),
      buildStage: BUILD_STAGE.FOUNDATION,
      loadBearing: false,
      provenance: origin,
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
    const envelope = developmentEnvelope(generationModel, metrics);
    return {
      version: 2,
      role: grammar.role,
      era: grammar.era,
      components,
      generations: generationModel.generations,
      omittedTransitionCount: generationModel.omittedTransitionCount,
      developmentEnvelope: envelope,
      visualSignature: visualSignature(components, generationModel),
    };
  }

  add(components, {
    id: 'foundation:main',
    kind: 'foundation',
    bounds: bounds(0, Math.max(0.025, grammar.plinthHeight / 2), 0, grammar.width * 1.08, Math.max(0.05, grammar.plinthHeight), grammar.depth * 1.08),
    buildStage: BUILD_STAGE.FOUNDATION,
    loadBearing: true,
    provenance: origin,
  });
  add(components, {
    id: 'frame:core',
    kind: 'frame',
    bounds: bounds(0, wallBottom + wallHeight / 2, 0, grammar.width, wallHeight, grammar.depth),
    buildStage: BUILD_STAGE.FRAME,
    loadBearing: true,
    supportIds: ['foundation:main'],
    parentId: 'foundation:main',
    provenance: origin,
  });
  add(components, {
    id: 'core:main',
    kind: coreKind,
    bounds: bounds(0, wallBottom + wallHeight / 2, 0, grammar.width, wallHeight, grammar.depth),
    buildStage: BUILD_STAGE.WALLS,
    loadBearing: true,
    supportIds: ['foundation:main', 'frame:core'],
    parentId: 'frame:core',
    provenance: origin,
  });
  add(components, {
    id: 'roof:main',
    kind: 'roof',
    bounds: bounds(0, wallTop + roofHeight / 2, 0, grammar.width * (1 + grammar.eaveOverhang * 1.6), roofHeight, grammar.depth * (1 + grammar.eaveOverhang * 1.6)),
    buildStage: BUILD_STAGE.ROOF,
    loadBearing: false,
    supportIds: ['frame:core', 'core:main'],
    parentId: 'core:main',
    provenance: origin,
  });

  const annexHeight = wallHeight * 0.72;
  const annexRoofY = wallBottom + annexHeight + Math.max(0.05, roofHeight * 0.28) / 2;
  const annexSpecs: Array<{ id: string; x: number; z: number; sx: number; sz: number }> = [];
  if (grammar.massing === 'wing') {
    annexSpecs.push({ id: 'east', x: halfWidth * 0.72, z: -halfDepth * 0.95, sx: grammar.width * 0.44, sz: grammar.depth * 0.6 });
  } else if (grammar.massing === 'twin') {
    annexSpecs.push(
      { id: 'west', x: -halfWidth * 0.86, z: halfDepth * 0.5, sx: grammar.width * 0.34, sz: grammar.depth * 0.38 },
      { id: 'east', x: halfWidth * 0.86, z: halfDepth * 0.5, sx: grammar.width * 0.34, sz: grammar.depth * 0.38 },
    );
  } else if (grammar.massing === 'court') {
    annexSpecs.push(
      { id: 'west', x: -halfWidth * 1.02, z: halfDepth * 1.1, sx: grammar.width * 0.26, sz: grammar.depth * 0.75 },
      { id: 'east', x: halfWidth * 1.02, z: halfDepth * 1.1, sx: grammar.width * 0.26, sz: grammar.depth * 0.75 },
    );
  }

  annexSpecs.forEach((spec, index) => {
    const generation = generationForAnnex(generationModel, index, annexSpecs.length);
    const provenance = provenanceForGeneration(generation, generationModel);
    add(components, {
      id: `annex:${spec.id}`,
      kind: 'annex',
      bounds: bounds(spec.x, wallBottom + annexHeight / 2, spec.z, spec.sx, annexHeight, spec.sz),
      buildStage: BUILD_STAGE.WALLS,
      loadBearing: true,
      supportIds: ['foundation:main'],
      parentId: 'core:main',
      provenance,
    });
    add(components, {
      id: `roof:annex:${spec.id}`,
      kind: 'roof',
      bounds: bounds(spec.x, annexRoofY, spec.z, spec.sx * 1.08, Math.max(0.05, roofHeight * 0.28), spec.sz * 1.08),
      buildStage: BUILD_STAGE.ROOF,
      loadBearing: false,
      supportIds: [`annex:${spec.id}`],
      parentId: `annex:${spec.id}`,
      provenance,
    });
  });

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
    const enclosureGeneration = generationModel.generations.find(generation => generation.kind === 'conversion' || generation.kind === 'rebuild') ?? currentGeneration;
    add(components, {
      id: 'enclosure:perimeter',
      kind: 'enclosure',
      bounds: bounds(0, grammar.enclosure === 'court' ? 0.1 : 0.08, 0, grammar.width * (grammar.enclosure === 'court' ? 2.05 : 1.8), 0.22, grammar.depth * (grammar.enclosure === 'court' ? 2.05 : 1.8)),
      buildStage: BUILD_STAGE.DETAIL,
      loadBearing: false,
      provenance: provenanceForGeneration(enclosureGeneration, generationModel),
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

  const envelope = developmentEnvelope(generationModel, metrics);
  return {
    version: 2,
    role: grammar.role,
    era: grammar.era,
    components,
    generations: generationModel.generations,
    omittedTransitionCount: generationModel.omittedTransitionCount,
    developmentEnvelope: envelope,
    visualSignature: visualSignature(components, generationModel),
  };
}

/** Prefix canonical local ids with the persistent plot id without changing cached geometry. */
export function instantiateStructureComponentIds(plotId: string, manifest: StructureComponentManifest): string[] {
  return manifest.components.map(component => `${plotId}:${component.id}`);
}
