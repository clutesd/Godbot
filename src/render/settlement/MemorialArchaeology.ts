import type { MemorialSite } from '../../sim/development/types';
import type { HistoricalEventType, Settlement, SimulationState, StructurePlot } from '../../sim/types';

export type MemorialEvidenceKind = 'founding' | 'communal' | 'named-life' | 'event';

export interface MemorialEvidenceLayer {
  id: string;
  kind: MemorialEvidenceKind;
  month: number;
  cultureId: string;
  weight: number;
  personId?: string;
  personName?: string;
  eventId?: string;
  eventType?: HistoricalEventType;
  significance?: number;
}

export interface MemorialArchaeologyStratum {
  ordinal: number;
  startMonth: number;
  endMonth: number;
  evidenceIds: string[];
  kinds: MemorialEvidenceKind[];
  eventTypes: HistoricalEventType[];
  namedLives: number;
  events: number;
  weight: number;
  age: number;
}

export interface MemorialComposition {
  cultureId: string;
  form: MemorialSite['form'];
  foundedMonth: number;
  oldestEvidenceMonth: number;
  newestEvidenceMonth: number;
  historicalSpanMonths: number;
  successionOrdinal: number;
  successionCount: number;
  activeCultureShare: number;
  dominantCultureId?: string;
  legacyCulture: boolean;
  communalMarkers: number;
  namedLives: number;
  rememberedEvents: number;
  evidence: MemorialEvidenceLayer[];
  strata: MemorialArchaeologyStratum[];
  documentaryDepth: number;
  fingerprint: string;
}

const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));

/**
 * Presentation-facing archaeology derived entirely from authoritative remembrance and plot history.
 * Nothing here creates historical facts. It only orders retained evidence so the renderer can make
 * centuries of accretion and cultural succession legible.
 */
export function deriveMemorialComposition(
  state: SimulationState,
  settlement: Settlement,
  plot: StructurePlot,
  memorial: MemorialSite,
): MemorialComposition {
  const memorialPlots = (settlement.structurePlots ?? [])
    .filter(candidate => candidate.development?.memorial)
    .sort((a, b) => memorialFoundedMonth(a) - memorialFoundedMonth(b) || a.id.localeCompare(b.id));
  const successionOrdinal = Math.max(0, memorialPlots.findIndex(candidate => candidate.id === plot.id));
  const successionCount = Math.max(1, memorialPlots.length);
  const dominantCultureId = Object.keys(settlement.cultureShares)
    .sort((a, b) => (settlement.cultureShares[b] ?? 0) - (settlement.cultureShares[a] ?? 0) || a.localeCompare(b))[0];
  const activeCultureShare = clamp(settlement.cultureShares[memorial.cultureId] ?? 0);
  const foundedMonth = memorialFoundedMonth(plot);

  const evidence: MemorialEvidenceLayer[] = [{
    id: `founding:${plot.id}`,
    kind: 'founding',
    month: foundedMonth,
    cultureId: memorial.cultureId,
    weight: 0.78,
  }];

  if (memorial.deaths > 0) {
    evidence.push({
      id: `communal:${memorial.cultureId}`,
      kind: 'communal',
      month: Math.max(memorial.firstMonth, foundedMonth),
      cultureId: memorial.cultureId,
      weight: clamp(0.35 + Math.log2(1 + memorial.deaths) / 24, 0.35, 0.92),
    });
  }

  for (const person of memorial.people) {
    evidence.push({
      id: `person:${person.id}`,
      kind: 'named-life',
      month: person.month,
      cultureId: memorial.cultureId,
      personId: person.id,
      personName: person.name,
      eventId: person.eventId,
      weight: 0.72,
    });
  }

  for (const event of memorial.events) {
    evidence.push({
      id: `event:${event.id}`,
      kind: 'event',
      month: event.month,
      cultureId: memorial.cultureId,
      eventId: event.id,
      eventType: event.type,
      significance: event.significance,
      weight: clamp(0.58 + (event.significance ?? 0.65) * 0.36, 0.58, 0.95),
    });
  }

  evidence.sort((a, b) => a.month - b.month || evidenceKindOrder(a.kind) - evidenceKindOrder(b.kind) || a.id.localeCompare(b.id));
  const oldestEvidenceMonth = evidence[0]?.month ?? foundedMonth;
  const newestEvidenceMonth = evidence.at(-1)?.month ?? foundedMonth;
  const historicalSpanMonths = Math.max(0, newestEvidenceMonth - oldestEvidenceMonth);
  const strata = stratifyEvidence(evidence, state.month);
  const documentaryDepth = clamp(
    Math.min(1, historicalSpanMonths / 1800) * 0.32
      + Math.min(1, evidence.length / 14) * 0.33
      + Math.min(1, Math.log2(1 + memorial.deaths) / 16) * 0.15
      + Math.min(1, (successionCount - 1) / 3) * 0.2,
  );

  const fingerprint = [
    memorial.cultureId,
    memorial.form,
    foundedMonth,
    successionOrdinal,
    successionCount,
    memorial.deaths.toFixed(3),
    ...evidence.map(layer => [
      layer.kind,
      layer.id,
      layer.month,
      layer.eventType ?? '-',
      (layer.significance ?? 0).toFixed(3),
    ].join('.')),
  ].join('|');

  return {
    cultureId: memorial.cultureId,
    form: memorial.form,
    foundedMonth,
    oldestEvidenceMonth,
    newestEvidenceMonth,
    historicalSpanMonths,
    successionOrdinal,
    successionCount,
    activeCultureShare,
    dominantCultureId,
    legacyCulture: Boolean(dominantCultureId && dominantCultureId !== memorial.cultureId && activeCultureShare < 0.25),
    communalMarkers: Math.min(12, Math.ceil(Math.log2(1 + memorial.deaths))),
    namedLives: memorial.people.length,
    rememberedEvents: memorial.events.length,
    evidence,
    strata,
    documentaryDepth,
    fingerprint,
  };
}

function memorialFoundedMonth(plot: StructurePlot): number {
  return plot.development?.origin.month ?? plot.foundedMonth;
}

function evidenceKindOrder(kind: MemorialEvidenceKind): number {
  switch (kind) {
    case 'founding': return 0;
    case 'communal': return 1;
    case 'named-life': return 2;
    case 'event': return 3;
  }
}

function stratifyEvidence(evidence: readonly MemorialEvidenceLayer[], currentMonth: number): MemorialArchaeologyStratum[] {
  if (evidence.length === 0) return [];
  const targetCount = Math.min(4, Math.max(1,
    evidence.length >= 10 ? 4 : evidence.length >= 6 ? 3 : evidence.length >= 3 ? 2 : 1));
  const groups: MemorialEvidenceLayer[][] = Array.from({ length: targetCount }, () => []);
  for (let index = 0; index < evidence.length; index++) {
    const bucket = Math.min(targetCount - 1, Math.floor(index * targetCount / evidence.length));
    groups[bucket]!.push(evidence[index]!);
  }

  return groups.filter(group => group.length > 0).map((group, ordinal) => {
    const startMonth = group[0]!.month;
    const endMonth = group.at(-1)!.month;
    const midpoint = (startMonth + endMonth) / 2;
    return {
      ordinal,
      startMonth,
      endMonth,
      evidenceIds: group.map(layer => layer.id),
      kinds: [...new Set(group.map(layer => layer.kind))],
      eventTypes: [...new Set(group.flatMap(layer => layer.eventType ? [layer.eventType] : []))],
      namedLives: group.filter(layer => layer.kind === 'named-life').length,
      events: group.filter(layer => layer.kind === 'event').length,
      weight: clamp(group.reduce((sum, layer) => sum + layer.weight, 0) / group.length),
      age: clamp((currentMonth - midpoint) / 1800),
    };
  });
}
