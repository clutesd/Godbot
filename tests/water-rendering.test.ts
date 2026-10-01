import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater, waterFreezeFactor, WaterSystem } from '../src/render/terrain/WaterSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { EcologyField } from '../src/render/ecology/EcologyField';

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
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <roughnessmap_fragment>',
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
  it('retires waterfalls and disposes their effects when their channel dries', () => {
    const world = waterWorld();
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'changing-falls');
    expect(renderer.report.waterfalls).toBeGreaterThan(0);
    const sheets = renderer.group.getObjectByName('waterfall-sheets') as THREE.Mesh;
    let disposed = false;
    sheets.geometry.addEventListener('dispose', () => { disposed = true; });
    world.terrain.waterLevel.fill(-1);
    world.terrain.river.fill(0);
    world.environmentRevision = (world.environmentRevision ?? 0) + 1;
    renderer.syncHydrology();
    expect(disposed).toBe(true);
    expect(renderer.report.waterfalls).toBe(0);
    expect(renderer.report.riverSamples).toBe(0);
    for (const name of ['waterfall-sheets', 'waterfall-mist', 'waterfall-foam']) {
      expect(renderer.group.getObjectByName(name)).toBeUndefined();
    }
    renderer.update(40);
    disposeRenderer(renderer);
  });

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
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
    expect(material.clearcoat).toBeGreaterThan(0);
    // The diagnostic per-cell colour attribute stays on the geometry, but the visible material
    // must not multiply it back into checkerboard patches.
    expect(material.vertexColors).toBe(false);

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
    expect(shader.fragmentShader).toContain('waterVelocity = waterDirection*waterSpeed');
    expect(shader.vertexShader).toContain('vWaterWindDirection = waterWindDirection');
    expect(material.ior).toBeCloseTo(1.333);
    expect(material.metalness).toBe(0);
    expect(shader.vertexShader).not.toContain('transformed.y +=');
    expect(shader.vertexShader).not.toContain('transformed.y -=');
    expect(shader.vertexShader).toContain('waterFreezePrevious');
    expect(shader.vertexShader).toContain('waterEmergence');
    expect(shader.fragmentShader).toContain('waterRiverTint');
    expect(shader.fragmentShader).toContain('currentLane');
    expect(shader.fragmentShader).toContain('waterAdvectedField');
    expect(shader.fragmentShader).toContain('waterAbsorption');
    expect(shader.fragmentShader).toContain('rapidCrest');
    expect(shader.fragmentShader).toContain('snowOnIce');
    expect(shader.fragmentShader).toContain('roughnessFactor');
    // Sub-pixel waves must become roughness as detail fades, or distant water turns mirror-flat
    // and the sun or moon burns a single blown highlight across it.
    expect(shader.fragmentShader).toContain('waterDetailRoughness');

    water.geometry.dispose();
    material.dispose();
  });

  it('anchors mapped falls to routed wet endpoints even when an unrelated neighbour is lower', () => {
    const world = waterWorld();
    const field = world.terrain;
    const fallIndex = field.fall.findIndex(value => value > 0.5);
    const next = field.drainage!.downstream[fallIndex]!;
    field.height[fallIndex - 1] = world.seaLevel - 0.2;
    const snapshot = field.waterLevel.slice();
    const renderer = new WaterSystem(world,new TerrainSurface(world),'routed-falls');
    const sheet = renderer.group.getObjectByName('waterfall-sheets') as THREE.Mesh;
    const p = sheet.geometry.getAttribute('position');
    const ground = renderedGroundSampler(world);
    const upstreamY = elevationToY(field.waterLevel[fallIndex]!, world.seaLevel);
    const downstreamY = elevationToY(field.waterLevel[next]!, world.seaLevel);
    const upstreamX = field.originX + fallIndex % field.resolution * field.step;
    const upstreamZ = field.originZ + Math.floor(fallIndex / field.resolution) * field.step;
    const downstreamZ = field.originZ + Math.floor(next / field.resolution) * field.step;
    let upper = false, lower = false;
    for (let i = 0; i < p.count; i++) {
      expect(Number.isFinite(p.getY(i))).toBe(true);
      expect(p.getY(i) - ground(p.getX(i), p.getZ(i))).toBeGreaterThan(0);
      if (Math.abs(p.getX(i) - upstreamX) < 1e-5 && Math.abs(p.getZ(i) - upstreamZ) < 1e-5) {
        expect(p.getY(i) - upstreamY).toBeCloseTo(0.00025, 5); upper = true;
      }
      if (Math.abs(p.getX(i) - upstreamX) < 1e-5 && Math.abs(p.getZ(i) - downstreamZ) < 1e-5) {
        expect(p.getY(i) - downstreamY).toBeCloseTo(0.00025, 5); lower = true;
      }
    }
    expect(upper && lower).toBe(true);
    expect(field.waterLevel).toEqual(snapshot);
    // A dry receiver cannot retain a decorative fall, even with the map marker intact.
    field.waterLevel[next] = -1;
    world.environmentRevision = (world.environmentRevision ?? 0)+1;
    renderer.syncHydrology();
    expect(renderer.report.waterfalls).toBe(0);
    disposeRenderer(renderer);
  });

  it('keeps downstream particle trajectories deterministic and immutable through long-time replay', () => {
    const world = waterWorld();
    const a = new WaterSystem(world,new TerrainSurface(world),'particle-replay');
    const b = new WaterSystem(world,new TerrainSurface(world),'particle-replay');
    for (const name of ['river-rapid-foam','waterfall-plunge-foam','waterfall-foam']) {
      const pa = a.group.getObjectByName(name) as THREE.Points;
      const pb = b.group.getObjectByName(name) as THREE.Points;
      const data = pa.geometry.getAttribute('waterParticleMotion') as THREE.InterleavedBufferAttribute;
      expect(data.data.array).toEqual((pb.geometry.getAttribute('waterParticleMotion') as THREE.InterleavedBufferAttribute).data.array);
      const origins = pa.geometry.getAttribute('position') as THREE.BufferAttribute;
      const original = origins.array.slice();
      for (const time of [0,12.5,1000000,12.5]) a.update(time);
      expect(origins.array).toEqual(original);
      expect(origins.version).toBe(0);
      expect((pa.material as THREE.Material).userData['waterParticleTime'].value).toBe(12.5);
      expect(pa.geometry.boundingSphere!.radius).toBeGreaterThan(0);
      if (name==='river-rapid-foam') {
        const dir = pa.geometry.getAttribute('waterParticleDirection');
        for (let i=0;i<dir.count;i++) {
          expect(dir.getX(i)).toBe(0);
          expect(dir.getY(i)).toBe(1);
        }
      }
    }
    disposeRenderer(a); disposeRenderer(b);
  });

  it('scales spray down for small mapped drops instead of giving every fall a large mist cloud', () => {
    const world = waterWorld();
    const large = new WaterSystem(world, new TerrainSurface(world), 'fall-scale');
    const largeMist = large.group.getObjectByName('waterfall-mist') as THREE.Points;
    const index = world.terrain.fall.findIndex(value => value > 0.5);
    const next = world.terrain.drainage!.downstream[index]!;
    world.terrain.fall[index] = 0.3;
    world.terrain.waterLevel[next] = world.terrain.waterLevel[index]! - 0.012;
    const small = new WaterSystem(world, new TerrainSurface(world), 'fall-scale');
    const smallMist = small.group.getObjectByName('waterfall-mist') as THREE.Points;
    expect(small.report.waterfalls).toBe(1);
    expect(smallMist.geometry.getAttribute('position').count).toBeLessThan(largeMist.geometry.getAttribute('position').count);
    expect(smallMist.geometry.getAttribute('sprayScale').getX(0)).toBeLessThan(largeMist.geometry.getAttribute('sprayScale').getX(0) * 0.5);
    disposeRenderer(large); disposeRenderer(small);
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
    const world = waterWorld();
    // This continuity fixture excludes the deliberate waterfall used by the effects tests.
    for (let i = 0; i < world.terrain.waterLevel.length; i++) {
      if (world.terrain.river[i]) {
        world.terrain.waterLevel[i] = world.seaLevel + 0.07 - Math.floor(i / world.terrain.resolution) * 0.00012;
        world.terrain.height[i] = world.terrain.waterLevel[i]! - 0.022;
      }
    }
    const water = buildInlandWater(world)!;
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
    expect(water.geometry.userData['waterReconstruction']).toBe('signed-depth-on-shared-terrain-triangles');
    const normals = water.geometry.getAttribute('normal');
    const normalByPosition = new Map<string, [number, number, number]>();
    for (let index = 0; index < normals.count; index += 1) {
      expect(normals.getY(index)).toBeGreaterThan(0.95);
      const key = `${positions.getX(index).toFixed(4)}:${positions.getY(index).toFixed(4)}:${positions.getZ(index).toFixed(4)}`;
      const value: [number, number, number] = [normals.getX(index), normals.getY(index), normals.getZ(index)];
      const earlier = normalByPosition.get(key);
      if (earlier) {
        expect(Math.abs(earlier[0] - value[0])).toBeLessThan(1e-5);
        expect(Math.abs(earlier[1] - value[1])).toBeLessThan(1e-5);
        expect(Math.abs(earlier[2] - value[2])).toBeLessThan(1e-5);
      } else normalByPosition.set(key, value);
    }
    water.geometry.dispose();
    (water.material as THREE.Material).dispose();
  });

  it('creates waterfall sheets, wind-carried mist, plunge-pool foam and deterministic rapid motion', () => {
    const world = waterWorld();
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'water-rendering-foundation');
    const ocean = renderer.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
    expect(ocean.name).toBe('ocean-water');
    expect(ocean.geometry.getAttribute('position').count).toBeGreaterThan(4);
    const rapidFoam = renderer.group.getObjectByName('river-rapid-foam') as THREE.Points | undefined;
    const waterfall = renderer.group.getObjectByName('waterfall-sheets') as THREE.Mesh | undefined;
    const plunge = renderer.group.getObjectByName('waterfall-plunge-foam') as THREE.Points | undefined;
    const mist = renderer.group.getObjectByName('waterfall-mist') as THREE.Points | undefined;
    expect(rapidFoam).toBeDefined();
    expect(waterfall).toBeDefined();
    expect(plunge).toBeDefined();
    expect(mist).toBeDefined();
    expect(waterfall!.geometry.getAttribute('waterDepth').count).toBe(waterfall!.geometry.getAttribute('position').count);

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
    expect(shader.fragmentShader).toContain('waterWindSlope');
    expect(shader.fragmentShader).toContain('waterDetailFade');
    expect(shader.vertexShader).toContain('(modelMatrix * vec4(transformed, 1.0)).xz');
    // Ocean motion is normal-driven: the giant plane must stay smooth instead of exposing its triangles.
    expect(shader.vertexShader).not.toContain('transformed.z +=');
    const y = ocean.position.y;
    const rapidPositions = rapidFoam!.geometry.getAttribute('position');
    const plungePositions = plunge!.geometry.getAttribute('position');
    const firstRapid = rapidPositions.getZ(0);
    const firstPlunge = plungePositions.getX(0);
    renderer.update(13.5);
    expect(rapidPositions.getZ(0)).toBe(firstRapid);
    expect(plungePositions.getX(0)).toBe(firstPlunge);
    expect((rapidFoam!.material as THREE.Material).userData['waterParticleTime'].value).toBe(13.5);
    expect((plunge!.material as THREE.Material).userData['waterParticleTime'].value).toBe(13.5);
    expect((rapidPositions as THREE.BufferAttribute).version).toBe(0);
    expect(rapidFoam!.frustumCulled).toBe(true);
    expect(Math.abs(mist!.position.x)).toBeGreaterThan(0);
    renderer.update(12.5);
    expect(ocean.position.y).toBe(y);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);

    disposeRenderer(renderer);
  });

  it('softens ecology cells into continuous living water before bloom or bioluminescence', () => {
    const world = waterWorld();
    const ecology = new EcologyField(world, 'living-water-test');
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'living-water-test', ecology, 2);
    const ocean = renderer.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <emissivemap_fragment>\n#include <roughnessmap_fragment>',
    };
    ocean.material.onBeforeCompile(shader as unknown as Parameters<typeof ocean.material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.uniforms['ecologyCellWorld']!.value).toBe(world.cellSize);
    expect(shader.fragmentShader).toContain('waterHabitatAt');
    expect(shader.fragmentShader).toContain('livingSurfaceVeil');
    expect(shader.fragmentShader).toContain('bioRotateA');
    expect(shader.fragmentShader).not.toContain('vec4 habitat = habitatAt(vEcologyWaterWorld.xz)');
    disposeRenderer(renderer);
    ecology.dispose();
  });

  it('tracks newly flooded ground and leaves temporary wetness after recession without widening water', () => {
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

    // Geometry stays fixed at the canonical level; freeze transitions only change the material.
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
    const wetness = renderer.group.getObjectByName('receded-water-wetness') as THREE.Mesh | undefined;
    expect(wetness).toBeDefined();
    expect(wetness).toBeInstanceOf(THREE.Mesh);
    const ground = renderedGroundSampler(world);
    const wetPositions = wetness!.geometry.getAttribute('position');
    for (let i = 0; i < wetPositions.count; i++) {
      expect(wetPositions.getY(i) - ground(wetPositions.getX(i), wetPositions.getZ(i))).toBeCloseTo(0.0003, 5);
    }
    renderer.update(31);
    expect(renderer.group.getObjectByName('receded-water-wetness')).toBeUndefined();

    disposeRenderer(renderer);
  });
});
