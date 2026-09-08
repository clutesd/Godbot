import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { DynamicHydrology } from '../src/sim/terrain/Hydrology';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';
import { PeopleSystem } from '../src/sim/people/PeopleSystem';
import { Simulation } from '../src/sim/Simulation';

describe('Weather simulation', () => {
  it('records a measured disruptive blizzard once, suppresses routine snow, and reduces exposed production', () => {
    const setup = (wind: number) => {
      const simulation = new Simulation({ seed: 'winter-history', startingPopulation: 60, world: { size: 20 }, settlementCount: [2, 2] });
      for (const cell of simulation.state.world.cells) cell.temperature = 0.2;
      simulation.state.weather.fronts = Array.from({ length: 4 }, (_, index) => ({
        id: `winter-${index}`, kind: 'heavy-rain' as const, x: 0, z: 0, radius: 1000,
        directionX: 1, directionZ: 0, velocity: 0, intensity: 1, wind,
        lifespan: 3, ageMonths: 0, precipitation: 'rain' as const, severity: 1,
      }));
      return simulation;
    };
    const severe = setup(0.95);
    const ordinary = setup(0.3);
    severe.step();
    ordinary.step();
    expect(severe.state.settlements.length).toBeGreaterThan(0);
    const settlement = severe.state.settlements[0]!;
    const events = severe.state.history.filter((event) => event.tags.includes('blizzard') && event.locationId === settlement.id);
    expect(events).toHaveLength(1);
    const weather = severe.state.weather.cells[settlement.cellIndex]!;
    expect(events[0]!.context['blizzard']).toBe(weather.blizzard);
    expect(events[0]!.context['snowpack']).toBe(weather.snowpack);
    expect(events[0]!.context['travelPenalty']).toBe(weather.travelPenalty);
    expect(settlement.monthlyBalance.food).toBeLessThan(ordinary.state.settlements[0]!.monthlyBalance.food);
    expect(settlement.monthlyBalance.wood).toBeLessThan(ordinary.state.settlements[0]!.monthlyBalance.wood);
    expect(ordinary.state.history.some((event) => event.tags.includes('snow'))).toBe(false);
    severe.step(2);
    expect(severe.state.history.filter((event) => event.tags.includes('snow') && event.locationId === settlement.id)).toHaveLength(1);
  });

  it('requires intense snowfall, strong wind and sustained freezing temperatures for blizzards', () => {
    const config = configWith({ seed: 'blizzard-gates', world: { size: 12 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water)!;
    const conditions = system.state.cells[cell.z * world.size + cell.x]!;
    cell.temperature = 0.2;
    for (const descriptor of [
      { kind: 'snow' as const, intensity: 1, wind: 1 },
      { kind: 'heavy-snow' as const, intensity: 0.5, wind: 1 },
      { kind: 'heavy-snow' as const, intensity: 1, wind: 0.5 },
      { kind: 'clear' as const, intensity: 1, wind: 1 },
    ]) {
      system.applyWeatherToCell(cell, descriptor);
      expect(conditions.blizzard).toBe(0);
    }
    cell.temperature = 0.52;
    system.applyWeatherToCell(cell, { kind: 'heavy-snow', intensity: 1, wind: 1 });
    expect(conditions.precipitation).toBe('snow');
    expect(conditions.blizzard).toBe(0);
    cell.temperature = 0.9;
    system.applyWeatherToCell(cell, { kind: 'heavy-snow', intensity: 1, wind: 1 });
    expect(conditions.precipitation).toBe('rain');
    expect(conditions.blizzard).toBe(0);
  });

  it('accumulates gradually with intensity and duration, with stronger blizzard disruption', () => {
    const measure = (kind: 'snow' | 'heavy-snow', intensity: number, wind: number, months: number) => {
      const config = configWith({ seed: 'snow-depth', world: { size: 12 } });
      const world = generateWorld(config);
      const system = new WeatherSystem(world, config);
      const cell = world.cells.find((entry) => !entry.water)!;
      cell.temperature = 0.2;
      system.applyWeatherToCell(cell, { kind, intensity, wind }, months);
      return system.state.cells[cell.z * world.size + cell.x]!;
    };
    const dusting = measure('snow', 0.3, 0.2, 1);
    const repeated = measure('snow', 0.3, 0.2, 3);
    const heavy = measure('heavy-snow', 1, 0.2, 1);
    const blizzard = measure('heavy-snow', 1, 0.9, 1);
    expect(dusting.snowpack).toBeGreaterThan(0);
    expect(dusting.snowpack).toBeLessThan(0.05);
    expect(repeated.snowpack).toBeGreaterThan(dusting.snowpack);
    expect(heavy.snowpack).toBeGreaterThan(repeated.snowpack);
    expect(blizzard.blizzard).toBeCloseTo(1);
    expect(blizzard.snowpack).toBeGreaterThan(heavy.snowpack);
    expect(blizzard.travelPenalty).toBeGreaterThan(heavy.travelPenalty);
  });

  it('turns a severe precipitation front into a regional blizzard on the weather tick', () => {
    const config = configWith({ seed: 'winter-front', world: { size: 12 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water)!;
    cell.temperature = 0.2;
    system.createFront({ x: cell.worldX, z: cell.worldZ }, 'heavy-rain', 1, world.cellSize * 2, 0, 3);
    system.advanceMonth();
    const conditions = system.state.cells[cell.z * world.size + cell.x]!;
    expect(conditions.precipitation).toBe('snow');
    expect(conditions.blizzard).toBeGreaterThan(0.5);
    expect(conditions.snowpack).toBeGreaterThan(0);
    expect(system.state.cells.some((entry) => entry.blizzard === 0)).toBe(true);
  });

  it('preserves cold snow after precipitation and thaws lowlands before colder high ground', () => {
    const config = configWith({ seed: 'snow-retention', world: { size: 20 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const [low, high] = world.cells.filter((cell) => !cell.water).slice(0, 2);
    low!.temperature = 0.2;
    high!.temperature = 0.05;
    for (const cell of [low!, high!]) {
      system.applyWeatherToCell(cell, { kind: 'heavy-snow', intensity: 1 }, 2);
      const conditions = system.state.cells[cell.z * world.size + cell.x]!;
      const depth = conditions.snowpack;
      system.applyWeatherToCell(cell, { kind: 'clear', intensity: 0 }, 2);
      expect(conditions.snowpack).toBe(depth);
    }
    low!.temperature = 0.8;
    high!.temperature = 0.5;
    for (const cell of [low!, high!]) system.applyWeatherToCell(cell, { kind: 'clear' });
    const lowSnow = system.state.cells[low!.z * world.size + low!.x]!.snowpack;
    const highSnow = system.state.cells[high!.z * world.size + high!.x]!.snowpack;
    expect(lowSnow).toBeGreaterThan(0);
    expect(highSnow).toBeGreaterThan(lowSnow);
  });

  it('routes prolonged runoff into canonical water levels, floods connected low ground, and recedes', () => {
    const config = configWith({ seed: 'weather-flood', world: { size: 20 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water && entry.slope < 0.3)!;
    const sample = nearestIndex(world.terrain, cell.worldX, cell.worldZ);
    const ground = world.terrain.height[sample]!;
    world.terrain.waterLevel[sample - 1] = ground - 0.003;
    world.terrain.height[sample - 1] = ground - 0.004;
    const hydrology = new DynamicHydrology(world);
    const conditions = system.state.cells[cell.z * world.size + cell.x]!;
    for (const weather of system.state.cells) weather.runoff = 0.22;
    for (let month = 0; month < 5; month += 1) hydrology.advance(system.state.cells);
    expect(conditions.floodRisk).toBeGreaterThan(0.3);
    expect(world.terrain.waterLevel[sample]).toBeGreaterThan(ground);
    expect(cell.water).toBe(true);
    expect(new WalkabilityLayer(world).isWalkable({ x: cell.worldX, z: cell.worldZ })).toBe(false);
    for (const weather of system.state.cells) weather.runoff = 0;
    for (let month = 0; month < 24; month += 1) hydrology.advance(system.state.cells);
    expect(cell.water).toBe(false);
    expect(conditions.floodDepth).toBe(0);
  });

  it('rejects warm snow and lets deep snow block a minor route until thaw', () => {
    const config = configWith({ seed: 'weather-route', world: { size: 20 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const walking = new WalkabilityLayer(world);
    const cell = world.cells.find((entry) => walking.isWalkable({ x: entry.worldX, z: entry.worldZ }))!;
    const point = { x: cell.worldX, z: cell.worldZ };
    const conditions = system.state.cells[cell.z * world.size + cell.x]!;
    cell.temperature = 0.9;
    system.applyWeatherToCell(cell, { kind: 'snow', intensity: 0.5 });
    expect(conditions.snowpack).toBe(0);
    expect(conditions.precipitation).toBe('rain');
    cell.temperature = 0;
    system.applyWeatherToCell(cell, { kind: 'heavy-snow', intensity: 1 }, 8);
    expect(walking.travelMultiplier(point)).toBeGreaterThan(3);
    expect(walking.isWalkable(point)).toBe(false);
    cell.temperature = 1;
    system.applyWeatherToCell(cell, { kind: 'clear' }, 12);
    expect(conditions.snowpack).toBe(0);
    expect(walking.isWalkable(point)).toBe(true);
  });

  it('damages a seeded subset of vulnerable woodland in severe wind, but none in ordinary rain', () => {
    const config = configWith({ seed: 'weather-wind', world: { size: 20 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const land = world.cells.filter((cell) => !cell.water);
    const original = land.map((cell) => cell.wood);
    for (const cell of land) system.applyWeatherToCell(cell, { kind: 'rain', intensity: 0.5, wind: 0.3 });
    expect(land.map((cell) => cell.wood)).toEqual(original);
    for (const cell of land) system.applyWeatherToCell(cell, { kind: 'windstorm', intensity: 1, wind: 1 });
    const damaged = land.filter((cell, index) => cell.wood < original[index]!);
    expect(damaged.length).toBeGreaterThan(0);
    expect(damaged.length).toBeLessThan(land.length / 2);
  });

  it('interrupts a commute to shelter during dangerous local weather', () => {
    const simulation = new Simulation({ seed: 'weather-shelter', startingPopulation: 60, world: { size: 24 }, settlementCount: [2, 2] });
    const person = simulation.state.people[0]!;
    const settlement = simulation.state.settlements.find((entry) => entry.id === person.homeId)!;
    const system = new PeopleSystem(simulation.state.world, simulation.state.seed);
    const cellX = Math.round(person.position.x / simulation.state.world.cellSize + simulation.state.world.size / 2);
    const cellZ = Math.round(person.position.z / simulation.state.world.cellSize + simulation.state.world.size / 2);
    simulation.state.weather.cells[cellZ * simulation.state.world.size + cellX]!.wind = 0.95;
    person.navigation!.traveling = true;
    system.advancePerson(person, settlement, simulation.state);
    expect(person.activity).toBe('shelter');
    expect(person.navigation!.schedulePhase).toBe('emergency');
    expect(system.isPersonPositionValid(person)).toBe(true);
  });

  it('replays weather, water, woodland and soil exactly with the same seed', () => {
    const config = configWith({ seed: 'weather-replay', world: { size: 20 } });
    const firstWorld = generateWorld(config);
    const secondWorld = generateWorld(config);
    const first = new WeatherSystem(firstWorld, config);
    const second = new WeatherSystem(secondWorld, config);
    for (let month = 0; month < 36; month += 1) { first.advanceMonth(); second.advanceMonth(); }
    expect(first.state).toEqual(second.state);
    expect(firstWorld.cells).toEqual(secondWorld.cells);
    expect(firstWorld.terrain.waterLevel).toEqual(secondWorld.terrain.waterLevel);
  });

  it('ordinary rainfall leaves settlements intact without generating disaster history', () => {
    const simulation = new Simulation({ seed: 'ordinary-weather', startingPopulation: 120, world: { size: 24 }, settlementCount: [2, 2] });
    const initialBuildings = simulation.state.settlements.map((settlement) => settlement.buildings);
    for (const cell of simulation.state.world.cells) cell.temperature = 0.8;
    for (let month = 0; month < 24; month += 1) {
      simulation.state.weather.fronts = Array.from({ length: 4 }, (_, index) => ({
        id: `ordinary-rain-${index}`, kind: 'rain', x: 0, z: 0, radius: 1000,
        directionX: 1, directionZ: 0, velocity: 0, intensity: 0.5, wind: 0.2,
        lifespan: 2, ageMonths: 0, precipitation: 'rain', severity: 0,
      }));
      simulation.step();
    }
    simulation.state.settlements.forEach((settlement, index) => {
      expect(settlement.alive).toBe(true);
      expect(settlement.buildings).toBeGreaterThanOrEqual(initialBuildings[index]!);
    });
    expect(simulation.state.weather.cells.every((cell) => cell.treeDamage === 0 && cell.floodDepth === 0)).toBe(true);
    expect(simulation.state.history.some((event) => event.type === 'natural-catastrophe')).toBe(false);
  });

  it('applies a local rain front to soil and runoff on the actual weather tick', () => {
    const config = configWith({ seed: 'weather-consequences', world: { size: 20 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water)!;
    cell.temperature = 0.8;
    cell.moisture = 0.6;
    system.createFront({ x: cell.worldX, z: cell.worldZ }, 'heavy-rain', 1, 6, 0, 12);
    system.advanceMonth();
    expect(cell.moisture).toBeGreaterThan(0.6);
    expect(system.state.cells[cell.z * world.size + cell.x]!.runoff).toBeGreaterThan(0);
  });

  it('stores cold snowfall, then releases meltwater and restores travel costs', () => {
    const config = configWith({ seed: 'weather-snow-cycle', world: { size: 20 } });
    const world = generateWorld(config);
    const system = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water)!;
    const cost = cell.movementCost;
    cell.temperature = 0.05;
    system.applyWeatherToCell(cell, { kind: 'heavy-snow', intensity: 1 }, 3);
    const conditions = system.state.cells[cell.z * world.size + cell.x]!;
    expect(conditions.snowpack).toBeGreaterThan(0);
    expect(cell.movementCost).toBeGreaterThan(cost);
    const snow = conditions.snowpack;
    const moisture = cell.moisture;
    cell.temperature = 0.9;
    system.applyWeatherToCell(cell, { kind: 'clear' }, 1);
    expect(conditions.snowpack).toBeLessThan(snow);
    expect(conditions.runoff).toBeGreaterThan(0);
    expect(cell.moisture).toBeGreaterThan(moisture);
  });

  it('rain occurs only under suitable weather and moisture conditions', () => {
    const world = generateWorld(configWith({ seed: 'weather-rain-valid' }));
    const system = new WeatherSystem(world, configWith({ seed: 'weather-rain-valid' }));
    const wetCell = world.cells.find((cell) => cell.moisture > 0.58 && !cell.water)!;
    const dryCell = world.cells.find((cell) => cell.moisture < 0.18 && !cell.water)!;
    wetCell.temperature = 0.8;

    const wet = system.resolveWeatherAt(wetCell.worldX, wetCell.worldZ, { kind: 'rain', intensity: 0.72, wind: 0.18, precipitation: 'rain' });
    const dry = system.resolveWeatherAt(dryCell.worldX, dryCell.worldZ, { kind: 'clear', intensity: 0.1, wind: 0.08, precipitation: 'none' });

    expect(wet.kind).toBe('rain');
    expect(dry.kind).toBe('clear');
  });

  it('snow requires cold enough conditions', () => {
    const world = generateWorld(configWith({ seed: 'weather-snow-valid' }));
    const system = new WeatherSystem(world, configWith({ seed: 'weather-snow-valid' }));
    const coldCell = world.cells.filter((cell) => !cell.water).sort((a, b) => a.temperature - b.temperature)[0]!;
    const warmCell = world.cells.filter((cell) => !cell.water).sort((a, b) => b.temperature - a.temperature)[0]!;

    const coldSnow = system.resolveWeatherAt(coldCell.worldX, coldCell.worldZ, { kind: 'snow', intensity: 0.75, wind: 0.1, precipitation: 'snow' });
    const warmRain = system.resolveWeatherAt(warmCell.worldX, warmCell.worldZ, { kind: 'rain', intensity: 0.72, wind: 0.15, precipitation: 'rain' });

    expect(coldSnow.kind).toBe('snow');
    expect(warmRain.kind).toBe('rain');
  });

  it('rainfall increases local soil moisture without being purely decorative', () => {
    const world = generateWorld(configWith({ seed: 'weather-moisture' }));
    const system = new WeatherSystem(world, configWith({ seed: 'weather-moisture' }));
    const cell = world.cells.find((entry) => !entry.water)!;
    cell.temperature = 0.8;
    const before = cell.moisture;
    system.applyWeatherToCell(cell, { kind: 'heavy-rain', intensity: 0.9, wind: 0.25, precipitation: 'rain' }, 1);
    expect(cell.moisture).toBeGreaterThan(before);
  });

  it('regional weather fronts move and dissipate over time', () => {
    const world = generateWorld(configWith({ seed: 'weather-fronts' }));
    const system = new WeatherSystem(world, configWith({ seed: 'weather-fronts' }));
    const front = system.createFront({ x: 0, z: 0 }, 'rain', 0.6, 16, 1, 1);
    const before = { x: front.x, z: front.z };
    system.advanceMonth();
    expect(front.ageMonths).toBeGreaterThan(0);
    expect(front.x !== before.x || front.z !== before.z || front.intensity < 0.6 || front.lifespan <= front.ageMonths).toBe(true);
  });

  it('weather differs by region within the same world', () => {
    const world = generateWorld(configWith({ seed: 'weather-regions' }));
    const system = new WeatherSystem(world, configWith({ seed: 'weather-regions' }));
    const north = world.cells.filter((cell) => cell.z < world.size / 2).sort((a, b) => b.moisture - a.moisture)[0]!;
    const south = world.cells.filter((cell) => cell.z >= world.size / 2).sort((a, b) => a.moisture - b.moisture)[0]!;
    const northClimate = system.resolveWeatherAt(north.worldX, north.worldZ, { kind: 'rain', intensity: 0.75, wind: 0.2, precipitation: 'rain' });
    const southClimate = system.resolveWeatherAt(south.worldX, south.worldZ, { kind: 'clear', intensity: 0.1, wind: 0.05, precipitation: 'none' });

    expect(northClimate.kind).not.toBe(southClimate.kind);
  });
});
