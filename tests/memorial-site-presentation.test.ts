import { describe, expect, it } from 'vitest';
import type { MemorialSite, StructureDevelopment } from '../src/sim/development/types';
import {
  createMemorialSiteLandscape,
  memorialLandscapeProfile,
} from '../src/render/settlement/MemorialSitePresentation';
import { developmentContext, responseForNeed } from '../src/sim/development/SettlementDevelopmentSystem';
import { rememberMortality } from '../src/sim/development/Remembrance';
import { societyFixture } from './fixtures/settlementDevelopment';

function memorial(form: MemorialSite['form'], ageBand: number): MemorialSite {
  return {
    cultureId: 'culture',
    firstMonth: 0,
    deaths: 120,
    people: [],
    events: [],
    form,
    sacred: form === 'ancestor-posts',
    ageBand,
  };
}

describe('memorial landscape presentation', () => {
  it('makes old remembrance sites visibly accumulate landscape history', () => {
    const young = memorialLandscapeProfile(memorial('earth-mounds', 0));
    const ancient = memorialLandscapeProfile(memorial('earth-mounds', 4));
    expect(ancient.treeCount).toBeGreaterThan(young.treeCount);
    expect(ancient.shrubCount).toBeGreaterThan(young.shrubCount);
    expect(ancient.boundaryElements).toBeGreaterThan(young.boundaryElements);
  });

  it('keeps distinct cultural landscape languages rather than reskinning one cemetery', () => {
    const profiles = (['earth-mounds', 'ancestor-posts', 'stone-cairns', 'stelae'] as const)
      .map(form => memorialLandscapeProfile(memorial(form, 2)));
    expect(new Set(profiles.map(profile => profile.language)).size).toBe(4);
    expect(profiles[3]!.boundaryElements).toBeGreaterThan(profiles[0]!.boundaryElements);
    expect(profiles[1]!.treeCount).toBeGreaterThan(profiles[2]!.treeCount);
  });

  it('builds a terrain-integrated precinct without mutating simulation authority', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    rememberMortality(state, town, 36);
    const response = responseForNeed(developmentContext(state, town), 'memory')!;
    const plot = town.structurePlots![0]!;
    plot.development = {
      ...response,
      status: 'active',
      origin: {
        month: state.month,
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
      lastUsedMonth: state.month,
    } satisfies StructureDevelopment;
    plot.development.memorial!.ageBand = 3;

    const before = structuredClone({
      remembrance: town.remembrance,
      plots: town.structurePlots,
      development: town.development,
    });
    const landscape = createMemorialSiteLandscape(state, town, 0, () => 0);

    expect(landscape.userData['memorialPrecinctCount']).toBe(1);
    expect(landscape.getObjectByName('memorial-ground')).toBeDefined();
    expect(landscape.getObjectByName('memorial-boundary')).toBeDefined();
    expect(landscape.getObjectByName('memorial-entrance')).toBeDefined();
    expect(landscape.getObjectByName('memorial-tree')).toBeDefined();
    expect({
      remembrance: town.remembrance,
      plots: town.structurePlots,
      development: town.development,
    }).toEqual(before);
  });
});
