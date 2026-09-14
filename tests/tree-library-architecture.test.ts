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

/** Deciduous foliage is a concatenation of detail-0 icosahedra: 20 triangles per canopy cluster. */
function foliageClusterSpans(geometry: THREE.BufferGeometry): number[] {
  const position = geometry.getAttribute('position');
  const triangleCount = (geometry.getIndex()?.count ?? position.count) / 3;
  const clusterCount = Math.round(triangleCount / 20);
  if (clusterCount <= 0 || triangleCount !== clusterCount * 20) return [];
  const verticesPerCluster = position.count / clusterCount;
  if (!Number.isInteger(verticesPerCluster)) return [];
  const spans: number[] = [];
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const start = cluster * verticesPerCluster;
    const end = start + verticesPerCluster;
    let minX = Infinity; let maxX = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    let minZ = Infinity; let maxZ = -Infinity;
    for (let index = start; index < end; index += 1) {
      minX = Math.min(minX, position.getX(index)); maxX = Math.max(maxX, position.getX(index));
      minY = Math.min(minY, position.getY(index)); maxY = Math.max(maxY, position.getY(index));
      minZ = Math.min(minZ, position.getZ(index)); maxZ = Math.max(maxZ, position.getZ(index));
    }
    spans.push(Math.max(maxX - minX, maxY - minY, maxZ - minZ));
  }
  return spans;
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

  it('builds deciduous crowns from multiple foliage scales instead of equal green boulders', () => {
    const library = buildTreeLibrary('canopy-massing', 6, TREE_LOD_NEAR);
    for (const family of DECIDUOUS) {
      for (const tree of library.get(family) ?? []) {
        const spans = foliageClusterSpans(tree.foliage).sort((a, b) => a - b);
        expect(spans.length).toBeGreaterThanOrEqual(6);
        const smallest = spans[0]!;
        const largest = spans.at(-1)!;
        expect(largest / Math.max(1e-6, smallest)).toBeGreaterThan(1.55);
        expect(largest).toBeLessThan(tree.height * 0.65);
        const smallClusters = spans.filter(span => span <= largest * 0.66).length;
        expect(smallClusters).toBeGreaterThanOrEqual(Math.floor(spans.length * 0.3));
        expect((tree.foliage.getIndex()?.count ?? 0) / 3).toBeLessThanOrEqual(TREE_LOD_NEAR.maxClumps * 20);
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
