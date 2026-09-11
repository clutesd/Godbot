import { describe, expect, it } from 'vitest';
import type {
  DevelopmentResponse,
  StructureDevelopment,
  StructureHistoryEntry,
} from '../src/sim/development/types';
import { developmentContext } from '../src/sim/development/SettlementDevelopmentSystem';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { developmentBuildingRole, resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { deriveStructureHeritage, heritageFingerprint } from '../src/render/assets/StructureHeritage';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { societyFixture } from './fixtures/settlementDevelopment';

describe('historical structure inheritance', () => {
  const setup = () => {
    const { state, settlements: [settlement] } = societyFixture();
    const context = developmentContext(state, settlement!);
    const current: DevelopmentResponse = {
      need: 'knowledge',
      form: 'hall',
      name: 'academy',
      level: 3,
      material: 'masonry',
      cultureId: context.culture.id,
      style: context.culture.style,
      services: { knowledge: 3 },
      reasons: ['historical-identity-test'],
      capabilities: ['durable-records', 'scientific-method'],
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
      labor: 3,
    };
    const entry = (
      month: number,
      action: StructureHistoryEntry['action'],
      patch: Partial<StructureHistoryEntry> = {},
    ): StructureHistoryEntry => ({
      month,
      action,
      name: patch.name ?? 'old shrine',
      need: patch.need ?? 'religion',
      form: patch.form ?? 'sanctuary',
      level: patch.level ?? 1,
      material: patch.material ?? 'timber',
      cultureId: patch.cultureId ?? context.culture.id,
      institutionId: patch.institutionId,
      reasons: patch.reasons ?? ['historical-transition'],
    });
    const origin = entry(0, 'founded');
    const historical: StructureDevelopment = {
      ...current,
      status: 'active',
      origin,
      history: [
        entry(120, 'expanded', { level: 2 }),
        entry(360, 'repurposed', { name: 'teaching house', need: 'knowledge', form: 'hall', level: 2, material: 'masonry' }),
        entry(600, 'upgraded', { name: 'academy', need: 'knowledge', form: 'hall', level: 3, material: 'masonry' }),
      ],
      transitionCount: 3,
      lastUsedMonth: 720,
    };
    const profile = CultureStyleProfileFactory.createFromCulture(context.culture.id, context.culture.style);
    return { context, current, historical, profile };
  };

  it('derives lineage only from authoritative origin and transition records', () => {
    const { historical } = setup();
    const heritage = deriveStructureHeritage(historical)!;

    expect(heritage).toMatchObject({
      originNeed: 'religion',
      originForm: 'sanctuary',
      originMaterial: 'timber',
      legacyNeed: 'religion',
      legacyForm: 'sanctuary',
      legacyMaterial: 'timber',
      transitionCount: 3,
      upgradeCount: 2,
      repurposed: true,
      materialShift: true,
      needShift: true,
      ceremonialMemory: true,
    });
    expect(heritage.preservation).toBeGreaterThan(0.2);
    expect(heritageFingerprint(historical)).not.toBe('fresh');
  });

  it('turns an evolved institution into a material and formal palimpsest', () => {
    const { current, historical, profile } = setup();
    const role = developmentBuildingRole(current);
    const fresh = resolveBuildingGrammar(profile, 'preIndustrial', role, 'lineage:shared', current);
    const evolved = resolveBuildingGrammar(profile, 'preIndustrial', role, 'lineage:shared', historical);

    // The present institution remains an academy, but its old sacred/timber shell still reads.
    expect(fresh.role).toBe('hall');
    expect(evolved.role).toBe('hall');
    expect(fresh.wallLayer).toBe('stone');
    expect(evolved.wallLayer).toBe('daub');
    expect(evolved.roofTiers).toBeGreaterThanOrEqual(2);
    expect(evolved.ridgeFinials).toBe(true);
    expect(evolved.width).toBeGreaterThan(fresh.width);
    expect(evolved.bays).toBeGreaterThanOrEqual(fresh.bays);
  });

  it('retains traces of damaged/reused sites without pretending the ruin never happened', () => {
    const { historical } = setup();
    const reused: StructureDevelopment = {
      ...historical,
      history: [
        ...historical.history,
        {
          month: 840,
          action: 'ruined',
          name: historical.name,
          need: historical.need,
          form: historical.form,
          level: historical.level,
          material: historical.material,
          cultureId: historical.cultureId,
          reasons: ['abandonment'],
        },
        {
          month: 960,
          action: 'reused',
          name: historical.name,
          need: historical.need,
          form: historical.form,
          level: historical.level,
          material: historical.material,
          cultureId: historical.cultureId,
          reasons: ['institutional-return'],
        },
      ],
      transitionCount: 5,
    };
    const heritage = deriveStructureHeritage(reused)!;
    expect(heritage.reused).toBe(true);
    expect(heritage.survivedRuin).toBe(true);
    expect(heritage.preservation).toBeGreaterThanOrEqual(0.16);
  });

  it('separates cache entries for identical present-day buildings with different pasts', () => {
    const { context, current, historical } = setup();
    const builder = new AssetBuilder('heritage-cache-test');
    const config = {
      seed: 'same-present-building',
      culture: context.culture.style,
      era: 'preIndustrial' as const,
      variant: 'hall',
    };

    const historicalAsset = builder.getAsset('building', { ...config, development: historical });
    const sameHistoricalAsset = builder.getAsset('building', { ...config, development: historical });
    const freshAsset = builder.getAsset('building', { ...config, development: current });

    expect(sameHistoricalAsset.mesh).toBe(historicalAsset.mesh);
    expect(freshAsset.mesh).not.toBe(historicalAsset.mesh);
    builder.dispose();
  });

  it('carries cultural succession as inherited fabric rather than silently erasing it', () => {
    const { historical, profile } = setup();
    const successor: StructureDevelopment = {
      ...historical,
      cultureId: 'successor-culture',
      transitionCount: historical.transitionCount + 1,
      history: [
        ...historical.history,
        {
          month: 900,
          action: 'reused',
          name: historical.name,
          need: historical.need,
          form: historical.form,
          level: historical.level,
          material: historical.material,
          cultureId: 'successor-culture',
          reasons: ['cultural-succession'],
        },
      ],
    };
    const heritage = deriveStructureHeritage(successor)!;
    const grammar = resolveBuildingGrammar(profile, 'preIndustrial', 'hall', 'culture-shift', successor);

    expect(heritage.cultureShift).toBe(true);
    expect(grammar.patternBands).toBeGreaterThanOrEqual(2);
    expect(grammar.ridgeFinials).toBe(true);
  });
});
