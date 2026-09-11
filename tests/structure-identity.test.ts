import { describe, expect, it } from 'vitest';
import type { DevelopmentResponse, SettlementNeed, StructureForm } from '../src/sim/development/types';
import { developmentContext } from '../src/sim/development/SettlementDevelopmentSystem';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { developmentBuildingRole, resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { societyFixture } from './fixtures/settlementDevelopment';

describe('semantic structure identity overlays', () => {
  const setup = () => {
    const { state, settlements: [settlement] } = societyFixture();
    const context = developmentContext(state, settlement!);
    const profile = CultureStyleProfileFactory.createFromCulture(context.culture.id, context.culture.style);
    const response = (need: SettlementNeed, form: StructureForm, level = 2): DevelopmentResponse => ({
      need,
      form,
      name: `${need}-${level}`,
      level,
      material: 'masonry',
      cultureId: context.culture.id,
      style: context.culture.style,
      services: { [need]: level },
      reasons: ['identity-test'],
      capabilities: [],
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
      labor: 1,
    });
    const grammar = (need: SettlementNeed, form: StructureForm, level = 2) => {
      const development = response(need, form, level);
      return resolveBuildingGrammar(profile, 'village', developmentBuildingRole(development), `identity:${need}:${level}`, development);
    };
    return { grammar };
  };

  it('keeps hall-based civic institutions visually distinguishable', () => {
    const { grammar } = setup();
    const government = grammar('government', 'hall');
    const knowledge = grammar('knowledge', 'hall');
    const healthcare = grammar('healthcare', 'hall');
    const security = grammar('security', 'hall');

    expect([government.role, knowledge.role, healthcare.role, security.role]).toEqual(['hall', 'hall', 'hall', 'hall']);
    expect(government).toMatchObject({ massing: 'court', gateway: true, forecourt: true, banner: 'standard', enclosure: 'yard' });
    expect(knowledge).toMatchObject({ massing: 'court', gateway: false, forecourt: true, banner: 'none', enclosure: 'none', veranda: 'wrap' });
    expect(healthcare).toMatchObject({ massing: 'wing', gateway: false, forecourt: true, banner: 'none', enclosure: 'none', veranda: 'wrap' });
    expect(security).toMatchObject({ massing: 'twin', gateway: true, forecourt: false, banner: 'pennant', enclosure: 'yard', veranda: 'none' });

    const signatures = [government, knowledge, healthcare, security].map(g =>
      [g.massing, g.gateway, g.forecourt, g.banner, g.enclosure, g.veranda, g.lanterns].join(':'),
    );
    expect(new Set(signatures).size).toBe(4);
  });

  it('gives commerce, logistics and productive infrastructure different working cues', () => {
    const { grammar } = setup();
    const trade = grammar('trade', 'store');
    const transport = grammar('transport', 'store');
    const manufacturing = grammar('manufacturing', 'workshop');
    const energy = grammar('energy', 'works', 3);
    const water = grammar('water', 'store', 3);

    expect(trade).toMatchObject({ forecourt: true, banner: 'cloth', enclosure: 'none', massing: 'wing' });
    expect(transport).toMatchObject({ forecourt: true, banner: 'pennant', enclosure: 'yard', massing: 'wing' });
    expect(manufacturing.enclosure).toBe('yard');
    expect(manufacturing.chimneys).toBeGreaterThanOrEqual(1);
    expect(manufacturing.forgeGlow).toBeGreaterThanOrEqual(0.35);
    expect(energy.vents).toBeGreaterThanOrEqual(4);
    expect(energy.forgeGlow).toBeGreaterThanOrEqual(0.95);
    expect(water).toMatchObject({ massing: 'twin', banner: 'none', enclosure: 'yard', veranda: 'none' });
    expect(water.vents).toBeGreaterThanOrEqual(2);
  });

  it('makes sacred and commemorative sites read as intentional precincts', () => {
    const { grammar } = setup();
    const religion = grammar('religion', 'sanctuary');
    const memory = grammar('memory', 'marker', 3);

    expect(religion.gateway).toBe(true);
    expect(religion.forecourt).toBe(true);
    expect(religion.enclosure).toBe('court');
    expect(religion.roofTiers).toBeGreaterThanOrEqual(2);
    expect(religion.ornament).toBeGreaterThanOrEqual(0.9);

    expect(memory.gateway).toBe(true);
    expect(memory.forecourt).toBe(true);
    expect(memory.enclosure).toBe('court');
    expect(memory.ornament).toBe(1);
    expect(memory.ridgeFinials).toBe(true);
  });
});
