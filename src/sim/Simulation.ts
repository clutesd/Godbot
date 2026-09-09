import { configWith, type GodboxConfig, type GodboxConfigInput } from '../config';
import { SeededRandom } from './prng';
import { KnowledgeSystem, type KnowledgeEventDraft } from './knowledge/KnowledgeSystem';
import { KNOWLEDGE_BY_ID } from './knowledge/catalog';
import { AdvancedCivilizationSystem, createAdvancedCivilizationState, representedPopulation, settlementRepresentedPopulation } from './advanced/AdvancedCivilizationSystem';
import { PeopleSystem } from './people/PeopleSystem';
import { WeatherSystem } from './weather/WeatherSystem';
import { syncStructurePlots } from '../shared/StructurePlots';
import { applyFloodConsequences, applyTornadoConsequences, repairWeatherDamage } from './weather/WeatherConsequences';
import { TransportationSystem } from './transport/TransportationSystem';
import { createTransportationState } from './transport/types';
import type {
  Culture,
  CultureDimensions,
  HistoricalEvent,
  HistoricalEventType,
  Institution,
  InstitutionKind,
  Occupation,
  Person,
  PoliticalPower,
  Polity,
  Relation,
  ResourceStock,
  Settlement,
  SimulationState,
  TradeRoute,
  Traits,
  Vec2,
  War,
  WarCause,
  WorldCell,
} from './types';
import { generateWorld, strategicSettlementCells } from './world';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
const emptyStock = (): ResourceStock => ({ food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 });
const mean = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const PALETTES = [
  ['#d96c86', '#342a58', '#efb758'],
  ['#bd5938', '#173d4b', '#43a5a0'],
  ['#d18a32', '#2b365f', '#edb0ae'],
  ['#54794d', '#482f45', '#d86e55'],
  ['#3b8a88', '#623348', '#e6aa4c'],
] as const;
const SYMBOLS = ['sun-step', 'river-eye', 'woven-moon', 'mountain-knot', 'seed-spiral'] as const;
const PATTERNS = ['chevron', 'diamond', 'terrace', 'crossweave', 'wave'] as const;
const SYLLABLES = [
  ['Aki', 'mori', 'sai', 'na', 'kawa', 'tomi'],
  ['Oru', 'kemi', 'ba', 'sunu', 'ade', 'tala'],
  ['Yara', 'hane', 'iko', 'mesa', 'rin', 'do'],
  ['Nuru', 'kai', 'zala', 'emi', 'to', 'wena'],
  ['Sora', 'batu', 'mika', 'luma', 'sen', 'ara'],
] as const;
const PLACE_ENDINGS = ['hara', 'mbe', 'kawa', 'dara', 'sai', 'tala', 'mori', 'ba'];
const INSTITUTION_NAMES: Record<InstitutionKind, string> = {
  council: 'Circle',
  temple: 'House of Embers',
  'merchant-association': 'Caravan Loom',
  'military-order': 'Shield Garden',
  'craft-circle': 'Hands Assembly',
  'knowledge-keepers': 'Memory Court',
};
const INSTITUTION_INTERESTS: Record<InstitutionKind, string[]> = {
  council: ['coordination', 'legitimacy', 'public stores'],
  temple: ['ritual continuity', 'sacred places', 'community care'],
  'merchant-association': ['route safety', 'exchange standards', 'market access'],
  'military-order': ['defense', 'supply', 'martial prestige'],
  'craft-circle': ['materials', 'apprenticeship', 'quality'],
  'knowledge-keepers': ['records', 'teaching', 'long memory'],
};

interface EventInput {
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

export interface SimulationSummary {
  seed: string;
  engineVersion: string;
  year: number;
  month: number;
  population: number;
  settlements: number;
  cultures: number;
  institutions: number;
  tradeRoutes: number;
  activeWars: number;
  polities: number;
  births: number;
  deaths: number;
  migrations: number;
  trades: number;
  knowledgeExchanges: number;
  discoveries: number;
  knowledgeLost: number;
  rediscoveries: number;
  knowledgeAdoptions: number;
  technologyTransformations: number;
  industrializations: number;
  wars: number;
  battles: number;
  peakPopulation: number;
  totalFood: number;
  totalWealth: number;
  averageKnowledge: number;
  representedPopulation: number;
  explicitIndividuals: number;
  civilizationScale: SimulationState['advanced']['scale'];
  outcomeClassification: ReturnType<AdvancedCivilizationSystem['classificationAtHorizon']>;
  institutionalCapacity: number;
  planetaryCoordination: number;
  politicalFragmentation: number;
  developmentPriorities: SimulationState['advanced']['developmentPriorities'];
  atomicThresholdYear: number | null;
  nuclearWeaponsStates: number;
  nuclearUses: number;
  nuclearWars: number;
  strategicNuclearPhase: SimulationState['advanced']['strategic']['phase'];
  firstOrbitYear: number | null;
  offworldSettlements: number;
  interplanetaryPopulation: number;
  selfSustainingBodies: number;
  machineCapability: number;
  advancedMilestones: {
    nuclearWeapons: number | null;
    nuclearUse: number | null;
    machineIntelligence: number | null;
    offworldSettlement: number | null;
    interplanetary: number | null;
    postBiological: number | null;
  };
  fermiHypotheses: string[];
  riskPressures: Record<string, { annualProbability: number; hazard: number; vulnerability: number; mitigation: number }>;
  industrialCenters: number;
  firstIndustrializationYear: number | null;
  industrialRoutes: Record<string, number>;
  independentDiscoveryCenters: number;
  milestones: Record<string, number>;
  eventCounts: Record<string, number>;
  largestSettlements: Array<{ name: string; population: number; foodSecurity: number; specialization: string }>;
  cultureProfiles: Array<{ name: string; population: number; openness: number; militarism: number; tradeOrientation: number }>;
  regionalSpecialization: Array<{ settlement: string; label: string; domains: string[]; knowledgeCount: number; industrialIntensity: number; industrialRoute: string | null }>;
}

export class Simulation {
  config: GodboxConfig;
  /** Authoritative state. Rebuilt in place by restart(); re-read it after a restart. */
  state!: SimulationState;
  private random!: SeededRandom;
  private knowledgeSystem!: KnowledgeSystem;
  private advancedSystem!: AdvancedCivilizationSystem;
  private peopleSystem!: PeopleSystem;
  private weatherSystem!: WeatherSystem;
  private nextPersonId = 1;
  private nextSettlementId = 1;
  private nextEventId = 1;
  private nextInstitutionId = 1;
  private nextRouteId = 1;
  private nextWarId = 1;
  private nextPolityId = 1;
  private readonly peopleBySettlement = new Map<string, Person[]>();
  private readonly personById = new Map<string, Person>();
  private readonly routesBySettlement = new Map<string, TradeRoute[]>();
  private transportationSystem!: TransportationSystem;
  private readonly widespreadAdoptions = new Set<string>();
  private readonly baseOverrides: GodboxConfigInput;

  constructor(overrides: GodboxConfigInput = {}) {
    this.baseOverrides = overrides;
    this.config = configWith(overrides);
    this.initializeRun();
  }

  /**
   * Fully resets the run: world, people, settlements, knowledge, institutions, relations, wars,
   * polities, history, statistics, identifier counters, lookup caches, and every subsystem are
   * rebuilt from scratch, so nothing leaks from the prior run. With no argument the current seed
   * replays from Year 0; with a seed argument a new world begins. The same seed and
   * configuration always reproduce the same history. Holders of the old state object (renderers,
   * archivists) must re-read `simulation.state`.
   */
  restart(seed?: string): void {
    this.config = configWith(seed === undefined ? this.baseOverrides : { ...this.baseOverrides, seed });
    this.initializeRun();
  }

  private initializeRun(): void {
    // Keep the stream family stable across pacing-model releases so matched-seed
    // audits isolate rule changes. engineVersion still separates archive identity.
    this.random = new SeededRandom(`${this.config.seed}:godbox-sim-0.3.0:simulation`);
    this.knowledgeSystem = new KnowledgeSystem(this.config, this.random.fork('knowledge'));
    this.advancedSystem = new AdvancedCivilizationSystem(this.config, this.random.fork('advanced-civilization'));
    const world = generateWorld(this.config, this.random.fork('world'));
    this.weatherSystem = new WeatherSystem(world, this.config, this.random.fork('weather'));
    this.nextPersonId = 1;
    this.nextSettlementId = 1;
    this.nextEventId = 1;
    this.nextInstitutionId = 1;
    this.nextRouteId = 1;
    this.nextWarId = 1;
    this.nextPolityId = 1;
    this.peopleBySettlement.clear();
    this.personById.clear();
    this.routesBySettlement.clear();
    this.widespreadAdoptions.clear();
    this.state = {
      engineVersion: this.config.engineVersion,
      seed: this.config.seed,
      month: 0,
      world,
      weather: this.weatherSystem.state,
      people: [],
      settlements: [],
      cultures: [],
      institutions: [],
      relations: [],
      tradeRoutes: [],
      transportation: createTransportationState(),
      wars: [],
      polities: [],
      history: [],
      stats: { births: 0, deaths: 0, migrations: 0, trades: 0, knowledgeExchanges: 0, discoveries: 0, knowledgeLost: 0, rediscoveries: 0, knowledgeAdoptions: 0, technologyTransformations: 0, industrializations: 0, wars: 0, battles: 0, peakPopulation: 0, settlementsFounded: 0, settlementsAbandoned: 0, atomicThresholds: 0, nuclearWeaponsStates: 0, nuclearUses: 0, nuclearWars: 0, pandemics: 0, firstOrbits: 0, offworldSettlements: 0, interplanetaryTransitions: 0, postBiologicalTransitions: 0, civilizationCollapses: 0, existentialRiskEvents: 0 },
      advanced: createAdvancedCivilizationState(),
    };
    this.peopleSystem = new PeopleSystem(world, this.config.seed);
    this.transportationSystem = new TransportationSystem(this.state);
    this.initialize();
    this.advancedSystem.initialize(this.state);
  }

  private initialize(): void {
    const settlementCount = this.random.int(this.config.settlementCount[0], this.config.settlementCount[1] + 1);
    const cultureCount = Math.max(2, Math.min(4, Math.ceil(settlementCount / 2)));
    for (let index = 0; index < cultureCount; index += 1) this.state.cultures.push(this.createCulture(index));
    const cells = strategicSettlementCells(this.state.world, settlementCount, this.random.fork('settlements'));
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      const culture = this.state.cultures[index % cultureCount];
      if (!culture) continue;
      this.createSettlement(cell, culture, 0, false);
    }
    const base = Math.floor(this.config.startingPopulation / this.state.settlements.length);
    let remainder = this.config.startingPopulation - base * this.state.settlements.length;
    for (const settlement of this.state.settlements) {
      const count = base + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      this.seedPopulation(settlement, count);
    }
    this.initializeRelations();
    this.rebuildLookupIndexes();
    this.recomputeCultureShares();
    this.state.stats.peakPopulation = this.population;
    syncStructurePlots(this.state);
    this.addEvent({
      type: 'world-awakening',
      actors: this.state.settlements.map((settlement) => settlement.id),
      causes: ['initial-conditions'],
      context: { settlements: settlementCount, cultures: cultureCount },
      outcome: 'Independent communities began their shared history.',
      affectedPopulation: this.population,
      magnitude: 1,
      significance: 1,
      tags: ['origin'],
      summary: `${this.population} people awaken across ${settlementCount} settlements.`,
    });
  }

  get population(): number {
    return this.state.people.length;
  }

  get year(): number {
    return Math.floor(this.state.month / 12);
  }

  step(months = 1): void {
    const count = Math.max(0, Math.floor(months));
    for (let index = 0; index < count; index += 1) this.stepMonth();
  }

  private stepMonth(): void {
    this.state.month += 1;
    this.weatherSystem.advanceMonth();
    this.state.weather = this.weatherSystem.state;
    syncStructurePlots(this.state);
    for (const event of applyFloodConsequences(this.state)) this.addEvent(event);
    for (const tornado of this.state.weather.tornadoes) {
      if (tornado.month === this.state.month) {
        for (const event of applyTornadoConsequences(this.state, tornado)) this.addEvent(event);
      }
    }
    this.rebuildLookupIndexes();
    this.runEconomy();
    this.knowledgeSystem.advanceMonth(this.state);
    this.transportationSystem.advanceMonth();
    this.runTrade();
    if (this.state.month % 12 === 0) this.formPartnerships();
    this.runPeople();
    this.runWars();
    if (this.state.month % 3 === 0) this.runMigration();
    if (this.state.month % 12 === 0) {
      this.runDiplomacy();
      this.runInstitutions();
      this.runPolitics();
      this.applyKnowledgeEvents(this.knowledgeSystem.advanceYear(this.state));
      this.assessWidespreadAdoption();
      this.runCulture();
      this.runSettlementChange();
    }
    this.state.people = this.state.people.filter((person) => person.alive);
    this.maintainModernRepresentatives();
    this.rebuildLookupIndexes();
    this.recomputeCultureShares();
    this.applyAdvancedEvents(this.advancedSystem.advanceMonth(this.state));
    if (this.state.month % 12 === 0) {
      this.applyAdvancedEvents(this.advancedSystem.advanceYear(this.state));
      this.state.people = this.state.people.filter((person) => person.alive);
      this.maintainModernRepresentatives();
      this.rebuildLookupIndexes();
      this.recomputeCultureShares();
    }
    this.state.stats.peakPopulation = Math.max(this.state.stats.peakPopulation, this.population);
    if (this.state.history.length > this.config.simulation.historyLimit) this.trimHistory();
  }

  /**
   * Deep-time runs generate millions of low-significance chronicle entries (births, deaths,
   * routine seasons). Evict the least significant entries first so centuries-old milestones
   * survive and the historical record stays bounded without losing what mattered.
   */
  private trimHistory(): void {
    const limit = this.config.simulation.historyLimit;
    let excess = this.state.history.length - limit;
    if (excess <= 0) return;
    const kept: HistoricalEvent[] = [];
    for (const event of this.state.history) {
      if (excess > 0 && event.significance < 0.3) {
        excess -= 1;
        continue;
      }
      kept.push(event);
    }
    this.state.history = kept.length > limit ? kept.slice(kept.length - limit) : kept;
  }

  /**
   * Invention is local; history turns only when a capability becomes ordinary practice across
   * much of the known world. Marks that diffusion crossing once per knowledge per run.
   */
  private assessWidespreadAdoption(): void {
    const living = this.livingSettlements();
    if (living.length < 2) return;
    const adoptedBy = new Map<string, Settlement[]>();
    for (const settlement of living) {
      for (const record of Object.values(settlement.knowledge.records)) {
        if (record.adoptedMonth === undefined || record.dormant) continue;
        const holders = adoptedBy.get(record.id) ?? [];
        holders.push(settlement);
        adoptedBy.set(record.id, holders);
      }
    }
    for (const [id, settlements] of adoptedBy) {
      const definition = KNOWLEDGE_BY_ID.get(id);
      if (!definition?.major || this.widespreadAdoptions.has(id)) continue;
      if (settlements.length < 2 || settlements.length * 2 < living.length) continue;
      this.widespreadAdoptions.add(id);
      const origin = settlements[0];
      if (!origin) continue;
      const population = settlements.reduce((sum, settlement) => sum + this.peopleAt(settlement.id).length, 0);
      this.addEvent({
        type: 'technology-widespread', location: origin.position, locationId: origin.id,
        actors: settlements.map((settlement) => settlement.id), causes: [id, 'persistent-trade', 'local-adoption', 'institutional-capacity'],
        context: { knowledge: id, name: definition.name, stage: 'widespread-adoption', settlements: settlements.length, worldSettlements: living.length },
        outcome: `${definition.name} is no longer a local experiment; it is ordinary practice across the known world.`,
        affectedPopulation: population, magnitude: 0.72, significance: 0.8,
        tags: ['knowledge', 'widespread', definition.domain],
        summary: `${definition.name} becomes widespread across ${settlements.length} settlements.`,
      });
    }
  }

  private createCulture(index: number): Culture {
    const syllables = [...(SYLLABLES[index % SYLLABLES.length] ?? SYLLABLES[0])];
    const palette = PALETTES[index % PALETTES.length] ?? PALETTES[0];
    const dimensions = {} as CultureDimensions;
    for (const key of ['cooperation', 'hierarchy', 'militarism', 'tradeOrientation', 'curiosity', 'religiousTendency', 'institutionalTrust', 'outsiderOpenness', 'longTermOrientation'] as const) {
      dimensions[key] = clamp(this.random.gaussian(0.5, 0.15));
    }
    return {
      id: `culture-${index + 1}`,
      name: `${syllables[0] ?? 'A'}${syllables[1] ?? 'ra'}`,
      dimensions,
      style: {
        primary: palette[0], secondary: palette[1], accent: palette[2],
        symbol: SYMBOLS[index % SYMBOLS.length] ?? 'sun-step',
        pattern: PATTERNS[index % PATTERNS.length] ?? 'chevron',
        nameSyllables: syllables,
      },
      memory: { tradeSuccess: 0, collectiveSuccess: 0, frontierViolence: 0, militarySuccess: 0 },
    };
  }

  private createSettlement(cell: WorldCell, culture: Culture, foundedMonth: number, record = true): Settlement {
    const id = `settlement-${this.nextSettlementId++}`;
    const name = this.generatePlaceName(culture);
    const polityId = `polity-${this.nextPolityId++}`;
    const settlement: Settlement = {
      id,
      name,
      position: { x: cell.worldX, z: cell.worldZ },
      cellIndex: cell.z * this.state.world.size + cell.x,
      foundedMonth,
      cultureShares: { [culture.id]: 1 },
      resources: { food: 210, wood: 65, minerals: 18, goods: 22, wealth: 14 },
      monthlyBalance: emptyStock(),
      buildings: 4,
      targetBuildings: 4,
      constructionProgress: 0,
      specialization: cell.fertility > 0.66 ? 'agriculture' : cell.wood > 0.65 ? 'forestry' : cell.minerals > 0.63 ? 'mining' : 'craft',
      foodSecurity: 0.8,
      prosperity: 0.45,
      knowledge: this.knowledgeSystem.createPortfolio(id, culture, cell, foundedMonth),
      infrastructure: this.knowledgeSystem.createInfrastructure(cell),
      industry: this.knowledgeSystem.createIndustry(),
      pollution: 0,
      urbanization: 0.08,
      climateStress: 0,
      conflictPressure: 0,
      crisisMonths: 0,
      depopulationMonths: 0,
      politicalPower: this.initialPower(culture.dimensions),
      polityId,
      institutionIds: [],
      alive: true,
    };
    this.state.settlements.push(settlement);
    this.state.polities.push({
      id: polityId,
      name: `${name} Compact`,
      settlementIds: [id],
      capitalId: id,
      formedMonth: foundedMonth,
      lastTransitionMonth: foundedMonth,
      arrangement: this.powerArrangement(settlement.politicalPower),
      legitimacy: 0.46,
      phase: 'formation',
      phaseSinceMonth: foundedMonth,
      stability: 0.42,
      successionCount: 0,
    });
    if (record) {
      this.state.stats.settlementsFounded += 1;
      this.addEvent({
        type: 'settlement-founded', location: settlement.position, locationId: id, actors: [id, culture.id],
        causes: ['population-pressure', 'search-for-opportunity'], context: { fertility: cell.fertility, minerals: cell.minerals },
        outcome: `${name} became a permanent settlement.`, affectedPopulation: 0, magnitude: 0.64, significance: 0.76,
        tags: ['settlement', 'migration'], summary: `${name} is founded on new ground.`,
      });
    }
    return settlement;
  }

  private initialPower(dimensions: CultureDimensions): PoliticalPower {
    return {
      personalPrestige: clamp(0.34 + this.random.range(0, 0.2)),
      kinship: clamp(0.48 + this.random.range(-0.1, 0.1)),
      military: clamp(dimensions.militarism * 0.6 + this.random.range(0, 0.2)),
      religious: clamp(dimensions.religiousTendency * 0.68 + this.random.range(0, 0.14)),
      merchant: clamp(dimensions.tradeOrientation * 0.55 + this.random.range(0, 0.15)),
      council: clamp(dimensions.cooperation * 0.7 + this.random.range(0, 0.12)),
      institutional: clamp(dimensions.institutionalTrust * 0.5),
      wealth: clamp(dimensions.tradeOrientation * 0.38 + this.random.range(0, 0.14)),
    };
  }

  private seedPopulation(settlement: Settlement, count: number, provisionResources = true, householdNamespace = 'house'): void {
    const cultureId = Object.keys(settlement.cultureShares)[0];
    const culture = this.culture(cultureId ?? '') ?? this.state.cultures[0];
    if (!culture) return;
    const created: Person[] = [];
    for (let index = 0; index < count; index += 1) {
      const ageYears = index < count * 0.2 ? this.random.int(1, 15) : index < count * 0.84 ? this.random.int(16, 52) : this.random.int(53, 76);
      const householdId = `${householdNamespace}-${settlement.id}-${Math.floor(index / 5) + 1}`;
      created.push(this.createPerson(settlement, culture, ageYears * 12 + this.random.int(0, 12), householdId));
    }
    const households = new Map<string, Person[]>();
    for (const person of created) {
      const members = households.get(person.householdId) ?? [];
      members.push(person);
      households.set(person.householdId, members);
    }
    const women = created.filter((person) => person.sex === 'female' && person.ageMonths >= 18 * 12 && person.ageMonths <= 48 * 12).sort((a, b) => a.ageMonths - b.ageMonths);
    const men = created.filter((person) => person.sex === 'male' && person.ageMonths >= 18 * 12 && person.ageMonths <= 55 * 12).sort((a, b) => a.ageMonths - b.ageMonths);
    const couples: Array<[Person, Person]> = [];
    for (let index = 0; index < Math.min(women.length, men.length); index += 1) {
      const woman = women[index];
      const man = men[index];
      if (!woman || !man) continue;
      woman.partnerId = man.id;
      man.partnerId = woman.id;
      man.householdId = woman.householdId;
      couples.push([woman, man]);
    }
    for (const child of created.filter((person) => person.ageMonths < 18 * 12)) {
      const parents = couples.find(([woman]) => woman.householdId === child.householdId) ?? couples[this.random.int(0, couples.length)];
      if (!parents) continue;
      child.householdId = parents[0].householdId;
      child.parents = [parents[0].id, parents[1].id];
      parents[0].children.push(child.id);
      parents[1].children.push(child.id);
    }
    // Partnership formation can move a person into their partner's household. Re-anchor the
    // documentary home only after that household topology is final, preventing stale home IDs.
    for (const person of created) this.peopleSystem.initializePerson(person, settlement, this.state);
    this.state.people.push(...created);
    if (provisionResources) settlement.resources.food += count * 2.8;
  }

  /** Re-samples named documentary lives from statistical cohorts; it does not add to represented population. */
  private maintainModernRepresentatives(): void {
    const represented = representedPopulation(this.state);
    if (this.state.advanced.scale !== 'modern-statistical' || represented === 0 || this.population >= Math.min(72, represented)) return;
    const target = Math.min(represented, 144, Math.max(96, this.state.settlements.filter((settlement) => settlement.alive).length * 16));
    const needed = target - this.population;
    let remaining = needed;
    const cities = [...this.state.advanced.cities].filter((city) => this.settlement(city.settlementId)?.alive).sort((a, b) => b.population - a.population);
    const cityPopulation = Math.max(1, cities.reduce((sum, city) => sum + city.population, 0));
    for (let index = 0; index < cities.length && remaining > 0; index += 1) {
      const city = cities[index];
      if (!city) continue;
      const settlement = this.settlement(city.settlementId);
      if (!settlement) continue;
      const count = Math.min(remaining, index === cities.length - 1 ? remaining : Math.max(1, Math.round(needed * city.population / cityPopulation)));
      this.seedPopulation(settlement, count, false, `representative-${this.state.month}`);
      remaining -= count;
    }
  }

  private createPerson(settlement: Settlement, culture: Culture, ageMonths: number, householdId: string, parents: string[] = []): Person {
    const id = `person-${this.nextPersonId++}`;
    const angle = this.random.range(0, Math.PI * 2);
    const radius = Math.sqrt(this.random.float()) * 4;
    const traits = {} as Traits;
    for (const key of ['curiosity', 'cooperation', 'sociability', 'aggression', 'ambition', 'riskTolerance', 'empathy', 'conformity', 'courage', 'patience', 'conscientiousness', 'loyalty'] as const) {
      traits[key] = clamp(this.random.gaussian(0.5, 0.18));
    }
    const position = { x: settlement.position.x + Math.cos(angle) * radius, z: settlement.position.z + Math.sin(angle) * radius };
    const person: Person = {
      id,
      name: this.generatePersonName(culture),
      sex: this.random.chance(0.5) ? 'female' : 'male',
      ageMonths,
      bornMonth: this.state.month - ageMonths,
      parents: [...parents],
      children: [],
      householdId,
      homeId: settlement.id,
      cultureId: culture.id,
      position,
      target: { ...position },
      occupation: this.occupationFor(ageMonths, settlement),
      activity: 'socialize',
      health: clamp(this.random.gaussian(0.83, 0.1), 0.35, 1),
      energy: clamp(this.random.gaussian(0.76, 0.13)),
      prestige: clamp(ageMonths / (70 * 12) * 0.32 + traits.ambition * 0.16 + this.random.range(0, 0.08)),
      traits,
      alive: true,
    };
    this.peopleSystem.initializePerson(person, settlement, this.state);
    return person;
  }

  private occupationFor(ageMonths: number, settlement: Settlement): Occupation {
    const years = ageMonths / 12;
    if (years < 15) return 'child';
    if (years > 68) return 'elder';
    const cell = this.state.world.cells[settlement.cellIndex];
    const productivity = this.knowledgeSystem.productionFactors(settlement);
    const weights = [
      (3.7 + (cell?.fertility ?? 0.5) * 3) / Math.sqrt(productivity.food),
      1.2 + (cell?.wood ?? 0.5),
      1.15 + settlement.infrastructure.roads * 0.5 + settlement.industry.intensity * 0.8,
      1.25 + (cell?.minerals ?? 0.3) + settlement.infrastructure.workshops * 3 + settlement.industry.intensity * 5,
      0.9 + this.routesAt(settlement.id).length * 0.14 + Math.max(settlement.infrastructure.ports, settlement.infrastructure.rail) * 1.4,
      0.55 + settlement.knowledge.literacy * 2.5 + settlement.infrastructure.archives * 1.6,
    ];
    return (['farmer', 'forager', 'builder', 'artisan', 'carrier', 'keeper'] as const)[this.random.weightedIndex(weights)] ?? 'farmer';
  }

  private runEconomy(): void {
    const season = [0.7, 0.76, 0.86, 1, 1.16, 1.28, 1.22, 1.08, 0.98, 0.88, 0.76, 0.68][this.state.month % 12] ?? 1;
    for (const settlement of this.livingSettlements()) {
      const people = this.peopleAt(settlement.id);
      const cell = this.state.world.cells[settlement.cellIndex];
      if (!cell) continue;
      const count = (occupation: Occupation): number => people.filter((person) => person.occupation === occupation).length;
      const farmers = count('farmer');
      const foragers = count('forager');
      const builders = count('builder');
      const repaired = repairWeatherDamage(settlement, builders, this.state.month);
      const damagedPlots = (settlement.structurePlots ?? []).filter((plot) => plot.condition < 1);
      if (settlement.weatherRecoverySince !== undefined && damagedPlots.length === 0) {
        this.addEvent({ type: 'recovery', location: settlement.position, locationId: settlement.id, actors: [settlement.id],
          causes: ['weather-rebuilding'], context: { recoveryMonths: this.state.month - settlement.weatherRecoverySince },
          outcome: 'Repairs to weather-damaged structures are complete.', significance: 0.55, tags: ['weather', 'recovery'],
          summary: `${settlement.name} completes repairs to its weather-damaged structures.` });
        settlement.weatherRecoverySince = undefined;
      }
      const artisans = count('artisan');
      const carriers = count('carrier');
      const keepers = count('keeper');
      const productivity = this.knowledgeSystem.productionFactors(settlement);
      const balance = emptyStock();
      this.random.float();
      const weather = this.state.weather.cells[settlement.cellIndex];
      if (weather && (weather.snowpack > 1.1 || weather.blizzard > 0.5 && weather.snowpack > 0.2)
        && this.state.month - (settlement.lastSnowEventMonth ?? -120) >= 24) {
        settlement.lastSnowEventMonth = this.state.month;
        const blizzard = weather.blizzard > 0.5;
        this.addEvent({ type: 'natural-catastrophe', location: settlement.position, locationId: settlement.id,
          actors: [settlement.id], causes: [blizzard ? 'blizzard' : 'deep-snow', 'travel-disruption'],
          context: { snowpack: weather.snowpack, snowMonths: weather.snowMonths, blizzard: weather.blizzard, travelPenalty: weather.travelPenalty },
          outcome: blizzard ? 'Wind-driven snow slows exposed work and travel; accumulated snow persists until thaw.' : 'Deep snow impedes local work and travel until thaw.',
          significance: 0.55 + weather.blizzard * 0.15, tags: blizzard ? ['weather', 'snow', 'blizzard'] : ['weather', 'snow'],
          summary: `${blizzard ? 'A blizzard disrupts' : 'Deep snow disrupts'} work and travel in ${settlement.name}.` });
      }
      const climatePulse = clamp(1 + (cell.moisture - 0.45) * 0.16
        - (weather?.snowpack ?? 0) * 0.16 - Math.min(0.4, weather?.floodDepth ?? 0), 0.4, 1.12);
      settlement.climateStress = clamp(settlement.climateStress * 0.72 + Math.max(0, 0.94 - climatePulse) * 1.6 + Math.max(0, 0.3 - cell.moisture) * 0.1);
      settlement.conflictPressure *= 0.965;
      const structuralLoss = damagedPlots.reduce((sum, plot) => sum + 1 - plot.condition, 0) / Math.max(1, settlement.buildings);
      const safetyFactor = (1 - settlement.conflictPressure * 0.24) * (1 - structuralLoss * 0.3);
      const floodedWorkLoss = (settlement.structurePlots ?? []).slice(0, settlement.buildings)
        .reduce((sum, plot) => sum + Math.max(plot.condition < 0.65 ? 1 - plot.condition : 0,
          clamp(((plot.floodDepth ?? 0) - 0.06) / 0.5)), 0) / Math.max(1, settlement.buildings);
      const exposedWork = (1 - (weather?.blizzard ?? 0) * 0.25) * (1 - floodedWorkLoss * 0.5);
      balance.food = (farmers * (0.54 + cell.fertility * 0.7) * season * climatePulse * (1 - (weather?.cropDamage ?? 0)) + foragers * (0.18 + cell.fertility * 0.25)) * safetyFactor * productivity.food * exposedWork - people.length * (0.31 + settlement.urbanization * 0.018);
      balance.wood = (foragers * 0.18 + builders * 0.1) * (0.42 + cell.wood) * exposedWork - settlement.buildings * 0.022;
      balance.minerals = ((artisans * 0.085 + foragers * 0.02) * (0.35 + cell.minerals) - artisans * 0.018) * productivity.materials;
      balance.goods = (artisans * 0.18 + keepers * 0.038) * productivity.goods - people.length * (0.016 + settlement.urbanization * 0.006);
      balance.wealth = Math.max(0, balance.goods) * 0.21 + carriers * 0.018 - settlement.institutionIds.length * 0.035;
      for (const key of ['food', 'wood', 'minerals', 'goods', 'wealth'] as const) {
        settlement.resources[key] = Math.max(0, settlement.resources[key] + balance[key]);
      }
      const foodStorage = Math.max(180, people.length * 6 + settlement.buildings * 24);
      settlement.resources.food = Math.min(settlement.resources.food, foodStorage);
      settlement.monthlyBalance = balance;
      const monthsOfFood = settlement.resources.food / Math.max(1, people.length * 0.31);
      settlement.foodSecurity = clamp(monthsOfFood / 5 * 0.7 + (balance.food >= 0 ? 0.3 : 0));
      settlement.prosperity = clamp(settlement.foodSecurity * 0.38 + Math.min(1, settlement.resources.wealth / Math.max(18, people.length * 0.8)) * 0.3 + Math.min(1, settlement.resources.goods / Math.max(12, people.length * 0.35)) * 0.18 + settlement.institutionIds.length * 0.04);
      const previousTarget = settlement.targetBuildings;
      settlement.targetBuildings = Math.max(2, Math.ceil(people.length / 17) + settlement.institutionIds.length * 2 + Math.ceil(settlement.industry.intensity * 10));
      if (!cell.water && builders > 0 && repaired === 0 && damagedPlots.length === 0 && settlement.buildings < settlement.targetBuildings && settlement.resources.wood > 9) {
        // Preserve one construction draw per eligible month so unrelated social systems keep
        // their deterministic random stream while completion itself follows visible progress.
        this.random.float();
        const builderCapacity = clamp(builders / Math.max(3, people.length * 0.055), 0.2, 1.35);
        const constructionRate = builderCapacity * (0.45 + settlement.prosperity * 0.55) / this.config.historicalPace.smallConstructionMonths;
        settlement.constructionProgress = Math.min(1, settlement.constructionProgress + constructionRate);
        if (settlement.constructionProgress >= 1) {
          settlement.resources.wood -= 8;
          settlement.resources.minerals = Math.max(0, settlement.resources.minerals - 1.5);
          settlement.buildings += 1;
          settlement.constructionProgress = 0;
          const culture = this.dominantCulture(settlement);
          if (culture) culture.memory.collectiveSuccess += 0.06;
        }
      } else if (settlement.buildings >= settlement.targetBuildings) {
        settlement.constructionProgress = 0;
      }
      if (this.state.month % 12 === 0 && previousTarget > settlement.targetBuildings + 2 && settlement.buildings > settlement.targetBuildings) settlement.buildings -= 1;
      const balances = { agriculture: balance.food, forestry: balance.wood * 3, mining: balance.minerals * 8, craft: balance.goods * 5, exchange: balance.wealth * 6 };
      settlement.specialization = (Object.entries(balances).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'agriculture') as Settlement['specialization'];
      if (settlement.foodSecurity < 0.18) settlement.crisisMonths += 1;
      else if (settlement.crisisMonths >= 3 && settlement.foodSecurity > 0.55) {
        this.addEvent({
          type: 'recovery', location: settlement.position, locationId: settlement.id, actors: [settlement.id],
          causes: ['restored-food-stores', 'collective-adaptation'], context: { crisisMonths: settlement.crisisMonths, food: settlement.resources.food },
          outcome: 'Rationing ended and households resumed ordinary work.', affectedPopulation: people.length, magnitude: clamp(settlement.crisisMonths / 18),
          significance: 0.5, tags: ['recovery', 'food'], summary: `${settlement.name} recovers from a long shortage.`,
        });
        const culture = this.dominantCulture(settlement);
        if (culture) culture.memory.collectiveSuccess += 0.35;
        settlement.crisisMonths = 0;
      } else settlement.crisisMonths = Math.max(0, settlement.crisisMonths - 1);
      if (settlement.foodSecurity < 0.13 && this.state.month % 12 === 0) {
        this.addEvent({
          type: 'harvest-crisis', location: settlement.position, locationId: settlement.id, actors: [settlement.id],
          causes: ['food-deficit', cell.moisture < 0.35 ? 'dry-climate' : 'population-pressure', ...(weather && weather.snowpack > 0.5 ? ['deep-snow'] : []), ...(weather && weather.cropDamage > 0.05 ? ['storm-crop-damage'] : [])], context: { food: settlement.resources.food, balance: balance.food, snowpack: weather?.snowpack ?? 0, cropDamage: weather?.cropDamage ?? 0 },
          outcome: 'Households rationed food and considered leaving.', affectedPopulation: people.length, magnitude: clamp(1 - settlement.foodSecurity), significance: 0.64,
          tags: ['scarcity', 'migration-pressure'], summary: `Food stores run dangerously low in ${settlement.name}.`,
        });
      }
    }
  }

  private runPeople(): void {
    const newborns: Person[] = [];
    const popLimitFactor = clamp(1 - this.population / this.config.simulation.populationSoftCap, 0.04, 1);
    for (const person of this.state.people) {
      const settlement = this.settlement(person.homeId);
      if (!settlement?.alive) continue;
      person.ageMonths += 1;
      const ageYears = person.ageMonths / 12;
      if (person.ageMonths % 12 === 0) {
        person.occupation = this.occupationFor(person.ageMonths, settlement);
        this.peopleSystem.refreshIdentity(person, settlement, this.state);
      }
      const nutritionalChange = (settlement.foodSecurity - 0.46) * 0.026;
      person.health = clamp(person.health + nutritionalChange + this.random.range(-0.008, 0.008));
      person.energy = clamp(person.energy + (settlement.foodSecurity - 0.38) * 0.11 + this.random.range(-0.12, 0.1));
      const contribution = person.occupation === 'keeper' ? settlement.knowledge.literacy : person.occupation === 'builder' ? settlement.buildings / 30 : person.occupation === 'carrier' ? this.routesAt(settlement.id).length / 8 : 0;
      person.prestige = clamp(person.prestige * 0.9996 + contribution * 0.0008 + person.traits.ambition * 0.00005);
      this.moveAndChooseActivity(person, settlement);
      const annualMortality = ageYears < 1 ? 0.055 : ageYears < 15 ? 0.0018 : ageYears < 48 ? 0.0035 : ageYears < 63 ? 0.014 : ageYears < 76 ? 0.052 : ageYears < 90 ? 0.16 : 0.42;
      const healthHazard = Math.max(0, 0.48 - person.health) * 0.24;
      const scarcityHazard = settlement.foodSecurity < 0.15 ? (0.15 - settlement.foodSecurity) * 0.24 : 0;
      const medicalProtection = this.knowledgeSystem.healthProtection(settlement);
      const pollutionHazard = settlement.pollution * 0.009;
      if (this.random.chance((annualMortality * (1 - medicalProtection * 0.42) + healthHazard * (1 - medicalProtection * 0.28) + scarcityHazard + pollutionHazard) / 12)) {
        this.killPerson(person, scarcityHazard > healthHazard && scarcityHazard > annualMortality ? 'scarcity' : ageYears > 68 ? 'age' : 'illness');
        continue;
      }
      if (person.sex === 'female' && ageYears >= 18 && ageYears <= 41 && person.partnerId && settlement.foodSecurity > 0.28) {
        const localPopulation = this.peopleAt(settlement.id).length;
        const cell = this.state.world.cells[settlement.cellIndex];
        const carryingCapacity = 52 + (cell?.habitability ?? 0.5) * 175 + settlement.buildings * 4;
        const pressureFactor = clamp(1.25 - localPopulation / carryingCapacity, 0.05, 1);
        const birthChance = 0.0105 * pressureFactor * popLimitFactor * (0.62 + person.health * 0.52);
        if (this.random.chance(birthChance)) {
          const partner = this.person(person.partnerId);
          const otherCulture = partner ? this.culture(partner.cultureId) : undefined;
          const culture = otherCulture && this.random.chance(0.5) ? otherCulture : this.culture(person.cultureId);
          if (culture) {
            const child = this.createPerson(settlement, culture, 0, person.householdId, partner ? [person.id, partner.id] : [person.id]);
            child.health = clamp((person.health + (partner?.health ?? person.health)) / 2 + this.random.range(-0.08, 0.08));
            person.children.push(child.id);
            if (partner) partner.children.push(child.id);
            newborns.push(child);
            this.state.stats.births += 1;
            this.addEvent({
              type: 'birth', location: settlement.position, locationId: settlement.id, actors: [child.id, ...child.parents], causes: ['family-continuity'],
              context: { culture: culture.id }, outcome: `${child.name} joined the household.`, affectedPopulation: 1, magnitude: 0.03, significance: 0.04,
              tags: ['life', 'family'], summary: `${child.name} is born in ${settlement.name}.`,
            });
          }
        }
      }
    }
    this.state.people.push(...newborns);
    for (const child of newborns) this.indexPerson(child);
  }

  private formPartnerships(): void {
    for (const settlement of this.livingSettlements()) {
      const availableWomen = this.peopleAt(settlement.id)
        .filter((person) => person.sex === 'female' && !person.partnerId && person.ageMonths >= 18 * 12 && person.ageMonths <= 42 * 12)
        .sort((a, b) => a.ageMonths - b.ageMonths);
      const availableMen = this.peopleAt(settlement.id)
        .filter((person) => person.sex === 'male' && !person.partnerId && person.ageMonths >= 18 * 12 && person.ageMonths <= 52 * 12)
        .sort((a, b) => a.ageMonths - b.ageMonths);
      for (const woman of availableWomen) {
        const candidateIndex = availableMen.findIndex((man) => {
          const closeKin = woman.parents.includes(man.id) || man.parents.includes(woman.id) || woman.parents.some((parent) => man.parents.includes(parent));
          return !closeKin && Math.abs(woman.ageMonths - man.ageMonths) <= 14 * 12;
        });
        if (candidateIndex < 0) continue;
        const man = availableMen.splice(candidateIndex, 1)[0];
        if (!man) continue;
        woman.partnerId = man.id;
        man.partnerId = woman.id;
        const householdId = woman.householdId;
        man.householdId = householdId;
      }
    }
  }

  private moveAndChooseActivity(person: Person, settlement: Settlement): void {
    this.peopleSystem.advancePerson(person, settlement, this.state);
    person.energy = clamp(person.energy - (person.activity === 'rest' ? -0.02 : person.navigation?.traveling ? 0.055 : 0.035));
  }

  private killPerson(person: Person, cause: string): void {
    person.alive = false;
    this.personById.delete(person.id);
    const localPeople = this.peopleBySettlement.get(person.homeId);
    const localIndex = localPeople?.indexOf(person) ?? -1;
    if (localPeople && localIndex >= 0) localPeople.splice(localIndex, 1);
    this.state.stats.deaths += 1;
    const partner = person.partnerId ? this.person(person.partnerId) : undefined;
    if (partner) partner.partnerId = undefined;
    const settlement = this.settlement(person.homeId);
    this.addEvent({
      type: 'death', location: settlement?.position, locationId: settlement?.id, actors: [person.id], causes: [cause],
      context: { name: person.name, age: Math.floor(person.ageMonths / 12), occupation: person.occupation, cultureId: person.cultureId, homeId: person.homeId, prestige: person.prestige }, outcome: `${person.name}'s life ended.`, affectedPopulation: 1,
      magnitude: person.children.length > 3 ? 0.09 : 0.03, significance: person.children.length > 3 ? 0.1 : 0.025,
      tags: ['life', cause], summary: `${person.name} dies at ${Math.floor(person.ageMonths / 12)} in ${settlement?.name ?? 'the wilderness'}.`,
    });
  }

  private runMigration(): void {
    const settlements = this.livingSettlements();
    for (const source of settlements) {
      const sourcePeople = this.peopleAt(source.id);
      if (sourcePeople.length < 14) continue;
      const sourceCell = this.state.world.cells[source.cellIndex];
      const capacity = 52 + (sourceCell?.habitability ?? 0.5) * 175 + source.buildings * 4;
      const candidates = settlements.filter((candidate) => candidate.id !== source.id)
        .sort((a, b) => this.migrationAppeal(b, source) - this.migrationAppeal(a, source));
      let target = candidates[0];
      if (!target) continue;
      const opportunity = Math.max(0, target.prosperity - source.prosperity - 0.06);
      let connectedRoute = this.route(source.id, target.id);
      const specializationPull = target.specialization !== source.specialization ? 0.055 : 0;
      const networkPull = connectedRoute ? 0.035 + (this.relation(source.id, target.id)?.tradeDependency ?? 0) * 0.06 : 0;
      const targetPeople = this.peopleAt(target.id);
      const targetIds = new Set(targetPeople.map((person) => person.id));
      const familyLinks = sourcePeople.filter((person) => person.parents.some((id) => targetIds.has(id)) || person.children.some((id) => targetIds.has(id)) || Boolean(person.partnerId && targetIds.has(person.partnerId))).length;
      const familyPull = clamp(familyLinks / Math.max(4, sourcePeople.length) * 0.8, 0, 0.12);
      const pressure = clamp(
        Math.max(0, sourcePeople.length / capacity - 0.62) * 1.25
        + Math.max(0, 0.5 - source.foodSecurity) * 1.5
        + source.climateStress * 0.24
        + source.conflictPressure * 0.42
        + opportunity * 0.52
        + specializationPull
        + networkPull
        + familyPull,
      );
      if (pressure < 0.025 || !this.random.chance(0.012 + pressure * 0.2)) continue;
      if (this.migrationAppeal(target, source) < 0.05) continue;
      target = candidates.find((candidate) => {
        if (this.migrationAppeal(candidate, source) < 0.05) return false;
        const destination = this.peopleSystem.walkability.nearestWalkable(candidate.position);
        const path = this.peopleSystem.walkability.route(source.position, destination);
        const arrival = path[path.length - 1];
        return arrival && distance(arrival, destination) <= 0.05;
      });
      if (!target) continue;
      connectedRoute = this.route(source.id, target.id);
      const movers = sourcePeople
        .filter((person) => person.ageMonths > 14 * 12 && person.ageMonths < 58 * 12)
        .sort((a, b) => (b.traits.riskTolerance + b.traits.ambition) - (a.traits.riskTolerance + a.traits.ambition))
        .slice(0, Math.max(2, Math.min(9, Math.ceil(pressure * 7))));
      const moved: Person[] = [];
      for (const person of movers) {
        if (!this.peopleSystem.beginMigration(person, target, this.state, connectedRoute)) continue;
        const indexedSource = this.peopleBySettlement.get(source.id);
        const indexedPosition = indexedSource?.indexOf(person) ?? -1;
        if (indexedSource && indexedPosition >= 0) indexedSource.splice(indexedPosition, 1);
        person.homeId = target.id;
        const indexedTarget = this.peopleBySettlement.get(target.id) ?? [];
        indexedTarget.push(person);
        this.peopleBySettlement.set(target.id, indexedTarget);
        moved.push(person);
      }
      this.applyKnowledgeEvents(this.knowledgeSystem.diffuseMigration(this.state, source, target, moved.length));
      this.state.stats.migrations += moved.length;
      if (moved.length >= 3) {
        const causes = [
          ...(source.foodSecurity < 0.4 ? ['food-scarcity'] : []),
          ...(source.conflictPressure > 0.28 ? ['conflict'] : []),
          ...(source.climateStress > 0.24 ? ['climate-stress'] : []),
          ...(sourcePeople.length / capacity > 0.62 ? ['population-pressure'] : []),
          ...(opportunity > 0 ? ['opportunity'] : []),
          ...(familyPull > 0 ? ['family-networks'] : []),
        ];
        this.addEvent({
          type: 'major-migration', location: source.position, locationId: source.id, actors: [source.id, target.id, ...moved.map((person) => person.id)],
          causes: causes.length > 0 ? causes : ['specialized-work'],
          context: { from: source.name, to: target.name, distance: distance(source.position, target.position), climateStress: source.climateStress, conflictPressure: source.conflictPressure }, outcome: `${moved.length} people resettled in ${target.name}.`,
          affectedPopulation: moved.length, magnitude: clamp(moved.length / 12), significance: clamp(0.35 + moved.length / 25), tags: ['migration', 'culture-transfer'],
          summary: `${moved.length} people leave ${source.name} for ${target.name}.`,
        });
      }
    }
  }

  private migrationAppeal(target: Settlement, source: Settlement): number {
    const relation = this.relation(source.id, target.id);
    const travelPenalty = distance(source.position, target.position) / (this.state.world.size * this.state.world.cellSize) * 0.58;
    return target.foodSecurity * 0.44 + target.prosperity * 0.3 + (relation?.trust ?? 0.15) * 0.18 + (relation?.culturalAffinity ?? 0.15) * 0.12 - travelPenalty - target.conflictPressure * 0.3 - target.climateStress * 0.12;
  }

  private runTrade(): void {
    for (const route of this.state.tradeRoutes.filter((candidate) => candidate.active)) {
      const a = this.settlement(route.a);
      const b = this.settlement(route.b);
      if (!a?.alive || !b?.alive) {
        route.active = false;
        continue;
      }
      route.ageMonths += 1;
      const delivered = this.transportationSystem.advanceFreight(route, a, b);
      const exchanged = delivered?.quantity ?? 0;
      if (exchanged > 0) {
        const gain = exchanged * 0.022;
        a.resources.wealth += gain;
        b.resources.wealth += gain;
        this.state.stats.trades += 1;
        const relation = this.relation(a.id, b.id);
        if (relation) {
          relation.tradeDependency = clamp(relation.tradeDependency * 0.98 + Math.min(0.02, exchanged * 0.0015));
          relation.trust = clamp(relation.trust + 0.0004);
        }
        for (const cultureId of [...Object.keys(a.cultureShares), ...Object.keys(b.cultureShares)]) {
          const culture = this.culture(cultureId);
          if (culture) culture.memory.tradeSuccess += exchanged * 0.0002;
        }
      }
      if (delivered) {
        this.applyKnowledgeEvents(this.knowledgeSystem.diffuseTrade(this.state, a, b, route));
        this.diffuseRouteCultures(a, b, route.volume);
      }
      if (route.volume < 0.08) route.active = false;
    }
  }

  private runDiplomacy(): void {
    for (const relation of this.state.relations) {
      const a = this.settlement(relation.a);
      const b = this.settlement(relation.b);
      if (!a?.alive || !b?.alive) continue;
      const physicalDistance = distance(a.position, b.position);
      const cultureA = this.dominantCulture(a);
      const cultureB = this.dominantCulture(b);
      if (!relation.contact) {
        const reachable = physicalDistance < this.state.world.size * this.state.world.cellSize * 0.56;
        const curiosity = ((cultureA?.dimensions.curiosity ?? 0.5) + (cultureB?.dimensions.curiosity ?? 0.5)) / 2;
        if (reachable && this.random.chance(clamp((0.16 + curiosity * 0.2) * this.config.society.contactRate))) this.makeFirstContact(relation, a, b);
        continue;
      }
      const tradeRoute = this.state.tradeRoutes.find(route => route.active && ((route.a === a.id && route.b === b.id) || (route.a === b.id && route.b === a.id)));
      const connected = Boolean(tradeRoute?.transport?.path);
      const affinity = cultureA?.id === cultureB?.id ? 0.84 : this.culturalAffinity(cultureA, cultureB);
      relation.culturalAffinity = clamp(relation.culturalAffinity * 0.9 + affinity * 0.1);
      const pressureA = 1 - a.foodSecurity;
      const pressureB = 1 - b.foodSecurity;
      const proximity = clamp(1 - physicalDistance / 85);
      const politicalAmbition = mean([...this.peopleAt(a.id), ...this.peopleAt(b.id)].map((person) => person.traits.ambition));
      const rivalry = ((cultureA?.dimensions.militarism ?? 0.5) + (cultureB?.dimensions.militarism ?? 0.5) + politicalAmbition) / 3 * (1 - relation.trust) * proximity;
      relation.territorialTension = clamp(relation.territorialTension * 0.86 + proximity * Math.max(pressureA, pressureB) * 0.2 + rivalry * 0.12);
      const wealthGap = Math.abs(a.resources.wealth - b.resources.wealth) / Math.max(25, a.resources.wealth + b.resources.wealth);
      const polityRivalry = a.polityId !== b.polityId ? politicalAmbition * proximity * 0.018 : 0;
      relation.grievances = clamp(relation.grievances * 0.94 + (connected ? wealthGap * 0.012 : Math.max(pressureA, pressureB) * 0.018) + polityRivalry);
      relation.hostility = clamp(relation.hostility * 0.95 + relation.territorialTension * 0.042 + relation.grievances * 0.032 + (1 - relation.culturalAffinity) * 0.012 - (connected ? 0.008 : 0) + this.random.range(-0.018, 0.018));
      relation.trust = clamp(relation.trust + (connected ? 0.012 : -0.007) + relation.culturalAffinity * 0.006 - relation.hostility * 0.016);
      const tradeInterest = mean([cultureA?.dimensions.tradeOrientation ?? 0.5, cultureB?.dimensions.tradeOrientation ?? 0.5]);
      if (!tradeRoute && !this.warBetween(a.id, b.id) && relation.trust + relation.culturalAffinity + tradeInterest > 1.35 && this.random.chance(clamp((0.28 + tradeInterest * 0.28) * this.config.society.tradeConnectivity))) {
        this.establishTrade(a, b, relation);
      } else if (tradeRoute) {
        tradeRoute.volume = clamp(tradeRoute.volume + relation.trust * 0.035 - relation.hostility * 0.06, 0, 2.4);
      }
      if (!relation.allied && relation.trust > 0.72 && relation.tradeDependency > 0.2 && relation.hostility < 0.25 && this.random.chance(0.06)) {
        relation.allied = true;
        relation.allianceObligation = 0.42;
        this.addEvent({ type: 'alliance-formed', location: a.position, actors: [a.id, b.id], causes: ['mutual-trust', 'trade-dependency'], context: { trust: relation.trust }, outcome: 'The communities pledged mutual aid.', affectedPopulation: this.peopleAt(a.id).length + this.peopleAt(b.id).length, magnitude: 0.64, significance: 0.72, tags: ['diplomacy', 'alliance'], summary: `${a.name} and ${b.name} form an alliance.` });
      } else if (relation.allied && (relation.hostility > 0.58 || relation.trust < 0.3)) {
        relation.allied = false;
        relation.allianceObligation = 0;
        this.addEvent({ type: 'alliance-ended', location: a.position, actors: [a.id, b.id], causes: ['declining-trust'], context: { hostility: relation.hostility }, outcome: 'Mutual obligations lapsed.', affectedPopulation: 0, magnitude: 0.4, significance: 0.5, tags: ['diplomacy'], summary: `The alliance of ${a.name} and ${b.name} dissolves.` });
      }
      const aggression = mean([cultureA?.dimensions.militarism ?? 0.5, cultureB?.dimensions.militarism ?? 0.5]);
      const conflictPressure = relation.hostility * 0.85 + relation.grievances * 0.65 + relation.territorialTension * 0.7 + aggression * 0.3 - relation.tradeDependency * 0.1 - relation.trust * 0.08 - (relation.allied ? 0.16 : 0);
      const sharedPolity = a.polityId === b.polityId ? this.polity(a.polityId) : undefined;
      const civilConflictPossible = !sharedPolity || sharedPolity.phase === 'declining';
      const civilConflictScale = sharedPolity ? 0.35 : 1;
      if (civilConflictPossible && !this.warBetween(a.id, b.id) && conflictPressure > 0.25 && this.random.chance(clamp((conflictPressure - 0.23) * 0.05 * civilConflictScale * this.config.society.conflictRate))) this.startWar(a, b, relation);
    }
  }

  private makeFirstContact(relation: Relation, a: Settlement, b: Settlement): void {
    relation.contact = true;
    relation.firstContactMonth = this.state.month;
    const cultureA = this.dominantCulture(a);
    const cultureB = this.dominantCulture(b);
    const openness = mean([cultureA?.dimensions.outsiderOpenness ?? 0.5, cultureB?.dimensions.outsiderOpenness ?? 0.5]);
    relation.trust = clamp(0.18 + openness * 0.34 + this.random.range(-0.08, 0.08));
    relation.hostility = clamp((1 - openness) * 0.28 + this.random.range(0, 0.12));
    if (cultureA && cultureB && cultureA.id !== cultureB.id) {
      cultureA.memory.tradeSuccess += relation.trust * 0.08;
      cultureB.memory.tradeSuccess += relation.trust * 0.08;
      if (relation.hostility > relation.trust) {
        cultureA.memory.frontierViolence += relation.hostility * 0.06;
        cultureB.memory.frontierViolence += relation.hostility * 0.06;
      }
      this.nudgeCultures(cultureA, cultureB, openness * 0.004);
    }
    this.addEvent({
      type: 'first-contact', location: { x: (a.position.x + b.position.x) / 2, z: (a.position.z + b.position.z) / 2 }, actors: [a.id, b.id, cultureA?.id ?? '', cultureB?.id ?? ''].filter(Boolean),
      causes: ['travel', 'expanding-horizons'], context: { distance: distance(a.position, b.position), openness },
      outcome: relation.trust > relation.hostility ? 'The encounter ended in cautious exchange.' : 'The encounter ended in mutual suspicion.',
      affectedPopulation: this.peopleAt(a.id).length + this.peopleAt(b.id).length, magnitude: 0.9, significance: 0.94,
      tags: ['contact', relation.trust > relation.hostility ? 'exchange' : 'tension'], summary: `${a.name} and ${b.name} meet for the first time.`,
    });
  }

  private establishTrade(a: Settlement, b: Settlement, relation: Relation): void {
    const mode = 'land' as const;
    const route: TradeRoute = { id: `route-${this.nextRouteId}`, a: a.id, b: b.id, volume: 0.42, ageMonths: 0, caravanProgress: 0, caravanDirection: 1, mode, knowledgeFlow: 0, cumulativeKnowledge: 0, active: true };
    if (!this.transportationSystem.planTrade(route, a, b)) return;
    this.nextRouteId++;
    this.state.tradeRoutes.push(route);
    for (const settlementId of [route.a, route.b]) {
      const routes = this.routesBySettlement.get(settlementId) ?? [];
      routes.push(route);
      this.routesBySettlement.set(settlementId, routes);
    }
    relation.tradeDependency = 0.08;
    this.addEvent({
      type: 'trade-route-established', location: { x: (a.position.x + b.position.x) / 2, z: (a.position.z + b.position.z) / 2 }, actors: [a.id, b.id],
      causes: ['complementary-surplus', 'mutual-trust'], context: { distance: distance(a.position, b.position), mode: route.mode }, outcome: 'The communities commission a surveyed trade corridor; exchange awaits completed infrastructure.',
      affectedPopulation: this.peopleAt(a.id).length + this.peopleAt(b.id).length, magnitude: 0.58, significance: 0.62, tags: ['trade', 'route', route.mode], summary: `A trade corridor is commissioned between ${a.name} and ${b.name}.`,
    });
  }

  private runInstitutions(): void {
    for (const settlement of this.livingSettlements()) {
      const population = this.peopleAt(settlement.id).length;
      if (population < 32) continue;
      const culture = this.dominantCulture(settlement);
      if (!culture) continue;
      const present = new Set(settlement.institutionIds.map((id) => this.institution(id)?.kind));
      const artisanShare = this.peopleAt(settlement.id).filter((person) => person.occupation === 'artisan').length / population;
      const routeCount = this.state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
      const possibilities: Array<{ kind: InstitutionKind; pressure: number; cause: string }> = [
        { kind: 'council', pressure: culture.dimensions.cooperation * 0.55 + population / 220 + settlement.prosperity * 0.18, cause: 'need-for-coordination' },
        { kind: 'temple', pressure: culture.dimensions.religiousTendency * 0.64 + population / 300, cause: 'shared-ritual-practice' },
        { kind: 'merchant-association', pressure: culture.dimensions.tradeOrientation * 0.54 + routeCount * 0.24, cause: 'regular-long-distance-trade' },
        { kind: 'military-order', pressure: culture.dimensions.militarism * 0.42 + this.hostilityAround(settlement.id) * 0.55, cause: 'persistent-external-threat' },
        { kind: 'craft-circle', pressure: settlement.resources.goods / Math.max(25, population) + artisanShare * 2.4 + settlement.infrastructure.workshops * 0.36 + (settlement.specialization === 'craft' ? 0.35 : 0), cause: 'specialized-production' },
        { kind: 'knowledge-keepers', pressure: culture.dimensions.curiosity * 0.6 + culture.dimensions.longTermOrientation * 0.34, cause: 'preservation-of-knowledge' },
      ];
      const candidate = possibilities.filter(({ kind }) => !present.has(kind)).sort((a, b) => b.pressure - a.pressure)[0];
      const administrativeCapacity = 2 + Math.floor(settlement.knowledge.literacy * 3) + (settlement.infrastructure.archives > 0.18 ? 1 : 0);
      if (settlement.institutionIds.length < administrativeCapacity && candidate && candidate.pressure > 0.73 && this.random.chance((candidate.pressure - 0.67) * 0.32)) this.formInstitution(settlement, culture, candidate.kind, candidate.cause);
      for (const institutionId of settlement.institutionIds) {
        const institution = this.institution(institutionId);
        if (!institution) continue;
        institution.support = clamp(institution.support + (settlement.prosperity - 0.42) * 0.025 + this.random.range(-0.02, 0.02));
        institution.prestige = clamp(institution.prestige + (institution.support - 0.5) * 0.02);
        institution.resources = Math.max(0, institution.resources + settlement.resources.wealth * 0.002 - 0.04);
        institution.reach = clamp(institution.reach + routeCount * 0.008);
        institution.members = Math.max(2, Math.round(population * institution.support * (0.08 + institution.reach * 0.08)));
      }
    }
  }

  private formInstitution(settlement: Settlement, culture: Culture, kind: InstitutionKind, cause: string): void {
    const institution: Institution = {
      id: `institution-${this.nextInstitutionId++}`,
      name: `${settlement.name} ${INSTITUTION_NAMES[kind]}`,
      kind, settlementId: settlement.id, cultureId: culture.id, foundedMonth: this.state.month,
      support: 0.42 + this.random.range(0, 0.2), prestige: 0.35, resources: 4, reach: 0.2,
      members: Math.max(3, Math.round(this.peopleAt(settlement.id).length * 0.05)),
      interests: [...INSTITUTION_INTERESTS[kind]],
    };
    this.state.institutions.push(institution);
    settlement.institutionIds.push(institution.id);
    settlement.politicalPower.institutional = clamp(settlement.politicalPower.institutional + 0.08);
    const powerKey: Partial<Record<InstitutionKind, keyof PoliticalPower>> = { council: 'council', temple: 'religious', 'merchant-association': 'merchant', 'military-order': 'military' };
    const key = powerKey[kind];
    if (key) settlement.politicalPower[key] = clamp(settlement.politicalPower[key] + 0.11);
    this.addEvent({
      type: 'institution-formed', location: settlement.position, locationId: settlement.id, actors: [institution.id, settlement.id, culture.id], causes: [cause],
      context: { kind }, outcome: `${institution.name} gained recognized members and resources.`, affectedPopulation: this.peopleAt(settlement.id).length,
      magnitude: 0.52, significance: 0.67, tags: ['institution', kind], summary: `${institution.name} forms in ${settlement.name}.`,
    });
  }

  private runPolitics(): void {
    for (const settlement of this.livingSettlements()) {
      const power = settlement.politicalPower;
      const culture = this.dominantCulture(settlement);
      const localPeople = this.peopleAt(settlement.id);
      const prestigeLeader = [...localPeople].sort((a, b) => this.leadershipScore(b, settlement) - this.leadershipScore(a, settlement))[0];
      power.personalPrestige = clamp(prestigeLeader?.prestige ?? power.personalPrestige);
      power.kinship = clamp(power.kinship * 0.98 + 0.008);
      power.council = clamp(power.council + (culture?.dimensions.cooperation ?? 0.5) * 0.008);
      power.merchant = clamp(power.merchant + this.routesAt(settlement.id).length * 0.009);
      power.military = clamp(power.military + this.hostilityAround(settlement.id) * 0.012);
      power.wealth = clamp(power.wealth * 0.92 + Math.min(1, settlement.resources.wealth / Math.max(20, localPeople.length)) * 0.08);
    }
    // A polity is assessed once per year. Confederations previously churned because each
    // member settlement could independently replace the shared arrangement in one pass.
    for (const polity of this.state.polities) {
      const settlements = polity.settlementIds.map((id) => this.settlement(id)).filter((settlement): settlement is Settlement => Boolean(settlement?.alive));
      const capital = this.settlement(polity.capitalId) ?? settlements[0];
      if (!capital || settlements.length === 0) continue;
      const polityPeople = settlements.flatMap((settlement) => this.peopleAt(settlement.id));
      const currentLeader = this.person(polity.leadingPersonId ?? '');
      if (!currentLeader) {
        const successor = [...polityPeople].filter((person) => person.ageMonths >= 18 * 12).sort((a, b) => this.leadershipScore(b, capital) - this.leadershipScore(a, capital))[0];
        const previousLeaderId = polity.leadingPersonId;
        polity.leadingPersonId = successor?.id;
        if (successor) {
          const dynasticContinuity = polity.dynastyHouseholdId === successor.householdId;
          if (!polity.dynastyHouseholdId || !dynasticContinuity) {
            polity.dynastyHouseholdId = successor.householdId;
            polity.dynastyName = `House of ${successor.name}`;
            polity.dynastyStartedMonth = this.state.month;
          }
          if (previousLeaderId) {
            polity.successionCount += 1;
            this.addEvent({
              type: 'leadership-succession', location: capital.position, locationId: capital.id,
              actors: [polity.id, capital.id, successor.id, previousLeaderId], causes: ['leadership-vacancy', dynasticContinuity ? 'dynastic-continuity' : 'new-ruling-house'],
              context: { previousLeaderId, successorId: successor.id, dynasty: polity.dynastyName ?? 'unrecorded house', dynastyYears: Math.floor((this.state.month - (polity.dynastyStartedMonth ?? this.state.month)) / 12) },
              outcome: `${successor.name} became the recognized leader of ${polity.name}.`, affectedPopulation: polityPeople.length,
              magnitude: dynasticContinuity ? 0.45 : 0.62, significance: dynasticContinuity ? 0.6 : 0.72, tags: ['politics', 'succession', dynasticContinuity ? 'dynasty' : 'new-dynasty'],
              summary: `${polity.name} recognizes ${successor.name} in succession.`,
            });
          }
        }
      }
      const averageProsperity = mean(settlements.map((settlement) => settlement.prosperity));
      const administrativeMemory = mean(settlements.map((settlement) => (settlement.politicalPower.institutional + settlement.politicalPower.council) / 2));
      const conflict = mean(settlements.map((settlement) => settlement.conflictPressure));
      const connectedRoutes = this.state.tradeRoutes.filter((route) => route.active && route.transport?.path && polity.settlementIds.includes(route.a) && polity.settlementIds.includes(route.b));
      const integration = clamp(connectedRoutes.length / Math.max(1, settlements.length - 1));
      const stabilityTarget = clamp(polity.legitimacy * 0.35 + administrativeMemory * 0.25 + averageProsperity * 0.18 + integration * 0.18 + Math.min(0.12, polity.successionCount * 0.015) - conflict * 0.28);
      polity.stability += (stabilityTarget - polity.stability) * 0.12;
      polity.legitimacy = clamp(polity.legitimacy + (averageProsperity - 0.44) * 0.018 + administrativeMemory * 0.006 + integration * 0.004 - conflict * 0.014);
      const ageYears = (this.state.month - polity.formedMonth) / 12;
      const previousPhase = polity.phase;
      polity.phase = polity.stability < 0.27 || conflict > 0.72 ? 'declining'
        : polity.stability < 0.4 || conflict > 0.5 ? 'stressed'
          : ageYears >= this.config.historicalPace.polityMaturityYears && polity.stability >= 0.5 ? 'mature'
            : ageYears >= this.config.historicalPace.polityConsolidationYears ? 'consolidation'
              : 'formation';
      if (previousPhase !== polity.phase) polity.phaseSinceMonth = this.state.month;
      const previousArrangement = polity.arrangement;
      const proposed = this.powerArrangement(capital.politicalPower);
      if (previousArrangement !== proposed && this.state.month - polity.lastTransitionMonth >= this.config.historicalPace.minimumRegimeYears * 12 && (polity.phase === 'stressed' || polity.phase === 'declining' || polity.stability > 0.58)) {
        polity.arrangement = proposed;
        polity.lastTransitionMonth = this.state.month;
        this.addEvent({ type: 'political-transition', location: capital.position, locationId: capital.id, actors: [polity.id, capital.id, ...(polity.leadingPersonId ? [polity.leadingPersonId] : [])], causes: [polity.phase === 'declining' ? 'legitimacy-crisis' : 'accumulated-shifting-influence'], context: { from: previousArrangement, to: proposed, phase: polity.phase, stability: polity.stability, leader: polity.leadingPersonId ?? 'collective' }, outcome: `${proposed} became the dominant political arrangement after a prolonged transition.`, affectedPopulation: polityPeople.length, magnitude: 0.58, significance: 0.69, tags: ['politics', polity.phase], summary: `${polity.name} passes from ${previousArrangement} to ${proposed}.` });
      }
    }
    const candidateRelations = this.state.relations.filter((relation) => relation.contact && relation.trust > 0.65 && (relation.allied || relation.tradeDependency > 0.28));
    for (const relation of candidateRelations) {
      const a = this.settlement(relation.a);
      const b = this.settlement(relation.b);
      if (!a || !b || a.polityId === b.polityId || this.warBetween(a.id, b.id)) continue;
      const polityA = this.polity(a.polityId);
      const polityB = this.polity(b.polityId);
      if (!polityA || !polityB) continue;
      const sharedRoute = this.route(a.id, b.id);
      const oldEnough = this.state.month - polityA.formedMonth >= this.config.historicalPace.minimumRegimeYears * 12 && this.state.month - polityB.formedMonth >= this.config.historicalPace.minimumRegimeYears * 12;
      const integratedLongEnough = (sharedRoute?.ageMonths ?? 0) >= 12 * 12 || relation.allianceObligation >= 0.62;
      if (!oldEnough || !integratedLongEnough || !this.random.chance(clamp(0.025 * this.config.society.politicalIntegration))) continue;
      const winner = polityA.legitimacy >= polityB.legitimacy ? polityA : polityB;
      const absorbed = winner === polityA ? polityB : polityA;
      for (const settlementId of absorbed.settlementIds) {
        const settlement = this.settlement(settlementId);
        if (settlement) settlement.polityId = winner.id;
        if (!winner.settlementIds.includes(settlementId)) winner.settlementIds.push(settlementId);
      }
      winner.name = `${this.settlement(winner.capitalId)?.name ?? 'River'} Confederation`;
      winner.legitimacy = clamp((winner.legitimacy + absorbed.legitimacy) / 2 + 0.05);
      winner.lastTransitionMonth = this.state.month;
      this.state.polities = this.state.polities.filter((polity) => polity.id !== absorbed.id);
      this.addEvent({ type: 'political-transition', location: a.position, actors: [winner.id, absorbed.id, a.id, b.id], causes: ['trade-integration', 'alliance-obligations'], context: { settlements: winner.settlementIds.length }, outcome: `${winner.name} integrated several communities.`, affectedPopulation: winner.settlementIds.reduce((sum, id) => sum + this.peopleAt(id).length, 0), magnitude: 0.74, significance: 0.82, tags: ['politics', 'integration'], summary: `${winner.name} emerges from sustained cooperation.` });
    }
    // Confederations can also fracture. This preserves genuine state plurality for later
    // strategic systems without inventing a new actor independently of lived politics.
    for (const polity of [...this.state.polities]) {
      const settlements = polity.settlementIds.map((id) => this.settlement(id)).filter((settlement): settlement is Settlement => Boolean(settlement?.alive));
      if (settlements.length < 2 || this.state.month - polity.lastTransitionMonth < this.config.historicalPace.minimumRegimeYears * 12 || polity.phase !== 'declining') continue;
      const capital = this.settlement(polity.capitalId);
      if (!capital) continue;
      const capitalCulture = this.dominantCulture(capital)?.id;
      const candidate = settlements.filter((settlement) => settlement.id !== capital.id).map((settlement) => {
        const relation = this.relation(capital.id, settlement.id);
        const culturalDifference = capitalCulture !== this.dominantCulture(settlement)?.id ? 1 : 0;
        const internalWar = this.state.wars.some((war) => war.active && ((war.attacker === capital.id && war.defender === settlement.id) || (war.defender === capital.id && war.attacker === settlement.id)));
        const advancedFragmentation = this.state.advanced.scale === 'modern-statistical' ? this.state.advanced.governance.fragmentation : 0;
        const pressure = clamp(settlement.conflictPressure * 0.32 + (relation?.hostility ?? 0) * 0.22 + (relation?.grievances ?? 0) * 0.14 + culturalDifference * 0.1 + advancedFragmentation * 0.14 + (internalWar ? 0.28 : 0) - polity.legitimacy * 0.24 - polity.stability * 0.16);
        return { settlement, pressure, culturalDifference, internalWar };
      }).sort((a, b) => b.pressure - a.pressure)[0];
      if (!candidate || candidate.pressure < 0.56 || !this.random.chance(clamp(((candidate.pressure - 0.52) * 0.035 + (candidate.internalWar ? 0.025 : 0)) * this.config.society.politicalFragmentation))) continue;
      const culture = this.dominantCulture(candidate.settlement) ?? this.state.cultures[0];
      if (!culture) continue;
      const successor: Polity = {
        id: `polity-${this.nextPolityId++}`,
        name: `${candidate.settlement.name} Assembly`,
        settlementIds: [candidate.settlement.id],
        capitalId: candidate.settlement.id,
        formedMonth: this.state.month,
        lastTransitionMonth: this.state.month,
        arrangement: this.powerArrangement(candidate.settlement.politicalPower),
        legitimacy: clamp(0.38 + candidate.settlement.politicalPower.council * 0.24 + candidate.settlement.politicalPower.institutional * 0.18),
        phase: 'formation', phaseSinceMonth: this.state.month, stability: 0.38,
        successionCount: 0,
      };
      polity.settlementIds = polity.settlementIds.filter((id) => id !== candidate.settlement.id);
      polity.lastTransitionMonth = this.state.month;
      polity.legitimacy = clamp(polity.legitimacy - 0.08);
      candidate.settlement.polityId = successor.id;
      this.state.polities.push(successor);
      this.addEvent({
        type: 'political-transition', location: candidate.settlement.position, locationId: candidate.settlement.id,
        actors: [polity.id, successor.id, candidate.settlement.id, culture.id],
        causes: ['political-fragmentation', ...(candidate.culturalDifference ? ['cultural-autonomy'] : []), candidate.internalWar || candidate.settlement.conflictPressure > 0.6 ? 'sustained-conflict' : 'legitimacy-crisis'],
        context: { fromPolity: polity.id, toPolity: successor.id, secessionPressure: candidate.pressure },
        outcome: `${candidate.settlement.name} left ${polity.name} and formed an independent polity.`,
        affectedPopulation: settlementRepresentedPopulation(this.state, candidate.settlement.id), magnitude: 0.72, significance: 0.84,
        tags: ['politics', 'fragmentation', 'secession'], summary: `${candidate.settlement.name} separates from ${polity.name}.`,
      });
      break;
    }
  }

  private runCulture(): void {
    for (const culture of this.state.cultures) {
      const before = { ...culture.dimensions };
      const memory = culture.memory;
      const settlements = this.livingSettlements().filter((settlement) => settlement.cultureShares[culture.id]);
      if (settlements.length === 0) {
        for (const key of Object.keys(memory) as Array<keyof typeof memory>) memory[key] *= 0.76;
        continue;
      }
      const prosperity = mean(settlements.map((settlement) => settlement.prosperity));
      const culturalInstitutions = this.state.institutions.filter((institution) => institution.cultureId === culture.id);
      const institutionStability = mean(culturalInstitutions.map((institution) => institution.support * 0.55 + institution.prestige * 0.45));
      const templePrestige = mean(culturalInstitutions.filter((institution) => institution.kind === 'temple').map((institution) => institution.prestige));
      const knowledge = mean(settlements.map((settlement) => this.knowledgeBreadth(settlement)));
      const powerConcentration = mean(settlements.map((settlement) => {
        const values = Object.values(settlement.politicalPower);
        return Math.max(...values) - mean(values);
      }));
      culture.dimensions.outsiderOpenness = clamp(culture.dimensions.outsiderOpenness + memory.tradeSuccess * 0.0008 - memory.frontierViolence * 0.003);
      culture.dimensions.tradeOrientation = clamp(culture.dimensions.tradeOrientation + memory.tradeSuccess * 0.0009);
      culture.dimensions.cooperation = clamp(culture.dimensions.cooperation + memory.collectiveSuccess * 0.002 - memory.frontierViolence * 0.0008);
      culture.dimensions.militarism = clamp(culture.dimensions.militarism + memory.militarySuccess * 0.0022 + memory.frontierViolence * 0.001);
      culture.dimensions.institutionalTrust = clamp(culture.dimensions.institutionalTrust + (institutionStability - 0.48) * 0.004 + (prosperity - 0.45) * 0.002);
      culture.dimensions.curiosity = clamp(culture.dimensions.curiosity + memory.tradeSuccess * 0.0007 + this.random.range(-0.002, 0.002));
      culture.dimensions.hierarchy = clamp(culture.dimensions.hierarchy + (powerConcentration - 0.16) * 0.003);
      culture.dimensions.religiousTendency = clamp(culture.dimensions.religiousTendency + (templePrestige - 0.42) * 0.0015);
      culture.dimensions.longTermOrientation = clamp(culture.dimensions.longTermOrientation + (knowledge - 0.38) * 0.002 + memory.collectiveSuccess * 0.0006);
      for (const key of Object.keys(memory) as Array<keyof typeof memory>) memory[key] *= 0.76;
      const totalShift = Object.keys(before).reduce((sum, key) => sum + Math.abs(before[key as keyof CultureDimensions] - culture.dimensions[key as keyof CultureDimensions]), 0);
      if (this.state.month % 240 === 0 && totalShift > 0.002) {
        const largestShift = (Object.keys(before) as Array<keyof CultureDimensions>).sort((a, b) => Math.abs(before[b] - culture.dimensions[b]) - Math.abs(before[a] - culture.dimensions[a]))[0];
        this.addEvent({ type: 'cultural-shift', actors: [culture.id], causes: ['accumulated-experience'], context: { dimension: largestShift ?? 'custom', shift: totalShift }, outcome: `${culture.name} custom changed gradually through lived history.`, affectedPopulation: this.state.people.filter((person) => person.cultureId === culture.id).length, magnitude: clamp(totalShift * 8), significance: 0.42, tags: ['culture', largestShift ?? 'drift'], summary: `${culture.name} traditions place new emphasis on ${largestShift ?? 'collective memory'}.` });
      }
    }
  }

  private startWar(a: Settlement, b: Settlement, relation: Relation): void {
    const cultureA = this.dominantCulture(a);
    const cultureB = this.dominantCulture(b);
    const ambitionA = mean(this.peopleAt(a.id).map((person) => person.traits.ambition));
    const ambitionB = mean(this.peopleAt(b.id).map((person) => person.traits.ambition));
    const attacker = ambitionA + (cultureA?.dimensions.militarism ?? 0.5) >= ambitionB + (cultureB?.dimensions.militarism ?? 0.5) ? a : b;
    const defender = attacker === a ? b : a;
    const cause: WarCause = relation.grievances > 0.62 ? 'retaliation' : relation.territorialTension > 0.62 ? 'territorial-dispute' : Math.min(a.foodSecurity, b.foodSecurity) < 0.3 ? 'resource-pressure' : 'political-ambition';
    const leaderA = this.leaderFor(attacker);
    const leaderB = this.leaderFor(defender);
    const attackerCulture = this.dominantCulture(attacker);
    const defenderCulture = this.dominantCulture(defender);
    const war: War = {
      id: `war-${this.nextWarId++}`, attacker: attacker.id, defender: defender.id, cause, startMonth: this.state.month,
      strengthA: this.militaryStrength(attacker), strengthB: this.militaryStrength(defender), casualtiesA: 0, casualtiesB: 0, progress: 0,
      phase: 'mobilizing', marchProgress: 0,
      moraleA: clamp(attacker.foodSecurity * 0.42 + (attackerCulture?.dimensions.militarism ?? 0.5) * 0.3 + attacker.prosperity * 0.18),
      moraleB: clamp(defender.foodSecurity * 0.42 + (defenderCulture?.dimensions.cooperation ?? 0.5) * 0.24 + defender.prosperity * 0.2),
      organizationA: clamp(attacker.politicalPower.military * 0.54 + attacker.politicalPower.institutional * 0.28 + attacker.politicalPower.council * 0.12),
      organizationB: clamp(defender.politicalPower.military * 0.54 + defender.politicalPower.institutional * 0.28 + defender.politicalPower.council * 0.12),
      leadershipA: leaderA ? this.leadershipScore(leaderA, attacker) : 0.3,
      leadershipB: leaderB ? this.leadershipScore(leaderB, defender) : 0.3,
      technologyA: this.knowledgeSystem.militaryApplication(attacker), technologyB: this.knowledgeSystem.militaryApplication(defender),
      ...(leaderA ? { leaderAId: leaderA.id } : {}), ...(leaderB ? { leaderBId: leaderB.id } : {}), active: true,
    };
    this.state.wars.push(war);
    this.state.stats.wars += 1;
    relation.hostility = clamp(relation.hostility + 0.22);
    relation.grievances = clamp(relation.grievances + 0.18);
    const supporters = this.allianceSupportFor(defender, attacker);
    this.addEvent({ type: 'war-declared', location: attacker.position, actors: [war.id, attacker.id, defender.id, ...(leaderA ? [leaderA.id] : []), ...(leaderB ? [leaderB.id] : []), ...supporters], causes: [cause, ...(supporters.length > 0 ? ['alliance-commitments'] : [])], context: { attackerStrength: war.strengthA, defenderStrength: war.strengthB, moraleA: war.moraleA, moraleB: war.moraleB, organizationA: war.organizationA, organizationB: war.organizationB, technologyA: war.technologyA, technologyB: war.technologyB }, outcome: `${attacker.name} mobilized against ${defender.name}.`, affectedPopulation: this.peopleAt(attacker.id).length + this.peopleAt(defender.id).length, magnitude: 0.8, significance: 0.88, tags: ['war', cause, 'mobilization'], summary: `${attacker.name} goes to war with ${defender.name} over ${cause.replace('-', ' ')}.` });
  }

  private runWars(): void {
    for (const war of this.state.wars.filter((candidate) => candidate.active)) {
      const attacker = this.settlement(war.attacker);
      const defender = this.settlement(war.defender);
      if (!attacker?.alive || !defender?.alive) { war.active = false; continue; }
      if (war.resolvedMonth !== undefined) {
        if (this.state.month - war.resolvedMonth >= 4) war.active = false;
        continue;
      }
      const age = this.state.month - war.startMonth;
      attacker.conflictPressure = clamp(attacker.conflictPressure + 0.035);
      defender.conflictPressure = clamp(defender.conflictPressure + 0.05);
      if (age < 3) {
        war.phase = 'mobilizing';
        attacker.resources.food = Math.max(0, attacker.resources.food - war.strengthA * 0.012);
        defender.resources.food = Math.max(0, defender.resources.food - war.strengthB * 0.008);
        continue;
      }
      if (age < 7) {
        war.phase = 'marching';
        war.marchProgress = clamp((age - 2) / 5);
        attacker.resources.food = Math.max(0, attacker.resources.food - war.strengthA * 0.02);
        continue;
      }
      war.phase = 'battle';
      war.marchProgress = 1;
      const terrain = this.state.world.cells[defender.cellIndex];
      const defensiveAdvantage = 1 + (terrain?.elevation ?? 0.4) * 0.25 + (terrain?.movementCost ?? 1) * 0.04;
      const supplyA = clamp(attacker.foodSecurity * 0.7 + attacker.prosperity * 0.3, 0.1, 1);
      const supplyB = clamp(defender.foodSecurity * 0.7 + defender.prosperity * 0.3, 0.1, 1);
      const combatA = war.strengthA * supplyA * (0.68 + war.organizationA * 0.48) * (0.8 + war.moraleA * 0.38) * (0.9 + war.technologyA * 0.22) * (0.82 + war.leadershipA * 0.34);
      const combatB = war.strengthB * supplyB * defensiveAdvantage * (0.68 + war.organizationB * 0.48) * (0.8 + war.moraleB * 0.38) * (0.9 + war.technologyB * 0.22) * (0.82 + war.leadershipB * 0.34);
      const balance = (combatA - combatB) / Math.max(1, combatA + combatB);
      war.progress = clamp(war.progress + balance * 0.16 + this.random.gaussian(0, 0.045), -1.5, 1.5);
      attacker.resources.food = Math.max(0, attacker.resources.food - war.strengthA * 0.018);
      defender.resources.food = Math.max(0, defender.resources.food - war.strengthB * 0.012);
      if ((age - 7) % 4 === 0) {
        const requestedCasualtiesA = Math.max(0, Math.floor(this.random.range(0, 1.8 + war.strengthB * 0.018)));
        const requestedCasualtiesB = Math.max(0, Math.floor(this.random.range(0, 1.8 + war.strengthA * 0.018)));
        const casualtiesA = this.killCombatants(attacker.id, requestedCasualtiesA);
        const casualtiesB = this.killCombatants(defender.id, requestedCasualtiesB);
        war.casualtiesA += casualtiesA;
        war.casualtiesB += casualtiesB;
        war.moraleA = clamp(war.moraleA + (casualtiesB - casualtiesA) * 0.018 - (1 - supplyA) * 0.05);
        war.moraleB = clamp(war.moraleB + (casualtiesA - casualtiesB) * 0.018 - (1 - supplyB) * 0.05);
        const leadingPerson = war.progress >= 0 ? this.person(war.leaderAId ?? '') : this.person(war.leaderBId ?? '');
        if (leadingPerson) leadingPerson.prestige = clamp(leadingPerson.prestige + 0.025);
        war.strengthA = this.militaryStrength(attacker);
        war.strengthB = this.militaryStrength(defender);
        this.state.stats.battles += 1;
        this.addEvent({ type: 'battle', location: { x: (attacker.position.x + defender.position.x) / 2, z: (attacker.position.z + defender.position.z) / 2 }, actors: [war.id, attacker.id, defender.id, ...(war.leaderAId ? [war.leaderAId] : []), ...(war.leaderBId ? [war.leaderBId] : [])], causes: [war.cause, 'military-mobilization'], context: { casualtiesA, casualtiesB, progress: war.progress, supplyA, supplyB, moraleA: war.moraleA, moraleB: war.moraleB, terrain: terrain?.biome ?? 'unknown' }, outcome: war.progress > 0 ? `${attacker.name} gained ground.` : `${defender.name} held its approaches.`, affectedPopulation: casualtiesA + casualtiesB, magnitude: clamp((casualtiesA + casualtiesB) / 14 + 0.3), significance: 0.72, tags: ['war', 'battle'], summary: `${attacker.name} and ${defender.name} clash; ${casualtiesA + casualtiesB} are lost.` });
      }
      if (age >= 14 && (Math.abs(war.progress) > 0.72 || age > 38 || war.strengthA < 4 || war.strengthB < 4 || war.moraleA < 0.12 || war.moraleB < 0.12)) this.endWar(war, attacker, defender);
    }
  }

  private endWar(war: War, attacker: Settlement, defender: Settlement): void {
    const attackerWon = war.progress > 0.42;
    const defenderWon = war.progress < -0.42;
    war.resolvedMonth = this.state.month;
    war.phase = attackerWon ? 'occupation' : defenderWon ? 'retreat' : 'negotiation';
    const relation = this.relation(attacker.id, defender.id);
    if (relation) {
      relation.hostility = clamp(relation.hostility - 0.16);
      relation.grievances = clamp(relation.grievances + 0.14);
      relation.trust = clamp(relation.trust - 0.16);
      relation.allied = false;
    }
    const winner = attackerWon ? attacker : defenderWon ? defender : undefined;
    const loser = attackerWon ? defender : defenderWon ? attacker : undefined;
    const culture = winner ? this.dominantCulture(winner) : undefined;
    if (culture) culture.memory.militarySuccess += 0.8;
    for (const candidate of [this.dominantCulture(attacker), this.dominantCulture(defender)]) if (candidate) candidate.memory.frontierViolence += 0.6;
    const outcome = attackerWon ? `${attacker.name} imposed tribute.` : defenderWon ? `${defender.name} forced a retreat.` : 'Exhaustion produced a negotiated peace.';
    if (winner && loser) {
      const tributeWealth = Math.min(9, loser.resources.wealth * 0.12);
      const tributeFood = Math.min(18, loser.resources.food * 0.06);
      winner.resources.wealth += tributeWealth;
      winner.resources.food += tributeFood;
      loser.resources.wealth -= tributeWealth;
      loser.resources.food -= tributeFood;
      loser.prosperity = clamp(loser.prosperity - 0.12);
      loser.conflictPressure = clamp(loser.conflictPressure + 0.55);
      winner.politicalPower.military = clamp(winner.politicalPower.military + 0.08);
      this.applyKnowledgeEvents(this.knowledgeSystem.diffuseConquest(this.state, winner, loser));
      const destructionRisk = clamp(0.14 + Math.abs(war.progress) * 0.22 + (war.casualtiesA + war.casualtiesB) / 120);
      if (this.random.chance(destructionRisk)) {
        this.applyKnowledgeEvents(this.knowledgeSystem.damageArchives(this.state, loser, clamp(0.28 + destructionRisk), 'wartime-destruction'));
      }
    } else {
      attacker.conflictPressure = clamp(attacker.conflictPressure + 0.28);
      defender.conflictPressure = clamp(defender.conflictPressure + 0.28);
    }
    this.addEvent({ type: 'war-ended', location: defender.position, actors: [war.id, attacker.id, defender.id, ...(war.leaderAId ? [war.leaderAId] : []), ...(war.leaderBId ? [war.leaderBId] : [])], causes: ['attrition', 'supply-pressure', war.moraleA < 0.2 || war.moraleB < 0.2 ? 'morale-collapse' : 'negotiation'], context: { months: this.state.month - war.startMonth, casualties: war.casualtiesA + war.casualtiesB, phase: war.phase, progress: war.progress }, outcome, affectedPopulation: war.casualtiesA + war.casualtiesB, magnitude: 0.74, significance: 0.84, tags: ['war', 'peace', war.phase], summary: `The war between ${attacker.name} and ${defender.name} ends. ${outcome}` });
  }

  private killCombatants(settlementId: string, requested: number): number {
    const candidates = this.peopleAt(settlementId).filter((person) => person.ageMonths >= 16 * 12 && person.ageMonths <= 57 * 12);
    let killed = 0;
    for (let index = 0; index < requested && candidates.length > 0; index += 1) {
      const person = candidates.splice(this.random.int(0, candidates.length), 1)[0];
      if (person) { this.killPerson(person, 'war'); killed += 1; }
    }
    return killed;
  }

  private runSettlementChange(): void {
    for (const settlement of this.livingSettlements()) {
      const people = this.peopleAt(settlement.id);
      const localPopulation = settlementRepresentedPopulation(this.state, settlement.id);
      if (localPopulation < 4) settlement.depopulationMonths += 12;
      else settlement.depopulationMonths = Math.max(0, settlement.depopulationMonths - 24);
      const declineMatured = settlement.depopulationMonths >= this.config.historicalPace.settlementDeclineYears * 12;
      const oldEnoughToFail = this.state.month - settlement.foundedMonth >= Math.max(20, this.config.historicalPace.settlementDeclineYears) * 12;
      if (localPopulation < 4 && declineMatured && oldEnoughToFail && (this.livingSettlements().length > 1 || people.length === 0)) {
        const survivorCount = people.length;
        this.applyKnowledgeEvents(this.knowledgeSystem.collapseSettlement(this.state, settlement, 'settlement-abandonment'));
        settlement.alive = false;
        const polity = this.polity(settlement.polityId);
        if (polity) {
          polity.settlementIds = polity.settlementIds.filter((id) => id !== settlement.id);
          if (polity.capitalId === settlement.id) polity.capitalId = polity.settlementIds[0] ?? '';
        }
        this.state.polities = this.state.polities.filter((candidate) => candidate.settlementIds.length > 0);
        for (const route of this.routesAt(settlement.id)) route.active = false;
        this.state.stats.settlementsAbandoned += 1;
        const target = this.livingSettlements().filter((other) => other.id !== settlement.id).sort((a, b) => distance(a.position, settlement.position) - distance(b.position, settlement.position))[0];
        const evacuationRoute = target ? this.route(settlement.id, target.id) : undefined;
        if (target) for (const person of [...people]) {
          if (!this.peopleSystem.beginMigration(person, target, this.state, evacuationRoute)) continue;
          const sourceIndex = people.indexOf(person);
          if (sourceIndex >= 0) people.splice(sourceIndex, 1);
          person.homeId = target.id;
          const targetPeople = this.peopleBySettlement.get(target.id) ?? [];
          targetPeople.push(person);
          this.peopleBySettlement.set(target.id, targetPeople);
        }
        this.addEvent({ type: 'settlement-abandoned', location: settlement.position, locationId: settlement.id, actors: [settlement.id], causes: ['population-decline'], context: { survivors: survivorCount }, outcome: 'The remaining households departed.', affectedPopulation: survivorCount, magnitude: 0.66, significance: 0.72, tags: ['collapse', 'migration'], summary: `${settlement.name} is abandoned.` });
        continue;
      }
      const modern = this.state.advanced.scale === 'modern-statistical';
      const represented = representedPopulation(this.state);
      const settlementTarget = modern ? Math.min(12, Math.max(3, Math.round(2 + Math.log10(Math.max(10, represented))))) : 16;
      const growthReady = modern
        ? localPopulation >= 20_000 && people.length >= 18 && settlement.industry.active
        : people.length >= 115;
      if (this.livingSettlements().length >= settlementTarget || !growthReady || settlement.foodSecurity < 0.52 || !this.random.chance(modern ? 0.025 : 0.08)) continue;
      const candidates = this.state.world.cells
        .filter((cell) => !cell.water && cell.habitability > 0.56 && this.livingSettlements().every((other) => distance({ x: cell.worldX, z: cell.worldZ }, other.position) > 16))
        .sort((a, b) => b.habitability + b.minerals * 0.18 - (a.habitability + a.minerals * 0.18));
      const cell = candidates[0];
      const culture = this.dominantCulture(settlement);
      if (!cell || !culture) continue;
      const founded = this.createSettlement(cell, culture, this.state.month);
      const pioneers = people.filter((person) => person.ageMonths > 15 * 12 && person.ageMonths < 52 * 12).sort((a, b) => b.traits.riskTolerance - a.traits.riskTolerance).slice(0, 14);
      const settledPioneers: Person[] = [];
      for (const pioneer of pioneers) {
        if (!this.peopleSystem.beginMigration(pioneer, founded, this.state)) continue;
        const sourceIndex = people.indexOf(pioneer);
        if (sourceIndex >= 0) people.splice(sourceIndex, 1);
        pioneer.homeId = founded.id;
        const targetPeople = this.peopleBySettlement.get(founded.id) ?? [];
        targetPeople.push(pioneer);
        this.peopleBySettlement.set(founded.id, targetPeople);
        settledPioneers.push(pioneer);
      }
      this.applyKnowledgeEvents(this.knowledgeSystem.diffuseMigration(this.state, settlement, founded, settledPioneers.length));
      founded.resources.food += settlement.resources.food * 0.07;
      settlement.resources.food *= 0.93;
      this.addRelationsFor(founded);
    }
  }

  private initializeRelations(): void {
    const settlements = this.state.settlements;
    for (let first = 0; first < settlements.length; first += 1) {
      for (let second = first + 1; second < settlements.length; second += 1) {
        const a = settlements[first];
        const b = settlements[second];
        if (!a || !b) continue;
        this.state.relations.push(this.createRelation(a, b));
      }
    }
  }

  private addRelationsFor(settlement: Settlement): void {
    for (const other of this.state.settlements) {
      if (other.id !== settlement.id && !this.relation(other.id, settlement.id)) this.state.relations.push(this.createRelation(other, settlement));
    }
  }

  private createRelation(a: Settlement, b: Settlement): Relation {
    const cultureA = this.dominantCulture(a);
    const cultureB = this.dominantCulture(b);
    const sameCulture = cultureA?.id === cultureB?.id;
    return {
      id: [a.id, b.id].sort().join('::'), a: a.id, b: b.id, contact: sameCulture,
      firstContactMonth: sameCulture ? 0 : undefined,
      trust: sameCulture ? 0.55 : 0.12,
      hostility: sameCulture ? 0.05 : 0.12 + this.random.range(0, 0.12),
      tradeDependency: 0, culturalAffinity: sameCulture ? 0.85 : this.culturalAffinity(cultureA, cultureB),
      grievances: 0, territorialTension: 0, allianceObligation: 0, allied: false,
    };
  }

  private recomputeCultureShares(): void {
    for (const settlement of this.state.settlements) {
      const people = this.peopleAt(settlement.id);
      const counts: Record<string, number> = {};
      for (const person of people) counts[person.cultureId] = (counts[person.cultureId] ?? 0) + 1;
      settlement.cultureShares = {};
      for (const [cultureId, count] of Object.entries(counts)) settlement.cultureShares[cultureId] = count / Math.max(1, people.length);
    }
  }

  private addEvent(input: EventInput): void {
    const event: HistoricalEvent = {
      id: `event-${this.nextEventId++}`,
      month: this.state.month,
      type: input.type,
      ...(input.location ? { location: { ...input.location } } : {}),
      ...(input.locationId ? { locationId: input.locationId } : {}),
      actors: input.actors ?? [], causes: input.causes ?? [], context: input.context ?? {}, outcome: input.outcome,
      affectedPopulation: input.affectedPopulation ?? 0, magnitude: input.magnitude ?? 0.2, significance: input.significance ?? 0.2,
      tags: input.tags ?? [], summary: input.summary,
    };
    this.state.history.push(event);
  }

  private applyKnowledgeEvents(events: readonly KnowledgeEventDraft[]): void {
    for (const event of events) this.addEvent(event);
  }

  private applyAdvancedEvents(events: readonly KnowledgeEventDraft[]): void {
    for (const event of events) this.addEvent(event);
  }

  private knowledgeBreadth(settlement: Settlement): number {
    const records = Object.values(settlement.knowledge.records);
    return mean(records.map((record) => record.theory * 0.45 + (record.dormant ? 0 : record.practice) * 0.55));
  }

  private generatePersonName(culture: Culture): string {
    const syllables = culture.style.nameSyllables;
    const count = this.random.chance(0.26) ? 3 : 2;
    let name = '';
    for (let index = 0; index < count; index += 1) name += this.random.pick(syllables).toLowerCase();
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  private generatePlaceName(culture: Culture): string {
    const first = this.random.pick(culture.style.nameSyllables);
    const second = this.random.pick(PLACE_ENDINGS);
    return `${first}${second.toLowerCase()}`;
  }

  private culturalAffinity(a?: Culture, b?: Culture): number {
    if (!a || !b) return 0.2;
    const keys = Object.keys(a.dimensions) as Array<keyof CultureDimensions>;
    return clamp(1 - mean(keys.map((key) => Math.abs(a.dimensions[key] - b.dimensions[key]))));
  }

  private nudgeCultures(a: Culture, b: Culture, amount: number): void {
    const dimensions = Object.keys(a.dimensions) as Array<keyof CultureDimensions>;
    for (const key of dimensions) {
      const valueA = a.dimensions[key];
      const valueB = b.dimensions[key];
      a.dimensions[key] = clamp(valueA + (valueB - valueA) * amount);
      b.dimensions[key] = clamp(valueB + (valueA - valueB) * amount);
    }
  }

  private diffuseRouteCultures(a: Settlement, b: Settlement, volume: number): void {
    const cultureA = this.dominantCulture(a);
    const cultureB = this.dominantCulture(b);
    if (!cultureA || !cultureB || cultureA.id === cultureB.id) return;
    const openness = mean([cultureA.dimensions.outsiderOpenness, cultureB.dimensions.outsiderOpenness]);
    this.nudgeCultures(cultureA, cultureB, Math.min(0.0008, volume * openness * 0.00022));
  }

  private leadershipScore(person: Person, settlement: Settlement): number {
    const polity = this.polity(settlement.polityId);
    const arrangement = polity?.arrangement ?? this.powerArrangement(settlement.politicalPower);
    const arrangementTrait = arrangement.includes('war') ? person.traits.aggression : arrangement.includes('council') ? person.traits.cooperation : arrangement.includes('merchant') || arrangement.includes('wealth') ? person.traits.ambition : person.traits.sociability;
    return clamp(person.prestige * 0.52 + person.traits.ambition * 0.22 + arrangementTrait * 0.18 + person.health * 0.08);
  }

  private leaderFor(settlement: Settlement): Person | undefined {
    return [...this.peopleAt(settlement.id)]
      .filter((person) => person.ageMonths >= 18 * 12)
      .sort((a, b) => this.leadershipScore(b, settlement) - this.leadershipScore(a, settlement))[0];
  }

  private allianceSupportFor(defender: Settlement, attacker: Settlement): string[] {
    const supporters: string[] = [];
    for (const alliance of this.state.relations.filter((relation) => relation.allied && (relation.a === defender.id || relation.b === defender.id))) {
      const allyId = alliance.a === defender.id ? alliance.b : alliance.a;
      if (allyId === attacker.id) continue;
      const ally = this.settlement(allyId);
      if (!ally?.alive) continue;
      const aid = Math.min(8, ally.resources.food * 0.025);
      ally.resources.food -= aid;
      defender.resources.food += aid;
      alliance.allianceObligation = clamp(alliance.allianceObligation + 0.12);
      const attackerRelation = this.relation(ally.id, attacker.id);
      if (attackerRelation) {
        attackerRelation.grievances = clamp(attackerRelation.grievances + 0.1);
        attackerRelation.hostility = clamp(attackerRelation.hostility + 0.06);
      }
      supporters.push(ally.id);
    }
    return supporters;
  }

  private dominantCulture(settlement: Settlement): Culture | undefined {
    const id = Object.entries(settlement.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0];
    return this.culture(id ?? '');
  }

  private powerArrangement(power: PoliticalPower): string {
    const labels: Array<[keyof PoliticalPower, string]> = [
      ['personalPrestige', 'prestige leadership'], ['kinship', 'kinship compact'], ['military', 'war leadership'], ['religious', 'ritual court'],
      ['merchant', 'merchant coalition'], ['council', 'council assembly'], ['institutional', 'institutional league'], ['wealth', 'wealth patronage'],
    ];
    return labels.sort((a, b) => power[b[0]] - power[a[0]])[0]?.[1] ?? 'kinship compact';
  }

  private militaryStrength(settlement: Settlement): number {
    const adults = this.peopleAt(settlement.id).filter((person) => person.ageMonths > 16 * 12 && person.ageMonths < 60 * 12).length;
    const culture = this.dominantCulture(settlement);
    return adults * (0.11 + settlement.politicalPower.military * 0.08 + (culture?.dimensions.militarism ?? 0.5) * 0.06) * (0.55 + settlement.foodSecurity * 0.45);
  }

  private hostilityAround(settlementId: string): number {
    return Math.max(0, ...this.state.relations.filter((relation) => relation.a === settlementId || relation.b === settlementId).map((relation) => relation.hostility));
  }

  private livingSettlements(): Settlement[] { return this.state.settlements.filter((settlement) => settlement.alive); }
  private peopleAt(settlementId: string): Person[] { return this.peopleBySettlement.get(settlementId) ?? []; }
  private settlement(id: string): Settlement | undefined { return this.state.settlements.find((settlement) => settlement.id === id); }
  private person(id: string): Person | undefined { return this.personById.get(id); }
  private culture(id: string): Culture | undefined { return this.state.cultures.find((culture) => culture.id === id); }
  private institution(id: string): Institution | undefined { return this.state.institutions.find((institution) => institution.id === id); }
  private polity(id: string): Polity | undefined { return this.state.polities.find((polity) => polity.id === id); }
  private relation(a: string, b: string): Relation | undefined { return this.state.relations.find((relation) => (relation.a === a && relation.b === b) || (relation.a === b && relation.b === a)); }
  private route(a: string, b: string): TradeRoute | undefined { return this.state.tradeRoutes.find((route) => route.active && route.transport?.path && ((route.a === a && route.b === b) || (route.a === b && route.b === a))); }
  private routesAt(id: string): TradeRoute[] { return (this.routesBySettlement.get(id) ?? []).filter((route) => route.active && route.transport?.path); }
  private warBetween(a: string, b: string): War | undefined { return this.state.wars.find((war) => war.active && ((war.attacker === a && war.defender === b) || (war.attacker === b && war.defender === a))); }

  private indexPerson(person: Person): void {
    if (!person.alive) return;
    this.personById.set(person.id, person);
    const people = this.peopleBySettlement.get(person.homeId) ?? [];
    people.push(person);
    this.peopleBySettlement.set(person.homeId, people);
  }

  private rebuildLookupIndexes(): void {
    this.peopleBySettlement.clear();
    this.personById.clear();
    this.routesBySettlement.clear();
    for (const person of this.state.people) this.indexPerson(person);
    for (const route of this.state.tradeRoutes) {
      for (const settlementId of [route.a, route.b]) {
        const routes = this.routesBySettlement.get(settlementId) ?? [];
        routes.push(route);
        this.routesBySettlement.set(settlementId, routes);
      }
    }
  }

  summary(): SimulationSummary {
    const eventCounts: Record<string, number> = {};
    for (const event of this.state.history) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    const largestSettlements = this.livingSettlements().map((settlement) => ({
      name: settlement.name,
      population: settlementRepresentedPopulation(this.state, settlement.id),
      foodSecurity: Number(settlement.foodSecurity.toFixed(3)),
      specialization: settlement.specialization,
    })).sort((a, b) => b.population - a.population).slice(0, 8);
    const cultureProfiles = this.state.cultures.map((culture) => ({
      name: culture.name,
      population: Math.round(this.livingSettlements().reduce((sum, settlement) => sum + settlementRepresentedPopulation(this.state, settlement.id) * (settlement.cultureShares[culture.id] ?? 0), 0)),
      openness: Number(culture.dimensions.outsiderOpenness.toFixed(4)),
      militarism: Number(culture.dimensions.militarism.toFixed(4)),
      tradeOrientation: Number(culture.dimensions.tradeOrientation.toFixed(4)),
    }));
    const milestones: Record<string, number> = {};
    for (const event of this.state.history) {
      if (event.type !== 'discovery' && event.type !== 'knowledge-rediscovered' && event.type !== 'industrialization') continue;
      const key = event.type === 'industrialization' ? 'industrialization' : typeof event.context.knowledge === 'string' ? event.context.knowledge : undefined;
      if (key && milestones[key] === undefined) milestones[key] = Number((event.month / 12).toFixed(1));
    }
    const firstIndustrialization = this.state.history.find((event) => event.type === 'industrialization');
    const atomicThreshold = this.state.advanced.atomic.thresholdMonth;
    const firstOrbit = this.state.history.find((event) => event.type === 'first-orbit');
    const eventYear = (type: HistoricalEventType): number | null => {
      const event = this.state.history.find((candidate) => candidate.type === type);
      return event ? Number((event.month / 12).toFixed(1)) : null;
    };
    const industrialRoutes: Record<string, number> = {};
    for (const event of this.state.history.filter((candidate) => candidate.type === 'industrialization')) {
      const route = typeof event.context.route === 'string' ? event.context.route : 'unknown lineage';
      industrialRoutes[route] = (industrialRoutes[route] ?? 0) + 1;
    }
    const regionalSpecialization = this.livingSettlements().map((settlement) => ({
      settlement: settlement.name,
      label: this.knowledgeSystem.retrospectiveLabel(settlement),
      domains: this.knowledgeSystem.domainStrengths(settlement).filter((entry) => entry.strength > 0).slice(0, 3).map((entry) => entry.domain),
      knowledgeCount: Object.values(settlement.knowledge.records).filter((record) => !record.dormant).length,
      industrialIntensity: Number(settlement.industry.intensity.toFixed(3)),
      industrialRoute: settlement.industry.active ? settlement.industry.route.join(' + ') : null,
    })).sort((a, b) => b.knowledgeCount + b.industrialIntensity * 10 - (a.knowledgeCount + a.industrialIntensity * 10));
    const independentDiscoveryCenters = new Set(this.state.history.filter((event) => event.type === 'discovery' && typeof event.context.knowledge === 'string' && KNOWLEDGE_BY_ID.has(event.context.knowledge)).map((event) => event.locationId).filter(Boolean)).size;
    return {
      seed: this.state.seed, engineVersion: this.state.engineVersion, year: this.year, month: this.state.month, population: this.population,
      settlements: this.livingSettlements().length, cultures: this.state.cultures.length, institutions: this.state.institutions.length,
      tradeRoutes: this.state.tradeRoutes.filter((route) => route.active).length, activeWars: this.state.wars.filter((war) => war.active).length,
      polities: this.state.polities.length, births: this.state.stats.births, deaths: this.state.stats.deaths, migrations: this.state.stats.migrations,
      trades: this.state.stats.trades, wars: this.state.stats.wars, battles: this.state.stats.battles, peakPopulation: this.state.stats.peakPopulation,
      knowledgeExchanges: this.state.stats.knowledgeExchanges, discoveries: this.state.stats.discoveries,
      knowledgeLost: this.state.stats.knowledgeLost, rediscoveries: this.state.stats.rediscoveries,
      knowledgeAdoptions: this.state.stats.knowledgeAdoptions, technologyTransformations: this.state.stats.technologyTransformations,
      industrializations: this.state.stats.industrializations,
      totalFood: Number(this.livingSettlements().reduce((sum, settlement) => sum + settlement.resources.food, 0).toFixed(3)),
      totalWealth: Number(this.livingSettlements().reduce((sum, settlement) => sum + settlement.resources.wealth, 0).toFixed(3)),
      averageKnowledge: Number(mean(this.livingSettlements().map((settlement) => this.knowledgeBreadth(settlement))).toFixed(4)),
      representedPopulation: representedPopulation(this.state), explicitIndividuals: this.population, civilizationScale: this.state.advanced.scale,
      outcomeClassification: this.advancedSystem.classificationAtHorizon(this.state),
      institutionalCapacity: Number(this.state.advanced.governance.institutionalCapacity.toFixed(4)),
      planetaryCoordination: Number(this.state.advanced.governance.coordination.toFixed(4)),
      politicalFragmentation: Number(this.state.advanced.governance.fragmentation.toFixed(4)),
      developmentPriorities: Object.fromEntries(Object.entries(this.state.advanced.developmentPriorities).map(([key, value]) => [key, Number(value.toFixed(4))])) as SimulationState['advanced']['developmentPriorities'],
      atomicThresholdYear: atomicThreshold === undefined ? null : Number((atomicThreshold / 12).toFixed(1)),
      nuclearWeaponsStates: this.state.stats.nuclearWeaponsStates, nuclearUses: this.state.stats.nuclearUses, nuclearWars: this.state.stats.nuclearWars,
      strategicNuclearPhase: this.state.advanced.strategic.phase,
      firstOrbitYear: firstOrbit ? Number((firstOrbit.month / 12).toFixed(1)) : null,
      offworldSettlements: this.state.advanced.space.offworldSettlements,
      interplanetaryPopulation: Math.round(this.state.advanced.space.interplanetaryPopulation), selfSustainingBodies: this.state.advanced.space.selfSustainingBodies,
      machineCapability: Number(this.state.advanced.machine.capability.toFixed(4)), fermiHypotheses: [...this.state.advanced.fermi.hypotheses],
      advancedMilestones: {
        nuclearWeapons: eventYear('nuclear-weapons-developed'), nuclearUse: eventYear('nuclear-use') ?? eventYear('nuclear-exchange'),
        machineIntelligence: eventYear('machine-intelligence-transition'), offworldSettlement: eventYear('offworld-settlement'),
        interplanetary: eventYear('interplanetary-transition'), postBiological: eventYear('post-biological-transition'),
      },
      riskPressures: Object.fromEntries(Object.entries(this.state.advanced.risks).map(([kind, risk]) => [kind, { annualProbability: Number(risk.annualProbability.toFixed(6)), hazard: Number(risk.hazard.toFixed(4)), vulnerability: Number(risk.vulnerability.toFixed(4)), mitigation: Number(risk.mitigation.toFixed(4)) }])),
      industrialCenters: this.livingSettlements().filter((settlement) => settlement.industry.active).length,
      firstIndustrializationYear: firstIndustrialization ? Number((firstIndustrialization.month / 12).toFixed(1)) : null,
      industrialRoutes, independentDiscoveryCenters, milestones, eventCounts, largestSettlements, cultureProfiles, regionalSpecialization,
    };
  }
}
