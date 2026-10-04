import { describe, expect, it } from 'vitest';
import { advanceEnergy } from '../src/sim/energy/EnergySystem';
import { energyAt } from '../src/sim/energy/types';
import { environmentFactor, siteGenerationFactor } from '../src/sim/energy/Generation';
import { EnergyRenderer } from '../src/render/energy/EnergyRenderer';
import { architecturalPeriod } from '../src/render/architecture/ArchitecturalPeriod';
import { learn, residents, societyFixture, sponsor } from './fixtures/settlementDevelopment';

function fixture(water: boolean) {
  const { state, settlements } = societyFixture();
  const s = settlements[0]!;
  state.settlements = [s];
  const plot = s.structurePlots!.find(p => p.development?.status === 'active')!;
  s.structurePlots = [plot];
  plot.development!.need = 'energy';
  plot.development!.form = 'workshop';
  plot.accessRestricted = false;
  plot.condition = 1;
  learn(s, 'wheel-axle', 'precision-tools', 'rotary-machinery');
  sponsor(state, s, 'craft-circle');
  s.infrastructure.workshops = 0.7;
  s.industry.intensity = 0;
  s.localMaterials = { timber: 100, stone: 100, textile: 100 };
  Object.assign(state.world.cells[s.cellIndex]!, { river: water, flow: water ? 0.8 : 0, lake: false });
  Object.assign(state.weather.cells[s.cellIndex]!, { wind: 0, temperature: 0.6, snowpack: 0, runoff: 0 });
  const tick = () => { state.month++; advanceEnergy(state); };
  return { state, s, plot, tick };
}

describe('mill construction through production architecture', () => {
  it.each([true, false])('gradually pays for and builds a canonical mill (water=%s)', water => {
    const { state, s, tick } = fixture(water);
    tick();
    const plant = energyAt(s).plants[0]!;
    expect(plant.kind).toBe(water ? 'waterwheel' : 'windmill');
    expect(plant.progress).toBeGreaterThan(0);
    expect(plant.progress).toBeLessThanOrEqual(0.25);
    expect(plant.output).toBe(0);
    const material = water ? 'stone' : 'textile';
    const cost = water ? 2 : 1;
    expect(100 - s.localMaterials[material]!).toBeCloseTo(cost * plant.progress);
    for (let i = 0; i < 24 && plant.progress < 1; i++) tick();
    expect(plant.progress).toBe(1);
    expect(100 - s.localMaterials[material]!).toBeCloseTo(cost);
    expect(plant.output).toBe(water ? expect.any(Number) : 0);
    if (water) expect(plant.output).toBeGreaterThan(0);
    else {
      state.weather.cells[s.cellIndex]!.wind = 0.5;
      tick();
      expect(plant.output).toBeGreaterThan(0);
    }
    const renderer = new EnergyRenderer();
    renderer.update(state, 0, () => 0);
    const mill = renderer.group.getObjectByName(water ? 'Riverside watermill' : 'Windmill')!;
    expect(mill.userData['buildingSpec'].archetype).toBe(water ? 'mill' : 'windmill');
    const parts: import('three').Object3D[] = [];
    mill.traverse(o => { if (o.userData['millRotor']) parts.push(o); });
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every(o => o.userData['millRotor'].drive === (water ? 'water-wheel' : 'wind-sails'))).toBe(true);
    const rotor = parts.find(o => !o.userData['millRotor'].motion || o.userData['millRotor'].motion === 'rotate')!;
    const axis = rotor.userData['millRotor'].axis as 'x' | 'y' | 'z';
    renderer.update(state, 1, () => 0);
    expect(rotor.rotation[axis]).not.toBe(0);
    plant.status = 'idle'; plant.output = 0;
    const angle = rotor.rotation[axis];
    renderer.update(state, 2, () => 0);
    expect(rotor.rotation[axis]).toBe(angle);
    expect(renderer.group.getObjectByName('windmill rotor')).toBeUndefined();
    renderer.dispose();
  });

  it.each(['unknown', 'experimental', 'dormant', 'no-demand', 'no-materials', 'no-labour', 'inactive-site'] as const)('does not complete mills with %s', missing => {
    const { s, state, plot, tick } = fixture(false);
    if (missing === 'unknown') delete s.knowledge.records['rotary-machinery'];
    if (missing === 'experimental') Object.assign(s.knowledge.records['rotary-machinery']!, { source: 'discovery', adoptedMonth: undefined, practice: 0.3 });
    if (missing === 'dormant') s.knowledge.records['rotary-machinery']!.dormant = true;
    if (missing === 'no-demand') s.infrastructure.workshops = 0;
    if (missing === 'no-materials') s.localMaterials.textile = 0;
    if (missing === 'no-labour') residents(state, s).forEach(p => { p.ageMonths = 12; });
    if (missing === 'inactive-site') plot.development!.status = 'abandoned';
    for (let i = 0; i < 12; i++) tick();
    expect(energyAt(s).plants.every(p => p.progress === 0)).toBe(true);
  });

  it('pauses an existing build when its physical inputs run out', () => {
    const { s, tick } = fixture(false);
    s.localMaterials.textile = 0.25;
    tick();
    const plant = energyAt(s).plants[0]!;
    const progress = plant.progress;
    for (let i = 0; i < 8; i++) tick();
    expect(plant.progress).toBe(progress);
    s.localMaterials.textile = 0.75;
    for (let i = 0; i < 12; i++) tick();
    expect(plant.progress).toBe(1);
  });

  it('uses long-run wind for siting and current wind for dispatch', () => {
    const { state, s } = fixture(false);
    const expected = siteGenerationFactor(state, s, 'windmill');
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(0.5);
    expect(environmentFactor(state, s, 'windmill')).toBe(0);
    state.weather.cells[s.cellIndex]!.wind = 0.95;
    expect(siteGenerationFactor(state, s, 'windmill')).toBe(expected);
    expect(environmentFactor(state, s, 'windmill')).toBe(0);
    expect(siteGenerationFactor(state, s, 'waterwheel')).toBe(0);
  });

  it('keeps rotary knowledge preindustrial without changing simulation prerequisites', () => {
    expect(architecturalPeriod({ era: 'preIndustrial', developmentLevel: 1, capabilities: ['rotary-machinery'] })).toBe('medieval');
  });

  it('replays construction, consumption and dispatch deterministically', () => {
    const a = fixture(false), b = fixture(false);
    for (let i = 0; i < 18; i++) {
      a.state.weather.cells[a.s.cellIndex]!.wind = b.state.weather.cells[b.s.cellIndex]!.wind = i % 3 === 0 ? 0 : 0.4;
      a.tick(); b.tick();
      expect(energyAt(a.s)).toEqual(energyAt(b.s));
      expect(a.s.localMaterials).toEqual(b.s.localMaterials);
    }
  });
});
