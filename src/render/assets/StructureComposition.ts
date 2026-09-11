import type { DevelopmentResponse } from '../../sim/development/types';
import type { BuildingGrammar } from './BuildingGrammar';
import { applyHistoricalInheritance } from './StructureHeritage';

/**
 * Step 2 structure identity: change the physical proportions of a completed response so
 * institutions with the same base role still occupy recognisably different sites.
 *
 * This remains presentation-only. It reads authoritative development state and changes
 * canonical massing, footprint proportions and precinct scale; it never creates a service,
 * capability or resource that the simulation did not already produce.
 */
export function applyDevelopmentComposition(grammar: BuildingGrammar, development: DevelopmentResponse): void {
  const level = development.level;
  const developed = level > 1;
  const major = level >= 3;
  const growth = level === 3 ? 1.16 : level === 2 ? 1.08 : 1;

  switch (development.need) {
    case 'housing':
      grammar.width *= 1.02 * growth;
      grammar.depth *= 1.06 * growth;
      grammar.wallHeight *= major ? 1.06 : 1;
      grammar.bays += developed ? 1 : 0;
      break;

    case 'food':
      // Productive/storage sites stay broad and low rather than becoming civic-looking blocks.
      grammar.width *= 1.12 * growth;
      grammar.depth *= 1.08;
      grammar.wallHeight *= 0.9;
      grammar.storeys = 1;
      grammar.bays += developed ? 1 : 0;
      break;

    case 'trade':
      // Long public frontage and shallow depth read as a market/exchange edge.
      grammar.width *= 1.2 * growth;
      grammar.depth *= 0.92 * growth;
      grammar.wallHeight *= 0.9;
      grammar.bays += 1 + level;
      break;

    case 'government':
      // A deep, axial court with a stronger central block.
      grammar.width *= 1.08 * growth;
      grammar.depth *= 1.16 * growth;
      grammar.wallHeight *= 1.08;
      grammar.storeys = Math.max(grammar.storeys, developed ? 2 : 1);
      grammar.bays += developed ? 2 : 1;
      grammar.plinthHeight *= major ? 1.3 : 1.15;
      break;

    case 'security':
      if (development.form === 'tower') {
        grammar.width *= 0.9;
        grammar.depth *= 0.9;
        grammar.wallHeight *= 1.18;
        grammar.plinthHeight *= 1.2;
      } else {
        grammar.width *= 1.04 * growth;
        grammar.depth *= 1.14 * growth;
        grammar.wallHeight *= 1.02;
        grammar.bays += developed ? 1 : 0;
      }
      break;

    case 'religion':
      // Sacred precincts grow vertically and axially rather than simply becoming wider halls.
      grammar.width *= 1.04 * growth;
      grammar.depth *= 1.12 * growth;
      grammar.wallHeight *= 1.12;
      grammar.plinthHeight *= developed ? 1.25 : 1.1;
      break;

    case 'knowledge':
      // Archive/teaching buildings bias toward a deeper courtyard plan.
      grammar.width *= 1.08 * growth;
      grammar.depth *= 1.22 * growth;
      grammar.wallHeight *= 0.96;
      grammar.storeys = Math.max(grammar.storeys, major ? 2 : 1);
      grammar.bays += developed ? 2 : 1;
      break;

    case 'healthcare':
      // Low, wide pavilion wings distinguish care buildings from councils and academies.
      grammar.width *= 1.28 * growth;
      grammar.depth *= 1.06 * growth;
      grammar.wallHeight *= 0.82;
      grammar.storeys = major ? 2 : 1;
      grammar.bays += 2 + (major ? 1 : 0);
      grammar.plinthHeight *= 0.78;
      break;

    case 'manufacturing':
      grammar.width *= 1.22 * growth;
      grammar.depth *= 1.16 * growth;
      grammar.wallHeight *= 1.04;
      grammar.bays += 2;
      break;

    case 'transport':
      // Freight buildings have a long loading face and relatively shallow enclosed body.
      grammar.width *= 1.34 * growth;
      grammar.depth *= 0.94 * growth;
      grammar.wallHeight *= 0.86;
      grammar.storeys = 1;
      grammar.bays += 2 + level;
      break;

    case 'energy':
      grammar.width *= 1.12 * growth;
      grammar.depth *= 1.2 * growth;
      grammar.wallHeight *= 1.08;
      grammar.storeys = Math.max(grammar.storeys, developed ? 2 : 1);
      grammar.bays += developed ? 1 : 0;
      break;

    case 'water':
      // Cistern/sanitation works spread across a low twin footprint.
      grammar.width *= 1.16 * growth;
      grammar.depth *= 1.18 * growth;
      grammar.wallHeight *= 0.76;
      grammar.storeys = 1;
      grammar.bays = Math.max(2, grammar.bays);
      grammar.plinthHeight *= 0.75;
      break;

    case 'memory':
      // Monument precincts keep a compact core while their court/forecourt carries the scale.
      grammar.width *= major ? 1.16 : 1.04;
      grammar.depth *= major ? 1.16 : 1.04;
      grammar.wallHeight *= major ? 1.32 : developed ? 1.16 : 1;
      grammar.plinthHeight *= major ? 1.35 : 1.15;
      break;
  }

  // Step 3: completed structures keep visible traces of their authoritative origin and
  // transitions. Fresh responses are unchanged because the helper is a no-op without history.
  applyHistoricalInheritance(grammar, development);

  // Keep procedural detail density coherent after footprint growth and historical accretion.
  grammar.bays = Math.max(1, Math.min(10, Math.round(grammar.bays)));
  grammar.width = Math.max(0.42, grammar.width);
  grammar.depth = Math.max(0.42, grammar.depth);
  grammar.wallHeight = Math.max(0.18, grammar.wallHeight);
}
