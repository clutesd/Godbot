import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Historian } from '../src/historian/Historian';
import { HISTORIAN_ARCHIVE_SCHEMA_VERSION, HistorianArchiveStore, RunRecordBuilder, computeCrossRunContext, createRunIdentity, experimentFingerprint, migrateArchiveRecord, seedForObservation } from '../src/historian/RunArchive';
import { Simulation } from '../src/sim/Simulation';

describe('Historian archive persistence', () => {
  it('round-trips a structured run through IndexedDB', async () => {
    const simulation = new Simulation({ seed: 'archived-world', startingPopulation: 180 });
    simulation.step(40 * 12);
    const historian = new Historian(simulation.config, { observationNumber: 1 });
    for (let index = 0; index < 8; index += 1) historian.chooseScene(simulation.state);

    const store = new HistorianArchiveStore(indexedDB);
    const observationNumber = await store.nextObservationNumber();
    const identity = createRunIdentity(simulation.config, simulation.state, observationNumber, '2026-01-01T00:00:00.000Z');
    const builder = new RunRecordBuilder(identity, simulation.config, simulation.state);
    const record = builder.update(simulation.state, historian.representativePersonIds, historian.statements, historian.predictions);
    await store.save(record);
    store.close();

    const reopened = new HistorianArchiveStore(indexedDB);
    const restored = await reopened.get(identity.runId);
    expect(restored?.schemaVersion).toBe(HISTORIAN_ARCHIVE_SCHEMA_VERSION);
    expect(restored?.identity).toEqual(identity);
    expect(restored?.events.length).toBeGreaterThan(0);
    expect(restored?.historianStatements.length).toBeGreaterThan(0);
    expect(restored?.outcome.population).toBe(simulation.population);
    expect((await reopened.list()).some((candidate) => candidate.identity.runId === identity.runId)).toBe(true);
    expect(reopened.persistent).toBe(true);
    reopened.close();
  });

  it('falls back to memory when browser persistence is absent', async () => {
    const simulation = new Simulation({ seed: 'memory-archive', startingPopulation: 120 });
    const store = new HistorianArchiveStore(undefined);
    const identity = createRunIdentity(simulation.config, simulation.state, await store.nextObservationNumber(), '2026-01-01T00:00:00.000Z');
    const record = new RunRecordBuilder(identity, simulation.config, simulation.state).update(simulation.state);
    await store.save(record);
    expect((await store.get(identity.runId))?.identity.seed).toBe('memory-archive');
  });

  it('migrates older records and refuses unknown future schemas', () => {
    const simulation = new Simulation({ seed: 'migration-archive', startingPopulation: 120 });
    const identity = createRunIdentity(simulation.config, simulation.state, 1, '2026-01-01T00:00:00.000Z');
    const migrated = migrateArchiveRecord({ schemaVersion: 0, identity, configuration: simulation.config });
    expect(migrated.schemaVersion).toBe(HISTORIAN_ARCHIVE_SCHEMA_VERSION);
    expect(migrated.events).toEqual([]);
    expect(() => migrateArchiveRecord({ schemaVersion: 999, identity })).toThrow(/newer GODBOX version/);
  });

  it('groups derived observation seeds into one resumable experiment family', () => {
    const first = new Simulation({ seed: seedForObservation('family-seed', 1) });
    const second = new Simulation({ seed: seedForObservation('family-seed', 2) });
    expect(first.config.seed).toBe('family-seed');
    expect(second.config.seed).toBe('family-seed:observation-0002');
    expect(experimentFingerprint(first.config)).toBe(experimentFingerprint(second.config));
    expect(createRunIdentity(second.config, second.state, 2, '2026-01-01T00:00:00.000Z', 'family-seed').baseSeed).toBe('family-seed');
  });

  it('restores prior archive material and completes a normal horizon', () => {
    const simulation = new Simulation({ seed: 'horizon-archive', startingPopulation: 120 });
    const identity = createRunIdentity(simulation.config, simulation.state, 1);
    const firstBuilder = new RunRecordBuilder(identity, simulation.config, simulation.state);
    simulation.step(12);
    const ongoing = firstBuilder.update(simulation.state);
    simulation.step(12);
    const resumedBuilder = new RunRecordBuilder(identity, simulation.config, simulation.state, ongoing);
    const completed = resumedBuilder.update(simulation.state, new Set(), [], [], { status: 'completed', classification: simulation.summary().outcomeClassification });
    expect(completed.status).toBe('completed');
    expect(completed.endedMonth).toBe(24);
    expect(completed.events.some((event) => ongoing.events.some((prior) => prior.id === event.id))).toBe(true);
  });

  it('replays an ongoing record to exactly the archived deterministic state', () => {
    const original = new Simulation({ seed: 'reload-replay', startingPopulation: 180 });
    original.step(35 * 12);
    const identity = createRunIdentity(original.config, original.state, 1);
    const ongoing = new RunRecordBuilder(identity, original.config, original.state).update(original.state);
    const replayed = new Simulation(ongoing.configuration);
    replayed.step(ongoing.lastRecordedMonth);
    expect(replayed.summary()).toEqual(original.summary());
    expect(replayed.state.history).toEqual(original.state.history);
  }, 15_000);

  it('suppresses unstable aggregate claims for small samples', () => {
    const simulation = new Simulation({ seed: 'aggregate-archive', startingPopulation: 120 });
    const identity = createRunIdentity(simulation.config, simulation.state, 1, '2026-01-01T00:00:00.000Z');
    const record = new RunRecordBuilder(identity, simulation.config, simulation.state).update(simulation.state);
    const completed = { ...record, status: 'completed' as const };
    const small = computeCrossRunContext([completed, { ...completed, identity: { ...completed.identity, runId: 'second', observationNumber: 2 } }]);
    expect(small.completedRuns).toBe(2);
    expect(small.tradeKnowledgeCorrelation).toBeNull();
    expect(small.industrializedFraction).toBe(0);
  });

  it('uses archived totals for non-causal trade and diffusion correlation', () => {
    const simulation = new Simulation({ seed: 'aggregate-correlation', startingPopulation: 120 });
    const base = new RunRecordBuilder(createRunIdentity(simulation.config, simulation.state, 1), simulation.config, simulation.state).update(simulation.state);
    const records = [1, 2, 3, 4].map((value) => ({
      ...base,
      status: 'completed' as const,
      identity: { ...base.identity, runId: `correlation-${value}`, observationNumber: value },
      outcome: { ...base.outcome, tradeRoutesEstablished: value, knowledgeExchanges: value * 3 },
    }));
    expect(computeCrossRunContext(records).tradeKnowledgeCorrelation).toBeCloseTo(1);
  });

  it('aggregates atomic, nuclear, survival, space, and advanced outcome statistics', () => {
    const simulation = new Simulation({ seed: 'fermi-archive', startingPopulation: 120 });
    const base = new RunRecordBuilder(createRunIdentity(simulation.config, simulation.state, 1), simulation.config, simulation.state).update(simulation.state);
    const records = [
      { classification: 'PLANETARY STABLE' as const, atomicThresholdMonth: 1200, nuclearWeapons: true, nuclearWar: false, survivalYearsAfterAtomic: 420, survivedThreeCenturiesAfterAtomic: true, interplanetary: false, postBiological: false, unknown: false },
      { classification: 'INTERPLANETARY' as const, atomicThresholdMonth: 1800, nuclearWeapons: false, nuclearWar: false, survivalYearsAfterAtomic: 350, survivedThreeCenturiesAfterAtomic: true, interplanetary: true, postBiological: false, unknown: false },
      { classification: 'COLLAPSED' as const, atomicThresholdMonth: 2400, nuclearWeapons: true, nuclearWar: true, survivalYearsAfterAtomic: 80, survivedThreeCenturiesAfterAtomic: false, interplanetary: false, postBiological: false, unknown: false },
      { classification: 'UNKNOWN' as const, nuclearWeapons: false, nuclearWar: false, survivalYearsAfterAtomic: null, survivedThreeCenturiesAfterAtomic: false, interplanetary: false, postBiological: false, unknown: true },
    ].map((outcome, index) => ({
      ...base,
      status: 'completed' as const,
      identity: { ...base.identity, runId: `fermi-${index}`, observationNumber: index + 1 },
      outcome: { ...base.outcome, ...outcome },
    }));

    const context = computeCrossRunContext(records);
    expect(context.totalRuns).toBe(4);
    expect(context.atomicThresholdRuns).toBe(3);
    expect(context.medianAtomicThresholdYear).toBe(150);
    expect(context.nuclearWeaponsRuns).toBe(2);
    expect(context.nuclearWarRuns).toBe(1);
    expect(context.medianSurvivalYearsAfterAtomic).toBe(350);
    expect(context.survivedThreeCenturiesAfterAtomic).toBe(2);
    expect(context.interplanetaryRuns).toBe(1);
    expect(context.extinctionOrCollapseRuns).toBe(1);
    expect(context.postBiologicalOrUnknownRuns).toBe(1);
    expect(context.outcomeCounts.UNKNOWN).toBe(1);
  });
});
