import type {
  HistoricalEvent,
  HistoricalEventType,
  Institution,
  KnowledgeRecord,
  Person,
  SimulationState,
  SocialIdea,
  SocialRelationship,
} from '../sim/types';
import { lifeProjectForPerson } from '../sim/people/LifeProjectSystem';
import type { DeepHistoricalMemory, DeepProvenanceClass } from './DeepHistoricalMemory';
import type { WatcherMemorySnapshot, WatcherQuestion } from './WatcherMind';
import type { ObservationCandidate } from './types';

export type LegacyDimension =
  | 'contemporaryFame'
  | 'intellectualInfluence'
  | 'institutionalInfluence'
  | 'politicalInfluence'
  | 'materialImpact'
  | 'culturalImpact'
  | 'historicalPersistence';

export interface PersonLegacyMemory {
  id: string;
  personId: string;
  name: string;
  bornMonth: number;
  deathMonth?: number;
  firstEvidenceMonth: number;
  lastEvidenceMonth: number;
  contemporaryFame: number;
  intellectualInfluence: number;
  institutionalInfluence: number;
  politicalInfluence: number;
  materialImpact: number;
  culturalImpact: number;
  historicalPersistence: number;
  retrospectiveSignificance: number;
  knowledgeLineageIds: string[];
  ideaIds: string[];
  institutionIds: string[];
  relatedPersonIds: string[];
  sourceEventIds: string[];
  sourceMemoryIds: string[];
  reasons: string[];
}

export type GenealogyLinkKind =
  | 'mentor'
  | 'intellectual-collaborator'
  | 'idea-originator'
  | 'idea-descendant'
  | 'knowledge-attribution'
  | 'knowledge-descendant'
  | 'institution-member'
  | 'institution-founder'
  | 'institution-successor'
  | 'institution-idea'
  | 'institution-knowledge'
  | 'political-descendant';

export type GenealogyConfidence = 'recorded' | 'structurally-supported';

export interface GenealogyLink {
  id: string;
  fromId: string;
  toId: string;
  kind: GenealogyLinkKind;
  confidence: GenealogyConfidence;
  firstMonth: number;
  lastMonth: number;
  sourceEventIds: string[];
  sourceMemoryIds: string[];
}

export interface InstitutionLegacyMemory {
  id: string;
  institutionId: string;
  name: string;
  kind: Institution['kind'];
  settlementId: string;
  cultureId: string;
  foundedMonth: number;
  lastEvidenceMonth: number;
  founderPersonIds: string[];
  foundingIdeaIds: string[];
  parentInstitutionIds: string[];
  successorInstitutionIds: string[];
  famousMemberIds: string[];
  ideaIds: string[];
  knowledgeLineageIds: string[];
  politicalDescendantIds: string[];
  significance: number;
  persistence: number;
  sourceEventIds: string[];
  sourceMemoryIds: string[];
  reasons: string[];
}

export interface HistoricalMovementMemory {
  id: string;
  conceptId: string;
  name: string;
  topic: SocialIdea['topic'];
  startedMonth: number;
  lastEvidenceMonth: number;
  rootIdeaId: string;
  ideaIds: string[];
  personIds: string[];
  institutionIds: string[];
  confidence: number;
  persistence: number;
  sourceEventIds: string[];
  sourceMemoryIds: string[];
}

export type WorldThemeKind =
  | 'trade-interdependence'
  | 'knowledge-loss-recovery'
  | 'political-fragmentation'
  | 'religious-continuity'
  | 'migration'
  | 'environmental-adaptation'
  | 'militarization'
  | 'institutional-resilience'
  | 'technological-acceleration';

export interface WorldThemeMemory {
  id: string;
  kind: WorldThemeKind;
  firstEvidenceMonth: number;
  lastEvidenceMonth: number;
  support: number;
  opposition: number;
  evidenceCount: number;
  confidence: number;
  score: number;
  revisionCount: number;
  sourceEventIds: string[];
  sourceMemoryIds: string[];
}

export interface HumanQuestionResolution {
  id: string;
  questionId: string;
  questionText: string;
  openedMonth: number;
  resolvedMonth: number;
  text: string;
  entityIds: string[];
  sourceEventIds: string[];
  sourceMemoryIds: string[];
  narrated: boolean;
}

export interface HumanNarrationMark {
  key: string;
  count: number;
  lastMonth: number;
}

export interface HumanHistorySnapshot {
  version: 1;
  lastProcessedMonth: number;
  processedEventIdsAtMonth: string[];
  lastStructuralScanMonth: number;
  people: PersonLegacyMemory[];
  institutions: InstitutionLegacyMemory[];
  genealogy: GenealogyLink[];
  movements: HistoricalMovementMemory[];
  themes: WorldThemeMemory[];
  questionResolutions: HumanQuestionResolution[];
  narrationMarks: HumanNarrationMark[];
}

export interface HumanHistoryRemark {
  key: string;
  category: 'legacy' | 'genealogy' | 'institution' | 'movement' | 'theme' | 'question-resolution' | 'life-project';
  text: string;
  priority: number;
  provenance: DeepProvenanceClass;
  sourceEventIds: string[];
  sourceEntityIds: string[];
  sourceMemoryIds: string[];
}

export const HUMAN_HISTORY_LIMITS = {
  people: 256,
  institutions: 160,
  genealogy: 768,
  movements: 96,
  themes: 12,
  questionResolutions: 80,
  narrationMarks: 160,
  eventRefs: 20,
  memoryRefs: 20,
  entityRefs: 16,
  reasons: 10,
  processedEventRefs: 64,
} as const;

const KNOWLEDGE_EVENTS = new Set<HistoricalEventType>([
  'discovery', 'knowledge-exchange', 'knowledge-lost', 'knowledge-rediscovered', 'knowledge-adopted',
  'technology-transformation', 'technology-widespread', 'archive-destroyed',
]);
const INSTITUTION_EVENTS = new Set<HistoricalEventType>([
  'institution-formed', 'political-transition', 'leadership-succession', 'alliance-formed', 'alliance-ended',
]);
const POLITICAL_EVENTS = new Set<HistoricalEventType>([
  'political-transition', 'leadership-succession', 'alliance-formed', 'alliance-ended', 'war-declared', 'war-ended',
]);
const MATERIAL_EVENTS = new Set<HistoricalEventType>([
  'infrastructure-built', 'trade-route-established', 'industrialization-stage', 'industrialization',
  'technology-transformation', 'technology-widespread', 'first-orbit', 'offworld-settlement',
]);
const CULTURAL_EVENTS = new Set<HistoricalEventType>(['cultural-shift', 'institution-formed', 'knowledge-adopted']);

const THEME_SIGNALS: Partial<Record<HistoricalEventType, Array<[WorldThemeKind, number]>>> = {
  'trade-route-established': [['trade-interdependence', 1]],
  'knowledge-exchange': [['trade-interdependence', 0.7], ['technological-acceleration', 0.35]],
  'first-contact': [['trade-interdependence', 0.35], ['migration', 0.25]],
  'knowledge-lost': [['knowledge-loss-recovery', 1]],
  'knowledge-rediscovered': [['knowledge-loss-recovery', 1.15], ['institutional-resilience', 0.25]],
  'archive-destroyed': [['knowledge-loss-recovery', 0.9]],
  'alliance-ended': [['political-fragmentation', 0.9], ['trade-interdependence', -0.55]],
  'war-declared': [['political-fragmentation', 0.55], ['militarization', 0.9], ['trade-interdependence', -0.45]],
  'battle': [['militarization', 0.65]],
  'war-ended': [['militarization', 0.35]],
  'political-transition': [['political-fragmentation', 0.45]],
  'civilization-collapse': [['political-fragmentation', 1.1], ['institutional-resilience', -0.7]],
  'alliance-formed': [['political-fragmentation', -0.35], ['trade-interdependence', 0.35]],
  'major-migration': [['migration', 1]],
  'settlement-founded': [['migration', 0.3]],
  'settlement-abandoned': [['migration', 0.5], ['institutional-resilience', -0.25]],
  'harvest-crisis': [['environmental-adaptation', 0.45]],
  'ecological-crisis': [['environmental-adaptation', 0.7]],
  'climate-crisis': [['environmental-adaptation', 0.8]],
  'resource-crisis': [['environmental-adaptation', 0.55]],
  'natural-catastrophe': [['environmental-adaptation', 0.65]],
  'recovery': [['environmental-adaptation', 0.8], ['institutional-resilience', 0.4]],
  'civilization-recovery': [['environmental-adaptation', 0.65], ['institutional-resilience', 0.9]],
  'institution-formed': [['institutional-resilience', 0.4]],
  'planetary-stability': [['institutional-resilience', 0.8], ['political-fragmentation', -0.45]],
  'discovery': [['technological-acceleration', 0.45]],
  'knowledge-adopted': [['technological-acceleration', 0.5]],
  'technology-transformation': [['technological-acceleration', 0.85]],
  'technology-widespread': [['technological-acceleration', 0.75]],
  'industrialization-stage': [['technological-acceleration', 0.65]],
  'industrialization': [['technological-acceleration', 1]],
  'atomic-threshold': [['technological-acceleration', 0.8], ['militarization', 0.2]],
  'nuclear-weapons-developed': [['militarization', 1]],
  'nuclear-crisis': [['militarization', 0.8]],
  'nuclear-use': [['militarization', 1.2]],
  'nuclear-exchange': [['militarization', 1.3]],
};

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const unique = (values: readonly string[]): string[] => [...new Set(values)];
const readable = (value: string): string => value.replaceAll('-', ' ');

function emptySnapshot(): HumanHistorySnapshot {
  return {
    version: 1,
    lastProcessedMonth: -1,
    processedEventIdsAtMonth: [],
    lastStructuralScanMonth: -1,
    people: [],
    institutions: [],
    genealogy: [],
    movements: [],
    themes: [],
    questionResolutions: [],
    narrationMarks: [],
  };
}

function contextString(event: HistoricalEvent, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = event.context[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function legacyScore(person: PersonLegacyMemory): number {
  return clamp(
    person.contemporaryFame * 0.12
      + person.intellectualInfluence * 0.22
      + person.institutionalInfluence * 0.17
      + person.politicalInfluence * 0.13
      + person.materialImpact * 0.14
      + person.culturalImpact * 0.10
      + person.historicalPersistence * 0.24,
  );
}

function movementName(root: SocialIdea): string {
  if (root.topic === 'science' || root.topic === 'technology' || root.topic === 'machine-intelligence') return `${root.name} tradition`;
  if (root.topic === 'religion' || root.topic === 'tradition') return `${root.name} movement`;
  if (root.topic === 'reform' || root.topic === 'government' || root.topic === 'social-organization') return `${root.name} reform movement`;
  return `${root.name} school`;
}

export class HumanHistoryMemory {
  private memory: HumanHistorySnapshot;

  constructor(snapshot?: HumanHistorySnapshot) {
    this.memory = emptySnapshot();
    this.restore(snapshot);
  }

  snapshot(): HumanHistorySnapshot {
    return structuredClone(this.memory);
  }

  restore(snapshot?: HumanHistorySnapshot): void {
    this.memory = this.sanitize(snapshot ?? emptySnapshot());
  }

  observe(state: SimulationState, deepHistory: DeepHistoricalMemory): void {
    const seenAtMonth = new Set(this.memory.processedEventIdsAtMonth);
    const events = state.history
      .filter((event) => event.month > this.memory.lastProcessedMonth
        || (event.month === this.memory.lastProcessedMonth && !seenAtMonth.has(event.id)))
      .sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));

    for (const event of events) this.processEvent(event, state, deepHistory);
    if (events.length > 0) {
      const latestMonth = events.at(-1)?.month ?? this.memory.lastProcessedMonth;
      this.memory.lastProcessedMonth = latestMonth;
      this.memory.processedEventIdsAtMonth = state.history
        .filter((event) => event.month === latestMonth)
        .map((event) => event.id)
        .slice(-HUMAN_HISTORY_LIMITS.processedEventRefs);
    }

    if (this.memory.lastStructuralScanMonth < 0 || state.month - this.memory.lastStructuralScanMonth >= 12) {
      this.memory.lastStructuralScanMonth = state.month;
      this.scanPeople(state, deepHistory);
      this.scanRelationships(state);
      this.scanIdeas(state);
      this.scanKnowledge(state);
      this.scanInstitutions(state, deepHistory);
      this.scanPolities(state);
      this.buildMovements(state);
      this.refreshPersistence(state);
    }
    this.compact();
  }

  resolveWatcherQuestions(snapshot: WatcherMemorySnapshot, state: SimulationState, deepHistory: DeepHistoricalMemory): WatcherMemorySnapshot {
    const next = structuredClone(snapshot);
    for (const question of next.questions) {
      if (question.status === 'resolved' && question.narrated) continue;
      const resolution = this.resolveQuestion(question, state, deepHistory);
      if (!resolution) continue;
      question.status = 'resolved';
      question.resolutionMonth = resolution.resolvedMonth;
      question.lastEvaluatedMonth = resolution.resolvedMonth;
      question.resolutionText = resolution.text;
      question.evidenceEventIds = unique([...question.evidenceEventIds, ...resolution.sourceEventIds]).slice(-16);
      // The deep-resolution narrator carries compressed provenance; suppress the raw-event-only Watcher version.
      question.narrated = true;
      const record: HumanQuestionResolution = {
        id: `human:question:${question.id}`,
        questionId: question.id,
        questionText: question.text,
        openedMonth: question.openedMonth,
        resolvedMonth: resolution.resolvedMonth,
        text: resolution.text,
        entityIds: unique(question.entityIds).slice(0, HUMAN_HISTORY_LIMITS.entityRefs),
        sourceEventIds: unique(resolution.sourceEventIds).slice(-HUMAN_HISTORY_LIMITS.eventRefs),
        sourceMemoryIds: unique(resolution.sourceMemoryIds).slice(-HUMAN_HISTORY_LIMITS.memoryRefs),
        narrated: false,
      };
      const index = this.memory.questionResolutions.findIndex((item) => item.questionId === question.id);
      if (index >= 0) this.memory.questionResolutions[index] = record;
      else this.memory.questionResolutions.push(record);
    }
    this.compact();
    return next;
  }

  legacyFor(personId: string): PersonLegacyMemory | undefined {
    const record = this.memory.people.find((item) => item.personId === personId);
    return record ? structuredClone(record) : undefined;
  }

  institutionFor(institutionId: string): InstitutionLegacyMemory | undefined {
    const record = this.memory.institutions.find((item) => item.institutionId === institutionId);
    return record ? structuredClone(record) : undefined;
  }

  themes(): WorldThemeMemory[] {
    return structuredClone([...this.memory.themes].sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.kind.localeCompare(b.kind)));
  }

  hasMemoryId(id: string): boolean {
    return this.allMemoryIds().has(id);
  }

  shouldNarrate(key: string, month: number, cooldownYears = 120, maxCount = 2): boolean {
    const existing = this.memory.narrationMarks.find((item) => item.key === key);
    return !existing || (existing.count < maxCount && month - existing.lastMonth >= cooldownYears * 12);
  }

  markNarrated(key: string, month: number): void {
    const existing = this.memory.narrationMarks.find((item) => item.key === key);
    if (existing) {
      existing.count += 1;
      existing.lastMonth = month;
    } else {
      this.memory.narrationMarks.push({ key, count: 1, lastMonth: month });
    }
    if (key.startsWith('question:')) {
      const questionId = key.slice('question:'.length);
      const resolution = this.memory.questionResolutions.find((item) => item.questionId === questionId);
      if (resolution) resolution.narrated = true;
    }
    this.compact();
  }

  remarkFor(scene: ObservationCandidate, state: SimulationState, sequence: number): HumanHistoryRemark | undefined {
    const question = this.memory.questionResolutions
      .filter((item) => !item.narrated)
      .sort((a, b) => (b.resolvedMonth - b.openedMonth) - (a.resolvedMonth - a.openedMonth) || b.resolvedMonth - a.resolvedMonth)[0];
    if (question && (question.entityIds.includes(scene.subjectId) || sequence % 19 === 0)) {
      const years = Math.max(1, Math.floor((question.resolvedMonth - question.openedMonth) / 12));
      return {
        key: `question:${question.questionId}`,
        category: 'question-resolution',
        text: `${years.toLocaleString()} years ago I wondered: ${question.questionText} ${question.text}`,
        priority: 0.98,
        provenance: 'historical-interpretation',
        sourceEventIds: [...question.sourceEventIds],
        sourceEntityIds: [...question.entityIds],
        sourceMemoryIds: [...question.sourceMemoryIds],
      };
    }

    return this.institutionRemark(scene, state)
      ?? this.legacyRemark(scene, state)
      ?? this.movementRemark(scene, state)
      ?? (sequence % 23 === 0 ? this.themeRemark(scene, state) : undefined);
  }

  private processEvent(event: HistoricalEvent, state: SimulationState, deepHistory: DeepHistoricalMemory): void {
    this.updateThemesFromEvent(event, deepHistory);
    const attributed = contextString(event, ['attributedPersonId', 'originatorId', 'founderPersonId', 'founderId']);
    const personIds = unique([
      ...(attributed ? [attributed] : []),
      ...event.actors.filter((id) => state.people.some((person) => person.id === id)),
    ]);
    for (const personId of personIds) {
      const person = state.people.find((candidate) => candidate.id === personId);
      if (!person) continue;
      const memory = this.rememberPerson(person, event.month);
      memory.contemporaryFame = Math.max(memory.contemporaryFame, event.significance, person.prestige, person.historical?.score ?? 0);
      if (KNOWLEDGE_EVENTS.has(event.type)) this.raise(memory, 'intellectualInfluence', 0.18 + event.significance * 0.42, event, 'recorded intellectual contribution');
      if (INSTITUTION_EVENTS.has(event.type)) this.raise(memory, 'institutionalInfluence', 0.14 + event.significance * 0.36, event, 'recorded institutional influence');
      if (POLITICAL_EVENTS.has(event.type)) this.raise(memory, 'politicalInfluence', 0.14 + event.significance * 0.38, event, 'recorded political influence');
      if (MATERIAL_EVENTS.has(event.type)) this.raise(memory, 'materialImpact', 0.14 + event.significance * 0.4, event, 'recorded material or technical consequence');
      if (CULTURAL_EVENTS.has(event.type)) this.raise(memory, 'culturalImpact', 0.12 + event.significance * 0.35, event, 'recorded cultural consequence');
      const deepEvent = deepHistory.eventMemory(event.id);
      if (deepEvent) memory.sourceMemoryIds = unique([...memory.sourceMemoryIds, deepEvent.id]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      const lineage = contextString(event, ['lineageId', 'knowledge']);
      if (lineage) memory.knowledgeLineageIds = unique([...memory.knowledgeLineageIds, lineage]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
    }

    if (event.type === 'death') {
      const personId = event.actors.find((id) => state.people.some((person) => person.id === id));
      const person = personId ? state.people.find((candidate) => candidate.id === personId) : undefined;
      if (person) this.rememberPerson(person, event.month).deathMonth = event.month;
    }
    if (event.type === 'institution-formed') this.processInstitutionFormation(event, state, deepHistory);
    if (event.type === 'political-transition') this.processPoliticalTransition(event, state, deepHistory);
    this.promoteFromDownstreamEvent(event, deepHistory);
  }

  private scanPeople(state: SimulationState, deepHistory: DeepHistoricalMemory): void {
    for (const person of state.people) {
      const project = lifeProjectForPerson(person);
      const worthRemembering = person.historical?.status === 'notable' || person.historical?.status === 'historical'
        || person.prestige >= 0.55 || (person.influence?.total ?? 0) >= 0.55
        || Boolean(project?.relatedEventIds.length) || project?.status === 'completed';
      if (!worthRemembering) continue;
      const memory = this.rememberPerson(person, state.month);
      memory.contemporaryFame = Math.max(memory.contemporaryFame, person.prestige, person.historical?.score ?? 0, person.influence?.reputation ?? 0);
      if (project) {
        if (['scientific-research', 'systematic-inquiry', 'medical-inquiry', 'computation', 'preserve-knowledge'].includes(project.kind)) memory.intellectualInfluence = Math.max(memory.intellectualInfluence, project.status === 'completed' ? 0.55 : 0.28);
        if (project.kind === 'found-institution') memory.institutionalInfluence = Math.max(memory.institutionalInfluence, project.status === 'completed' ? 0.58 : 0.3);
        if (project.kind === 'political-reform') memory.politicalInfluence = Math.max(memory.politicalInfluence, project.status === 'completed' ? 0.58 : 0.3);
        if (['engineering-improvement', 'industrial-invention', 'electrical-systems', 'spaceflight'].includes(project.kind)) memory.materialImpact = Math.max(memory.materialImpact, project.status === 'completed' ? 0.56 : 0.28);
        if (project.kind === 'religious-reform') memory.culturalImpact = Math.max(memory.culturalImpact, project.status === 'completed' ? 0.56 : 0.28);
        memory.sourceEventIds = unique([...memory.sourceEventIds, ...project.relatedEventIds]).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
        if (project.institutionId) memory.institutionIds = unique([...memory.institutionIds, project.institutionId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
        if (project.status === 'completed' && project.relatedEventIds.length > 0) memory.reasons = unique([...memory.reasons, `a completed life project produced recorded evidence: ${project.purpose}`]).slice(-HUMAN_HISTORY_LIMITS.reasons);
      }
      for (const eventId of memory.sourceEventIds) {
        const deep = deepHistory.eventMemory(eventId);
        if (deep) memory.sourceMemoryIds = unique([...memory.sourceMemoryIds, deep.id]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      }
      this.recalculatePerson(memory);
    }
  }

  private scanRelationships(state: SimulationState): void {
    for (const relationship of state.socialRelationships ?? []) {
      if (relationship.strength < 0.48 || (relationship.kind !== 'mentor' && relationship.kind !== 'intellectual-collaborator')) continue;
      // The schema does not encode direction for mentorship. Preserve the observed pair without inventing teacher/student direction.
      const [fromId, toId] = relationship.a.localeCompare(relationship.b) <= 0
        ? [relationship.a, relationship.b] : [relationship.b, relationship.a];
      this.addGenealogy({ fromId, toId, kind: relationship.kind, confidence: 'recorded', month: relationship.formedMonth });
      for (const [personId, otherId] of [[relationship.a, relationship.b], [relationship.b, relationship.a]] as const) {
        const person = state.people.find((item) => item.id === personId);
        if (!person) continue;
        const memory = this.rememberPerson(person, state.month);
        memory.relatedPersonIds = unique([...memory.relatedPersonIds, otherId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      }
    }
  }

  private scanIdeas(state: SimulationState): void {
    const ideas = state.ideas ?? [];
    const byId = new Map(ideas.map((idea) => [idea.id, idea]));
    for (const idea of ideas) {
      const originator = state.people.find((person) => person.id === idea.originatorId);
      if (originator) {
        const memory = this.rememberPerson(originator, state.month);
        memory.ideaIds = unique([...memory.ideaIds, idea.id]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
        const influence = clamp(0.18 + idea.reach * 0.38 + (idea.status === 'adopted' ? 0.22 : 0) + idea.generation * 0.025);
        const dimension: LegacyDimension = idea.topic === 'religion' || idea.topic === 'tradition' ? 'culturalImpact' : 'intellectualInfluence';
        if (influence > memory[dimension]) {
          memory[dimension] = influence;
          memory.reasons = unique([...memory.reasons, `${idea.name} continued beyond its originator`]).slice(-HUMAN_HISTORY_LIMITS.reasons);
        }
        this.addGenealogy({ fromId: originator.id, toId: `idea:${idea.id}`, kind: 'idea-originator', confidence: 'recorded', month: idea.originatedMonth });
      }

      if (idea.parentIdeaId && byId.has(idea.parentIdeaId)) {
        this.addGenealogy({ fromId: `idea:${idea.parentIdeaId}`, toId: `idea:${idea.id}`, kind: 'idea-descendant', confidence: 'recorded', month: idea.originatedMonth });
        const root = this.ideaRoot(idea, byId);
        if (root) {
          const rootPerson = this.memory.people.find((person) => person.personId === root.originatorId);
          if (rootPerson && idea.generation > 0) {
            rootPerson.historicalPersistence = Math.max(rootPerson.historicalPersistence, clamp(0.28 + idea.generation * 0.08 + idea.reach * 0.35));
            rootPerson.lastEvidenceMonth = Math.max(rootPerson.lastEvidenceMonth, idea.lastChangedMonth);
            rootPerson.reasons = unique([...rootPerson.reasons, `later ideas descend from ${root.name}`]).slice(-HUMAN_HISTORY_LIMITS.reasons);
            this.recalculatePerson(rootPerson);
          }
        }
      }

      if (idea.institutionId) {
        const institution = state.institutions.find((item) => item.id === idea.institutionId);
        if (institution) {
          const memory = this.rememberInstitution(institution, state.month);
          memory.ideaIds = unique([...memory.ideaIds, idea.id]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
          this.addGenealogy({ fromId: institution.id, toId: `idea:${idea.id}`, kind: 'institution-idea', confidence: 'recorded', month: idea.originatedMonth });
        }
      }
      if ((idea.topic === 'religion' || idea.topic === 'tradition') && (idea.status === 'adopted' || idea.reach >= 0.5)) this.updateTheme('religious-continuity', 0.45 + idea.reach * 0.35, idea.lastChangedMonth, [], []);
    }
  }

  private scanKnowledge(state: SimulationState): void {
    const occurrences = new Map<string, Array<{ settlementId: string; record: KnowledgeRecord }>>();
    for (const settlement of state.settlements) {
      for (const record of Object.values(settlement.knowledge.records)) {
        const group = occurrences.get(record.lineageId) ?? [];
        group.push({ settlementId: settlement.id, record });
        occurrences.set(record.lineageId, group);
        if (record.attributedPersonId) {
          const person = state.people.find((candidate) => candidate.id === record.attributedPersonId);
          if (person) {
            const memory = this.rememberPerson(person, state.month);
            memory.knowledgeLineageIds = unique([...memory.knowledgeLineageIds, record.lineageId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
            this.addGenealogy({ fromId: person.id, toId: `knowledge:${record.lineageId}`, kind: 'knowledge-attribution', confidence: 'recorded', month: record.discoveredMonth });
          }
        }
        if (record.institutionId) {
          const institution = state.institutions.find((candidate) => candidate.id === record.institutionId);
          if (institution) {
            const memory = this.rememberInstitution(institution, state.month);
            memory.knowledgeLineageIds = unique([...memory.knowledgeLineageIds, record.lineageId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
            this.addGenealogy({ fromId: institution.id, toId: `knowledge:${record.lineageId}`, kind: 'institution-knowledge', confidence: 'recorded', month: record.discoveredMonth });
          }
        }
        for (const parent of record.parentLineages) this.addGenealogy({ fromId: `knowledge:${parent}`, toId: `knowledge:${record.lineageId}`, kind: 'knowledge-descendant', confidence: 'recorded', month: record.discoveredMonth });
      }
    }

    for (const [lineageId, group] of occurrences) {
      const distinctSettlements = new Set(group.map((item) => item.settlementId)).size;
      const earliest = [...group].sort((a, b) => a.record.discoveredMonth - b.record.discoveredMonth)[0];
      if (!earliest?.record.attributedPersonId) continue;
      const person = this.memory.people.find((item) => item.personId === earliest.record.attributedPersonId);
      const transformed = group.some((item) => item.record.transformedMonth !== undefined);
      if (!person || (distinctSettlements < 2 && !transformed)) continue;
      person.intellectualInfluence = Math.max(person.intellectualInfluence, transformed ? 0.78 : clamp(0.48 + distinctSettlements * 0.08));
      person.historicalPersistence = Math.max(person.historicalPersistence, clamp(0.42 + distinctSettlements * 0.07 + (transformed ? 0.18 : 0)));
      person.lastEvidenceMonth = Math.max(person.lastEvidenceMonth, ...group.map((item) => item.record.lastUsedMonth));
      person.reasons = unique([...person.reasons, `${readable(lineageId)} persisted across ${distinctSettlements} communities`]).slice(-HUMAN_HISTORY_LIMITS.reasons);
      this.recalculatePerson(person);
    }
  }

  private scanInstitutions(state: SimulationState, deepHistory: DeepHistoricalMemory): void {
    for (const institution of state.institutions) {
      const memory = this.rememberInstitution(institution, state.month);
      const ageYears = Math.max(0, (state.month - institution.foundedMonth) / 12);
      memory.persistence = Math.max(memory.persistence, clamp(Math.log1p(ageYears) / Math.log(501)));
      memory.significance = Math.max(memory.significance, clamp(institution.prestige * 0.5 + institution.reach * 0.3 + memory.persistence * 0.35));
      if (ageYears >= 100 && institution.support >= 0.35) this.updateTheme('institutional-resilience', 0.12, state.month, [], [memory.id]);

      for (const member of state.people.filter((person) => person.institutionId === institution.id)) {
        const legacy = this.memory.people.find((person) => person.personId === member.id);
        if (!legacy || legacy.retrospectiveSignificance < 0.55) continue;
        memory.famousMemberIds = unique([...memory.famousMemberIds, member.id]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
        legacy.institutionIds = unique([...legacy.institutionIds, institution.id]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
        this.addGenealogy({ fromId: member.id, toId: institution.id, kind: 'institution-member', confidence: 'recorded', month: state.month });
      }
      for (const eventId of memory.sourceEventIds) {
        const deep = deepHistory.eventMemory(eventId);
        if (deep) memory.sourceMemoryIds = unique([...memory.sourceMemoryIds, deep.id]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      }
    }
  }

  private scanPolities(state: SimulationState): void {
    for (const polity of state.polities) {
      if (polity.leadingPersonId) {
        const person = state.people.find((item) => item.id === polity.leadingPersonId);
        if (person) {
          const memory = this.rememberPerson(person, state.month);
          memory.politicalInfluence = Math.max(memory.politicalInfluence, clamp(0.35 + polity.legitimacy * 0.35 + polity.stability * 0.2));
          if (state.month - polity.formedMonth >= 120 * 12) memory.historicalPersistence = Math.max(memory.historicalPersistence, 0.42);
          this.recalculatePerson(memory);
        }
      }
      // Dynasty names and household IDs are descriptive evidence, not sufficient by themselves to invent a founder genealogy.
    }
  }

  private buildMovements(state: SimulationState): void {
    const ideas = state.ideas ?? [];
    const groups = new Map<string, SocialIdea[]>();
    for (const idea of ideas) groups.set(idea.conceptId, [...(groups.get(idea.conceptId) ?? []), idea]);
    for (const [conceptId, group] of groups) {
      if (group.length < 2) continue;
      const root = [...group].sort((a, b) => a.generation - b.generation || a.originatedMonth - b.originatedMonth || a.id.localeCompare(b.id))[0];
      if (!root) continue;
      const people = unique(group.map((idea) => idea.originatorId));
      const institutions = unique(group.map((idea) => idea.institutionId).filter((id): id is string => Boolean(id)));
      const adopted = group.some((idea) => idea.status === 'adopted' || idea.reach >= 0.55);
      const relationalSupport = (state.socialRelationships ?? []).filter((relationship) =>
        (relationship.kind === 'mentor' || relationship.kind === 'intellectual-collaborator')
        && people.includes(relationship.a) && people.includes(relationship.b) && relationship.strength >= 0.48).length;
      if (!adopted || (people.length < 2 && institutions.length === 0) || (group.length < 3 && relationalSupport === 0)) continue;
      const lastEvidenceMonth = Math.max(...group.map((idea) => idea.lastChangedMonth));
      const record: HistoricalMovementMemory = {
        id: `human:movement:${conceptId}`,
        conceptId,
        name: movementName(root),
        topic: root.topic,
        startedMonth: Math.min(...group.map((idea) => idea.originatedMonth)),
        lastEvidenceMonth,
        rootIdeaId: root.id,
        ideaIds: unique(group.map((idea) => idea.id)).slice(-HUMAN_HISTORY_LIMITS.entityRefs),
        personIds: people.slice(-HUMAN_HISTORY_LIMITS.entityRefs),
        institutionIds: institutions.slice(-HUMAN_HISTORY_LIMITS.entityRefs),
        confidence: clamp(0.38 + Math.min(0.22, group.length * 0.04) + Math.min(0.18, people.length * 0.04) + Math.min(0.12, relationalSupport * 0.04) + (institutions.length > 0 ? 0.08 : 0)),
        persistence: clamp(Math.log1p(Math.max(0, lastEvidenceMonth - root.originatedMonth) / 12) / Math.log(501)),
        sourceEventIds: [],
        sourceMemoryIds: unique([
          ...people.map((id) => `human:person:${id}`),
          ...institutions.map((id) => `human:institution:${id}`),
        ]).filter((id) => this.hasMemoryId(id)).slice(-HUMAN_HISTORY_LIMITS.memoryRefs),
      };
      const index = this.memory.movements.findIndex((item) => item.id === record.id);
      if (index >= 0) this.memory.movements[index] = record;
      else this.memory.movements.push(record);
    }
  }

  private refreshPersistence(state: SimulationState): void {
    for (const person of this.memory.people) {
      const origins = this.memory.genealogy.filter((link) => link.fromId === person.personId && ['idea-originator', 'knowledge-attribution', 'institution-founder'].includes(link.kind));
      const descendants = this.memory.genealogy.filter((link) => origins.some((origin) => origin.toId === link.fromId)
        && ['idea-descendant', 'knowledge-descendant', 'institution-successor'].includes(link.kind));
      const survivingInstitutions = person.institutionIds.filter((id) => state.institutions.some((institution) => institution.id === id)).length;
      const spanYears = Math.max(0, (person.lastEvidenceMonth - person.firstEvidenceMonth) / 12);
      person.historicalPersistence = Math.max(person.historicalPersistence, clamp(
        Math.min(0.42, Math.log1p(spanYears) / Math.log(2001) * 0.42)
          + Math.min(0.28, descendants.length * 0.08)
          + Math.min(0.2, survivingInstitutions * 0.08)
          + Math.min(0.18, person.knowledgeLineageIds.length * 0.035 + person.ideaIds.length * 0.025),
      ));
      this.recalculatePerson(person);
    }
  }

  private processInstitutionFormation(event: HistoricalEvent, state: SimulationState, deepHistory: DeepHistoricalMemory): void {
    const institutionId = contextString(event, ['institutionId', 'newInstitutionId'])
      ?? event.actors.find((id) => state.institutions.some((candidate) => candidate.id === id));
    const institution = institutionId ? state.institutions.find((candidate) => candidate.id === institutionId) : undefined;
    if (!institution) return;
    const memory = this.rememberInstitution(institution, event.month);
    memory.sourceEventIds = unique([...memory.sourceEventIds, event.id]).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
    const deep = deepHistory.eventMemory(event.id);
    if (deep) memory.sourceMemoryIds = unique([...memory.sourceMemoryIds, deep.id]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);

    const foundingIdeaId = contextString(event, ['foundingIdeaId', 'ideaId', 'motivationIdeaId']);
    if (foundingIdeaId) memory.foundingIdeaIds = unique([...memory.foundingIdeaIds, foundingIdeaId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);

    const founderId = contextString(event, ['founderPersonId', 'founderId', 'attributedPersonId', 'originatorId']);
    if (founderId && state.people.some((person) => person.id === founderId)) {
      memory.founderPersonIds = unique([...memory.founderPersonIds, founderId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      this.addGenealogy({ fromId: founderId, toId: institution.id, kind: 'institution-founder', confidence: 'recorded', month: event.month, sourceEventIds: [event.id], sourceMemoryIds: deep ? [deep.id] : [] });
      const founder = state.people.find((person) => person.id === founderId);
      if (founder) {
        const legacy = this.rememberPerson(founder, event.month);
        legacy.institutionIds = unique([...legacy.institutionIds, institution.id]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
        this.raise(legacy, 'institutionalInfluence', 0.55 + event.significance * 0.3, event, `helped found ${institution.name}`);
      }
    }

    let predecessorId = contextString(event, ['predecessorInstitutionId', 'parentInstitutionId', 'successorOf']);
    if (!predecessorId) {
      for (const causeId of event.causes) {
        const cause = state.history.find((candidate) => candidate.id === causeId && candidate.type === 'institution-formed');
        const candidate = cause?.actors.find((id) => state.institutions.some((item) => item.id === id));
        if (candidate) { predecessorId = candidate; break; }
      }
    }
    if (!predecessorId || predecessorId === institution.id) return;
    memory.parentInstitutionIds = unique([...memory.parentInstitutionIds, predecessorId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
    const predecessor = this.memory.institutions.find((item) => item.institutionId === predecessorId);
    if (predecessor) predecessor.successorInstitutionIds = unique([...predecessor.successorInstitutionIds, institution.id]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
    this.addGenealogy({ fromId: predecessorId, toId: institution.id, kind: 'institution-successor', confidence: 'recorded', month: event.month, sourceEventIds: [event.id], sourceMemoryIds: deep ? [deep.id] : [] });
  }

  private processPoliticalTransition(event: HistoricalEvent, state: SimulationState, deepHistory: DeepHistoricalMemory): void {
    const sourceInstitutionId = contextString(event, ['sourceInstitutionId', 'predecessorInstitutionId', 'originInstitutionId']);
    if (!sourceInstitutionId) return;
    const polityId = contextString(event, ['polityId', 'newPolityId'])
      ?? event.actors.find((id) => state.polities.some((polity) => polity.id === id));
    if (!polityId) return;
    const institution = this.memory.institutions.find((item) => item.institutionId === sourceInstitutionId);
    if (!institution) return;
    institution.politicalDescendantIds = unique([...institution.politicalDescendantIds, polityId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
    const deep = deepHistory.eventMemory(event.id);
    this.addGenealogy({ fromId: sourceInstitutionId, toId: polityId, kind: 'political-descendant', confidence: 'recorded', month: event.month, sourceEventIds: [event.id], sourceMemoryIds: deep ? [deep.id] : [] });
  }

  private promoteFromDownstreamEvent(event: HistoricalEvent, deepHistory: DeepHistoricalMemory): void {
    const target = deepHistory.eventMemory(event.id);
    for (const causeId of event.causes) {
      const cause = deepHistory.eventMemory(causeId);
      if (!cause?.attributedPersonId) continue;
      const person = this.memory.people.find((item) => item.personId === cause.attributedPersonId);
      if (!person) continue;
      const dimension: LegacyDimension = KNOWLEDGE_EVENTS.has(event.type) ? 'intellectualInfluence'
        : INSTITUTION_EVENTS.has(event.type) ? 'institutionalInfluence'
          : POLITICAL_EVENTS.has(event.type) ? 'politicalInfluence'
            : MATERIAL_EVENTS.has(event.type) ? 'materialImpact' : 'historicalPersistence';
      person[dimension] = Math.max(person[dimension], clamp(event.significance * 0.78));
      person.historicalPersistence = Math.max(person.historicalPersistence, clamp(0.32 + event.significance * 0.5));
      person.lastEvidenceMonth = Math.max(person.lastEvidenceMonth, event.month);
      person.sourceEventIds = unique([...person.sourceEventIds, causeId, event.id]).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
      person.sourceMemoryIds = unique([...person.sourceMemoryIds, cause.id, ...(target ? [target.id] : [])]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      person.reasons = unique([...person.reasons, 'later recorded consequences depended on an earlier contribution']).slice(-HUMAN_HISTORY_LIMITS.reasons);
      this.recalculatePerson(person);
    }
  }

  private resolveQuestion(question: WatcherQuestion, state: SimulationState, deepHistory: DeepHistoricalMemory): { resolvedMonth: number; text: string; sourceEventIds: string[]; sourceMemoryIds: string[] } | undefined {
    const deep = deepHistory.snapshot();
    if (question.kind === 'knowledge-diffusion') {
      const knowledge = String(question.metadata?.knowledge ?? '');
      if (!knowledge) return undefined;
      const chosen = deep.events
        .filter((event) => event.month >= question.openedMonth && event.knowledgeId === knowledge
          && ['knowledge-adopted', 'technology-widespread', 'technology-transformation', 'knowledge-rediscovered'].includes(event.type))
        .sort((a, b) => b.month - a.month || b.retrospectiveSignificance - a.retrospectiveSignificance)[0];
      if (!chosen) return undefined;
      return { resolvedMonth: chosen.month, text: `${readable(knowledge)} did spread beyond its beginning; later records show it entering broader practice.`, sourceEventIds: [chosen.eventId], sourceMemoryIds: [chosen.id] };
    }
    if (question.kind === 'institution-survival') {
      const institutionId = String(question.metadata?.institutionId ?? '');
      const institution = this.memory.institutions.find((item) => item.institutionId === institutionId);
      if (!institution) return undefined;
      if (institution.lastEvidenceMonth - question.openedMonth < 30 * 12 && institution.successorInstitutionIds.length === 0) return undefined;
      const lineage = institution.successorInstitutionIds.length > 0 ? ' Its form changed, but a recorded successor continued the institutional line.' : '';
      return { resolvedMonth: Math.max(institution.lastEvidenceMonth, question.openedMonth + 30 * 12), text: `${institution.name} endured beyond its founding generation.${lineage}`, sourceEventIds: [...institution.sourceEventIds], sourceMemoryIds: [institution.id, ...institution.sourceMemoryIds] };
    }
    if (question.kind === 'settlement-recovery') {
      const settlementId = question.entityIds[0];
      if (!settlementId) return undefined;
      const chosen = deep.events.filter((event) => event.month >= question.openedMonth && event.locationId === settlementId && (event.type === 'recovery' || event.type === 'civilization-recovery')).sort((a, b) => a.month - b.month)[0];
      if (!chosen) return undefined;
      const name = state.settlements.find((settlement) => settlement.id === settlementId)?.name ?? 'The settlement';
      return { resolvedMonth: chosen.month, text: `${name} did recover; the later record contains recovery rather than only the original crisis.`, sourceEventIds: [chosen.eventId], sourceMemoryIds: [chosen.id] };
    }
    return undefined;
  }

  private institutionRemark(scene: ObservationCandidate, state: SimulationState): HumanHistoryRemark | undefined {
    const institution = this.memory.institutions.find((item) => item.institutionId === scene.subjectId);
    if (!institution || institution.significance < 0.55) return undefined;
    if (institution.parentInstitutionIds.length > 0) {
      const parent = this.memory.institutions.find((item) => item.institutionId === institution.parentInstitutionIds[0]);
      const key = `institution-lineage:${institution.institutionId}:${parent?.institutionId ?? institution.parentInstitutionIds[0]}`;
      if (!this.shouldNarrate(key, state.month, 200, 2)) return undefined;
      return { key, category: 'institution', text: `${institution.name} has a recorded institutional ancestor${parent ? ` in ${parent.name}` : ''}. The line continued, though the institution did not remain unchanged.`, priority: 0.9, provenance: 'recorded-fact', sourceEventIds: [...institution.sourceEventIds], sourceEntityIds: [institution.institutionId, ...institution.parentInstitutionIds], sourceMemoryIds: [institution.id, ...institution.sourceMemoryIds] };
    }
    if (institution.founderPersonIds.length > 0 && state.month - institution.foundedMonth >= 120 * 12) {
      const founder = this.memory.people.find((item) => item.personId === institution.founderPersonIds[0]);
      if (founder && founder.retrospectiveSignificance >= 0.58) {
        const key = `institution-founder:${institution.institutionId}:${founder.personId}`;
        if (!this.shouldNarrate(key, state.month, 200, 2)) return undefined;
        const age = founder.deathMonth === undefined ? '' : `${Math.max(1, Math.floor((state.month - founder.deathMonth) / 12)).toLocaleString()} years after ${founder.name}'s death, `;
        return { key, category: 'institution', text: `${age}${institution.name} still has a documented line back to ${founder.name}.`, priority: 0.88, provenance: 'historical-interpretation', sourceEventIds: unique([...institution.sourceEventIds, ...founder.sourceEventIds]), sourceEntityIds: [institution.institutionId, founder.personId], sourceMemoryIds: [institution.id, founder.id, ...institution.sourceMemoryIds, ...founder.sourceMemoryIds] };
      }
    }
    return undefined;
  }

  private legacyRemark(scene: ObservationCandidate, state: SimulationState): HumanHistoryRemark | undefined {
    const related = this.memory.people.find((item) => item.personId === scene.subjectId)
      ?? this.memory.people.filter((person) => person.retrospectiveSignificance >= 0.62 && person.institutionIds.includes(scene.subjectId)).sort((a, b) => b.retrospectiveSignificance - a.retrospectiveSignificance)[0];
    if (!related || related.retrospectiveSignificance < 0.58 || related.deathMonth === undefined || state.month - related.deathMonth < 40 * 12 || related.historicalPersistence < 0.5) return undefined;
    const key = `legacy:${related.personId}:${scene.subjectId}`;
    if (!this.shouldNarrate(key, state.month, 180, 2)) return undefined;
    const yearsDead = Math.max(1, Math.floor((state.month - related.deathMonth) / 12));
    const reason = related.reasons.at(-1) ?? 'later records continued to depend on the work';
    return { key, category: 'legacy', text: `${related.name} has been dead for ${yearsDead.toLocaleString()} years. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`, priority: 0.92, provenance: 'historical-interpretation', sourceEventIds: [...related.sourceEventIds], sourceEntityIds: [related.personId, ...related.institutionIds].slice(0, HUMAN_HISTORY_LIMITS.entityRefs), sourceMemoryIds: [related.id, ...related.sourceMemoryIds] };
  }

  private movementRemark(scene: ObservationCandidate, state: SimulationState): HumanHistoryRemark | undefined {
    const movement = this.memory.movements.filter((item) => item.confidence >= 0.62 && item.persistence >= 0.22 && (item.institutionIds.includes(scene.subjectId) || item.personIds.includes(scene.subjectId) || item.ideaIds.includes(scene.subjectId))).sort((a, b) => b.confidence - a.confidence || b.persistence - a.persistence)[0];
    if (!movement) return undefined;
    const key = `movement:${movement.id}`;
    if (!this.shouldNarrate(key, state.month, 250, 2)) return undefined;
    return { key, category: 'movement', text: `${movement.name} is no longer one person's argument. The record connects it across ${Math.max(2, new Set(movement.personIds).size)} contributors${movement.institutionIds.length ? ' and durable institutions' : ''}.`, priority: 0.8, provenance: 'derived-statistic', sourceEventIds: [...movement.sourceEventIds], sourceEntityIds: unique([...movement.personIds, ...movement.institutionIds]).slice(0, HUMAN_HISTORY_LIMITS.entityRefs), sourceMemoryIds: [movement.id, ...movement.sourceMemoryIds] };
  }

  private themeRemark(scene: ObservationCandidate, state: SimulationState): HumanHistoryRemark | undefined {
    const theme = this.themes().find((item) => item.evidenceCount >= 5 && item.confidence >= 0.62 && item.score >= 0.5);
    if (!theme) return undefined;
    const key = `theme:${theme.kind}:${theme.revisionCount}`;
    if (!this.shouldNarrate(key, state.month, 600, 2)) return undefined;
    return { key, category: 'theme', text: this.themeText(theme.kind), priority: 0.7, provenance: 'historical-interpretation', sourceEventIds: [...theme.sourceEventIds], sourceEntityIds: scene.subjectId ? [scene.subjectId] : [], sourceMemoryIds: [...theme.sourceMemoryIds] };
  }

  private themeText(kind: WorldThemeKind): string {
    switch (kind) {
      case 'trade-interdependence': return 'Again, the durable connection is exchange rather than government.';
      case 'knowledge-loss-recovery': return 'This world keeps losing knowledge and rebuilding from fragments.';
      case 'political-fragmentation': return 'Political arrangements have repeatedly broken faster than the society around them.';
      case 'religious-continuity': return 'Belief has changed its language here more often than it has disappeared.';
      case 'migration': return 'Again, survival changes the map by moving people rather than holding them in place.';
      case 'environmental-adaptation': return 'Here, survival has repeatedly followed adaptation after environmental pressure.';
      case 'militarization': return 'Conflict keeps returning as an organizing force in this history.';
      case 'institutional-resilience': return 'Governments change here; some institutions have proved harder to erase.';
      case 'technological-acceleration': return 'New capabilities are arriving faster than earlier generations learned to absorb them.';
    }
  }

  private updateThemesFromEvent(event: HistoricalEvent, deepHistory: DeepHistoricalMemory): void {
    const deep = deepHistory.eventMemory(event.id);
    for (const [kind, signal] of THEME_SIGNALS[event.type] ?? []) this.updateTheme(kind, signal * (0.55 + event.significance * 0.45), event.month, [event.id], deep ? [deep.id] : []);
  }

  private updateTheme(kind: WorldThemeKind, signal: number, month: number, eventIds: readonly string[], memoryIds: readonly string[]): void {
    let theme = this.memory.themes.find((item) => item.kind === kind);
    if (!theme) {
      if (signal <= 0) return;
      theme = { id: `human:theme:${kind}`, kind, firstEvidenceMonth: month, lastEvidenceMonth: month, support: 0, opposition: 0, evidenceCount: 0, confidence: 0, score: 0, revisionCount: 0, sourceEventIds: [], sourceMemoryIds: [] };
      this.memory.themes.push(theme);
    }
    const oldScore = theme.score;
    theme.support *= 0.997;
    theme.opposition *= 0.997;
    if (signal >= 0) theme.support = Math.min(40, theme.support + signal);
    else theme.opposition = Math.min(40, theme.opposition + Math.abs(signal));
    theme.evidenceCount = Math.min(10_000, theme.evidenceCount + 1);
    theme.lastEvidenceMonth = Math.max(theme.lastEvidenceMonth, month);
    theme.sourceEventIds = unique([...theme.sourceEventIds, ...eventIds]).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
    theme.sourceMemoryIds = unique([...theme.sourceMemoryIds, ...memoryIds]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
    const total = theme.support + theme.opposition;
    const supportShare = total === 0 ? 0 : theme.support / total;
    theme.score = clamp(Math.min(1, theme.support / 8) * 0.52 + Math.max(0, supportShare - 0.35) / 0.65 * 0.48);
    theme.confidence = clamp(Math.log1p(theme.evidenceCount) / Math.log(41) * 0.42 + supportShare * 0.48);
    if ((oldScore >= 0.55 && theme.score < 0.4) || (oldScore < 0.4 && theme.score >= 0.55)) theme.revisionCount += 1;
  }

  private rememberPerson(person: Person, month: number): PersonLegacyMemory {
    let memory = this.memory.people.find((item) => item.personId === person.id);
    if (!memory) {
      memory = {
        id: `human:person:${person.id}`, personId: person.id, name: person.name, bornMonth: person.bornMonth,
        firstEvidenceMonth: month, lastEvidenceMonth: month,
        contemporaryFame: Math.max(person.prestige, person.historical?.score ?? 0, person.influence?.reputation ?? 0),
        intellectualInfluence: person.influence?.scholarship ?? 0,
        institutionalInfluence: person.socialPosition?.institutionalPosition ?? 0,
        politicalInfluence: Math.max(person.influence?.office ?? 0, person.socialPosition?.politicalInfluence ?? 0),
        materialImpact: 0, culturalImpact: person.influence?.religion ?? 0, historicalPersistence: 0, retrospectiveSignificance: 0,
        knowledgeLineageIds: [], ideaIds: [], institutionIds: person.institutionId ? [person.institutionId] : [], relatedPersonIds: [],
        sourceEventIds: unique(person.historical?.eventIds ?? []).slice(-HUMAN_HISTORY_LIMITS.eventRefs), sourceMemoryIds: [],
        reasons: unique(person.historical?.reasons ?? []).slice(-HUMAN_HISTORY_LIMITS.reasons),
      };
      this.memory.people.push(memory);
    }
    memory.name = person.name || memory.name;
    memory.lastEvidenceMonth = Math.max(memory.lastEvidenceMonth, month);
    if (person.institutionId) memory.institutionIds = unique([...memory.institutionIds, person.institutionId]).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
    this.recalculatePerson(memory);
    return memory;
  }

  private recalculatePerson(memory: PersonLegacyMemory): void {
    memory.retrospectiveSignificance = legacyScore(memory);
  }

  private raise(memory: PersonLegacyMemory, dimension: LegacyDimension, value: number, event: HistoricalEvent, reason: string): void {
    memory[dimension] = Math.max(memory[dimension], clamp(value));
    memory.lastEvidenceMonth = Math.max(memory.lastEvidenceMonth, event.month);
    memory.sourceEventIds = unique([...memory.sourceEventIds, event.id]).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
    memory.reasons = unique([...memory.reasons, reason]).slice(-HUMAN_HISTORY_LIMITS.reasons);
    this.recalculatePerson(memory);
  }

  private rememberInstitution(institution: Institution, month: number): InstitutionLegacyMemory {
    let memory = this.memory.institutions.find((item) => item.institutionId === institution.id);
    if (!memory) {
      memory = {
        id: `human:institution:${institution.id}`, institutionId: institution.id, name: institution.name, kind: institution.kind,
        settlementId: institution.settlementId, cultureId: institution.cultureId, foundedMonth: institution.foundedMonth, lastEvidenceMonth: month,
        founderPersonIds: [], foundingIdeaIds: [], parentInstitutionIds: [], successorInstitutionIds: [], famousMemberIds: [], ideaIds: [],
        knowledgeLineageIds: [], politicalDescendantIds: [], significance: clamp(institution.prestige * 0.55 + institution.reach * 0.3), persistence: 0,
        sourceEventIds: [], sourceMemoryIds: [], reasons: [],
      };
      this.memory.institutions.push(memory);
    }
    memory.name = institution.name || memory.name;
    memory.lastEvidenceMonth = Math.max(memory.lastEvidenceMonth, month);
    return memory;
  }

  private addGenealogy(input: { fromId: string; toId: string; kind: GenealogyLinkKind; confidence: GenealogyConfidence; month: number; sourceEventIds?: readonly string[]; sourceMemoryIds?: readonly string[] }): void {
    if (!input.fromId || !input.toId || input.fromId === input.toId) return;
    const id = `human:link:${input.kind}:${input.fromId}->${input.toId}`;
    const existing = this.memory.genealogy.find((item) => item.id === id);
    if (existing) {
      existing.lastMonth = Math.max(existing.lastMonth, input.month);
      existing.sourceEventIds = unique([...existing.sourceEventIds, ...(input.sourceEventIds ?? [])]).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
      existing.sourceMemoryIds = unique([...existing.sourceMemoryIds, ...(input.sourceMemoryIds ?? [])]).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      return;
    }
    this.memory.genealogy.push({ id, fromId: input.fromId, toId: input.toId, kind: input.kind, confidence: input.confidence, firstMonth: input.month, lastMonth: input.month, sourceEventIds: unique(input.sourceEventIds ?? []).slice(-HUMAN_HISTORY_LIMITS.eventRefs), sourceMemoryIds: unique(input.sourceMemoryIds ?? []).slice(-HUMAN_HISTORY_LIMITS.memoryRefs) });
  }

  private ideaRoot(idea: SocialIdea, byId: ReadonlyMap<string, SocialIdea>): SocialIdea | undefined {
    let current: SocialIdea | undefined = idea;
    const seen = new Set<string>();
    while (current?.parentIdeaId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parentIdeaId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  private compact(): void {
    for (const person of this.memory.people) {
      person.knowledgeLineageIds = unique(person.knowledgeLineageIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      person.ideaIds = unique(person.ideaIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      person.institutionIds = unique(person.institutionIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      person.relatedPersonIds = unique(person.relatedPersonIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      person.sourceEventIds = unique(person.sourceEventIds).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
      person.sourceMemoryIds = unique(person.sourceMemoryIds).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      person.reasons = unique(person.reasons).slice(-HUMAN_HISTORY_LIMITS.reasons);
      this.recalculatePerson(person);
    }
    this.memory.people.sort((a, b) => b.retrospectiveSignificance - a.retrospectiveSignificance || b.lastEvidenceMonth - a.lastEvidenceMonth || a.personId.localeCompare(b.personId));
    this.memory.people = this.memory.people.slice(0, HUMAN_HISTORY_LIMITS.people);

    for (const institution of this.memory.institutions) {
      institution.founderPersonIds = unique(institution.founderPersonIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.foundingIdeaIds = unique(institution.foundingIdeaIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.parentInstitutionIds = unique(institution.parentInstitutionIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.successorInstitutionIds = unique(institution.successorInstitutionIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.famousMemberIds = unique(institution.famousMemberIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.ideaIds = unique(institution.ideaIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.knowledgeLineageIds = unique(institution.knowledgeLineageIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.politicalDescendantIds = unique(institution.politicalDescendantIds).slice(-HUMAN_HISTORY_LIMITS.entityRefs);
      institution.sourceEventIds = unique(institution.sourceEventIds).slice(-HUMAN_HISTORY_LIMITS.eventRefs);
      institution.sourceMemoryIds = unique(institution.sourceMemoryIds).slice(-HUMAN_HISTORY_LIMITS.memoryRefs);
      institution.reasons = unique(institution.reasons).slice(-HUMAN_HISTORY_LIMITS.reasons);
    }
    this.memory.institutions.sort((a, b) => (b.significance + b.persistence * 0.4) - (a.significance + a.persistence * 0.4) || b.lastEvidenceMonth - a.lastEvidenceMonth || a.institutionId.localeCompare(b.institutionId));
    this.memory.institutions = this.memory.institutions.slice(0, HUMAN_HISTORY_LIMITS.institutions);
    this.memory.genealogy.sort((a, b) => b.lastMonth - a.lastMonth || a.id.localeCompare(b.id));
    this.memory.genealogy = this.memory.genealogy.slice(0, HUMAN_HISTORY_LIMITS.genealogy);
    this.memory.movements.sort((a, b) => (b.confidence + b.persistence * 0.3) - (a.confidence + a.persistence * 0.3) || b.lastEvidenceMonth - a.lastEvidenceMonth || a.id.localeCompare(b.id));
    this.memory.movements = this.memory.movements.slice(0, HUMAN_HISTORY_LIMITS.movements);
    this.memory.themes.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.kind.localeCompare(b.kind));
    this.memory.themes = this.memory.themes.slice(0, HUMAN_HISTORY_LIMITS.themes);
    this.memory.questionResolutions.sort((a, b) => (a.narrated ? 1 : -1) - (b.narrated ? 1 : -1) || b.resolvedMonth - a.resolvedMonth);
    this.memory.questionResolutions = this.memory.questionResolutions.slice(0, HUMAN_HISTORY_LIMITS.questionResolutions);
    this.memory.narrationMarks.sort((a, b) => b.lastMonth - a.lastMonth || a.key.localeCompare(b.key));
    this.memory.narrationMarks = this.memory.narrationMarks.slice(0, HUMAN_HISTORY_LIMITS.narrationMarks);
    this.memory.processedEventIdsAtMonth = unique(this.memory.processedEventIdsAtMonth).slice(-HUMAN_HISTORY_LIMITS.processedEventRefs);
  }

  private allMemoryIds(): Set<string> {
    return new Set([
      ...this.memory.people.map((item) => item.id),
      ...this.memory.institutions.map((item) => item.id),
      ...this.memory.genealogy.map((item) => item.id),
      ...this.memory.movements.map((item) => item.id),
      ...this.memory.themes.map((item) => item.id),
      ...this.memory.questionResolutions.map((item) => item.id),
    ]);
  }

  private sanitize(snapshot: HumanHistorySnapshot): HumanHistorySnapshot {
    const source = structuredClone(snapshot);
    const copy: HumanHistorySnapshot = {
      ...emptySnapshot(),
      ...source,
      version: 1,
      people: (source.people ?? []).slice(0, HUMAN_HISTORY_LIMITS.people),
      institutions: (source.institutions ?? []).slice(0, HUMAN_HISTORY_LIMITS.institutions),
      genealogy: (source.genealogy ?? []).slice(0, HUMAN_HISTORY_LIMITS.genealogy),
      movements: (source.movements ?? []).slice(0, HUMAN_HISTORY_LIMITS.movements),
      themes: (source.themes ?? []).slice(0, HUMAN_HISTORY_LIMITS.themes),
      questionResolutions: (source.questionResolutions ?? []).slice(0, HUMAN_HISTORY_LIMITS.questionResolutions),
      narrationMarks: (source.narrationMarks ?? []).slice(0, HUMAN_HISTORY_LIMITS.narrationMarks),
      processedEventIdsAtMonth: unique(source.processedEventIdsAtMonth ?? []).slice(-HUMAN_HISTORY_LIMITS.processedEventRefs),
    };
    this.memory = copy;
    this.compact();
    return this.memory;
  }
}

declare module './WatcherMind' {
  interface WatcherMemorySnapshot {
    humanHistory?: HumanHistorySnapshot;
  }
}

export function humanHistoryFromWatcherSnapshot(snapshot?: { humanHistory?: HumanHistorySnapshot }): HumanHistoryMemory {
  return new HumanHistoryMemory(snapshot?.humanHistory);
}

export function attachHumanHistory<T extends { humanHistory?: HumanHistorySnapshot }>(snapshot: T, humanHistory: HumanHistorySnapshot): T {
  snapshot.humanHistory = structuredClone(humanHistory);
  return snapshot;
}
