import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR, type TreeFamily } from '../src/render/vegetation/TreeLibrary';

const DECIDUOUS: readonly TreeFamily[] = ['cherry', 'broadleaf', 'dry', 'riverbank', 'ancient'];

function geometryEnvelope(geometry: THREE.BufferGeometry): { radius: number; minY: number; maxY: number } {
  const position = geometry.getAttribute('position');
  let radius = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    radius = Math.max(radius, Math.hypot(x, z));
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { radius, minY, maxY };
}

describe('Tree library branch architecture', () => {
  it('keeps deciduous woody skeletons contained by the crown instead of producing antenna limbs', () => {
    const library = buildTreeLibrary('branch-containment', 6, TREE_LOD_NEAR);
    const allowedRadialOvershoot: Partial<Record<TreeFamily, number>> = {
      cherry: 1.12,
      broadleaf: 1.1,
      dry: 1.2,
      riverbank: 1.14,
      ancient: 1.18,
    };

    for (const family of DECIDUOUS) {
      for (const tree of library.get(family) ?? []) {
        const bark = geometryEnvelope(tree.bark);
        const foliage = geometryEnvelope(tree.foliage);
        expect(foliage.radius).toBeGreaterThan(0.1);
        expect(bark.radius).toBeLessThanOrEqual(foliage.radius * (allowedRadialOvershoot[family] ?? 1.2));
        expect(bark.maxY).toBeLessThanOrEqual(foliage.maxY + tree.height * 0.12);
      }
    }
  });

  it('keeps near and far tiers on the same deterministic tree silhouette contract', () => {
    const near = buildTreeLibrary('branch-lod-identity', 4, TREE_LOD_NEAR);
    const far = buildTreeLibrary('branch-lod-identity', 4, TREE_LOD_FAR);
    for (const family of near.keys()) {
      const nearVariants = near.get(family) ?? [];
      const farVariants = far.get(family) ?? [];
      expect(farVariants).toHaveLength(nearVariants.length);
      for (let index = 0; index < nearVariants.length; index += 1) {
        expect(farVariants[index]!.height).toBeCloseTo(nearVariants[index]!.height, 8);
        expect(farVariants[index]!.radius).toBeCloseTo(nearVariants[index]!.radius, 8);
      }
    }
  });

  it('keeps the detailed tree library within its explicit segment triangle budget', () => {
    const library = buildTreeLibrary('branch-budget', 5, TREE_LOD_NEAR);
    for (const variants of library.values()) {
      for (const tree of variants) {
        const barkTriangles = (tree.bark.getIndex()?.count ?? 0) / 3;
        expect(barkTriangles).toBeGreaterThan(0);
        // 44 segments * 5-sided tubes * 2 triangles per side is the absolute deciduous ceiling;
        // evergreen geometry stays comfortably below the same guardrail.
        expect(barkTriangles).toBeLessThanOrEqual(TREE_LOD_NEAR.maxSegments * TREE_LOD_NEAR.sides * 2 + 10);
      }
    }
  });
});
