import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { GODBOX_CONFIG } from '../godbox.config';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WaterSystem } from '../src/render/terrain/WaterSystem';

/**
 * Node supplies globals the browser does not. A stray `process` or `require` on a hot path throws
 * only once the page runs, so the world silently fails to generate while every other test passes.
 * Run the real startup path with those globals removed, the way the browser does.
 */
function withoutNodeGlobals<T>(run: () => T): T {
  const host = globalThis as Record<string, unknown>;
  const removed = ['process', 'require', 'global', '__dirname', '__filename']
    .filter(name => name in host)
    .map(name => [name, host[name]] as const);
  for (const [name] of removed) delete host[name];
  try {
    return run();
  } finally {
    for (const [name, value] of removed) host[name] = value;
  }
}

describe('the world starts in a browser', () => {
  it('generates and renders a configured observation without node globals', () => {
    const { world, water } = withoutNodeGlobals(() => {
      const simulation = new Simulation({ ...GODBOX_CONFIG, startMode: 'arrival', seed: 'browser-boot' });
      simulation.step(3);
      const state = simulation.state.world;
      const surface = new TerrainSurface(state);
      const ground = surface.buildMesh('browser-boot');
      const system = new WaterSystem(state, surface, 'browser-boot');
      system.update(1.5);
      system.syncHydrology();
      ground.geometry.dispose();
      return { world: state, water: system };
    });

    expect(world.terrain.height.length).toBeGreaterThan(0);
    expect(water.group.children.length).toBeGreaterThan(0);
    water.group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        const position = object.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 1) expect(Number.isFinite(position.getY(i))).toBe(true);
      }
    });
    water.dispose();
  });

  it('keeps restarting into fresh observations', () => {
    withoutNodeGlobals(() => {
      for (const seed of ['observation-a', 'observation-b', 'observation-c']) {
        const simulation = new Simulation({ ...GODBOX_CONFIG, startMode: 'arrival', seed });
        simulation.step(2);
        const state = simulation.state.world;
        const system = new WaterSystem(state, new TerrainSurface(state), seed);
        expect(system.group.children.length).toBeGreaterThan(0);
        system.dispose();
      }
    });
  });
});
