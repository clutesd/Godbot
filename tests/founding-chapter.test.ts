import { describe, expect, it } from 'vitest';
import {
  chooseFoundingChapterScene,
  FOUNDING_CHAPTER_MONTHS_PER_SECOND,
  foundingChapterBaseline,
  foundingChapterProgress,
  installFoundingChapterPacing,
} from '../src/historian/FoundingChapter';
import { Historian } from '../src/historian/Historian';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import { Simulation } from '../src/sim/Simulation';

function completedArrival(seed: string): Simulation {
  const simulation = new Simulation({ seed, startMode: 'arrival' });
  simulation.advanceArrival(80);
  expect(simulation.state.arrival?.phase).toBe('FOUNDING_ORIENTATION');
  expect(simulation.historyRunning).toBe(false);
  expect(simulation.state.history.some(event => event.type === 'ARRIVAL_DAY')).toBe(true);
  return simulation;
}

describe('Founding Chapter 1a', () => {
  it('captures an immutable Year-Zero baseline for later continuity comparisons', () => {
    const simulation = completedArrival('founding-chapter-baseline');
    const baseline = foundingChapterBaseline(simulation.state);
    const arrivalEvent = simulation.state.history.find(event => event.type === 'ARRIVAL_DAY');

    expect(baseline).toBeDefined();
    expect(baseline?.population).toBe(Number(arrivalEvent?.context.population));
    expect(baseline?.expectedCommunityCount).toBe(simulation.state.arrival?.pods.length);
    expect(baseline?.communities).toHaveLength(simulation.state.arrival?.pods.length ?? 0);
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline?.communities)).toBe(true);

    for (const community of baseline?.communities ?? []) {
      const pod = simulation.state.arrival?.pods.find(candidate => candidate.id === community.podId);
      const cell = pod ? simulation.state.world.cells[pod.cellIndex] : undefined;
      expect(pod).toBeDefined();
      expect(pod?.site).toBeDefined();
      expect(cell).toBeDefined();
      expect(community.founderCount).toBe(pod?.population);
      expect(community.founderIds).toEqual(pod?.personIds);
      expect(community.domains).toEqual(pod?.domains);
      expect(community.knowledge).toEqual(pod?.knowledge);
      expect(community.supplies).toEqual(pod?.supplies);
      expect(community.site).toEqual(pod?.site);
      expect(Object.isFrozen(community)).toBe(true);
      expect(Object.isFrozen(community.supplies)).toBe(true);
      expect(Object.isFrozen(community.site)).toBe(true);
    }
  });

  it('reconstructs Year-Zero site conditions from the archived arrival manifest, not mutable world cells', () => {
    const simulation = completedArrival('founding-chapter-site-persistence');
    const pod = simulation.state.arrival?.pods[0];
    if (!pod?.site) throw new Error('Expected a persisted founding site snapshot');
    const originalSite = { ...pod.site };
    const cell = simulation.state.world.cells[pod.cellIndex];
    if (!cell) throw new Error('Expected founding world cell');
    cell.fertility = originalSite.fertility === 0 ? 1 : 0;
    cell.wood = originalSite.woodland === 0 ? 1 : 0;

    const reconstructed = foundingChapterBaseline(simulation.state);
    const community = reconstructed?.communities.find(candidate => candidate.podId === pod.id);
    expect(community?.site).toEqual(originalSite);
    expect(community?.site.fertility).not.toBe(cell.fertility);
    expect(community?.site.woodland).not.toBe(cell.wood);
  });

  it('hands Arrival Day into one grounded overview, then gets out of the way', () => {
    const simulation = completedArrival('founding-chapter-sequence');
    const historian = new Historian(simulation.config);
    const baseline = foundingChapterBaseline(simulation.state);
    const ready = foundingChapterProgress(historian, simulation.state);
    expect(ready.phase).toBe('ready');
    expect(ready.totalBeats).toBe(1);

    const scene = chooseFoundingChapterScene(historian, simulation.state);
    expect(scene).toBeDefined();
    expect(scene?.title).toBe(`ARRIVAL DAY · THE ${baseline?.expectedCommunityCount} LANDINGS`);
    expect(scene?.event?.type).toBe('ARRIVAL_DAY');
    expect(scene?.statement.text).toContain('This is the last moment their histories are known together.');
    expect(scene?.statement.text).toMatch(/From here, we watch/);
    expect(scene?.statement.text).not.toContain('permanent beginning of this record');
    expect(scene && historian.validateStatement(scene.statement, simulation.state)).toBe(true);

    expect(historian.statements).toHaveLength(1);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  });

  it('does not replay the Month-Zero overview after authoritative time advances', () => {
    const simulation = completedArrival('founding-chapter-continuity');
    const historian = new Historian(simulation.config);
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeDefined();
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
    expect(simulation.beginHistory()).toBe(true);
    simulation.step(6);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  });

  it('does not begin the Year-Zero orientation on a newly created Historian after Month 0', () => {
    const simulation = completedArrival('founding-chapter-resume');
    expect(simulation.beginHistory()).toBe(true);
    simulation.step(1);
    const historian = new Historian(simulation.config);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('missed-opening');
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  });

  it('keeps the single overview grounded even if one founding settlement is unavailable', () => {
    const simulation = completedArrival('founding-chapter-degraded');
    const historian = new Historian(simulation.config);
    const baseline = foundingChapterBaseline(simulation.state);
    const missing = baseline?.communities[0];
    if (!missing) throw new Error('Expected a founding community');
    const index = simulation.state.settlements.findIndex(candidate => candidate.id === missing.settlementId);
    if (index < 0) throw new Error('Expected the founding settlement in authoritative state');
    simulation.state.settlements.splice(index, 1);

    const reconstructed = foundingChapterBaseline(simulation.state);
    expect(reconstructed?.communities.some(community => community.settlementId === missing.settlementId)).toBe(true);

    const overview = chooseFoundingChapterScene(historian, simulation.state);
    expect(overview).toBeDefined();
    expect(overview?.id).toContain('founding:overview:');
    expect(overview && historian.validateStatement(overview.statement, simulation.state)).toBe(true);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
  });

  it('requests the slowest supported documentary cadence while Arrival Day context is on screen', () => {
    const simulation = completedArrival('founding-chapter-pacing');
    installFoundingChapterPacing();
    const presentation = new PresentationDirector(simulation.config);
    const speed = presentation.targetSpeed(simulation.state, {
      kind: 'world-establishing',
      interest: 1,
      eventType: 'ARRIVAL_DAY',
      eventMonth: 0,
    });
    expect(speed).toBe(FOUNDING_CHAPTER_MONTHS_PER_SECOND);
    expect(speed).toBeLessThan(simulation.config.presentation.momentousMonthsPerSecond);
  });
});
