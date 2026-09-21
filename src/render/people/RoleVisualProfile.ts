import type { PersonRole } from '../../sim/types';

/** Exhaustive rendering taxonomy over existing simulation roles. No job authority lives here. */
export type RoleVisualFamily =
  | 'earth'
  | 'water'
  | 'labor'
  | 'trade'
  | 'guard'
  | 'ritual'
  | 'civic'
  | 'knowledge'
  | 'industry'
  | 'healing'
  | 'elder'
  | 'ordinary';

/** Exhaustive against the simulation union: a new profession requires an explicit visual choice. */
export const ROLE_FAMILIES = {
  child: 'ordinary', elder: 'elder', gatherer: 'earth', hunter: 'earth', farmer: 'earth',
  fisher: 'water', sailor: 'water', 'dock-worker': 'water',
  laborer: 'labor', builder: 'labor', miner: 'labor', 'craft-worker': 'labor',
  trader: 'trade', merchant: 'trade', transporter: 'trade', 'logistics-worker': 'trade',
  soldier: 'guard', guard: 'guard', priest: 'ritual', 'ritual-specialist': 'ritual',
  administrator: 'civic', manager: 'civic', scholar: 'knowledge', scientist: 'knowledge', researcher: 'knowledge',
  healer: 'healing', 'medical-worker': 'healing',
  'factory-worker': 'industry', engineer: 'industry', machinist: 'industry', 'railway-worker': 'industry',
  'energy-technician': 'industry', 'machine-systems-specialist': 'industry', 'space-worker': 'industry',
} as const satisfies Record<PersonRole, RoleVisualFamily>;

export function roleVisualFamilyFor(role: string | undefined): RoleVisualFamily {
  return role && Object.hasOwn(ROLE_FAMILIES, role) ? ROLE_FAMILIES[role as PersonRole] : 'ordinary';
}
