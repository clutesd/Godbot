import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { TerrainDecor } from '../src/render/terrain/TerrainDecor';

function instancedSets(decor: TerrainDecor): THREE.InstancedMesh[] {
  return decor.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
}

/** An instance is hidden when its whole matrix has been collapsed to zero. */
function isHidden(array: ArrayLike<number>, index: number): boolean {
  for (let element = 0; element < 16; element += 1) if (array[index * 16 + element] !== 0) return false;
  return true;
}

describe('terrain decor clearance: props stay out of reserved structure and worksite ground', () => {
  const world = generateWorld(configWith({ seed: 'decor-clearance', world: { size: 16 } }));
  const surface = new TerrainSurface(world);
  const decor = new TerrainDecor(world, surface, 'decor-clearance', 1);

  it('scatters decor on the map before any reservation exists', () => {
    const visible = instancedSets(decor).reduce((total, mesh) => total + mesh.count, 0);
    expect(visible).toBeGreaterThan(0);
  });

  it('supplies every color source requested by the stone materials', () => {
    for (const mesh of instancedSets(decor)) {
      expect(mesh.instanceColor).not.toBeNull();
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(!material.vertexColors || mesh.geometry.hasAttribute('color')).toBe(true);
    }
  });

  it('hides every instance inside a reserved disc and leaves the rest untouched', () => {
    const sets = instancedSets(decor);
    const anchor = sets.find((mesh) => mesh.count > 20)!;
    const target = new THREE.Vector3();
    const m = new THREE.Matrix4();
    anchor.getMatrixAt(10, m);
    target.setFromMatrixPosition(m);
    const reserved = { x: target.x, z: target.z, radius: 6 };

    // Positions come from an untouched reference: a hidden instance's own matrix is zeroed.
    const reference = instancedSets(new TerrainDecor(world, surface, 'decor-clearance', 1));
    decor.setReservedGround([reserved]);

    let insideVisible = 0, outsideHidden = 0, inside = 0;
    sets.forEach((mesh, set) => {
      const array = mesh.instanceMatrix.array as Float32Array;
      const pristine = reference[set]!.instanceMatrix.array as Float32Array;
      for (let index = 0; index < mesh.count; index += 1) {
        const x = pristine[index * 16 + 12]!, z = pristine[index * 16 + 14]!;
        const isInside = Math.hypot(x - reserved.x, z - reserved.z) < reserved.radius + 0.25;
        const hidden = isHidden(array, index);
        if (isInside) inside += 1;
        if (isInside && !hidden) insideVisible += 1;
        if (!isInside && hidden) outsideHidden += 1;
      }
    });
    expect(inside).toBeGreaterThan(0);
    expect(insideVisible).toBe(0);
    expect(outsideHidden).toBe(0);
  });

  it('restores every instance exactly when the reservation is released', () => {
    // Same seed gives the same scatter, so a fresh decor is the untouched reference.
    const reference = instancedSets(new TerrainDecor(world, surface, 'decor-clearance', 1));
    decor.setReservedGround([]);
    const sets = instancedSets(decor);
    expect(sets.map((mesh) => mesh.count)).toEqual(reference.map((mesh) => mesh.count));
    sets.forEach((mesh, set) => {
      expect(Array.from((mesh.instanceMatrix.array as Float32Array).subarray(0, mesh.count * 16)))
        .toEqual(Array.from((reference[set]!.instanceMatrix.array as Float32Array).subarray(0, mesh.count * 16)));
    });
  });

  it('is idempotent: repeating the same reservation does not change the scatter', () => {
    const zone = { x: 0, z: 0, radius: 4 };
    decor.setReservedGround([zone]);
    const first = instancedSets(decor).map((mesh) => Array.from(mesh.instanceMatrix.array as Float32Array));
    decor.setReservedGround([zone]);
    const second = instancedSets(decor).map((mesh) => Array.from(mesh.instanceMatrix.array as Float32Array));
    expect(second).toEqual(first);
    decor.setReservedGround([]);
  });
});
