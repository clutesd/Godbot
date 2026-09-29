import { acquireProposal } from './observe-scene';
import { describe, expect, it } from 'vitest';
import {
  chooseFoundingChapterScene,
  foundingChapterBaseline,
  foundingChapterProgress,
  installFoundingChapterPacing,
} from '../src/historian/FoundingChapter';
import {
  chooseFoundingContinuityScene,
  FOUNDING_CONTINUITY_GRACE_END_MONTH,
  FOUNDING_CONTINUITY_MONTHS_PER_SECOND,
  FOUNDING_CONTINUITY_PRIMARY_END_MONTH,
  foundingCommunitySnapshot,
  foundingContinuityProgress,
  installFoundingContinuityPacing,
} from '../src/historian/FoundingContinuity';
import { Historian } from '../src/historian/Historian';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import { Simulation } from '../src/sim/Simulation';

function completedArrival(seed: string): Simulation {
  // Founding-story tests care about narrative contracts, not whether a particular tiny procedural
  // world happens to contain five safely separated sites. Keep enough deterministic land available.
  const simulation = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  simulation.advanceArrival(80);
  expect(simulation.state.arrival?.phase).toBe('FOUNDING_ORIENTATION');
  expect(simulation.beginHistory()).toBe(true);
  expect(simulation.historyRunning).toBe(true);
  return simulation;
}

function completeOrientation(simulation: Simulation, historian: Historian): void {
  const baseline = foundingChapterBaseline(simulation.state);
  if (!baseline) throw new Error('Expected founding baseline');
  let safety = baseline.communities.length + 2;
  while (foundingChapterProgress(historian, simulation.state).phase !== 'complete' && safety > 0) {
    expect(acquireProposal(historian, simulation.state, chooseFoundingChapterScene(historian, simulation.state))).toBeDefined();
    safety -= 1;
  }
  expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
  // The next lookup releases the Month-Zero presentation hold after the final shot has finished.
  expect(acquireProposal(historian, simulation.state, chooseFoundingChapterScene(historian, simulation.state))).toBeUndefined();
}

describe('Founding Chapter 1b continuity', () => {
  it('bridges out of Arrival Day before following the first-year communities', () => {
    const simulation = completedArrival('founding-continuity-bridge');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);

    const bridge = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    expect(bridge?.id).toContain('founding-continuity:bridge');
    expect(bridge?.title).toBe('THE FIRST DAYS');
    expect(bridge?.statement.text).toContain('The vessels are quiet now.');
    expect(bridge?.statement.text).toContain('every decision begins to separate their futures');
    expect(bridge && historian.validateStatement(bridge.statement, simulation.state)).toBe(true);
    expect(foundingContinuityProgress(historian, simulation.state).bridgeShown).toBe(true);
  });

  it('still shows the first-days bridge when the browser commits Month 1 before asking for the next scene', () => {
    const simulation = completedArrival('founding-continuity-live-handoff');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    simulation.step(1);

    const bridge = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    expect(simulation.state.month).toBe(1);
    expect(bridge?.id).toContain('founding-continuity:bridge');
    expect(bridge?.title).toBe('THE FIRST DAYS');
    expect(bridge?.statement.text).toContain('The vessels are quiet now.');
  });

  it('revisits every founding community in stable founding order with grounded then-vs-now facts', () => {
    const simulation = completedArrival('founding-continuity-sequence');
    const historian = new Historian(simulation.config);
    const baseline = foundingChapterBaseline(simulation.state);
    if (!baseline) throw new Error('Expected founding baseline');
    completeOrientation(simulation, historian);
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))).toBeDefined();

    const scenes = [];
    for (const community of baseline.communities) {
      simulation.step(2);
      const scene = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
      expect(scene).toBeDefined();
      if (scene) scenes.push(scene);
      expect(scene?.subjectId).toBe(community.settlementId);
      expect(scene?.statement.text).not.toContain('after Arrival Day');
      expect(scene?.statement.text).toMatch(/In the first season|By month/);
      expect(scene?.statement.text).toContain(community.settlementName);
      expect(scene?.statement.claims.population?.scopeEntityId).toBe(community.settlementId);
      expect(scene && historian.validateStatement(scene.statement, simulation.state)).toBe(true);
    }

    expect(scenes).toHaveLength(baseline.communities.length);
    expect(foundingContinuityProgress(historian, simulation.state).complete).toBe(true);
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))).toBeUndefined();
  });

  it('never turns first-year continuity into another same-month carousel', () => {
    const simulation = completedArrival('founding-continuity-month-spacing');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))?.id).toContain('founding-continuity:bridge');

    simulation.step(1);
    const first = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    expect(first?.id).toContain('founding-continuity:community');
    expect(first?.statement.month).toBe(1);

    // A second camera selection in the same authoritative month must fall through to ordinary history.
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))).toBeUndefined();

    simulation.step(1);
    const second = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    expect(second?.id).toContain('founding-continuity:community');
    expect(second?.statement.month).toBe(2);
    expect(second?.subjectId).not.toBe(first?.subjectId);
  });

  it('turns authoritative resource and construction changes into meaningful narration', () => {
    const simulation = completedArrival('founding-continuity-material-change');
    const historian = new Historian(simulation.config);
    const baseline = foundingChapterBaseline(simulation.state);
    const community = baseline?.communities[0];
    if (!baseline || !community) throw new Error('Expected founding community');
    completeOrientation(simulation, historian);
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))).toBeDefined();

    const settlement = simulation.state.settlements.find(candidate => candidate.id === community.settlementId);
    if (!settlement) throw new Error('Expected founding settlement');
    simulation.step(3);
    // A counter or reserved plot is not a standing permanent structure.
    const shelter = settlement.structurePlots?.find(p => p.development?.status === 'active');
    if (!shelter?.development) throw new Error('Expected a physically completed founding shelter');
    shelter.development.temporary = false;
    settlement.resources.food = community.supplies.food * 0.55;
    settlement.localMaterials['timber'] = community.supplies.timber * 2;

    const scene = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    expect(scene?.subjectId).toBe(community.settlementId);
    expect(scene?.statement.text).toContain('permanent structure');
    expect(scene?.statement.text).toMatch(/Food stores have fallen|Timber stores have risen/);
    expect(scene && historian.validateStatement(scene.statement, simulation.state)).toBe(true);
  });

  it('exposes a reusable current snapshot for the later Year-One payoff', () => {
    const simulation = completedArrival('founding-continuity-snapshot');
    const baseline = foundingChapterBaseline(simulation.state);
    const community = baseline?.communities[0];
    if (!baseline || !community) throw new Error('Expected founding community');
    simulation.step(4);

    const snapshot = foundingCommunitySnapshot(simulation.state, community, baseline);
    expect(snapshot).toBeDefined();
    expect(snapshot?.month).toBe(simulation.state.month);
    expect(snapshot?.settlementId).toBe(community.settlementId);
    expect(snapshot?.population).toBeGreaterThanOrEqual(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.knowledgeIds)).toBe(true);
  });

  it('can resume Year One without replaying the Month-Zero bridge', () => {
    const simulation = completedArrival('founding-continuity-resume');
    simulation.step(6);
    const historian = new Historian(simulation.config);

    const scene = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    const baseline = foundingChapterBaseline(simulation.state);
    expect(scene?.id).toContain('founding-continuity:community');
    expect(scene?.subjectId).toBe(baseline?.communities[0]?.settlementId);
    expect(foundingContinuityProgress(historian, simulation.state).bridgeShown).toBe(false);
  });

  it('does not start a fresh first-year chapter after the primary window has passed', () => {
    const simulation = completedArrival('founding-continuity-late-resume');
    simulation.step(FOUNDING_CONTINUITY_PRIMARY_END_MONTH + 1);
    const historian = new Historian(simulation.config);
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))).toBeUndefined();
  });

  it('expires the special continuity layer after its interruption grace window', () => {
    const simulation = completedArrival('founding-continuity-expiry');
    simulation.step(FOUNDING_CONTINUITY_GRACE_END_MONTH + 1);
    const historian = new Historian(simulation.config);
    expect(acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state))).toBeUndefined();
  });

  it('uses a deliberate first-year pace after the frozen opening hands off authority', () => {
    // Exercise the real production order: 1a belongs to FOUNDING_ORIENTATION, then 1b belongs to
    // live history. A fresh Historian must never manufacture the opening again after beginHistory().
    const simulation = new Simulation({
      seed: 'founding-continuity-pacing',
      startMode: 'arrival',
      world: { size: 64 },
    });
    simulation.advanceArrival(80);
    expect(simulation.foundingOrientationRunning).toBe(true);
    expect(simulation.historyRunning).toBe(false);

    const historian = new Historian(simulation.config);
    const originalAutoRun = simulation.config.autoRun;
    installFoundingChapterPacing();
    installFoundingContinuityPacing();
    const presentation = new PresentationDirector(simulation.config);

    const orientation = acquireProposal(historian, simulation.state, chooseFoundingChapterScene(historian, simulation.state));
    expect(orientation).toBeDefined();
    expect(simulation.config.autoRun).toBe(originalAutoRun);
    expect(simulation.state.month).toBe(0);
    expect(presentation.tickBudget(simulation.state)).toBeGreaterThan(0);
    expect(presentation.targetSpeed(simulation.state, {
      kind: orientation!.kind,
      interest: orientation!.interest,
      eventType: orientation!.event?.type,
      eventMonth: orientation!.event?.month,
    })).toBeCloseTo(0.08, 5);

    completeOrientation(simulation, historian);
    expect(simulation.beginHistory()).toBe(true);
    expect(simulation.historyRunning).toBe(true);

    const bridge = acquireProposal(historian, simulation.state, chooseFoundingContinuityScene(historian, simulation.state));
    expect(bridge).toBeDefined();
    expect(presentation.tickBudget(simulation.state)).toBeGreaterThan(0);
    const speed = presentation.targetSpeed(simulation.state, { kind: bridge!.kind, interest: bridge!.interest });
    expect(speed).toBe(FOUNDING_CONTINUITY_MONTHS_PER_SECOND);
    expect(speed).toBeLessThan(simulation.config.presentation.significantMonthsPerSecond);
  });
});
