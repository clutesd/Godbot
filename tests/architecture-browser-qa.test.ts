import { describe, expect, it } from 'vitest';
import { BROWSER_CATALOGUE, FOUNDING_ADAPTATIONS, validBrowserPeriods, MATERIAL_SCENARIOS, validMaterialScenarios, scenarioEvidence } from '../src/dev/architectureBrowserModel';
import { BUILDING_ARCHETYPES, archetypeExistsIn } from '../src/render/architecture/BuildingArchetype';
import { ARCHITECTURAL_PERIODS, PERIOD_DRIVE } from '../src/render/architecture/ArchitecturalPeriod';
import { materialAvailable, isArchitecturalMaterial } from '../src/render/architecture/MaterialLibrary';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import type { BuildingSpec } from '../src/render/architecture/BuildingSpec';
import type { DevelopmentResponse } from '../src/sim/development/types';

const culture = { primary: '#6d7f84', secondary: '#3d4a4e', accent: '#c6a86b', symbol: 'mountain-knot' as const, pattern: 'terrace' as const, nameSyllables: ['kar'] };

describe('architecture browser production QA inputs', () => {
  it('exposes the entire catalogue including dedicated and non-active entries', () => {
    expect(BROWSER_CATALOGUE.map(entry => entry.id)).toEqual([...BUILDING_ARCHETYPES]);
    expect(BROWSER_CATALOGUE.find(entry => entry.id === 'bridge')?.geometry).toBe('dedicated');
    expect(BROWSER_CATALOGUE.find(entry => entry.id === 'boundary-wall')?.geometry).toBe('dedicated');
    for (const entry of BROWSER_CATALOGUE) {
      expect(validBrowserPeriods(entry.id)).toEqual(ARCHITECTURAL_PERIODS.filter(period => archetypeExistsIn(entry.id, period)));
    }
    expect(validBrowserPeriods('silo')).not.toContain('medieval');
    expect(validBrowserPeriods('unknown')).toEqual([]);
  });

  it('gates material scenarios by the production library and never mutates a preset bill', () => {
    expect(validMaterialScenarios('neolithic').map(entry => entry.id)).toEqual(['auto', 'timber', 'earth', 'stone']);
    expect(validMaterialScenarios('medieval').map(entry => entry.id)).not.toContain('concrete');
    expect(validMaterialScenarios('industrial').map(entry => entry.id)).toContain('concrete');
    expect(validMaterialScenarios('industrial').map(entry => entry.id)).not.toContain('composite');
    expect(validMaterialScenarios('modern').map(entry => entry.id)).toContain('composite');
    const iron = MATERIAL_SCENARIOS.find(entry => entry.id === 'metal')!;
    expect(scenarioEvidence(iron, 'industrial').materialCost?.['steel']).toBe(90);
    expect(iron.bill?.iron).toBe(90);
  });

  it('resolves every offered house/silo comparison through the real AssetBuilder at the requested period', () => {
    const builder = new AssetBuilder('browser-qa-tests');
    try {
      for (const archetype of ['house', 'silo'] as const) for (const period of validBrowserPeriods(archetype)) {
        for (const scenario of validMaterialScenarios(period)) {
          const evidence = scenarioEvidence(scenario, period);
          const development: DevelopmentResponse = {
            need: archetype === 'house' ? 'housing' : 'food', form: archetype === 'house' ? 'dwelling' : 'store', name: archetype,
            level: PERIOD_DRIVE[period].level, material: evidence.material ?? 'timber', cultureId: 'highland', style: culture,
            services: {}, reasons: [], capabilities: evidence.capabilities, materialCost: evidence.materialCost,
            cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 0,
          };
          const asset = builder.getAsset('building', { seed: `same-concept:${archetype}`, culture, archetype, era: PERIOD_DRIVE[period].era, development, prosperity: 0.45 });
          const spec = asset.mesh.userData['buildingSpec'] as BuildingSpec;
          expect(spec.archetype).toBe(archetype);
          expect(spec.period).toBe(period);
          expect(spec.provenance.periodLifted).toBe(false);
          expect(spec.provenance.evidenceGrade).toBe(scenario.bill ? 'billed' : 'class');
          for (const id of Object.values(spec.materials).filter(isArchitecturalMaterial)) expect(materialAvailable(id, { period, capabilities: evidence.capabilities })).toBe(true);
        }
      }
    } finally { builder.dispose(); }
  });

  it('reproduces founding adaptation identities with production assets', () => {
    const builder = new AssetBuilder('founding-browser-qa');
    try {
      for (const entry of FOUNDING_ADAPTATIONS) {
        expect(validBrowserPeriods(entry.id)).toEqual(['neolithic']);
        const asset = builder.getAsset('building', { seed: 'same-founding-seed', culture, era: 'early', archetype: entry.archetype,
          variant: entry.role, development: { need: entry.need, form: entry.form, name: entry.label, level: 1, material: entry.material,
            adaptation: entry.adaptation, cultureId: 'highland', style: culture, services: {}, reasons: [], capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 0 } });
        const spec = asset.mesh.userData['buildingSpec'] as BuildingSpec;
        expect(spec.adaptation).toBe(entry.adaptation); expect(spec.period).toBe('neolithic');
      }
    } finally { builder.dispose(); }
  });
});
