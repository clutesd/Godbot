import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Historian } from '../src/historian/Historian';
import { installWatcherHistorian } from '../src/historian/WatcherHistorian';
import { DocumentaryMemory } from '../src/historian/DocumentaryMemory';
import { RunRecordBuilder, createRunIdentity } from '../src/historian/RunArchive';
import { CameraDirector } from '../src/render/CameraDirector';
import { emitEvent } from '../src/sim/History';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent } from '../src/sim/types';

installWatcherHistorian();
function fixture() {
  const sim = new Simulation({ seed: 'chronicle-evolution', startMode: 'established',
    startingPopulation: 24, settlementCount: [1, 1], world: { size: 20 } });
  sim.state.month = 4800;
  sim.state.history = [];
  return sim;
}
function entry(sim: Simulation, id: string, month: number, type: HistoricalEvent['type'], overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  const place = sim.state.settlements[0]!;
  return { id, month, type, actors: [place.id], locationId: place.id, location: { ...place.position },
    causes: [], context: {}, summary: `${place.name} opens a new chapter.`, outcome: 'A new practice takes root.',
    significance: 0.8, magnitude: 0.7, affectedPopulation: 24, tags: [], ...overrides };
}

describe('a chronicle that grows with its world', () => {
  it('expires unchanged observation threads rather than advertising centuries-old building changes', () => {
    const sim = fixture(), memory = new DocumentaryMemory(), place = sim.state.settlements[0]!;
    sim.state.month = 10;
    memory.observe(sim.state);
    sim.state.month = 11; place.buildings++;
    memory.observe(sim.state);
    expect(memory.candidates(sim.state).some(scene => scene.subjectId === place.id)).toBe(true);
    sim.state.month = 4800;
    memory.observe(sim.state);
    expect(memory.candidates(sim.state).some(scene => scene.subjectId === place.id)).toBe(false);
  });

  it('retains the first shelter in history without offering it as news 400 years later', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const shelter = entry(sim, 'first-shelter', 1, 'infrastructure-built', {
      context: { need: 'housing', temporary: true }, summary: 'The first lean-to is built.' });
    const discovery = entry(sim, 'new-finding', 4800, 'recipe-learned', {
      summary: 'Potters learn to fire glazed vessels.', outcome: 'Repeated trials make the process reproducible.' });
    sim.state.history.push(shelter, discovery);
    const before = JSON.stringify(sim.state);
    const scenes = historian.candidates(sim.state);
    expect(scenes.some(scene => scene.event?.id === shelter.id)).toBe(false);
    const chosen = historian.chooseScene(sim.state);
    expect(chosen.event?.id).toBe(discovery.id);
    expect(chosen.statement.text).toContain('Repeated trials');
    expect(chosen.statement.text).not.toContain('lean-to');
    expect(JSON.stringify(sim.state)).toBe(before);
    expect(sim.state.history).toContain(shelter);
  });

  it('expires the production camera firsts queue as well as the Historian event window', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(entry(sim, 'old-shelter', 1, 'infrastructure-built', { context: { need: 'housing' } }),
      entry(sim, 'current-threshold', 4800, 'atomic-threshold'));
    const director = new CameraDirector(new PerspectiveCamera(38, 1.6, 0.01, 200), sim.config, historian);
    const find = () => (director as unknown as { findMajorEvent(state: Simulation['state']): HistoricalEvent | undefined }).findMajorEvent(sim.state);
    expect(find()?.id).toBe('current-threshold');
  });

  it('keeps unheard major events after the former two-year cutoff and dates delayed narration', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(entry(sim, 'delayed', 4500, 'institution-formed', {
      summary: 'A school opens beside the river.', outcome: 'Teaching gains a permanent home.' }));
    const proposal = historian.chooseScene(sim.state, 'delayed');
    expect(proposal.statement.text).toContain('Year 375, month 1');
    expect(historian.candidates(sim.state).some(scene => scene.event?.id === 'delayed')).toBe(true);
    historian.acquireScene(proposal, sim.state, false);
    expect(historian.hasNarratedEvent('delayed')).toBe(false);
    expect(historian.candidates(sim.state).some(scene => scene.event?.id === 'delayed')).toBe(true);
    historian.acquireScene(proposal, sim.state, true);
    expect(historian.hasNarratedEvent('delayed')).toBe(true);
    expect(historian.candidates(sim.state).some(scene => scene.event?.id === 'delayed')).toBe(false);
  });

  it('gives a new event full novelty after years of visits to the same community', () => {
    const sim = fixture(), historian = new Historian(sim.config), place = sim.state.settlements[0]!;
    for (let index = 0; index < 30; index++) {
      const scene = historian.candidates(sim.state).find(scene => scene.id === `settlement:${place.id}`)!;
      historian.acquireScene(scene, sim.state, true);
    }
    sim.state.history.push(entry(sim, 'fresh', 4800, 'recipe-learned'));
    const fresh = historian.candidates(sim.state).find(scene => scene.event?.id === 'fresh')!;
    expect(fresh.breakdown.novelty).toBe(1);
    expect(historian.chooseScene(sim.state).event?.id).toBe('fresh');
  });

  it('builds dated catch-up chapters with different subjects and commits coverage only when narrated', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(entry(sim, 'school', 4620, 'institution-formed', { summary: 'A school opens.' }),
      entry(sim, 'road', 4660, 'trade-route-established', { summary: 'A road links two communities.' }),
      entry(sim, 'learning', 4740, 'recipe-learned', { summary: 'Potters learn a new firing method.' }),
      entry(sim, 'future', 4801, 'atomic-threshold', { significance: 1 }));
    const chapter = historian.candidates(sim.state).find(scene => scene.id.startsWith('chapter:'))!;
    expect(chapter.statement.sourceEventIds).toEqual(['school', 'road', 'learning']);
    expect(chapter.statement.text).toContain('Year 385');
    expect(chapter.statement.text).not.toContain('future');
    expect(historian.validateStatement(chapter.statement, sim.state)).toBe(true);
    historian.acquireScene(chapter, sim.state, false);
    expect(historian.candidates(sim.state).some(scene => scene.id.startsWith('chapter:'))).toBe(true);
    historian.acquireScene(chapter, sim.state, true);
    expect(historian.candidates(sim.state).some(scene => scene.id.startsWith('chapter:'))).toBe(false);
    expect(historian.hasNarratedEvent('road')).toBe(true);
    expect(historian.hasNarratedEvent('future')).toBe(false);
  });

  it('connects knowledge stages without linking unrelated discoveries at the same place', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(entry(sim, 'old', 10, 'infrastructure-built', { context: { need: 'housing' }, summary: 'The first lean-to is built.' }),
      entry(sim, 'pottery', 4780, 'discovery', { context: { knowledge: 'pottery' }, summary: 'Pottery is discovered.' }),
      entry(sim, 'sailing', 4790, 'discovery', { context: { knowledge: 'sailing' }, summary: 'Sailing is discovered.' }),
      entry(sim, 'adoption', 4800, 'knowledge-adopted', { context: { knowledge: 'pottery' }, summary: 'Pottery enters everyday practice.' }));
    const scene = historian.chooseScene(sim.state, 'adoption');
    expect(scene.statement.sourceEventIds).toContain('pottery');
    expect(scene.statement.sourceEventIds).not.toContain('sailing');
    expect(scene.statement.sourceEventIds).not.toContain('old');
    expect(scene.statement.text).toContain('1 year ago');
    expect(historian.validateStatement(scene.statement, sim.state)).toBe(true);
  });

  it('preserves an explicit old cause while refusing incidental centuries-old callbacks', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(entry(sim, 'root', 1, 'political-transition', { summary: 'The old council is established.' }),
      entry(sim, 'incidental', 2, 'infrastructure-built', { summary: 'The first lean-to is built.' }),
      entry(sim, 'consequence', 4800, 'political-transition', { causes: ['root'] }));
    const scene = historian.chooseScene(sim.state, 'consequence');
    expect(scene.statement.sourceEventIds).toContain('root');
    expect(scene.statement.text).toContain('399 years');
    expect(scene.statement.text).not.toContain('lean-to');
  });

  it('records findings, diffusion and resolved battles at emission even if retention removes them before saving', () => {
    const sim = fixture();
    const builder = new RunRecordBuilder(createRunIdentity(sim.config, sim.state, 1), sim.config, sim.state);
    const types = ['first-fire', 'technology-widespread', 'knowledge-exchange', 'battle', 'resource-deposit-discovered'] as const;
    const emitted = types.map((type, index) => {
      const { id: _id, month: _month, ...draft } = entry(sim, `source-${index}`, 4800, type, { significance: 0.4 });
      void _id; void _month;
      return emitEvent(sim.state, draft);
    });
    sim.state.history = [];
    const record = builder.update(sim.state);
    expect(record.events.map(event => event.id)).toEqual(emitted.map(event => event.id));
    expect(record.technologicalEventIds).toContain(emitted[1]!.id);
  });

  it('grounds ordinary life in a recent local development and does not repeat the callback', () => {
    const sim = fixture(), historian = new Historian(sim.config), place = sim.state.settlements[0]!;
    sim.state.history.push(entry(sim, 'local-school', 4790, 'institution-formed', { summary: 'A school opens beside the river.' }));
    const current = () => historian.candidates(sim.state).find(scene => scene.id === `settlement:${place.id}`)!;
    const proposal = current();
    historian.acquireScene(proposal, sim.state, true);
    expect(proposal.statement.text).toContain('A school opens beside the river.');
    expect(proposal.statement.sourceEventIds).toContain('local-school');
    const second = current();
    historian.acquireScene(second, sim.state, true);
    expect(second.statement.text).not.toContain('A school opens beside the river.');
  });
});
