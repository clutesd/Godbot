import { describe, expect, it } from 'vitest';
import { resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { CultureStyleProfileFactory, createSettlementProfile } from '../src/render/style/CultureStyleProfile';
import { deriveArchitecturalGenerations, generationForAnnex, generationForCurrentFabric, generationForOriginFabric } from '../src/render/assets/StructureGenerations';
import { developmentContext, evaluatePressures } from '../src/sim/development/SettlementDevelopmentSystem';
import type { SettlementArchitecturalIdentity } from '../src/sim/development/SettlementIdentity';
import type { CultureStyle } from '../src/sim/types';
import type { StructureDevelopment } from '../src/sim/development/types';
import { societyFixture, contrastingSocieties, run, connect } from './fixtures/settlementDevelopment';

const CULTURE: CultureStyle = {
  primary: '#c36557', secondary: '#313550', accent: '#d9a748',
  symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['go', 'do'],
};

function profile() {
  return CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
}

function baseIdentity(overrides: Partial<SettlementArchitecturalIdentity> = {}): SettlementArchitecturalIdentity {
  return {
    evaluatedMonth: 0, revision: 1,
    roofVariantBias: 0, eaveDepthDelta: 0, trimDensityDelta: 0,
    ornamentBias: 0, massingCourtyardTendency: 0, monumentalScaleBias: 0,
    footprintBias: 0, orientationBias: 'none', plinthSlopeResponsiveness: 0.5,
    dialectKey: 'base',
    ...overrides,
  };
}

describe('settlement architectural identity', () => {
  it('computes identical architecture for identical starting conditions (determinism)', () => {
    const a = societyFixture();
    const b = societyFixture();
    run(a.state, 3);
    run(b.state, 3);
    for (let i = 0; i < a.settlements.length; i += 1) {
      expect(a.settlements[i]!.architecture).toEqual(b.settlements[i]!.architecture);
    }
  });

  it('diverges architecture across settlements that experienced different histories', () => {
    const { state, settlements } = contrastingSocieties();
    run(state, 6);
    for (const s of settlements) expect(s.architecture).toBeDefined();
    const dialectKeys = settlements.map((s) => s.architecture!.dialectKey);
    expect(new Set(dialectKeys).size).toBeGreaterThan(1);
    const orientations = settlements.map((s) => s.architecture!.orientationBias);
    expect(new Set(orientations).size).toBeGreaterThan(1);
  });

  it('amplifies trade pressure for a settlement whose identity is trade-oriented', () => {
    const { state, settlements } = societyFixture();
    const [s, other] = settlements;
    connect(state, s!, other!);
    const baseline = evaluatePressures(developmentContext(state, s!)).pressures.trade ?? 0;
    s!.architecture = baseIdentity({ orientationBias: 'trade' });
    const amplified = evaluatePressures(developmentContext(state, s!)).pressures.trade ?? 0;
    expect(amplified).toBeGreaterThan(baseline);
  });

  it('amplifies security pressure for a settlement whose identity is defense-oriented', () => {
    const { state, settlements } = societyFixture();
    const s = settlements[0]!;
    const baseline = evaluatePressures(developmentContext(state, s)).pressures.security ?? 0;
    s.architecture = baseIdentity({ orientationBias: 'defense' });
    const amplified = evaluatePressures(developmentContext(state, s)).pressures.security ?? 0;
    expect(amplified).toBeGreaterThan(baseline);
  });

  it('keeps a shared culture family fixed while settlement identity drifts the continuous knobs', () => {
    const { state, settlements } = contrastingSocieties();
    run(state, 6);
    const [sacred, civic] = settlements;
    const culture = state.cultures[0]!;
    const profileA = createSettlementProfile(culture.id, culture.style, sacred!.architecture);
    const profileB = createSettlementProfile(culture.id, culture.style, civic!.architecture);
    const grammarA = resolveBuildingGrammar(profileA, 'village', 'house', 'shared-seed', undefined, sacred!.architecture);
    const grammarB = resolveBuildingGrammar(profileB, 'village', 'house', 'shared-seed', undefined, civic!.architecture);
    expect(grammarA.roofFamily).toBe(grammarB.roofFamily);
    expect(grammarA.motif).toBe(grammarB.motif);
    expect(grammarA.pattern).toBe(grammarB.pattern);
    const knobsDiffer = grammarA.eaveOverhang !== grammarB.eaveOverhang
      || grammarA.ornament !== grammarB.ornament
      || grammarA.plinthHeight !== grammarB.plinthHeight;
    expect(knobsDiffer).toBe(true);
  });

  it('applies a settlement-consistent footprint skew on top of per-building jitter', () => {
    const identity = baseIdentity({ footprintBias: 0.8 });
    const withIdentity = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-skew', undefined, identity);
    const neutral = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-skew', undefined, undefined);
    expect(withIdentity.width).toBeCloseTo(neutral.width * (1 - 0.8 * 0.12), 5);
    expect(withIdentity.depth).toBeCloseTo(neutral.depth * (1 + 0.8 * 0.12), 5);
  });

  it('still varies width independently between two plots sharing one settlement identity', () => {
    const identity = baseIdentity({ footprintBias: 0.5 });
    const a = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-A', undefined, identity);
    const b = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-B', undefined, identity);
    expect(a.width).not.toBeCloseTo(b.width, 5);
  });

  it('increases plinth height with local slope', () => {
    const flat = resolveBuildingGrammar(profile(), 'village', 'hall', 'plot-slope', undefined, undefined, 0);
    const steep = resolveBuildingGrammar(profile(), 'village', 'hall', 'plot-slope', undefined, undefined, 18);
    expect(steep.plinthHeight).toBeGreaterThan(flat.plinthHeight);
  });

  it('gives two settlements of the same culture genuinely different geometry via their dialect key', () => {
    const a = resolveBuildingGrammar(profile(), 'village', 'house', 'dialect-aaa:house:v0');
    const b = resolveBuildingGrammar(profile(), 'village', 'house', 'dialect-bbb:house:v0');
    expect(a.width).not.toBeCloseTo(b.width, 5);
    expect(a.wear).not.toBeCloseTo(b.wear, 5);
  });

  it('resolves identically for repeated calls with the same identity and slope (determinism)', () => {
    const identity = baseIdentity({ ornamentBias: 0.4, massingCourtyardTendency: 0.9 });
    const a = resolveBuildingGrammar(profile(), 'village', 'hall', 'plot-7', undefined, identity, 12);
    const b = resolveBuildingGrammar(profile(), 'village', 'hall', 'plot-7', undefined, identity, 12);
    expect(a).toEqual(b);
  });
});

describe('settlement architecture pass 2: silhouette, climate, landmarks, industry', () => {
  it('gives a landmark a dramatic crown and elevated ornament an ordinary building of the same role lacks', () => {
    const ordinary = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-ordinary');
    const landmark = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-ordinary', undefined, undefined, undefined, { isLandmark: true });
    expect(landmark.crown).not.toBe('none');
    expect(landmark.ornament).toBeGreaterThanOrEqual(ordinary.ornament);
    expect(landmark.ornament).toBeGreaterThanOrEqual(0.85);
  });

  it('responds to climate signal: cold/wet steepens the roof, hot/dry flattens it', () => {
    const cold = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-climate', undefined, undefined, undefined, { climateSignal: -1 });
    const hot = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-climate', undefined, undefined, undefined, { climateSignal: 1 });
    expect(cold.roofPitch).toBeGreaterThan(hot.roofPitch);
  });

  it('extends the plinth for flood-prone plots', () => {
    const dry = resolveBuildingGrammar(profile(), 'village', 'hall', 'plot-flood', undefined, undefined, 0, { floodDepth: 0 });
    const flooded = resolveBuildingGrammar(profile(), 'village', 'hall', 'plot-flood', undefined, undefined, 0, { floodDepth: 0.4 });
    expect(flooded.plinthHeight).toBeGreaterThan(dry.plinthHeight);
  });

  it('keeps mid-tier industrial buildings rooted in the culture roof language, converging to the functional form only at major scale', () => {
    const midTier = resolveBuildingGrammar(profile(), 'industrial', 'factory', 'plot-industry', {
      need: 'manufacturing', form: 'workshop', name: 'powered manufactory', level: 2, material: 'metal',
      cultureId: 'test-culture', style: CULTURE, services: {}, reasons: [], capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1,
    });
    const majorTier = resolveBuildingGrammar(profile(), 'industrial', 'factory', 'plot-industry', {
      need: 'manufacturing', form: 'works', name: 'powered manufactory', level: 3, material: 'metal',
      cultureId: 'test-culture', style: CULTURE, services: {}, reasons: [], capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1,
    });
    expect(majorTier.roofFamily).toBe('saw-tooth');
    expect(midTier.roofFamily).not.toBe('saw-tooth');
  });

  it('keeps the origin-fabric material distinct from the current one after a real material shift, so the building core can render older than its new annex', () => {
    const development: StructureDevelopment = {
      need: 'housing', form: 'dwelling', name: 'household compound', level: 2, material: 'masonry',
      cultureId: 'culture-1', style: CULTURE, services: {}, reasons: [], capabilities: [],
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1,
      status: 'active',
      origin: { month: 0, action: 'founded', name: 'household shelter', need: 'housing', cultureId: 'culture-1', reasons: [], form: 'dwelling', level: 1, material: 'timber' },
      history: [
        { month: 24, action: 'expanded', name: 'household compound', need: 'housing', cultureId: 'culture-1', reasons: [], form: 'dwelling', level: 2, material: 'masonry' },
      ],
      transitionCount: 1, lastUsedMonth: 24,
    };
    const model = deriveArchitecturalGenerations(development);
    expect(model.generations.length).toBeGreaterThan(1);
    // StructureComponents.ts always gives the core `origin` provenance and the massing annex a
    // later generation (generationForAnnex's own contract) — the core is the older fabric here.
    expect(generationForOriginFabric(model).material).toBe('timber');
    expect(generationForCurrentFabric(model).material).toBe('masonry');
    expect(generationForAnnex(model, 0, 1).material).toBe(generationForCurrentFabric(model).material);
  });

  it('resolves identically for repeated calls with the same landmark/climate/flood context (determinism)', () => {
    const context = { isLandmark: true, climateSignal: 0.6, floodDepth: 0.2 } as const;
    const a = resolveBuildingGrammar(profile(), 'industrial', 'hall', 'plot-9', undefined, undefined, 5, context);
    const b = resolveBuildingGrammar(profile(), 'industrial', 'hall', 'plot-9', undefined, undefined, 5, context);
    expect(a).toEqual(b);
  });
});
