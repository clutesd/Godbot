import type { HistoricalEvent } from '../sim/types';

/** Categories are based on completed authoritative actions, never proposed projects. */
export function milestoneCategories(event: HistoricalEvent): string[] {
  if (event.type === 'resource-trade' && typeof event.context.milestone === 'string') return [`trade:${event.context.milestone}`];
  if (event.type === 'infrastructure-built' && event.context.need === 'trade' && event.context.action !== 'abandoned') return ['trade:market'];
  if (event.type === 'infrastructure-built' && event.context.need === 'energy' && typeof event.context.milestone === 'string') return [`energy:${event.context.milestone}`];
  if (event.type === 'first-fire') return [`fire:${event.locationId ?? 'world'}`];
  if (event.type === 'death') return ['death'];
  if (event.type === 'resource-deposit-discovered') return ['resource-discovery'];
  if (event.type === 'recipe-learned') return ['material-discovery'];
  if (event.type !== 'infrastructure-built' || event.context.action === 'abandoned') return [];
  const categories: string[] = [];
  if (Number(event.context.burials) > 0) categories.push('burial');
  if (event.context.need === 'housing') categories.push('shelter');
  if (event.context.temporary === false) categories.push('permanent-building');
  return categories;
}

export function firstMilestones(history: readonly HistoricalEvent[]): HistoricalEvent[] {
  const found = new Set<string>();
  return history.filter(event => {
    let first = false;
    for (const category of milestoneCategories(event)) {
      if (!found.has(category)) { found.add(category); first = true; }
    }
    return first;
  });
}

/** Published history events are immutable. Reuse the prefix and inspect only newly appended
 * records; archive compaction, replacement and restart invalidate that prefix. */
export class MilestoneIndex {
  private history?: readonly HistoricalEvent[];
  private length = 0;
  private first?: HistoricalEvent;
  private last?: HistoricalEvent;
  private readonly categories = new Set<string>();
  private events: HistoricalEvent[] = [];

  read(history: readonly HistoricalEvent[]): HistoricalEvent[] {
    if (history !== this.history || history.length < this.length
      || this.length > 0 && (history[0] !== this.first || history[this.length - 1] !== this.last)) {
      this.length = 0;
      this.categories.clear();
      this.events = [];
    }
    for (let index = this.length; index < history.length; index++) {
      const event = history[index]!;
      let first = false;
      for (const category of milestoneCategories(event)) {
        if (!this.categories.has(category)) { this.categories.add(category); first = true; }
      }
      if (first) this.events.push(event);
    }
    this.history = history;
    this.length = history.length;
    this.first = history[0];
    this.last = history[history.length - 1];
    return this.events;
  }
}
