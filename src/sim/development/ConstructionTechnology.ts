import { practical } from '../knowledge/KnowledgeSystem';
import type { Settlement } from '../types';

/**
 * Capabilities that change *how a settlement builds*, recorded on each response when it is chosen.
 *
 * A structure's architecture belongs to the builders who raised it. Development level says how
 * much was built, not with what technique, so before this was recorded an industrial town's new
 * level-1 house was drawn as a neolithic hut and nothing short of a "works" ever looked modern.
 * Recording the practised techniques at selection freezes them with the building: it does not
 * modernise when the town later learns more, and it does not regress if the knowledge is lost.
 *
 * Construction-bearing only. Knowing navigation or medicine says nothing about how a roof is framed.
 * The renderer's period table is keyed on exactly these ids (see ArchitecturalPeriod).
 */
export const CONSTRUCTION_TECHNOLOGIES = [
  'pottery-firing', 'stone-composites', 'metal-smelting', 'material-testing', 'iron-working', 'leverage',
  'high-temperature-ceramics', 'rotary-machinery', 'precision-tools', 'mechanical-power', 'standardized-parts',
  'thermodynamics', 'industrial-chemistry', 'rail-transport', 'precision-manufacturing', 'electrical-generation',
  'electric-grid', 'automation', 'computation',
] as const;

/** The same practical threshold `responseForNeed` uses for ordinary requirements. */
export const CONSTRUCTION_PRACTICE = 0.3;

export function practisedConstructionTechnology(settlement: Settlement): string[] {
  return CONSTRUCTION_TECHNOLOGIES.filter(id => practical(settlement, id) >= CONSTRUCTION_PRACTICE);
}
