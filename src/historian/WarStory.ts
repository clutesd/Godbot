import type { HistoricalEvent, SimulationState, War, WarCause } from '../sim/types';
import { militaryProfileForWar, type MilitaryCapabilityProfile, type MilitaryEquipment } from '../sim/war/MilitaryCapability';

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

const SIGNATURE_PRIORITY: MilitaryEquipment[] = [
  'guided-missiles', 'aircraft', 'automatic-weapons', 'artillery', 'rifles', 'cannon',
  'gunpowder-weapons', 'siege-engines', 'metal-armour', 'metal-weapons', 'bows', 'stone-spears', 'clubs',
];

const EQUIPMENT_LABEL: Record<MilitaryEquipment, string> = {
  clubs: 'clubs',
  'stone-spears': 'stone-tipped spears',
  torches: 'controlled fire',
  bows: 'bows',
  shields: 'shields',
  'metal-weapons': 'metal weapons',
  'metal-armour': 'metal armour',
  'siege-engines': 'siege engines',
  'gunpowder-weapons': 'gunpowder weapons',
  cannon: 'cannon',
  rifles: 'rifles',
  grenades: 'grenades',
  artillery: 'artillery',
  'automatic-weapons': 'automatic weapons',
  'motor-transport': 'motor transport',
  aircraft: 'aircraft',
  'guided-missiles': 'guided missiles',
};

export const isWarEvent = (event: HistoricalEvent): boolean => ['war-declared', 'war-campaign', 'battle', 'war-ended'].includes(event.type);

export function warForEvent(state: SimulationState, event: HistoricalEvent): War | undefined {
  return isWarEvent(event) ? state.wars.find(war => event.actors.includes(war.id)) : undefined;
}

function signature(profile: MilitaryCapabilityProfile | undefined): MilitaryEquipment | undefined {
  if (!profile) return undefined;
  return SIGNATURE_PRIORITY.find(equipment => profile.equipment.includes(equipment));
}

function regimeLabel(profile: MilitaryCapabilityProfile | undefined): string {
  return profile?.regime.replaceAll('-', ' ') ?? 'unrecorded';
}

function profilePair(war: War): readonly [MilitaryCapabilityProfile | undefined, MilitaryCapabilityProfile | undefined] {
  return [militaryProfileForWar(war, 'attacker'), militaryProfileForWar(war, 'defender')];
}

function forceCharacter(profile: MilitaryCapabilityProfile | undefined): string | undefined {
  const main = signature(profile);
  if (!profile || !main) return undefined;
  const supporting: string[] = [];
  if (profile.equipment.includes('metal-armour') && main !== 'metal-armour') supporting.push('armour');
  if (profile.equipment.includes('motor-transport') && main !== 'motor-transport') supporting.push('motor transport');
  if (profile.equipment.includes('aircraft') && main !== 'aircraft') supporting.push('aircraft');
  const support = supporting.length > 0 ? `, supported by ${supporting.join(' and ')}` : '';
  return `${regimeLabel(profile)} warfare built around ${EQUIPMENT_LABEL[main]}${support}`;
}

function capabilityContrast(war: War, aName: string, bName: string): string {
  const [a, b] = profilePair(war);
  const aCharacter = forceCharacter(a);
  const bCharacter = forceCharacter(b);
  if (!aCharacter || !bCharacter) return '';
  if (signature(a) === signature(b) && a?.regime === b?.regime) return `Both sides enter this war with ${regimeLabel(a)} forces.`;
  return `${aName} brings ${aCharacter}; ${bName} answers with ${bCharacter}.`;
}

function firstRecordedCapability(state: SimulationState, event: HistoricalEvent, war: War): string | undefined {
  const [a, b] = profilePair(war);
  const current = SIGNATURE_PRIORITY.filter(equipment => a?.equipment.includes(equipment) || b?.equipment.includes(equipment));
  for (const equipment of current) {
    if (equipment === 'clubs' || equipment === 'stone-spears') continue;
    const seenEarlier = state.wars.some(other => {
      if (other.id === war.id || other.startMonth >= event.month) return false;
      const [oa, ob] = profilePair(other);
      return oa?.equipment.includes(equipment) || ob?.equipment.includes(equipment);
    });
    if (!seenEarlier) return `This is the first war in my record to show ${EQUIPMENT_LABEL[equipment]}.`;
  }
  return undefined;
}

function engagementSentence(event: HistoricalEvent): string {
  const mode = String(event.context.engagementMode ?? '');
  if (mode === 'stand-off') return 'The killing distance has become part of the weapon: some attacks arrive before opposing soldiers can answer in kind.';
  if (mode === 'combined-arms') return 'Machines, fire, movement and communication are acting as one battlefield system.';
  if (mode === 'bombardment') return 'The contested ground is being shaped by bombardment before bodies can close the distance.';
  if (mode === 'ranged') return 'The battle is being decided across distance as much as at arm’s reach.';
  if (mode === 'close') return 'The violence is still intimate: formation, protection and nerve matter at arm’s reach.';
  return '';
}

function mismatchSentence(state: SimulationState, event: HistoricalEvent, war: War): string {
  const mismatchA = Number(event.context.militaryMismatchA ?? 0);
  const mismatchB = Number(event.context.militaryMismatchB ?? 0);
  const mismatch = Math.max(mismatchA, mismatchB);
  if (mismatch < 0.28) return '';
  const advantagedId = mismatchA >= mismatchB ? war.attacker : war.defender;
  const advantaged = state.settlements.find(settlement => settlement.id === advantagedId)?.name ?? 'One side';
  return `${advantaged} holds a material advantage in reach, firepower, protection or coordination. This is not a contest of equivalent military systems.`;
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

/** Event narration uses frozen evidence and only earlier records; it never borrows later casualties or outcomes. */
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
    const intro = war.cause === 'retaliation' ? 'I watch an old grievance become a new mobilization.' : opening[war.cause];
    const capability = capabilityContrast(war, a, b);
    const first = firstRecordedCapability(state, event, war);
    return `${intro} ${a} mobilized against ${b} over ${war.cause.replaceAll('-', ' ')}. ${capability}${first ? ` ${first}` : ''} The outcome was still unwritten.`;
  }
  if (event.type === 'war-campaign') {
    const perspective: Record<string, string> = {
      march: 'Between a declaration and a battle lies the country itself. I follow the banners into that distance.',
      'passage-blocked': 'The land has refused the timetable. From above, I can see why the banners have stopped.',
      'supply-crisis': 'An army carries the limits of its home with it. The stores now matter as much as the front.',
      reversal: 'I return to the same ground and find the balance changed. An advantage is never a promise.',
      'capability-mismatch': 'The two forces have reached the same ground carrying very different answers to the problem of war.',
    };
    const mismatch = mismatchSentence(state, event, war);
    return `${perspective[String(event.context.dispatch)] ?? 'The campaign has entered another chapter.'} ${event.outcome}${mismatch ? ` ${mismatch}` : ''}`;
  }
  if (event.type === 'battle') {
    const count = event.affectedPopulation;
    const opening = event.context.battleNumber === 1 ? 'The distance between them has closed.'
      : Number(event.context.supplyA) < 0.25 || Number(event.context.supplyB) < 0.25 ? 'The fighting continues under the weight of dwindling provisions.'
        : 'I return to the contested ground. Neither the banners nor the balance have stood still.';
    const engagement = engagementSentence(event);
    const mismatch = mismatchSentence(state, event, war);
    const first = firstRecordedCapability(state, event, war);
    const cost = count === 0 ? 'This clash took no recorded lives.' : `${count.toLocaleString()} ${count === 1 ? 'life was' : 'lives were'} lost in this clash.`;
    return `${opening}${engagement ? ` ${engagement}` : ''}${mismatch ? ` ${mismatch}` : ''}${first ? ` ${first}` : ''} ${event.outcome} ${cost}`;
  }
  const months = Number(event.context.months);
  const losses = Number(event.context.casualties);
  const cost = losses === 0 ? 'No deaths were attributed to its fighting.' : `${losses.toLocaleString()} ${losses === 1 ? 'life is' : 'lives are'} missing from the world that began it.`;
  const capability = capabilityContrast(war, a, b);
  return `I watched this war for ${months} months. ${event.outcome} ${cost}${capability ? ` I remember its character clearly: ${capability}` : ''} The record closes; the consequences remain.`;
}

export function liveWarStory(state: SimulationState, war: War): string {
  const a = state.settlements.find(s => s.id === war.attacker)?.name ?? 'The attacking settlement';
  const b = state.settlements.find(s => s.id === war.defender)?.name ?? 'the defending settlement';
  const capability = capabilityContrast(war, a, b);
  if (war.campaign.blockedMonths > 0) return `I find the banners waiting. The approach between ${a} and ${b} has been impassable for ${war.campaign.blockedMonths} months. ${capability}`;
  if (war.phase === 'mobilizing') return `I stay with ${a} as the campaign gathers. Beyond these homes lies ${b}; for now, the fighting has not begun. ${capability}`;
  if (war.phase === 'marching') return `I follow the space between ${a} and ${b}. The march is ${Math.round(war.marchProgress * 100)}% complete; distance and provisions are setting its pace. ${capability}`;
  const losses = war.casualtiesA + war.casualtiesB;
  const [profileA, profileB] = profilePair(war);
  const mismatch = profileA && profileB && Math.abs(profileA.overall - profileB.overall) > 0.18
    ? 'The forces below are not military equals; what each can reach, protect and sustain is now part of the story.'
    : 'Neither side can treat equipment alone as a guarantee.';
  return `Below me, ${a} and ${b} contest the same approach. ${war.campaign.battleCount} clashes have taken ${losses.toLocaleString()} lives. ${capability} ${mismatch} ${Math.min(war.campaign.supplyA, war.campaign.supplyB) < 0.25 ? 'Provisions are under severe strain.' : 'The campaign is still unresolved.'}`;
}
