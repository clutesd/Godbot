import { structureDestination } from '../../shared/StructureDestinations';
import type { Activity, DestinationKind, HistoricalEvent, Person, SchedulePhase, Settlement, SimulationState } from '../types';
import { memoriesFor, type PersonalMemory } from './PersonalMemorySystem';

export interface MemorialVisitPlan {
  kind: DestinationKind;
  phase: SchedulePhase;
  activity: Activity;
  reason: string;
  destinationId: string;
}

const PUBLIC_REMEMBRANCE_TYPES = new Set<HistoricalEvent['type']>([
  'battle',
  'pandemic',
  'natural-catastrophe',
  'war-ended',
  'recovery',
]);

/**
 * Derive memorial attendance from already-recorded personal and public memory.
 *
 * This deliberately does not create a funeral economy or duplicate mortality. It only changes
 * where a represented person spends one documentary schedule sample when existing evidence says
 * that mourning or remembrance is salient.
 */
export function memorialVisitPlan(
  person: Person,
  settlement: Settlement,
  state: SimulationState,
  shiftedHour: number,
): MemorialVisitPlan | undefined {
  const site = structureDestination(settlement, 'memorial-site');
  if (!site) return undefined;

  const losses = memoriesFor(person)
    .filter((memory) => memory.kind === 'loss'
      && (!memory.settlementId || memory.settlementId === settlement.id)
      && memory.month <= state.month)
    .sort((a, b) => memorialMemoryScore(b, person, state.month) - memorialMemoryScore(a, person, state.month)
      || b.month - a.month || a.id.localeCompare(b.id));

  const strongest = losses[0];
  if (strongest) {
    const age = state.month - strongest.month;
    const closeLoss = strongest.reason === 'family-loss' || strongest.reason === 'lost-mentor';

    // One authoritative month of convergence gives close kin a visible funeral/mourning beat.
    // Severe weather/emergency authority is handled before schedule selection in PeopleSystem.
    if (closeLoss && age <= 1 && shiftedHour >= 6 && shiftedHour < 22) {
      return visit(site.id, strongest.reason === 'lost-mentor'
        ? 'mourning a mentor at the memorial ground'
        : 'mourning a close family member at the burial ground');
    }

    // Recent grief produces occasional evening visits. Stronger ties and traditional values
    // increase cadence without turning every bereaved resident into a permanent cemetery visitor.
    if (age <= 18 && shiftedHour >= 18 && shiftedHour < 22) {
      const cadence = strongest.reason === 'family-loss' ? 3 : strongest.reason === 'lost-mentor' ? 4 : 6;
      const threshold = 0.38 + person.traits.loyalty * 0.18 + person.traits.empathy * 0.18
        + (person.values?.tradition ?? 0.5) * 0.14;
      const draw = stableUnit(`${person.id}:${strongest.id}:${state.month}:memorial-visit`);
      if ((state.month + stableBucket(`${person.id}:${strongest.id}:cadence`, cadence)) % cadence === 0
        && draw < threshold) {
        return visit(site.id, strongest.reason === 'family-loss'
          ? 'visiting the burial ground in recent family grief'
          : strongest.reason === 'lost-mentor'
            ? 'remembering a mentor at the memorial ground'
            : 'making a quiet remembrance visit');
      }
    }

    // A strong memory can survive into annual remembrance without making visits perpetual.
    if (age > 18 && age <= 10 * 12 && shiftedHour >= 18 && shiftedHour < 22 && age % 12 === 0) {
      const attachment = strongest.emotionalWeight * 0.55 + person.traits.loyalty * 0.2
        + (person.values?.tradition ?? 0.5) * 0.2 + person.traits.empathy * 0.05;
      if (attachment >= 0.62) return visit(site.id, 'marking an anniversary of a remembered life');
    }
  }

  if (!['priest', 'ritual-specialist'].includes(person.role ?? '')) return undefined;
  const publicEvent = recentPublicMemorialEvent(state, settlement);
  if (!publicEvent || shiftedHour < 6 || shiftedHour >= 22) return undefined;
  return visit(site.id, publicEvent.type === 'death'
    ? 'leading communal mourning for a notable death'
    : 'leading communal remembrance after a shared loss');
}

function visit(destinationId: string, reason: string): MemorialVisitPlan {
  return {
    kind: 'memorial-site',
    phase: 'ritual',
    activity: 'mourn',
    reason,
    destinationId,
  };
}

function recentPublicMemorialEvent(state: SimulationState, settlement: Settlement): HistoricalEvent | undefined {
  for (let index = state.history.length - 1; index >= 0; index--) {
    const event = state.history[index]!;
    if (event.month > state.month) continue;
    const age = state.month - event.month;
    if (age > 1) break;
    if (event.locationId !== settlement.id) continue;
    if (event.type === 'death' && event.significance >= 0.3) return event;
    if (PUBLIC_REMEMBRANCE_TYPES.has(event.type) && event.significance >= 0.65) return event;
  }
  return undefined;
}

function memorialMemoryScore(memory: PersonalMemory, person: Person, month: number): number {
  const age = Math.max(0, month - memory.month);
  const recency = Math.exp(-age / 24);
  const closeness = memory.reason === 'family-loss' ? 0.22 : memory.reason === 'lost-mentor' ? 0.14 : 0;
  return memory.emotionalWeight * (0.58 + recency * 0.42)
    + closeness
    + person.traits.loyalty * 0.05
    + (person.values?.tradition ?? 0.5) * 0.04;
}

function stableBucket(value: string, count: number): number {
  return Math.floor(stableUnit(value) * count) % Math.max(1, count);
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
