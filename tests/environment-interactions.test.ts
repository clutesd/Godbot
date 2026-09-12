import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { applyFloodConsequences, repairWeatherDamage } from '../src/sim/weather/WeatherConsequences';
import { PeopleSystem } from '../src/sim/people/PeopleSystem';
import { classifyWaterDepth, surfaceHeightAt, waterDepthAt } from '../src/sim/terrain/SurfaceGeometry';
import { cellAt } from '../src/sim/world';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { pointKey } from '../src/sim/transport/TerrainTraversal';
import { segmentUsable } from '../src/sim/transport/TransportNetwork';
import { buildInlandWater, WaterSystem } from '../src/render/terrain/WaterSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { snowCoverageForDepth, WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';

function floodplain() {
  const simulation = new Simulation({ seed: 'environment-acceptance', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
  const state = simulation.state;
  const world = state.world;
  const field = world.terrain;
  const ground = world.seaLevel + 0.08;
  const riverX = Math.round(-field.originX / field.step);
  const riverWorldX = field.originX + riverX * field.step;
  field.waterLevel.fill(-1); field.river.fill(0); field.lake.fill(0); field.fall.fill(0);
  for (let i = 0; i < field.height.length; i++) {
    const x = field.originX + i % field.resolution * field.step;
    const sampleX = i % field.resolution;
    field.height[i] = ground + (x > 8 ? 0.12 : sampleX < riverX && sampleX >= riverX - 6 ? -0.02 : 0);
    if (i % field.resolution === riverX) {
      field.height[i] = ground - 0.03;
      field.waterLevel[i] = ground - 0.012;
      field.river[i] = 1;
    }
  }
  const downstream = new Int32Array(field.height.length).fill(-1);
  const upstream: number[] = [];
  const outlets: number[] = [];
  for (let index = 0; index < field.height.length; index++) {
    const x = index % field.resolution;
    if (x === riverX) outlets.push(index);
    else {
      downstream[index] = Math.floor(index / field.resolution) * field.resolution + riverX;
      upstream.push(index);
    }
  }
  Object.assign(field, { drainage: { downstream, order: [...upstream, ...outlets], accumulation: new Float32Array(field.height.length).fill(1) } });
  for (const cell of world.cells) {
    cell.water = Math.abs(cell.worldX) < field.step * 0.4;
    cell.river = cell.water; cell.lake = false; cell.slope = 0; cell.landform = 'lowland';
    cell.elevation = ground + (cell.worldX > 8 ? 0.12 : 0); cell.movementCost = 1;
    cell.temperature = 0.8; cell.moisture = 0.6; cell.wood = 1;
  }
  const weather = new WeatherSystem(world, simulation.config);
  state.weather = weather.state;
  const settlement = state.settlements[0]!;
  settlement.position = { x: -1, z: 0 };
  settlement.cellIndex = cellAt(world, -1, 0)!.z * world.size + cellAt(world, -1, 0)!.x;
  settlement.buildings = 2;
  settlement.structurePlots = [
    { id: 'low-home', worldX: riverWorldX - field.step, worldZ: 0, width: 1, depth: 1, height: 1, radius: 0.7, condition: 1, foundedMonth: 0 },
    { id: 'high-home', worldX: 14, worldZ: 0, width: 1, depth: 1, height: 1, radius: 0.7, condition: 1, foundedMonth: 0 },
  ];
  const points = [-2, -1, 0, 1, 2].map(offset => ({ x: riverWorldX + offset, z: 3, y: surfaceHeightAt(world, riverWorldX + offset, 3) + 0.04 }));
  state.transportation.segments['road'] = { id: 'road', from: pointKey(points[0]!), to: pointKey(points.at(-1)!),
    mode: 'road', kind: 'surface', status: 'complete', points, length: 4, cost: 2, work: 2 };
  const people = new PeopleSystem(world, state.seed);
  const person = state.people.find(p => p.homeId === settlement.id)!;
  person.position = { x: riverWorldX - field.step, z: 0 }; person.activity = 'rest';
  const step = (rain: boolean) => {
    weather.state.fronts = [];
    // Four controlled stationary fronts prevent random fronts from changing the experiment.
    for (let i = 0; i < 4; i++) weather.createFront({ x: 0, z: 0 }, rain ? 'heavy-rain' : 'clear', 1, 1000, 0, 2);
    weather.advanceMonth();
    state.month = weather.state.month;
    applyFloodConsequences(state);
    people.advancePerson(person, settlement, state);
  };
  return { simulation, state, world, weather, settlement, people, person, step };
}

describe('Persistent world environment acceptance', () => {
  it('classifies depths in the same world units as people and structures', () => {
    expect([0, 0.03, 0.2, 0.6, 1.1].map(depth => classifyWaterDepth(depth)))
      .toEqual(['dry', 'wet', 'flooded', 'deeply-flooded', 'submerged']);
    expect(classifyWaterDepth(0, 0.9)).toBe('wet');
  });

  it('rises from a connected river, evacuates residents, damages low structures and roads, and retains damage after recession', () => {
    const { state, world, settlement, people, person, step } = floodplain();
    const road = state.transportation.segments['road']!;
    let protectedFromFlood = false;
    let peakLowFloodDepth = 0;
    for (let month = 0; month < 10; month++) {
      step(true);
      protectedFromFlood ||= person.navigation?.destinationKind === 'safe-area' || person.activity === 'shelter';
      peakLowFloodDepth = Math.max(peakLowFloodDepth, settlement.structurePlots![0]!.floodDepth ?? 0);
      expect(people.isPersonPositionValid(person)).toBe(true);
      expect(waterDepthAt(world, person.position.x, person.position.z)).toBe(0);
    }
    const low = settlement.structurePlots![0]!;
    const high = settlement.structurePlots![1]!;
    expect(protectedFromFlood).toBe(true);
    expect(peakLowFloodDepth).toBeGreaterThan(0.12);
    expect(low.condition).toBeLessThan(0.8);
    expect(low.accessRestricted).toBe(true);
    expect(high.condition).toBe(1);
    expect(high.accessRestricted).toBe(false);
    expect(road.status).toBe('under-construction');
    expect(segmentUsable(world, road)).toBe(false);
    expect(repairWeatherDamage(settlement, 10, state.month + 1)).toBe(0);
    const damaged = low.condition;
    for (let month = 0; month < 24; month++) step(false);
    expect(low.floodDepth).toBe(0);
    expect(low.condition).toBeLessThanOrEqual(damaged);
    expect(road.status).toBe('under-construction');
    expect(segmentUsable(world, road)).toBe(false);
    settlement.resources.wood = 100; settlement.resources.minerals = 100;
    expect(repairWeatherDamage(settlement, 10, state.month + 1)).toBeGreaterThan(0);
    expect(settlement.resources.wood).toBeLessThan(100);
  });

  it('brief shallow flooding restricts access without destroying a building, but sustained submersion destroys it', () => {
    const { state, world, settlement } = floodplain();
    const plot = settlement.structurePlots![0]!;
    const ground = world.seaLevel + 0.08;
    world.terrain.waterLevel.fill(ground + 0.005);
    applyFloodConsequences(state, 1 / 30);
    expect(plot.condition).toBeGreaterThan(0.999);
    expect(plot.accessRestricted).toBe(true);
    world.terrain.waterLevel.fill(ground + 0.09);
    for (let i = 0; i < 4; i++) applyFloodConsequences(state);
    expect(plot.condition).toBe(0);
    world.terrain.waterLevel.fill(-1);
    applyFloodConsequences(state);
    expect(plot.condition).toBe(0);
    expect(plot.accessRestricted).toBe(true);
  });

  it('leaves a raised bridge intact when floodwater remains below its deck', () => {
    const { state, world } = floodplain();
    const road = state.transportation.segments['road']!;
    road.kind = 'bridge';
    for (const p of road.points) p.y += 2;
    world.terrain.waterLevel.fill(world.seaLevel + 0.12);
    for (let month = 0; month < 6; month++) applyFloodConsequences(state);
    expect(road.work).toBe(road.cost);
    expect(road.floodDepth).toBe(0);
  });

  it('replans a cached pedestrian route around newly flooded ground and reopens it after recession', () => {
    const { world, people } = floodplain();
    const start = { x: -10, z: -10 };
    const end = { x: -2, z: -10 };
    const walking = people.walkability;
    expect(walking.isSegmentWalkable(start, end)).toBe(true);
    const initial = walking.route(start, end);
    const sample = nearestIndex(world.terrain, -6, -10);
    world.terrain.waterLevel[sample] = world.terrain.height[sample]! + 0.03;
    world.environmentRevision = (world.environmentRevision ?? 0) + 1;
    expect(walking.routeIsValid([start, ...initial])).toBe(false);
    const detour = walking.route(start, end);
    expect(detour.length).toBeGreaterThan(1);
    expect(walking.routeIsValid([start, ...detour])).toBe(true);
    expect(detour.at(-1)).toEqual(end);
    world.terrain.waterLevel[sample] = -1;
    world.environmentRevision++;
    expect(walking.isSegmentWalkable(start, end)).toBe(true);
  });

  it('interrupts normal activity and loses health when a flood leaves no dry refuge', () => {
    const { state, world, person, settlement, people } = floodplain();
    world.terrain.waterLevel.fill(0.95);
    for (const cell of world.cells) cell.water = true;
    world.environmentRevision = (world.environmentRevision ?? 0) + 1;
    const health = person.health;
    people.advancePerson(person, settlement, state);
    expect(person.navigation?.reason).toContain('awaiting rescue');
    expect(person.navigation?.traveling).toBe(false);
    expect(person.activity).toBe('shelter');
    expect(person.health).toBeLessThan(health);
  });

  it('does not display a widening river beyond authoritative wet samples or drift the ocean with frame count', () => {
    const { world } = floodplain();
    const water = buildInlandWater(world)!;
    expect(water).toBeDefined();
    const positions = water.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(world.terrain.step / 2 + 0.001);
    expect((water.material as THREE.MeshStandardMaterial).depthWrite).toBe(true);
    expect((water.material as THREE.MeshStandardMaterial).transparent).toBe(false);
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'ocean-bounds');
    const ocean = renderer.group.children[0]!;
    for (let frame = 0; frame < 60 * 600; frame++) renderer.update(frame / 60);
    expect(Math.abs(ocean.position.y + 0.02)).toBeLessThanOrEqual(0.0016);
    const y = ocean.position.y;
    renderer.update((60 * 600 - 1) / 60);
    expect(ocean.position.y).toBe(y);
    water.geometry.dispose(); (water.material as THREE.Material).dispose();
    renderer.group.traverse(object => {
      if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
    });
  });

  it('whitens exposed surfaces over cold snowy days, accumulates more in blizzards and melts gradually into summer', () => {
    const { weather, world } = floodplain();
    const land = world.cells.filter(c => !c.water);
    for (const cell of land) cell.temperature = 0.3;
    for (let day = 0; day < 12; day++) for (const cell of land) weather.applyWeatherToCell(cell, { kind: 'rain', intensity: 0.9, wind: 0.2 }, 1 / 30);
    expect(land.every(cell => weather.state.cells[cell.z * world.size + cell.x]!.precipitation === 'snow')).toBe(true);
    const cell = land[0]!;
    const conditions = weather.state.cells[cell.z * world.size + cell.x]!;
    const ordinary = conditions.snowpack;
    expect(snowCoverageForDepth(ordinary)).toBeGreaterThan(0.6);
    const slow = cell.movementCost;
    for (let day = 0; day < 12; day++) weather.applyWeatherToCell(cell, { kind: 'heavy-rain', intensity: 1, wind: 1 }, 1 / 30);
    expect(conditions.snowpack - ordinary).toBeGreaterThan(ordinary * 3);
    expect(snowCoverageForDepth(conditions.snowpack)).toBeGreaterThan(0.98);
    expect(cell.movementCost).toBeGreaterThan(slow);
    const deep = conditions.snowpack;
    weather.applyWeatherToCell(cell, { kind: 'clear' }, 1);
    expect(conditions.snowpack).toBe(deep);
    cell.temperature = 0.85;
    weather.applyWeatherToCell(cell, { kind: 'clear' }, 1 / 30);
    expect(conditions.snowpack).toBeGreaterThan(0);
    expect(conditions.snowpack).toBeLessThan(deep);
    for (let month = 0; month < 6; month++) { weather.state.month++; weather.applyWeatherToCell(cell, { kind: 'clear' }); }
    expect(conditions.snowpack).toBe(0);
  });

  it('binds shared snow accumulation to every material in a roof and keeps vertical walls free of snow', () => {
    const { world } = floodplain();
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), 'multi-roof');
    const scene = new THREE.Scene();
    const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
    const roof = new THREE.Mesh(new THREE.BoxGeometry(), materials);
    roof.userData['weatherSurface'] = true;
    scene.add(roof); renderer.bindScene(scene);
    for (const material of materials) {
      const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' } as unknown as Parameters<typeof material.onBeforeCompile>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms['weatherMap']!.value).toBe(renderer.texture);
      expect(shader.vertexShader).toContain('normalize(mat3(modelMatrix) * snowNormal).y');
      expect(shader.fragmentShader).toContain('weatherUp * (1.0 - immersion)');
    }
    renderer.dispose(); roof.geometry.dispose(); materials.forEach(material => material.dispose());
  });
});
