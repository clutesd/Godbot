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
  simulation.advanceArrival(60);
  expect(simulation.historyRunning).toBe(true);
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

  it('hands Arrival Day into one grounded overview and every traceable founding community', () => {
    const simulation = completedArrival('founding-chapter-sequence');
    const historian = new Historian(simulation.config);
    const baseline = foundingChapterBaseline(simulation.state);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('ready');

    const sceneCount = (baseline?.communities.length ?? 0) + 1;
    const scenes = Array.from({ length: sceneCount }, () => chooseFoundingChapterScene(historian, simulation.state));

    expect(scenes.every(Boolean)).toBe(true);
    const grounded = scenes.filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
    expect(grounded).toHaveLength(sceneCount);
    expect(grounded[0]?.title).toBe(`ARRIVAL DAY · THE ${baseline?.expectedCommunityCount} LANDINGS`);
    expect(grounded[0]?.event?.type).toBe('ARRIVAL_DAY');
    expect(grounded[0]?.statement.text).toContain('This is the last moment their histories are known together.');
    expect(grounded[0]?.statement.text).toMatch(/From here, we watch/);
    expect(grounded[0]?.statement.text).not.toContain('permanent beginning of this record');
    expect(grounded.every(scene => historian.validateStatement(scene.statement, simulation.state))).toBe(true);

    const communityScenes = grounded.slice(1);
    for (const community of baseline?.communities ?? []) {
      const scene = communityScenes.find(candidate => candidate.subjectId === community.settlementId);
      expect(scene).toBeDefined();
      expect(scene?.statement.text).toContain(community.podName);
      expect(scene?.statement.text).toContain(community.site.biome.replaceAll('-', ' '));
      expect(community.domains.some(domain => scene?.statement.text.includes(domain.replaceAll('-', ' ')))).toBe(true);
      expect(scene?.statement.text).toMatch(/Compared with the other landings|clearest physical|no overwhelming physical advantage/);
      expect(scene?.statement.text).not.toContain('Their inherited strengths were');
      expect(scene?.statement.text).not.toContain('This was one of');
      expect(scene?.statement.text.length).toBeLessThan(420);
      expect(scene?.statement.epistemicStatus).toBe('derived-statistic');
    }
    const closingSentences = communityScenes.map(scene => scene.statement.text.split('. ').at(-1));
    expect(new Set(closingSentences).size).toBeGreaterThanOrEqual(Math.min(3, communityScenes.length));

    expect(historian.statements).toHaveLength(sceneCount);
    expect(new Set(historian.statements.map(statement => statement.id)).size).toBe(sceneCount);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  });

  it('continues an orientation that started at Month 0 even after simulated time advances', () => {
    const simulation = completedArrival('founding-chapter-continuity');
    const historian = new Historian(simulation.config);
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeDefined();
    simulation.step(6);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('orientation');
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeDefined();
  });

  it('does not begin the Year-Zero orientation on a newly created Historian after Month 0', () => {
    const simulation = completedArrival('founding-chapter-resume');
    simulation.step(1);
    const historian = new Historian(simulation.config);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('missed-opening');
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  });

  it('skips an invalid community beat without discarding the rest of the opening chapter', () => {
    const simulation = completedArrival('founding-chapter-degraded');
    const historian = new Historian(simulation.config);
    const baseline = foundingChapterBaseline(simulation.state);
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeDefined();
    const missing = baseline?.communities[0];
    if (!missing) throw new Error('Expected a founding community');
    const index = simulation.state.settlements.findIndex(candidate => candidate.id === missing.settlementId);
    if (index < 0) throw new Error('Expected the founding settlement in authoritative state');
    simulation.state.settlements.splice(index, 1);

    const reconstructed = foundingChapterBaseline(simulation.state);
    expect(reconstructed?.communities.some(community => community.settlementId === missing.settlementId)).toBe(true);

    const next = chooseFoundingChapterScene(historian, simulation.state);
    expect(next).toBeDefined();
    expect(next?.subjectId).not.toBe(missing.settlementId);
    expect(foundingChapterProgress(historian, simulation.state).phase).toBe('orientation');
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
