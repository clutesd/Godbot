import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import type { StructurePlot } from '../src/sim/types';
import {
  advanceStructureFires,
  clearStructureFireRuntime,
  igniteStructureFire,
  structureFireScars,
  structureFireSnapshots,
} from '../src/sim/fire/StructureFireSystem';
import { StructureFireRenderer } from '../src/render/atmosphere/StructureFireRenderer';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';

function fireFixture(seed: string) {
  const simulation = new Simulation({ seed, startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] });
  const settlement = simulation.state.settlements[0]!;
  const plot: StructurePlot = {
    id: `${settlement.id}:fire-test`, worldX: settlement.position.x, worldZ: settlement.position.z,
    radius: 0.75, width: 1.4, height: 1.2, depth: 1.1, condition: 1, foundedMonth: 0,
  };
  settlement.structurePlots = [plot];
  const weather = simulation.state.weather.cells[settlement.cellIndex]!;
  weather.kind = 'clear';
  weather.precipitation = 'none';
  weather.intensity = 0;
  weather.wind = 0.25;
  weather.windX = 1;
  weather.windZ = 0;
  simulation.state.world.cells[settlement.cellIndex]!.moisture = 0.22;
  return { simulation, settlement, plot, weather };
}

describe('Structure fires', () => {
  it('turns an ignition into persistent structure damage and a visible burn scar', () => {
    const { simulation, settlement, plot } = fireFixture('structure-fire-damage');
    expect(igniteStructureFire(simulation.state, settlement.id, plot.id, 'sabotage', 0.82)).toBe(true);
    expect(structureFireSnapshots(simulation.state.world)[0]?.originCause).toBe('sabotage');
    simulation.state.month = 1;
    advanceStructureFires(simulation.state);
    expect(plot.condition).toBeLessThan(1);
    expect(plot.accessRestricted).toBe(true);
    expect(plot.damagedMonth).toBe(1);
    expect(structureFireScars(simulation.state.world)[0]?.severity).toBeGreaterThan(0.05);
    clearStructureFireRuntime(simulation.state.world);
  });

  it('lets authoritative flooding suppress an active structure fire', () => {
    const { simulation, settlement, plot } = fireFixture('structure-fire-water');
    plot.floodDepth = 0.3;
    expect(igniteStructureFire(simulation.state, settlement.id, plot.id, 'accident', 0.9)).toBe(true);
    simulation.state.month = 1;
    advanceStructureFires(simulation.state);
    expect(structureFireSnapshots(simulation.state.world)).toHaveLength(0);
    expect(structureFireScars(simulation.state.world)).toHaveLength(1);
    clearStructureFireRuntime(simulation.state.world);
  });

  it('renders flames, smoke, embers and firelight without mutating simulation state', () => {
    const { simulation, settlement, plot } = fireFixture('structure-fire-render');
    igniteStructureFire(simulation.state, settlement.id, plot.id, 'war', 0.95);
    const before = JSON.stringify(simulation.state);
    const renderer = new StructureFireRenderer(simulation.state.world, new TerrainSurface(simulation.state.world), simulation.state.seed);
    const camera = new THREE.PerspectiveCamera(55, 1.5, 0.1, 200);
    camera.position.set(plot.worldX + 8, 8, plot.worldZ + 8);
    camera.lookAt(plot.worldX, 0, plot.worldZ);
    renderer.update(1 / 60, 1.25, camera);
    const instances = renderer.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    const lights = renderer.group.children.filter((child): child is THREE.PointLight => child instanceof THREE.PointLight);
    const points = renderer.group.children.filter((child): child is THREE.Points => child instanceof THREE.Points);
    expect(instances.some((mesh) => mesh.count >= 7)).toBe(true);
    expect(points.some((mesh) => mesh.geometry.drawRange.count >= 10)).toBe(true);
    expect(lights.some((light) => light.visible && light.intensity > 0)).toBe(true);
    expect(JSON.stringify(simulation.state)).toBe(before);
    renderer.dispose();
    clearStructureFireRuntime(simulation.state.world);
  });
});
