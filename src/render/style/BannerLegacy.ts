import type { HistoricalEvent, InstitutionKind, Settlement } from '../../sim/types';
import type { Era } from '../materials/MaterialPalette';
import type { BannerEmblem, BannerIdentity } from './BannerIdentity';

export type BannerDisplaySite = 'hearth' | 'civic' | 'sacred' | 'market' | 'gate';
export type BannerMount = 'processional' | 'civic-standard' | 'gonfalon' | 'market-standard' | 'pennon';

export interface BannerLegacyInstitution {
  kind: InstitutionKind;
  support: number;
  prestige: number;
}

export interface BannerLegacyInput {
  currentMonth: number;
  foundedMonth: number;
  settlementId: string;
  polityId: string;
  cultureId?: string;
  currentEra: Era;
  specialization: Settlement['specialization'];
  prosperity: number;
  crisisMonths: number;
  conflictPressure: number;
  successionCount: number;
  isCapital: boolean;
  institutions: readonly BannerLegacyInstitution[];
  identity: BannerIdentity;
  history: readonly HistoricalEvent[];
  hasLandGate: boolean;
  hasAnyPortal: boolean;
}

/**
 * Historical layer laid over a culture's base heraldry. The goal is continuity rather than
 * random re-rolls: major political/cultural events add bands, house marks, repairs and wear while
 * the founding motif remains recognizable across centuries.
 */
export interface BannerLegacy {
  id: string;
  site: BannerDisplaySite;
  mount: BannerMount;
  generation: number;
  politicalBands: number;
  culturalMarks: number;
  successionMarks: number;
  allianceKnots: number;
  wear: number;
  scorch: number;
  repairPatches: number;
  mourning: boolean;
  prestigeTrim: number;
  fieldVariant: number;
  emblemVariant: number;
  latestChangeMonth?: number;
  latestChange?: string;
  rationale: string[];
}

const EVENT_TYPES = {
  political: new Set<HistoricalEvent['type']>(['political-transition', 'leadership-succession']),
  culture: new Set<HistoricalEvent['type']>(['cultural-shift']),
  conflict: new Set<HistoricalEvent['type']>(['war-declared', 'war-campaign', 'battle', 'war-ended']),
  crisis: new Set<HistoricalEvent['type']>([
    'harvest-crisis', 'natural-catastrophe', 'climate-crisis', 'resource-crisis', 'ecological-crisis',
    'pandemic', 'nuclear-use', 'nuclear-exchange', 'civilization-collapse',
  ]),
  recovery: new Set<HistoricalEvent['type']>(['recovery', 'civilization-recovery']),
  alliance: new Set<HistoricalEvent['type']>(['alliance-formed', 'alliance-ended']),
} as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const eraRank = (era: Era): number => ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'].indexOf(era);

function institutionStrength(institutions: readonly BannerLegacyInstitution[], kind: InstitutionKind): number {
  let strongest = 0;
  for (const institution of institutions) {
    if (institution.kind !== kind) continue;
    strongest = Math.max(strongest, clamp01(institution.support) * 0.45 + clamp01(institution.prestige) * 0.55);
  }
  return strongest;
}

function belongsTo(input: BannerLegacyInput, event: HistoricalEvent): boolean {
  if (event.month < input.foundedMonth) return false;
  if (event.locationId === input.settlementId) return true;
  if (event.actors.includes(input.settlementId) || event.actors.includes(input.polityId)) return true;
  if (input.cultureId && event.actors.includes(input.cultureId)) return true;
  return false;
}

function latest(events: readonly HistoricalEvent[]): HistoricalEvent | undefined {
  return [...events].sort((a, b) => b.month - a.month || b.significance - a.significance)[0];
}

function chooseSite(input: BannerLegacyInput): { site: BannerDisplaySite; mount: BannerMount; reason: string } {
  // Camps still gather identity around the communal hearth; developed settlements do not.
  if (eraRank(input.currentEra) <= 1) {
    return { site: 'hearth', mount: 'processional', reason: 'camp-scale society keeps its standard beside the communal hearth' };
  }

  const temple = institutionStrength(input.institutions, 'temple');
  const merchants = institutionStrength(input.institutions, 'merchant-association');
  const military = institutionStrength(input.institutions, 'military-order');
  const council = institutionStrength(input.institutions, 'council');
  const knowledge = institutionStrength(input.institutions, 'knowledge-keepers');

  if (input.hasLandGate && (military >= 0.54 || input.conflictPressure >= 0.62 || input.identity.emblem === 'antlers' || input.identity.emblem === 'beast')) {
    return { site: 'gate', mount: 'pennon', reason: 'martial identity moves the standard to the defended entrance' };
  }
  if (temple >= 0.56 || input.identity.emblem === 'moon') {
    return { site: 'sacred', mount: 'gonfalon', reason: 'religious authority places the standard in the sacred precinct' };
  }
  if (merchants >= 0.54 || input.specialization === 'exchange' || input.identity.emblem === 'river-wave' && input.hasAnyPortal) {
    return { site: 'market', mount: 'market-standard', reason: 'exchange identity places the standard where outsiders and traders encounter it' };
  }
  if (input.isCapital || council >= 0.44 || knowledge >= 0.58) {
    return { site: 'civic', mount: 'civic-standard', reason: input.isCapital ? 'capital authority places the standard in the civic heart' : 'civic institutions claim the settlement standard' };
  }
  return { site: 'civic', mount: 'civic-standard', reason: 'mature settlement treats the standard as a civic object rather than a camp marker' };
}

function changeLabel(event: HistoricalEvent | undefined): string | undefined {
  if (!event) return undefined;
  switch (event.type) {
    case 'leadership-succession': return event.causes.includes('new-ruling-house') ? 'new ruling house' : 'leadership succession';
    case 'political-transition': return event.tags.includes('fragmentation') || event.tags.includes('secession') ? 'political fracture' : 'political transition';
    case 'cultural-shift': return typeof event.context['dimension'] === 'string' ? `${event.context['dimension']} cultural shift` : 'cultural shift';
    case 'alliance-formed': return 'alliance formed';
    case 'alliance-ended': return 'alliance ended';
    case 'battle': return 'battle scar';
    case 'war-ended': return 'war legacy';
    case 'recovery':
    case 'civilization-recovery': return 'recovery';
    default: return event.type.replaceAll('-', ' ');
  }
}

export function deriveBannerLegacy(input: BannerLegacyInput): BannerLegacy {
  const associated = input.history.filter(event => belongsTo(input, event));
  const political = associated.filter(event => EVENT_TYPES.political.has(event.type));
  const cultural = associated.filter(event => EVENT_TYPES.culture.has(event.type));
  const conflict = associated.filter(event => EVENT_TYPES.conflict.has(event.type));
  const crises = associated.filter(event => EVENT_TYPES.crisis.has(event.type));
  const recoveries = associated.filter(event => EVENT_TYPES.recovery.has(event.type));
  const alliances = associated.filter(event => EVENT_TYPES.alliance.has(event.type));
  const transformative = [...political, ...cultural, ...alliances].sort((a, b) => a.month - b.month);

  const newHouseCount = political.filter(event => event.type === 'leadership-succession' && event.causes.includes('new-ruling-house')).length;
  const politicalTransitions = political.filter(event => event.type === 'political-transition').length;
  const culturalShifts = cultural.length;
  const generation = 1 + politicalTransitions + culturalShifts + newHouseCount;
  const politicalBands = Math.min(3, politicalTransitions + newHouseCount);
  const culturalMarks = Math.min(3, culturalShifts);
  const successionMarks = Math.min(4, input.successionCount);
  const allianceKnots = Math.min(3, alliances.filter(event => event.type === 'alliance-formed').length);

  const ageMonths = Math.max(0, input.currentMonth - input.foundedMonth);
  const ageWear = Math.min(0.26, Math.floor(ageMonths / 120) * 0.035);
  const battleWear = Math.min(0.32, conflict.filter(event => event.type === 'battle').length * 0.055);
  const crisisWear = Math.min(0.28, crises.length * 0.07 + input.crisisMonths * 0.008);
  const wear = clamp01(0.04 + ageWear + battleWear + crisisWear);
  const scorch = clamp01(
    conflict.filter(event => event.type === 'battle').length * 0.075
    + crises.filter(event => ['natural-catastrophe', 'nuclear-use', 'nuclear-exchange'].includes(event.type)).length * 0.16,
  );
  const repairPatches = Math.min(3, recoveries.length + Math.max(0, crises.length - 1));

  const recentTrauma = latest([...conflict, ...crises]);
  const mourning = Boolean(recentTrauma && input.currentMonth - recentTrauma.month <= 24 && recentTrauma.significance >= 0.45);

  const institutionalPrestige = input.institutions.length === 0
    ? 0
    : input.institutions.reduce((sum, institution) => sum + institution.prestige, 0) / input.institutions.length;
  const prestigeTrim = clamp01(input.prosperity * 0.5 + institutionalPrestige * 0.25 + (input.isCapital ? 0.28 : 0) - wear * 0.12);

  // Changes are additive and bounded so descendants still resemble the founding banner.
  const fieldVariant = (input.identity.fieldVariant + politicalBands + culturalMarks) % 4;
  const emblemVariant = (input.identity.emblemVariant + successionMarks + culturalMarks) % 4;
  const siteChoice = chooseSite(input);
  const mostRecentChange = latest([...transformative, ...recoveries, ...conflict, ...crises]);

  const rationale = [siteChoice.reason];
  if (politicalBands > 0) rationale.push(`${politicalBands} political revision band${politicalBands === 1 ? '' : 's'} preserve regime change`);
  if (culturalMarks > 0) rationale.push(`${culturalMarks} cultural mark${culturalMarks === 1 ? '' : 's'} preserve long-term custom change`);
  if (successionMarks > 0) rationale.push(`${successionMarks} succession mark${successionMarks === 1 ? '' : 's'} record recognized leadership changes`);
  if (allianceKnots > 0) rationale.push(`${allianceKnots} alliance knot${allianceKnots === 1 ? '' : 's'} record diplomatic ties`);
  if (repairPatches > 0) rationale.push(`${repairPatches} visible repair${repairPatches === 1 ? '' : 's'} turn recovery into material history`);
  if (wear >= 0.25) rationale.push('age/conflict/crisis visibly weather the cloth');
  if (mourning) rationale.push('recent trauma adds a temporary mourning streamer');
  if (prestigeTrim >= 0.62) rationale.push('prosperity/capital prestige earns formal edging rather than a brighter base colour');

  const latestChange = changeLabel(mostRecentChange);
  const id = [
    siteChoice.site, siteChoice.mount, generation, politicalBands, culturalMarks, successionMarks, allianceKnots,
    wear.toFixed(2), scorch.toFixed(2), repairPatches, Number(mourning), prestigeTrim.toFixed(2), fieldVariant, emblemVariant,
    mostRecentChange?.id ?? 'founding',
  ].join(':');

  return {
    id,
    site: siteChoice.site,
    mount: siteChoice.mount,
    generation,
    politicalBands,
    culturalMarks,
    successionMarks,
    allianceKnots,
    wear,
    scorch,
    repairPatches,
    mourning,
    prestigeTrim,
    fieldVariant,
    emblemVariant,
    latestChangeMonth: mostRecentChange?.month,
    latestChange,
    rationale,
  };
}

/** Exported for small renderer/tests that want to explain why an emblem tends toward a site. */
export function emblemHasInstitutionalPull(emblem: BannerEmblem): BannerDisplaySite | undefined {
  if (emblem === 'moon') return 'sacred';
  if (emblem === 'river-wave') return 'market';
  if (emblem === 'antlers' || emblem === 'beast') return 'gate';
  return undefined;
}
