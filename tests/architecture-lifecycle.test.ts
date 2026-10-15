/**
 * Building lifecycle: deterioration, repair, upgrade and repurposing never shrink standing fabric,
 * and every archetype pathway is driven by a real simulation fact.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import type { CultureStyle, Settlement } from '../src/sim/types';
import { retainedFabric, type DevelopmentResponse, type SettlementNeed, type StructureDevelopment, type StructureForm } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { developmentBuildingRole, developmentFabric, developmentPresentationEra, priorFabricGeneration } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { peakStructureLevel, structureFit, upgradeFit } from '../src/render/assets/StructureFit';
import { applyStructuralDeterioration, conditionBand, deteriorationProfile } from '../src/render/architecture/StructuralDeterioration';
import { archetypeForContext } from '../src/render/architecture/ArchetypeRouting';
import { resolveBuildingSpec } from '../src/render/architecture/BuildingSpec';
import { technologyEra, PERIOD_EVIDENCE_CAPABILITIES } from '../src/render/architecture/ArchitecturalPeriod';
import { CONSTRUCTION_TECHNOLOGIES } from '../src/sim/development/ConstructionTechnology';
import { districtForResponse } from '../src/shared/SettlementLayoutPlan';
import { validateStructureCatalogue } from '../src/render/architecture/StructureCatalogue';
import { selectDisplayedPlots } from '../src/render/settlement/DisplayedPlots';

const CULTURE: CultureStyle = { primary: '#a8553a', secondary: '#2d3a5c', accent: '#d8a943', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ka', 'ru'] };
const NEUTRAL = { materialBias: 'mixed', roofLanguage: 'gable-geometric', trimDensity: 0.4 } as const;

function response(overrides: Partial<DevelopmentResponse> = {}): DevelopmentResponse {
  return {
    need: 'housing', form: 'dwelling', name: 'test', level: 1, material: 'timber', cultureId: 'c', style: CULTURE,
    services: {}, reasons: [], capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1,
    ...overrides,
  };
}

/** Exactly the smallest and largest plot `reserveStructurePlot` can allot a district. */
function plotFor(development: DevelopmentResponse, share: number): { width: number; depth: number } {
  const district = districtForResponse(development);
  const major = district === 'civic' || district === 'sacred' || district === 'industrial';
  const width = share * (major ? 1.55 * 2.6 : district === 'residential' ? 1.9 : 2.0);
  return { width, depth: width * 0.82 };
}

/**
 * The finished building as `createPlacedBuilding` places it: asset, plot fit, the floor set by the
 * generation it replaced (`standingExtents`), and the rendered extents.
 */
function placed(builder: AssetBuilder, development: DevelopmentResponse, plot: { width: number; depth: number }, seed = 'lifecycle'): {
  asset: ReturnType<AssetBuilder['getAsset']>; fit: number; width: number; depth: number; height: number; archetype: string | undefined;
} {
  const shell = developmentFabric(development);
  const role = developmentBuildingRole(shell);
  const asset = builder.getAsset('building', { seed: `${seed}:${role}`, culture: CULTURE, era: developmentPresentationEra(shell), variant: `${role}#${BUILD_STAGE.DETAIL}`, development: shell });
  const massWidth = Number(asset.mesh.userData['massWidth'] ?? asset.mesh.userData['footprintWidth'] ?? 1);
  const massDepth = Number(asset.mesh.userData['massDepth'] ?? asset.mesh.userData['footprintDepth'] ?? 1);
  const height = Number(asset.mesh.userData['buildingHeight'] ?? 1);
  const prior = priorFabricGeneration(shell);
  const fit = upgradeFit(structureFit({ plotWidth: plot.width, plotDepth: plot.depth, massWidth, massDepth, level: peakStructureLevel(development) }),
    { width: massWidth, depth: massDepth, height }, prior ? placed(builder, prior, plot, seed) : undefined);
  return { asset, fit, width: massWidth * fit, depth: massDepth * fit, height: height * fit, archetype: asset.mesh.userData['architectureArchetype'] as string | undefined };
}

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object, true);
}

describe('deterioration never changes a building\'s size', () => {
  const builder = new AssetBuilder('lifecycle-deterioration');
  const development = response({ need: 'government', form: 'hall', level: 2, material: 'masonry', technology: ['leverage', 'stone-composites'] });
  const plot = plotFor(development, 1);
  const pristine = placed(builder, development, plot);

  it.each([1, 0.8, 0.55, 0.25, 0])('keeps scale, declared mass and footprint at condition %s', condition => {
    const building = pristine.asset.mesh.clone(true);
    building.scale.setScalar(pristine.fit);
    const before = bounds(building);
    const result = applyStructuralDeterioration(building, conditionBand(condition), 'plot-a');
    expect(building.scale.toArray()).toEqual([pristine.fit, pristine.fit, pristine.fit]);
    for (const angle of building.rotation.toArray().slice(0, 3) as number[]) expect(Math.abs(angle)).toBe(0);
    expect(building.userData['massWidth']).toBe(pristine.asset.mesh.userData['massWidth']);
    expect(building.userData['buildingHeight']).toBe(pristine.asset.mesh.userData['buildingHeight']);
    const after = bounds(building);
    const width = (box: THREE.Box3) => box.max.x - box.min.x, depth = (box: THREE.Box3) => box.max.z - box.min.z;
    if (condition > 0) {
      // Standing fabric keeps its plan; even a failing roof leaves the walls' footprint in place.
      expect(width(after)).toBeGreaterThanOrEqual(width(before) * 0.95);
      expect(depth(after)).toBeGreaterThanOrEqual(depth(before) * 0.95);
    }
    if (condition >= 0.55) expect(after.max.y - after.min.y).toBeGreaterThanOrEqual((before.max.y - before.min.y) * 0.9);
    if (condition < 0.85) expect(result.removedPieces).toBeGreaterThan(0);
    else expect(result.removedPieces).toBe(0);
  });

  it('only ever removes more as condition worsens, deterministically per plot', () => {
    const surviving = (condition: number) => {
      const building = pristine.asset.mesh.clone(true);
      applyStructuralDeterioration(building, conditionBand(condition), 'plot-b');
      let indices = 0;
      building.traverse(o => { if (o instanceof THREE.Mesh && o.name !== 'fallen-fabric') indices += o.geometry.index?.count ?? 0; });
      return indices;
    };
    const counts = [1, 0.8, 0.55, 0.25, 0].map(surviving);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThan(counts[i - 1]!);
    expect(surviving(0.55)).toBe(surviving(0.55));
    expect(deteriorationProfile(0).loss[BUILD_STAGE.FOUNDATION] ?? 0).toBe(0);
  });

  it('never draws the shared cached asset damaged', () => {
    const building = pristine.asset.mesh.clone(true);
    applyStructuralDeterioration(building, 0.2, 'plot-c');
    let shared = 0;
    pristine.asset.mesh.traverse(o => { if (o instanceof THREE.Mesh && o.geometry.userData['deteriorated'] !== undefined) shared++; });
    expect(shared).toBe(0);
  });

  it('has no condition-driven scaling left in the production renderer', () => {
    const renderer = readFileSync('src/render/GodboxRenderer.ts', 'utf8');
    expect(renderer).not.toMatch(/scale\.y\s*\*=\s*0\.12\s*\+\s*condition/);
    expect(renderer).not.toMatch(/rotation\.z\s*\+=\s*\(1\s*-\s*condition\)/);
    const war = readFileSync('src/render/war/StructureDestruction.ts', 'utf8');
    // The collapse animation may settle a building that is coming down; one left standing is not squashed.
    expect(war).toMatch(/plot\.condition > 0 && !fact\.vaporized/);
  });
});

const LADDERS: { need: SettlementNeed; forms: [StructureForm, StructureForm, StructureForm]; technology: string[] }[] = [
  { need: 'housing', forms: ['dwelling', 'dwelling', 'dwelling'], technology: ['leverage', 'stone-composites'] },
  { need: 'housing', forms: ['dwelling', 'dwelling', 'dwelling'], technology: ['standardized-parts', 'thermodynamics'] },
  { need: 'housing', forms: ['dwelling', 'dwelling', 'dwelling'], technology: ['automation', 'computation'] },
  { need: 'food', forms: ['store', 'store', 'store'], technology: ['pottery-firing', 'leverage'] },
  { need: 'food', forms: ['store', 'store', 'store'], technology: ['mechanical-power', 'standardized-parts'] },
  { need: 'manufacturing', forms: ['workshop', 'workshop', 'works'], technology: ['precision-tools', 'mechanical-power'] },
  { need: 'trade', forms: ['gathering', 'gathering', 'gathering'], technology: ['leverage'] },
  { need: 'trade', forms: ['store', 'store', 'store'], technology: ['rail-transport'] },
  { need: 'government', forms: ['hall', 'hall', 'hall'], technology: ['leverage', 'stone-composites'] },
  { need: 'religion', forms: ['sanctuary', 'sanctuary', 'sanctuary'], technology: ['leverage'] },
  { need: 'security', forms: ['tower', 'tower', 'tower'], technology: ['iron-working'] },
  { need: 'water', forms: ['store', 'store', 'works'], technology: ['leverage'] },
  { need: 'energy', forms: ['workshop', 'workshop', 'works'], technology: ['electrical-generation'] },
];

describe('upgrades and repurposing never shrink standing fabric', () => {
  const builder = new AssetBuilder('lifecycle-upgrades');
  it.each(LADDERS.flatMap(ladder => [0.7, 1.18].map(share => ({ ...ladder, share }))))(
    '$need $forms.2 [$technology] on a $share plot grows or holds at every upgrade', ({ need, forms, technology, share }) => {
      let previous: ReturnType<typeof placed> | undefined;
      const history: StructureDevelopment['history'] = [];
      for (const level of [1, 2, 3]) {
        const origin = { month: 0, action: 'founded' as const, name: 'x', need, cultureId: 'c', reasons: [], level: 1, form: forms[0], material: 'timber' as const, technology };
        const development = { ...response({ need, form: forms[level - 1], level, material: level === 3 ? 'masonry' : 'timber', technology }),
          origin, history: [...history], status: 'active', transitionCount: history.length, lastUsedMonth: 0 } as unknown as DevelopmentResponse;
        const plot = plotFor(response({ need, form: forms[0] }), share);
        const current = placed(builder, development, plot, `ladder:${need}`);
        if (previous) {
          expect(current.width * current.depth, `${need} L${level} footprint`).toBeGreaterThanOrEqual(previous.width * previous.depth * 0.98);
          expect(current.height, `${need} L${level} height`).toBeGreaterThanOrEqual(previous.height * 0.98);
        }
        // The completion record the simulation appends for this level, exactly as `entry()` writes it.
        if (level < 3) history.push({ month: (level + 1) * 12, action: forms[level] === forms[level - 1] ? 'expanded' : 'upgraded', name: 'x', need,
          cultureId: 'c', reasons: [], level: level + 1, form: forms[level], material: level + 1 === 3 ? 'masonry' : 'timber', technology });
        previous = current;
      }
    });

  it('keeps the larger shell when a hall is repurposed to a humbler use', () => {
    const hall = { ...response({ need: 'government', form: 'hall', level: 3, material: 'masonry', technology: ['leverage', 'stone-composites'] }),
      status: 'active', origin: { month: 0, action: 'founded', name: 'hall', need: 'government', cultureId: 'c', reasons: [], level: 3 },
      history: [], transitionCount: 0, lastUsedMonth: 0, peakLevel: 3 } as StructureDevelopment;
    const house = response({ need: 'housing', form: 'dwelling', level: 1, technology: ['leverage'] });
    const fabric = retainedFabric(hall, house);
    expect(fabric?.need).toBe('government');
    const repurposed = { ...house, status: 'active', origin: hall.origin, history: [], transitionCount: 1, lastUsedMonth: 0, peakLevel: 3, fabric } as StructureDevelopment;
    const plot = plotFor(hall, 1);
    const before = placed(builder, hall, plot, 'reuse');
    const after = placed(builder, repurposed, plot, 'reuse');
    expect(after.archetype).toBe(before.archetype);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.height).toBeCloseTo(before.height, 6);
    // Built over by something at least as large, the old shell is gone; a ruin keeps nothing.
    expect(retainedFabric(repurposed, response({ need: 'housing', level: 3 }))).toBeUndefined();
    expect(retainedFabric({ ...hall, status: 'ruin' }, house)).toBeUndefined();
    expect(peakStructureLevel(repurposed)).toBe(3);
  });
});

describe('construction technology sets the period a building is drawn in', () => {
  it('records exactly the capabilities the period table reads', () => {
    expect([...CONSTRUCTION_TECHNOLOGIES].sort()).toEqual([...PERIOD_EVIDENCE_CAPABILITIES].sort());
  });

  it.each([
    [[], 'early', 'neolithic'],
    [['leverage', 'stone-composites'], 'village', 'classical'],
    [['mechanical-power'], 'preIndustrial', 'earlyModern'],
    [['standardized-parts'], 'industrial', 'industrial'],
    [['electrical-generation'], 'advanced', 'modern'],
    [['automation', 'computation'], 'advanced', 'contemporary'],
  ] as const)('a level-1 house built with %j is %s / %s', (technology, era, period) => {
    const house = response({ technology: [...technology] });
    expect(developmentPresentationEra(house)).toBe(era);
    const spec = resolveBuildingSpec({ role: 'house', era: developmentPresentationEra(house), seed: 'tech', culture: NEUTRAL, development: house });
    expect(spec.archetype).toBe('house');
    expect(spec.period).toBe(period);
  });

  it('never lowers a building below its level and form', () => {
    expect(developmentPresentationEra(response({ form: 'works', need: 'manufacturing', level: 3, technology: [] }))).toBe('industrial');
    expect(technologyEra(['navigation', 'medicine'])).toBeUndefined();
  });

  it('reaches the silo only with a level-3 store raised by industrial builders', () => {
    const store = (level: number, technology: string[]) => {
      const development = response({ need: 'food', form: 'store', level, technology });
      return resolveBuildingSpec({ role: developmentBuildingRole(development), era: developmentPresentationEra(development), seed: 's', culture: NEUTRAL, development }).archetype;
    };
    expect(store(3, ['standardized-parts', 'mechanical-power'])).toBe('silo');
    expect(store(2, ['standardized-parts', 'mechanical-power'])).toBe('granary');
    expect(store(3, ['mechanical-power'])).toBe('granary');
  });
});

describe('every archetype pathway is driven by a recorded simulation fact', () => {
  it('validates the catalogue: every active archetype is routable, none undeclared', () => {
    expect(validateStructureCatalogue().filter(d => d.severity === 'error')).toEqual([]);
  });

  it('routes the powered wood-processing tier to the sawmill, and nothing else', () => {
    const body = { role: 'factory' as const, period: 'industrial' as const, need: 'manufacturing' as const, form: 'works' as const, level: 2 };
    expect(archetypeForContext({ ...body, facilityFamily: 'wood', facilityTier: 2 })).toBe('sawmill');
    expect(archetypeForContext({ ...body, facilityFamily: 'wood', facilityTier: 1, form: 'workshop', role: 'workshop' })).toBe('workshop');
    expect(archetypeForContext({ ...body, facilityFamily: 'metallurgy', facilityTier: 2 })).toBe('factory');
  });

  it('routes a perimeter only from a recorded perimeter-defence response', () => {
    const tower = { role: 'gate-tower' as const, period: 'medieval' as const, need: 'security' as const, form: 'tower' as const, level: 2 };
    expect(archetypeForContext({ ...tower, reasons: ['perimeter-defence'] })).toBe('boundary-wall');
    expect(archetypeForContext(tower)).toBe('gatehouse');
  });

  it('shows hand mills only where grain is recorded as hand-milled', () => {
    const store = { role: 'granary' as const, period: 'neolithic' as const, need: 'food' as const, form: 'store' as const, level: 1 };
    const seeds = Array.from({ length: 40 }, (_, i) => `plot-${i}`);
    const milled = seeds.map(seed => archetypeForContext({ ...store, seed, reasons: ['hand-milled-grain'] }));
    expect(milled).toContain('hand-mill');
    expect(milled).toContain('granary');
    expect(seeds.map(seed => archetypeForContext({ ...store, seed }))).not.toContain('hand-mill');
    expect(archetypeForContext({ ...store, level: 2, seed: 'plot-0', reasons: ['hand-milled-grain'] })).toBe('granary');
  });

  it('houses a windmill by the site it serves and the fabric it was built in', () => {
    const mill = { role: 'workshop' as const, energyKind: 'windmill' as const };
    expect(archetypeForContext({ ...mill, period: 'medieval', need: 'energy', material: 'timber' })).toBe('windmill');
    expect(archetypeForContext({ ...mill, period: 'earlyModern', need: 'energy', material: 'masonry' })).toBe('windmill');
    expect(archetypeForContext({ ...mill, period: 'earlyModern', need: 'food', material: 'timber' })).toBe('smock-mill');
    expect(archetypeForContext({ ...mill, period: 'medieval', need: 'water', material: 'timber' })).toBe('wind-pump');
    expect(archetypeForContext({ role: 'workshop', energyKind: 'waterwheel', period: 'medieval', need: 'water' })).toBe('mill');
  });
});

describe('the display budget shows what a long-lived town has become', () => {
  it('keeps the newest of every program and a spread of housing ahead of ruins', () => {
    const plots = [] as NonNullable<Settlement['structurePlots']>;
    const add = (id: string, need: SettlementNeed, form: StructureForm, level: number, month: number, status: StructureDevelopment['status'] = 'active') => {
      plots.push({ id, worldX: 0, worldZ: 0, radius: 1, width: 1, depth: 1, height: 1, condition: status === 'ruin' ? 0 : 1, foundedMonth: month,
        development: { ...response({ need, form, level }), status, origin: { month, action: 'founded', name: id, need, cultureId: 'c', reasons: [] },
          history: [], transitionCount: 0, lastUsedMonth: month } } as never);
    };
    for (let i = 0; i < 30; i++) add(`ruin-${i}`, 'food', 'store', 1, i, 'ruin');
    for (let i = 0; i < 20; i++) add(`old-house-${i}`, 'housing', 'dwelling', 1, 40 + i);
    add('factory', 'manufacturing', 'works', 3, 4000);
    add('silo', 'food', 'store', 3, 4100);
    add('court', 'housing', 'dwelling', 3, 4200);
    const shown = selectDisplayedPlots({ structurePlots: plots } as never, 32).map(p => p.id);
    expect(shown).toContain('factory');
    expect(shown).toContain('silo');
    expect(shown).toContain('court');
    expect(shown).toContain('old-house-0');
    expect(shown.filter(id => id.startsWith('ruin-')).length).toBeLessThan(10);
    expect(shown.length).toBe(32);
  });
});
