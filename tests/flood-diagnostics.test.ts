import { describe, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { applyFloodConsequences } from '../src/sim/weather/WeatherConsequences';
import { PeopleSystem } from '../src/sim/people/PeopleSystem';
import { cellAt } from '../src/sim/world';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { surfaceHeightAt, waterDepthAt } from '../src/sim/terrain/SurfaceGeometry';

// Temporary branch diagnostic: deleted before merge.
describe('flood diagnostics', () => {
  it('reports the controlled floodplain and evacuation timeline after sustained heavy rain', () => {
    const simulation = new Simulation({ seed: 'environment-acceptance', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
    const state = simulation.state;
    const world = state.world;
    const field = world.terrain;
    const ground = world.seaLevel + 0.08;
    field.waterLevel.fill(-1); field.floodDepth.fill(0); field.river.fill(0); field.lake.fill(0); field.fall.fill(0);
    for (let i = 0; i < field.height.length; i++) {
      const x = field.originX + i % field.resolution * field.step;
      field.height[i] = ground + (x > 8 ? 0.12 : 0);
      if (Math.abs(x) < field.step * 0.4) {
        field.height[i] = ground - 0.03;
        field.waterLevel[i] = ground - 0.012;
        field.river[i] = 1;
      }
    }
    for (const cell of world.cells) {
      cell.water = Math.abs(cell.worldX) < field.step * 0.4;
      cell.river = cell.water; cell.lake = false; cell.slope = 0; cell.landform = 'lowland';
      cell.elevation = ground + (cell.worldX > 8 ? 0.12 : 0); cell.movementCost = 1;
      cell.temperature = 0.8; cell.moisture = 0.6; cell.wood = 1;
    }
    const weather = new WeatherSystem(world, simulation.config);
    state.weather = weather.state;
    const settlement = state.settlements[0]!;
    settlement.position = { x: -4, z: 0 };
    const settlementCell = cellAt(world, -4, 0)!;
    settlement.cellIndex = settlementCell.z * world.size + settlementCell.x;
    settlement.buildings = 2;
    settlement.structurePlots = [
      { id: 'low-home', worldX: -4, worldZ: 0, width: 1, depth: 1, height: 1, radius: 0.7, condition: 1, foundedMonth: 0 },
      { id: 'high-home', worldX: 14, worldZ: 0, width: 1, depth: 1, height: 1, radius: 0.7, condition: 1, foundedMonth: 0 },
    ];
    const people = new PeopleSystem(world, state.seed);
    const person = state.people.find(p => p.homeId === settlement.id)!;
    person.position = { x: -4, z: 0 }; person.target = { ...person.position }; person.activity = 'rest';

    for (let month = 0; month < 10; month++) {
      weather.state.fronts = [];
      for (let i = 0; i < 4; i++) weather.createFront({ x: 0, z: 0 }, 'heavy-rain', 1, 1000, 0, 2);
      weather.advanceMonth();
      state.month = weather.state.month;
      applyFloodConsequences(state);
      people.advancePerson(person, settlement, state);
      console.log('EVAC_MONTH', JSON.stringify({
        month: month + 1,
        person: { x: Number(person.position.x.toFixed(3)), z: Number(person.position.z.toFixed(3)), reason: person.navigation?.reason },
        personDepth: Number(waterDepthAt(world, person.position.x, person.position.z).toFixed(3)),
        lowDepth: Number((settlement.structurePlots[0]!.floodDepth ?? 0).toFixed(3)),
        lowRestricted: settlement.structurePlots[0]!.accessRestricted,
        settlementFlood: Number(weather.state.cells[settlement.cellIndex]!.floodDepth.toFixed(3)),
      }));
    }

    const profile = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map(x => {
      const sample = nearestIndex(field, x, 0);
      return { x, flood: Number(field.floodDepth[sample]!.toFixed(3)), waterDepth: Number(waterDepthAt(world, x, 0).toFixed(3)), ground: Number(surfaceHeightAt(world, x, 0).toFixed(3)) };
    });
    console.log('FLOOD_PROFILE', JSON.stringify(profile));
    console.log('FLOOD_MAX', Math.max(...field.floodDepth));
  });
});
