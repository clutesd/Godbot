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
  for (let index = 0; index < field.height.length; index += 1) {
    const x = field.originX + index % field.resolution * field.step;
    field.height[index] = ground;
    if (Math.abs(x) < field.step * 0.4) {
      field.height[index] = ground - 0.03;
      field.waterLevel[index] = ground - 0.012;
      field.river[index] = 1;
      field.flow[index] = 0.75;
    }
  }
  return world;
}

function shaderStub() {
  return {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe('Water rendering foundation', () => {
  it('carries authoritative depth and flow into the inland surface without enabling transparency', () => {
    const world = waterWorld();
    const water = buildInlandWater(world)!;
    expect(water).toBeDefined();
    const positions = water.geometry.getAttribute('position');
    const depths = water.geometry.getAttribute('waterDepth');
    const flows = water.geometry.getAttribute('waterFlow');
    expect(depths.count).toBe(positions.count);
    expect(flows.count).toBe(positions.count);
    expect(Array.from({ length: depths.count }, (_, index) => depths.getX(index)).some(depth => depth > 0)).toBe(true);

    const material = water.material as THREE.MeshPhysicalMaterial;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.clearcoat).toBeGreaterThan(0);

    const shader = shaderStub();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('attribute float waterDepth');
    expect(shader.vertexShader).toContain('waterShoreDamping');
    expect(shader.fragmentShader).toContain('waterShallowTint');
    expect(shader.fragmentShader).toContain('waterDeepTint');

    water.geometry.dispose();
    material.dispose();
  });

  it('animates shader time deterministically while keeping ocean displacement presentation-only', () => {
    const world = waterWorld();
    const renderer = new WaterSystem(world, new TerrainSurface(world), 'water-rendering-foundation');
    const ocean = renderer.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
    expect(ocean.geometry.getAttribute('position').count).toBeGreaterThan(4);

    const shader = shaderStub();
    ocean.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    renderer.update(12.5);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);
    const y = ocean.position.y;
    renderer.update(12.5);
    expect(ocean.position.y).toBe(y);
    expect(shader.uniforms['waterTime']!.value).toBe(12.5);

    renderer.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      } else if (object instanceof THREE.Points) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  });
});
