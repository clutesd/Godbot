import type { HistoricalEvent, KnowledgeDomain, Person, Settlement } from '../sim/types';

export function historicalDate(month: number): string {
  return `Year ${Math.floor(month / 12).toLocaleString()}, month ${month % 12 + 1}`;
}

export function elapsedTime(months: number): string {
  const value = months < 12 ? months : Math.floor(months / 12);
  const unit = months < 12 ? 'month' : 'year';
  return `${value.toLocaleString()} ${unit}${value === 1 ? '' : 's'}`;
}

export function sentence(text: string): string {
  const clean = text.trim();
  return !clean || /[.!?…]$/.test(clean) ? clean : `${clean}.`;
}

/** Outcomes are authored evidence. Never infer success, benefit or causation from an event label. */
export function recordedEventText(event: HistoricalEvent, now: number): string {
  let text = sentence(event.summary);
  if (event.type === 'first-fire' && now - event.month <= 1) text += ' A communal hearth is burning at this camp.';
  const outcome = sentence(event.outcome);
  if (outcome && !text.toLocaleLowerCase().includes(outcome.toLocaleLowerCase())) text += ` ${outcome}`;
  if (event.type === 'nuclear-weapons-developed' && typeof event.context.doctrine === 'string') {
    text += ` Its stated doctrine is ${event.context.doctrine.replaceAll('-', ' ')}.`;
  }
  if ((event.type === 'nuclear-use' || event.type === 'nuclear-exchange') && typeof event.context.populationLossFraction === 'number') {
    text += ` The recorded population loss is ${Math.round(event.context.populationLossFraction * 100)}%.`;
  }
  if (event.type === 'observation-lost') text += ' Classification: UNKNOWN.';
  // A delayed observation describes a dated record, never a centuries-old event as breaking news.
  return now - event.month > 12 ? `${historicalDate(event.month)}. ${text}` : text;
}

export function activityText(person: Pick<Person, 'activity'>): string {
  const phrases: Record<Person['activity'], string> = {
    construct: 'working on construction', craft: 'at work crafting', farm: 'working the fields',
    gather: 'gathering supplies', study: 'studying', worship: 'taking part in worship',
    mourn: 'mourning', patrol: 'on patrol', assist: 'helping others', flee: 'fleeing',
    trade: 'trading', transport: 'carrying goods', migrate: 'moving to a new home',
    travel: 'travelling', socialize: 'spending time with others', shelter: 'taking shelter', rest: 'resting',
  };
  return phrases[person.activity];
}

export function skillText(domain: string): string {
  const phrases: Record<string, string> = { agriculture: 'farming', materials: 'working with materials', navigation: 'navigation',
    records: 'keeping records', medicine: 'medicine', mechanics: 'mechanics', energy: 'energy',
    manufacturing: 'manufacturing', chemistry: 'chemistry', transport: 'transport', physics: 'physics',
    computation: 'computation', biology: 'biology', aerospace: 'aerospace' } satisfies Record<KnowledgeDomain, string>;
  return phrases[domain] ?? domain.replaceAll('-', ' ');
}

/** One human connection is more readable than a list of age, role, skill and career fields. */
export function personStory(person: Person, home: Settlement | undefined, people: readonly Person[], introduced: boolean, month: number): { text: string; sourceIds: string[] } {
  const name = introduced ? person.name : `${person.name}, ${Math.floor(person.ageMonths / 12)}`;
  const action = `${name} is ${activityText(person)}${home ? ` near ${home.name}` : ''}.`;
  const sources = [person.id, ...(home ? [home.id] : [])];
  const expert = [...(person.expertise ?? [])].sort((a, b) => b.competence - a.competence)[0];
  const teacher = expert?.teacherId ? people.find(p => p.id === expert.teacherId) : undefined;
  if (expert && teacher && expert.competence >= 0.18) {
    sources.push(teacher.id);
    const connection = teacher.alive ? `${teacher.name} taught them ${skillText(expert.domain)}.`
      : `Their teacher, ${teacher.name}, has died; what they learned about ${skillText(expert.domain)} remains with them.`;
    return { text: `${action} ${connection}`, sourceIds: sources };
  }
  const careerYears = person.career ? Math.floor((month - person.career.startedMonth) / 12) : 0;
  if (expert && expert.competence >= 0.35) {
    return { text: `${action} ${skillText(expert.domain).replace(/^./, c => c.toUpperCase())} is their strongest skill${expert.competence >= 0.7 ? ', backed by considerable experience' : ''}.`, sourceIds: sources };
  }
  if (careerYears >= 2 && person.occupation !== 'child' && person.occupation !== 'elder') {
    return { text: `${action} They began work as ${person.occupation === 'artisan' ? 'an' : 'a'} ${person.occupation} ${careerYears} years ago.`, sourceIds: sources };
  }
  return { text: `${action}${expert ? ` They are still learning ${skillText(expert.domain)}.` : ''}`, sourceIds: sources };
}
