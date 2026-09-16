import { describe, expect, it } from 'vitest';
import {
  chooseFoundingChapterScene,
  FOUNDING_CHAPTER_MONTHS_PER_SECOND,
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
  it('hands Arrival Day into one grounded overview and all five founding communities', () => {
    const simulation = completedArrival('founding-chapter-sequence');
    const historian = new Historian(simulation.config);
    const scenes = Array.from({ length: 6 }, () => chooseFoundingChapterScene(historian, simulation.state));

    expect(scenes.every(Boolean)).toBe(true);
    const grounded = scenes.filter((scene): scene is NonNullable<typeof scene> => Boolean(scene));
    expect(grounded).toHaveLength(6);
    expect(grounded[0]?.title).toBe('ARRIVAL DAY · THE FIVE LANDINGS');
    expect(grounded[0]?.event?.type).toBe('ARRIVAL_DAY');
    expect(grounded.every(scene => historian.validateStatement(scene.statement, simulation.state))).toBe(true);

    const pods = simulation.state.arrival?.pods ?? [];
    for (const pod of pods) {
      const settlement = simulation.state.settlements.find(candidate => candidate.id === pod.settlementId);
      expect(settlement).toBeDefined();
      expect(grounded.some(scene => scene.subjectId === settlement?.id && scene.statement.text.includes(pod.name))).toBe(true);
      expect(grounded.some(scene => pod.knowledge.every(knowledge => scene.statement.text.includes(knowledge.replaceAll('-', ' '))))).toBe(true);
    }

    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  });

  it('does not replay the founding orientation when an observation resumes long after Year One', () => {
    const simulation = completedArrival('founding-chapter-resume');
    simulation.step(19);
    const historian = new Historian(simulation.config);
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
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
