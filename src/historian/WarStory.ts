import type { HistoricalEvent, SimulationState, War, WarCause } from '../sim/types';

export const WAR_CAUSES: Record<WarCause, string> = {
  'resource-pressure': 'The price of scarcity',
  'territorial-dispute': 'A line drawn through the earth',
  retaliation: 'The inheritance of a grievance',
  'political-ambition': 'The reach of power',
  'alliance-commitment': 'The weight of a promise',
};

export const WAR_CHAPTERS: Record<War['phase'], { number: string; title: string }> = {
  mobilizing: { number: 'I', title: 'The gathering' },
  marching: { number: 'II', title: 'The distance between' },
  battle: { number: 'III', title: 'The contested ground' },
  retreat: { number: 'IV', title: 'The road home' },
  occupation: { number: 'IV', title: 'The terms of silence' },
  negotiation: { number: 'IV', title: 'What remains' },
};

export const isWarEvent = (event: HistoricalEvent): boolean => ['war-declared', 'war-campaign', 'battle', 'war-ended'].includes(event.type);

export function warForEvent(state: SimulationState, event: HistoricalEvent): War | undefined {
  return isWarEvent(event) ? state.wars.find(war => event.actors.includes(war.id)) : undefined;
}

export function campaignMemory(state: SimulationState, event: HistoricalEvent): { event: HistoricalEvent; text: string } | undefined {
  if (event.type !== 'war-declared') return undefined;
  const war = warForEvent(state, event);
  if (!war) return undefined;
  const earlier = [...state.history].reverse().find(e => e.month < event.month && e.actors.includes(war.attacker) && e.actors.includes(war.defender)
    && (e.type === 'trade-route-established' || e.type === 'war-ended' || e.type === 'first-contact'));
  if (!earlier) return undefined;
  const year = Math.floor(earlier.month / 12).toLocaleString();
  const text = earlier.type === 'trade-route-established' ? `I remember a trade route joining these settlements in Year ${year}.`
    : earlier.type === 'war-ended' ? `I last recorded peace between them in Year ${year}.`
      : `Their first recorded contact was in Year ${year}. I return now to a different encounter.`;
  return { event: earlier, text };
}

/** Event narration uses the event's frozen evidence; it never borrows later casualties or outcomes. */
export function warEventStory(state: SimulationState, event: HistoricalEvent): string | undefined {
  const war = warForEvent(state, event);
  if (!war) return undefined;
  const a = state.settlements.find(s => s.id === war.attacker)?.name ?? 'The attacking settlement';
  const b = state.settlements.find(s => s.id === war.defender)?.name ?? 'the defending settlement';
  if (event.type === 'war-declared') {
    const opening: Record<WarCause, string> = {
      'resource-pressure': 'I watch scarcity become a reason to march.',
      'territorial-dispute': 'From here, the earth has no borders. The people below have begun to insist otherwise.',
      retaliation: 'A grievance has outlived the moment that made it. Now another generation must carry it.',
      'political-ambition': 'The map is still. Ambition is not.',
      'alliance-commitment': 'A promise made in peace is being collected in war.',
    };
    // Generational language must be supported by a prior conflict, not assumed from a cause label.
    const intro = war.cause === 'retaliation' ? 'I watch an old grievance become a new mobilization.' : opening[war.cause];
    return `${intro} ${a} mobilized against ${b} over ${war.cause.replaceAll('-', ' ')}. The outcome was still unwritten.`;
  }
  if (event.type === 'war-campaign') {
    const perspective: Record<string, string> = {
      march: 'Between a declaration and a battle lies the country itself. I follow the banners into that distance.',
      'passage-blocked': 'The land has refused the timetable. From above, I can see why the banners have stopped.',
      'supply-crisis': 'An army carries the limits of its home with it. The stores now matter as much as the front.',
      reversal: 'I return to the same ground and find the balance changed. An advantage is never a promise.',
    };
    return `${perspective[String(event.context.dispatch)] ?? 'The campaign has entered another chapter.'} ${event.outcome}`;
  }
  if (event.type === 'battle') {
    const count = event.affectedPopulation;
    const opening = event.context.battleNumber === 1 ? 'The distance between them has closed.' : Number(event.context.supplyA) < 0.25 || Number(event.context.supplyB) < 0.25 ? 'The fighting continues under the weight of dwindling provisions.' : 'I return to the contested ground. Neither the banners nor the balance have stood still.';
    const cost = count === 0 ? 'This clash took no recorded lives.' : `${count.toLocaleString()} ${count === 1 ? 'life was' : 'lives were'} lost in this clash.`;
    return `${opening} ${event.outcome} ${cost}`;
  }
  const months = Number(event.context.months);
  const losses = Number(event.context.casualties);
  const cost = losses === 0 ? 'No deaths were attributed to its fighting.' : `${losses.toLocaleString()} ${losses === 1 ? 'life is' : 'lives are'} missing from the world that began it.`;
  return `I watched this war for ${months} months. ${event.outcome} ${cost} The record closes; the consequences remain.`;
}

export function liveWarStory(state: SimulationState, war: War): string {
  const a = state.settlements.find(s => s.id === war.attacker)?.name ?? 'The attacking settlement';
  const b = state.settlements.find(s => s.id === war.defender)?.name ?? 'the defending settlement';
  if (war.campaign.blockedMonths > 0) return `I find the banners waiting. The approach between ${a} and ${b} has been impassable for ${war.campaign.blockedMonths} months.`;
  if (war.phase === 'mobilizing') return `I stay with ${a} as the campaign gathers. Beyond these homes lies ${b}; for now, the fighting has not begun.`;
  if (war.phase === 'marching') return `I follow the space between ${a} and ${b}. The march is ${Math.round(war.marchProgress * 100)}% complete; distance and provisions are setting its pace.`;
  const losses = war.casualtiesA + war.casualtiesB;
  return `Below me, ${a} and ${b} contest the same approach. ${war.campaign.battleCount} clashes have taken ${losses.toLocaleString()} lives. ${Math.min(war.campaign.supplyA, war.campaign.supplyB) < 0.25 ? 'Provisions are under severe strain.' : 'The campaign is still unresolved.'}`;
}
