import { describe, expect, it } from 'vitest';
import { deriveMemorialComposition } from '../src/render/settlement/MemorialArchaeology';
import { createMemorialSiteLandscape } from '../src/render/settlement/MemorialSitePresentation';
import { developmentContext, responseForNeed } from '../src/sim/development/SettlementDevelopmentSystem';
import type { DevelopmentResponse, StructureDevelopment } from '../src/sim/development/types';
import { rememberMortality } from '../src/sim/development/Remembrance';
import { emitEvent } from '../src/sim/History';
import type { StructurePlot } from '../src/sim/types';
import { societyFixture } from './fixtures/settlementDevelopment';

function install(
  plot: StructurePlot,
  response: DevelopmentResponse,
  month: number,
): StructureDevelopment {
  plot.foundedMonth = month;
  const development: StructureDevelopment = {
    ...response,
    status: 'active',
    origin: {
      month,
      action: 'founded',
      name: response.name,
      need: response.need,
      cultureId: response.cultureId,
      reasons: [...response.reasons],
      form: response.form,
      level: response.level,
      material: response.material,
    },
    history: [],
    transitionCount: 0,
    lastUsedMonth: month,
  };
  plot.development = development;
  plot.condition = 1;
  return development;
}

describe('memorial archaeology', () => {
  it('turns retained lives and events into deterministic bounded chronological strata', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    state.month = 2400;
    rememberMortality(state, town, 4096);
    const response = responseForNeed(developmentContext(state, town), 'memory')!;
    response.memorial!.people = [
      { id: 'person-a', name: 'A', month: 240, eventId: 'death-a' },
      { id: 'person-b', name: 'B', month: 900, eventId: 'death-b' },
      { id: 'person-c', name: 'C', month: 1560, eventId: 'death-c' },
    ];
    response.memorial!.events = [
      { id: 'battle-a', summary: 'A battle was remembered.', month: 360, type: 'battle', significance: 0.9 },
      { id: 'plague-a', summary: 'A pandemic was remembered.', month: 1200, type: 'pandemic', significance: 0.86 },
      { id: 'recovery-a', summary: 'Recovery followed.', month: 1800, type: 'recovery', significance: 0.78 },
    ];
    const plot = town.structurePlots![0]!;
    install(plot, response, 120);

    const first = deriveMemorialComposition(state, town, plot, plot.development!.memorial!);
    const second = deriveMemorialComposition(state, town, plot, plot.development!.memorial!);

    expect(first).toEqual(second);
    expect(first.strata.length).toBeGreaterThan(1);
    expect(first.strata.length).toBeLessThanOrEqual(4);
    expect(first.evidence.map(layer => layer.month)).toEqual([...first.evidence.map(layer => layer.month)].sort((a, b) => a - b));
    expect(first.rememberedEvents).toBe(3);
    expect(first.namedLives).toBe(3);
    expect(first.communalMarkers).toBe(12);
    expect(first.documentaryDepth).toBeGreaterThan(0.5);
    expect(first.fingerprint).toContain('battle');
    expect(first.fingerprint).toContain('pandemic');
  });

  it('keeps event type and significance after historian history is evicted', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    state.month = 48;
    emitEvent(state, {
      type: 'battle',
      locationId: town.id,
      location: { ...town.position },
      actors: [town.id],
      causes: ['war'],
      context: {},
      outcome: 'survived',
      affectedPopulation: 30,
      magnitude: 0.8,
      significance: 0.91,
      tags: ['war'],
      summary: 'The settlement survived a costly battle.',
    });

    const retained = structuredClone(town.remembrance![0]!.events[0]!);
    state.history = [];

    expect(retained.type).toBe('battle');
    expect(retained.significance).toBe(0.91);
    expect(town.remembrance![0]!.events[0]).toEqual(retained);
  });

  it('renders documentary strata, named fragments, and event-specific relics without mutating authority', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    state.month = 1800;
    rememberMortality(state, town, 128);
    const response = responseForNeed(developmentContext(state, town), 'memory')!;
    response.memorial!.form = 'stelae';
    response.memorial!.ageBand = 4;
    response.memorial!.people = [
      { id: 'person-a', name: 'Aster', month: 400, eventId: 'death-a' },
      { id: 'person-b', name: 'Beren', month: 900, eventId: 'death-b' },
    ];
    response.memorial!.events = [
      { id: 'battle-a', summary: 'Battle.', month: 500, type: 'battle', significance: 0.9 },
      { id: 'catastrophe-a', summary: 'Storm.', month: 1100, type: 'natural-catastrophe', significance: 0.82 },
      { id: 'recovery-a', summary: 'Recovery.', month: 1400, type: 'recovery', significance: 0.76 },
    ];
    const plot = town.structurePlots![0]!;
    install(plot, response, 120);
    const before = structuredClone({
      remembrance: town.remembrance,
      plots: town.structurePlots,
      history: state.history,
    });

    const landscape = createMemorialSiteLandscape(state, town, 0, () => 0);
    const precinct = landscape.getObjectByName(`memorial-precinct:${plot.id}`)!;
    const eventRelics = precinct.children.filter(child => child.name === 'memorial-archaeology-event-relic');

    expect(precinct.userData['memorialArchaeology']).toBe('v1');
    expect(Number(precinct.userData['memorialLayerCount'])).toBeGreaterThan(1);
    expect(precinct.getObjectByName('memorial-archaeology-stratum')).toBeDefined();
    expect(precinct.getObjectByName('memorial-name-fragment')).toBeDefined();
    expect(eventRelics).toHaveLength(3);
    expect(new Set(eventRelics.map(relic => relic.userData['eventType']))).toEqual(new Set(['battle', 'natural-catastrophe', 'recovery']));
    expect({
      remembrance: town.remembrance,
      plots: town.structurePlots,
      history: state.history,
    }).toEqual(before);
  });

  it('orders separate cultural cemeteries as successive archaeological layers', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    const firstCulture = state.cultures[0]!;
    const secondCulture = state.cultures[1]!;
    state.month = 120;
    town.cultureShares = { [firstCulture.id]: 1 };
    firstCulture.dimensions.religiousTendency = 0.9;
    rememberMortality(state, town, 40);
    const firstResponse = responseForNeed(developmentContext(state, town), 'memory')!;
    firstResponse.memorial!.form = 'ancestor-posts';
    firstResponse.memorial!.ageBand = 4;
    const firstPlot = town.structurePlots![0]!;
    install(firstPlot, firstResponse, 120);

    state.month = 1320;
    town.cultureShares = { [secondCulture.id]: 1 };
    secondCulture.dimensions.hierarchy = 0.9;
    rememberMortality(state, town, 25);
    const secondResponse = responseForNeed(developmentContext(state, town), 'memory')!;
    secondResponse.memorial!.form = 'stelae';
    secondResponse.memorial!.ageBand = 1;
    const secondPlot = town.structurePlots![1]!;
    install(secondPlot, secondResponse, 1320);

    const oldComposition = deriveMemorialComposition(state, town, firstPlot, firstPlot.development!.memorial!);
    const newComposition = deriveMemorialComposition(state, town, secondPlot, secondPlot.development!.memorial!);
    const landscape = createMemorialSiteLandscape(state, town, 0, () => 0);
    const oldPrecinct = landscape.getObjectByName(`memorial-precinct:${firstPlot.id}`)!;
    const newPrecinct = landscape.getObjectByName(`memorial-precinct:${secondPlot.id}`)!;

    expect(oldComposition.successionOrdinal).toBe(0);
    expect(newComposition.successionOrdinal).toBe(1);
    expect(oldComposition.successionCount).toBe(2);
    expect(oldComposition.legacyCulture).toBe(true);
    expect(newComposition.legacyCulture).toBe(false);
    expect(landscape.userData['memorialCulturalLayers']).toBe(2);
    expect(String(landscape.userData['memorialCulturalSequence'])).toContain('ancestor-posts');
    expect(String(landscape.userData['memorialCulturalSequence'])).toContain('stelae');
    expect(oldPrecinct.userData['memorialSuccessionOrdinal']).toBe(0);
    expect(newPrecinct.userData['memorialSuccessionOrdinal']).toBe(1);
  });
});
