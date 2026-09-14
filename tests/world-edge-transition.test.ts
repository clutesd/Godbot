import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import type { WorldEdgeTransitionMetadata } from '../src/render/terrain/WorldEdgeTransition';

describe('World edge transition', () => {
  it('replaces the diorama wall with a presentation-only continuation that seals beneath the ocean', () => {
    const world = generateWorld(configWith({ seed: 'edge-transition-contract', world: { size: 12 } }));
    const beforeTerrain = Array.from(world.terrain.height);
    const beforeCells = world.cells.map((cell) => [cell.elevation, cell.water] as const);
    const surface = new TerrainSurface(world);
    const mesh = surface.buildApron();
    const metadata = mesh.userData['edgeTransition'] as WorldEdgeTransitionMetadata;

    expect(mesh.name).toBe('terrain-edge-transition');
    expect(mesh.castShadow).toBe(false);
    expect(metadata.presentationOnly).toBe(true);
    expect(metadata.authoritative).toBe(false);
    expect(metadata.transitionWidth).toBeGreaterThan(world.size * world.cellSize * 0.2);
    expect(metadata.radialSegments).toBeGreaterThanOrEqual(12);

    const position = mesh.geometry.getAttribute('position');
    const { originX, originZ, resolution, step } = world.terrain;
    const maxX = originX + (resolution - 1) * step;
    const maxZ = originZ + (resolution - 1) * step;

    // Ring zero must be the exact canonical perimeter. This is the no-seam contract.
    for (let index = 0; index < metadata.perimeterSamples; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const onBoundary = Math.abs(x - originX) < 1e-4
        || Math.abs(x - maxX) < 1e-4
        || Math.abs(z - originZ) < 1e-4
        || Math.abs(z - maxZ) < 1e-4;
      expect(onBoundary).toBe(true);
      expect(y).toBeCloseTo(surface.heightAt(x, z), 4);
    }

    // The final visual ring sits outside the simulation and below sea level, so it cannot expose a
    // second square edge beyond the continuation band.
    const outerStart = metadata.radialSegments * metadata.perimeterSamples;
    for (let index = outerStart; index < outerStart + metadata.perimeterSamples; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      expect(x < originX || x > maxX || z < originZ || z > maxZ).toBe(true);
      expect(y).toBeLessThan(surface.seaLevelY - 1.8);
    }

    // Constructing presentation geometry must not mutate simulation truth.
    expect(Array.from(world.terrain.height)).toEqual(beforeTerrain);
    expect(world.cells.map((cell) => [cell.elevation, cell.water] as const)).toEqual(beforeCells);
  });

  it('is deterministic for a generated world', () => {
    const world = generateWorld(configWith({ seed: 'edge-transition-determinism', world: { size: 12 } }));
    const first = new TerrainSurface(world).buildApron();
    const second = new TerrainSurface(world).buildApron();
    const firstPositions = Array.from(first.geometry.getAttribute('position').array);
    const secondPositions = Array.from(second.geometry.getAttribute('position').array);
    expect(firstPositions).toEqual(secondPositions);
  });
});
