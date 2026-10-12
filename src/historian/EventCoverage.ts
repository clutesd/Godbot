import type { HistoricalEvent } from '../sim/types';

/** One coverage contract for the durable archive and the documentary editor. */
const ROUTINE_TYPES = new Set<HistoricalEvent['type']>(['birth', 'death', 'world-awakening']);

export function isChronicleEvent(event: HistoricalEvent): boolean {
  return !ROUTINE_TYPES.has(event.type) || event.significance >= 0.65;
}

/** Recorded history outlives its news value. Founding firsts have no permanent news exemption. */
export function eventNewsWindow(event: HistoricalEvent): number {
  if (event.type === 'ARRIVAL_DAY' || event.type === 'world-awakening') return 0;
  if (event.type === 'first-fire' || event.type === 'birth' || event.type === 'death') return 24;
  return event.significance >= 0.78 ? 600 : 120;
}
