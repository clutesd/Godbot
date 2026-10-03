/**
 * StructureVisualValidation.ts
 *
 * Does a settlement view still tell these structures apart?
 *
 * The profiles here are measured off assets produced by the production `AssetBuilder.getAsset`
 * path — the same grammar, the same architectural specification, the same composed geometry and
 * the same cached, shared materials the renderer draws. It deliberately does *not* resolve a
 * grammar of its own: doing so was a second architecture path that skipped `resolveBuildingSpec`
 * entirely, so it was validating a building the game never renders.
 *
 * Identity cues are read from the userData the composer publishes, which is why `midSignature`
 * and `farSignature` describe the asset on screen rather than a parallel derivation of it.
 */

import * as THREE from 'three';
import type { CultureStyle } from '../../sim/types';
import type { DevelopmentResponse, SettlementNeed, StructureForm, StructureMaterial } from '../../sim/development/types';
import type { Era } from '../materials/MaterialPalette';
import { BUILD_STAGE } from './BuildStages';
import { developmentBuildingRole } from './BuildingGrammar';
import type { StructureComponentManifest } from './StructureComponents';
import { AssetBuilder } from './AssetBuilder';

export interface ArchitectureGalleryCase {
  id: string;
  need: SettlementNeed;
  form: StructureForm;
  level: number;
  material: StructureMaterial;
  era: Era;
}

export interface StructureVisualProfile {
  id: string;
  role: string;
  /** The archetype the production path actually routed this response to. */
  archetype: string;
  /** The structural family the spec resolved for it. */
  family: string;
  width: number;
  depth: number;
  height: number;
  aspectRatio: number;
  verticality: number;
  meshCount: number;
  vertexCount: number;
  /** Distinct materials in the full-detail geometry. Shared palette materials, so this stays low. */
  materialCount: number;
  componentCount: number;
  generationCount: number;
  /** Street-facing treatment and skyline feature: the two strongest non-colour purpose cues. */
  frontage: string;
  crown: string;
  props: string;
  /** Normal GODBOX settlement-view cues: massing, large precinct features and silhouette. */
  midSignature: string;
  /** Skyline-level cues that should survive aggressive distance simplification. */
  farSignature: string;
}

export interface ArchitectureGallerySummary {
  profiles: StructureVisualProfile[];
  midSignatureCount: number;
  farSignatureCount: number;
  /** Distinct (frontage, crown) purpose cues — identity that does not depend on colour. */
  purposeCueCount: number;
  maxMeshes: number;
  maxVertices: number;
  /** Worst-case distinct materials on one structure. Proves the palette is shared, not cloned. */
  maxMaterials: number;
}

/** Representative structures used by CI and optional developer gallery rendering. */
export const ARCHITECTURE_GALLERY_CASES: readonly ArchitectureGalleryCase[] = [
  { id: 'government', need: 'government', form: 'hall', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'knowledge', need: 'knowledge', form: 'hall', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'healthcare', need: 'healthcare', form: 'hall', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'security', need: 'security', form: 'hall', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'religion', need: 'religion', form: 'sanctuary', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'trade', need: 'trade', form: 'store', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'transport', need: 'transport', form: 'store', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'manufacturing', need: 'manufacturing', form: 'workshop', level: 3, material: 'masonry', era: 'industrial' },
  { id: 'energy', need: 'energy', form: 'works', level: 3, material: 'metal', era: 'industrial' },
  { id: 'water', need: 'water', form: 'store', level: 3, material: 'masonry', era: 'preIndustrial' },
  { id: 'memory', need: 'memory', form: 'marker', level: 3, material: 'masonry', era: 'preIndustrial' },
] as const;

function responseForCase(cultureId: string, culture: CultureStyle, definition: ArchitectureGalleryCase): DevelopmentResponse {
  return {
    need: definition.need,
    form: definition.form,
    name: `validation-${definition.id}`,
    level: definition.level,
    material: definition.material,
    cultureId,
    style: culture,
    services: { [definition.need]: definition.level },
    reasons: ['architecture-validation'],
    capabilities: [],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: definition.level,
  };
}

function seedFor(definition: ArchitectureGalleryCase): string {
  // Same base seed for the same form/level/era prevents ordinary procedural jitter from creating
  // artificial separation between semantic peers such as four hall-based institutions.
  return `architecture-gallery:${definition.form}:${definition.level}:${definition.era}`;
}

function meshMetrics(group: THREE.Object3D): { meshCount: number; vertexCount: number; materialCount: number } {
  let meshCount = 0;
  let vertexCount = 0;
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount++;
    vertexCount += object.geometry.getAttribute('position')?.count ?? 0;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
  });
  return { meshCount, vertexCount, materialCount: materials.size };
}

function quantize(value: number, step: number): number {
  return Math.round(value / step);
}

const readString = (data: Record<string, unknown>, key: string, fallback = 'none'): string => {
  const value = data[key];
  return typeof value === 'string' ? value : fallback;
};
const readNumber = (data: Record<string, unknown>, key: string, fallback = 0): number => {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const readFlag = (data: Record<string, unknown>, key: string): number => (data[key] === true ? 1 : 0);

/**
 * The full-detail geometry inside a production asset.
 *
 * A completed building comes back as a `THREE.LOD` whose level 0 is the full composition; an
 * in-progress one is a bare group. Measuring the whole LOD root would count the mid and far
 * tiers as if they were part of the building, so level 0 is what is profiled.
 */
export function fullDetailOf(asset: THREE.Object3D): THREE.Object3D {
  if (asset instanceof THREE.LOD) return asset.levels[0]?.object ?? asset;
  return asset;
}

/**
 * Generate a deterministic readability profile from a production asset.
 *
 * `midSignature` intentionally ignores tiny ornament and colour; it asks whether a normal
 * settlement view can still distinguish large architectural purpose cues.
 */
export function profileArchitectureCase(
  builder: AssetBuilder,
  cultureId: string,
  culture: CultureStyle,
  definition: ArchitectureGalleryCase,
): StructureVisualProfile {
  const development = responseForCase(cultureId, culture, definition);
  const role = developmentBuildingRole(development);
  const asset = builder.getAsset('building', {
    seed: seedFor(definition),
    culture,
    era: definition.era,
    variant: `${role}#${BUILD_STAGE.DETAIL}`,
    development,
  });

  const data = asset.mesh.userData as Record<string, unknown>;
  const detail = fullDetailOf(asset.mesh);
  const box = new THREE.Box3().setFromObject(detail);
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const height = box.max.y - box.min.y;
  const aspectRatio = width / Math.max(0.001, depth);
  const verticality = height / Math.max(0.001, Math.max(width, depth));
  const { meshCount, vertexCount, materialCount } = meshMetrics(detail);
  const manifest = data['structureComponents'] as StructureComponentManifest | undefined;

  const massing = readString(data, 'grammarMassing');
  const roofFamily = readString(data, 'grammarRoofFamily');
  const roofTiers = readNumber(data, 'grammarRoofTiers', 1);
  const frontage = readString(data, 'grammarFrontage');
  const crown = readString(data, 'grammarCrown');

  const midSignature = [
    massing,
    quantize(aspectRatio, 0.12),
    quantize(verticality, 0.12),
    roofFamily,
    Math.min(4, roofTiers),
    frontage,
    crown,
    readFlag(data, 'grammarGateway'),
    readFlag(data, 'grammarForecourt'),
    readString(data, 'grammarEnclosure'),
    readString(data, 'grammarVeranda'),
    readNumber(data, 'grammarChimneys') > 0 ? 1 : 0,
    readNumber(data, 'grammarVents') > 0 ? 1 : 0,
  ].join(':');

  const farSignature = [
    massing,
    quantize(aspectRatio, 0.24),
    quantize(verticality, 0.18),
    roofFamily,
    Math.min(3, roofTiers),
    crown,
    readNumber(data, 'grammarChimneys') > 0 ? 1 : 0,
    readNumber(data, 'grammarVents') > 0 ? 1 : 0,
  ].join(':');

  // Nothing is disposed here. The geometry and materials belong to the builder's cache, which is
  // the whole point of measuring the shared asset; the caller disposes the builder instead.
  return {
    id: definition.id,
    role,
    archetype: readString(data, 'architectureArchetype', '—'),
    family: readString(data, 'structuralFamily', '—'),
    width,
    depth,
    height,
    aspectRatio,
    verticality,
    meshCount,
    vertexCount,
    materialCount,
    componentCount: manifest?.components.length ?? 0,
    generationCount: manifest?.generations.length ?? 0,
    frontage,
    crown,
    props: readString(data, 'grammarProps'),
    midSignature,
    farSignature,
  };
}

/**
 * Profile every gallery case through one shared AssetBuilder.
 *
 * One builder on purpose: the cases are measured against the same cache the renderer uses, so
 * the mesh and material counts reported are the shared ones rather than per-call clones.
 */
export function architectureGallerySummary(cultureId: string, culture: CultureStyle): ArchitectureGallerySummary {
  const builder = new AssetBuilder('architecture-validation');
  try {
    const profiles = ARCHITECTURE_GALLERY_CASES.map(
      definition => profileArchitectureCase(builder, cultureId, culture, definition),
    );
    return {
      profiles,
      midSignatureCount: new Set(profiles.map(profile => profile.midSignature)).size,
      farSignatureCount: new Set(profiles.map(profile => profile.farSignature)).size,
      purposeCueCount: new Set(profiles.map(profile => `${profile.frontage}/${profile.crown}`)).size,
      maxMeshes: Math.max(...profiles.map(profile => profile.meshCount)),
      maxVertices: Math.max(...profiles.map(profile => profile.vertexCount)),
      maxMaterials: Math.max(...profiles.map(profile => profile.materialCount)),
    };
  } finally {
    builder.dispose();
  }
}

/**
 * Optional developer scene: a deterministic grid of the same validation structures used by CI.
 * Clones share cached geometry/materials, so opening the gallery is representative of runtime
 * asset reuse rather than creating a separate showcase rendering path.
 */
export function buildArchitectureGalleryScene(
  builder: AssetBuilder,
  cultureId: string,
  culture: CultureStyle,
  spacing = 6,
): THREE.Group {
  const gallery = new THREE.Group();
  gallery.name = 'architecture-validation-gallery';
  ARCHITECTURE_GALLERY_CASES.forEach((definition, index) => {
    const development = responseForCase(cultureId, culture, definition);
    const role = developmentBuildingRole(development);
    const asset = builder.getAsset('building', {
      seed: seedFor(definition),
      culture,
      era: definition.era,
      variant: `${role}#${BUILD_STAGE.DETAIL}`,
      development,
    });
    const clone = asset.mesh.clone(true);
    const column = index % 4;
    const row = Math.floor(index / 4);
    clone.position.set(column * spacing, 0, row * spacing);
    clone.userData['architectureGalleryCase'] = definition.id;
    gallery.add(clone);
  });
  return gallery;
}
