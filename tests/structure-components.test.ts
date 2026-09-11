import { describe, expect, it } from 'vitest';
import type { DevelopmentResponse, StructureDevelopment, StructureHistoryEntry } from '../src/sim/development/types';
import { developmentContext } from '../src/sim/development/SettlementDevelopmentSystem';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { composeBuilding, BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { developmentBuildingRole, resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import {
  buildStructureComponentManifest,
  instantiateStructureComponentIds,
  type StructureComponentManifest,
} from '../src/render/assets/StructureComponents';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { heritageFingerprint } from '../src/render/assets/StructureHeritage';
import { societyFixture } from './fixtures/settlementDevelopment';

describe('structural component contract', () => {
  const setup = () => {
    const { state, settlements: [settlement] } = societyFixture();
    const context = developmentContext(state, settlement!);
    const profile = CultureStyleProfileFactory.createFromCulture(context.culture.id, context.culture.style);
    const response = (
      need: DevelopmentResponse['need'],
      form: DevelopmentResponse['form'],
      level = 3,
      material: DevelopmentResponse['material'] = 'masonry',
    ): DevelopmentResponse => ({
      need,
      form,
      name: `${need}-${level}`,
      level,
      material,
      cultureId: context.culture.id,
      style: context.culture.style,
      services: { [need]: level },
      reasons: ['component-contract-test'],
      capabilities: [],
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
      labor: level,
    });
    return { context, profile, response };
  };

  const manifestFor = (development: DevelopmentResponse, seed = 'component-contract'): StructureComponentManifest => {
    const { context, profile } = setup();
    const grammar = resolveBuildingGrammar(profile, 'preIndustrial', developmentBuildingRole(development), seed, development);
    const palette = new MaterialPalette({ culture: context.culture.style, era: 'preIndustrial' });
    const composed = composeBuilding(grammar, palette, seed, BUILD_STAGE.DETAIL);
    const manifest = buildStructureComponentManifest(grammar, development, composed);
    composed.group.traverse(object => {
      if ('geometry' in object && object.geometry && typeof object.geometry === 'object' && 'dispose' in object.geometry) {
        (object.geometry as { dispose: () => void }).dispose();
      }
    });
    palette.dispose();
    return manifest;
  };

  it('gives a complex civic building stable addressable parts with a valid support graph', () => {
    const { response } = setup();
    const manifest = manifestFor(response('government', 'hall', 3));
    const ids = manifest.components.map(component => component.id);

    expect(manifest.version).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'foundation:main',
      'frame:core',
      'core:main',
      'roof:main',
      'annex:west',
      'annex:east',
      'roof:annex:west',
      'roof:annex:east',
      'forecourt:front',
      'gateway:front',
      'enclosure:perimeter',
    ]));

    const idSet = new Set(ids);
    for (const component of manifest.components) {
      expect(component.bounds.size.x).toBeGreaterThan(0);
      expect(component.bounds.size.y).toBeGreaterThan(0);
      expect(component.bounds.size.z).toBeGreaterThan(0);
      for (const support of component.supportIds) expect(idSet.has(support)).toBe(true);
      if (component.parentId) expect(idSet.has(component.parentId)).toBe(true);
    }
    expect(manifest.components.find(component => component.id === 'roof:main')?.supportIds).toContain('core:main');
  });

  it('separates surviving historical fabric from current additions', () => {
    const { context, profile, response } = setup();
    const current = response('knowledge', 'hall', 3, 'masonry');
    const origin: StructureHistoryEntry = {
      month: 0,
      action: 'founded',
      name: 'old timber shrine',
      need: 'religion',
      form: 'sanctuary',
      level: 1,
      material: 'timber',
      cultureId: context.culture.id,
      reasons: ['founding-faith'],
    };
    const historical: StructureDevelopment = {
      ...current,
      status: 'active',
      origin,
      history: [
        { ...origin, month: 180, action: 'expanded', level: 2 },
        { ...origin, month: 420, action: 'repurposed', name: 'teaching house', need: 'knowledge', form: 'hall', level: 2, material: 'masonry' },
        { ...origin, month: 720, action: 'upgraded', name: 'academy', need: 'knowledge', form: 'hall', level: 3, material: 'masonry' },
      ],
      transitionCount: 3,
      lastUsedMonth: 720,
    };
    const grammar = resolveBuildingGrammar(profile, 'preIndustrial', 'hall', 'historical-components', historical);
    const palette = new MaterialPalette({ culture: context.culture.style, era: 'preIndustrial' });
    const composed = composeBuilding(grammar, palette, 'historical-components', BUILD_STAGE.DETAIL);
    const manifest = buildStructureComponentManifest(grammar, historical, composed);
    const core = manifest.components.find(component => component.id === 'core:main')!;
    const annex = manifest.components.find(component => component.id === 'annex:east')!;

    expect(core.provenance).toMatchObject({ phase: 'origin', material: 'timber', need: 'religion', form: 'sanctuary' });
    expect(annex.provenance).toMatchObject({ phase: 'current', material: 'masonry', need: 'knowledge', form: 'hall' });
    expect(core.provenance.cultureId).toBe(context.culture.id);
    expect(manifest.visualSignature).not.toContain('.720.');

    composed.group.traverse(object => {
      if ('geometry' in object && object.geometry && typeof object.geometry === 'object' && 'dispose' in object.geometry) {
        (object.geometry as { dispose: () => void }).dispose();
      }
    });
    palette.dispose();
  });

  it('keeps the component signature stable when only historical event timing changes', () => {
    const { context, response } = setup();
    const current = response('government', 'hall', 3, 'masonry');
    const makeHistory = (month: number): StructureDevelopment => ({
      ...current,
      status: 'active',
      origin: {
        month: 0,
        action: 'founded',
        name: 'council house',
        need: 'government',
        form: 'hall',
        level: 1,
        material: 'timber',
        cultureId: context.culture.id,
        reasons: ['founding'],
      },
      history: [{
        month,
        action: 'upgraded',
        name: 'government complex',
        need: 'government',
        form: 'hall',
        level: 3,
        material: 'masonry',
        cultureId: context.culture.id,
        reasons: ['upgrade'],
      }],
      transitionCount: 1,
      lastUsedMonth: month,
    });
    const early = makeHistory(240);
    const late = makeHistory(2400);

    expect(heritageFingerprint(early)).not.toBe(heritageFingerprint(late));
    expect(manifestFor(early, 'same-visual-history').visualSignature)
      .toBe(manifestFor(late, 'same-visual-history').visualSignature);
  });

  it('attaches the manifest to cached building assets without creating per-component meshes', () => {
    const { context, response } = setup();
    const builder = new AssetBuilder('component-asset-test');
    const development = response('energy', 'works', 3, 'metal');
    const asset = builder.getAsset('building', {
      seed: 'component-asset',
      culture: context.culture.style,
      era: 'industrial',
      variant: 'energy#4',
      development,
    });
    const manifest = asset.mesh.userData['structureComponents'] as StructureComponentManifest;

    expect(manifest.version).toBe(1);
    expect(manifest.components.some(component => component.kind === 'vent')).toBe(true);
    expect(asset.mesh.userData['structureComponentSignature']).toBe(manifest.visualSignature);
    expect(asset.mesh.children.some(child => child.name === 'core:main')).toBe(false);
    expect(asset.mesh.children.every(child => child.name.length > 0)).toBe(true);
    builder.dispose();
  });

  it('gives open fields and markets a damage-ready logical vocabulary', () => {
    const { response } = setup();
    const field = manifestFor(response('food', 'field', 1, 'earth'));
    const market = manifestFor(response('trade', 'gathering', 1, 'timber'));

    expect(field.components.map(component => component.id)).toEqual(['ground:site', 'field:rows']);
    expect(market.components.map(component => component.id)).toEqual(['ground:site', 'gathering:fixtures', 'market:canopies']);
  });

  it('creates globally stable placed ids by prefixing the persistent plot id', () => {
    const { response } = setup();
    const manifest = manifestFor(response('security', 'tower', 2, 'masonry'));
    const ids = instantiateStructureComponentIds('settlement-a:building:7', manifest);

    expect(ids).toContain('settlement-a:building:7:core:main');
    expect(ids).toContain('settlement-a:building:7:roof:main');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
