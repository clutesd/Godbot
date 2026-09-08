import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { Simulation } from '../src/sim/Simulation';
import { generateWorld } from '../src/sim/world';
import type { TornadoState } from '../src/sim/types';
import { tornadoDamage, tornadoExposure, tornadoPotential } from '../src/sim/weather/Tornado';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { applyTornadoConsequences, repairWeatherDamage } from '../src/sim/weather/WeatherConsequences';

function tornado(): TornadoState {
  return { id: 'test-tornado', frontId: 'storm', month: 0, intensity: 1, width: 2, speed: 10,
    lifetimeHours: 1, direction: { x: 1, z: 0 }, path: [{ x: -10, z: 0 }, { x: 10, z: 0 }] };
}

describe('Authoritative tornadoes', () => {
  it('records grounded strike history on the simulation tick and retains damage after dissipation', () => {
    const simulation = new Simulation({ seed: 'tornado-aftermath', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
    expect(simulation.state.settlements.length).toBeGreaterThan(0);
    const settlement = simulation.state.settlements[0]!;
    const plot = { id: `${settlement.id}:building:0`, worldX: settlement.position.x, worldZ: settlement.position.z,
      radius: 0.2, width: 1, height: 1, depth: 1, condition: 1, foundedMonth: 0 };
    settlement.structurePlots = [plot];
    const event = { ...tornado(), month: 1, path: [{ x: plot.worldX - 5, z: plot.worldZ }, { x: plot.worldX + 5, z: plot.worldZ }] };
    simulation.state.weather.tornadoes.push(event);
    simulation.step();
    const recorded = simulation.state.history.find((entry) => entry.context.weatherEventId === event.id && entry.locationId === settlement.id)!;
    expect(recorded).toBeDefined();
    expect(recorded.context.damagedStructures).toBeGreaterThan(0);
    expect(recorded.affectedPopulation).toBe(0);
    const afterStrike = plot.condition;
    expect(afterStrike).toBeLessThan(1);
    for (const person of simulation.state.people) if (person.occupation === 'builder') person.occupation = 'farmer';
    simulation.step(3);
    expect(simulation.state.weather.tornadoes.some((entry) => entry.id === event.id)).toBe(false);
    expect(plot.condition).toBe(afterStrike);
    expect(simulation.state.history.filter((entry) => entry.context.weatherEventId === event.id && entry.locationId === settlement.id)).toHaveLength(1);
  });

  it('requires severe, warm, moist, contrasting conditions', () => {
    const config = configWith({ seed: 'tornado-gates', world: { size: 20 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water)!;
    cell.moisture = 0.9;
    const front = weather.createFront({ x: cell.worldX, z: cell.worldZ }, 'thunderstorm', 1);
    expect(tornadoPotential(front, cell, 0.8, 0.2)).toBeGreaterThan(0);
    expect(tornadoPotential({ ...front, kind: 'rain' }, cell, 0.8, 0.2)).toBe(0);
    expect(tornadoPotential(front, cell, 0.3, 0.2)).toBe(0);
    expect(tornadoPotential(front, { ...cell, moisture: 0.2 }, 0.8, 0.2)).toBe(0);
    expect(tornadoPotential(front, cell, 0.8, 0.01)).toBe(0);
    expect(tornadoPotential({ ...front, intensity: 0.4 }, cell, 0.8, 0.2)).toBe(0);
  });

  it('uses swept paths and scales damage by intensity, exposure and resilience', () => {
    const event = tornado();
    expect(tornadoExposure(event, { x: 0, z: 0 })).toBe(1);
    expect(tornadoExposure(event, { x: 0, z: 2 })).toBe(0);
    expect(tornadoExposure(event, { x: 0, z: 0.8 })).toBeCloseTo(0.2);
    expect(tornadoDamage(event, 1, 0)).toBeGreaterThan(tornadoDamage({ ...event, intensity: 0.2 }, 1, 0));
    expect(tornadoDamage(event, 1, 0.8)).toBeLessThan(tornadoDamage(event, 1, 0));
  });

  it('damages only intersecting plots and leaves destruction until funded repair', () => {
    const simulation = new Simulation({ seed: 'tornado-aftermath', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
    const [hit, missed] = simulation.state.settlements;
    const template = { radius: 0.2, width: 1, height: 1, depth: 1, condition: 1, foundedMonth: 0 };
    hit!.structurePlots = [{ ...template, id: 'hit', worldX: 0, worldZ: 0 }];
    missed!.structurePlots = [{ ...template, id: 'miss', worldX: 0, worldZ: 5 }];
    const events = applyTornadoConsequences(simulation.state, tornado());
    expect(hit!.structurePlots[0]!.condition).toBeLessThan(1);
    expect(missed!.structurePlots[0]!.condition).toBe(1);
    expect(events.some((event) => event.locationId === hit!.id)).toBe(true);
    expect(events.some((event) => event.locationId === missed!.id)).toBe(false);
    const condition = hit!.structurePlots[0]!.condition;
    simulation.state.weather.tornadoes = [];
    hit!.resources.wood = 0;
    hit!.resources.minerals = 0;
    expect(repairWeatherDamage(hit!, 10, 1)).toBe(0);
    expect(hit!.structurePlots[0]!.condition).toBe(condition);
    hit!.resources.wood = 100;
    hit!.resources.minerals = 100;
    expect(repairWeatherDamage(hit!, 10, 2)).toBeGreaterThan(0);
    expect(hit!.structurePlots[0]!.condition).toBeGreaterThan(condition);
    expect(hit!.structurePlots[0]!.condition).toBeLessThan(1);
    expect(hit!.resources.wood).toBeLessThan(100);
  });

  it('forms replayable bounded paths from eligible storms, never ordinary weather', () => {
    const run = (kind: 'thunderstorm' | 'rain') => {
      const config = configWith({ seed: 'tornado-path-replay', world: { size: 12 } });
      const world = generateWorld(config);
      const system = new WeatherSystem(world, config);
      const center = world.cells.find((cell) => !cell.water && cell.x > 2 && cell.x < 9 && cell.z > 2 && cell.z < 9)!;
      for (const cell of world.cells) { cell.temperature = cell.x % 4 < 2 ? 0.9 : 0.55; cell.moisture = 0.95; }
      center.temperature = 0.9;
      const paths: TornadoState[] = [];
      for (let month = 0; month < 120; month += 1) {
        system.state.fronts = [];
        for (let index = 0; index < 4; index += 1) system.createFront({ x: center.worldX, z: center.worldZ }, kind, 1, 4, 0, 2);
        center.moisture = 0.95;
        system.advanceMonth();
        paths.push(...system.state.tornadoes.filter((event) => event.month === system.state.month));
      }
      return paths;
    };
    const first = run('thunderstorm');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((event) => event.path.length === 9)).toBe(true);
    expect(run('thunderstorm')).toEqual(first);
    expect(run('rain')).toEqual([]);
  });
});