import { addMaterial } from '../src/sim/resources/Inventory';
import { describe, expect, it } from 'vitest';
import { societyFixture, residents, run } from './fixtures/settlementDevelopment';
import { killPeople } from '../src/sim/people/PersonLifecycle';
import { rememberMortality, pendingRemembrance, refreshMemorials } from '../src/sim/development/Remembrance';
import { developmentContext, responseForNeed } from '../src/sim/development/SettlementDevelopmentSystem';
import { emitEvent } from '../src/sim/History';
import { structureDestination } from '../src/shared/StructureDestinations';
import { reserveStructurePlot } from '../src/shared/StructurePlots';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { deriveStructureHeritage } from '../src/render/assets/StructureHeritage';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';

describe('persistent cultural remembrance', () => {
  it('replays construction and costs exactly and leaves evidence pending when terrain cannot accept a site', () => {
    const { state, settlements: [s] } = societyFixture();
    rememberMortality(state, s!, 12);
    const replay = structuredClone(state);
    const before = structuredClone(s!.resources);
    run(state, 24, 0.5);
    run(replay, 24, 0.5);
    expect(state.settlements).toEqual(replay.settlements);
    expect(s!.resources.food).toBeLessThan(before.food);
    const blocked = societyFixture();
    const town = blocked.settlements[0]!;
    rememberMortality(blocked.state, town, 8);
    blocked.state.world.terrain.waterLevel.fill(10);
    const plots = town.structurePlots!.length;
    advanceSettlementDevelopment(blocked.state, town, residents(blocked.state, town), 0.5);
    expect(town.structurePlots).toHaveLength(plots);
    expect(town.development!.project).toBeUndefined();
    expect(pendingRemembrance(town)!.deaths).toBe(8);
  });

  it('records deaths once and retains names and event evidence after history eviction', () => {
    const { state, settlements: [s] } = societyFixture();
    const person = residents(state, s!)[24]!;
    person.cultureId = state.cultures[0]!.id;
    person.children = ['remembering-child'];
    expect(killPeople(state, [person], 'old-age')).toBe(1);
    expect(killPeople(state, [person], 'old-age')).toBe(0);
    state.history = [];
    expect(s!.remembrance![0]!.deaths).toBe(1);
    expect(s!.remembrance![0]!.people[0]).toMatchObject({ id: person.id, name: person.name });
    expect(responseForNeed(developmentContext(state, s!), 'memory')!.reasons).toContain(s!.remembrance![0]!.people[0]!.eventId);
  });

  it('builds paid sacred ground, grows in place, survives cultural succession and becomes heritage', () => {
    const { state, settlements: [s] } = societyFixture();
    state.cultures[0]!.dimensions.religiousTendency = 0.8;
    rememberMortality(state, s!, 30);
    run(state, 180, 0.5);
    const plot = s!.structurePlots!.find(p => p.development?.memorial)!;
    expect(plot).toBeDefined();
    expect(plot.development!.origin.reasons).toContain('collective-remembrance');
    expect(plot.development!.memorial!.form).toBe('ancestor-posts');
    expect(structureDestination(s!, 'shrine')).toBe(plot);
    const location = [plot.worldX, plot.worldZ];
    const origin = structuredClone(plot.development!.origin);
    rememberMortality(state, s!, 10000);
    state.month += 600;
    refreshMemorials(state, s!);
    expect(plot.development!.memorial!.deaths).toBe(10030);
    expect(deriveStructureHeritage(plot.development!)?.ceremonialMemory).toBe(true);
    s!.cultureShares = { [state.cultures[1]!.id]: 1 };
    rememberMortality(state, s!, 10);
    // Keep this fixture at hand-built capability; saw-lumber has a separate baseline conservation failure.
    s!.knowledge.records = {};
    addMaterial(s!, 'timber', 60);
    addMaterial(s!, 'stone', 30);
    run(state, 180, 0.5);
    expect(s!.structurePlots!.filter(p => p.development?.memorial)).toHaveLength(2);
    expect(plot.development!.origin).toEqual(origin);
    expect([plot.worldX, plot.worldZ]).toEqual(location);
    expect(plot.development!.status).toBe('active');
    const added = reserveStructurePlot(state, s!, 'residential');
    if (added) expect(Math.hypot(added.worldX - plot.worldX, added.worldZ - plot.worldZ)).toBeGreaterThan(plot.radius + added.radius);
    const restored = structuredClone(state);
    expect(restored.settlements[0]!.remembrance).toEqual(s!.remembrance);
  });

  it('aggregates statistical losses without counting documentary deaths twice or allocating grave plots', () => {
    const { state, settlements: [s] } = societyFixture();
    state.advanced.scale = 'modern-statistical';
    rememberMortality(state, s!, 100000.5);
    const people = residents(state, s!).slice(24, 44);
    for (const p of people) { p.cultureId = state.cultures[0]!.id; p.historical = undefined; }
    const plots = s!.structurePlots!.length;
    killPeople(state, people, 'pandemic');
    expect(s!.remembrance![0]!.deaths).toBe(100000.5);
    expect(s!.remembrance![0]!.people).toHaveLength(0);
    expect(s!.structurePlots).toHaveLength(plots);
    const notable = residents(state, s!)[0]!;
    notable.cultureId = state.cultures[0]!.id;
    notable.historical = { status: 'notable', score: 0.8, reasons: ['founder'], eventIds: [] };
    killPeople(state, [notable], 'old-age');
    expect(s!.remembrance![0]!.deaths).toBe(100000.5);
    expect(s!.remembrance![0]!.people[0]!.id).toBe(notable.id);
  });

  it('captures significant local events without needing surviving historian records', () => {
    const { state, settlements: [s] } = societyFixture();
    emitEvent(state, { type: 'battle', locationId: s!.id, actors: [], causes: [], context: {}, outcome: 'defended',
      affectedPopulation: 40, magnitude: 0.8, significance: 0.8, tags: ['war'], summary: 'The settlement survived a siege.' });
    state.history = [];
    expect(pendingRemembrance(s!)!.events[0]!.summary).toContain('siege');
    expect(responseForNeed(developmentContext(state, s!), 'memory')!.memorial!.deaths).toBe(0);
  });

  it('renders distinct, bounded cultural geometry and separates growth and age cache entries', () => {
    const { state, settlements: [s] } = societyFixture();
    rememberMortality(state, s!, 1000000);
    const response = responseForNeed(developmentContext(state, s!), 'memory')!;
    const builder = new AssetBuilder('memorial-test');
    const config = { seed: 'same', culture: response.style, era: 'primitive' as const, variant: 'ritual-marker' };
    const assets = ['earth-mounds', 'ancestor-posts', 'stone-cairns', 'stelae'].map(form => builder.getAsset('building', {
      ...config, development: { ...response, memorial: { ...response.memorial!, form: form as NonNullable<typeof response.memorial>['form'] } },
    }));
    expect(new Set(assets.map(a => a.mesh)).size).toBe(4);
    for (const a of assets) {
      expect(a.mesh.userData['communalMarkers']).toBe(12);
      expect(a.lods).toHaveLength(0);
    }
    const older = builder.getAsset('building', { ...config, development: { ...response, memorial: { ...response.memorial!, ageBand: 2 } } });
    expect(older.mesh).not.toBe(assets[0]!.mesh);
    builder.dispose();
  });
});
