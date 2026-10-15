/** Exhaustive browser evidence matrix. Requests are evidence scenarios, never forced materials. */
import { BROWSER_CATALOGUE, validMaterialScenarios, scenarioEvidence } from './architectureBrowserModel';
import { PERIOD_DRIVE, type ArchitecturalPeriod } from '../render/architecture/ArchitecturalPeriod';
import type { AssetConfig } from '../render/assets/AssetBuilder';
import type { StructureCatalogueEntry } from '../render/architecture/StructureCatalogue';

export const ART_REVIEW_CULTURE = { primary: '#6d7f84', secondary: '#3d4a4e', accent: '#c6a86b',
  symbol: 'mountain-knot' as const, pattern: 'terrace' as const, nameSyllables: ['kar'] };

export const CONSTRUCTION_ART_CASES = BROWSER_CATALOGUE.flatMap(entry => entry.periods.flatMap(period =>
  validMaterialScenarios(period).map(scenario => ({ id: `${entry.id}-${period}-${scenario.id}`, archetype: entry.id,
    period, scenario: scenario.id, catalogueStatus: entry.status, geometry: entry.geometry,
    url: `/architecture-browser.html?view=solo&archetype=${entry.id}&period=${period}&material-scenario=${scenario.id}&culture=highland&stage=7&seed=art-review&full-detail=true` }))));

export function constructionArtConfig(entry: StructureCatalogueEntry, period: ArchitecturalPeriod, scenarioId: string, stage = 7): AssetConfig {
  const scenario = validMaterialScenarios(period).find(s => s.id === scenarioId)!;
  const evidence = scenarioEvidence(scenario,period), drive = PERIOD_DRIVE[period];
  const route = entry.routes[0];
  const need = route?.need ?? (entry.category === 'domestic' ? 'housing' : 'manufacturing');
  const form = route?.form ?? (entry.id === 'house' ? 'dwelling' : entry.id === 'granary' ? 'store' : 'works');
  return { seed: `art-review:${entry.id}`, culture: ART_REVIEW_CULTURE, era: drive.era, archetype: entry.id,
    variant: `${entry.role}#${stage}`, prosperity: .45, development: {
      need, form, name: entry.id, level: drive.level, material: evidence.material ?? 'timber',
      cultureId: 'highland', style: ART_REVIEW_CULTURE, services: {}, reasons: [],
      capabilities: evidence.capabilities, materialCost: evidence.materialCost,
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 0,
    } };
}
