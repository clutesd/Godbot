import type { HistoricalEvent, Person, Settlement, SimulationState } from '../types';
import type { Remembrance } from './types';
import { isStatistical } from '../Population';

function record(state: SimulationState, settlement: Settlement, cultureId: string): Remembrance {
  const records = settlement.remembrance ??= [];
  let memory = records.find(r => r.cultureId === cultureId);
  if (!memory) {
    memory = { cultureId, firstMonth: state.month, deaths: 0, people: [], events: [] };
    records.push(memory);
  }
  return memory;
}

/** Called only by demographic authority. Fractional statistical casualties accumulate exactly. */
export function rememberMortality(state: SimulationState, settlement: Settlement, deaths: number): void {
  if (!Number.isFinite(deaths) || deaths <= 0) return;
  const shares = Object.entries(settlement.cultureShares).filter(([, share]) => share > 0);
  const total = shares.reduce((sum, [, share]) => sum + share, 0);
  for (const [cultureId, share] of shares) record(state, settlement, cultureId).deaths += deaths * share / total;
}

export function rememberPerson(state: SimulationState, settlement: Settlement, person: Person, eventId: string): void {
  const memory = record(state, settlement, person.cultureId);
  if (!isStatistical(state)) memory.deaths++;
  // Reserve half the eight permanent names for later notable lives; never erase earlier markers.
  // Small communities can remember represented kin; statistical populations retain only notable lives.
  const significant = person.historical && person.historical.status !== 'ordinary';
  const representedKin = !isStatistical(state) && memory.deaths <= 24 && memory.people.length < 4
    && (person.children.length > 0 || person.parents.length > 0 || (person.values?.tradition ?? 0) > 0.6);
  if ((significant || representedKin) && memory.people.length < 8 && !memory.people.some(p => p.id === person.id)) {
    memory.people.push({ id: person.id, name: person.name, month: state.month, eventId });
  }
}

/** Capture evidence at emission, before historian retention can evict it. Never consume randomness. */
export function rememberHistoricalEvent(state: SimulationState, event: HistoricalEvent): void {
  if (event.significance < 0.65 || !['battle', 'natural-catastrophe', 'harvest-crisis', 'pandemic', 'settlement-founded', 'war-ended', 'recovery'].includes(event.type)) return;
  const settlement = state.settlements.find(s => s.id === event.locationId);
  if (!settlement) return;
  const cultureId = Object.keys(settlement.cultureShares).sort((a, b) => settlement.cultureShares[b]! - settlement.cultureShares[a]! || a.localeCompare(b))[0];
  if (!cultureId) return;
  const memory = record(state, settlement, cultureId);
  if (memory.events.length < 4 && !memory.events.some(e => e.id === event.id)) {
    memory.events.push({ id: event.id, summary: event.summary, month: event.month, type: event.type, significance: event.significance });
  }
}

/** Build a new cultural layer only when that community has actual unrepresented evidence. */
export function pendingRemembrance(settlement: Settlement): Remembrance | undefined {
  return settlement.remembrance?.find(r => (r.deaths >= 1 || r.people.length > 0 || r.events.length > 0)
    && !settlement.structurePlots?.some(p => p.development?.memorial?.cultureId === r.cultureId));
}

export function refreshMemorials(state: SimulationState, settlement: Settlement): void {
  for (const plot of settlement.structurePlots ?? []) {
    const site = plot.development?.memorial;
    if (!site) continue;
    const record = settlement.remembrance?.find(r => r.cultureId === site.cultureId);
    const ageBand = Math.min(4, Math.floor(Math.max(0, state.month - plot.foundedMonth) / 300));
    if (record && (site.deaths !== record.deaths || site.people.length !== record.people.length || site.events.length !== record.events.length || site.ageBand !== ageBand)) {
      Object.assign(site, structuredClone(record), { ageBand });
      if (settlement.development) settlement.development.revision++;
    }
  }
}
