import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import type {
  DistantLandformMetadata,
  DistantWorldMetadata,
} from '../src/render/terrain/DistantWorldRenderer';

describe('Distant world presentation', () => {
  it('adds asymmetric low-cost geography beyond the authoritative world', () => {
    const world = generateWorld(configWith({ seed: 'distant-world-contract', world: { size: 12 } }));
    const beforeTerrain = Array.from(world.terrain.height);
    const beforeCells = world.cells.map((cell) => [cell.elevation, cell.water] as const);
    const surface = new TerrainSurface(world);
    const edge = surface.buildApron();
    const distant = edge.getObjectByName('distant-world') as THREE.Group | undefined;

    expect(distant).toBeDefined();
    const metadata = distant!.userData['distantWorld'] as DistantWorldMetadata;
    expect(metadata.presentationOnly).toBe(true);
    expect(metadata.authoritative).toBe(false);
    expect(metadata.asymmetric).toBe(true);
    expect(metadata.landformCount).toBe(5);
    expect(metadata.totalVertices).toBeLessThan(4000);
    expect(metadata.nearestCenterDistance).toBeGreaterThan(metadata.canonicalSpan * 1.4);
    expect(metadata.farthestCenterDistance).toBeGreaterThan(metadata.nearestCenterDistance);

    const kinds = new Set<string>();
    let highest = Number.NEGATIVE_INFINITY;
    for (const child of distant!.children) {
      expect(child).toBeInstanceOf(THREE.Mesh);
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const landform = mesh.userData['distantLandform'] as DistantLandformMetadata;
      kinds.add(landform.kind);
      expect(landform.presentationOnly).toBe(true);
      expect(landform.authoritative).toBe(false);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(landform.centerDistance).toBeGreaterThan(metadata.canonicalSpan * 1.4);

      const position = mesh.geometry.getAttribute('position');
      const grid = Math.round(Math.sqrt(position.count));
      expect(grid * grid).toBe(position.count);
      for (let z = 0; z < grid; z += 1) {
        for (let x = 0; x < grid; x += 1) {
          const index = z * grid + x;
          highest = Math.max(highest, position.getY(index));
          if (x === 0 || z === 0 || x === grid - 1 || z === grid - 1) {
            // Every rectangular patch boundary is buried beneath the ocean, so no patch outline can
            // become the next visible edge of the world.
            expect(position.getY(index)).toBeLessThan(surface.seaLevelY - 2.3);
          }
        }
      }
    }

    expect(kinds.has('mountain-chain')).toBe(true);
    expect(kinds.has('low-continent')).toBe(true);
    expect(kinds.has('island-highlands')).toBe(true);
    expect(highest).toBeGreaterThan(surface.seaLevelY + 5);

    // Presentation geography must never rewrite canonical terrain/cell state.
    expect(Array.from(world.terrain.height)).toEqual(beforeTerrain);
    expect(world.cells.map((cell) => [cell.elevation, cell.water] as const)).toEqual(beforeCells);
  });

  it('is deterministic for the same generated world', () => {
    const world = generateWorld(configWith({ seed: 'distant-world-determinism', world: { size: 12 } }));
    const first = new TerrainSurface(world).buildApron().getObjectByName('distant-world') as THREE.Group;
    const second = new TerrainSurface(world).buildApron().getObjectByName('distant-world') as THREE.Group;

    expect(first.children.length).toBe(second.children.length);
    for (let index = 0; index < first.children.length; index += 1) {
      const a = first.children[index] as THREE.Mesh<THREE.BufferGeometry>;
      const b = second.children[index] as THREE.Mesh<THREE.BufferGeometry>;
      expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
        Array.from(b.geometry.getAttribute('position').array),
      );
    }
  });
});
