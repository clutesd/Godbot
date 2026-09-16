import { describe, expect, it } from 'vitest';
import {
  chooseFoundingChapterScene,
  foundingChapterBaseline,
  foundingChapterProgress,
} from '../src/historian/FoundingChapter';
import {
  chooseFoundingContinuityScene,
  foundingContinuityProgress,
} from '../src/historian/FoundingContinuity';
import {
  chooseFoundingYearOneScene,
  FOUNDING_YEAR_ONE_LATEST_START_MONTH,
  FOUNDING_YEAR_ONE_MONTH,
  foundingYearOneProgress,
  foundingYearOneSnapshot,
} from '../src/historian/FoundingYearOne';
import { Historian } from '../src/historian/Historian';
import { Simulation } from '../src/sim/Simulation';

function completedArrival(seed: string): Simulation {
  const simulation = new Simulation({ seed, startMode: 'arrival' });
  simulation.advanceArrival(60);
  expect(simulation.historyRunning).toBe(true);
  return simulation;
}

function completeOpening(simulation: Simulation, historian: Historian): void {
  const baseline = foundingChapterBaseline(simulation.state);
  if (!baseline) throw new Error('Expected founding baseline');
  let guard = baseline.communities.length + 2;
  while (foundingChapterProgress(historian, simulation.state).phase !== 'complete' && guard-- > 0) {
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeDefined();
  }
  expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
  expect(chooseFoundingContinuityScene(historian, simulation.state)?.title).toBe('THE FIRST SEASONS');
  for (const community of baseline.communities) {
    simulation.step(2);
    expect(chooseFoundingContinuityScene(historian, simulation.state)?.subjectId).toBe(community.settlementId);
  }
  expect(foundingContinuityProgress(historian, simulation.state).complete).toBe(true);
}

describe('Founding Chapter 1c Year-One payoff', () => {
  it('reconstructs first-year demographic and historical totals from authoritative timestamps', () => {
    const simulation = completedArrival('founding-year-one-snapshot');
    simulation.step(16);
    const baseline = foundingChapterBaseline(simulation.state);
    const snapshot = foundingYearOneSnapshot(simulation.state);
    if (!baseline || !snapshot) throw new Error('Expected Year-One snapshot');

    const end = baseline.eventMonth + FOUNDING_YEAR_ONE_MONTH;
    const births = simulation.state.people.filter(person => person.bornMonth > baseline.eventMonth && person.bornMonth <= end).length;
    const deaths = simulation.state.people.filter(person => person.diedMonth !== undefined && person.diedMonth > baseline.eventMonth && person.diedMonth <= end).length;
    expect(snapshot.births).toBe(births);
    expect(snapshot.deaths).toBe(deaths);
    expect(snapshot.yearOnePopulation).toBe(baseline.population + births - deaths);
    expect(snapshot.observedMonth).toBe(16);
    expect(snapshot.yearEndMonth).toBe(12);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.communities)).toBe(true);
  });

  it('waits for the first year and then delivers synthesis, divergence, and an unresolved thread', () => {
    const simulation = completedArrival('founding-year-one-sequence');
    const historian = new Historian(simulation.config);
    simulation.step(11);
    expect(foundingYearOneProgress(historian, simulation.state).phase).toBe('waiting');
    expect(chooseFoundingYearOneScene(historian, simulation.state)).toBeUndefined();

    simulation.step(1);
    expect(foundingYearOneProgress(historian, simulation.state).phase).toBe('ready');
    const scenes = [
      chooseFoundingYearOneScene(historian, simulation.state),
      chooseFoundingYearOneScene(historian, simulation.state),
      chooseFoundingYearOneScene(historian, simulation.state),
    ];
    expect(scenes.map(scene => scene?.title)).toEqual([
      'ONE YEAR AFTER ARRIVAL',
      'THE LANDINGS DIVERGE',
      'WHAT REMAINS UNRESOLVED',
    ]);
    expect(scenes.every(scene => Boolean(scene) && historian.validateStatement(scene!.statement, simulation.state))).toBe(true);
    expect(scenes[0]?.statement.text).toContain('The first year is now in the record');
    expect(scenes[1]?.statement.text).toContain('different local histories');
    expect(scenes[2]?.statement.text).toContain('the consequences remain unwritten');
    expect(foundingYearOneProgress(historian, simulation.state).phase).toBe('complete');
  });

  it('runs after a completed 1b continuity chapter and holds history while the payoff is watched', () => {
    const simulation = completedArrival('founding-year-one-handoff');
    const historian = new Historian(simulation.config);
    const originalAutoRun = simulation.config.autoRun;
    completeOpening(simulation, historian);
    if (simulation.state.month < FOUNDING_YEAR_ONE_MONTH) simulation.step(FOUNDING_YEAR_ONE_MONTH - simulation.state.month);

    const first = chooseFoundingYearOneScene(historian, simulation.state);
    expect(first?.title).toBe('ONE YEAR AFTER ARRIVAL');
    expect(simulation.config.autoRun).toBe(false);
    expect(chooseFoundingYearOneScene(historian, simulation.state)?.title).toBe('THE LANDINGS DIVERGE');
    expect(chooseFoundingYearOneScene(historian, simulation.state)?.title).toBe('WHAT REMAINS UNRESOLVED');
    // The following selection releases the hold before normal history resumes.
    expect(chooseFoundingYearOneScene(historian, simulation.state)).toBeUndefined();
    expect(simulation.config.autoRun).toBe(originalAutoRun);
  });

  it('uses a current factual pressure as the hook instead of inventing a cliffhanger', () => {
    const simulation = completedArrival('founding-year-one-hook');
    simulation.step(FOUNDING_YEAR_ONE_MONTH);
    const baseline = foundingChapterBaseline(simulation.state);
    const firstCommunity = baseline?.communities[0];
    if (!firstCommunity) throw new Error('Expected founding community');
    const settlement = simulation.state.settlements.find(candidate => candidate.id === firstCommunity.settlementId);
    if (!settlement) throw new Error('Expected founding settlement');
    settlement.foodSecurity = 0.2;
    settlement.resources.food = Math.min(settlement.resources.food, firstCommunity.supplies.food * 0.25);

    const historian = new Historian(simulation.config);
    expect(chooseFoundingYearOneScene(historian, simulation.state)).toBeDefined();
    expect(chooseFoundingYearOneScene(historian, simulation.state)).toBeDefined();
    const unresolved = chooseFoundingYearOneScene(historian, simulation.state);
    expect(unresolved?.title).toBe('WHAT REMAINS UNRESOLVED');
    expect(unresolved?.statement.text).toMatch(/food security|food reserve/);
    expect(unresolved && historian.validateStatement(unresolved.statement, simulation.state)).toBe(true);
  });

  it('can serve as the catch-up chapter on a Year-One resume without replaying 1a or 1b', () => {
    const simulation = completedArrival('founding-year-one-resume');
    simulation.step(14);
    const historian = new Historian(simulation.config);
    expect(foundingYearOneProgress(historian, simulation.state).phase).toBe('ready');
    expect(chooseFoundingYearOneScene(historian, simulation.state)?.title).toBe('ONE YEAR AFTER ARRIVAL');
  });

  it('does not replay the founding-year retrospective on a much later resume', () => {
    const simulation = completedArrival('founding-year-one-late');
    simulation.step(FOUNDING_YEAR_ONE_LATEST_START_MONTH + 1);
    const historian = new Historian(simulation.config);
    expect(foundingYearOneProgress(historian, simulation.state).phase).toBe('missed');
    expect(chooseFoundingYearOneScene(historian, simulation.state)).toBeUndefined();
  });

  it('does nothing for non-arrival starts', () => {
    const simulation = new Simulation({ seed: 'founding-year-one-bootstrap', startMode: 'established' });
    const historian = new Historian(simulation.config);
    expect(foundingYearOneProgress(historian, simulation.state).phase).toBe('unavailable');
    expect(chooseFoundingYearOneScene(historian, simulation.state)).toBeUndefined();
  });
});
