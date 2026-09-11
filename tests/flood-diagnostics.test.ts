import { describe, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { surfaceHeightAt, waterDepthAt } from '../src/sim/terrain/SurfaceGeometry';

// Temporary branch diagnostic: deleted before merge.
describe('flood diagnostics', () => {
  it('reports the controlled floodplain head profile after sustained heavy rain', () => {
    const simulation = new Simulation({ seed: 'environment-acceptance', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
    const world = simulation.state.world;
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
    for (let month = 0; month < 10; month++) {
      weather.state.fronts = [];
      for (let i = 0; i < 4; i++) weather.createFront({ x: 0, z: 0 }, 'heavy-rain', 1, 1000, 0, 2);
      weather.advanceMonth();
    }
    const profile = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map(x => {
      const sample = nearestIndex(field, x, 0);
      return { x, flood: Number(field.floodDepth[sample]!.toFixed(3)), waterDepth: Number(waterDepthAt(world, x, 0).toFixed(3)), ground: Number(surfaceHeightAt(world, x, 0).toFixed(3)), water: world.cells.find(c => Math.abs(c.worldX - x) < 0.01 && Math.abs(c.worldZ) < 0.01)?.water };
    });
    console.log('FLOOD_PROFILE', JSON.stringify(profile));
    console.log('FLOOD_MAX', Math.max(...field.floodDepth));
  });
});
