import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater, WaterSystem } from '../src/render/terrain/WaterSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';

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
  for (let index = 0; index < field.height.length; index += 1) {
    const xIndex = index % field.resolution;
    const zIndex = Math.floor(index / field.resolution);
    const x = field.originX + xIndex * field.step;
    field.height[index] = ground;
    if (Math.abs(x) < field.step * 0.4) {
      const level = ground - 0.010 - zIndex * 0.00012;
      field.height[index] = level - 0.022;
      field.waterLevel[index] = level;
      field.river[index] = 1;
      field.flow[index] = 0.72 + Math.min(0.24, zIndex / field.resolution * 0.24);
      if (field.drainage) {
        field.drainage.downstream[index] = zIndex < field.resolution - 1 ? index + field.resolution : -1;
        field.drainage.accumulation[index] = 12 + zIndex * zIndex * 2;
      }
      if (zIndex === middleZ) field.fall[index] = 0.82;
    }
  }
  return world;
}

function shaderStub() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  };
}

describe('Water rendering foundation', () => {
  it('carries depth, downstream direction, river hierarchy and turbulence into the inland surface', () => {
    const world = waterWorld();
    const water = buildInlandWater(world)!;
    expect(water).toBeDefined();
    const positions = water.geometry.getAttribute('position');
    const depths = water.geometry.getAttribute('waterDepth');
    const flows = water.geometry.getAttribute('waterFlow');
    const directions = water.geometry.getAttribute('waterFlowDirection');
    const kinds = water.geometry.getAttribute('waterKind');
    const hierarchy = water.geometry.getAttribute('waterHierarchy');
    const rapids = water.geometry.getAttribute('waterRapid');
    for (const attribute of [depths, flows, directions, kinds, hierarchy, rapids]) expect(attribute.count).toBe(positions.count);
    expect(Array.from({ length: depths.count }, (_, index) => depths.getX(index)).some(depth => depth > 0)).toBe(true);
    expect(Array.from({ length: directions.count }, (_, index) => Math.hypot(directions.getX(index), directions.getY(index))).some(length => length > 0.9)).toBe(true);
    expect(Array.from({ length: kinds.count }, (_, index) => kinds.getX(index)).every(kind => kind === 1)).toBe(true);
    const hierarchyValues = Array.from({ length: hierarchy.count }, (_, index) => hierarchy.getX(index));
    expect(Math.max(...hierarchyValues)).toBeGreaterThan(Math.min(...hierarchyValues));
    expect(Array.from({ length: rapids.count }, (_, index) => rapids.getX(index)).some(rapid => rapid > 0.5)).toBe(true);

    const material = water.material as THREE.MeshPhysicalMaterial;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.clearcoat).toBeGreaterThan(0);

    const shader = shaderStub();
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('attribute vec2 waterFlowDirection');
    expect(shader.vertexShader).toContain('waterCurrentCoordinate');
    expect(shader.vertexShader).toContain('waterHierarchy');
    expect(shader.fragmentShader).toContain('waterRiverTint');
    expect(shader.fragmentShader).toContain('currentLane');
    expect(shader.fragmentShader).toContain('rapidCrest');

    water.geometry.dispose();
    material.dispose();
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

  it('animates shader time and rapid foam deterministically while keeping displacement presentation-only', () => {
    const world = waterWorld();
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'water-rendering-foundation');
    const ocean = renderer.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
    expect(ocean.geometry.getAttribute('position').count).toBeGreaterThan(4);
    const rapidFoam = renderer.group.getObjectByName('river-rapid-foam') as THREE.Points | undefined;
    expect(rapidFoam).toBeDefined();

    const shader = shaderStub();
    ocean.material.onBeforeCompile(shader as unknown as Parameters<typeof ocean.material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    renderer.update(12.5);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);
    const y = ocean.position.y;
    const rapidPositions = rapidFoam!.geometry.getAttribute('position');
    const firstRapid = rapidPositions.getZ(0);
    renderer.update(13.5);
    expect(rapidPositions.getZ(0)).not.toBe(firstRapid);
    renderer.update(12.5);
    expect(ocean.position.y).toBe(y);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);

    renderer.group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
  });
});
