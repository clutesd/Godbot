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
