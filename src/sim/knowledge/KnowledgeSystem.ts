import type { GodboxConfig } from '../../config';
import type { SeededRandom } from '../prng';
import type {
  Culture,
  HistoricalEventType,
  InfrastructureState,
  IndustrialState,
  Institution,
  KnowledgeDomain,
  KnowledgePortfolio,
  KnowledgeRecord,
  Occupation,
  Person,
  Settlement,
  SimulationState,
  TradeRoute,
  Vec2,
  WorldCell,
} from '../types';
import { capabilityPractice, hasKnowledgeCapability } from './CapabilityContract';
import { KNOWLEDGE_BY_ID, KNOWLEDGE_CATALOG, type DiscoveryConditions, type KnowledgeDefinition, type KnowledgeNeed } from './catalog';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const mean = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export interface KnowledgeEventDraft {
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

const DOMAINS: readonly KnowledgeDomain[] = ['agriculture', 'materials', 'navigation', 'records', 'medicine', 'mechanics', 'energy', 'manufacturing', 'chemistry', 'transport', 'physics', 'computation', 'biology', 'aerospace'];

const DOMAIN_OCCUPATIONS: Record<KnowledgeDomain, readonly Occupation[]> = {
  agriculture: ['farmer', 'forager'],
  materials: ['artisan', 'forager'],
  navigation: ['carrier', 'keeper'],
  records: ['keeper', 'carrier'],
  medicine: ['keeper', 'elder'],
  mechanics: ['builder', 'artisan'],
  energy: ['artisan', 'builder'],
  manufacturing: ['artisan', 'builder'],
  chemistry: ['artisan', 'keeper'],
  transport: ['carrier', 'builder'],
  physics: ['keeper', 'artisan'],
  computation: ['keeper', 'artisan'],
  biology: ['keeper', 'elder'],
  aerospace: ['artisan', 'builder', 'carrier'],
};

export class KnowledgeSystem {
  private indexedState?: SimulationState;
  private readonly peopleBySettlement = new Map<string, Person[]>();
  private readonly institutionsBySettlement = new Map<string, Institution[]>();
  private occupationCounts = new WeakMap<Person[], Map<Occupation, number>>();

  constructor(private readonly config: GodboxConfig, private readonly random: SeededRandom) {}

  createPortfolio(settlementId: string, culture: Culture, cell: WorldCell, month: number): KnowledgePortfolio {
    const experimentation = {} as Record<KnowledgeDomain, number>;
    for (const domain of DOMAINS) experimentation[domain] = this.random.range(0, 0.035) * (0.55 + culture.dimensions.curiosity);
    const portfolio: KnowledgePortfolio = { records: {}, lost: {}, experimentation, exposure: {}, literacy: 0, preservation: 0.08 };
    portfolio.records['fire-control'] = this.record('fire-control', settlementId, culture.id, month, 'inheritance', 0.24, 0.34);
    portfolio.records['stone-composites'] = this.record('stone-composites', settlementId, culture.id, month, 'inheritance', 0.14, 0.3);
    if (cell.fertility > 0.42 || this.random.chance(0.55)) {
      portfolio.records['seasonal-observation'] = this.record('seasonal-observation', settlementId, culture.id, month, 'inheritance', 0.24, 0.15);
    }
    return portfolio;
  }

  createInfrastructure(cell: WorldCell): InfrastructureState {
    return { roads: 0.03, ports: cell.coast ? 0.025 : 0, bridges: 0, workshops: 0.025, archives: 0, rail: 0, power: 0, factories: 0 };
  }

  createIndustry(): IndustrialState {
    return { active: false, intensity: 0, stage: 'pre-industrial', stageProgress: 0, route: [], vulnerableInputs: [] };
  }

  advanceMonth(state: SimulationState): void {
    this.refreshIndexes(state);
    for (const settlement of state.settlements.filter((candidate) => candidate.alive)) {
      const population = this.peopleAt(state, settlement.id).length;
      const durable = mastery(settlement, 'durable-records');
      const printing = mastery(settlement, 'printing');
      const knowledgeInstitution = this.institutionsAt(state, settlement.id).find((institution) => institution.kind === 'knowledge-keepers');
      settlement.knowledge.literacy = clamp(durable.practice * 0.62 + durable.theory * 0.18 + printing.practice * 0.42);
      settlement.knowledge.preservation = clamp(0.07 + settlement.knowledge.literacy * 0.5 + settlement.infrastructure.archives * 0.34 + (knowledgeInstitution?.prestige ?? 0) * 0.12);
      const populationDensity = population / Math.max(35, settlement.buildings * 18);
      const urbanTarget = clamp(populationDensity * 0.38 + settlement.infrastructure.workshops * 0.18 + settlement.industry.intensity * 0.52);
      settlement.urbanization += (urbanTarget - settlement.urbanization) * 0.012;
      settlement.pollution = clamp(settlement.pollution * 0.997 + settlement.industry.intensity * (0.0007 + settlement.infrastructure.factories * 0.00045));
      if (!settlement.industry.active) continue;
      const inputDemand = population * settlement.industry.intensity * 0.0028;
      const mineralInput = Math.min(settlement.resources.minerals, inputDemand);
      const fuelInput = Math.min(settlement.resources.wood, inputDemand * 1.25);
      settlement.resources.minerals -= mineralInput;
      settlement.resources.wood -= fuelInput;
      settlement.resources.goods += mineralInput * (1.4 + settlement.infrastructure.factories * 1.8);
      settlement.resources.wealth += mineralInput * (0.3 + settlement.infrastructure.factories * 0.42);
      const supplied = inputDemand <= 0 ? 1 : clamp((mineralInput + fuelInput * 0.5) / (inputDemand * 1.5));
      const institutionalSupport = mean(this.institutionsAt(state, settlement.id).map((institution) => institution.support));
      const target = clamp(supplied * 0.42 + settlement.infrastructure.factories * 0.32 + institutionalSupport * 0.16 + settlement.foodSecurity * 0.1);
      settlement.industry.intensity = clamp(settlement.industry.intensity + (target - settlement.industry.intensity) * 0.008 - (settlement.foodSecurity < 0.2 ? 0.004 : 0));
    }
  }

  advanceYear(state: SimulationState): KnowledgeEventDraft[] {
    this.refreshIndexes(state);
    const events: KnowledgeEventDraft[] = [];
    for (const settlement of state.settlements.filter((candidate) => candidate.alive)) {
      this.accumulateExperimentation(state, settlement);
      events.push(...this.practiceAndForget(state, settlement));
      events.push(...this.attemptDiscoveries(state, settlement));
      events.push(...this.buildInfrastructure(state, settlement));
      events.push(...this.advanceIndustrialization(state, settlement));
      const industrialization = this.assessIndustrialization(state, settlement);
      if (industrialization) events.push(industrialization);
    }
    return events;
  }

  diffuseTrade(state: SimulationState, a: Settlement, b: Settlement, route: TradeRoute): KnowledgeEventDraft[] {
    const events: KnowledgeEventDraft[] = [];
    const candidates = [
      ...this.transmissionCandidates(a, b).map((id) => ({ id, source: a, target: b })),
      ...this.transmissionCandidates(b, a).map((id) => ({ id, source: b, target: a })),
    ].slice(0, 3);
    let totalFlow = 0;
    for (const candidate of candidates) {
      const sourceRecord = candidate.source.knowledge.records[candidate.id];
      if (!sourceRecord) continue;
      const communication = 1 + candidate.source.knowledge.literacy * 0.85 + candidate.target.knowledge.literacy * 0.55 + mastery(candidate.source, 'printing').practice * 0.75 + candidate.source.industry.intensity * 0.5;
      const flow = (0.0012 + route.volume * 0.0018) * communication * this.config.knowledge.diffusionRate;
      totalFlow += flow;
      const event = this.expose(state, candidate.target, candidate.source, sourceRecord, flow, 'persistent-trade');
      if (event) {
        events.push(event);
        state.stats.knowledgeExchanges += 1;
      }
    }
    route.knowledgeFlow = route.knowledgeFlow * 0.82 + totalFlow * 0.18;
    route.cumulativeKnowledge += totalFlow;
    return events;
  }

  diffuseMigration(state: SimulationState, source: Settlement, target: Settlement, movers: number): KnowledgeEventDraft[] {
    this.refreshIndexes(state);
    const populationShare = clamp(movers / Math.max(8, this.peopleAt(state, source.id).length));
    const events: KnowledgeEventDraft[] = [];
    const records = Object.values(source.knowledge.records).sort((a, b) => (b.theory + b.practice) - (a.theory + a.practice)).slice(0, Math.max(1, Math.ceil(movers / 3)));
    for (const record of records) {
      const event = this.expose(state, target, source, record, populationShare * (0.045 + source.knowledge.literacy * 0.04), 'migration');
      if (event) {
        events.push(event);
        state.stats.knowledgeExchanges += 1;
      }
    }
    return events;
  }

  diffuseConquest(state: SimulationState, winner: Settlement, loser: Settlement): KnowledgeEventDraft[] {
    const events: KnowledgeEventDraft[] = [];
    for (const record of Object.values(loser.knowledge.records).sort((a, b) => b.practice - a.practice).slice(0, 4)) {
      const event = this.expose(state, winner, loser, record, 0.065 + winner.knowledge.literacy * 0.04, 'conquest');
      if (event) {
        events.push(event);
        state.stats.knowledgeExchanges += 1;
      }
    }
    return events;
  }

  damageArchives(state: SimulationState, settlement: Settlement, severity: number, reason: string): KnowledgeEventDraft[] {
    this.refreshIndexes(state);
    if (settlement.infrastructure.archives <= 0) return [];
    const events: KnowledgeEventDraft[] = [];
    const previous = settlement.infrastructure.archives;
    settlement.infrastructure.archives = clamp(previous - severity * 0.55);
    settlement.knowledge.preservation = clamp(settlement.knowledge.preservation - severity * 0.24);
    if (previous > 0.12 && settlement.infrastructure.archives < previous * 0.62) {
      events.push({
        type: 'archive-destroyed', location: settlement.position, locationId: settlement.id, actors: [settlement.id], causes: [reason],
        context: { archiveBefore: previous, archiveAfter: settlement.infrastructure.archives }, outcome: 'Records and trained custodians were lost.',
        affectedPopulation: this.peopleAt(state, settlement.id).length, magnitude: severity, significance: 0.78,
        tags: ['knowledge', 'archive', 'loss'], summary: `Part of ${settlement.name}'s archive is destroyed.`,
      });
    }
    const vulnerable = Object.values(settlement.knowledge.records).filter((record) => {
      const definition = KNOWLEDGE_BY_ID.get(record.id);
      return definition && definition.difficulty > 0.52 && this.random.chance(severity * (1 - settlement.knowledge.preservation) * 0.34);
    });
    for (const record of vulnerable) {
      const definition = KNOWLEDGE_BY_ID.get(record.id);
      if (!definition) continue;
      record.theory = clamp(record.theory - severity * this.random.range(0.08, 0.22));
      record.practice = clamp(record.practice - severity * this.random.range(0.04, 0.13));
      if (definition.kind !== 'understanding' && !record.dormant && record.practice < 0.065) {
        record.dormant = true;
        state.stats.knowledgeLost += 1;
        events.push(this.lossEvent(state, settlement, definition, record, reason));
      }
    }
    return events;
  }

  retrospectiveLabel(settlement: Settlement): string {
    if (capabilityPractice(settlement, 'interplanetary-capability', 'transformed') > 0.42) return 'interplanetary systems center';
    if (capabilityPractice(settlement, 'orbital-capability', 'transformed') > 0.42) return 'orbital-capable center';
    if (capabilityPractice(settlement, 'nuclear-fission', 'transformed') > 0.32 || capabilityPractice(settlement, 'machine-intelligence', 'transformed') > 0.32) return 'advanced scientific center';
    if (settlement.industry.active) return settlement.industry.intensity > 0.55 ? 'industrial center' : 'early industrial center';
    if (practical(settlement, 'mechanical-power') > 0.35 || practical(settlement, 'industrial-chemistry') > 0.35) return 'mechanized workshop society';
    if (settlement.knowledge.literacy > 0.32 && practical(settlement, 'agrarian-surplus') > 0.3) return 'literate agrarian network';
    if (settlement.infrastructure.workshops > 0.25) return 'specialized workshop settlement';
    return 'household production settlement';
  }

  militaryApplication(settlement: Settlement): number {
    return clamp(
      practical(settlement, 'iron-working') * 0.24
      + practical(settlement, 'precision-tools') * 0.16
      + practical(settlement, 'mechanical-power') * 0.22
      + capabilityPractice(settlement, 'rail-transport', 'transformed') * 0.2
      + settlement.infrastructure.roads * 0.1
      + settlement.industry.intensity * 0.18
      + capabilityPractice(settlement, 'computation', 'transformed') * 0.12
      + capabilityPractice(settlement, 'automation', 'transformed') * 0.1,
    );
  }

  healthProtection(settlement: Settlement): number {
    return clamp(
      practical(settlement, 'anatomical-observation') * 0.08
      + practical(settlement, 'contagion-patterns') * 0.22
      + practical(settlement, 'vaccination') * 0.42
      + settlement.knowledge.literacy * 0.08
      + settlement.industry.intensity * 0.06
      + practical(settlement, 'modern-medicine') * 0.22
      + capabilityPractice(settlement, 'biotechnology', 'transformed') * 0.08,
      0,
      0.72,
    );
  }

  productionFactors(settlement: Settlement): { food: number; materials: number; goods: number; transport: number } {
    return {
      food: 1
        + practical(settlement, 'crop-selection') * 0.2
        + practical(settlement, 'irrigation') * 0.28
        + capabilityPractice(settlement, 'agrarian-surplus', 'transformed') * 0.38,
      materials: 1
        + practical(settlement, 'metal-smelting') * 0.2
        + practical(settlement, 'iron-working') * 0.28
        + settlement.industry.intensity * 0.55,
      goods: 1
        + practical(settlement, 'precision-tools') * 0.18
        + capabilityPractice(settlement, 'precision-manufacturing', 'transformed') * 0.8
        + capabilityPractice(settlement, 'industrial-chemistry', 'transformed') * 0.55
        + capabilityPractice(settlement, 'automation', 'transformed') * 0.72
        + settlement.industry.intensity,
      transport: 1
        + practical(settlement, 'improved-roads') * 0.35
        + practical(settlement, 'ocean-navigation') * 0.34
        + capabilityPractice(settlement, 'rail-transport', 'transformed') * 1.2
        + capabilityPractice(settlement, 'aviation', 'transformed') * 0.72,
    };
  }

  domainStrengths(settlement: Settlement): Array<{ domain: KnowledgeDomain; strength: number }> {
    return DOMAINS.map((domain) => {
      const records = Object.values(settlement.knowledge.records).filter((record) => KNOWLEDGE_BY_ID.get(record.id)?.domain === domain);
      return { domain, strength: mean(records.map((record) => record.theory * 0.45 + record.practice * 0.55)) };
    }).sort((a, b) => b.strength - a.strength);
  }

  canDiscover(state: SimulationState, settlement: Settlement, id: string): boolean {
    this.refreshIndexes(state);
    const definition = KNOWLEDGE_BY_ID.get(id);
    return Boolean(definition && !settlement.knowledge.records[id] && this.requirementsMet(state, settlement, definition.conditions));
  }

  /**
   * Per-year discovery probability. Prerequisites gate eligibility at partial familiarity; the
   * chance itself ramps from near-zero to the readiness-scaled base rate as mastery, surplus,
   * and supporting conditions mature, and stays negligible until the community has accumulated
   * real experimental mass in the domain. Time never appears here: only accumulated
   * conditions do.
   */
  discoveryChance(state: SimulationState, settlement: Settlement, id: string): number {
    if (this.indexedState !== state) this.refreshIndexes(state);
    const definition = KNOWLEDGE_BY_ID.get(id);
    if (!definition || settlement.knowledge.records[id]) return 0;
    if (!this.requirementsMet(state, settlement, definition.conditions)) return 0;
    const readiness = this.discoveryReadiness(state, settlement, definition);
    const maturity = this.prerequisiteMaturity(settlement, definition.conditions);
    const rediscovery = Boolean(settlement.knowledge.lost[id]);
    const ramp = 0.05 + 0.95 * Math.pow(maturity, 1.6);
    const insight = Math.pow(clamp(settlement.knowledge.experimentation[definition.domain] / Math.max(0.1, definition.difficulty * 3)), 2);
    return clamp(definition.baseChance * readiness * ramp * insight * this.config.knowledge.discoveryRate * (rediscovery ? 1.75 : 1), 0, 0.22);
  }

  /** Where a record sits on the path idea → experiment → local adoption → transformed. */
  adoptionStage(record: KnowledgeRecord): 'idea' | 'experiment' | 'local-adoption' | 'transformed' {
    if (record.transformedMonth !== undefined) return 'transformed';
    if (record.adoptedMonth !== undefined || record.source === 'inheritance') return 'local-adoption';
    const definition = KNOWLEDGE_BY_ID.get(record.id);
    const threshold = definition?.kind === 'understanding' ? this.config.historicalPace.adoptionTheory : this.config.historicalPace.adoptionPractice;
    const progress = (definition?.kind === 'understanding' ? record.theory : record.practice) / Math.max(0.01, threshold);
    return progress >= 0.45 ? 'experiment' : 'idea';
  }

  collapseSettlement(state: SimulationState, settlement: Settlement, reason: string): KnowledgeEventDraft[] {
    const events = this.damageArchives(state, settlement, 1, reason);
    for (const record of Object.values(settlement.knowledge.records)) {
      const definition = KNOWLEDGE_BY_ID.get(record.id);
      if (!definition || definition.kind === 'understanding' || record.dormant) continue;
      record.dormant = true;
      settlement.knowledge.lost[record.id] = {
        id: record.id,
        lostMonth: state.month,
        peakTheory: record.theory,
        peakPractice: record.practice,
        lineageId: record.lineageId,
        reason,
      };
      state.stats.knowledgeLost += 1;
      events.push(this.lossEvent(state, settlement, definition, record, reason));
    }
    return events;
  }

  private record(id: string, settlementId: string, cultureId: string, month: number, source: KnowledgeRecord['source'], theory: number, practiceLevel: number, parentLineages: string[] = [], person?: Person, institution?: Institution): KnowledgeRecord {
    return {
      id, theory, practice: practiceLevel, discoveredMonth: month, lastUsedMonth: month,
      originSettlementId: settlementId, lineageId: `${cultureId}:${settlementId}:${id}:${month}`,
      parentLineages, source, dormant: false,
      ...(person ? { attributedPersonId: person.id } : {}), ...(institution ? { institutionId: institution.id } : {}),
    };
  }

  private accumulateExperimentation(state: SimulationState, settlement: Settlement): void {
    const people = this.peopleAt(state, settlement.id);
    const culture = this.dominantCulture(state, settlement);
    const institutions = this.institutionsAt(state, settlement.id);
    const routes = state.tradeRoutes.filter((route) => route.active && route.transport?.path && (route.a === settlement.id || route.b === settlement.id)).length;
    for (const domain of DOMAINS) {
      const specialists = this.domainWorkers(people, domain);
      const institutionalSupport = institutions.filter((institution) => this.institutionSupportsDomain(institution, domain)).reduce((sum, institution) => sum + institution.support * institution.prestige, 0);
      const pressure = domain === 'agriculture' ? (1 - settlement.foodSecurity) + settlement.climateStress
        : domain === 'medicine' ? settlement.pollution + settlement.conflictPressure * 0.5
          : domain === 'transport' || domain === 'navigation' ? routes * 0.08
            : domain === 'materials' || domain === 'energy' ? settlement.conflictPressure * 0.35
              : domain === 'records' ? Math.max(0, people.length / 80 - 0.4) : 0;
      const gain = (specialists / Math.max(12, people.length) * 0.09 + institutionalSupport * 0.022 + (culture?.dimensions.curiosity ?? 0.5) * 0.012 + pressure * 0.018 + settlement.industry.intensity * 0.025) * (1 + settlement.knowledge.literacy * 0.55);
      settlement.knowledge.experimentation[domain] = Math.min(3, settlement.knowledge.experimentation[domain] * 0.985 + gain);
    }
  }

  private practiceAndForget(state: SimulationState, settlement: Settlement): KnowledgeEventDraft[] {
    const events: KnowledgeEventDraft[] = [];
    const people = this.peopleAt(state, settlement.id);
    const isolation = state.tradeRoutes.some((route) => route.active && route.transport?.path && (route.a === settlement.id || route.b === settlement.id)) ? 0 : 1;
    for (const record of Object.values(settlement.knowledge.records)) {
      const definition = KNOWLEDGE_BY_ID.get(record.id);
      if (!definition) continue;
      const use = this.domainWorkers(people, definition.domain) / Math.max(8, people.length) + this.conditionsPressure(state, settlement, definition.conditions) * 0.15;
      const communication = 1 + settlement.knowledge.literacy * 0.75 + mastery(settlement, 'printing').practice * 0.65;
      const institution = this.institutionsAt(state, settlement.id).find((candidate) => this.institutionSupportsDomain(candidate, definition.domain));
      if (use > 0.025 || institution) {
        const theoryGain = (definition.kind === 'understanding' ? 0.008 : 0.003) * (0.4 + use * 2 + (institution?.support ?? 0) * 0.45) * communication;
        const practiceGain = (definition.kind === 'understanding' ? 0.0025 : 0.007) * (0.45 + use * 2.4 + (institution?.prestige ?? 0) * 0.32);
        record.theory = clamp(record.theory + theoryGain);
        record.practice = clamp(record.practice + practiceGain);
        record.lastUsedMonth = state.month;
        if (record.dormant && record.practice >= 0.19) {
          record.dormant = false;
          state.stats.rediscoveries += 1;
          events.push(this.recoveryEvent(state, settlement, definition, record, 'renewed-practice'));
        }
        if (definition.major && record.adoptedMonth === undefined) {
          const adopted = definition.kind === 'understanding'
            ? record.theory >= this.config.historicalPace.adoptionTheory
            : record.practice >= this.config.historicalPace.adoptionPractice;
          if (adopted) {
            record.adoptedMonth = state.month;
            state.stats.knowledgeAdoptions += 1;
            events.push(this.adoptionEvent(state, settlement, definition, record));
          }
        }
        if (definition.major && definition.kind === 'capability' && record.adoptedMonth !== undefined && record.transformedMonth === undefined && record.practice >= this.config.historicalPace.transformationPractice) {
          const supportingInstitutions = this.institutionsAt(state, settlement.id).filter((candidate) => this.institutionSupportsDomain(candidate, definition.domain));
          const infrastructure = Math.max(settlement.infrastructure.workshops, settlement.infrastructure.archives, settlement.infrastructure.roads, settlement.infrastructure.ports, settlement.infrastructure.factories, settlement.infrastructure.power);
          const surplus = settlement.foodSecurity >= 0.52 && settlement.prosperity >= 0.42;
          if (supportingInstitutions.length > 0 && infrastructure >= 0.16 && surplus) {
            record.transformedMonth = state.month;
            state.stats.technologyTransformations += 1;
            events.push(this.transformationEvent(state, settlement, definition, record, supportingInstitutions));
          }
        }
      }
      const demographicRisk = people.length < 12 ? 0.055 : people.length < 24 ? 0.012 : 0;
      const specialistRisk = this.domainWorkers(people, definition.domain) === 0 ? 0.008 : 0;
      const disruption = demographicRisk + specialistRisk + settlement.conflictPressure * 0.015 + isolation * 0.002;
      const protection = settlement.knowledge.preservation * (definition.kind === 'understanding' ? 0.85 : 0.48);
      const decay = disruption * (1 - protection) * this.config.knowledge.lossRate;
      record.theory = clamp(record.theory - decay * 0.55);
      record.practice = clamp(record.practice - decay);
      if (definition.kind !== 'understanding' && !record.dormant && record.practice < 0.065) {
        record.dormant = true;
        state.stats.knowledgeLost += 1;
        events.push(this.lossEvent(state, settlement, definition, record, specialistRisk > demographicRisk ? 'specialists-disappeared' : demographicRisk > 0 ? 'demographic-collapse' : settlement.conflictPressure > 0.3 ? 'conflict-disruption' : 'prolonged-isolation'));
      }
      if (record.theory < 0.035 && record.practice < 0.035) {
        settlement.knowledge.lost[record.id] = { id: record.id, lostMonth: state.month, peakTheory: record.theory, peakPractice: record.practice, lineageId: record.lineageId, reason: 'living-memory-ended' };
        delete settlement.knowledge.records[record.id];
        if (!record.dormant) {
          state.stats.knowledgeLost += 1;
          events.push(this.lossEvent(state, settlement, definition, record, 'living-memory-ended'));
        }
      }
    }
    return events;
  }

  private attemptDiscoveries(state: SimulationState, settlement: Settlement): KnowledgeEventDraft[] {
    const events: KnowledgeEventDraft[] = [];
    const candidates = KNOWLEDGE_CATALOG.filter((definition) => !settlement.knowledge.records[definition.id] && this.requirementsMet(state, settlement, definition.conditions));
    candidates.sort((a, b) => this.discoveryReadiness(state, settlement, b) - this.discoveryReadiness(state, settlement, a));
    for (const definition of candidates.slice(0, 6)) {
      if (events.length >= 2) break;
      const rediscovery = Boolean(settlement.knowledge.lost[definition.id]);
      const chance = this.discoveryChance(state, settlement, definition.id);
      if (!this.random.chance(chance)) continue;
      const people = this.peopleAt(state, settlement.id);
      const possiblePeople = people.filter((person) => DOMAIN_OCCUPATIONS[definition.domain].includes(person.occupation)).sort((a, b) => (b.traits.curiosity + b.prestige) - (a.traits.curiosity + a.prestige));
      const attributed = definition.major && this.random.chance(0.58) ? possiblePeople[0] : undefined;
      const institution = this.institutionsAt(state, settlement.id).filter((candidate) => this.institutionSupportsDomain(candidate, definition.domain)).sort((a, b) => b.prestige - a.prestige)[0];
      const parentLineages = this.parentLineages(settlement, definition.conditions);
      const source: KnowledgeRecord['source'] = rediscovery ? 'rediscovery' : 'discovery';
      const record = this.record(definition.id, settlement.id, this.dominantCulture(state, settlement)?.id ?? 'mixed', state.month, source,
        definition.kind === 'understanding' ? 0.24 : 0.11, definition.kind === 'understanding' ? 0.07 : definition.kind === 'practice' ? 0.24 : 0.12,
        parentLineages, attributed, institution);
      settlement.knowledge.records[definition.id] = record;
      settlement.knowledge.experimentation[definition.domain] *= 0.38;
      delete settlement.knowledge.lost[definition.id];
      if (attributed) attributed.prestige = clamp(attributed.prestige + (definition.major ? 0.12 : 0.05));
      if (rediscovery) state.stats.rediscoveries += 1;
      else state.stats.discoveries += 1;
      events.push(rediscovery ? this.recoveryEvent(state, settlement, definition, record, 'new-experimentation') : this.discoveryEvent(state, settlement, definition, record));
    }
    return events;
  }

  private requirementsMet(state: SimulationState, settlement: Settlement, conditions: DiscoveryConditions): boolean {
    if (Object.entries(conditions.materials ?? {}).some(([id, amount]) => (settlement.materials[id] ?? 0) < amount)) return false;
    if (conditions.materialsAny && !Object.entries(conditions.materialsAny).some(([id, amount]) => (settlement.materials[id] ?? 0) >= amount)) return false;
    const people = this.peopleAt(state, settlement.id);
    const cell = state.world.cells[settlement.cellIndex];
    if ((conditions.minPopulation ?? 0) > people.length) return false;
    if ((conditions.minIndustrialIntensity ?? 0) > settlement.industry.intensity) return false;
    if ((conditions.minLiteracy ?? 0) > settlement.knowledge.literacy) return false;
    if (conditions.coastal && !cell?.coast) return false;
    if ((conditions.minFertility ?? 0) > (cell?.fertility ?? 0)) return false;
    if ((conditions.minFoodSecurity ?? 0) > settlement.foodSecurity) return false;
    if ((conditions.minProsperity ?? 0) > settlement.prosperity) return false;
    if ((conditions.minUrbanization ?? 0) > settlement.urbanization) return false;
    if ((conditions.minTradeRoutes ?? 0) > state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length) return false;
    for (const [key, level] of Object.entries(conditions.minInfrastructure ?? {})) {
      if (settlement.infrastructure[key as keyof InfrastructureState] < (level ?? 0)) return false;
    }
    for (const [resource, amount] of Object.entries(conditions.resources ?? {})) {
      if (settlement.resources[resource as keyof Settlement['resources']] < (amount ?? 0)) return false;
    }
    for (const [occupation, count] of Object.entries(conditions.occupations ?? {})) {
      if (this.occupationCount(people, occupation as Occupation) < (count ?? 0)) return false;
    }
    if (conditions.institutionsAny && !conditions.institutionsAny.some((kind) => this.institutionsAt(state, settlement.id).some((institution) => institution.kind === kind))) return false;
    if (conditions.foundations && !conditions.foundations.every((knowledgeNeed) => this.needProgress(settlement, knowledgeNeed) >= KnowledgeSystem.PREREQUISITE_FAMILIARITY)) return false;
    if (conditions.alternatives && !conditions.alternatives.some((path) => path.every((knowledgeNeed) => this.needProgress(settlement, knowledgeNeed) >= KnowledgeSystem.PREREQUISITE_FAMILIARITY))) return false;
    return true;
  }

  private static readonly PREREQUISITE_FAMILIARITY = 0.55;

  private needProgress(settlement: Settlement, knowledgeNeed: KnowledgeNeed): number {
    const record = settlement.knowledge.records[knowledgeNeed.id];
    if (!record || record.dormant) return 0;
    const theoryNeed = Math.max(0.01, knowledgeNeed.theory ?? 0);
    const practiceNeed = Math.max(0.01, knowledgeNeed.practice ?? 0);
    return clamp(Math.min(record.theory / theoryNeed, record.practice / practiceNeed));
  }

  private prerequisiteMaturity(settlement: Settlement, conditions: DiscoveryConditions): number {
    const foundationScore = conditions.foundations?.length
      ? Math.min(...conditions.foundations.map((knowledgeNeed) => this.needProgress(settlement, knowledgeNeed)))
      : 1;
    const alternativeScore = conditions.alternatives?.length
      ? Math.max(...conditions.alternatives.map((path) => Math.min(...path.map((knowledgeNeed) => this.needProgress(settlement, knowledgeNeed)))))
      : 1;
    return clamp((Math.min(foundationScore, alternativeScore) - KnowledgeSystem.PREREQUISITE_FAMILIARITY) / (1 - KnowledgeSystem.PREREQUISITE_FAMILIARITY));
  }

  private discoveryReadiness(state: SimulationState, settlement: Settlement, definition: KnowledgeDefinition): number {
    const people = this.peopleAt(state, settlement.id);
    const culture = this.dominantCulture(state, settlement);
    const experiment = settlement.knowledge.experimentation[definition.domain];
    const institutionSupport = this.institutionsAt(state, settlement.id).filter((institution) => this.institutionSupportsDomain(institution, definition.domain)).reduce((sum, institution) => sum + institution.support * 0.25 + institution.resources * 0.002, 0);
    const accumulated = Math.min(1.8, experiment / Math.max(0.1, definition.difficulty));
    const ordinaryPractice = this.domainWorkers(people, definition.domain) / Math.max(10, people.length) * 1.4;
    return 0.1 + (culture?.dimensions.curiosity ?? 0.5) * 0.34 + accumulated + institutionSupport + ordinaryPractice + this.conditionsPressure(state, settlement, definition.conditions) * 0.35 + settlement.industry.intensity * 0.35;
  }

  private conditionsPressure(state: SimulationState, settlement: Settlement, conditions: DiscoveryConditions): number {
    const people = this.peopleAt(state, settlement.id);
    const routes = state.tradeRoutes.filter((route) => route.active && route.transport?.path && (route.a === settlement.id || route.b === settlement.id)).length;
    switch (conditions.pressure) {
      case 'food': return clamp((1 - settlement.foodSecurity) + people.length / 180);
      case 'climate': return clamp(settlement.climateStress * 1.4 + (1 - settlement.foodSecurity) * 0.4);
      case 'conflict': return settlement.conflictPressure;
      case 'trade': return clamp(routes / 5);
      case 'administration': return clamp(people.length / 120 + settlement.institutionIds.length / 8);
      case 'labor': return clamp(people.length / 150 + settlement.urbanization * 0.5);
      default: return 0.15;
    }
  }

  private parentLineages(settlement: Settlement, conditions: DiscoveryConditions): string[] {
    const ids = [...(conditions.foundations ?? []).map((item) => item.id), ...(conditions.alternatives?.flat().map((item) => item.id) ?? [])];
    return [...new Set(ids.map((id) => settlement.knowledge.records[id]?.lineageId).filter((id): id is string => Boolean(id)))];
  }

  private buildInfrastructure(state: SimulationState, settlement: Settlement): KnowledgeEventDraft[] {
    const events: KnowledgeEventDraft[] = [];
    const cell = state.world.cells[settlement.cellIndex];
    const routeCount = state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
    const hasInstitution = (kind: Institution['kind']): boolean => this.institutionsAt(state, settlement.id).some((institution) => institution.kind === kind);
    const transformed = (id: string): number => capabilityPractice(settlement, id, 'transformed');
    const candidates: Array<{ key: keyof InfrastructureState; enabled: boolean; target: number; wood: number; minerals: number; goods: number; wealth: number; cause: string }> = [
      { key: 'workshops', enabled: practical(settlement, 'pottery-firing') > 0.22 || practical(settlement, 'metal-smelting') > 0.18, target: 0.35 + transformed('precision-manufacturing') * 0.65, wood: 5, minerals: 2, goods: 1, wealth: 2, cause: 'specialized-craft' },
      { key: 'archives', enabled: practical(settlement, 'durable-records') > 0.28 && (hasInstitution('knowledge-keepers') || hasInstitution('council')), target: 0.25 + practical(settlement, 'printing') * 0.7, wood: 6, minerals: 1, goods: 3, wealth: 4, cause: 'durable-records' },
      { key: 'roads', enabled: routeCount > 0 && practical(settlement, 'wheel-axle') > 0.22, target: 0.28 + transformed('improved-roads') * 0.72, wood: 8, minerals: 3, goods: 2, wealth: 3, cause: 'trade-volume' },
      { key: 'ports', enabled: Boolean(cell?.coast) && practical(settlement, 'buoyancy-currents') > 0.25, target: 0.2 + transformed('ocean-navigation') * 0.8, wood: 10, minerals: 2, goods: 2, wealth: 4, cause: 'maritime-trade' },
      { key: 'bridges', enabled: hasKnowledgeCapability(settlement, 'improved-roads', 'transformed') && routeCount > 1, target: 0.18 + transformed('improved-roads') * 0.62, wood: 9, minerals: 5, goods: 2, wealth: 4, cause: 'route-continuity' },
      { key: 'rail', enabled: hasKnowledgeCapability(settlement, 'rail-transport', 'transformed'), target: transformed('rail-transport'), wood: 8, minerals: 15, goods: 8, wealth: 10, cause: 'guided-powered-transport' },
      { key: 'power', enabled: hasKnowledgeCapability(settlement, 'electrical-generation', 'transformed'), target: transformed('electrical-generation'), wood: 5, minerals: 14, goods: 10, wealth: 12, cause: 'electrical-generation' },
      { key: 'factories', enabled: settlement.industry.active, target: 0.2 + settlement.industry.intensity * 0.8, wood: 9, minerals: 12, goods: 8, wealth: 11, cause: 'industrial-production' },
    ];
    const candidate = candidates.filter((item) => item.enabled && settlement.infrastructure[item.key] + 0.04 < item.target && settlement.resources.wood >= item.wood && settlement.resources.minerals >= item.minerals && settlement.resources.goods >= item.goods && settlement.resources.wealth >= item.wealth).sort((a, b) => (b.target - settlement.infrastructure[b.key]) - (a.target - settlement.infrastructure[a.key]))[0];
    if (!candidate) return events;
    const previous = settlement.infrastructure[candidate.key];
    settlement.resources.wood -= candidate.wood;
    settlement.resources.minerals -= candidate.minerals;
    settlement.resources.goods -= candidate.goods;
    settlement.resources.wealth -= candidate.wealth;
    settlement.infrastructure[candidate.key] = clamp(previous + this.config.historicalPace.infrastructureStep * this.random.range(0.88, 1.12));
    if (previous < 0.08 && settlement.infrastructure[candidate.key] >= 0.08) {
      events.push({
        type: 'infrastructure-built', location: settlement.position, locationId: settlement.id, actors: [settlement.id], causes: [candidate.cause, 'available-surplus'],
        context: { infrastructure: candidate.key, level: settlement.infrastructure[candidate.key], constructionYears: Math.max(1, Math.round(0.08 / this.config.historicalPace.infrastructureStep)) }, outcome: `${candidate.key} became a durable part of local life after sustained construction.`,
        affectedPopulation: this.peopleAt(state, settlement.id).length, magnitude: 0.55, significance: candidate.key === 'power' || candidate.key === 'rail' || candidate.key === 'factories' ? 0.78 : 0.58,
        tags: ['infrastructure', candidate.key], summary: `${settlement.name} establishes ${candidate.key}.`,
      });
    }
    return events;
  }

  private assessIndustrialization(state: SimulationState, settlement: Settlement): KnowledgeEventDraft | undefined {
    if (settlement.industry.stage !== 'pre-industrial') return undefined;
    const routes: Array<{ name: string; knowledge: string[]; met: boolean }> = [
      { name: 'metal-machine lineage', knowledge: ['mechanical-power', 'precision-manufacturing', 'iron-working'], met: practical(settlement, 'mechanical-power') >= 0.48 && practical(settlement, 'precision-manufacturing') >= 0.42 && practical(settlement, 'iron-working') >= 0.42 },
      { name: 'ceramic-chemical lineage', knowledge: ['mechanical-power', 'industrial-chemistry', 'high-temperature-ceramics'], met: practical(settlement, 'mechanical-power') >= 0.44 && practical(settlement, 'industrial-chemistry') >= 0.46 && practical(settlement, 'high-temperature-ceramics') >= 0.5 },
      { name: 'electrical workshop lineage', knowledge: ['electrical-generation', 'precision-manufacturing', 'improved-roads'], met: practical(settlement, 'electrical-generation') >= 0.42 && practical(settlement, 'precision-manufacturing') >= 0.38 && practical(settlement, 'improved-roads') >= 0.36 },
    ];
    const route = routes.find((candidate) => candidate.met);
    if (!route) return undefined;
    const people = this.peopleAt(state, settlement.id);
    const institutionalSupport = this.institutionsAt(state, settlement.id).filter((institution) => institution.kind === 'craft-circle' || institution.kind === 'merchant-association' || institution.kind === 'knowledge-keepers').reduce((sum, institution) => sum + institution.support * institution.prestige, 0);
    const transport = Math.max(settlement.infrastructure.roads, settlement.infrastructure.ports);
    const capital = settlement.resources.wealth / Math.max(25, people.length);
    const laborPressure = clamp(people.length / Math.max(55, settlement.buildings * 15));
    const enabled = people.length >= 58 && settlement.foodSecurity > 0.5 && settlement.infrastructure.workshops >= 0.34 && transport >= 0.2 && capital >= 0.25 && institutionalSupport >= 0.18;
    if (!enabled) return undefined;
    const readiness = clamp(settlement.infrastructure.workshops * 0.24 + transport * 0.14 + capital * 0.14 + institutionalSupport * 0.2 + settlement.urbanization * 0.14 + laborPressure * 0.14);
    if (!this.random.chance(0.055 * readiness / this.config.knowledge.industrializationDifficulty)) return undefined;
    settlement.industry = { active: false, intensity: 0.025, startedMonth: state.month, stage: 'experimental-engines', stageStartedMonth: state.month, stageProgress: 0, route: route.knowledge, routeName: route.name, vulnerableInputs: ['fuel', 'minerals', 'food-surplus', 'specialist-labor'] };
    return {
      type: 'industrialization-stage', location: settlement.position, locationId: settlement.id, actors: [settlement.id, ...this.institutionsAt(state, settlement.id).map((institution) => institution.id)],
      causes: [...route.knowledge, 'specialist-experimentation', 'capital-surplus'], context: { route: route.name, stage: settlement.industry.stage, population: people.length, literacy: settlement.knowledge.literacy, workshops: settlement.infrastructure.workshops, transport, capital },
      outcome: 'Specialists began testing concentrated power in working engines.', affectedPopulation: people.length,
      magnitude: 0.62, significance: 0.76, tags: ['industry', 'prototype', route.name], summary: `${settlement.name} begins sustained experiments through a ${route.name}.`,
    };
  }

  private advanceIndustrialization(state: SimulationState, settlement: Settlement): KnowledgeEventDraft[] {
    if (settlement.industry.stage === 'pre-industrial' || settlement.industry.stage === 'industrial-transformation') return [];
    if (settlement.urbanization < 0.3) {
      settlement.industry.stageProgress = Math.max(0, settlement.industry.stageProgress - 0.02);
      return [];
    }
    const people = this.peopleAt(state, settlement.id);
    const institutions = this.institutionsAt(state, settlement.id).filter((institution) => institution.kind === 'craft-circle' || institution.kind === 'merchant-association' || institution.kind === 'knowledge-keepers');
    const institutionalSupport = institutions.reduce((sum, institution) => sum + institution.support * institution.prestige, 0);
    const transport = Math.max(settlement.infrastructure.roads, settlement.infrastructure.ports, settlement.infrastructure.rail);
    const materialCapacity = mean(settlement.industry.route.map((id) => practical(settlement, id)));
    const surplus = clamp(settlement.foodSecurity * 0.45 + settlement.prosperity * 0.3 + Math.min(1, settlement.resources.wealth / Math.max(30, people.length)) * 0.25);
    const readiness = clamp(materialCapacity * 0.34 + institutionalSupport * 0.22 + transport * 0.18 + settlement.infrastructure.workshops * 0.16 + surplus * 0.1, 0.15, 1.2);
    settlement.industry.stageProgress += readiness / Math.max(1, this.config.historicalPace.industrialStageYears);
    settlement.industry.intensity = clamp(settlement.industry.intensity + (readiness * 0.14 - settlement.industry.intensity) * 0.045);
    if (settlement.industry.stageProgress < 1) return [];
    const sequence: IndustrialState['stage'][] = ['experimental-engines', 'specialist-workshops', 'commercial-machinery', 'transport-integration', 'industrial-transformation'];
    const next = sequence[sequence.indexOf(settlement.industry.stage) + 1];
    if (!next) return [];
    settlement.industry.stage = next;
    settlement.industry.stageStartedMonth = state.month;
    settlement.industry.stageProgress = 0;
    if (next === 'specialist-workshops') settlement.infrastructure.workshops = Math.max(settlement.infrastructure.workshops, 0.36);
    if (next === 'commercial-machinery') settlement.infrastructure.factories = Math.max(settlement.infrastructure.factories, 0.04);
    if (next === 'transport-integration') settlement.infrastructure.factories = Math.max(settlement.infrastructure.factories, 0.08);
    if (next === 'industrial-transformation') {
      settlement.industry.active = true;
      settlement.industry.intensity = Math.max(0.12, settlement.industry.intensity);
      state.stats.industrializations += 1;
      return [{
        type: 'industrialization', location: settlement.position, locationId: settlement.id, actors: [settlement.id, ...institutions.map((institution) => institution.id)],
        causes: [...settlement.industry.route, 'commercial-machinery', 'transport-integration', 'specialist-institutions'], context: { route: settlement.industry.routeName ?? 'unknown lineage', stage: next, developmentYears: Math.round((state.month - (settlement.industry.startedMonth ?? state.month)) / 12) },
        outcome: 'Machinery, transport, investment, and specialist labor now reorganize production across the city.', affectedPopulation: people.length,
        magnitude: 1, significance: 1, tags: ['industry', 'transformation'], summary: `${settlement.name}'s decades of mechanization become an industrial transformation.`,
      }];
    }
    const descriptions: Record<IndustrialState['stage'], string> = {
      'pre-industrial': 'Household and workshop production predominates.',
      'experimental-engines': 'Specialists test working engines.',
      'specialist-workshops': 'Dedicated workshops reproduce the machinery.',
      'commercial-machinery': 'Merchants finance machinery for regular production.',
      'transport-integration': 'Powered production connects to durable transport networks.',
      'industrial-transformation': 'Industrial production reshapes the city.',
    };
    return [{
      type: 'industrialization-stage', location: settlement.position, locationId: settlement.id, actors: [settlement.id, ...institutions.map((institution) => institution.id)],
      causes: [...settlement.industry.route, 'accumulated-capability', 'economic-surplus'], context: { stage: next, developmentYears: Math.round((state.month - (settlement.industry.startedMonth ?? state.month)) / 12) },
      outcome: descriptions[next], affectedPopulation: people.length, magnitude: 0.7, significance: 0.78,
      tags: ['industry', next], summary: `${settlement.name} enters the ${next.replaceAll('-', ' ')} stage.`,
    }];
  }

  private transmissionCandidates(source: Settlement, target: Settlement): string[] {
    return Object.values(source.knowledge.records)
      .filter((record) => !record.dormant && record.theory + record.practice > 0.3 && ((target.knowledge.records[record.id]?.theory ?? 0) + (target.knowledge.records[record.id]?.practice ?? 0) + 0.08 < record.theory + record.practice))
      .sort((a, b) => ((b.theory + b.practice) - ((target.knowledge.records[b.id]?.theory ?? 0) + (target.knowledge.records[b.id]?.practice ?? 0))) - ((a.theory + a.practice) - ((target.knowledge.records[a.id]?.theory ?? 0) + (target.knowledge.records[a.id]?.practice ?? 0))))
      .map((record) => record.id);
  }

  private expose(state: SimulationState, target: Settlement, source: Settlement, sourceRecord: KnowledgeRecord, amount: number, channel: 'persistent-trade' | 'migration' | 'conquest'): KnowledgeEventDraft | undefined {
    const definition = KNOWLEDGE_BY_ID.get(sourceRecord.id);
    if (!definition) return undefined;
    const existing = target.knowledge.records[sourceRecord.id];
    const locallySupported = definition.kind === 'understanding' || this.requirementsMet(state, target, definition.conditions);
    const threshold = definition.difficulty * 0.11 + 0.035;
    if (existing) {
      const previousMastery = existing.theory + existing.practice;
      existing.theory = clamp(existing.theory + Math.max(0, sourceRecord.theory - existing.theory) * amount);
      if (locallySupported) existing.practice = clamp(existing.practice + Math.max(0, sourceRecord.practice - existing.practice) * amount * 0.78);
      if (locallySupported && existing.dormant && existing.practice >= 0.19) existing.dormant = false;
      const gain = existing.theory + existing.practice - previousMastery;
      if (gain <= 0) return undefined;
      target.knowledge.exposure[sourceRecord.id] = (target.knowledge.exposure[sourceRecord.id] ?? 0)
        + amount * (sourceRecord.theory * 0.55 + sourceRecord.practice * 0.45);
      if (target.knowledge.exposure[sourceRecord.id]! < threshold) return undefined;
      delete target.knowledge.exposure[sourceRecord.id];
      return {
        type: 'knowledge-exchange', location: target.position, locationId: target.id,
        actors: [source.id, target.id], causes: [channel, sourceRecord.id],
        context: { knowledge: sourceRecord.id, domain: definition.domain, lineage: sourceRecord.lineageId },
        outcome: `${definition.name} improved through sustained contact with experienced practitioners.`,
        affectedPopulation: 0, magnitude: definition.major ? 0.65 : 0.4,
        significance: definition.major ? 0.64 : 0.48, tags: ['knowledge', channel, definition.domain],
        summary: `${source.name} helps strengthen ${definition.name} in ${target.name}.`,
      };
    }
    const exposure = (target.knowledge.exposure[sourceRecord.id] ?? 0) + amount * (sourceRecord.theory * 0.55 + sourceRecord.practice * 0.45);
    target.knowledge.exposure[sourceRecord.id] = exposure;
    if (exposure < threshold) return undefined;
    const sourceType: KnowledgeRecord['source'] = channel === 'conquest' ? 'conquest' : target.knowledge.lost[sourceRecord.id] && locallySupported ? 'rediscovery' : 'diffusion';
    const record = this.record(sourceRecord.id, sourceRecord.originSettlementId, sourceRecord.lineageId.split(':')[0] ?? 'mixed', state.month, sourceType,
      Math.min(0.22, sourceRecord.theory * 0.38), locallySupported ? Math.min(0.18, sourceRecord.practice * 0.3) : Math.min(0.035, sourceRecord.practice * 0.08), [sourceRecord.lineageId]);
    record.lineageId = sourceRecord.lineageId;
    record.dormant = !locallySupported;
    target.knowledge.records[sourceRecord.id] = record;
    delete target.knowledge.exposure[sourceRecord.id];
    delete target.knowledge.lost[sourceRecord.id];
    if (sourceType === 'rediscovery') state.stats.rediscoveries += 1;
    return {
      type: sourceType === 'rediscovery' ? 'knowledge-rediscovered' : 'knowledge-exchange', location: target.position, locationId: target.id,
      actors: [source.id, target.id], causes: [channel, sourceRecord.id], context: { knowledge: sourceRecord.id, domain: definition.domain, lineage: sourceRecord.lineageId },
      outcome: locallySupported ? `${definition.name} took root in local practice.` : `Accounts of ${definition.name} arrived, but local people could not yet reproduce it.`, affectedPopulation: 0, magnitude: definition.major ? 0.65 : 0.4,
      significance: definition.major ? 0.64 : 0.48, tags: ['knowledge', channel, definition.domain], summary: `${definition.name} travels from ${source.name} to ${target.name}.`,
    };
  }

  private discoveryEvent(state: SimulationState, settlement: Settlement, definition: KnowledgeDefinition, record: KnowledgeRecord): KnowledgeEventDraft {
    return {
      type: 'discovery', location: settlement.position, locationId: settlement.id,
      actors: [settlement.id, ...(record.attributedPersonId ? [record.attributedPersonId] : []), ...(record.institutionId ? [record.institutionId] : [])],
      causes: ['accumulated-experimentation', ...this.foundationIds(definition.conditions)],
      context: { knowledge: definition.id, name: definition.name, kind: definition.kind, domain: definition.domain, lineage: record.lineageId, attributed: Boolean(record.attributedPersonId), ...(record.attributedPersonId ? { attributedPersonId: record.attributedPersonId, attributedName: this.person(state, record.attributedPersonId)?.name ?? 'unknown' } : {}) },
      outcome: definition.description, affectedPopulation: this.peopleAt(state, settlement.id).length, magnitude: definition.major ? 0.78 : 0.48,
      significance: definition.major ? 0.84 : 0.55, tags: ['knowledge', 'discovery', definition.domain, definition.kind],
      summary: record.attributedPersonId ? `${this.person(state, record.attributedPersonId)?.name ?? 'A local investigator'} helps ${settlement.name} establish ${definition.name}.` : `Work in ${settlement.name} gradually establishes ${definition.name}.`,
    };
  }

  private adoptionEvent(state: SimulationState, settlement: Settlement, definition: KnowledgeDefinition, record: KnowledgeRecord): KnowledgeEventDraft {
    const years = Math.max(1, Math.round((state.month - record.discoveredMonth) / 12));
    return {
      type: 'knowledge-adopted', location: settlement.position, locationId: settlement.id,
      actors: [settlement.id, ...(record.institutionId ? [record.institutionId] : [])], causes: [definition.id, 'specialist-teaching', 'repeated-practice'],
      context: { knowledge: definition.id, name: definition.name, stage: 'adoption', yearsSinceDiscovery: years, theory: record.theory, practice: record.practice, lineage: record.lineageId },
      outcome: `${definition.name} passed from isolated knowledge into reliable community practice.`, affectedPopulation: this.peopleAt(state, settlement.id).length,
      magnitude: definition.kind === 'capability' ? 0.74 : 0.58, significance: definition.kind === 'capability' ? 0.82 : 0.7,
      tags: ['knowledge', 'adoption', definition.domain], summary: `${settlement.name} adopts ${definition.name} after ${years} years of accumulated practice.`,
    };
  }

  private transformationEvent(state: SimulationState, settlement: Settlement, definition: KnowledgeDefinition, record: KnowledgeRecord, institutions: readonly Institution[]): KnowledgeEventDraft {
    const adoptionYears = Math.max(1, Math.round((state.month - (record.adoptedMonth ?? record.discoveredMonth)) / 12));
    return {
      type: 'technology-transformation', location: settlement.position, locationId: settlement.id,
      actors: [settlement.id, ...institutions.map((institution) => institution.id)], causes: [definition.id, 'institutional-capacity', 'supporting-infrastructure', 'economic-surplus'],
      context: { knowledge: definition.id, name: definition.name, stage: 'civilization-wide-transformation', yearsSinceAdoption: adoptionYears, theory: record.theory, practice: record.practice, lineage: record.lineageId },
      outcome: `${definition.name} became embedded in institutions, infrastructure, and ordinary production.`, affectedPopulation: this.peopleAt(state, settlement.id).length,
      magnitude: 0.86, significance: 0.9, tags: ['knowledge', 'transformation', definition.domain],
      summary: `${definition.name} transforms life in ${settlement.name}, ${adoptionYears} years after local adoption.`,
    };
  }

  private lossEvent(state: SimulationState, settlement: Settlement, definition: KnowledgeDefinition, record: KnowledgeRecord, reason: string): KnowledgeEventDraft {
    return {
      type: 'knowledge-lost', location: settlement.position, locationId: settlement.id, actors: [settlement.id, ...(record.institutionId ? [record.institutionId] : [])],
      causes: [reason], context: { knowledge: definition.id, theoryRemaining: record.theory, practiceRemaining: record.practice, lineage: record.lineageId },
      outcome: `People retained fragments of ${definition.name}, but could no longer reproduce it reliably.`, affectedPopulation: this.peopleAt(state, settlement.id).length,
      magnitude: definition.major ? 0.74 : 0.46, significance: definition.major ? 0.8 : 0.52, tags: ['knowledge', 'loss', definition.domain],
      summary: `${settlement.name} loses practical command of ${definition.name}.`,
    };
  }

  private recoveryEvent(state: SimulationState, settlement: Settlement, definition: KnowledgeDefinition, record: KnowledgeRecord, cause: string): KnowledgeEventDraft {
    return {
      type: 'knowledge-rediscovered', location: settlement.position, locationId: settlement.id, actors: [settlement.id, ...(record.attributedPersonId ? [record.attributedPersonId] : [])],
      causes: [cause, 'surviving-fragments'], context: { knowledge: definition.id, lineage: record.lineageId }, outcome: `${definition.name} returned to reliable practice.`,
      affectedPopulation: this.peopleAt(state, settlement.id).length, magnitude: definition.major ? 0.72 : 0.45, significance: definition.major ? 0.78 : 0.5,
      tags: ['knowledge', 'rediscovery', definition.domain], summary: `${settlement.name} recovers ${definition.name}.`,
    };
  }

  private foundationIds(conditions: DiscoveryConditions): string[] {
    return [...new Set([...(conditions.foundations ?? []).map((item) => item.id), ...(conditions.alternatives?.flat().map((item) => item.id) ?? [])])];
  }

  private domainWorkers(people: readonly Person[], domain: KnowledgeDomain): number {
    return DOMAIN_OCCUPATIONS[domain].reduce((sum, occupation) => sum + this.occupationCount(people as Person[], occupation), 0);
  }

  private occupationCount(people: Person[], occupation: Occupation): number {
    let counts = this.occupationCounts.get(people);
    if (!counts) {
      counts = new Map<Occupation, number>();
      for (const person of people) counts.set(person.occupation, (counts.get(person.occupation) ?? 0) + 1);
      this.occupationCounts.set(people, counts);
    }
    return counts.get(occupation) ?? 0;
  }

  private institutionSupportsDomain(institution: Institution, domain: KnowledgeDomain): boolean {
    if (institution.kind === 'knowledge-keepers') return true;
    if (institution.kind === 'craft-circle') return ['materials', 'mechanics', 'energy', 'manufacturing', 'chemistry', 'physics', 'computation', 'aerospace'].includes(domain);
    if (institution.kind === 'merchant-association') return ['navigation', 'records', 'transport', 'manufacturing', 'computation', 'aerospace'].includes(domain);
    if (institution.kind === 'council') return ['agriculture', 'records', 'transport', 'medicine', 'physics', 'biology', 'computation'].includes(domain);
    if (institution.kind === 'temple') return domain === 'medicine' || domain === 'records' || domain === 'biology';
    return domain === 'materials' || domain === 'transport' || domain === 'aerospace';
  }

  private peopleAt(state: SimulationState, settlementId: string): Person[] {
    if (this.indexedState !== state) this.refreshIndexes(state);
    return this.peopleBySettlement.get(settlementId) ?? [];
  }

  private institutionsAt(state: SimulationState, settlementId: string): Institution[] {
    if (this.indexedState !== state) this.refreshIndexes(state);
    return this.institutionsBySettlement.get(settlementId) ?? [];
  }

  private refreshIndexes(state: SimulationState): void {
    this.indexedState = state;
    this.peopleBySettlement.clear();
    this.institutionsBySettlement.clear();
    this.occupationCounts = new WeakMap<Person[], Map<Occupation, number>>();
    for (const person of state.people) {
      if (!person.alive) continue;
      const people = this.peopleBySettlement.get(person.homeId) ?? [];
      people.push(person);
      this.peopleBySettlement.set(person.homeId, people);
    }
    for (const institution of state.institutions) {
      const institutions = this.institutionsBySettlement.get(institution.settlementId) ?? [];
      institutions.push(institution);
      this.institutionsBySettlement.set(institution.settlementId, institutions);
    }
  }

  private dominantCulture(state: SimulationState, settlement: Settlement): Culture | undefined {
    const id = Object.entries(settlement.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0];
    return state.cultures.find((culture) => culture.id === id);
  }

  private person(state: SimulationState, id: string): Person | undefined {
    return state.people.find((person) => person.id === id);
  }
}

export function mastery(settlement: Settlement, id: string): { theory: number; practice: number } {
  const record = settlement.knowledge.records[id];
  return record ? { theory: record.theory, practice: record.dormant ? 0 : record.practice } : { theory: 0, practice: 0 };
}

/**
 * Reliable locally deployable practice. Discovery, prerequisite familiarity, experimentation and
 * historical analysis must use `mastery()`/the raw record instead. This boundary prevents an idea
 * or prototype from silently changing production, infrastructure, health, development or other
 * real-world simulation outcomes before society has actually adopted it.
 */
export function practical(settlement: Settlement, id: string): number {
  return capabilityPractice(settlement, id, 'adopted');
}
