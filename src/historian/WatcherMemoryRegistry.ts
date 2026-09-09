import type { SimulationState } from '../sim/types';
import type { WatcherMemorySnapshot } from './WatcherMind';

const memoryByState = new WeakMap<SimulationState, WatcherMemorySnapshot>();

export function registerWatcherMemory(state: SimulationState, snapshot: WatcherMemorySnapshot): void {
  memoryByState.set(state, structuredClone(snapshot));
}

export function watcherMemoryForState(state: SimulationState): WatcherMemorySnapshot | undefined {
  const snapshot = memoryByState.get(state);
  return snapshot ? structuredClone(snapshot) : undefined;
}
