import * as THREE from 'three';
import type { CultureStyle } from '../../sim/types';
import type { DevelopmentResponse, SettlementNeed, StructureForm, StructureMaterial } from '../../sim/development/types';
import { CultureStyleProfileFactory } from '../style/CultureStyleProfile';
import { MaterialPalette, type Era } from '../materials/MaterialPalette';
import { BUILD_STAGE, composeBuilding } from './BuildingComposer';
import { developmentBuildingRole, resolveBuildingGrammar } from './BuildingGrammar';
import { buildStructureComponentManifest } from './StructureComponents';
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
  width: number;
  depth: number;
  height: number;
  aspectRatio: number;
  verticality: number;
  meshCount: number;
  vertexCount: number;
  componentCount: number;
  generationCount: number;
  /** Normal GODBOX settlement-view cues: massing, large precinct features and silhouette. */
  midSignature: string;
  /** Skyline-level cues that should survive aggressive distance simplification. */
  farSignature: string;
}

export interface ArchitectureGallerySummary {
  profiles: StructureVisualProfile[];
  midSignatureCount: number;
  farSignatureCount: number;
  maxMeshes: number;
  maxVertices: number;
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

function meshMetrics(group: THREE.Group): { meshCount: number; vertexCount: number } {
  let meshCount = 0;
  let vertexCount = 0;
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount++;
    vertexCount += object.geometry.getAttribute('position')?.count ?? 0;
  });
  return { meshCount, vertexCount };
}

function quantize(value: number, step: number): number {
  return Math.round(value / step);
}

/**
 * Generate a deterministic readability profile from the same grammar/composer path used by the
 * renderer. `midSignature` intentionally ignores tiny ornament and colour; it asks whether a
 * normal settlement view can still distinguish large architectural purpose cues.
 */
export function profileArchitectureCase(
  cultureId: string,
  culture: CultureStyle,
  definition: ArchitectureGalleryCase,
): StructureVisualProfile {
  const development = responseForCase(cultureId, culture, definition);
  const profile = CultureStyleProfileFactory.createFromCulture(cultureId, culture);
  const role = developmentBuildingRole(development);
  const seed = seedFor(definition);
  const grammar = resolveBuildingGrammar(profile, definition.era, role, seed, development);
  const palette = new MaterialPalette({ culture, era: definition.era });
  const composed = composeBuilding(grammar, palette, seed, BUILD_STAGE.DETAIL);
  const manifest = buildStructureComponentManifest(grammar, development, composed);
  const box = new THREE.Box3().setFromObject(composed.group);
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const height = box.max.y - box.min.y;
  const aspectRatio = width / Math.max(0.001, depth);
  const verticality = height / Math.max(0.001, Math.max(width, depth));
  const { meshCount, vertexCount } = meshMetrics(composed.group);

  const midSignature = [
    grammar.massing,
    quantize(aspectRatio, 0.12),
    quantize(verticality, 0.12),
    grammar.roofFamily,
    Math.min(4, grammar.roofTiers),
    grammar.gateway ? 1 : 0,
    grammar.forecourt ? 1 : 0,
    grammar.enclosure,
    grammar.veranda,
    grammar.chimneys > 0 ? 1 : 0,
    grammar.vents > 0 ? 1 : 0,
  ].join(':');

  const farSignature = [
    grammar.massing,
    quantize(aspectRatio, 0.24),
    quantize(verticality, 0.18),
    grammar.roofFamily,
    Math.min(3, grammar.roofTiers),
    grammar.chimneys > 0 ? 1 : 0,
    grammar.vents > 0 ? 1 : 0,
  ].join(':');

  composed.group.traverse(object => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
  palette.dispose();

  return {
    id: definition.id,
    role,
    width,
    depth,
    height,
    aspectRatio,
    verticality,
    meshCount,
    vertexCount,
    componentCount: manifest.components.length,
    generationCount: manifest.generations.length,
    midSignature,
    farSignature,
  };
}

export function architectureGallerySummary(cultureId: string, culture: CultureStyle): ArchitectureGallerySummary {
  const profiles = ARCHITECTURE_GALLERY_CASES.map(definition => profileArchitectureCase(cultureId, culture, definition));
  return {
    profiles,
    midSignatureCount: new Set(profiles.map(profile => profile.midSignature)).size,
    farSignatureCount: new Set(profiles.map(profile => profile.farSignature)).size,
    maxMeshes: Math.max(...profiles.map(profile => profile.meshCount)),
    maxVertices: Math.max(...profiles.map(profile => profile.vertexCount)),
  };
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
