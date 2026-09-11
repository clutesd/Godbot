import { describe, expect, it } from 'vitest';
import type { DevelopmentResponse, StructureDevelopment, StructureHistoryEntry } from '../src/sim/development/types';
import { deriveArchitecturalGenerations } from '../src/render/assets/StructureGenerations';
import { buildStructureComponentManifest } from '../src/render/assets/StructureComponents';
import { developmentBuildingRole, resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { composeBuilding, BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { developmentContext } from '../src/sim/development/SettlementDevelopmentSystem';
import { societyFixture } from './fixtures/settlementDevelopment';

describe('true architectural generations', () => {
  const setup = () => {
    const { state, settlements: [settlement] } = societyFixture();
    const context = developmentContext(state, settlement!);
    const base: DevelopmentResponse = {
      need: 'knowledge',
      form: 'hall',
      name: 'academy',
      level: 3,
      material: 'metal',
      cultureId: context.culture.id,
      style: context.culture.style,
      services: { knowledge: 3 },
      reasons: ['generation-test'],
      capabilities: [],
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
      labor: 3,
    };
    const entry = (
      month: number,
      action: StructureHistoryEntry['action'],
      need: DevelopmentResponse['need'],
      form: DevelopmentResponse['form'],
      level: number,
      material: DevelopmentResponse['material'],
      cultureId = context.culture.id,
    ): StructureHistoryEntry => ({
      month, action, name: `${need}-${level}`, need, form, level, material, cultureId,
      reasons: ['generation-test'],
    });
    return { context, base, entry };
  };

  it('turns meaningful physical history into a compact ordered stratigraphy', () => {
    const { base, entry } = setup();
    const historical: StructureDevelopment = {
      ...base,
      status: 'active',
      origin: entry(0, 'founded', 'religion', 'sanctuary', 1, 'timber'),
      history: [
        entry(120, 'expanded', 'religion', 'sanctuary', 2, 'timber'),
        entry(300, 'upgraded', 'religion', 'sanctuary', 2, 'masonry'),
        entry(520, 'repurposed', 'knowledge', 'hall', 2, 'masonry'),
        entry(760, 'upgraded', 'knowledge', 'hall', 3, 'metal'),
      ],
      transitionCount: 4,
      lastUsedMonth: 760,
    };

    const model = deriveArchitecturalGenerations(historical);
    expect(model.generations.length).toBeGreaterThanOrEqual(4);
    expect(model.generations.length).toBeLessThanOrEqual(5);
    expect(model.generations[0]).toMatchObject({ id: 'g0-origin', kind: 'origin', material: 'timber', need: 'religion' });
    expect(model.generations.some(g => g.kind === 'conversion' && g.need === 'knowledge')).toBe(true);
    expect(model.generations.some(g => g.kind === 'modernization' && g.material === 'metal')).toBe(true);
    expect(model.generations.at(-1)?.envelopeShare).toBe(1);
    for (let i = 1; i < model.generations.length; i++) {
      expect(model.generations[i]!.envelopeShare).toBeGreaterThan(model.generations[i - 1]!.envelopeShare);
    }
  });

  it('records ruin/reuse as a rebuild generation rather than pretending continuity', () => {
    const { base, entry } = setup();
    const historical: StructureDevelopment = {
      ...base,
      status: 'active',
      origin: entry(0, 'founded', 'government', 'hall', 1, 'timber'),
      history: [
        entry(200, 'upgraded', 'government', 'hall', 2, 'masonry'),
        entry(420, 'ruined', 'government', 'hall', 2, 'masonry'),
        entry(650, 'reused', 'knowledge', 'hall', 2, 'masonry'),
      ],
      transitionCount: 3,
      lastUsedMonth: 650,
    };

    const model = deriveArchitecturalGenerations(historical);
    const rebuild = model.generations.find(generation => generation.kind === 'rebuild');
    expect(rebuild).toBeDefined();
    expect(rebuild).toMatchObject({ rebuiltAfterLoss: true, need: 'knowledge' });
    expect(model.nonFabricTransitionCount).toBe(1);
  });

  it('caps long histories at five generations while preserving origin and the newest fabric', () => {
    const { base, entry } = setup();
    const history: StructureHistoryEntry[] = [
      entry(100, 'expanded', 'religion', 'sanctuary', 2, 'timber'),
      entry(200, 'upgraded', 'religion', 'sanctuary', 2, 'ceramic'),
      entry(300, 'repurposed', 'government', 'hall', 2, 'ceramic'),
      entry(400, 'upgraded', 'government', 'hall', 3, 'masonry'),
      entry(500, 'repurposed', 'trade', 'store', 2, 'masonry'),
      entry(600, 'upgraded', 'trade', 'store', 3, 'metal'),
      entry(700, 'repurposed', 'knowledge', 'hall', 3, 'metal'),
    ];
    const historical: StructureDevelopment = {
      ...base,
      status: 'active',
      origin: entry(0, 'founded', 'religion', 'sanctuary', 1, 'timber'),
      history,
      transitionCount: history.length + 6,
      lastUsedMonth: 700,
    };

    const model = deriveArchitecturalGenerations(historical);
    expect(model.generations).toHaveLength(5);
    expect(model.generations[0]!.kind).toBe('origin');
    expect(model.generations.at(-1)).toMatchObject({ need: 'knowledge', material: 'metal' });
    expect(model.omittedTransitionCount).toBe(6);
  });

  it('keeps visual generation identity independent of event timing', () => {
    const { base, entry } = setup();
    const history = (offset: number): StructureDevelopment => ({
      ...base,
      status: 'active',
      origin: entry(offset, 'founded', 'religion', 'sanctuary', 1, 'timber'),
      history: [
        entry(offset + 200, 'repurposed', 'knowledge', 'hall', 2, 'masonry'),
        entry(offset + 400, 'upgraded', 'knowledge', 'hall', 3, 'metal'),
      ],
      transitionCount: 2,
      lastUsedMonth: offset + 400,
    });

    expect(deriveArchitecturalGenerations(history(0)).visualSignature)
      .toBe(deriveArchitecturalGenerations(history(5000)).visualSignature);
  });

  it('assigns different annexes to different generations inside one reserved development envelope', () => {
    const { context, base, entry } = setup();
    const historical: StructureDevelopment = {
      ...base,
      need: 'government',
      name: 'government complex',
      material: 'masonry',
      status: 'active',
      origin: entry(0, 'founded', 'government', 'hall', 1, 'timber'),
      history: [
        entry(180, 'expanded', 'government', 'hall', 2, 'timber'),
        entry(400, 'upgraded', 'government', 'hall', 2, 'masonry'),
        entry(680, 'upgraded', 'government', 'hall', 3, 'masonry'),
      ],
      transitionCount: 3,
      lastUsedMonth: 680,
    };
    const profile = CultureStyleProfileFactory.createFromCulture(context.culture.id, context.culture.style);
    const grammar = resolveBuildingGrammar(profile, 'preIndustrial', developmentBuildingRole(historical), 'generation-envelope', historical);
    const palette = new MaterialPalette({ culture: context.culture.style, era: 'preIndustrial' });
    const composed = composeBuilding(grammar, palette, 'generation-envelope', BUILD_STAGE.DETAIL);
    const manifest = buildStructureComponentManifest(grammar, historical, composed);
    const west = manifest.components.find(component => component.id === 'annex:west')!;
    const east = manifest.components.find(component => component.id === 'annex:east')!;

    expect(manifest.version).toBe(2);
    expect(manifest.generations.length).toBeGreaterThan(1);
    expect(west.provenance.generationId).not.toBe(east.provenance.generationId);
    expect(manifest.developmentEnvelope.stages.at(-1)).toMatchObject({ share: 1 });
    expect(manifest.developmentEnvelope.extentX).toBeGreaterThan(0);
    expect(manifest.developmentEnvelope.extentZ).toBeGreaterThan(0);

    composed.group.traverse(object => {
      if ('geometry' in object && object.geometry && typeof object.geometry === 'object' && 'dispose' in object.geometry) {
        (object.geometry as { dispose: () => void }).dispose();
      }
    });
    palette.dispose();
  });
});
