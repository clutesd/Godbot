/** Read-only QA fixtures: production catalogue and material evidence, never geometry overrides. */
import type { DevelopmentResponse } from '../sim/development/types';
import type { MaterialKind } from '../sim/resources/MaterialEconomy';
import { structureCatalogue } from '../render/architecture/StructureCatalogue';
import { architecturalMaterial, materialAvailable, type ArchitecturalMaterialId } from '../render/architecture/MaterialLibrary';
import { periodRank, type ArchitecturalPeriod } from '../render/architecture/ArchitecturalPeriod';
import type { BuildingRole } from '../render/assets/BuildingGrammar';
import type { BuildingArchetype } from '../render/architecture/BuildingArchetype';

export const BROWSER_CATALOGUE = structureCatalogue();
export const FOUNDING_ADAPTATIONS: readonly {
  id: string; label: string; archetype: BuildingArchetype; role: BuildingRole;
  adaptation: NonNullable<DevelopmentResponse['adaptation']>; need: DevelopmentResponse['need'];
  form: DevelopmentResponse['form']; material: DevelopmentResponse['material'];
}[] = [
  { id: 'founding:lean-to', label: 'Lean-to', archetype: 'house', role: 'lean-to', adaptation: 'lean-to', need: 'housing', form: 'dwelling', material: 'timber' },
  { id: 'founding:earth-shelter', label: 'Earth shelter', archetype: 'house', role: 'shelter', adaptation: 'earth-shelter', need: 'housing', form: 'dwelling', material: 'earth' },
  { id: 'founding:hut', label: 'Hut', archetype: 'house', role: 'hut', adaptation: 'hut', need: 'housing', form: 'dwelling', material: 'timber' },
  { id: 'founding:cache', label: 'Cache / store pit', archetype: 'granary', role: 'store-pit', adaptation: 'cache', need: 'food', form: 'store', material: 'timber' },
];

export function validBrowserPeriods(subject: string): readonly ArchitecturalPeriod[] {
  if (FOUNDING_ADAPTATIONS.some(entry => entry.id === subject)) return ['neolithic'];
  return BROWSER_CATALOGUE.find(entry => entry.id === subject)?.periods ?? [];
}

export interface BrowserMaterialScenario {
  id: string; label: string; material?: DevelopmentResponse['material'];
  targets: readonly ArchitecturalMaterialId[];
  bill?: Partial<Record<MaterialKind, number>>;
}

/** Representative evidence, not a request to force the corresponding resolved material. */
export const MATERIAL_SCENARIOS: readonly BrowserMaterialScenario[] = [
  { id: 'auto', label: 'Auto / simulation default', targets: [] },
  { id: 'timber', label: 'Timber-rich', material: 'timber', targets: ['rough-hewn-timber'], bill: { timber: 90, 'plant-fiber': 10 } },
  { id: 'earth', label: 'Earth / adobe', material: 'earth', targets: ['adobe'], bill: { clay: 90, 'plant-fiber': 10 } },
  { id: 'stone', label: 'Stone-rich', material: 'masonry', targets: ['fieldstone'], bill: { stone: 90, timber: 10 } },
  { id: 'brick', label: 'Fired brick', material: 'ceramic', targets: ['fired-brick'], bill: { brick: 90, timber: 10 } },
  { id: 'mixed', label: 'Mixed masonry', material: 'masonry', targets: ['fieldstone', 'fired-brick'], bill: { stone: 50, brick: 40, timber: 10 } },
  { id: 'metal', label: 'Iron / steel', material: 'metal', targets: ['wrought-iron'], bill: { iron: 90, timber: 10 } },
  { id: 'concrete', label: 'Concrete', material: 'masonry', targets: ['concrete'], bill: { stone: 90, iron: 10 } },
  { id: 'composite', label: 'Modern composite', material: 'metal', targets: ['structural-steel', 'curtain-glass'], bill: { steel: 60, clay: 30, 'machine-parts': 10 } },
];

export function scenarioEvidence(scenario: BrowserMaterialScenario, period: ArchitecturalPeriod): {
  capabilities: string[]; materialCost?: Record<string, number>; material?: DevelopmentResponse['material'];
} {
  // Enrich the representative toolkit only with materials already introduced in this period.
  const peers: ArchitecturalMaterialId[] = scenario.id === 'stone' ? ['dressed-stone', 'ashlar']
    : scenario.id === 'timber' ? ['sawn-lumber']
    : scenario.id === 'metal' ? ['steel', 'structural-steel', 'corrugated-metal']
    : scenario.id === 'concrete' ? ['reinforced-concrete'] : [];
  const targets = [...scenario.targets, ...peers.filter(id => periodRank(architecturalMaterial(id).earliestPeriod) <= periodRank(period))];
  const capabilities = [...new Set(targets.flatMap(id => [...architecturalMaterial(id).requiresCapabilities]))];
  const materialCost = scenario.bill ? Object.fromEntries(Object.entries(scenario.bill)) : undefined;
  if (materialCost && scenario.id === 'metal' && periodRank(period) >= periodRank('industrial')) {
    delete materialCost['iron']; materialCost['steel'] = 90;
  }
  return { capabilities, materialCost, material: scenario.material };
}

export function scenarioAvailable(scenario: BrowserMaterialScenario, period: ArchitecturalPeriod): boolean {
  const { capabilities } = scenarioEvidence(scenario, period);
  return scenario.targets.every(id => materialAvailable(id, { period, capabilities }));
}

export function validMaterialScenarios(period: ArchitecturalPeriod): readonly BrowserMaterialScenario[] {
  return MATERIAL_SCENARIOS.filter(scenario => scenarioAvailable(scenario, period));
}
