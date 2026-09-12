import { describe, expect, it } from 'vitest';
import { deriveBannerLegacy, type BannerLegacyInput } from '../src/render/style/BannerLegacy';
import type { HistoricalEvent } from '../src/sim/types';

const identity = {
  id: 'identity',
  primary: '#a45f4d',
  secondary: '#344052',
  accent: '#d2ad6b',
  shape: 'swallowtail' as const,
  fieldPattern: 'border' as const,
  emblem: 'sun' as const,
  fieldVariant: 1,
  emblemVariant: 0,
  lineageMarks: 1,
  lineageKey: 'culture-1',
  foundingEra: 'village' as const,
  rationale: [],
};

function event(id: string, type: HistoricalEvent['type'], month: number, overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
    id,
    month,
    type,
    actors: ['settlement-1'],
    causes: [],
    context: {},
    outcome: '',
    affectedPopulation: 0,
    magnitude: 0.6,
    significance: 0.7,
    tags: [],
    summary: '',
    ...overrides,
  };
}

function input(overrides: Partial<BannerLegacyInput> = {}): BannerLegacyInput {
  return {
    currentMonth: 600,
    foundedMonth: 0,
    settlementId: 'settlement-1',
    polityId: 'polity-1',
    cultureId: 'culture-1',
    currentEra: 'village',
    specialization: 'agriculture',
    prosperity: 0.5,
    crisisMonths: 0,
    conflictPressure: 0.1,
    successionCount: 0,
    isCapital: false,
    institutions: [],
    identity,
    history: [],
    hasLandGate: false,
    hasAnyPortal: false,
    ...overrides,
  };
}

describe('banner legacy', () => {
  it('keeps camp standards near the hearth but moves mature civic standards away from it', () => {
    const camp = deriveBannerLegacy(input({ currentEra: 'early' }));
    const town = deriveBannerLegacy(input({ currentEra: 'village', isCapital: true }));

    expect(camp.site).toBe('hearth');
    expect(camp.mount).toBe('processional');
    expect(town.site).toBe('civic');
    expect(town.mount).toBe('civic-standard');
  });

  it('places strong institutions where their symbols matter', () => {
    const sacred = deriveBannerLegacy(input({
      institutions: [{ kind: 'temple', support: 0.9, prestige: 0.95 }],
    }));
    const market = deriveBannerLegacy(input({
      specialization: 'exchange',
      hasAnyPortal: true,
      institutions: [{ kind: 'merchant-association', support: 0.88, prestige: 0.9 }],
    }));
    const gate = deriveBannerLegacy(input({
      hasLandGate: true,
      conflictPressure: 0.8,
      institutions: [{ kind: 'military-order', support: 0.86, prestige: 0.9 }],
    }));

    expect(sacred.site).toBe('sacred');
    expect(sacred.mount).toBe('gonfalon');
    expect(market.site).toBe('market');
    expect(gate.site).toBe('gate');
    expect(gate.mount).toBe('pennon');
  });

  it('evolves without throwing away the founding identity', () => {
    const legacy = deriveBannerLegacy(input({
      successionCount: 2,
      history: [
        event('succession-1', 'leadership-succession', 120, { actors: ['polity-1'], causes: ['new-ruling-house'] }),
        event('transition-1', 'political-transition', 240, { actors: ['polity-1', 'settlement-1'] }),
        event('culture-1', 'cultural-shift', 360, { actors: ['culture-1'], context: { dimension: 'religiousTendency' } }),
      ],
    }));

    expect(legacy.generation).toBe(4);
    expect(legacy.politicalBands).toBe(2);
    expect(legacy.culturalMarks).toBe(1);
    expect(legacy.successionMarks).toBe(2);
    expect(legacy.fieldVariant).toBe((identity.fieldVariant + 3) % 4);
    expect(legacy.emblemVariant).toBe((identity.emblemVariant + 3) % 4);
    expect(legacy.latestChange).toContain('cultural shift');
  });

  it('turns conflict, crisis and recovery into wear, mourning and repairs', () => {
    const legacy = deriveBannerLegacy(input({
      currentMonth: 300,
      crisisMonths: 5,
      history: [
        event('battle-1', 'battle', 250, { significance: 0.8 }),
        event('crisis-1', 'natural-catastrophe', 280, { significance: 0.9 }),
        event('recovery-1', 'recovery', 290, { significance: 0.55 }),
      ],
    }));

    expect(legacy.wear).toBeGreaterThan(0.15);
    expect(legacy.scorch).toBeGreaterThan(0.1);
    expect(legacy.repairPatches).toBeGreaterThanOrEqual(1);
    expect(legacy.mourning).toBe(true);
  });

  it('lets capital prosperity add prestige without neon colours', () => {
    const legacy = deriveBannerLegacy(input({
      prosperity: 0.95,
      isCapital: true,
      institutions: [{ kind: 'council', support: 0.85, prestige: 0.9 }],
    }));

    expect(legacy.prestigeTrim).toBeGreaterThan(0.8);
    expect(legacy.rationale.some(reason => reason.includes('formal edging'))).toBe(true);
  });

  it('ignores unrelated history from other settlements and cultures', () => {
    const legacy = deriveBannerLegacy(input({
      history: [event('elsewhere', 'political-transition', 200, { actors: ['settlement-99'], locationId: 'settlement-99' })],
    }));

    expect(legacy.generation).toBe(1);
    expect(legacy.politicalBands).toBe(0);
  });
});
