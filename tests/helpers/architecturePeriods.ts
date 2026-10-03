/**
 * architecturePeriods.ts
 *
 * Shared fixtures for driving the architecture system from a test.
 *
 * The point of this file is that a test should never hand the architecture layer a period, a
 * structural family or a material directly — those are all *derived*, and a test that supplies
 * them has stopped exercising the production path. So a test names the period it wants and this
 * builds the authoritative inputs that reach it: the presentation era, the development level, and
 * the coarse structure class the period presumes.
 */

import type { DevelopmentResponse, StructureMaterial } from '../../src/sim/development/types';
import type { CultureStyle } from '../../src/sim/types';
import type { BuildingRole } from '../../src/render/assets/BuildingGrammar';
import type { ArchitecturalPeriod } from '../../src/render/architecture/ArchitecturalPeriod';
import { PERIOD_DRIVE, periodRank } from '../../src/render/architecture/ArchitecturalPeriod';
import type { BuildingArchetype } from '../../src/render/architecture/BuildingArchetype';
import type { BuildingSpecContext } from '../../src/render/architecture/BuildingSpec';

export { PERIOD_DRIVE };

export const TEST_CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

/** The coarse structure class a period presumes, mirroring `presumedClass` in BuildingSpec. */
export function periodMaterialClass(period: ArchitecturalPeriod): StructureMaterial {
  const rank = periodRank(period);
  if (rank <= 1) return 'earth';
  if (rank <= 3) return 'timber';
  if (rank <= 4) return 'masonry';
  if (rank === 5) return 'ceramic';
  return 'metal';
}

/**
 * A development response shaped exactly as `responseForNeed` produces them, carrying only the
 * fields the architecture system is allowed to read.
 */
export function periodResponse(options: {
  period: ArchitecturalPeriod;
  need?: DevelopmentResponse['need'];
  form?: DevelopmentResponse['form'];
  level?: number;
  capabilities?: readonly string[];
}): DevelopmentResponse {
  const drive = PERIOD_DRIVE[options.period];
  return {
    need: options.need ?? 'housing',
    form: options.form ?? 'dwelling',
    name: `${options.need ?? 'housing'}-${options.form ?? 'dwelling'}`,
    level: options.level ?? drive.level,
    material: periodMaterialClass(options.period),
    cultureId: 'test-culture',
    style: TEST_CULTURE,
    services: {},
    reasons: [],
    capabilities: [...(options.capabilities ?? [])],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 0,
  };
}

/**
 * A spec context that reaches a named period through the inputs the resolver really reads.
 *
 * Nothing supplies the period: the era and the response's level do, exactly as they do in
 * production. That is what makes an assertion made through this helper an assertion about the
 * production path rather than about a hand-built spec.
 */
export function specContextFor(options: {
  role: BuildingRole;
  period: ArchitecturalPeriod;
  archetype?: BuildingArchetype;
  seed?: string;
  development?: DevelopmentResponse;
  prosperity?: number;
}): BuildingSpecContext {
  const drive = PERIOD_DRIVE[options.period];
  return {
    archetype: options.archetype,
    role: options.role,
    era: drive.era,
    seed: options.seed ?? `${options.archetype ?? options.role}:${options.period}`,
    culture: { materialBias: 'mixed', roofLanguage: 'gable-geometric', trimDensity: 0.3 },
    development: options.development ?? periodResponse({ period: options.period }),
    prosperity: options.prosperity ?? 0.5,
  };
}
