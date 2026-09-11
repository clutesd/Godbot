import { describe, expect, it } from 'vitest';
import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse, StructureDevelopment, StructureHistoryEntry } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { developmentBuildingRole } from '../src/render/assets/BuildingGrammar';
import { heritageFingerprint } from '../src/render/assets/StructureHeritage';
import { structureVisualHistorySignature } from '../src/render/assets/StructureVisualSignature';
import {
  ARCHITECTURE_GALLERY_CASES,
  architectureGallerySummary,
  buildArchitectureGalleryScene,
} from '../src/render/assets/StructureVisualValidation';
import type { StructureComponentManifest } from '../src/render/assets/StructureComponents';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

function currentResponse(institutionId = 'keepers-a'): DevelopmentResponse {
  return {
    need: 'knowledge',
    form: 'hall',
    name: 'academy',
    level: 3,
    material: 'masonry',
    cultureId: 'gallery-culture',
    style: CULTURE,
    institutionId,
    services: { knowledge: 3 },
    reasons: ['validation'],
    capabilities: ['durable-records', 'scientific-method'],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 3,
  };
}

function historicalAcademy(monthOffset: number, institutionId = 'keepers-a', originMaterial: 'timber' | 'earth' = 'timber'): StructureDevelopment {
  const current = currentResponse(institutionId);
  const origin: StructureHistoryEntry = {
    month: monthOffset,
    action: 'founded',
    name: 'old shrine',
    need: 'religion',
    form: 'sanctuary',
    level: 1,
    material: originMaterial,
    cultureId: 'gallery-culture',
    institutionId,
    reasons: ['founding'],
  };
  return {
    ...current,
    status: 'active',
    origin,
    history: [
      { ...origin, month: monthOffset + 120, action: 'expanded', level: 2 },
      {
        ...origin,
        month: monthOffset + 420,
        action: 'repurposed',
        name: 'teaching house',
        need: 'knowledge',
        form: 'hall',
        level: 2,
        material: 'masonry',
      },
      {
        ...origin,
        month: monthOffset + 720,
        action: 'upgraded',
        name: 'academy',
        need: 'knowledge',
        form: 'hall',
        level: 3,
        material: 'masonry',
      },
    ],
    transitionCount: 3,
    lastUsedMonth: monthOffset + 720,
  };
}

function buildingConfig(development: DevelopmentResponse) {
  const role = developmentBuildingRole(development);
  return {
    seed: 'validation:shared-building',
    culture: CULTURE,
    era: 'preIndustrial' as const,
    variant: `${role}#${BUILD_STAGE.DETAIL}`,
    development,
  };
}

describe('structure renderer and performance validation', () => {
  it('keeps major institution families readable at normal settlement-view scale', () => {
    const summary = architectureGallerySummary('gallery-culture', CULTURE);
    const byId = new Map(summary.profiles.map(profile => [profile.id, profile]));
    const hallPeers = ['government', 'knowledge', 'healthcare', 'security'].map(id => byId.get(id)!.midSignature);

    expect(new Set(hallPeers).size).toBe(4);
    expect(summary.midSignatureCount).toBeGreaterThanOrEqual(9);
    expect(summary.farSignatureCount).toBeGreaterThanOrEqual(6);
  });

  it('keeps procedural structures within the renderer surface budget', () => {
    const summary = architectureGallerySummary('gallery-culture', CULTURE);
    expect(summary.maxMeshes).toBeLessThanOrEqual(12);
    expect(summary.maxVertices).toBeLessThan(30000);
    expect(summary.profiles.every(profile => profile.componentCount >= 2)).toBe(true);
  });

  it('builds the deterministic developer gallery through the real asset cache', () => {
    const builder = new AssetBuilder('architecture-gallery-validation');
    const gallery = buildArchitectureGalleryScene(builder, 'gallery-culture', CULTURE);
    const stats = builder.getCacheStats();

    expect(gallery.children).toHaveLength(ARCHITECTURE_GALLERY_CASES.length);
    expect(new Set(gallery.children.map(child => child.userData['architectureGalleryCase'])).size)
      .toBe(ARCHITECTURE_GALLERY_CASES.length);
    expect(stats.buildingEntries).toBe(ARCHITECTURE_GALLERY_CASES.length);
    expect(stats.entries).toBeLessThanOrEqual(stats.maxEntries);
    builder.dispose();
  });

  it('shares one asset across histories that are visually identical but occurred in different centuries', () => {
    const early = historicalAcademy(0, 'keepers-a');
    const late = historicalAcademy(24000, 'keepers-b');
    expect(heritageFingerprint(early)).not.toBe(heritageFingerprint(late));
    expect(structureVisualHistorySignature(early)).toBe(structureVisualHistorySignature(late));

    const builder = new AssetBuilder('visual-cache-validation');
    const first = builder.getAsset('building', buildingConfig(early));
    for (let index = 1; index <= 40; index++) {
      const equivalent = historicalAcademy(index * 1200, `keepers-${index}`);
      const asset = builder.getAsset('building', buildingConfig(equivalent));
      expect(asset.mesh).toBe(first.mesh);
    }
    const stats = builder.getCacheStats();
    expect(stats.buildingEntries).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(40);
    expect(stats.hitRate).toBeGreaterThan(0.97);
    builder.dispose();
  });

  it('does not share assets when the surviving physical fabric is actually different', () => {
    const builder = new AssetBuilder('visual-cache-separation');
    const timberOrigin = historicalAcademy(0, 'keepers-a', 'timber');
    const earthOrigin = historicalAcademy(0, 'keepers-b', 'earth');
    const first = builder.getAsset('building', buildingConfig(timberOrigin));
    const second = builder.getAsset('building', buildingConfig(earthOrigin));

    expect(structureVisualHistorySignature(timberOrigin)).not.toBe(structureVisualHistorySignature(earthOrigin));
    expect(second.mesh).not.toBe(first.mesh);
    expect(builder.getCacheStats().buildingEntries).toBe(2);
    builder.dispose();
  });

  it('keeps shared component manifests free of plot-specific documentary metadata', () => {
    const builder = new AssetBuilder('shared-manifest-validation');
    const asset = builder.getAsset('building', buildingConfig(historicalAcademy(6000, 'keepers-private')));
    const manifest = asset.mesh.userData['structureComponents'] as StructureComponentManifest;
    const generations = manifest.generations as Array<Record<string, unknown>>;

    expect(generations.length).toBeGreaterThan(1);
    expect(generations.every(generation => !('startedMonth' in generation))).toBe(true);
    expect(generations.every(generation => !('institutionId' in generation))).toBe(true);
    expect('omittedTransitionCount' in (manifest as unknown as Record<string, unknown>)).toBe(false);
    builder.dispose();
  });
});
