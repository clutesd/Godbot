import { describe, expect, it } from 'vitest';
import { DeepHistoricalMemory, deepHistoryFromWatcherSnapshot } from '../src/historian/DeepHistoricalMemory';
import {
  HUMAN_HISTORY_LIMITS,
  HumanHistoryMemory,
  attachHumanHistory,
  humanHistoryFromWatcherSnapshot,
  type HumanHistorySnapshot,
} from '../src/historian/HumanHistoryMemory';
import { Historian } from '../src/historian/Historian';
import { NarrativeEpisodeDirector } from '../src/historian/NarrativeEpisodeDirector';
import { RunRecordBuilder, createRunIdentity } from '../src/historian/RunArchive';
import { emptyWatcherMemorySnapshot } from '../src/historian/WatcherMind';
import { registerWatcherMemory, watcherMemoryForState } from '../src/historian/WatcherMemoryRegistry';
import { installWatcherHistorian, snapshotWatcherMemory } from '../src/historian/WatcherHistorian';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent, Institution, SocialIdea, SocialRelationship } from '../src/sim/types';

function historicalEvent(
  id: string,
  month: number,
  type: HistoricalEvent['type'],
  simulation: Simulation,
  options: Partial<HistoricalEvent> = {},
): HistoricalEvent {
  const settlement = simulation.state.settlements[0]!;
  return {
    id,
    month,
    type,
    location: { ...settlement.position },
    locationId: settlement.id,
    actors: [settlement.id],
    causes: [],
    context: {},
    outcome: `${type} produced a recorded consequence.`,
    affectedPopulation: 20,
    magnitude: 0.65,
    significance: 0.72,
    tags: ['test'],
    summary: `${type} near ${settlement.name}`,
    ...options,
  };
}

function institution(id: string, name: string, simulation: Simulation, foundedMonth: number): Institution {
  const settlement = simulation.state.settlements[0]!;
  return {
    id,
    name,
    kind: 'knowledge-keepers',
    settlementId: settlement.id,
    cultureId: settlement.cultureShares ? Object.keys(settlement.cultureShares)[0] ?? simulation.state.cultures[0]?.id ?? 'culture' : simulation.state.cultures[0]?.id ?? 'culture',
    foundedMonth,
    support: 0.68,
    prestige: 0.72,
    resources: 0.6,
    reach: 0.58,
    members: 18,
    interests: ['records', 'inquiry'],
  };
}

function idea(id: string, conceptId: string, name: string, originatorId: string, month: number, parentIdeaId?: string): SocialIdea {
  return {
    id,
    conceptId,
    name,
    topic: 'science',
    settlementId: 'settlement-0',
    originatorId,
    originatedMonth: month,
    status: 'adopted',
    support: 0.7,
    opposition: 0.1,
    reach: 0.72,
    momentum: 0.6,
    generation: parentIdeaId ? 1 : 0,
    ...(parentIdeaId ? { parentIdeaId } : {}),
    lastChangedMonth: month + 24,
  };
}

describe('Human history Watcher integration', () => {
  it('lets influence continue after death only when downstream history supports it', () => {
    const simulation = new Simulation({ seed: 'human-legacy', startingPopulation: 120 });
    simulation.state.history = [];
    const person = simulation.state.people[0]!;
    person.prestige = 0.2;
    person.historical = { status: 'ordinary', score: 0.18, reasons: [], eventIds: [] };

    const discovery = historicalEvent('legacy-discovery', 12, 'discovery', simulation, {
      actors: [person.id, simulation.state.settlements[0]!.id],
      context: { knowledge: 'lens-grinding', attributedPersonId: person.id },
      significance: 0.42,
      summary: `${person.name} records an improved lens-grinding practice.`,
    });
    simulation.state.history.push(discovery);
    simulation.state.month = discovery.month;
    const deep = new DeepHistoricalMemory();
    const human = new HumanHistoryMemory();
    deep.observe(simulation.state);
    human.observe(simulation.state, deep);
    const before = human.legacyFor(person.id)!;

    person.alive = false;
    const death = historicalEvent('legacy-death', 80 * 12, 'death', simulation, {
      actors: [person.id],
      context: { name: person.name },
      significance: 0.08,
    });
    const later = historicalEvent('legacy-observatory', 640 * 12, 'technology-transformation', simulation, {
      causes: [discovery.id],
      context: { knowledge: 'lens-grinding' },
      significance: 0.92,
      summary: 'Regional observatories adopt transformed optical instruments.',
    });
    simulation.state.history.push(death, later);
    simulation.state.month = later.month;
    deep.observe(simulation.state);
    human.observe(simulation.state, deep);
    const after = human.legacyFor(person.id)!;

    expect(after.deathMonth).toBe(death.month);
    expect(after.intellectualInfluence).toBeGreaterThan(before.intellectualInfluence);
    expect(after.historicalPersistence).toBeGreaterThan(before.historicalPersistence);
    expect(after.retrospectiveSignificance).toBeGreaterThan(before.retrospectiveSignificance);
    expect(after.reasons.some((reason) => /later recorded consequences/i.test(reason))).toBe(true);
  });

  it('builds intellectual genealogy from recorded mentors, ideas and knowledge lineages', () => {
    const simulation = new Simulation({ seed: 'human-genealogy', startingPopulation: 120 });
    simulation.state.history = [];
    const [mentor, student] = simulation.state.people;
    if (!mentor || !student) throw new Error('Expected two people');
    const relationship: SocialRelationship = {
      id: 'mentor-link', a: mentor.id, b: student.id, kind: 'mentor', trust: 0.8, strength: 0.85, formedMonth: 12, lastContactMonth: 80,
    };
    simulation.state.socialRelationships = [relationship];
    const root = idea('idea-root', 'optics-tradition', 'Questions of Light', mentor.id, 12);
    const child = idea('idea-child', 'optics-tradition', 'Measured Light', student.id, 120, root.id);
    root.settlementId = simulation.state.settlements[0]!.id;
    child.settlementId = simulation.state.settlements[0]!.id;
    simulation.state.ideas = [root, child];
    simulation.state.settlements[0]!.knowledge.records.optics = {
      id: 'optics', theory: 0.7, practice: 0.6, discoveredMonth: 16, lastUsedMonth: 300,
      originSettlementId: simulation.state.settlements[0]!.id, lineageId: 'optics-lineage', parentLineages: [], source: 'discovery', dormant: false,
      attributedPersonId: mentor.id,
    };
    simulation.state.month = 300;

    const human = new HumanHistoryMemory();
    human.observe(simulation.state, new DeepHistoricalMemory());
    const links = human.snapshot().genealogy;
    expect(links.some((link) => link.kind === 'mentor' && [link.fromId, link.toId].includes(mentor.id) && [link.fromId, link.toId].includes(student.id))).toBe(true);
    expect(links.some((link) => link.kind === 'idea-originator' && link.fromId === mentor.id && link.toId === `idea:${root.id}`)).toBe(true);
    expect(links.some((link) => link.kind === 'idea-descendant' && link.fromId === `idea:${root.id}` && link.toId === `idea:${child.id}`)).toBe(true);
    expect(links.some((link) => link.kind === 'knowledge-attribution' && link.fromId === mentor.id && link.toId === 'knowledge:optics-lineage')).toBe(true);
  });

  it('does not fabricate historical relationships when the social record contains none', () => {
    const simulation = new Simulation({ seed: 'human-no-fabrication', startingPopulation: 120 });
    simulation.state.socialRelationships = [];
    simulation.state.ideas = [];
    const human = new HumanHistoryMemory();
    human.observe(simulation.state, new DeepHistoricalMemory());
    expect(human.snapshot().genealogy.some((link) => link.kind === 'mentor' || link.kind === 'intellectual-collaborator')).toBe(false);
  });

  it('follows a recorded institutional successor across generations', () => {
    const simulation = new Simulation({ seed: 'institution-lineage', startingPopulation: 120 });
    simulation.state.history = [];
    const founder = simulation.state.people[0]!;
    const first = institution('old-academy', 'Old Academy', simulation, 12);
    const successor = institution('new-academy', 'New Academy', simulation, 500 * 12);
    simulation.state.institutions.push(first, successor);
    const founding = historicalEvent('old-academy-founded', 12, 'institution-formed', simulation, {
      actors: [first.id, founder.id],
      context: { institutionId: first.id, founderPersonId: founder.id },
      significance: 0.75,
    });
    const succession = historicalEvent('new-academy-founded', 500 * 12, 'institution-formed', simulation, {
      actors: [successor.id],
      context: { institutionId: successor.id, predecessorInstitutionId: first.id },
      significance: 0.8,
    });
    simulation.state.history.push(founding, succession);
    simulation.state.month = succession.month;
    const deep = new DeepHistoricalMemory();
    deep.observe(simulation.state);
    const human = new HumanHistoryMemory();
    human.observe(simulation.state, deep);

    expect(human.institutionFor(successor.id)?.parentInstitutionIds).toContain(first.id);
    expect(human.institutionFor(first.id)?.successorInstitutionIds).toContain(successor.id);
    expect(human.snapshot().genealogy.some((link) => link.kind === 'institution-successor' && link.fromId === first.id && link.toId === successor.id)).toBe(true);
  });

  it('resolves a Watcher question centuries later using compressed history', () => {
    const simulation = new Simulation({ seed: 'human-question', startingPopulation: 120 });
    simulation.state.history = [];
    const discovery = historicalEvent('question-discovery', 12, 'discovery', simulation, {
      context: { knowledge: 'durable-records' }, significance: 0.72,
    });
    const spread = historicalEvent('question-spread', 360 * 12, 'technology-widespread', simulation, {
      context: { knowledge: 'durable-records' }, significance: 0.82,
    });
    simulation.state.history.push(discovery, spread);
    simulation.state.month = spread.month;
    const deep = new DeepHistoricalMemory();
    deep.observe(simulation.state);
    const human = new HumanHistoryMemory();
    human.observe(simulation.state, deep);

    const watcher = emptyWatcherMemorySnapshot();
    watcher.questions.push({
      id: 'centuries-question', kind: 'knowledge-diffusion', text: 'Will durable records spread?', openedMonth: 12,
      lastEvaluatedMonth: 12, status: 'open', entityIds: [simulation.state.settlements[0]!.id], evidenceEventIds: [discovery.id],
      metadata: { knowledge: 'durable-records', originId: simulation.state.settlements[0]!.id },
    });
    const resolved = human.resolveWatcherQuestions(watcher, simulation.state, deep);
    expect(resolved.questions[0]?.status).toBe('resolved');
    expect(resolved.questions[0]?.resolutionMonth).toBe(spread.month);
    expect(human.snapshot().questionResolutions[0]?.sourceMemoryIds).toContain(`deep:event:${spread.id}`);
  });

  it('detects an emergent theme and revises which theme dominates after later evidence', () => {
    const simulation = new Simulation({ seed: 'human-themes', startingPopulation: 120 });
    simulation.state.history = [];
    const human = new HumanHistoryMemory();
    const deep = new DeepHistoricalMemory();
    for (let index = 0; index < 7; index += 1) {
      simulation.state.history.push(historicalEvent(`trade-${index}`, (index + 1) * 12, 'trade-route-established', simulation, { significance: 0.72 }));
    }
    simulation.state.month = 7 * 12;
    deep.observe(simulation.state); human.observe(simulation.state, deep);
    expect(human.themes()[0]?.kind).toBe('trade-interdependence');

    for (let index = 0; index < 60; index += 1) {
      simulation.state.history.push(historicalEvent(`war-${index}`, (20 + index) * 12, 'war-declared', simulation, { significance: 0.8 }));
    }
    simulation.state.month = 90 * 12;
    deep.observe(simulation.state); human.observe(simulation.state, deep);
    expect(human.themes()[0]?.kind).toBe('militarization');
    expect(human.themes().find((theme) => theme.kind === 'trade-interdependence')?.revisionCount).toBeGreaterThan(0);
  });

  it('keeps human-history derivation deterministic', () => {
    const simulation = new Simulation({ seed: 'human-determinism', startingPopulation: 120 });
    simulation.step(36);
    const first = new HumanHistoryMemory();
    const second = new HumanHistoryMemory();
    const deepA = new DeepHistoricalMemory();
    const deepB = new DeepHistoricalMemory();
    deepA.observe(simulation.state); deepB.observe(simulation.state);
    first.observe(simulation.state, deepA); second.observe(simulation.state, deepB);
    expect(first.snapshot()).toEqual(second.snapshot());
  });

  it('persists human memory through RunArchive resume', () => {
    const simulation = new Simulation({ seed: 'human-resume', startingPopulation: 120 });
    const person = simulation.state.people[0]!;
    person.prestige = 0.72;
    const human = new HumanHistoryMemory();
    human.observe(simulation.state, new DeepHistoricalMemory());
    const watcher = attachHumanHistory(emptyWatcherMemorySnapshot(), human.snapshot());
    registerWatcherMemory(simulation.state, watcher);
    const identity = createRunIdentity(simulation.config, simulation.state, 1, '2026-01-01T00:00:00.000Z');
    const builder = new RunRecordBuilder(identity, simulation.config, simulation.state);
    registerWatcherMemory(simulation.state, watcher);
    const record = builder.update(simulation.state);
    expect(record.watcherMemory.humanHistory).toEqual(human.snapshot());

    const resumed = new Simulation(record.configuration);
    new RunRecordBuilder(identity, resumed.config, resumed.state, record);
    expect(humanHistoryFromWatcherSnapshot(watcherMemoryForState(resumed.state)).snapshot()).toEqual(human.snapshot());
  });

  it('bounds long-run human memory and presentation history', () => {
    const person = (index: number) => ({
      id: `human:person:p-${index}`, personId: `p-${index}`, name: `P ${index}`, bornMonth: 0, firstEvidenceMonth: 0, lastEvidenceMonth: index,
      contemporaryFame: 0.5, intellectualInfluence: 0.5, institutionalInfluence: 0.2, politicalInfluence: 0.2, materialImpact: 0.2,
      culturalImpact: 0.2, historicalPersistence: 0.5, retrospectiveSignificance: 0.5, knowledgeLineageIds: [], ideaIds: [], institutionIds: [],
      relatedPersonIds: [], sourceEventIds: [], sourceMemoryIds: [], reasons: [],
    });
    const oversized = {
      version: 1, lastProcessedMonth: 0, processedEventIdsAtMonth: [], lastStructuralScanMonth: 0,
      people: Array.from({ length: HUMAN_HISTORY_LIMITS.people + 80 }, (_, index) => person(index)),
      institutions: [],
      genealogy: Array.from({ length: HUMAN_HISTORY_LIMITS.genealogy + 100 }, (_, index) => ({
        id: `human:link:mentor:p-${index}->p-${index + 1}`, fromId: `p-${index}`, toId: `p-${index + 1}`, kind: 'mentor' as const,
        confidence: 'recorded' as const, firstMonth: index, lastMonth: index, sourceEventIds: [], sourceMemoryIds: [],
      })),
      movements: [], themes: [], questionResolutions: [],
      narrationMarks: Array.from({ length: HUMAN_HISTORY_LIMITS.narrationMarks + 40 }, (_, index) => ({ key: `mark-${index}`, count: 1, lastMonth: index })),
    } satisfies HumanHistorySnapshot;
    const bounded = new HumanHistoryMemory(oversized).snapshot();
    expect(bounded.people.length).toBeLessThanOrEqual(HUMAN_HISTORY_LIMITS.people);
    expect(bounded.genealogy.length).toBeLessThanOrEqual(HUMAN_HISTORY_LIMITS.genealogy);
    expect(bounded.narrationMarks.length).toBeLessThanOrEqual(HUMAN_HISTORY_LIMITS.narrationMarks);
  });

  it('keeps final Watcher additions selective, grounded and non-repetitive', () => {
    const director = new NarrativeEpisodeDirector();
    const selected = director.select([
      { key: 'thread:a', category: 'thread', text: 'This is part of a long rivalry.', priority: 0.7 },
      { key: 'theme:a', category: 'theme', text: 'Conflict keeps returning as an organizing force.', priority: 0.72 },
      { key: 'legacy:a', category: 'legacy', text: 'A dead scholar still has documented descendants.', priority: 0.9 },
      { key: 'legacy:a', category: 'legacy', text: 'A dead scholar still has documented descendants.', priority: 0.9 },
    ], 100, 'The base observation remains grounded.');
    expect(selected.beats.length).toBeLessThanOrEqual(2);
    expect(selected.beats.filter((beat) => beat.category === 'thread' || beat.category === 'theme').length).toBeLessThanOrEqual(1);
    expect(selected.text.match(/dead scholar/g)?.length).toBe(1);

    installWatcherHistorian();
    const simulation = new Simulation({ seed: 'watcher-grounding', startingPopulation: 120 });
    simulation.state.history = [];
    const event = historicalEvent('grounded-event', 24, 'discovery', simulation, {
      context: { knowledge: 'measured-light' }, significance: 0.82,
    });
    simulation.state.history.push(event);
    simulation.state.month = event.month;
    const historian = new Historian(simulation.config);
    for (let index = 0; index < 24; index += 1) {
      const observation = historian.chooseScene(simulation.state, index === 0 ? event.id : undefined);
      expect(historian.validateStatement(observation.statement, simulation.state)).toBe(true);
      expect(observation.statement.sourceEventIds.every((id) => simulation.state.history.some((candidate) => candidate.id === id))).toBe(true);
    }
    const snapshot = snapshotWatcherMemory(historian);
    const deep = deepHistoryFromWatcherSnapshot(snapshot);
    const human = humanHistoryFromWatcherSnapshot(snapshot);
    for (const statement of historian.statements) {
      expect((statement.sourceMemoryIds ?? []).every((id) => deep.hasMemoryId(id) || human.hasMemoryId(id))).toBe(true);
    }
  });
});
