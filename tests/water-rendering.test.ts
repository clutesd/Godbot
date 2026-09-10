import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater, waterFreezeFactor, WaterSystem } from '../src/render/terrain/WaterSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { nearestIndex } from '../src/sim/terrain/TerrainField';

function waterWorld() {
  const simulation = new Simulation({ seed: 'water-rendering-foundation', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
  const world = simulation.state.world;
  const field = world.terrain;
  const ground = world.seaLevel + 0.08;
  field.waterLevel.fill(-1);
  field.river.fill(0);
  field.lake.fill(0);
  field.fall.fill(0);
  const middleZ = Math.floor(field.resolution / 2);
  let riverX = 0;
  for (let index = 0; index < field.height.length; index += 1) {
    const xIndex = index % field.resolution;
    const zIndex = Math.floor(index / field.resolution);
    const x = field.originX + xIndex * field.step;
    field.height[index] = ground;
    if (Math.abs(x) < field.step * 0.4) {
      riverX = xIndex;
      const level = ground - 0.010 - zIndex * 0.00012;
      field.height[index] = level - 0.022;
      field.waterLevel[index] = level;
      field.river[index] = 1;
      field.flow[index] = 0.72 + Math.min(0.24, zIndex / field.resolution * 0.24);
      if (field.drainage) {
        field.drainage.downstream[index] = zIndex < field.resolution - 1 ? index + field.resolution : -1;
        field.drainage.accumulation[index] = 12 + zIndex * zIndex * 2;
      }
    }
  }

  // Give one routed river sample a real terrain drop so the waterfall presentation has a landmark.
  const fallIndex = middleZ * field.resolution + riverX;
  const below = fallIndex + field.resolution;
  field.fall[fallIndex] = 0.9;
  field.height[fallIndex] = ground + 0.015;
  field.waterLevel[fallIndex] = ground + 0.035;
  if (below < field.height.length) {
    field.height[below] = ground - 0.06;
    field.waterLevel[below] = ground - 0.035;
  }

  return world;
}

function shaderStub() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>',
  };
}

function disposeRenderer(renderer: WaterSystem) {
  renderer.group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    }
  });
}

describe('Water rendering foundation', () => {
  it('carries geography, local weather, ice and turbulence into the authoritative inland surface', () => {
    const world = waterWorld();
    if (world.weather) {
      for (const weather of world.weather.cells) {
        weather.temperature = 0.29;
        weather.wind = 0.78;
        weather.windX = 0.8;
        weather.windZ = 0.2;
        weather.precipitation = 'snow';
        weather.kind = 'heavy-snow';
        weather.intensity = 0.8;
        weather.snowpack = 0.08;
      }
    }
    const water = buildInlandWater(world)!;
    expect(water).toBeDefined();
    const positions = water.geometry.getAttribute('position');
    const depths = water.geometry.getAttribute('waterDepth');
    const flows = water.geometry.getAttribute('waterFlow');
    const directions = water.geometry.getAttribute('waterFlowDirection');
    const kinds = water.geometry.getAttribute('waterKind');
    const hierarchy = water.geometry.getAttribute('waterHierarchy');
    const rapids = water.geometry.getAttribute('waterRapid');
    const wind = water.geometry.getAttribute('waterWind');
    const windDirection = water.geometry.getAttribute('waterWindDirection');
    const rain = water.geometry.getAttribute('waterRain');
    const freeze = water.geometry.getAttribute('waterFreeze');
    const snow = water.geometry.getAttribute('waterSnow');
    const emergence = water.geometry.getAttribute('waterEmergence');
    for (const attribute of [depths, flows, directions, kinds, hierarchy, rapids, wind, windDirection, rain, freeze, snow, emergence]) {
      expect(attribute.count).toBe(positions.count);
    }
    expect(Array.from({ length: depths.count }, (_, index) => depths.getX(index)).some(depth => depth > 0)).toBe(true);
    expect(Array.from({ length: directions.count }, (_, index) => Math.hypot(directions.getX(index), directions.getY(index))).some(length => length > 0.9)).toBe(true);
    expect(Array.from({ length: kinds.count }, (_, index) => kinds.getX(index)).every(kind => kind === 1)).toBe(true);
    const hierarchyValues = Array.from({ length: hierarchy.count }, (_, index) => hierarchy.getX(index));
    expect(Math.max(...hierarchyValues)).toBeGreaterThan(Math.min(...hierarchyValues));
    expect(Array.from({ length: rapids.count }, (_, index) => rapids.getX(index)).some(rapid => rapid > 0.5)).toBe(true);
    expect(Array.from({ length: wind.count }, (_, index) => wind.getX(index)).some(value => value > 0.5)).toBe(true);
    expect(Array.from({ length: freeze.count }, (_, index) => freeze.getX(index)).some(value => value > 0)).toBe(true);

    const material = water.material as THREE.MeshPhysicalMaterial;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.clearcoat).toBeGreaterThan(0);

    const shader = shaderStub();
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('#define waterFlowDirection waterPacked1.xy');
    expect(shader.vertexShader).toContain('#define waterWindDirection waterPacked2.xy');
    expect(shader.vertexShader.match(/attribute vec4 waterPacked/g)).toHaveLength(4);
    const packed = water.geometry.getAttribute('waterPacked0');
    for (let i = 0; i < positions.count; i++) {
      expect(packed.getX(i)).toBe(depths.getX(i));
      expect(packed.getY(i)).toBe(flows.getX(i));
      expect(packed.getZ(i)).toBe(kinds.getX(i));
    }
    expect(shader.vertexShader).toContain('waterCurrentCoordinate');
    expect(shader.vertexShader).toContain('waterFreezePrevious');
    expect(shader.vertexShader).toContain('waterEmergence');
    expect(shader.fragmentShader).toContain('waterRiverTint');
    expect(shader.fragmentShader).toContain('currentLane');
    expect(shader.fragmentShader).toContain('rapidCrest');
    expect(shader.fragmentShader).toContain('snowOnIce');
    expect(shader.fragmentShader).toContain('roughnessFactor');

    water.geometry.dispose();
    material.dispose();
  });

  it('freezes calm standing water first and leaves warm or fast water substantially more open', () => {
    const lake = waterFreezeFactor(0.25, 'lake', 0.05, 0.08);
    const river = waterFreezeFactor(0.25, 'river', 0.94, 0.08);
    const flood = waterFreezeFactor(0.25, 'flood', 0.05, 0.08);
    expect(lake).toBeGreaterThan(0.8);
    expect(flood).toBeGreaterThan(river);
    expect(river).toBeLessThan(lake * 0.35);
    expect(waterFreezeFactor(0.55, 'lake', 0, 0.2)).toBe(0);
  });

  it('shares interpolated elevations along adjacent wet samples instead of rendering terraced puddles', () => {
    const water = buildInlandWater(waterWorld())!;
    const positions = water.geometry.getAttribute('position');
    const seen = new Map<string, number>();
    let shared = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const key = `${positions.getX(index).toFixed(4)}:${positions.getZ(index).toFixed(4)}`;
      const y = positions.getY(index);
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        expect(Math.abs(earlier - y)).toBeLessThan(0.0002);
        shared += 1;
      } else {
        seen.set(key, y);
      }
    }
    expect(shared).toBeGreaterThan(0);
    water.geometry.dispose();
    (water.material as THREE.Material).dispose();
  });

  it('creates waterfall sheets, wind-carried mist, plunge-pool foam and deterministic rapid motion', () => {
    const world = waterWorld();
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'water-rendering-foundation');
    const ocean = renderer.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
    expect(ocean.geometry.getAttribute('position').count).toBeGreaterThan(4);
    const rapidFoam = renderer.group.getObjectByName('river-rapid-foam') as THREE.Points | undefined;
    const waterfall = renderer.group.getObjectByName('waterfall-sheets') as THREE.Mesh | undefined;
    const plunge = renderer.group.getObjectByName('waterfall-plunge-foam') as THREE.Points | undefined;
    const mist = renderer.group.getObjectByName('waterfall-mist') as THREE.Points | undefined;
    expect(rapidFoam).toBeDefined();
    expect(waterfall).toBeDefined();
    expect(plunge).toBeDefined();
    expect(mist).toBeDefined();
    expect(waterfall!.geometry.getAttribute('fallProgress').count).toBe(waterfall!.geometry.getAttribute('position').count);

    if (world.weather) {
      world.weather.wind = 0.9;
      world.weather.windX = 1;
      world.weather.windZ = 0;
      for (const weather of world.weather.cells) {
        weather.kind = 'thunderstorm';
        weather.intensity = 0.85;
        weather.precipitation = 'rain';
      }
    }

    const shader = shaderStub();
    ocean.material.onBeforeCompile(shader as unknown as Parameters<typeof ocean.material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    renderer.update(12.5);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);
    expect(shader.uniforms['waterWind']!.value).toBe(0.9);
    const y = ocean.position.y;
    const rapidPositions = rapidFoam!.geometry.getAttribute('position');
    const plungePositions = plunge!.geometry.getAttribute('position');
    const firstRapid = rapidPositions.getZ(0);
    const firstPlunge = plungePositions.getX(0);
    renderer.update(13.5);
    expect(rapidPositions.getZ(0)).not.toBe(firstRapid);
    expect(plungePositions.getX(0)).not.toBe(firstPlunge);
    expect(Math.abs(mist!.position.x)).toBeGreaterThan(0);
    renderer.update(12.5);
    expect(ocean.position.y).toBe(y);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);

    disposeRenderer(renderer);
  });

  it('eases newly flooded ground upward and leaves temporary wetness after recession without widening water', () => {
    const world = waterWorld();
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'flood-transition');
    renderer.update(20);

    const field = world.terrain;
    const sample = nearestIndex(field, field.step * 4, field.step * 4);
    expect(field.waterLevel[sample]).toBeLessThan(0);
    field.height[sample] = world.seaLevel + 0.08;
    field.waterLevel[sample] = world.seaLevel + 0.11;
    field.river[sample] = 0;
    field.lake[sample] = 0;
    world.environmentRevision = (world.environmentRevision ?? 0) + 1;
    renderer.syncHydrology();

    const flooded = renderer.group.getObjectByName('inland-water') as THREE.Mesh;
    const emergence = flooded.geometry.getAttribute('waterEmergence');
    expect(Array.from({ length: emergence.count }, (_, index) => emergence.getX(index)).some(value => value > 0.5)).toBe(true);
    const material = flooded.material as THREE.MeshPhysicalMaterial;
    const shader = shaderStub();
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    renderer.update(20.3);
    expect(Number(shader.uniforms['waterTransition']!.value)).toBeGreaterThan(0);
    expect(Number(shader.uniforms['waterTransition']!.value)).toBeLessThan(1);

    // Geometry is still clipped to the authoritative sample footprint; the transition only changes height.
    const positions = flooded.geometry.getAttribute('position');
    const sx = field.originX + sample % field.resolution * field.step;
    const sz = field.originZ + Math.floor(sample / field.resolution) * field.step;
    let foundNewFlood = false;
    for (let index = 0; index < positions.count; index += 1) {
      if (Math.abs(positions.getX(index) - sx) <= field.step * 0.51 && Math.abs(positions.getZ(index) - sz) <= field.step * 0.51) foundNewFlood = true;
    }
    expect(foundNewFlood).toBe(true);

    field.waterLevel[sample] = -1;
    world.environmentRevision++;
    renderer.syncHydrology();
    const wetness = renderer.group.getObjectByName('receded-water-wetness') as THREE.Points | undefined;
    expect(wetness).toBeDefined();
    renderer.update(31);
    expect(renderer.group.getObjectByName('receded-water-wetness')).toBeUndefined();

    disposeRenderer(renderer);
  });
});
