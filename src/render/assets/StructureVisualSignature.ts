import type { DevelopmentResponse } from '../../sim/development/types';
import { deriveArchitecturalGenerations } from './StructureGenerations';
import { deriveStructureHeritage } from './StructureHeritage';

function preservationBand(value: number): 'trace' | 'material' | 'strong' {
  if (value >= 0.3) return 'strong';
  if (value >= 0.24) return 'material';
  return 'trace';
}

/**
 * Geometry-safe, instance-neutral history signature for procedural building caching.
 *
 * Exact event months, transition narration and institution ids are deliberately excluded. The
 * retained fields are exactly the historical facts that can change BuildingGrammar geometry or
 * the shared structural-component manifest. This means two buildings with the same visible fabric
 * can share one cached asset even if they reached that state in different centuries.
 */
export function structureVisualHistorySignature(response: DevelopmentResponse | undefined): string {
  if (!response) return 'none';
  const generations = deriveArchitecturalGenerations(response);
  const heritage = deriveStructureHeritage(response);
  if (!heritage) return `fresh:${generations.visualSignature}`;

  // Historical inheritance only distinguishes upgrade counts up to the point where geometry caps.
  const geometricUpgradeCount = Math.min(5, heritage.upgradeCount);
  return [
    `generations=${generations.visualSignature}`,
    `legacy=${heritage.legacyNeed}.${heritage.legacyForm}.${heritage.legacyMaterial}.${heritage.legacyCultureId}`,
    `originLevel=${heritage.originLevel}`,
    `upgrades=${geometricUpgradeCount}`,
    `repurposed=${heritage.repurposed ? 1 : 0}`,
    `reused=${heritage.reused ? 1 : 0}`,
    `ruin=${heritage.survivedRuin ? 1 : 0}`,
    `cultureShift=${heritage.cultureShift ? 1 : 0}`,
    `materialShift=${heritage.materialShift ? 1 : 0}`,
    `ceremonial=${heritage.ceremonialMemory ? 1 : 0}`,
    `industrial=${heritage.industrialMemory ? 1 : 0}`,
    `preservation=${preservationBand(heritage.preservation)}`,
  ].join('|');
}
