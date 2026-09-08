import type { GodboxConfig } from '../../config';
import type { SeededRandom } from '../prng';
import type {
  AdvancedCivilizationState,
  AdvancedInstitutionKind,
  AdvancedSector,
  ExistentialRiskKind,
  ExistentialRiskPressure,
  FermiHypothesis,
  HistoricalEventType,
  NuclearPosture,
  OutcomeClassification,
  Settlement,
  SimulationState,
  Vec2,
} from '../types';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const mean = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const SECTORS: readonly AdvancedSector[] = ['science', 'energy', 'health', 'industry', 'information', 'aerospace', 'defense', 'biotechnology', 'automation'];
const RISK_KINDS: readonly ExistentialRiskKind[] = ['nuclear-conflict', 'pandemic', 'ecological-overshoot', 'climate-destabilization', 'resource-stress', 'autonomous-weapons', 'machine-transition', 'asteroid-impact', 'supervolcanism', 'political-fragmentation'];

export interface AdvancedEventDraft {
  type: HistoricalEventType;
  location?: Vec2;
  locationId?: string;
  actors?: string[];
  causes?: string[];
  context?: Record<string, string | number | boolean>;
  outcome: string;
  affectedPopulation?: number;
  magnitude?: number;
  significance?: number;
  tags?: string[];
  summary: string;
}

const emptyRisk = (kind: ExistentialRiskKind): ExistentialRiskPressure => ({ kind, hazard: 0, vulnerability: 0, mitigation: 0, annualProbability: 0, active: false });

export function createAdvancedCivilizationState(explicitPopulation = 0): AdvancedCivilizationState {
  const sectors = Object.fromEntries(SECTORS.map((sector) => [sector, 0])) as Record<AdvancedSector, number>;
  const risks = Object.fromEntries(RISK_KINDS.map((kind) => [kind, emptyRisk(kind)])) as Record<ExistentialRiskKind, ExistentialRiskPressure>;
  return {
    scale: 'individual', representedPopulation: explicitPopulation, peakRepresentedPopulation: explicitPopulation,
    cohorts: { children: 0.31, workingAge: 0.57, elders: 0.12, biologicalShare: 1 },
    cities: [], states: [], sectors, institutions: [],
    governance: { coordination: 0.22, institutionalCapacity: 0.18, fragmentation: 0.22, publicTrust: 0.42 },
    developmentPriorities: { space: 0.45, machine: 0.45, welfare: 0.5, defense: 0.4 },
    environment: { emissions: 0, climateStress: 0, ecologicalPressure: 0, resourcePressure: 0 },
    atomic: { applications: { energy: 0, medicine: 0, research: 0, propulsion: 0, weaponry: 0 }, postures: [], nuclearUseCount: 0, majorExchangeCount: 0 },
    strategic: { phase: 'none', crisisIntensity: 0, armsCompetitionYears: 0, restraintYears: 0 },
    machine: { capability: 0, scienceIntegration: 0, economicAutomation: 0, governanceIntegration: 0, militaryAutonomy: 0, alignmentReliability: 0.5, observability: 1 },
    space: { satellites: 0, orbitalInfrastructure: 0, lunarActivity: 0, offworldSettlements: 0, interplanetaryPopulation: 0, selfSustainingBodies: 1, resourceActivity: 0 },
    fermi: { hypotheses: [], setiInvestment: 0, broadcasting: 0, securityCaution: 0, spaceInvestment: 0 },
    risks,
    outcome: { classification: null, confidence: 0, rationale: [] },
    technologicalPeak: 0, lastMajorCapabilityMonth: 0, collapseDurationMonths: 0, resilientDurationMonths: 0,
  };
}

export function representedPopulation(state: SimulationState): number {
  return Math.max(0, Math.round(state.advanced?.representedPopulation ?? state.people.filter((person) => person.alive).length));
}

export function settlementRepresentedPopulation(state: SimulationState, settlementId: string): number {
  const city = state.advanced?.cities.find((candidate) => candidate.settlementId === settlementId);
  return city ? Math.max(0, Math.round(city.population)) : state.people.filter((person) => person.alive && person.homeId === settlementId).length;
}

export class AdvancedCivilizationSystem {
  constructor(private readonly config: GodboxConfig, private readonly random: SeededRandom) {}

  initialize(state: SimulationState): void {
    const population = state.people.filter((person) => person.alive).length;
    state.advanced.representedPopulation = population;
    state.advanced.peakRepresentedPopulation = population;
    this.syncCities(state);
    this.syncStates(state);
  }

  advanceMonth(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    const explicitPopulation = state.people.filter((person) => person.alive).length;
    const industrial = state.settlements.some((settlement) => settlement.alive && settlement.industry.active);
    if (!industrial && advanced.scale === 'individual') advanced.representedPopulation = explicitPopulation;
    if (industrial && advanced.scale === 'individual') advanced.scale = 'urban-industrial';
    const modernFoundation = Math.max(this.knowledge(state, 'electric-grid'), this.knowledge(state, 'mass-communication'), this.knowledge(state, 'computation'), this.knowledge(state, 'modern-medicine'));
    if (industrial && advanced.scale !== 'modern-statistical' && modernFoundation >= 0.24) {
      advanced.scale = 'modern-statistical';
      advanced.transitionMonth = state.month;
      advanced.representedPopulation = Math.max(explicitPopulation, advanced.representedPopulation);
      events.push(this.event(state, 'statistical-transition', 'Population is now represented through persistent cohorts, cities, states, and institutions while named people remain documentary representatives.', {
        causes: ['industrial-scale', 'mass-society', 'bounded-individual-simulation'],
        context: { explicitRepresentatives: explicitPopulation, representedPopulation: advanced.representedPopulation },
        magnitude: 0.58, significance: 0.62, tags: ['demography', 'abstraction'],
      }));
    }
    if (advanced.scale === 'modern-statistical') this.updateStatisticalPopulation(state);
    this.syncCities(state);
    advanced.peakRepresentedPopulation = Math.max(advanced.peakRepresentedPopulation, advanced.representedPopulation);
    return events;
  }

  advanceYear(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    this.syncStates(state);
    this.updateGovernance(state);
    this.updateDevelopmentPriorities(state);
    this.updateSectors(state);
    this.updateInstitutions(state);
    events.push(...this.updateAtomicState(state));
    events.push(...this.updateNuclearPostures(state));
    events.push(...this.updateMachineIntelligence(state));
    events.push(...this.updateSpace(state));
    events.push(...this.updateFermiQuestion(state));
    this.updateEnvironment(state);
    events.push(...this.evaluateRisks(state));
    events.push(...this.updateOutcome(state));
    return events;
  }

  classificationAtHorizon(state: SimulationState): OutcomeClassification {
    const classified = state.advanced.outcome.classification;
    if (classified) return classified;
    if (representedPopulation(state) === 0) return 'EXTINCT';
    if (state.advanced.space.selfSustainingBodies >= 2) return 'INTERPLANETARY';
    if (state.advanced.atomic.thresholdMonth !== undefined && state.month - state.advanced.atomic.thresholdMonth >= this.config.advanced.planetaryStabilityYears * 12 && state.advanced.governance.institutionalCapacity >= 0.55) return 'PLANETARY STABLE';
    return 'STAGNANT';
  }

  private updateStatisticalPopulation(state: SimulationState): void {
    const advanced = state.advanced;
    if (advanced.representedPopulation <= 0) return;
    const foodSecurity = mean(state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.foodSecurity));
    const health = advanced.sectors.health;
    const pressure = mean([advanced.environment.climateStress, advanced.environment.ecologicalPressure, advanced.environment.resourcePressure]);
    const livingRepresentatives = state.people.filter((person) => person.alive).length;
    const representativeBase = Math.max(96, livingRepresentatives);
    const carryingCapacity = Math.min(this.config.advanced.statisticalPopulationCap, Math.max(25_000, representativeBase * (2_000 + advanced.sectors.industry * 90_000 + advanced.sectors.energy * 50_000)));
    const annualGrowth = clamp(0.002 + foodSecurity * 0.012 + health * 0.01 - pressure * 0.018 - advanced.governance.fragmentation * 0.006, -0.035, 0.024);
    const logistic = Math.max(-1, 1 - advanced.representedPopulation / carryingCapacity);
    advanced.representedPopulation = Math.max(0, advanced.representedPopulation * (1 + annualGrowth * logistic / 12));
    const elderTarget = clamp(0.1 + health * 0.16, 0.07, 0.3);
    const childTarget = clamp(0.3 - health * 0.12 - advanced.sectors.information * 0.04, 0.12, 0.34);
    advanced.cohorts.elders += (elderTarget - advanced.cohorts.elders) * 0.002;
    advanced.cohorts.children += (childTarget - advanced.cohorts.children) * 0.002;
    advanced.cohorts.workingAge = Math.max(0, 1 - advanced.cohorts.children - advanced.cohorts.elders);
  }

  private syncCities(state: SimulationState): void {
    const living = state.settlements.filter((settlement) => settlement.alive);
    const explicitTotal = state.people.filter((person) => person.alive).length;
    const priorTotal = state.advanced.cities.reduce((sum, city) => sum + city.population, 0);
    const previous = new Map(state.advanced.cities.map((city) => [city.settlementId, city]));
    state.advanced.cities = living.map((settlement) => {
      const local = state.people.filter((person) => person.alive && person.homeId === settlement.id).length;
      const old = previous.get(settlement.id);
      const share = explicitTotal > 0 ? local / explicitTotal : old && priorTotal > 0 ? old.population / priorTotal : 1 / Math.max(1, living.length);
      const targetPopulation = state.advanced.scale === 'modern-statistical' ? state.advanced.representedPopulation * share : local;
      return {
        settlementId: settlement.id,
        population: old ? old.population + (targetPopulation - old.population) * 0.18 : targetPopulation,
        health: clamp(0.35 + this.knowledgeAt(settlement, 'modern-medicine') * 0.42 + settlement.foodSecurity * 0.18 - settlement.pollution * 0.2),
        education: clamp(settlement.knowledge.literacy * 0.75 + this.knowledgeAt(settlement, 'mass-communication') * 0.25),
        productivity: clamp(settlement.industry.intensity * 0.48 + this.knowledgeAt(settlement, 'automation') * 0.32 + settlement.prosperity * 0.2),
        infrastructureReliability: clamp(mean(Object.values(settlement.infrastructure)) * 0.72 + state.advanced.governance.institutionalCapacity * 0.28),
        emissions: clamp(settlement.industry.intensity * (0.72 + this.knowledgeAt(settlement, 'internal-combustion') * 0.28) * (1 - this.knowledgeAt(settlement, 'nuclear-energy') * 0.48)),
        resilience: clamp(mean([settlement.foodSecurity, settlement.knowledge.preservation, state.advanced.governance.institutionalCapacity, old?.resilience ?? 0.3])),
      };
    });
    const assigned = state.advanced.cities.reduce((sum, city) => sum + city.population, 0);
    if (assigned > 0) for (const city of state.advanced.cities) city.population *= state.advanced.representedPopulation / assigned;
  }

  private syncStates(state: SimulationState): void {
    state.advanced.states = state.polities.map((polity) => {
      const settlements = state.settlements.filter((settlement) => polity.settlementIds.includes(settlement.id) && settlement.alive);
      const cultures = settlements.flatMap((settlement) => Object.keys(settlement.cultureShares).map((id) => state.cultures.find((culture) => culture.id === id))).filter((culture) => culture !== undefined);
      const relations = state.relations.filter((relation) => polity.settlementIds.includes(relation.a) || polity.settlementIds.includes(relation.b));
      const institutions = state.institutions.filter((institution) => settlements.some((settlement) => settlement.id === institution.settlementId));
      return settlements.length === 0 ? undefined : {
        polityId: polity.id,
        population: settlements.reduce((sum, settlement) => sum + settlementRepresentedPopulation(state, settlement.id), 0),
        institutionalCapacity: clamp(mean(institutions.map((institution) => institution.support * 0.55 + institution.prestige * 0.45)) * 0.72 + polity.legitimacy * 0.28),
        publicTrust: clamp(mean(cultures.map((culture) => culture.dimensions.institutionalTrust)) * 0.68 + polity.legitimacy * 0.32),
        riskTolerance: clamp(mean(cultures.map((culture) => culture.dimensions.militarism * 0.45 + culture.dimensions.hierarchy * 0.25 + culture.dimensions.longTermOrientation * -0.18 + 0.18))),
        scientificCapacity: clamp(mean(settlements.map((settlement) => mean([this.knowledgeAt(settlement, 'scientific-method'), this.knowledgeAt(settlement, 'computation'), settlement.knowledge.literacy])))),
        militaryPressure: clamp(mean(relations.map((relation) => relation.hostility * 0.46 + relation.grievances * 0.3 + relation.territorialTension * 0.24))),
      };
    }).filter((item) => item !== undefined);
  }

  private updateGovernance(state: SimulationState): void {
    const advanced = state.advanced;
    const institutions = state.institutions;
    const relationTrust = mean(state.relations.filter((relation) => relation.contact).map((relation) => relation.trust));
    const hostility = mean(state.relations.filter((relation) => relation.contact).map((relation) => mean([relation.hostility, relation.grievances, relation.territorialTension])));
    const civic = this.knowledge(state, 'civic-administration');
    const communication = this.knowledge(state, 'mass-communication');
    const institutionalBase = mean(institutions.map((institution) => institution.support * 0.5 + institution.prestige * 0.5));
    const coordinationTarget = clamp(institutionalBase * 0.34 + relationTrust * 0.24 + civic * 0.24 + communication * 0.18 - hostility * 0.18);
    const capacityTarget = clamp(institutionalBase * 0.4 + civic * 0.3 + communication * 0.14 + advanced.sectors.information * 0.16);
    const fragmentationTarget = clamp(hostility * 0.46 + (1 - relationTrust) * 0.18 + mean(state.settlements.map((settlement) => settlement.conflictPressure)) * 0.2 + advanced.environment.resourcePressure * 0.16);
    const trustTarget = clamp(mean(state.cultures.map((culture) => culture.dimensions.institutionalTrust)) * 0.48 + relationTrust * 0.2 + capacityTarget * 0.32 - fragmentationTarget * 0.2);
    advanced.governance.coordination += (coordinationTarget - advanced.governance.coordination) * 0.08;
    advanced.governance.institutionalCapacity += (capacityTarget - advanced.governance.institutionalCapacity) * 0.08;
    advanced.governance.fragmentation += (fragmentationTarget - advanced.governance.fragmentation) * 0.08;
    advanced.governance.publicTrust += (trustTarget - advanced.governance.publicTrust) * 0.08;
  }

  private updateDevelopmentPriorities(state: SimulationState): void {
    const cultures = state.cultures;
    const dimensions = (key: keyof SimulationState['cultures'][number]['dimensions']): number => mean(cultures.map((culture) => culture.dimensions[key]));
    const curiosity = dimensions('curiosity');
    const longTerm = dimensions('longTermOrientation');
    const openness = dimensions('outsiderOpenness');
    const trade = dimensions('tradeOrientation');
    const cooperation = dimensions('cooperation');
    const trust = dimensions('institutionalTrust');
    const hierarchy = dimensions('hierarchy');
    const militarism = dimensions('militarism');
    const targets = {
      space: clamp(0.1 + longTerm * 0.32 + openness * 0.25 + trade * 0.12 + curiosity * 0.08 - militarism * 0.18 - hierarchy * 0.1),
      machine: clamp(0.08 + hierarchy * 0.28 + trade * 0.18 + curiosity * 0.12 + (1 - cooperation) * 0.16 - longTerm * 0.08),
      welfare: clamp(0.1 + cooperation * 0.3 + trust * 0.3 + longTerm * 0.22 - militarism * 0.1),
      defense: clamp(0.06 + militarism * 0.42 + hierarchy * 0.2 + state.advanced.governance.fragmentation * 0.18 + (1 - openness) * 0.12),
    };
    for (const key of ['space', 'machine', 'welfare', 'defense'] as const) {
      state.advanced.developmentPriorities[key] += (targets[key] - state.advanced.developmentPriorities[key]) * 0.06;
    }
  }

  private updateSectors(state: SimulationState): void {
    const advanced = state.advanced;
    const industry = mean(state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.industry.intensity));
    const targets: Record<AdvancedSector, number> = {
      science: mean([this.knowledge(state, 'scientific-method'), this.knowledge(state, 'atomic-theory'), this.knowledge(state, 'computation')]),
      energy: mean([this.knowledge(state, 'electric-grid'), this.knowledge(state, 'nuclear-energy'), this.knowledge(state, 'electrical-generation')]),
      health: mean([this.knowledge(state, 'modern-medicine'), this.knowledge(state, 'biotechnology'), this.knowledge(state, 'vaccination')]),
      industry: clamp(industry * 0.65 + this.knowledge(state, 'automation') * 0.2 + this.knowledge(state, 'precision-manufacturing') * 0.15),
      information: mean([this.knowledge(state, 'mass-communication'), this.knowledge(state, 'computation'), state.settlements.length > 0 ? mean(state.settlements.map((settlement) => settlement.knowledge.literacy)) : 0]),
      aerospace: clamp(mean([this.knowledge(state, 'aviation'), this.knowledge(state, 'rocketry'), this.knowledge(state, 'orbital-capability'), this.knowledge(state, 'interplanetary-capability')]) * (0.45 + advanced.developmentPriorities.space * 0.85)),
      defense: clamp((mean(state.advanced.states.map((item) => item.militaryPressure)) * 0.4 + this.knowledge(state, 'automation') * 0.18 + industry * 0.24 + this.knowledge(state, 'rocketry') * 0.18) * (0.55 + advanced.developmentPriorities.defense * 0.75)),
      biotechnology: this.knowledge(state, 'biotechnology'),
      automation: clamp(mean([this.knowledge(state, 'automation'), this.knowledge(state, 'machine-intelligence'), this.knowledge(state, 'general-machine-systems')]) * (0.45 + advanced.developmentPriorities.machine * 0.85)),
    };
    const rate = clamp(0.08 * this.config.advanced.developmentRate, 0.01, 0.3);
    for (const sector of SECTORS) advanced.sectors[sector] += (targets[sector] - advanced.sectors[sector]) * rate;
  }

  private updateInstitutions(state: SimulationState): void {
    const advanced = state.advanced;
    const ensure = (kind: AdvancedInstitutionKind, condition: boolean, basis: number): void => {
      if (!condition) return;
      let institution = advanced.institutions.find((candidate) => candidate.kind === kind);
      if (!institution) {
        institution = { id: `advanced-${kind}`, kind, foundedMonth: state.month, capacity: 0.12, reliability: 0.4, reach: 0.15 };
        advanced.institutions.push(institution);
      }
      institution.capacity += (clamp(basis) - institution.capacity) * 0.08;
      institution.reliability += (clamp(advanced.governance.institutionalCapacity * 0.55 + advanced.governance.publicTrust * 0.25 + basis * 0.2) - institution.reliability) * 0.06;
      institution.reach += (clamp(advanced.governance.coordination * 0.5 + advanced.sectors.information * 0.3 + basis * 0.2) - institution.reach) * 0.05;
    };
    ensure('research-network', this.knowledge(state, 'scientific-method') > 0.28, advanced.sectors.science);
    ensure('public-health-network', this.knowledge(state, 'modern-medicine') > 0.25, advanced.sectors.health);
    ensure('communications-network', this.knowledge(state, 'mass-communication') > 0.25, advanced.sectors.information);
    ensure('atomic-regulator', state.advanced.atomic.thresholdMonth !== undefined && advanced.governance.institutionalCapacity > 0.32, mean([advanced.sectors.science, advanced.governance.institutionalCapacity]));
    ensure('space-program', this.knowledge(state, 'rocketry') > 0.28, mean([advanced.sectors.aerospace, advanced.governance.coordination]));
    ensure('machine-governance-body', this.knowledge(state, 'machine-intelligence') > 0.25 && advanced.governance.institutionalCapacity > 0.35, mean([advanced.sectors.automation, advanced.governance.institutionalCapacity]));
  }

  private updateAtomicState(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    const fission = this.knowledge(state, 'nuclear-fission');
    const transformedFission = state.settlements.some((settlement) => settlement.alive && settlement.knowledge.records['nuclear-fission']?.transformedMonth !== undefined);
    const industrialFoundation = state.settlements.some((settlement) => settlement.alive && settlement.industry.active && settlement.infrastructure.power >= 0.08);
    const researchNetwork = advanced.institutions.some((institution) => institution.kind === 'research-network');
    if (fission >= 0.58 && transformedFission && industrialFoundation && researchNetwork && advanced.atomic.thresholdMonth === undefined) {
      advanced.atomic.thresholdMonth = state.month;
      advanced.lastMajorCapabilityMonth = state.month;
      state.stats.atomicThresholds += 1;
      events.push(this.event(state, 'atomic-threshold', 'Experimental nuclear fission becomes an institutionally supported civilization-scale capability.', {
        causes: ['nuclear-fission-adoption', 'experimental-science', 'industrial-capacity', 'research-network'], context: { knowledge: 'nuclear-fission', fissionMastery: fission, stage: 'civilization-threshold' },
        magnitude: 1, significance: 1, tags: ['atomic', 'threshold', 'dual-use'],
      }));
    }
    if (advanced.atomic.thresholdMonth === undefined) return events;
    const regulator = advanced.institutions.find((institution) => institution.kind === 'atomic-regulator');
    const targets = {
      energy: clamp(this.knowledge(state, 'nuclear-energy') * 0.76 + advanced.environment.resourcePressure * 0.12 + advanced.environment.climateStress * 0.12),
      medicine: clamp(this.knowledge(state, 'nuclear-medicine') * 0.72 + advanced.sectors.health * 0.28),
      research: clamp(fission * 0.55 + advanced.sectors.science * 0.45),
      propulsion: clamp(this.knowledge(state, 'nuclear-propulsion') * 0.72 + advanced.sectors.aerospace * 0.28),
      weaponry: advanced.atomic.applications.weaponry,
    };
    for (const key of ['energy', 'medicine', 'research', 'propulsion'] as const) advanced.atomic.applications[key] += (targets[key] - advanced.atomic.applications[key]) * (0.035 + (regulator?.capacity ?? 0) * 0.012);
    if (advanced.atomic.applications.energy >= 0.22 && !this.hasEvent(state, 'nuclear-energy')) events.push(this.event(state, 'nuclear-energy', 'Controlled atomic energy begins contributing to the power system.', { causes: ['nuclear-fission', 'electric-grid', 'energy-policy'], magnitude: 0.72, significance: 0.78, tags: ['atomic', 'energy'] }));
    if (advanced.atomic.applications.medicine >= 0.22 && !this.hasEvent(state, 'nuclear-medicine')) events.push(this.event(state, 'nuclear-medicine', 'Atomic techniques enter medical research and treatment.', { causes: ['nuclear-fission', 'modern-medicine'], magnitude: 0.55, significance: 0.66, tags: ['atomic', 'medicine'] }));
    return events;
  }

  private updateNuclearPostures(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    if (advanced.atomic.thresholdMonth === undefined) return events;
    const previous = new Map(advanced.atomic.postures.map((posture) => [posture.polityId, posture]));
    advanced.atomic.postures = advanced.states.map((polity) => previous.get(polity.polityId) ?? {
      polityId: polity.polityId, programLevel: 0, arsenalScale: 0, survivability: 0.15,
      warningReliability: 0.2, commandControlReliability: 0.35, riskTolerance: polity.riskTolerance, doctrine: 'minimum-deterrence',
    });
    const armedAtStart = advanced.atomic.postures.filter((posture) => posture.weaponizedMonth !== undefined).length;
    for (const posture of advanced.atomic.postures) {
      const polity = advanced.states.find((candidate) => candidate.polityId === posture.polityId);
      if (!polity) continue;
      const settlements = state.polities.find((candidate) => candidate.id === posture.polityId)?.settlementIds ?? [];
      const related = state.relations.filter((relation) => settlements.includes(relation.a) || settlements.includes(relation.b));
      const rivalry = Math.max(polity.militaryPressure, ...related.map((relation) => mean([relation.hostility, relation.grievances, relation.territorialTension])));
      const activeWars = state.wars.filter((war) => war.active && (settlements.includes(war.attacker) || settlements.includes(war.defender)));
      const externalWar = activeWars.some((war) => {
        const opposingId = settlements.includes(war.attacker) ? war.defender : war.attacker;
        return state.settlements.find((settlement) => settlement.id === opposingId)?.polityId !== posture.polityId;
      });
      const activeWar = externalWar ? 1 : activeWars.length > 0 ? 0.25 : 0;
      const securityDilemma = advanced.atomic.postures.some((other) => other.polityId !== posture.polityId && other.weaponizedMonth !== undefined) ? 1 : 0;
      const driver = rivalry * 0.3 + activeWar * 0.24 + securityDilemma * 0.18 + polity.riskTolerance * 0.12 + polity.scientificCapacity * 0.12 + advanced.developmentPriorities.defense * 0.08;
      const restraint = advanced.governance.coordination * 0.16 + polity.publicTrust * 0.08 + (1 - polity.riskTolerance) * 0.1 + advanced.developmentPriorities.welfare * 0.1 + advanced.institutions.filter((institution) => institution.kind === 'atomic-regulator').reduce((sum, institution) => sum + institution.reliability * 0.07, 0);
      // Weapon programs advance only where political/scientific drivers overcome restraint.
      // High rivalry or an active war can cross the threshold; peaceful, well-regulated states usually do not.
      posture.programLevel = clamp(posture.programLevel + (driver - restraint - 0.02) * 0.035 * this.config.advanced.developmentRate);
      posture.warningReliability += (clamp(advanced.sectors.information * 0.48 + advanced.sectors.aerospace * 0.22 + polity.institutionalCapacity * 0.3) - posture.warningReliability) * 0.06;
      posture.commandControlReliability += (clamp(polity.institutionalCapacity * 0.52 + advanced.sectors.information * 0.28 + (1 - advanced.governance.fragmentation) * 0.2) - posture.commandControlReliability) * 0.06;
      posture.survivability += (clamp(advanced.sectors.defense * 0.4 + advanced.sectors.aerospace * 0.25 + posture.arsenalScale * 0.2 + advanced.sectors.information * 0.15) - posture.survivability) * 0.05;
      posture.riskTolerance = polity.riskTolerance;
      posture.doctrine = this.doctrineFor(posture);
      if (posture.weaponizedMonth === undefined && posture.programLevel >= 0.62 && advanced.atomic.applications.research >= 0.48) {
        posture.weaponizedMonth = state.month;
        posture.arsenalScale = 0.04;
        state.stats.nuclearWeaponsStates += 1;
        advanced.lastMajorCapabilityMonth = state.month;
        events.push(this.event(state, 'nuclear-weapons-developed', 'One state has converted atomic knowledge into a strategic arsenal.', {
          actors: [posture.polityId], causes: ['atomic-knowledge', rivalry >= 0.5 ? 'interstate-rivalry' : 'security-doctrine', ...(activeWar ? ['active-war'] : [])],
          context: { polityId: posture.polityId, programLevel: posture.programLevel, doctrine: posture.doctrine }, magnitude: 0.9, significance: 0.96, tags: ['atomic', 'weaponry', 'strategic-risk'],
        }));
      }
      if (posture.weaponizedMonth !== undefined) {
        const growth = clamp(0.008 + rivalry * 0.018 + securityDilemma * 0.012 - advanced.governance.coordination * 0.014 - restraint * 0.01, -0.025, 0.035);
        posture.arsenalScale = clamp(posture.arsenalScale + growth);
      }
    }
    advanced.atomic.applications.weaponry = mean(advanced.atomic.postures.map((posture) => Math.max(posture.programLevel, posture.arsenalScale)));
    const armed = advanced.atomic.postures.filter((posture) => posture.weaponizedMonth !== undefined && posture.arsenalScale > 0.015);
    const rivalry = mean(advanced.states.map((item) => item.militaryPressure));
    const targetCrisis = clamp(rivalry * 0.46 + advanced.governance.fragmentation * 0.22 + (state.wars.some((war) => war.active) ? 0.3 : 0) + armed.length * 0.035 - advanced.governance.coordination * 0.18);
    advanced.strategic.crisisIntensity += (targetCrisis - advanced.strategic.crisisIntensity) * 0.1;
    const priorPhase = advanced.strategic.phase;
    if (armed.length === 0) advanced.strategic.phase = armedAtStart > 0 ? 'disarmament' : 'none';
    else if (armed.length === 1) advanced.strategic.phase = 'atomic-monopoly';
    else if (advanced.strategic.crisisIntensity >= 0.68) advanced.strategic.phase = 'crisis';
    else if (advanced.governance.coordination >= 0.62 && rivalry < 0.42) advanced.strategic.phase = 'negotiated-restraint';
    else if (rivalry >= 0.48 || mean(armed.map((posture) => posture.arsenalScale)) < 0.42) advanced.strategic.phase = 'arms-competition';
    else advanced.strategic.phase = 'stable-deterrence';
    if (advanced.strategic.phase === 'arms-competition' || advanced.strategic.phase === 'crisis') advanced.strategic.armsCompetitionYears += 1;
    if (advanced.strategic.phase === 'negotiated-restraint' || advanced.strategic.phase === 'disarmament') advanced.strategic.restraintYears += 1;
    if (priorPhase !== advanced.strategic.phase && advanced.strategic.phase === 'negotiated-restraint') events.push(this.event(state, 'nuclear-restraint', 'Nuclear states establish verifiable limits and communication channels.', { causes: ['institutional-coordination', 'mutual-vulnerability'], magnitude: 0.62, significance: 0.76, tags: ['atomic', 'restraint'] }));
    if (priorPhase !== advanced.strategic.phase && advanced.strategic.phase === 'crisis') events.push(this.event(state, 'nuclear-crisis', 'Competing nuclear forces enter a period of acute strategic danger.', { causes: ['hostility', 'security-dilemma', 'crisis-instability'], magnitude: 0.82, significance: 0.9, tags: ['atomic', 'crisis'] }));
    if (armedAtStart > 0 && armed.length === 0 && !this.hasEvent(state, 'nuclear-disarmament')) events.push(this.event(state, 'nuclear-disarmament', 'Operational nuclear arsenals have been dismantled.', { causes: ['negotiated-restraint', 'institutional-control'], magnitude: 0.72, significance: 0.84, tags: ['atomic', 'disarmament'] }));
    return events;
  }

  private updateMachineIntelligence(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    const machinePriority = advanced.developmentPriorities.machine;
    const target = clamp((this.knowledge(state, 'machine-intelligence') * 0.62 + this.knowledge(state, 'general-machine-systems') * 0.38) * (0.35 + machinePriority * 0.9));
    advanced.machine.capability += (target - advanced.machine.capability) * 0.06;
    const capability = advanced.machine.capability;
    advanced.machine.scienceIntegration += (capability * advanced.sectors.science - advanced.machine.scienceIntegration) * 0.05;
    advanced.machine.economicAutomation += (capability * mean([advanced.sectors.industry, advanced.sectors.automation]) - advanced.machine.economicAutomation) * 0.05;
    advanced.machine.governanceIntegration += (capability * advanced.governance.institutionalCapacity * advanced.governance.coordination - advanced.machine.governanceIntegration) * 0.045;
    advanced.machine.militaryAutonomy += (capability * advanced.sectors.defense * (0.45 + advanced.governance.fragmentation * 0.55) - advanced.machine.militaryAutonomy) * 0.055;
    const regulator = advanced.institutions.find((institution) => institution.kind === 'machine-governance-body');
    const alignmentTarget = clamp(advanced.governance.institutionalCapacity * 0.34 + advanced.governance.coordination * 0.26 + (regulator?.reliability ?? 0) * 0.28 + advanced.sectors.science * 0.12 - advanced.machine.militaryAutonomy * 0.2);
    advanced.machine.alignmentReliability += (alignmentTarget - advanced.machine.alignmentReliability) * 0.045;
    if (capability >= 0.22 && !this.hasEvent(state, 'machine-intelligence-transition')) {
      advanced.lastMajorCapabilityMonth = state.month;
      events.push(this.event(state, 'machine-intelligence-transition', 'Machine systems now contribute materially to science, production, and institutional decisions.', { causes: ['computation', 'automation', 'institutional-deployment'], context: { capability, militaryAutonomy: advanced.machine.militaryAutonomy, alignmentReliability: advanced.machine.alignmentReliability }, magnitude: 0.76, significance: 0.84, tags: ['machine-intelligence', 'dual-use'] }));
    }
    const postBiologicalConditions = machinePriority >= 0.55 && capability >= 0.82 && advanced.machine.economicAutomation >= 0.68 && advanced.machine.scienceIntegration >= 0.58 && advanced.machine.governanceIntegration >= 0.36 && advanced.machine.alignmentReliability >= 0.5;
    if (postBiologicalConditions) advanced.cohorts.biologicalShare = clamp(advanced.cohorts.biologicalShare - Math.max(0.001, (machinePriority - 0.56) * 0.035));
    else advanced.cohorts.biologicalShare += (1 - advanced.cohorts.biologicalShare) * 0.002;
    if (capability >= 0.76 && advanced.machine.economicAutomation >= 0.62 && advanced.fermi.securityCaution >= 0.45) advanced.machine.observability = clamp(advanced.machine.observability - 0.012);
    else advanced.machine.observability += (1 - advanced.machine.observability) * 0.004;
    if (advanced.cohorts.biologicalShare <= 0.38 && !this.hasEvent(state, 'post-biological-transition')) {
      state.stats.postBiologicalTransitions += 1;
      advanced.lastMajorCapabilityMonth = state.month;
      events.push(this.event(state, 'post-biological-transition', 'Most durable intelligence and economic activity no longer depends on conventional biological population.', { causes: ['general-machine-systems', 'economic-automation', 'institutional-integration'], context: { biologicalShare: advanced.cohorts.biologicalShare, alignmentReliability: advanced.machine.alignmentReliability }, magnitude: 0.95, significance: 0.98, tags: ['machine-intelligence', 'post-biological'] }));
    }
    return events;
  }

  private updateSpace(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    const satellite = this.knowledge(state, 'satellite-systems');
    const orbital = this.knowledge(state, 'orbital-capability');
    const interplanetary = this.knowledge(state, 'interplanetary-capability');
    const resources = this.knowledge(state, 'space-resource-industry');
    const spacePriority = advanced.developmentPriorities.space;
    const investment = clamp(0.06 + spacePriority * 0.32 + advanced.fermi.spaceInvestment * 0.24 + advanced.governance.coordination * 0.18 + advanced.sectors.science * 0.12 + advanced.sectors.industry * 0.08);
    advanced.space.satellites += (satellite * investment - advanced.space.satellites) * 0.04;
    advanced.space.orbitalInfrastructure += (orbital * investment - advanced.space.orbitalInfrastructure) * 0.026;
    advanced.space.lunarActivity += (interplanetary * investment - advanced.space.lunarActivity) * 0.018;
    advanced.space.resourceActivity += (resources * mean([investment, advanced.sectors.automation]) - advanced.space.resourceActivity) * 0.018;
    if (advanced.space.satellites >= 0.08 && !this.hasEvent(state, 'first-orbit')) {
      state.stats.firstOrbits += 1;
      advanced.lastMajorCapabilityMonth = state.month;
      events.push(this.event(state, 'first-orbit', 'An artificial instrument completes a sustained orbit of the home world.', { causes: ['rocketry', 'computation', 'scientific-institutions'], magnitude: 0.84, significance: 0.92, tags: ['space', 'orbit', 'threshold'] }));
    }
    if (spacePriority >= 0.52 && investment >= 0.48 && advanced.space.lunarActivity >= 0.32 && advanced.space.offworldSettlements === 0) {
      advanced.space.offworldSettlements = 1;
      advanced.space.interplanetaryPopulation = Math.max(24, representedPopulation(state) * 0.000002);
      state.stats.offworldSettlements += 1;
      advanced.lastMajorCapabilityMonth = state.month;
      events.push(this.event(state, 'offworld-settlement', 'A continuously occupied settlement is established beyond the home world.', { causes: ['orbital-capability', 'interplanetary-transport', 'sustained-investment'], context: { offworldPopulation: Math.round(advanced.space.interplanetaryPopulation) }, magnitude: 0.9, significance: 0.96, tags: ['space', 'settlement', 'threshold'] }));
    }
    if (advanced.space.offworldSettlements > 0) {
      const annualGrowth = 0.035 + interplanetary * 0.05 + advanced.space.resourceActivity * 0.04;
      const carryingShare = clamp(0.00002 + advanced.space.resourceActivity * 0.18 + advanced.space.lunarActivity * 0.04, 0.00002, 0.32);
      const carryingCapacity = Math.max(1_000, advanced.peakRepresentedPopulation * carryingShare);
      const logistic = clamp(1 - advanced.space.interplanetaryPopulation / carryingCapacity, -0.12, 1);
      advanced.space.interplanetaryPopulation = Math.max(24, advanced.space.interplanetaryPopulation * (1 + annualGrowth * logistic));
      if (spacePriority >= 0.54 && investment >= 0.5 && advanced.space.interplanetaryPopulation >= Math.max(1_000, representedPopulation(state) * 0.00003) && advanced.space.orbitalInfrastructure >= 0.38 && advanced.space.resourceActivity >= 0.17 && advanced.space.selfSustainingBodies < 2) {
        advanced.space.selfSustainingBodies = 2;
        state.stats.interplanetaryTransitions += 1;
        advanced.lastMajorCapabilityMonth = state.month;
        events.push(this.event(state, 'interplanetary-transition', 'A second planetary population can now maintain life-support, industry, and reproduction without continuous supply from the home world.', { causes: ['offworld-settlement', 'closed-life-support', 'space-resource-industry'], context: { offworldPopulation: Math.round(advanced.space.interplanetaryPopulation), selfSustainingBodies: 2 }, magnitude: 1, significance: 1, tags: ['space', 'interplanetary', 'resilience'] }));
      }
    }
    return events;
  }

  private updateFermiQuestion(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    const astronomy = mean([this.knowledge(state, 'celestial-navigation'), this.knowledge(state, 'scientific-method'), this.knowledge(state, 'satellite-systems')]);
    const communication = mean([this.knowledge(state, 'mass-communication'), this.knowledge(state, 'computation')]);
    if (astronomy >= 0.5 && communication >= 0.46 && advanced.fermi.recognizedMonth === undefined) {
      advanced.fermi.recognizedMonth = state.month;
      const militarism = mean(state.cultures.map((culture) => culture.dimensions.militarism));
      const curiosity = mean(state.cultures.map((culture) => culture.dimensions.curiosity));
      const hierarchy = mean(state.cultures.map((culture) => culture.dimensions.hierarchy));
      const scores: Array<[FermiHypothesis, number]> = [
        ['intelligent-life-rare', 0.35 + advanced.sectors.science * 0.35],
        ['self-destruction', 0.18 + militarism * 0.42 + advanced.strategic.crisisIntensity * 0.35],
        ['interstellar-travel-impractical', 0.28 + (1 - advanced.sectors.aerospace) * 0.34],
        ['advanced-civilizations-quiet', 0.16 + advanced.machine.capability * 0.28 + advanced.fermi.securityCaution * 0.2],
        ['civilization-is-early', 0.2 + curiosity * 0.38],
        ['observers-remain-hidden', 0.12 + hierarchy * 0.28 + advanced.governance.fragmentation * 0.2],
      ];
      while (advanced.fermi.hypotheses.length < (curiosity > 0.62 ? 3 : 2) && scores.length > 0) {
        const index = this.random.weightedIndex(scores.map((entry) => entry[1]));
        const selected = scores.splice(index, 1)[0];
        if (selected) advanced.fermi.hypotheses.push(selected[0]);
      }
      advanced.fermi.setiInvestment = clamp(curiosity * 0.52 + advanced.sectors.science * 0.28 + advanced.governance.coordination * 0.2);
      advanced.fermi.broadcasting = clamp(mean(state.cultures.map((culture) => culture.dimensions.outsiderOpenness)) * 0.55 + curiosity * 0.25 - militarism * 0.18);
      advanced.fermi.securityCaution = clamp(militarism * 0.38 + advanced.governance.fragmentation * 0.24 + (advanced.fermi.hypotheses.includes('advanced-civilizations-quiet') ? 0.26 : 0));
      advanced.fermi.spaceInvestment = clamp(curiosity * 0.3 + advanced.sectors.science * 0.28 + (advanced.fermi.hypotheses.includes('interstellar-travel-impractical') ? -0.12 : 0.18) + advanced.fermi.securityCaution * 0.12);
      events.push(this.event(state, 'fermi-question', 'Astronomers and communication networks find no unambiguous evidence of another technological civilization.', { causes: ['astronomy', 'mass-communication', 'absence-of-detected-signals'], context: { hypotheses: advanced.fermi.hypotheses.join(','), setiInvestment: advanced.fermi.setiInvestment, broadcasting: advanced.fermi.broadcasting }, magnitude: 0.62, significance: 0.8, tags: ['fermi', 'astronomy', 'belief'] }));
      for (const hypothesis of advanced.fermi.hypotheses) events.push(this.event(state, 'fermi-hypothesis', `Scientific and political institutions debate the ${hypothesis.replaceAll('-', ' ')} hypothesis.`, { causes: ['fermi-question', 'institutional-interpretation'], context: { hypothesis, authoritativeTruth: false }, magnitude: 0.42, significance: 0.56, tags: ['fermi', 'belief', hypothesis] }));
    }
    return events;
  }

  private updateEnvironment(state: SimulationState): void {
    const advanced = state.advanced;
    const pollution = mean(state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.pollution));
    const fossilTransport = this.knowledge(state, 'internal-combustion');
    const lowCarbon = advanced.atomic.applications.energy;
    const emissionsTarget = clamp(advanced.sectors.industry * 0.54 + fossilTransport * 0.28 + advanced.sectors.energy * 0.18 - lowCarbon * 0.38 - advanced.space.resourceActivity * 0.08);
    advanced.environment.emissions += (emissionsTarget - advanced.environment.emissions) * 0.06;
    advanced.environment.climateStress = clamp(advanced.environment.climateStress + advanced.environment.emissions * 0.0028 - lowCarbon * 0.0011 - advanced.governance.coordination * 0.00045);
    advanced.environment.ecologicalPressure += (clamp(pollution * 0.45 + advanced.environment.emissions * 0.35 + representedPopulation(state) / this.config.advanced.statisticalPopulationCap * 0.2) - advanced.environment.ecologicalPressure) * 0.055;
    advanced.environment.resourcePressure += (clamp(advanced.sectors.industry * 0.44 + representedPopulation(state) / this.config.advanced.statisticalPopulationCap * 0.26 - advanced.space.resourceActivity * 0.32 - advanced.sectors.automation * 0.08) - advanced.environment.resourcePressure) * 0.055;
  }

  private evaluateRisks(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const a = state.advanced;
    const offworldProtection = a.space.selfSustainingBodies >= 2 ? 0.72 : a.space.offworldSettlements > 0 ? 0.18 : 0;
    const setRisk = (kind: ExistentialRiskKind, hazard: number, vulnerability: number, mitigation: number, base: number): void => {
      const risk = a.risks[kind];
      risk.hazard = clamp(hazard);
      risk.vulnerability = clamp(vulnerability);
      risk.mitigation = clamp(mitigation);
      risk.annualProbability = clamp(risk.hazard * risk.vulnerability * (1 - risk.mitigation) * base * this.config.advanced.riskRate, 0, 0.2);
    };
    const armed = a.atomic.postures.filter((posture) => posture.weaponizedMonth !== undefined && posture.arsenalScale > 0.015);
    const activeConventionalWar = state.wars.some((war) => war.active);
    const nuclearHazard = armed.length >= 2
      ? mean([a.strategic.crisisIntensity, mean(a.states.map((item) => item.militaryPressure)), activeConventionalWar ? 1 : 0])
      : armed.length === 1 && activeConventionalWar
        ? mean([a.strategic.crisisIntensity, mean(a.states.map((item) => item.militaryPressure)), armed[0]?.riskTolerance ?? 0]) * 0.58
        : 0;
    const nuclearVulnerability = armed.length >= 2
      ? 1 - mean(armed.map((posture) => mean([posture.warningReliability, posture.commandControlReliability, posture.survivability])))
      : armed.length === 1
        ? (1 - (armed[0]?.commandControlReliability ?? 1)) * 0.55 + (armed[0]?.riskTolerance ?? 0) * 0.2
        : 0;
    setRisk('nuclear-conflict', nuclearHazard, nuclearVulnerability, a.governance.coordination * 0.5 + (a.strategic.phase === 'negotiated-restraint' ? 0.35 : 0), 0.045);
    setRisk('pandemic', 0.18 + a.sectors.biotechnology * (0.16 + a.governance.fragmentation * 0.35), clamp(0.58 + representedPopulation(state) / this.config.advanced.statisticalPopulationCap * 0.24), a.sectors.health * 0.55 + a.governance.coordination * 0.22 + offworldProtection * 0.2, 0.018);
    setRisk('ecological-overshoot', a.environment.ecologicalPressure, 0.45 + a.environment.resourcePressure * 0.35, a.governance.coordination * 0.28 + a.sectors.science * 0.18 + a.space.resourceActivity * 0.24, 0.035);
    setRisk('climate-destabilization', a.environment.climateStress, 0.5 + a.environment.ecologicalPressure * 0.28, a.atomic.applications.energy * 0.24 + a.governance.coordination * 0.28 + offworldProtection * 0.22, 0.032);
    setRisk('resource-stress', a.environment.resourcePressure, 0.4 + a.governance.fragmentation * 0.38, a.sectors.automation * 0.12 + a.space.resourceActivity * 0.42 + a.governance.coordination * 0.2, 0.03);
    setRisk('autonomous-weapons', a.machine.militaryAutonomy, a.governance.fragmentation * 0.44 + (1 - a.machine.alignmentReliability) * 0.46, a.governance.institutionalCapacity * 0.4 + a.machine.alignmentReliability * 0.35, 0.04);
    setRisk('machine-transition', a.machine.capability, (1 - a.machine.alignmentReliability) * 0.58 + a.machine.economicAutomation * 0.18, a.governance.institutionalCapacity * 0.35 + a.machine.governanceIntegration * 0.35, 0.025);
    setRisk('asteroid-impact', 0.28, 0.62, a.sectors.aerospace * 0.34 + a.sectors.science * 0.18 + offworldProtection * 0.48, 0.0008);
    setRisk('supervolcanism', 0.22, 0.68, a.sectors.health * 0.12 + a.governance.coordination * 0.2 + offworldProtection * 0.58, 0.0007);
    setRisk('political-fragmentation', a.governance.fragmentation, 0.4 + a.environment.resourcePressure * 0.25 + a.strategic.crisisIntensity * 0.22, a.governance.institutionalCapacity * 0.45 + a.governance.publicTrust * 0.22, 0.035);

    const nuclear = a.risks['nuclear-conflict'];
    if (nuclear.annualProbability > 0 && this.random.chance(nuclear.annualProbability)) events.push(...this.triggerNuclearUse(state, armed));
    const pandemic = a.risks.pandemic;
    if (this.canRepeatRisk(state, pandemic, 18) && this.random.chance(pandemic.annualProbability)) {
      this.markRisk(state, pandemic);
      const loss = clamp(0.015 + pandemic.vulnerability * 0.11 - pandemic.mitigation * 0.045, 0.006, 0.16);
      const populationBefore = representedPopulation(state);
      const affected = this.applyShock(state, loss, 0.08);
      const realizedMortalityFraction = populationBefore === 0 ? 0 : affected / populationBefore;
      state.stats.pandemics += 1;
      events.push(this.event(state, 'pandemic', 'A large disease outbreak tests public health, communication, and institutional coordination.', { causes: [a.sectors.biotechnology > 0.55 && a.governance.fragmentation > 0.5 ? 'dual-use-biotechnology' : 'natural-pathogen', 'population-connectivity'], context: { mortalityFraction: realizedMortalityFraction, healthMitigation: pandemic.mitigation }, affectedPopulation: affected, magnitude: clamp(realizedMortalityFraction * 4), significance: 0.78, tags: ['risk', 'pandemic'] }));
    }
    for (const [kind, eventType, threshold] of [['ecological-overshoot', 'ecological-crisis', 0.78], ['climate-destabilization', 'climate-crisis', 0.82], ['resource-stress', 'resource-crisis', 0.84]] as const) {
      const risk = a.risks[kind];
      if (risk.hazard >= threshold && !risk.active) {
        this.markRisk(state, risk);
        const loss = clamp((risk.hazard - threshold) * 0.2 + risk.vulnerability * 0.025, 0.01, 0.08);
        const affected = this.applyShock(state, loss, 0.06);
        events.push(this.event(state, eventType, `${kind.replaceAll('-', ' ')} has exceeded the capacity of existing mitigation systems.`, { causes: [kind, 'institutional-lag'], context: { hazard: risk.hazard, mitigation: risk.mitigation }, affectedPopulation: affected, magnitude: risk.hazard, significance: 0.82, tags: ['risk', kind] }));
      }
      if (risk.active && risk.hazard < threshold - 0.16) risk.active = false;
    }
    const autonomous = a.risks['autonomous-weapons'];
    if (this.canRepeatRisk(state, autonomous, 40) && this.random.chance(autonomous.annualProbability)) {
      this.markRisk(state, autonomous);
      a.governance.institutionalCapacity = clamp(a.governance.institutionalCapacity - 0.08 * autonomous.vulnerability);
      events.push(this.event(state, 'autonomous-weapons-crisis', 'Military automation outruns reliable political control during a strategic confrontation.', { causes: ['machine-military-integration', 'fragmented-command'], context: { militaryAutonomy: a.machine.militaryAutonomy, alignmentReliability: a.machine.alignmentReliability }, magnitude: 0.74, significance: 0.84, tags: ['risk', 'machine-intelligence', 'military'] }));
    }
    for (const kind of ['asteroid-impact', 'supervolcanism'] as const) {
      const risk = a.risks[kind];
      if (this.random.chance(risk.annualProbability)) {
        this.markRisk(state, risk);
        const loss = clamp((kind === 'asteroid-impact' ? 0.34 : 0.24) * risk.vulnerability, 0.025, offworldProtection > 0.5 ? 0.28 : 0.48);
        const populationBefore = representedPopulation(state);
        const affected = this.applyShock(state, loss, kind === 'asteroid-impact' ? 0.28 : 0.2);
        const realizedPopulationLossFraction = populationBefore === 0 ? 0 : affected / populationBefore;
        events.push(this.event(state, 'natural-catastrophe', `A ${kind.replaceAll('-', ' ')} causes a planetary emergency.`, { causes: [kind, 'natural-hazard'], context: { riskKind: kind, populationLossFraction: realizedPopulationLossFraction, offworldProtection }, affectedPopulation: affected, magnitude: 0.94, significance: 0.96, tags: ['risk', 'natural-hazard', kind] }));
      }
    }
    return events;
  }

  private triggerNuclearUse(state: SimulationState, armed: NuclearPosture[]): AdvancedEventDraft[] {
    const a = state.advanced;
    const risk = a.risks['nuclear-conflict'];
    this.markRisk(state, risk);
    const averageArsenal = mean(armed.map((posture) => posture.arsenalScale));
    const averageControl = mean(armed.map((posture) => posture.commandControlReliability));
    const major = armed.length >= 2 && a.strategic.crisisIntensity + averageArsenal - averageControl > 0.82 && this.random.chance(clamp(0.24 + a.strategic.crisisIntensity * 0.38 + averageArsenal * 0.2));
    const offworld = a.space.selfSustainingBodies >= 2;
    const loss = major ? clamp(0.16 + averageArsenal * 0.34 + a.strategic.crisisIntensity * 0.18, 0.16, offworld ? 0.58 : 0.78) : clamp(0.008 + averageArsenal * 0.035, 0.008, 0.07);
    const populationBefore = representedPopulation(state);
    const affected = this.applyShock(state, loss, major ? 0.48 : 0.08);
    const realizedPopulationLossFraction = populationBefore === 0 ? 0 : affected / populationBefore;
    a.atomic.nuclearUseCount += 1;
    state.stats.nuclearUses += 1;
    if (major) { a.atomic.majorExchangeCount += 1; state.stats.nuclearWars += 1; }
    for (const posture of armed) posture.arsenalScale = clamp(posture.arsenalScale - (major ? 0.34 : 0.08));
    const type: HistoricalEventType = major ? 'nuclear-exchange' : 'nuclear-use';
    return [this.event(state, type, major ? 'A major nuclear exchange destroys cities, infrastructure, and a large share of the planetary population.' : 'Nuclear weapons are used on a limited scale; wider exchange is avoided.', {
      causes: [a.strategic.phase === 'crisis' ? 'strategic-crisis' : 'accidental-escalation', averageControl < 0.45 ? 'unreliable-command-control' : 'deliberate-use'],
      context: { populationLossFraction: realizedPopulationLossFraction, averageArsenal, commandControlReliability: averageControl, offworldResilience: offworld },
      affectedPopulation: affected, magnitude: major ? 1 : 0.82, significance: major ? 1 : 0.94, tags: ['atomic', 'war', major ? 'major-exchange' : 'limited-use'],
    })];
  }

  private updateOutcome(state: SimulationState): AdvancedEventDraft[] {
    const events: AdvancedEventDraft[] = [];
    const advanced = state.advanced;
    const technology = mean([...Object.values(advanced.sectors).sort((a, b) => b - a).slice(0, 6)]);
    advanced.technologicalPeak = Math.max(advanced.technologicalPeak, technology);
    const populationLoss = advanced.peakRepresentedPopulation <= 0 ? 0 : 1 - advanced.representedPopulation / advanced.peakRepresentedPopulation;
    const degraded = (advanced.technologicalPeak > 0.42 && technology < advanced.technologicalPeak * 0.52) || (advanced.technologicalPeak > 0.48 && advanced.governance.institutionalCapacity < 0.2 && populationLoss > 0.48);
    advanced.collapseDurationMonths = degraded ? advanced.collapseDurationMonths + 12 : Math.max(0, advanced.collapseDurationMonths - 12);
    const maxRisk = Math.max(...RISK_KINDS.map((kind) => advanced.risks[kind].annualProbability));
    const resilience = clamp(mean([advanced.governance.coordination, advanced.governance.institutionalCapacity, advanced.sectors.health, advanced.sectors.energy, 1 - advanced.environment.climateStress, 1 - maxRisk * 5]));
    if (advanced.atomic.thresholdMonth !== undefined && resilience >= 0.58 && advanced.collapseDurationMonths === 0) advanced.resilientDurationMonths += 12;
    else advanced.resilientDurationMonths = Math.max(0, advanced.resilientDurationMonths - 6);
    const previous = advanced.outcome.classification;
    let classification: OutcomeClassification | null = null;
    let confidence = 0;
    let rationale: string[] = [];
    if (representedPopulation(state) === 0 && advanced.cohorts.biologicalShare > 0.38 && advanced.space.interplanetaryPopulation < 1) { classification = 'EXTINCT'; confidence = 1; rationale = ['no viable intelligent population remains']; }
    else if (advanced.cohorts.biologicalShare <= 0.38 && advanced.machine.capability >= 0.82) { classification = 'POST-BIOLOGICAL'; confidence = 0.86; rationale = ['most durable activity is machine-mediated', 'biological population is no longer the primary measure']; }
    else if (advanced.machine.observability <= 0.18 && advanced.machine.capability >= 0.76 && advanced.collapseDurationMonths === 0) { classification = 'UNKNOWN'; confidence = 0.7; rationale = ['conventional population measures are unreliable', 'transmissions declined without evidence of collapse']; }
    else if (advanced.space.selfSustainingBodies >= 2) { classification = 'INTERPLANETARY'; confidence = 0.94; rationale = ['self-sustaining populations exist on multiple planetary bodies']; }
    else if (advanced.collapseDurationMonths >= this.config.advanced.collapseSustainYears * 12) { classification = 'COLLAPSED'; confidence = 0.88; rationale = ['advanced capability and recoverability remained below their prior peak']; }
    else if (advanced.resilientDurationMonths >= this.config.advanced.planetaryStabilityYears * 12) { classification = 'PLANETARY STABLE'; confidence = 0.82; rationale = ['technological adolescence persisted with resilient planetary institutions']; }
    else if (technology >= 0.34 && state.month - advanced.lastMajorCapabilityMonth >= 300 * 12) { classification = 'STAGNANT'; confidence = 0.72; rationale = ['technological and institutional development remained in a long-lived equilibrium']; }
    advanced.outcome = { classification, ...(classification ? { classifiedMonth: previous === classification ? advanced.outcome.classifiedMonth ?? state.month : state.month } : {}), confidence, rationale };
    if (classification && classification !== previous) {
      if (classification === 'COLLAPSED') state.stats.civilizationCollapses += 1;
      const eventType: HistoricalEventType = classification === 'COLLAPSED' ? 'civilization-collapse' : classification === 'PLANETARY STABLE' ? 'planetary-stability' : classification === 'UNKNOWN' ? 'observation-lost' : 'outcome-classified';
      events.push(this.event(state, eventType, classification === 'UNKNOWN' ? 'Conventional population measures are no longer reliable. Large-scale transmissions have declined, with no corresponding collapse visible.' : `The current long-run classification is ${classification}.`, { causes: rationale, context: { classification, confidence }, magnitude: 0.88, significance: 0.96, tags: ['outcome', classification.toLowerCase().replaceAll(' ', '-')] }));
    }
    if (previous === 'COLLAPSED' && classification !== 'COLLAPSED' && classification !== 'EXTINCT') events.push(this.event(state, 'civilization-recovery', 'Sustained institutional and technological recovery has restored advanced capacity.', { causes: ['recoverability-restored'], magnitude: 0.76, significance: 0.86, tags: ['outcome', 'recovery'] }));
    return events;
  }

  private applyShock(state: SimulationState, populationLossFraction: number, infrastructureDamage: number): number {
    const advanced = state.advanced;
    const populationBefore = advanced.representedPopulation;
    const protection = advanced.space.selfSustainingBodies >= 2 ? 0.42 : advanced.space.offworldSettlements > 0 ? 0.1 : 0;
    const loss = clamp(populationLossFraction * (1 - protection), 0, advanced.space.selfSustainingBodies >= 2 ? 0.65 : 0.96);
    advanced.representedPopulation = Math.max(0, advanced.representedPopulation * (1 - loss));
    const living = state.people.filter((person) => person.alive);
    const minimumRepresentatives = advanced.representedPopulation >= 1_000 ? Math.min(24, living.length) : 0;
    const killCount = Math.min(living.length - minimumRepresentatives, Math.floor(living.length * loss * 0.62));
    for (let index = 0; index < killCount; index += 1) {
      const selected = living.splice(this.random.int(0, living.length), 1)[0];
      if (selected) { selected.alive = false; state.stats.deaths += 1; }
    }
    for (const settlement of state.settlements.filter((candidate) => candidate.alive)) {
      settlement.prosperity = clamp(settlement.prosperity - infrastructureDamage * 0.28);
      settlement.foodSecurity = clamp(settlement.foodSecurity - infrastructureDamage * 0.18);
      settlement.industry.intensity = clamp(settlement.industry.intensity - infrastructureDamage * 0.34);
      settlement.infrastructure.power = clamp(settlement.infrastructure.power - infrastructureDamage * 0.45);
      settlement.infrastructure.factories = clamp(settlement.infrastructure.factories - infrastructureDamage * 0.38);
      settlement.infrastructure.rail = clamp(settlement.infrastructure.rail - infrastructureDamage * 0.28);
    }
    return Math.max(0, Math.round(populationBefore - advanced.representedPopulation));
  }

  private markRisk(state: SimulationState, risk: ExistentialRiskPressure): void {
    risk.active = true;
    risk.lastEventMonth = state.month;
    state.stats.existentialRiskEvents += 1;
  }

  private canRepeatRisk(state: SimulationState, risk: ExistentialRiskPressure, quietYears: number): boolean {
    return risk.lastEventMonth === undefined || state.month - risk.lastEventMonth >= quietYears * 12;
  }

  private doctrineFor(posture: NuclearPosture): NuclearPosture['doctrine'] {
    if (posture.commandControlReliability >= 0.72 && posture.riskTolerance < 0.42) return 'no-first-use';
    if (posture.arsenalScale < 0.22) return 'minimum-deterrence';
    if (posture.riskTolerance >= 0.72 && posture.warningReliability < 0.55) return 'war-fighting';
    if (posture.riskTolerance >= 0.62 && posture.warningReliability >= 0.58) return 'launch-on-warning';
    return 'retaliatory';
  }

  private knowledge(state: SimulationState, id: string): number {
    const living = state.settlements.filter((settlement) => settlement.alive);
    if (living.length === 0) return 0;
    let peak = 0;
    let adopted = 0;
    for (const settlement of living) {
      const mastery = this.knowledgeAt(settlement, id);
      peak = Math.max(peak, mastery);
      const record = settlement.knowledge.records[id];
      if (record && !record.dormant && record.adoptedMonth !== undefined && mastery > 0.2) adopted += 1;
    }
    // Invention never instantly transforms the whole civilization: a capability counts at full
    // strength only once adoption has diffused across settlements, not when one laboratory peaks.
    return peak * (0.35 + 0.65 * (adopted / living.length));
  }

  private knowledgeAt(settlement: Settlement, id: string): number {
    const record = settlement.knowledge.records[id];
    return record && !record.dormant ? record.theory * 0.45 + record.practice * 0.55 : 0;
  }

  private hasEvent(state: SimulationState, type: HistoricalEventType): boolean {
    return state.history.some((event) => event.type === type);
  }

  private event(state: SimulationState, type: HistoricalEventType, summary: string, details: Omit<AdvancedEventDraft, 'type' | 'summary' | 'outcome'> & { outcome?: string } = {}): AdvancedEventDraft {
    const location = this.populationCenter(state);
    return {
      type, summary, outcome: details.outcome ?? summary,
      location, locationId: [...state.advanced.cities].sort((a, b) => b.population - a.population)[0]?.settlementId,
      actors: details.actors ?? state.polities.map((polity) => polity.id), causes: details.causes ?? [], context: details.context ?? {},
      affectedPopulation: details.affectedPopulation ?? representedPopulation(state), magnitude: details.magnitude ?? 0.6,
      significance: details.significance ?? 0.7, tags: details.tags ?? [],
    };
  }

  private populationCenter(state: SimulationState): Vec2 {
    const living = state.settlements.filter((settlement) => settlement.alive);
    const total = Math.max(1, living.reduce((sum, settlement) => sum + settlementRepresentedPopulation(state, settlement.id), 0));
    return {
      x: living.reduce((sum, settlement) => sum + settlement.position.x * settlementRepresentedPopulation(state, settlement.id), 0) / total,
      z: living.reduce((sum, settlement) => sum + settlement.position.z * settlementRepresentedPopulation(state, settlement.id), 0) / total,
    };
  }
}
