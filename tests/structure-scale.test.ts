/**
 * Structures are drawn at the real size their architecture declares.
 *
 * The architecture system is authored in metres — `GRAMMAR_UNIT_METRES` for the shell and the mill
 * drafters, `HumanScale` for the people who walk past it — and these tests hold the renderer to
 * that. They exist because three separate faults had been quietly compounding: a composed extent
 * that doubled every ordinary building, a fit computed against a structure's whole site rather
 * than its building, and plots sized for cottages handed to industrial machinery. Together they
 * rendered a 27 m tower mill at 5.5 m, shorter than the house beside it.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { ARCHITECTURAL_FIT, GRAMMAR_UNIT_METRES, structureFit, WORLD_UNITS_PER_METRE } from '../src/render/assets/StructureFit';
import { CANONICAL_ADULT_HEIGHT } from '../src/render/people/HumanScale';
import { MILL_ARCHETYPES } from '../src/render/architecture/MillArchitecture';
import { METRE } from '../src/render/architecture/MillKit';
import { districtForResponse } from '../src/shared/SettlementLayoutPlan';
import { groundStructure, surveyFootprintGround } from '../src/shared/StructureGrounding';
import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse } from '../src/sim/development/types';
import type { BuildingArchetype } from '../src/render/architecture/BuildingArchetype';

const CULTURE: CultureStyle = {
  primary: '#7b6a52', secondary: '#39423d', accent: '#d2b77b',
  symbol: 'river-eye', pattern: 'wave', nameSyllables: ['ar', 'ven'],
};

const response = (over: Partial<DevelopmentResponse>): DevelopmentResponse => ({
  need: 'housing', form: 'dwelling', name: 'test', level: 3, material: 'masonry',
  cultureId: 'test', style: CULTURE, services: {}, ...over,
} as DevelopmentResponse);

/** World units a plot of the given district actually reserves, at the midpoint of its spread. */
const plotFor = (district: 'major' | 'residential' | 'craft'): { plotWidth: number; plotDepth: number } => {
  const width = 0.94 * (district === 'major' ? 1.55 * 2.6 : district === 'residential' ? 1.9 : 2.0);
  return { plotWidth: width, plotDepth: width * 0.82 };
};

const builder = new AssetBuilder();

interface Measured { massWidth: number; massDepth: number; siteWidth: number; siteDepth: number; height: number; bodyWidth: number }

function measure(seed: string, era: string, development: DevelopmentResponse, archetype?: BuildingArchetype): Measured {
  const asset = builder.getAsset('building', {
    seed, culture: CULTURE, era, variant: `${development.form === 'dwelling' ? 'house' : 'workshop'}#7`,
    development, archetype,
  } as never);
  const d = asset.mesh.userData;
  return {
    massWidth: Number(d['massWidth']), massDepth: Number(d['massDepth']),
    siteWidth: Number(d['footprintWidth']), siteDepth: Number(d['footprintDepth']),
    height: Number(d['buildingHeight']), bodyWidth: Number(d['bodyWidth'] ?? 0),
  };
}

const metres = (units: number, fit: number): number => units * fit / WORLD_UNITS_PER_METRE;

describe('the scale authority', () => {
  it('agrees with the mill kit on how long a metre is', () => {
    expect(METRE).toBeCloseTo(1 / GRAMMAR_UNIT_METRES, 10);
  });

  it('puts an adult at 1.75 m against the buildings they live in', () => {
    expect(CANONICAL_ADULT_HEIGHT / WORLD_UNITS_PER_METRE).toBeCloseTo(1.75, 6);
  });

  it('never draws a structure larger than its architecture declares', () => {
    const fit = structureFit({ plotWidth: 99, plotDepth: 99, massWidth: 1, massDepth: 1 });
    expect(fit).toBeCloseTo(ARCHITECTURAL_FIT, 10);
  });

  it('shrinks a structure only as far as its plot requires', () => {
    const fit = structureFit({ plotWidth: 1, plotDepth: 4, massWidth: 2, massDepth: 2 });
    expect(fit).toBeCloseTo(0.5, 10);
  });
});

describe('composed footprints', () => {
  it('reports a span, not a doubled half-reach', () => {
    // The body is a span already; reporting `max(span, reach) * 2` made every ordinary building
    // twice its true size, so it was fitted into half the plot it had been given.
    const m = measure('scale:house', 'preIndustrial', response({}));
    expect(m.siteWidth).toBeLessThan(m.bodyWidth * 1.9);
    expect(m.siteWidth).toBeGreaterThanOrEqual(m.bodyWidth);
  });

  it('separates a structure from the ground it lays around itself', () => {
    // A watermill's pond, race and cart yard are its site; the mill house is its mass.
    const m = measure('scale:watermill', 'preIndustrial', response({ need: 'energy', form: 'workshop' }), 'mill');
    expect(m.massDepth).toBeLessThan(m.siteDepth * 0.6);
  });

  it('never reports a mass larger than the site containing it', () => {
    for (const archetype of MILL_ARCHETYPES) {
      const m = measure(`scale:${archetype}`, 'preIndustrial', response({ need: 'energy', form: 'workshop' }), archetype);
      expect(m.massWidth, archetype).toBeLessThanOrEqual(m.siteWidth + 1e-9);
      expect(m.massDepth, archetype).toBeLessThanOrEqual(m.siteDepth + 1e-9);
    }
  });
});

describe('placed structures', () => {
  it('builds a house a person could stand up in, on the plot it is given', () => {
    const m = measure('scale:house', 'preIndustrial', response({}));
    const fit = structureFit({ ...plotFor('residential'), massWidth: m.massWidth, massDepth: m.massDepth, level: 3 });
    const height = metres(m.height, fit);
    expect(height).toBeGreaterThan(6);
    expect(height).toBeLessThan(16);
  });

  it('stands a tower mill well above the houses around it', () => {
    const mill = measure('scale:tower', 'preIndustrial', response({ need: 'energy', form: 'workshop' }), 'windmill');
    const house = measure('scale:house', 'preIndustrial', response({}));
    const millHeight = metres(mill.height, structureFit({
      ...plotFor('major'), massWidth: mill.massWidth, massDepth: mill.massDepth, level: 3,
    }));
    const houseHeight = metres(house.height, structureFit({
      ...plotFor('residential'), massWidth: house.massWidth, massDepth: house.massDepth, level: 3,
    }));
    expect(millHeight).toBeGreaterThan(18);
    expect(millHeight).toBeGreaterThan(houseHeight * 2);
  });

  it('gives power its own ground rather than a workshop plot', () => {
    // A mill is machinery the size of a building; the craft quarter reserves a cottage's worth.
    expect(districtForResponse({ need: 'energy', form: 'workshop' })).toBe('industrial');
  });
});

describe('grounding', () => {
  // A 12-degree slope rising along +X, in world units.
  const slope = (x: number): number => x * Math.tan(12 * Math.PI / 180);

  it('does not lift a structure onto ground outside its own footprint', () => {
    const plotWidth = 3.8, structureWidth = 1.6;
    const overPlot = groundStructure(surveyFootprintGround(slope, 0, 0, plotWidth, plotWidth, 0));
    const overStructure = groundStructure(surveyFootprintGround(slope, 0, 0, structureWidth, structureWidth, 0));
    // Both sit on the highest ground they survey, so the wider survey sits higher — and the
    // structure, which covers only its own footprint, would hover by the difference.
    expect(overPlot.baseY).toBeGreaterThan(overStructure.baseY);
    const hover = overPlot.baseY - overStructure.baseY;
    expect(hover / WORLD_UNITS_PER_METRE).toBeGreaterThan(1.3);
  });

  it('leaves a skirt able to reach the ground it has to close', () => {
    const structureWidth = 1.6;
    const grounding = groundStructure(surveyFootprintGround(slope, 0, 0, structureWidth, structureWidth, 0));
    expect(grounding.skirt).toBe(true);
    // The drop under the structure's own uphill edge is the whole gap the skirt must bridge.
    expect(grounding.baseY - grounding.skirtBottomY).toBeGreaterThan(slope(structureWidth / 2) - slope(-structureWidth / 2) - 0.01);
  });
});

describe('foundation skirts', () => {
  it('is no wider than the structure standing on it', () => {
    // Sized from the site extent, a mill's skirt was a bare pad several times its own building.
    const m = measure('scale:watermill', 'preIndustrial', response({ need: 'energy', form: 'workshop' }), 'mill');
    const fit = structureFit({ ...plotFor('major'), massWidth: m.massWidth, massDepth: m.massDepth, level: 3 });
    const skirt = new THREE.Vector2(m.massWidth * fit, m.massDepth * fit);
    expect(skirt.x).toBeLessThanOrEqual(m.siteWidth * fit + 1e-9);
    expect(skirt.y).toBeLessThanOrEqual(m.siteDepth * fit + 1e-9);
  });
});
