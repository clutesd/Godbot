import { describe, expect, it } from 'vitest';
import { generateBannerIdentity, type BannerIdentityInput } from '../src/render/style/BannerIdentity';
import type { Culture, CultureDimensions } from '../src/sim/types';

const NEUTRAL_DIMENSIONS: CultureDimensions = {
  cooperation: 0.5,
  hierarchy: 0.5,
  militarism: 0.5,
  tradeOrientation: 0.5,
  curiosity: 0.5,
  religiousTendency: 0.5,
  institutionalTrust: 0.5,
  outsiderOpenness: 0.5,
  longTermOrientation: 0.5,
};

function culture(overrides: Partial<CultureDimensions> = {}, symbol: Culture['style']['symbol'] = 'sun-step', pattern: Culture['style']['pattern'] = 'chevron'): Culture {
  return {
    id: `culture-${symbol}-${pattern}`,
    name: 'Test Culture',
    dimensions: { ...NEUTRAL_DIMENSIONS, ...overrides },
    style: {
      primary: '#b35d4d',
      secondary: '#2e3c55',
      accent: '#d3aa59',
      symbol,
      pattern,
      nameSyllables: ['ta', 'ri'],
    },
    memory: { tradeSuccess: 0, collectiveSuccess: 0, frontierViolence: 0, militarySuccess: 0 },
  };
}

function input(overrides: Partial<BannerIdentityInput> = {}): BannerIdentityInput {
  return {
    seed: 'banner-test',
    settlementId: 'settlement-1',
    specialization: 'agriculture',
    biome: 'grassland',
    river: false,
    lake: false,
    coast: false,
    foundingEra: 'village',
    culture: culture(),
    institutions: [],
    activeTradeRoutes: 0,
    ...overrides,
  };
}

describe('procedural settlement banner identity', () => {
  it('is deterministic for the same settlement facts', () => {
    const facts = input({
      polity: { id: 'polity-1', arrangement: 'council', dynastyName: 'House Sora' },
      institutions: [{ kind: 'council', support: 0.75, prestige: 0.68 }],
    });
    expect(generateBannerIdentity(facts)).toEqual(generateBannerIdentity(facts));
  });

  it('lets homeland geography create readable local heraldry', () => {
    const forest = generateBannerIdentity(input({ biome: 'forest', specialization: 'forestry' }));
    const river = generateBannerIdentity(input({ biome: 'wetland', river: true, specialization: 'exchange' }));
    const mountain = generateBannerIdentity(input({ biome: 'mountain', specialization: 'mining' }));

    expect(forest.emblem).toBe('tree');
    expect(river.emblem).toBe('river-wave');
    expect(mountain.emblem).toBe('mountain');
    expect(forest.id).not.toBe(river.id);
  });

  it('turns religion, warfare and trade emphasis into different symbols and fields', () => {
    const religious = generateBannerIdentity(input({
      culture: culture({ religiousTendency: 0.95 }, 'woven-moon', 'terrace'),
      institutions: [{ kind: 'temple', support: 0.9, prestige: 0.94 }],
    }));
    const martial = generateBannerIdentity(input({
      culture: culture({ militarism: 0.98, hierarchy: 0.7 }, 'sun-step', 'chevron'),
      institutions: [{ kind: 'military-order', support: 0.92, prestige: 0.95 }],
    }));
    const mercantile = generateBannerIdentity(input({
      specialization: 'exchange',
      culture: culture({ tradeOrientation: 0.98 }, 'river-eye', 'wave'),
      institutions: [{ kind: 'merchant-association', support: 0.92, prestige: 0.94 }],
      activeTradeRoutes: 3,
    }));

    expect(religious.emblem).toBe('moon');
    expect(religious.fieldPattern).toBe('top-band');
    expect(martial.emblem).toBe('antlers');
    expect(martial.fieldPattern).toBe('split');
    expect(mercantile.emblem).toBe('river-wave');
    expect(mercantile.fieldPattern).toBe('stripe');
  });

  it('uses founding era to preserve a settlement silhouette tradition', () => {
    expect(generateBannerIdentity(input({ foundingEra: 'primitive' })).shape).toBe('ragged');
    expect(generateBannerIdentity(input({ foundingEra: 'early' })).shape).toBe('pointed');
    expect(generateBannerIdentity(input({ foundingEra: 'village' })).shape).toBe('swallowtail');
    expect(generateBannerIdentity(input({ foundingEra: 'preIndustrial' })).shape).toBe('stepped');
    expect(generateBannerIdentity(input({ foundingEra: 'industrial' })).shape).toBe('straight');
  });

  it('gives ruling lineages stable house marks without losing the culture palette', () => {
    const houseA = generateBannerIdentity(input({ polity: { id: 'polity-1', arrangement: 'dynastic', dynastyName: 'House Aki' } }));
    const houseB = generateBannerIdentity(input({ polity: { id: 'polity-1', arrangement: 'dynastic', dynastyName: 'House Nuru' } }));

    expect(houseA.id).not.toBe(houseB.id);
    expect(houseA.lineageKey).toBe('House Aki');
    expect(houseA.rationale.some(reason => reason.includes('lineage'))).toBe(true);
    expect(houseA.primary).toMatch(/^#[0-9a-f]{6}$/);
  });
});
