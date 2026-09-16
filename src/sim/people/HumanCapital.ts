import type { KnowledgeDomain, Occupation, Person, Settlement, SimulationState } from '../types';
import { isStatistical, settlementRepresentedPopulation } from '../Population';
import { allocateSurvivalLabour } from '../pressures/Survival';

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
export const OCCUPATIONS: readonly Occupation[] = ['farmer', 'forager', 'builder', 'artisan', 'carrier', 'keeper', 'child', 'elder'];
export const DOMAIN_OCCUPATIONS: Record<KnowledgeDomain, readonly Occupation[]> = {
  agriculture: ['farmer', 'forager'], materials: ['artisan', 'forager'], navigation: ['carrier', 'keeper'],
  records: ['keeper', 'carrier'], medicine: ['keeper', 'elder'], mechanics: ['builder', 'artisan'],
  energy: ['artisan', 'builder'], manufacturing: ['artisan', 'builder'], chemistry: ['artisan', 'keeper'],
  transport: ['carrier', 'builder'], physics: ['keeper', 'artisan'], computation: ['keeper', 'artisan'],
  biology: ['keeper', 'elder'], aerospace: ['artisan', 'builder', 'carrier'],
};
export const WORK_DOMAIN: Partial<Record<Occupation, KnowledgeDomain>> = {
  farmer: 'agriculture', forager: 'agriculture', builder: 'mechanics', artisan: 'materials', carrier: 'transport', keeper: 'records',
};
const OCCUPATION_DOMAINS = Object.fromEntries(OCCUPATIONS.map(o => [o, (Object.keys(DOMAIN_OCCUPATIONS) as KnowledgeDomain[]).filter(d => DOMAIN_OCCUPATIONS[d].includes(o))])) as Record<Occupation, KnowledgeDomain[]>;
export function workDomain(person: Person): KnowledgeDomain | undefined {
  if (person.occupation === 'keeper' && ['healer', 'medical-worker'].includes(person.role ?? '')) return 'medicine';
  if (person.occupation === 'artisan' && person.role === 'energy-technician') return 'energy';
  if (person.occupation === 'artisan' && person.role === 'factory-worker') return 'manufacturing';
  return WORK_DOMAIN[person.occupation];
}
const RESOURCE_SHARE: Partial<Record<Occupation, number>> = { forager: 0.5, builder: 0.35, artisan: 0.6, keeper: 0.5, elder: 0.25, carrier: 0.5 };
type Counts = Partial<Record<Occupation, number>>;
export interface WorkforceProfile {
  healthAtCapture: number;
  /** Per citizen at transition; retained aggregate workforce, not weights attached to named people. */
  occupations: Counts;
  effective: Counts;
  domains: Partial<Record<KnowledgeDomain, number>>;
  experts: Partial<Record<KnowledgeDomain, number>>;
}
export interface LabourSummary {
  /** Raw civilian time spent on adaptation construction and fire tending, after reassignment. */
  establishmentReserved?: number;
  survivalReassigned?: number;
  month: number;
  population: number;
  infrastructure: number;
  industry: number;
  militaryReserved: number;
  occupations: Counts;
  effective: Counts;
  resources: Counts;
  economy: Counts;
  domains: Partial<Record<KnowledgeDomain, number>>;
  experts: Partial<Record<KnowledgeDomain, number>>;
}

export function competence(person: Person, domain: KnowledgeDomain): number {
  return clamp(person.expertise?.find(e => e.domain === domain)?.competence ?? 0);
}
export function workAvailability(person: Person): number {
  return !person.alive || person.occupation === 'child' || person.displacedSinceMonth !== undefined || person.activity === 'migrate'
    ? 0 : clamp(person.health) * (person.occupation === 'elder' ? 0.25 : 1);
}
export function expertiseEntry(person: Person, domain: KnowledgeDomain, month: number): NonNullable<Person['expertise']>[number] {
  const slots = (person.expertise ??= []);
  const existing = slots.find(e => e.domain === domain);
  if (existing) return existing;
  if (slots.length >= 3) {
    // Retain the strongest tradition; replace only the least competent, oldest unused slot.
    slots.sort((a, b) => a.competence - b.competence || a.lastPractisedMonth - b.lastPractisedMonth || a.domain.localeCompare(b.domain));
    slots.shift();
  }
  const entry = { domain, competence: 0, lastPractisedMonth: month };
  slots.push(entry);
  return entry;
}
export function practise(person: Person, domain: KnowledgeDomain, month: number, months = 3, effort = 1): void {
  if (workAvailability(person) <= 0 || effort <= 0) return;
  const entry = expertiseEntry(person, domain, month);
  const elapsed = Math.min(months, Math.max(0, month - entry.lastPractisedMonth));
  // Approximately a decade to strong competence; diminishing returns near mastery.
  entry.competence = clamp(entry.competence + (1 - entry.competence) * (1 - Math.exp(-0.008 * elapsed * clamp(effort) * workAvailability(person))));
  entry.lastPractisedMonth = month;
}

export function explicitLabour(residents: readonly Person[], month: number, population = residents.filter(p => p.alive).length): LabourSummary {
  const summary: LabourSummary = { month, population, infrastructure: 0, industry: 0, militaryReserved: 0, occupations: {}, effective: {}, resources: {}, economy: {}, domains: {}, experts: {} };
  for (const p of residents) {
    if (!p.alive) continue;
    summary.occupations[p.occupation] = (summary.occupations[p.occupation] ?? 0) + 1;
    const available = workAvailability(p);
    const domain = workDomain(p);
    const effective = available * (0.8 + (domain ? competence(p, domain) : 0) * 0.55);
    summary.effective[p.occupation] = (summary.effective[p.occupation] ?? 0) + effective;
    // Domain signals observe the SAME work. They are evidence for knowledge, not additional labour budgets.
    for (const d of OCCUPATION_DOMAINS[p.occupation]) {
      const skill = competence(p, d);
      summary.domains[d] = (summary.domains[d] ?? 0) + available * (0.8 + skill * 0.55);
      summary.experts[d] = (summary.experts[d] ?? 0) + available * skill;
    }
  }
  allocate(summary);
  return summary;
}
function allocate(summary: LabourSummary): void {
  for (const o of OCCUPATIONS) {
    const effective = summary.effective[o] ?? 0;
    summary.resources[o] = effective * (RESOURCE_SHARE[o] ?? 0);
    // Reserve 2% of time for contact/teaching; unused resource time is not spent twice.
    summary.economy[o] = effective * Math.max(0, 0.98 - (RESOURCE_SHARE[o] ?? 0));
  }
  summary.infrastructure = (summary.economy.builder ?? 0) * 0.1;
  summary.economy.builder = (summary.economy.builder ?? 0) * 0.9;
}
export function workforceProfile(residents: readonly Person[], month: number, healthAtCapture = 0.5): WorkforceProfile {
  const s = explicitLabour(residents, month);
  const perCitizen = <T extends string>(v: Partial<Record<T, number>>): Partial<Record<T, number>> =>
    Object.fromEntries(Object.entries(v).map(([k, n]) => [k, Number(n) / Math.max(1, s.population)])) as Partial<Record<T, number>>;
  return { healthAtCapture, occupations: perCitizen(s.occupations), effective: perCitizen(s.effective), domains: perCitizen(s.domains), experts: perCitizen(s.experts) };
}
const monthlySummaries = new WeakMap<SimulationState, { month: number; summaries: Map<string, LabourSummary> }>();
/** Freeze one allocation at the start of productive work; medicine applied later benefits next month. */
export function beginLabourMonth(state: SimulationState, residents: ReadonlyMap<string, readonly Person[]>): void {
  monthlySummaries.delete(state);
  const summaries = new Map<string, LabourSummary>();
  for (const settlement of state.settlements) if (settlement.alive) {
    const summary = settlementLabour(state, settlement, residents.get(settlement.id) ?? []);
    if (settlement.survival) settlement.survival.reassignedLabour = summary.survivalReassigned ?? 0;
    summaries.set(settlement.id, summary);
  }
  monthlySummaries.set(state, { month: state.month, summaries });
}
export function invalidateLabour(state: SimulationState): void { monthlySummaries.delete(state); }

/** One population/health/competence contract for every productive consumer. */
export function settlementLabour(state: SimulationState, settlement: Settlement, residents?: readonly Person[]): LabourSummary {
  const month = monthlySummaries.get(state);
  const cached = month?.month === state.month ? month.summaries.get(settlement.id) : undefined;
  if (cached) return cached;
  if (!isStatistical(state)) return reserveCivilianLabour(state, settlement, explicitLabour(residents ?? state.people.filter(p => p.homeId === settlement.id), state.month));
  const city = state.advanced.cities.find(c => c.settlementId === settlement.id);
  const population = settlementRepresentedPopulation(state, settlement.id);
  // Missing profiles cannot be re-created from an arbitrary modern documentary sample.
  const profile = city?.workforce;
  const summary: LabourSummary = { month: state.month, population, infrastructure: 0, industry: 0, militaryReserved: 0, occupations: {}, effective: {}, resources: {}, economy: {}, domains: {}, experts: {} };
  for (const key of ['occupations', 'effective', 'domains', 'experts'] as const) {
    for (const [domain, share] of Object.entries(profile?.[key] ?? {})) (summary[key] as Record<string, number>)[domain] = share * population * (key === 'occupations' ? 1 : Math.min(1.2, (city?.health ?? 0.5) / Math.max(0.1, profile?.healthAtCapture ?? 0.5)));
  }
  allocate(summary);
  return reserveCivilianLabour(state, settlement, summary);
}

/** Mobilization reserves worker-months, never combat strength or renderer agents. */
function reserveCivilianLabour(state: SimulationState, settlement: Settlement, summary: LabourSummary): LabourSummary {
  if (state.wars?.some(w => w.active && (w.attacker === settlement.id || w.defender === settlement.id))) {
    const share = 0.11 + settlement.politicalPower.military * 0.08;
    const available = Object.values(summary.effective).reduce((n, v) => n + (v ?? 0), 0);
    summary.militaryReserved = available * share;
    for (const key of ['effective', 'domains', 'experts'] as const) for (const domain of Object.keys(summary[key])) {
      const values = summary[key] as Record<string, number>; values[domain] = values[domain]! * (1 - share);
    }
    allocate(summary);
  }
  if (settlement.industry.active) {
    summary.industry = (summary.economy.artisan ?? 0) * 0.5;
    summary.economy.artisan = (summary.economy.artisan ?? 0) * 0.5;
  }
  return allocateSurvivalLabour(settlement, summary);
}

/** Annual review is bounded; ordinary birthdays retain both occupation and workplace. */
export function reconsiderCareer(person: Person, settlement: Settlement, month: number, choose: () => Occupation): boolean {
  const career = (person.career ??= { startedMonth: month, lastReconsideredMonth: month, reason: 'initial', inactiveMonths: 0 });
  const adulthood = person.occupation === 'child' && person.ageMonths >= 15 * 12;
  const retirement = person.occupation !== 'elder' && person.ageMonths > 68 * 12;
  const recovery = career.inactiveMonths >= 24 && settlement.alive && person.health > 0.5;
  if (!adulthood && !retirement && !recovery) return false;
  career.lastReconsideredMonth = month;
  const next = retirement ? 'elder' : choose();
  career.inactiveMonths = 0;
  if (next === person.occupation) return false;
  person.occupation = next;
  career.startedMonth = month;
  career.reason = adulthood ? 'adulthood' : retirement ? 'retirement' : 'return-to-work';
  return true;
}

/** Quarterly, O(P + R). At most two learners per teacher and one lesson per learner. */
export function teach(state: SimulationState): void {
  const byId = new Map(state.people.filter(p => p.alive).map(p => [p.id, p]));
  const homes = new Map(state.settlements.map(s => [s.id, s]));
  const capacity = new Map<string, number>();
  const taught = new Set<string>();
  for (const r of state.socialRelationships ?? []) {
    if (!['mentor', 'colleague', 'family', 'intellectual-collaborator'].includes(r.kind) || r.strength < 0.3 || r.trust < 0.5
      || state.month - r.formedMonth < 6 || state.month - r.lastContactMonth > 12 || r.teaching?.lastTaughtMonth === state.month) continue;
    const a = byId.get(r.a), b = byId.get(r.b);
    if (!a || !b || a.homeId !== b.homeId) continue;
    const home = homes.get(a.homeId);
    if (!home?.alive || home.foodSecurity < 0.3 || home.conflictPressure > 0.6) continue;
    let mentor: Person | undefined, learner: Person | undefined, domain: KnowledgeDomain | undefined, gap = 0;
    for (const [teacher, student] of [[a, b], [b, a]] as const) {
      if (workAvailability(teacher) <= 0.1 || workAvailability(student) <= 0.2 || taught.has(student.id) || (capacity.get(teacher.id) ?? 0) >= 2) continue;
      for (const e of teacher.expertise ?? []) {
        if (!DOMAIN_OCCUPATIONS[e.domain].includes(student.occupation) || e.competence < 0.6) continue;
        const difference = e.competence - competence(student, e.domain);
        if (difference > Math.max(0.12, gap)) { mentor = teacher; learner = student; domain = e.domain; gap = difference; }
      }
    }
    if (!mentor || !learner || !domain) continue;
    const entry = expertiseEntry(learner, domain, state.month);
    const gain = gap * 0.035 * r.strength * r.trust * Math.min(mentor.health, learner.health);
    entry.competence = clamp(entry.competence + gain);
    const prior = r.teaching;
    const progress = (prior?.mentorId === mentor.id && prior.domain === domain ? prior.progress : 0) + gain;
    r.teaching = { mentorId: mentor.id, learnerId: learner.id, domain, progress: clamp(progress), lastTaughtMonth: state.month };
    if (r.kind !== 'family') r.kind = 'mentor';
    if (progress >= 0.1) entry.teacherId = mentor.id;
    capacity.set(mentor.id, (capacity.get(mentor.id) ?? 0) + 1);
    taught.add(learner.id);
  }
}

export function advanceHumanCapital(state: SimulationState): void {
  const homes = new Map(state.settlements.map(s => [s.id, s]));
  const constructionHomes = new Set(state.settlements.filter(s => s.development?.project || (s.structurePlots ?? []).some(plot => plot.condition < 0.95)).map(s => s.id));
  const tradeHomes = new Set(state.tradeRoutes.filter(r => r.active).flatMap(r => [r.a, r.b]));
  for (const p of state.people) {
    if (!p.alive) continue;
    const career = (p.career ??= { startedMonth: state.month, lastReconsideredMonth: state.month, reason: 'initial', inactiveMonths: 0 });
    const home = homes.get(p.homeId);
    if (!home?.alive || workAvailability(p) < 0.25) career.inactiveMonths++;
    else if (career.inactiveMonths < 24) career.inactiveMonths = 0;
    if (state.month % 3 !== 0 || !home?.alive) continue;
    const primary = workDomain(p);
    // Broad work conditions, without per-action updates: idle builders do not acquire mastery.
    const work = p.occupation === 'builder'
      ? constructionHomes.has(home.id) ? 1 : home.buildings > 0 ? 0.15 : 0
      : p.occupation === 'carrier' ? tradeHomes.has(home.id) ? 1 : 0.35
        : 1;
    if (primary) practise(p, primary, state.month, 3, work * (1 - home.conflictPressure * 0.5));
    for (const entry of p.expertise ?? []) if (entry.domain !== primary && state.month - entry.lastPractisedMonth > 120) entry.competence *= 0.999;
  }
  if (state.month % 3 === 0) teach(state);
}

// The province and legacy catchment/material systems spend this SAME monthly allocation.
const budgets = new WeakMap<SimulationState, { month: number; settlements: Map<string, Counts> }>();
export function resourceLabourBudget(state: SimulationState, settlement: Settlement, residents?: readonly Person[]): Counts {
  let run = budgets.get(state);
  if (!run || run.month !== state.month) { run = { month: state.month, settlements: new Map() }; budgets.set(state, run); }
  let budget = run.settlements.get(settlement.id);
  if (!budget) { budget = { ...settlementLabour(state, settlement, residents).resources }; run.settlements.set(settlement.id, budget); }
  return budget;
}

const infrastructureBudgets = new WeakMap<SimulationState, { month: number; settlements: Map<string, { remaining: number }> }>();
export function infrastructureLabourBudget(state: SimulationState, settlement: Settlement): { remaining: number } {
  let run = infrastructureBudgets.get(state);
  if (!run || run.month !== state.month) { run = { month: state.month, settlements: new Map() }; infrastructureBudgets.set(state, run); }
  let budget = run.settlements.get(settlement.id);
  if (!budget) { budget = { remaining: settlementLabour(state, settlement).infrastructure }; run.settlements.set(settlement.id, budget); }
  return budget;
}
