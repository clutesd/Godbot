import type { Settlement, SimulationState } from '../types';
import { facilityFamilies, facilityFamily, facilityTierSpec, maxFacilityTier } from './FacilityCatalog';
import { facilityFoundingBlocker, facilityUpgradeBlocker } from './FacilitySystem';
import { facilityGoverned } from './FacilityOwnership';
import type { FacilityFamilyId, FacilityFamilySpec, FacilityLimiter, FacilityStatus } from './types';

/**
 * Observational projection of the facility authority. Nothing here plans, gates, spends or
 * reserves anything: every field is read from state or from the same blocker functions the
 * planner itself uses, so a diagnostic can never describe a decision the planner did not make.
 *
 * It exists to answer one question about a long run — "is this world failing to industrialize for
 * a real reason, or for an unintended one?" — without opening a save by hand.
 */

export type FacilityStandingKind =
  | 'no-family-implementation'
  | 'absent'
  | 'under-construction'
  | 'upgrading'
  | 'operating'
  | 'ruined';

export interface FacilityFamilyDiagnostic {
  family: FacilityFamilyId;
  name: string;
  standing: FacilityStandingKind;
  /** Built tier, 0 when nothing stands. */
  tier: number;
  maxTier: number;
  facilityId?: string;
  status?: FacilityStatus;
  limiter?: FacilityLimiter;
  /** 0..1 of nominal work delivered last month. */
  throughput: number;
  /** Months the works has run at its capacity ceiling; three are needed before a conversion starts. */
  saturationMonths: number;
  /** Why nothing stands (founding) or why the next tier has not begun (upgrade). */
  blocker?: string;
  /** Everything that reduced throughput last month, strongest first. */
  blockers: readonly string[];
  /** One sentence in the vocabulary of the thing that is actually wrong. */
  summary: string;
}

export interface SettlementIndustryDiagnostic {
  settlementId: string;
  name: string;
  governed: boolean;
  families: readonly FacilityFamilyDiagnostic[];
  /** Families that are implemented, stand, and produced something last month. */
  producing: number;
  lines: readonly string[];
}

/** Implemented families plus the reserved ids, so "not built yet" and "not written yet" stay distinct. */
function allFamilies(): readonly FacilityFamilySpec[] {
  const implemented = facilityFamilies();
  const reserved = (['ceramics', 'textiles', 'machinery', 'chemicals', 'electrical-equipment', 'strategic'] as const)
    .map(id => facilityFamily(id))
    .filter((family): family is FacilityFamilySpec => !!family && family.tiers.length === 0);
  return [...implemented, ...reserved];
}

function tierName(family: FacilityFamilyId, tier: number): string {
  return facilityTierSpec(family, tier)?.name ?? `tier ${tier}`;
}

function readableBlocker(blocker: string | undefined): string | undefined {
  if (!blocker) return undefined;
  if (blocker.startsWith('knowledge:')) return blocker.slice('knowledge:'.length).replace(/-/g, ' ');
  return blocker.replace(/-/g, ' ');
}

export function familyDiagnostic(
  state: SimulationState, s: Settlement, family: FacilityFamilySpec,
): FacilityFamilyDiagnostic {
  const max = maxFacilityTier(family.id);
  if (family.tiers.length === 0) {
    return {
      family: family.id, name: family.name, standing: 'no-family-implementation', tier: 0, maxTier: 0,
      throughput: 0, saturationMonths: 0, blocker: 'no-family-implementation', blockers: [],
      summary: `${family.name.toLowerCase()} — no family implementation`,
    };
  }
  const facilities = (s.processing?.facilities ?? []).filter(f => f.family === family.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const f = facilities[0];
  if (!f) {
    const blocker = facilityFoundingBlocker(state, s, family);
    return {
      family: family.id, name: family.name, standing: 'absent', tier: 0, maxTier: max,
      throughput: 0, saturationMonths: 0, blocker, blockers: [],
      summary: `${family.name.toLowerCase()} — no facility${blocker ? `, blocked by ${readableBlocker(blocker)}` : ', founding possible this month'}`,
    };
  }
  const standing: FacilityStandingKind = f.progress < 1 ? 'under-construction'
    : f.status === 'ruined' ? 'ruined' : f.upgrade ? 'upgrading' : 'operating';
  const upgrade = standing === 'operating' ? facilityUpgradeBlocker(state, s, f) : undefined;
  const detail = standing === 'under-construction'
    ? `${tierName(family.id, f.tier)} under construction (${Math.round(f.progress * 100)}%)`
    : standing === 'upgrading'
      ? `converting to ${tierName(family.id, f.upgrade!.toTier)} (${Math.round((f.upgrade?.progress ?? 0) * 100)}%)`
      : standing === 'ruined'
        ? `${tierName(family.id, f.tier)} in ruins`
        : upgrade === 'max-tier'
          ? `tier ${f.tier} of ${max}, the top of its ladder`
          : upgrade
            ? `tier ${f.tier} of ${max} — blocked from tier ${f.tier + 1} by ${readableBlocker(upgrade)}`
            : `tier ${f.tier} of ${max} — converting to tier ${f.tier + 1} next`;
  const running = standing === 'operating' && f.throughput > 0
    ? `, running at ${Math.round(f.throughput * 100)}% of capacity`
    : standing === 'operating' ? `, ${f.status}${f.limiter === 'none' ? '' : ` on ${f.limiter}`}` : '';
  return {
    family: family.id, name: family.name, standing, tier: f.tier, maxTier: max, facilityId: f.id,
    status: f.status, limiter: f.limiter, throughput: f.throughput, saturationMonths: f.saturationMonths,
    blocker: standing === 'operating' ? upgrade : undefined,
    blockers: [...f.blockers],
    summary: `${family.name.toLowerCase()} ${detail}${running}`,
  };
}

export function settlementIndustryDiagnostic(state: SimulationState, s: Settlement): SettlementIndustryDiagnostic {
  const families = allFamilies().map(family => familyDiagnostic(state, s, family));
  return {
    settlementId: s.id,
    name: s.name,
    governed: facilityGoverned(state, s),
    families,
    producing: families.filter(entry => entry.standing === 'operating' && entry.throughput > 0).length,
    lines: families.map(entry => `${s.name}: ${entry.summary}`),
  };
}

export function industryDiagnostics(state: SimulationState): readonly SettlementIndustryDiagnostic[] {
  return state.settlements.filter(s => s.alive).map(s => settlementIndustryDiagnostic(state, s));
}

/**
 * One line per settlement and family, strongest standing first. Suitable for a headless run's
 * report or a debug overlay; the ordering is deterministic.
 */
export function industryDiagnosticLines(state: SimulationState, limit = 40): readonly string[] {
  const lines: string[] = [];
  const rank: Record<FacilityStandingKind, number> = {
    operating: 0, upgrading: 1, 'under-construction': 2, ruined: 3, absent: 4, 'no-family-implementation': 5,
  };
  const unimplemented = new Set<string>();
  for (const settlement of industryDiagnostics(state)) {
    for (const entry of [...settlement.families].sort((a, b) => rank[a.standing] - rank[b.standing] || a.family.localeCompare(b.family))) {
      // Which families have no tiers yet is a fact about the catalog, not about this settlement.
      if (entry.standing === 'no-family-implementation') { unimplemented.add(entry.name.toLowerCase()); continue; }
      lines.push(`${settlement.name}: ${entry.summary}`);
    }
  }
  const reported = lines.slice(0, limit);
  if (unimplemented.size > 0) reported.push(`No family implementation: ${[...unimplemented].sort().join(', ')}`);
  return reported;
}
