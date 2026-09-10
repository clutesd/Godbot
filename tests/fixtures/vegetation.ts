import * as THREE from 'three';
import { Simulation } from '../../src/sim/Simulation';
import { TerrainSurface } from '../../src/render/terrain/TerrainSurface';

/** Controlled temperate meadow: real terrain/renderer APIs, with no random coastline or snow. */
export function vegetationFixture(seed = 'vegetation-acceptance') {
  const simulation = new Simulation({ seed, startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
  const world = simulation.state.world;
  world.terrain.height.fill(world.seaLevel + 0.1);
  world.terrain.waterLevel.fill(-1);
  world.terrain.flow.fill(0);
  world.terrain.rock.fill(0);
  for (const cell of world.cells) {
    Object.assign(cell, { water: false, river: false, lake: false, wood: 0.8, moisture: 0.6, temperature: 0.46,
      elevation: world.seaLevel + 0.1, slope: 0 });
  }
  for (const cell of world.weather!.cells) Object.assign(cell, { temperature: 0.6, snowpack: 0, treeDamage: 0 });
  world.weather!.month = 5;
  const surface = new TerrainSurface(world);
  const camera = new THREE.Vector3(0, 6, 10);
  return { simulation, world, surface, camera };
}

export function disposeVegetation(group: THREE.Group): void {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
    if (object instanceof THREE.InstancedMesh) object.dispose();
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
}

export function instanceMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  group.traverse(object => { if (object instanceof THREE.InstancedMesh) meshes.push(object); });
  return meshes;
}
