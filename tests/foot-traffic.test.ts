import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';
import { recordFootTrafficSegment } from '../src/sim/people/FootTraffic';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';

describe('movement-driven desire paths', () => {
  it('turns repeated real pedestrian movement into persistent visible track wear', () => {
    const simulation = new Simulation({ seed: 'desire-path-regression', startingPopulation: 36, settlementCount: [2, 2] });
    const world = simulation.state.world;
    const walking = new WalkabilityLayer(world);

    let pair: [typeof world.cells[number], typeof world.cells[number]] | undefined;
    for (const cell of world.cells) {
      if (!walking.isWalkable({ x: cell.worldX, z: cell.worldZ })) continue;
      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
      for (const [dx, dz] of neighbours) {
        const x = cell.x + dx;
        const z = cell.z + dz;
        if (x < 0 || z < 0 || x >= world.size || z >= world.size) continue;
        const neighbour = world.cells[z * world.size + x];
        if (!neighbour) continue;
        const from = { x: cell.worldX, z: cell.worldZ };
        const to = { x: neighbour.worldX, z: neighbour.worldZ };
        if (!walking.isSegmentWalkable(from, to)) continue;
        pair = [cell, neighbour];
        break;
      }
      if (pair) break;
    }

    expect(pair).toBeDefined();
    const [fromCell, toCell] = pair!;
    const from = { x: fromCell.worldX, z: fromCell.worldZ };
    const to = { x: toCell.worldX, z: toCell.worldZ };
    for (let pass = 0; pass < 80; pass += 1) {
      recordFootTrafficSegment(world, from, to, 24, 'settlement-test');
    }

    expect(fromCell.modifications?.track?.intensity).toBeGreaterThan(0.05);
    expect(toCell.modifications?.track?.intensity).toBeGreaterThan(0.05);
    expect(fromCell.modifications?.track?.firstMonth).toBe(24);
    expect(fromCell.modifications?.track?.lastMonth).toBe(24);

    const renderer = new ResourceSiteRenderer(world, new TerrainSurface(world));
    renderer.update();
    const paths = renderer.group.getObjectByName('Movement-worn desire paths');
    expect(paths).toBeInstanceOf(THREE.InstancedMesh);
    expect((paths as THREE.InstancedMesh).count).toBeGreaterThanOrEqual(2);
  });

  it('rejects teleport-scale jumps so emergency relocation cannot carve a road', () => {
    const simulation = new Simulation({ seed: 'desire-path-jump', startingPopulation: 24, settlementCount: [2, 2] });
    const world = simulation.state.world;
    const start = simulation.state.settlements[0]!.position;
    const before = world.cells.filter(cell => (cell.modifications?.track?.intensity ?? 0) > 0).length;
    recordFootTrafficSegment(world, start, { x: start.x + world.cellSize * 5, z: start.z }, 4, simulation.state.settlements[0]!.id);
    const after = world.cells.filter(cell => (cell.modifications?.track?.intensity ?? 0) > 0).length;
    expect(after).toBe(before);
  });
});
