import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { AERIAL_PERSPECTIVE_SHADER } from '../src/render/atmosphere/AerialPerspective';
import type {
  DistantLandformMetadata,
  DistantWorldMetadata,
  HorizonBackdropMetadata,
  HorizonRidgeMetadata,
} from '../src/render/terrain/DistantWorldRenderer';

describe('Distant world presentation', () => {
  it('adds asymmetric low-cost geography and layered partial horizons beyond the authoritative world', () => {
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
    expect(metadata.horizonLayerCount).toBe(3);
    expect(metadata.horizonVertices).toBeLessThan(500);

    const kinds = new Set<string>();
    let highest = Number.NEGATIVE_INFINITY;
    const landforms = distant!.children.filter((child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> => (
      child instanceof THREE.Mesh && child.userData['distantLandform'] !== undefined
    ));
    expect(landforms).toHaveLength(5);
    for (const mesh of landforms) {
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
            expect(position.getY(index)).toBeLessThan(surface.seaLevelY - 2.3);
          }
        }
      }
    }

    expect(kinds.has('mountain-chain')).toBe(true);
    expect(kinds.has('low-continent')).toBe(true);
    expect(kinds.has('island-highlands')).toBe(true);
    expect(highest).toBeGreaterThan(surface.seaLevelY + 5);

    const horizon = distant!.getObjectByName('horizon-backdrop') as THREE.Group | undefined;
    expect(horizon).toBeDefined();
    const horizonMetadata = horizon!.userData['horizonBackdrop'] as HorizonBackdropMetadata;
    expect(horizonMetadata.presentationOnly).toBe(true);
    expect(horizonMetadata.authoritative).toBe(false);
    expect(horizonMetadata.partialArcCoverage).toBe(true);
    expect(horizonMetadata.layerCount).toBe(3);
    expect(horizonMetadata.totalVertices).toBe(metadata.horizonVertices);
    expect(horizonMetadata.nearestRadius).toBeGreaterThan(metadata.canonicalSpan * 2.3);
    expect(horizonMetadata.farthestRadius).toBeGreaterThan(horizonMetadata.nearestRadius);

    let horizonPeak = Number.NEGATIVE_INFINITY;
    for (const child of horizon!.children) {
      expect(child).toBeInstanceOf(THREE.Mesh);
      const ridge = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const ridgeMetadata = ridge.userData['horizonRidge'] as HorizonRidgeMetadata;
      expect(ridgeMetadata.presentationOnly).toBe(true);
      expect(ridgeMetadata.authoritative).toBe(false);
      expect(ridge.castShadow).toBe(false);
      expect(ridge.receiveShadow).toBe(false);
      expect(ridge.material.fog).toBe(false);
      const position = ridge.geometry.getAttribute('position');
      expect(position.count).toBe(ridgeMetadata.samples * 2);
      expect(position.getY(0)).toBeLessThan(surface.seaLevelY - 0.9);
      expect(position.getY((ridgeMetadata.samples - 1) * 2)).toBeLessThan(surface.seaLevelY - 0.9);
      for (let sample = 0; sample < ridgeMetadata.samples; sample += 1) {
        horizonPeak = Math.max(horizonPeak, position.getY(sample * 2));
        expect(position.getY(sample * 2 + 1)).toBeLessThan(surface.seaLevelY - 5);
      }
    }
    expect(horizonPeak).toBeGreaterThan(surface.seaLevelY + 5);

    // Presentation geography must never rewrite canonical terrain/cell state.
    expect(Array.from(world.terrain.height)).toEqual(beforeTerrain);
    expect(world.cells.map((cell) => [cell.elevation, cell.water] as const)).toEqual(beforeCells);
  });

  it('keeps the extreme horizon optically compressed instead of exposing crisp remote geometry', () => {
    expect(AERIAL_PERSPECTIVE_SHADER.uniforms['uFarBlendStart']).toBeDefined();
    expect(AERIAL_PERSPECTIVE_SHADER.uniforms['uFarBlendEnd']).toBeDefined();
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('farBlend');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('horizonPath');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('uSkyFill');
  });

  it('is deterministic for the same generated world', () => {
    const world = generateWorld(configWith({ seed: 'distant-world-determinism', world: { size: 12 } }));
    const first = new TerrainSurface(world).buildApron().getObjectByName('distant-world') as THREE.Group;
    const second = new TerrainSurface(world).buildApron().getObjectByName('distant-world') as THREE.Group;

    const firstLandforms = first.children.filter((child) => child instanceof THREE.Mesh) as THREE.Mesh<THREE.BufferGeometry>[];
    const secondLandforms = second.children.filter((child) => child instanceof THREE.Mesh) as THREE.Mesh<THREE.BufferGeometry>[];
    expect(firstLandforms.length).toBe(secondLandforms.length);
    for (let index = 0; index < firstLandforms.length; index += 1) {
      const a = firstLandforms[index]!;
      const b = secondLandforms[index]!;
      expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
        Array.from(b.geometry.getAttribute('position').array),
      );
    }

    const firstHorizon = first.getObjectByName('horizon-backdrop') as THREE.Group;
    const secondHorizon = second.getObjectByName('horizon-backdrop') as THREE.Group;
    expect(firstHorizon.children.length).toBe(secondHorizon.children.length);
    for (let index = 0; index < firstHorizon.children.length; index += 1) {
      const a = firstHorizon.children[index] as THREE.Mesh<THREE.BufferGeometry>;
      const b = secondHorizon.children[index] as THREE.Mesh<THREE.BufferGeometry>;
      expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
        Array.from(b.geometry.getAttribute('position').array),
      );
    }
  });
});
