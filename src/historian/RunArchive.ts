import type { GodboxConfig } from '../config';
import { SeededRandom } from '../sim/prng';
import { representedPopulation } from '../sim/advanced/AdvancedCivilizationSystem';
import type { Culture, HistoricalEvent, Institution, Person, Polity, Settlement, SimulationState, War } from '../sim/types';
import type { CrossRunContext, HistorianPrediction, HistorianStatement } from './types';

export const HISTORIAN_ARCHIVE_SCHEMA_VERSION = 3;
const DATABASE_NAME = 'godbox-historian';
const DATABASE_VERSION = 1;

export interface RunIdentity {
  runId: string;
  observationNumber: number;
  seed: string;
  worldName: string;
  configurationFingerprint: string;
  experimentFingerprint: string;
  baseSeed: string;
  engineVersion: string;
  createdAt: string;
  initialConditions: {
    population: number;
    settlements: number;
    cultures: number;
    worldSize: number;
  };
}

export interface DemographicMilestone {
  month: number;
  population: number;
  kind: 'initial' | 'new-peak' | 'half-population' | 'extinction';
}

export interface ArchivedPerson {
  id: string;
  name: string;
  cultureId: string;
  homeId: string;
  occupation: string;
  bornMonth: number;
  lastKnownMonth: number;
  lastKnownAgeYears: number;
  prestige: number;
  reasons: string[];
  aliveAtLastRecord: boolean;
}

export interface RunArchiveRecord {
  schemaVersion: number;
  identity: RunIdentity;
  status: 'ongoing' | 'completed' | 'failed';
  lastRecordedMonth: number;
  endedMonth?: number;
  configuration: GodboxConfig;
  majorEntities: {
    settlements: Settlement[];
    cultures: Culture[];
    polities: Polity[];
    institutions: Institution[];
  };
  events: HistoricalEvent[];
  demographicMilestones: DemographicMilestone[];
  politicalEventIds: string[];
  technologicalEventIds: string[];
  conflictEventIds: string[];
  importantConflicts: War[];
  importantInstitutions: Institution[];
  significantPeople: ArchivedPerson[];
  historianStatements: HistorianStatement[];
  predictions: HistorianPrediction[];
  outcome: {
    population: number;
    peakPopulation: number;
    settlementsRemaining: number;
    industrialCenters: number;
    discoveries: number;
    knowledgeLost: number;
    rediscoveries: number;
    knowledgeExchanges: number;
    tradeRoutesEstablished: number;
    wars: number;
    classification: SimulationState['advanced']['outcome']['classification'];
    atomicThresholdMonth?: number;
    nuclearWeapons: boolean;
    nuclearWar: boolean;
    survivalYearsAfterAtomic: number | null;
    survivedThreeCenturiesAfterAtomic: boolean;
    interplanetary: boolean;
    postBiological: boolean;
    unknown: boolean;
    summary: string;
  };
  updatedAt: string;
}

const IMPORTANT_EVENT_TYPES = new Set<HistoricalEvent['type']>([
  'resource-deposit-discovered', 'resource-site-established', 'resource-site-abandoned', 'resource-depleted', 'recipe-learned', 'resource-trade',
  'settlement-founded', 'settlement-abandoned', 'major-migration', 'first-contact', 'trade-route-established',
  'discovery', 'knowledge-adopted', 'technology-transformation', 'knowledge-lost', 'knowledge-rediscovered', 'infrastructure-built', 'archive-destroyed', 'industrialization-stage', 'industrialization',
  'institution-formed', 'alliance-formed', 'alliance-ended', 'leadership-succession', 'war-declared', 'war-campaign', 'battle', 'war-ended', 'political-transition', 'cultural-shift', 'harvest-crisis', 'recovery',
  'statistical-transition', 'atomic-threshold', 'nuclear-energy', 'nuclear-medicine', 'nuclear-weapons-developed', 'nuclear-restraint', 'nuclear-disarmament', 'nuclear-crisis', 'nuclear-use', 'nuclear-exchange',
  'pandemic', 'ecological-crisis', 'climate-crisis', 'resource-crisis', 'autonomous-weapons-crisis', 'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition',
  'fermi-question', 'fermi-hypothesis', 'natural-catastrophe', 'civilization-collapse', 'civilization-recovery', 'planetary-stability', 'post-biological-transition', 'observation-lost', 'outcome-classified',
]);
const POLITICAL_TYPES = new Set<HistoricalEvent['type']>(['institution-formed', 'alliance-formed', 'alliance-ended', 'leadership-succession', 'war-declared', 'war-ended', 'political-transition', 'nuclear-restraint', 'nuclear-disarmament', 'nuclear-crisis', 'civilization-collapse', 'planetary-stability']);
const TECHNOLOGY_TYPES = new Set<HistoricalEvent['type']>(['discovery', 'knowledge-adopted', 'technology-transformation', 'knowledge-lost', 'knowledge-rediscovered', 'infrastructure-built', 'archive-destroyed', 'industrialization-stage', 'industrialization', 'atomic-threshold', 'nuclear-energy', 'nuclear-medicine', 'nuclear-weapons-developed', 'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition', 'post-biological-transition']);
const CONFLICT_TYPES = new Set<HistoricalEvent['type']>(['war-declared', 'war-campaign', 'battle', 'war-ended', 'nuclear-crisis', 'nuclear-use', 'nuclear-exchange', 'autonomous-weapons-crisis']);

export function configurationFingerprint(config: GodboxConfig): string {
  // Keep the pre-ecology identity shape. New purely visual controls must neither orphan existing
  // observations nor split one deterministic history into separate experiments.
  const stable = stableStringify({ ...config, render: {
    maxPixelRatio: config.render.maxPixelRatio,
    visualDensity: config.render.visualDensity,
    structuralUpdatesPerSecond: config.render.structuralUpdatesPerSecond,
  } });
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(16).padStart(8, '0');
}

/** Identifies one configured experiment while allowing each observation its own seed. */
export function experimentFingerprint(config: GodboxConfig): string {
  return configurationFingerprint({ ...config, seed: '<observation-seed>' });
}

export function seedForObservation(baseSeed: string, observationNumber: number): string {
  return observationNumber <= 1 ? baseSeed : `${baseSeed}:observation-${String(observationNumber).padStart(4, '0')}`;
}

export function generatedWorldName(seed: string): string {
  const first = ['Amber', 'Ashen', 'Blue', 'Copper', 'Glass', 'Indigo', 'Jade', 'Ochre', 'Saffron', 'Silver', 'Umber', 'Verdant'];
  const second = ['Archipelago', 'Basin', 'Coast', 'Delta', 'Estuary', 'Highlands', 'Marches', 'Reaches', 'Steppe', 'Terraces', 'Valleys', 'Watershed'];
  const random = new SeededRandom(`${seed}:world-name`);
  return `The ${random.pick(first)} ${random.pick(second)}`;
}

export function createRunIdentity(config: GodboxConfig, state: SimulationState, observationNumber: number, createdAt = new Date().toISOString(), baseSeed = config.seed): RunIdentity {
  const fingerprint = configurationFingerprint(config);
  return {
    runId: `observation-${observationNumber}-${fingerprint}`,
    observationNumber,
    seed: state.seed,
    worldName: generatedWorldName(state.seed),
    configurationFingerprint: fingerprint,
    experimentFingerprint: experimentFingerprint(config),
    baseSeed,
    engineVersion: state.engineVersion,
    createdAt,
    initialConditions: { population: representedPopulation(state), settlements: state.settlements.filter((settlement) => settlement.alive).length, cultures: state.cultures.length, worldSize: state.world.size },
  };
}

export class RunRecordBuilder {
  private readonly events = new Map<string, HistoricalEvent>();
  private readonly people = new Map<string, ArchivedPerson>();
  private readonly demographicMilestones: DemographicMilestone[];
  private lastPeakMilestone: number;

  private readonly priorStatements: HistorianStatement[];
  private readonly priorPredictions: HistorianPrediction[];

  constructor(readonly identity: RunIdentity, private readonly config: GodboxConfig, initialState: SimulationState, prior?: RunArchiveRecord) {
    const population = representedPopulation(initialState);
    for (const event of prior?.events ?? []) this.events.set(event.id, structuredClone(event));
    for (const person of prior?.significantPeople ?? []) this.people.set(person.id, structuredClone(person));
    this.demographicMilestones = structuredClone(prior?.demographicMilestones ?? [{ month: initialState.month, population, kind: 'initial' }]);
    this.lastPeakMilestone = Math.max(population, ...this.demographicMilestones.map((milestone) => milestone.population));
    this.priorStatements = structuredClone(prior?.historianStatements ?? []);
    this.priorPredictions = structuredClone(prior?.predictions ?? []);
  }

  update(
    state: SimulationState,
    representativeIds: ReadonlySet<string> = new Set(),
    statements: readonly HistorianStatement[] = [],
    predictions: readonly HistorianPrediction[] = [],
    completion?: { status: 'completed' | 'failed'; classification?: SimulationState['advanced']['outcome']['classification']; reason?: string },
  ): RunArchiveRecord {
    for (const event of state.history) if (IMPORTANT_EVENT_TYPES.has(event.type) && (event.significance >= 0.42 || event.type !== 'battle')) this.events.set(event.id, structuredClone(event));
    const population = representedPopulation(state);
    if (population >= Math.max(this.lastPeakMilestone + 50, this.lastPeakMilestone * 1.25)) {
      this.demographicMilestones.push({ month: state.month, population, kind: 'new-peak' });
      this.lastPeakMilestone = population;
    }
    const initialPopulation = this.identity.initialConditions.population;
    if (population <= initialPopulation / 2 && !this.demographicMilestones.some((milestone) => milestone.kind === 'half-population')) this.demographicMilestones.push({ month: state.month, population, kind: 'half-population' });
    if (population === 0 && !this.demographicMilestones.some((milestone) => milestone.kind === 'extinction')) this.demographicMilestones.push({ month: state.month, population, kind: 'extinction' });
    this.captureRecordedDeaths(state, representativeIds);
    this.capturePeople(state, representativeIds);
    const status = completion?.status ?? (population === 0 ? 'completed' : 'ongoing');
    const events = [...this.events.values()].sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
    const institutions = state.institutions.filter((institution) => institution.prestige >= 0.48 || events.some((event) => event.actors.includes(institution.id)));
    const industrialCenters = state.settlements.filter((settlement) => settlement.industry.active).length;
    const classification = completion?.classification ?? (population === 0 ? 'EXTINCT' : state.advanced.outcome.classification);
    const atomicThresholdMonth = state.advanced.atomic.thresholdMonth;
    const survivalYearsAfterAtomic = atomicThresholdMonth === undefined ? null : Math.max(0, (state.month - atomicThresholdMonth) / 12);
    const collapseWithinThreeCenturies = atomicThresholdMonth === undefined ? false : events.some((event) => event.type === 'civilization-collapse' && event.month >= atomicThresholdMonth && event.month <= atomicThresholdMonth + 300 * 12);
    const summary = completion?.reason ?? (population === 0
      ? `${this.identity.worldName} ended with no surviving population after ${Math.floor(state.month / 12)} years.`
      : `${this.identity.worldName} has ${population} people in ${state.settlements.filter((settlement) => settlement.alive).length} settlements after ${Math.floor(state.month / 12)} years.`);
    return {
      schemaVersion: HISTORIAN_ARCHIVE_SCHEMA_VERSION,
      identity: structuredClone(this.identity),
      status,
      lastRecordedMonth: state.month,
      ...(status === 'completed' ? { endedMonth: state.month } : {}),
      configuration: structuredClone(this.config),
      majorEntities: {
        settlements: structuredClone(state.settlements.filter((settlement) => settlement.alive || events.some((event) => event.actors.includes(settlement.id)))),
        cultures: structuredClone(state.cultures),
        polities: structuredClone(state.polities),
        institutions: structuredClone(institutions),
      },
      events,
      demographicMilestones: structuredClone(this.demographicMilestones),
      politicalEventIds: events.filter((event) => POLITICAL_TYPES.has(event.type)).map((event) => event.id),
      technologicalEventIds: events.filter((event) => TECHNOLOGY_TYPES.has(event.type)).map((event) => event.id),
      conflictEventIds: events.filter((event) => CONFLICT_TYPES.has(event.type)).map((event) => event.id),
      importantConflicts: structuredClone(state.wars.filter((war) => war.casualtiesA + war.casualtiesB > 0 || events.some((event) => event.actors.includes(war.id)))),
      importantInstitutions: structuredClone(institutions),
      significantPeople: structuredClone([...this.people.values()]),
      historianStatements: mergeById(this.priorStatements, statements).slice(-1200),
      predictions: mergeById(this.priorPredictions, predictions).slice(-1200),
      outcome: { population, peakPopulation: Math.max(state.stats.peakPopulation, Math.round(state.advanced.peakRepresentedPopulation)), settlementsRemaining: state.settlements.filter((settlement) => settlement.alive).length, industrialCenters, discoveries: state.stats.discoveries, knowledgeLost: state.stats.knowledgeLost, rediscoveries: state.stats.rediscoveries, knowledgeExchanges: state.stats.knowledgeExchanges, tradeRoutesEstablished: state.tradeRoutes.length, wars: state.stats.wars, classification, ...(atomicThresholdMonth === undefined ? {} : { atomicThresholdMonth }), nuclearWeapons: state.stats.nuclearWeaponsStates > 0, nuclearWar: state.stats.nuclearUses > 0, survivalYearsAfterAtomic, survivedThreeCenturiesAfterAtomic: survivalYearsAfterAtomic !== null && survivalYearsAfterAtomic >= 300 && !collapseWithinThreeCenturies, interplanetary: state.advanced.space.selfSustainingBodies >= 2, postBiological: classification === 'POST-BIOLOGICAL', unknown: classification === 'UNKNOWN', summary },
      updatedAt: new Date().toISOString(),
    };
  }

  private capturePeople(state: SimulationState, representativeIds: ReadonlySet<string>): void {
    const historicallySignificantIds = new Set([...this.events.values()].filter((event) => event.significance >= 0.7).flatMap((event) => event.actors));
    for (const person of state.people) {
      const reasons = [
        ...(representativeIds.has(person.id) ? ['representative'] : []),
        ...(historicallySignificantIds.has(person.id) ? ['historical-witness'] : []),
        ...(person.prestige >= 0.62 ? ['high-prestige'] : []),
        ...(person.ageMonths >= 72 * 12 ? ['long-life'] : []),
        ...(person.occupation === 'keeper' ? ['knowledge-keeper'] : []),
        ...(person.activity === 'migrate' ? ['migrant'] : []),
      ];
      if (reasons.length === 0) continue;
      const existing = this.people.get(person.id);
      this.people.set(person.id, this.personRecord(person, state.month, [...(existing?.reasons ?? []), ...reasons]));
    }
  }

  private captureRecordedDeaths(state: SimulationState, representativeIds: ReadonlySet<string>): void {
    const historicallySignificantIds = new Set([...this.events.values()].filter((event) => event.significance >= 0.7).flatMap((event) => event.actors));
    for (const event of state.history.filter((candidate) => candidate.type === 'death' && typeof candidate.context.name === 'string')) {
      const id = event.actors[0];
      if (!id) continue;
      const age = Number(event.context.age ?? 0);
      const prestige = Number(event.context.prestige ?? 0);
      const occupation = String(event.context.occupation ?? '');
      const reasons = [
        ...(representativeIds.has(id) ? ['representative'] : []),
        ...(historicallySignificantIds.has(id) ? ['historically-significant'] : []),
        ...(age >= 72 ? ['long-life'] : []),
        ...(prestige >= 0.62 ? ['high-prestige'] : []),
        ...(occupation === 'keeper' ? ['knowledge-keeper'] : []),
      ];
      if (reasons.length === 0) continue;
      const existing = this.people.get(id);
      this.people.set(id, { id, name: String(event.context.name), cultureId: String(event.context.cultureId ?? existing?.cultureId ?? ''), homeId: String(event.context.homeId ?? event.locationId ?? existing?.homeId ?? ''), occupation, bornMonth: event.month - age * 12, lastKnownMonth: event.month, lastKnownAgeYears: age, prestige, reasons: [...new Set([...(existing?.reasons ?? []), ...reasons])], aliveAtLastRecord: false });
    }
  }

  private personRecord(person: Person, month: number, reasons: string[]): ArchivedPerson {
    return { id: person.id, name: person.name, cultureId: person.cultureId, homeId: person.homeId, occupation: person.occupation, bornMonth: person.bornMonth, lastKnownMonth: month, lastKnownAgeYears: Math.floor(person.ageMonths / 12), prestige: person.prestige, reasons: [...new Set(reasons)], aliveAtLastRecord: person.alive };
  }
}

export class HistorianArchiveStore {
  failureReason?: string;
  private database?: IDBDatabase;
  private readonly memory = new Map<string, RunArchiveRecord>();
  private memoryObservationNumber = 0;

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  get persistent(): boolean { return Boolean(this.database); }

  async initialize(): Promise<void> {
    if (!this.factory || this.database) return;
    try {
      this.database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory?.open(DATABASE_NAME, DATABASE_VERSION);
        if (!request) { reject(new Error('IndexedDB is unavailable')); return; }
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('runs')) database.createObjectStore('runs', { keyPath: 'identity.runId' });
          if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open the Historian archive'));
        request.onblocked = () => reject(new Error('Historian archive upgrade was blocked'));
      });
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : String(error);
      this.database = undefined;
    }
  }

  async nextObservationNumber(): Promise<number> {
    await this.initialize();
    if (!this.database) return ++this.memoryObservationNumber;
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = this.database?.transaction('metadata', 'readwrite');
        if (!transaction) { reject(new Error('Archive database closed')); return; }
        const store = transaction.objectStore('metadata');
        const request = store.get('observationNumber');
        let next = 0;
        request.onsuccess = () => {
          next = Number(request.result ?? 0) + 1;
          store.put(next, 'observationNumber');
        };
        transaction.oncomplete = () => resolve(next);
        request.onerror = () => reject(request.error ?? new Error('Could not read observation number'));
        transaction.onerror = () => reject(transaction.error ?? new Error('Could not store observation number'));
      });
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : String(error);
      return ++this.memoryObservationNumber;
    }
  }

  async save(record: RunArchiveRecord): Promise<void> {
    const migrated = migrateArchiveRecord(record);
    this.memory.set(migrated.identity.runId, structuredClone(migrated));
    await this.initialize();
    if (!this.database) return;
    try {
      await this.request<void>('runs', 'readwrite', (store) => store.put(migrated));
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : String(error);
    }
  }

  async get(runId: string): Promise<RunArchiveRecord | undefined> {
    await this.initialize();
    if (!this.database) return structuredClone(this.memory.get(runId));
    try {
      const raw = await this.request<unknown>('runs', 'readonly', (store) => store.get(runId));
      return raw ? migrateArchiveRecord(raw) : undefined;
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : String(error);
      return structuredClone(this.memory.get(runId));
    }
  }

  async list(): Promise<RunArchiveRecord[]> {
    await this.initialize();
    if (!this.database) return [...this.memory.values()].map((record) => structuredClone(record));
    try {
      const raw = await this.request<unknown[]>('runs', 'readonly', (store) => store.getAll());
      return raw.map(migrateArchiveRecord).sort((a, b) => a.identity.observationNumber - b.identity.observationNumber);
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : String(error);
      return [...this.memory.values()].map((record) => structuredClone(record));
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  private request<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transaction = this.database?.transaction(storeName, mode);
      if (!transaction) { reject(new Error('Archive database closed')); return; }
      const request = action(transaction.objectStore(storeName));
      let result: T;
      request.onsuccess = () => { result = request.result as T; };
      transaction.oncomplete = () => resolve(result);
      request.onerror = () => reject(request.error ?? new Error('Archive request failed'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Archive transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Archive transaction was aborted'));
    });
  }
}

export function migrateArchiveRecord(raw: unknown): RunArchiveRecord {
  const source = raw as Partial<RunArchiveRecord> & { identity?: Partial<RunIdentity> };
  if (!source.identity?.runId) throw new Error('Invalid GODBOX archive record');
  if ((source.schemaVersion ?? 0) > HISTORIAN_ARCHIVE_SCHEMA_VERSION) throw new Error('Archive was created by a newer GODBOX version');
  const configuration = source.configuration as GodboxConfig;
  const identity = {
    ...source.identity,
    experimentFingerprint: source.identity.experimentFingerprint ?? (configuration ? experimentFingerprint(configuration) : source.identity.configurationFingerprint ?? 'legacy'),
    baseSeed: source.identity.baseSeed ?? source.identity.seed ?? configuration?.seed ?? 'legacy',
  } as RunIdentity;
  return {
    schemaVersion: HISTORIAN_ARCHIVE_SCHEMA_VERSION,
    identity,
    status: source.status ?? 'ongoing',
    lastRecordedMonth: source.lastRecordedMonth ?? 0,
    ...(source.endedMonth === undefined ? {} : { endedMonth: source.endedMonth }),
    configuration,
    majorEntities: source.majorEntities ?? { settlements: [], cultures: [], polities: [], institutions: [] },
    events: source.events ?? [],
    demographicMilestones: source.demographicMilestones ?? [],
    politicalEventIds: source.politicalEventIds ?? [],
    technologicalEventIds: source.technologicalEventIds ?? [],
    conflictEventIds: source.conflictEventIds ?? [],
    importantConflicts: source.importantConflicts ?? [],
    importantInstitutions: source.importantInstitutions ?? [],
    significantPeople: source.significantPeople ?? [],
    historianStatements: source.historianStatements ?? [],
    predictions: source.predictions ?? [],
    outcome: {
      population: 0, peakPopulation: 0, settlementsRemaining: 0, industrialCenters: 0, discoveries: 0,
      knowledgeLost: 0, rediscoveries: 0, knowledgeExchanges: 0, tradeRoutesEstablished: 0, wars: 0, classification: null,
      nuclearWeapons: false, nuclearWar: false, survivalYearsAfterAtomic: null, survivedThreeCenturiesAfterAtomic: false,
      interplanetary: false, postBiological: false, unknown: false,
      summary: 'No outcome was recorded.',
      ...source.outcome,
    },
    updatedAt: source.updatedAt ?? source.identity.createdAt ?? new Date(0).toISOString(),
  };
}

function mergeById<T extends { id: string }>(before: readonly T[], after: readonly T[]): T[] {
  const merged = new Map(before.map((item) => [item.id, item]));
  for (const item of after) merged.set(item.id, item);
  return structuredClone([...merged.values()]);
}

export function computeCrossRunContext(records: readonly RunArchiveRecord[]): CrossRunContext {
  const completed = records.filter((record) => record.status === 'completed');
  const industrialized = completed.filter((record) => record.outcome.industrialCenters > 0 || record.events.some((event) => event.type === 'industrialization'));
  const writingYears = completed.map((record) => record.events.find((event) => event.type === 'discovery' && event.context.knowledge === 'durable-records')?.month).filter((month): month is number => month !== undefined).map((month) => month / 12);
  const warsPerMillennium = completed.map((record) => record.outcome.wars / Math.max(0.001, record.lastRecordedMonth / 12 / 1000));
  const collapses = completed.filter((record) => record.events.some((event) => event.type === 'settlement-abandoned'));
  const tradeCounts = completed.map((record) => record.outcome.tradeRoutesEstablished);
  const exchangeCounts = completed.map((record) => record.outcome.knowledgeExchanges);
  const atomic = completed.filter((record) => record.outcome.atomicThresholdMonth !== undefined);
  const nuclearWeapons = completed.filter((record) => record.outcome.nuclearWeapons);
  const nuclearWars = completed.filter((record) => record.outcome.nuclearWar);
  const interplanetary = completed.filter((record) => record.outcome.interplanetary);
  const extinctOrCollapsed = completed.filter((record) => record.outcome.classification === 'EXTINCT' || record.outcome.classification === 'COLLAPSED');
  const postBiologicalOrUnknown = completed.filter((record) => record.outcome.postBiological || record.outcome.unknown);
  const outcomeCounts: CrossRunContext['outcomeCounts'] = {};
  for (const record of completed) if (record.outcome.classification) outcomeCounts[record.outcome.classification] = (outcomeCounts[record.outcome.classification] ?? 0) + 1;
  return {
    totalRuns: records.length,
    completedRuns: completed.length,
    industrializedRuns: industrialized.length,
    industrializedFraction: completed.length === 0 ? null : industrialized.length / completed.length,
    medianWritingYear: median(writingYears),
    medianWarsPerMillennium: median(warsPerMillennium),
    collapseFrequency: completed.length === 0 ? null : collapses.length / completed.length,
    tradeKnowledgeCorrelation: completed.length < 4 ? null : correlation(tradeCounts, exchangeCounts),
    atomicThresholdRuns: atomic.length,
    atomicThresholdFraction: completed.length === 0 ? null : atomic.length / completed.length,
    medianAtomicThresholdYear: median(atomic.map((record) => (record.outcome.atomicThresholdMonth ?? 0) / 12)),
    nuclearWeaponsRuns: nuclearWeapons.length,
    nuclearWeaponsFraction: completed.length === 0 ? null : nuclearWeapons.length / completed.length,
    nuclearWarRuns: nuclearWars.length,
    nuclearWarFraction: completed.length === 0 ? null : nuclearWars.length / completed.length,
    medianSurvivalYearsAfterAtomic: median(atomic.map((record) => record.outcome.survivalYearsAfterAtomic).filter((value): value is number => value !== null)),
    survivedThreeCenturiesAfterAtomic: atomic.filter((record) => record.outcome.survivedThreeCenturiesAfterAtomic).length,
    interplanetaryRuns: interplanetary.length,
    interplanetaryFraction: completed.length === 0 ? null : interplanetary.length / completed.length,
    extinctionOrCollapseRuns: extinctOrCollapsed.length,
    postBiologicalOrUnknownRuns: postBiologicalOrUnknown.length,
    outcomeCounts,
    archiveIds: completed.map((record) => record.identity.runId),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? null;
}

function correlation(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * ((b[index] ?? 0) - meanB), 0);
  const denominatorA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0));
  const denominatorB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominatorA === 0 || denominatorB === 0 ? null : numerator / (denominatorA * denominatorB);
}
