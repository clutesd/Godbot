import { rememberHistoricalEvent } from './development/Remembrance';
import type { HistoricalEvent, SimulationState } from './types';

const observers = new WeakMap<SimulationState, Set<(event: HistoricalEvent) => void>>();
/** Archives subscribe at emission so retention cannot erase an unobserved event. */
export function observeHistory(state: SimulationState, observer: (event: HistoricalEvent) => void): () => void {
  const listeners = observers.get(state) ?? new Set();
  listeners.add(observer); observers.set(state, listeners);
  return () => listeners.delete(observer);
}

/** Sequence is independent of retention and significance. Legacy event-N records remain readable. */
export function eventSequence(event: HistoricalEvent): number {
  return event.sequence ?? (Number(event.id.replace(/^event-/, '')) || 0);
}

export function emitEvent(state: SimulationState, draft: Omit<HistoricalEvent, 'id' | 'month'>): HistoricalEvent {
  const sequence = (state.eventSequence ?? state.history.reduce((n, e) => Math.max(n, eventSequence(e)), 0)) + 1;
  state.eventSequence = sequence;
  const event = { ...draft, id: `event-${sequence}`, sequence, month: state.month };
  state.history.push(event);
  rememberHistoricalEvent(state, event);
  for (const observer of observers.get(state) ?? []) observer(event);
  return event;
}

/** Retained events remain in emission order even when intermediate entries are evicted. */
export function eventsAfter(history: readonly HistoricalEvent[], sequence: number): readonly HistoricalEvent[] {
  // Imported/manual histories may have non-numeric identifiers. Stamp them once at the boundary.
  if (history.length && history[history.length - 1]!.sequence === undefined) {
    let previous = history.some(e => e.sequence !== undefined) ? 0 : sequence;
    for (const event of history) {
      event.sequence ??= Math.max(previous + 1, eventSequence(event));
      previous = event.sequence;
    }
  }
  let low = 0, high = history.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (eventSequence(history[mid]!) <= sequence) low = mid + 1;
    else high = mid;
  }
  return history.slice(low);
}
