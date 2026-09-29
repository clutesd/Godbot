import { SeededRandom } from '../prng';
import type { Person, Settlement, SimulationState } from '../types';

const unit = (n: number) => Math.max(0, Math.min(1, n));

/** Health already contains nutritional/exposure injury. Do not add its hazard again
 * on top of the same active survival pressure; independent age/pollution remain additive. */
export function combinedSurvivalHazard(healthHazard: number, scarcity: number, exposure: number): number {
  return Math.max(healthHazard, scarcity + exposure);
}

/** A small travelling community: five couples, six dependents, four singles, two elders.
 * Manifest randomness is independent of emergence frame sizes and the simulation RNG. */
export function founderLife(group: string, index: number) {
  const random = new SeededRandom(`${group}:demography:${index}`);
  const couple = Math.floor(index / 2);
  const ages = [23, 27, 31, 35, 40];
  const childAges = [2, 5, 8, 11, 14, 16];
  const family = index < 10 ? couple : index < 16 ? Math.min(4, index - 10) : index;
  const age = index < 10 ? ages[couple]! + random.int(0, 3)
    : index < 16 ? childAges[index - 10]! : index < 20 ? random.int(18, 27) : random.int(60, 73);
  return { ageMonths: age * 12 + random.int(0, 12), sex: (index % 2 ? 'male' : 'female') as Person['sex'],
    householdId: `${group}:household:${family}`, family };
}

export function linkFoundingFamilies(people: Person[], month: number): void {
  for (let i = 0; i < 10; i += 2) {
    const mother = people[i], father = people[i + 1];
    if (!mother || !father) continue;
    mother.partnerId = father.id; father.partnerId = mother.id;
  }
  for (let i = 10; i < Math.min(16, people.length); i++) {
    const child = people[i]!, family = Math.min(4, i - 10);
    const mother = people[family * 2]!, father = people[family * 2 + 1]!;
    child.parents = [mother.id, father.id];
    mother.children.push(child.id); father.children.push(child.id);
    mother.lastBirthMonth = Math.max(mother.lastBirthMonth ?? -Infinity, month - child.ageMonths);
  }
  // Some families arrive already expecting. These pregnancies still face ordinary survival risks.
  for (const mother of people.slice(0, 10).filter(p => p.sex === 'female')) {
    const random = new SeededRandom(`${mother.foundingOrigin?.groupId}:${mother.id}:pregnancy`);
    if (random.chance(0.12)) mother.pregnancy = { dueMonth: month + random.int(1, 10), fatherId: mother.partnerId! };
  }
}

/** A planned travelling community brings basic practical trades as well as its speciality.
 * Reassign an existing adult from an overrepresented trade; never add workers or expertise. */
export function balanceFounderTrades(people: Person[]): void {
  const adults = people.filter(p => p.ageMonths >= 18 * 12 && p.ageMonths < 60 * 12);
  for (const occupation of ['farmer', 'forager', 'builder'] as const) {
    if (adults.some(p => p.occupation === occupation)) continue;
    const counts = new Map<Person['occupation'], number>();
    for (const p of adults) counts.set(p.occupation, (counts.get(p.occupation) ?? 0) + 1);
    const candidate = [...adults].sort((a, b) => (counts.get(b.occupation) ?? 0) - (counts.get(a.occupation) ?? 0))[0];
    if (candidate && (counts.get(candidate.occupation) ?? 0) > 1) candidate.occupation = occupation;
  }
}

/** Monthly conception hazard; gestation and postpartum recovery bound completed births.
 * At full health, ages 20–29 average roughly one birth per 3–4 years, not monthly births. */
export function conceptionChance(person: Person, partner: Person | undefined, s: Settlement, month: number,
  densityFactor: number, populationFactor: number): number {
  const age = person.ageMonths / 12;
  if (person.sex !== 'female' || age < 18 || age >= 43 || person.pregnancy || !partner?.alive
    || partner.homeId !== person.homeId || partner.partnerId !== person.id || partner.activity === 'migrate'
    || person.activity === 'migrate' || month < (person.reproductiveRecoveryUntilMonth ?? -Infinity) || month - (person.lastBirthMonth ?? -Infinity) < 18) return 0;
  const ageFactor = age < 20 ? 0.65 : age < 30 ? 1 : age < 35 ? 0.8 : age < 39 ? 0.5 : 0.2;
  const health = unit((Math.min(person.health, partner.health) - 0.3) / 0.5);
  const nutrition = unit(1 - (s.survival?.deprivation ?? 0) / 3);
  const security = unit(1 - s.conflictPressure) * (0.5 + unit(s.foodSecurity) * 0.5);
  return 0.065 * ageFactor * health * nutrition * security * densityFactor * populationFactor;
}

/** The common household registry is derived from authoritative living people. */
export function syncDemographicHouseholds(state: SimulationState): void {
  const prior = new Map((state.households ?? []).map(h => [`${h.settlementId}:${h.id}`, h]));
  const settlements = new Map(state.settlements.map(s => [s.id, s]));
  const groups = new Map<string, Person[]>();
  for (const p of state.people) if (p.alive) {
    const key = `${p.homeId}:${p.householdId}`;
    const group = groups.get(key) ?? []; group.push(p); groups.set(key, group);
  }
  state.households = [...groups.values()].map(members => {
    const p = members[0]!, s = settlements.get(p.homeId)!;
    const id = `${p.homeId}:${p.householdId}`;
    const occupationMix: Partial<Record<Person['occupation'], number>> = {};
    for (const member of members) occupationMix[member.occupation] = (occupationMix[member.occupation] ?? 0) + 1;
    return { id: p.householdId, settlementId: p.homeId, homePosition: prior.get(id)?.homePosition ?? { ...p.position },
      memberIds: members.map(p => p.id), wealth: s.prosperity, foodSecurity: s.foodSecurity,
      socialStanding: prior.get(id)?.socialStanding ?? 0.5, materialQuality: s.prosperity, occupationMix, active: true };
  });
}

/** Whole households only. Ordinary opportunity moves cannot empty the remaining adult cohort. */
export function migrationHouseholds(people: readonly Person[], pressure: number, catastrophic: boolean): Person[] {
  const available = people.filter(p => p.alive && p.activity !== 'migrate');
  const ranked = available.filter(p => p.ageMonths >= 18 * 12 && p.ageMonths < 58 * 12)
    .sort((a, b) => (b.traits.riskTolerance + b.traits.ambition) - (a.traits.riskTolerance + a.traits.ambition));
  const limit = catastrophic ? Math.ceil(available.length * 0.65) : Math.max(1, Math.floor(available.length * Math.min(0.2, 0.08 + pressure * 0.12)));
  const selected: Person[] = [];
  for (const adult of ranked) {
    if (selected.includes(adult)) continue;
    const family = available.filter(p => p.householdId === adult.householdId);
    if (selected.length + family.length > limit) continue;
    const remaining = available.filter(p => !selected.includes(p) && !family.includes(p));
    if (!catastrophic && (remaining.filter(p => p.ageMonths >= 18 * 12 && p.ageMonths < 60 * 12).length < 8
      || remaining.filter(p => p.sex === 'female' && p.ageMonths >= 18 * 12 && p.ageMonths < 40 * 12).length < 3)) continue;
    selected.push(...family);
  }
  return selected;
}
