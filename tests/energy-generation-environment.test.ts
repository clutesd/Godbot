import { describe, expect, it } from 'vitest';
import { environmentFactor, generatorDefinition } from '../src/sim/energy/Generation';
import { societyFixture } from './fixtures/settlementDevelopment';

function environmentFixture() {
  const { state, settlements } = societyFixture();
  const settlement = settlements[0]!;
  const cell = state.world.cells[settlement.cellIndex]!;
  const weather = state.weather.cells[settlement.cellIndex]!;
  Object.assign(cell, { river: true, lake: false, flow: 0.22, moisture: 0.55 });
  Object.assign(weather, {
    kind: 'clear',
    intensity: 0.05,
    wind: 0.4,
    runoff: 0,
    snowpack: 0,
    temperature: 0.62,
  });
  return { state, settlement, cell, weather };
}

describe('environmental energy generation', () => {
  it('makes river generation respond to runoff and distinguishes exposed waterwheels from managed hydro', () => {
    const { state, settlement, cell, weather } = environmentFixture();

    const dryHydro = environmentFactor(state, settlement, 'hydro');
    const dryWheel = environmentFactor(state, settlement, 'waterwheel');

    weather.runoff = 0.18;
    const wetHydro = environmentFactor(state, settlement, 'hydro');
    const wetWheel = environmentFactor(state, settlement, 'waterwheel');
    expect(wetHydro).toBeGreaterThan(dryHydro);
    expect(wetWheel).toBeGreaterThan(dryWheel);

    weather.temperature = 0.2;
    weather.snowpack = 1;
    const frozenHydro = environmentFactor(state, settlement, 'hydro');
    const frozenWheel = environmentFactor(state, settlement, 'waterwheel');
    expect(frozenHydro).toBeLessThan(wetHydro);
    expect(frozenWheel).toBeLessThan(wetWheel);
    expect(frozenWheel / wetWheel).toBeLessThan(frozenHydro / wetHydro);

    cell.river = false;
    expect(environmentFactor(state, settlement, 'hydro')).toBe(0);
    expect(environmentFactor(state, settlement, 'waterwheel')).toBe(0);
  });

  it('uses separate wind curves for primitive mills and engineered turbines', () => {
    const { state, settlement, weather } = environmentFixture();

    weather.wind = 0.04;
    expect(environmentFactor(state, settlement, 'windmill')).toBe(0);
    expect(environmentFactor(state, settlement, 'wind')).toBe(0);

    weather.wind = 0.58;
    expect(environmentFactor(state, settlement, 'windmill')).toBeCloseTo(1, 6);
    expect(environmentFactor(state, settlement, 'wind')).toBeCloseTo(1, 6);

    weather.wind = 0.82;
    const stormMill = environmentFactor(state, settlement, 'windmill');
    const stormTurbine = environmentFactor(state, settlement, 'wind');
    expect(stormMill).toBeGreaterThan(0);
    expect(stormMill).toBeLessThan(1);
    expect(stormTurbine).toBeCloseTo(1, 6);

    weather.wind = 0.95;
    expect(environmentFactor(state, settlement, 'windmill')).toBe(0);
    expect(environmentFactor(state, settlement, 'wind')).toBeGreaterThan(0);

    weather.wind = 1;
    expect(environmentFactor(state, settlement, 'wind')).toBe(0);
  });

  it('makes solar respond continuously to season, clouds, storms, snow and explicit daylight', () => {
    const { state, settlement, weather } = environmentFixture();

    state.month = 5;
    const summerClear = environmentFactor(state, settlement, 'solar');

    state.month = 11;
    const winterClear = environmentFactor(state, settlement, 'solar');
    expect(summerClear).toBeGreaterThan(winterClear);

    state.month = 5;
    weather.kind = 'heavy-rain';
    weather.intensity = 0.9;
    const storm = environmentFactor(state, settlement, 'solar');
    expect(storm).toBeLessThan(summerClear);

    weather.kind = 'clear';
    weather.intensity = 0.05;
    weather.snowpack = 0.8;
    const snowCovered = environmentFactor(state, settlement, 'solar');
    expect(snowCovered).toBeGreaterThan(0);
    expect(snowCovered).toBeLessThan(summerClear);

    expect(environmentFactor(state, settlement, 'solar', 0)).toBe(0);
    expect(environmentFactor(state, settlement, 'solar', 1)).toBeGreaterThan(snowCovered);
  });

  it('does not double-apply water availability as a cooling requirement to hydro technologies', () => {
    expect(generatorDefinition('waterwheel').cooling).not.toBe(true);
    expect(generatorDefinition('hydro').cooling).not.toBe(true);
    expect(generatorDefinition('steam').cooling).toBe(true);
    expect(generatorDefinition('nuclear').cooling).toBe(true);
  });
});
