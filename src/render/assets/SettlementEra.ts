import type { Settlement } from '../../sim/types';
import { hasKnowledgeCapability } from '../../sim/knowledge/CapabilityContract';
import { developmentPresentationEra, eraRank } from './BuildingGrammar';
import type { Era } from '../materials/MaterialPalette';

/** A town's dominant built fabric, qualified by working production and utilities.
 * Individual buildings retain their own BuildingSpec; a landmark cannot modernize all homes. */
export function settlementPresentationEra(s: Settlement): Era {
  const buildings = (s.structurePlots ?? []).filter(p => p.condition > 0.25 && !p.accessRestricted && p.development?.status === 'active');
  const ranks = buildings.map(p => eraRank(developmentPresentationEra(p.development!))).sort((a, b) => a - b);
  const dominant = ranks.length ? ranks[Math.floor((ranks.length - 1) * 0.6)]! : 0;
  const productive = (s.processing?.facilities ?? []).filter(f => f.progress >= 1 && f.condition > 0.25
    && (f.lastActiveMonth ?? -Infinity) >= (s.materialEconomy?.flows?.month ?? f.lastMonth ?? 0) - 12).length;
  const shaft = (s.energy?.ledgers.mechanical.supplied ?? 0) > 0;
  const electric = (s.energy?.ledgers.electric.supplied ?? 0) > 0 && (s.energy?.service.supplied.productive ?? 0) > 0;
  if (electric && s.industry.active && s.industry.intensity >= 0.3 && productive >= 2
    && hasKnowledgeCapability(s, 'automation') && dominant >= eraRank('preIndustrial')) return 'advanced';
  if (s.industry.active && s.industry.intensity >= 0.12 && productive >= 2 && (shaft || electric)
    && dominant >= eraRank('village')) return 'industrial';
  if (productive > 0 && (shaft || s.infrastructure.workshops >= 0.25)
    && hasKnowledgeCapability(s, 'pottery-firing') && buildings.length >= 3) return 'preIndustrial';
  if (dominant >= eraRank('village') || buildings.length >= 6 && s.infrastructure.roads >= 0.12) return 'village';
  if (buildings.length > 0 || s.buildings > 8) return 'early';
  return 'primitive';
}
