import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR, type TreeFamily } from '../src/render/vegetation/TreeLibrary';

const DECIDUOUS: readonly TreeFamily[] = ['cherry', 'broadleaf', 'dry', 'riverbank', 'ancient'];

function geometryEnvelope(geometry: THREE.BufferGeometry): {
  radius: number;
  minY: number;
  maxY: number;
  widthX: number;
  widthZ: number;
} {
  const position = geometry.getAttribute('position');
  let radius = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    radius = Math.max(radius, Math.hypot(x, z));
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { radius, minY, maxY, widthX: maxX - minX, widthZ: maxZ - minZ };
}

interface FoliageSiteMetric {
  span: number;
  aspect: number;
}

/** Every deciduous canopy site deliberately consumes 20 triangles, regardless of clump vs spray pair. */
function foliageSiteMetrics(geometry: THREE.BufferGeometry): FoliageSiteMetric[] {
  const position = geometry.getAttribute('position');
  const indices = geometry.getIndex();
  if (!indices) return [];
  const triangleCount = indices.count / 3;
  const siteCount = Math.round(triangleCount / 20);
  if (siteCount <= 0 || triangleCount !== siteCount * 20) return [];
  const metrics: FoliageSiteMetric[] = [];
  for (let site = 0; site < siteCount; site += 1) {
    const start = site * 20 * 3;
    const end = start + 20 * 3;
    let minX = Infinity; let maxX = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    let minZ = Infinity; let maxZ = -Infinity;
    for (let cursor = start; cursor < end; cursor += 1) {
      const vertex = indices.getX(cursor);
      minX = Math.min(minX, position.getX(vertex)); maxX = Math.max(maxX, position.getX(vertex));
      minY = Math.min(minY, position.getY(vertex)); maxY = Math.max(maxY, position.getY(vertex));
      minZ = Math.min(minZ, position.getZ(vertex)); maxZ = Math.max(maxZ, position.getZ(vertex));
    }
    const extents = [maxX - minX, maxY - minY, maxZ - minZ].sort((a, b) => a - b);
    metrics.push({
      span: extents[2]!,
      aspect: extents[2]! / Math.max(1e-6, extents[0]!),
    });
  }
  return metrics;
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

  it('builds fine-grained deciduous crowns instead of screen-sized equal foliage boulders', () => {
    const library = buildTreeLibrary('canopy-massing', 6, TREE_LOD_NEAR);
    for (const family of DECIDUOUS) {
      for (const tree of library.get(family) ?? []) {
        const metrics = foliageSiteMetrics(tree.foliage).sort((a, b) => a.span - b.span);
        expect(metrics.length).toBeGreaterThanOrEqual(6);
        const smallest = metrics[0]!.span;
        const largest = metrics.at(-1)!.span;
        expect(largest / Math.max(1e-6, smallest)).toBeGreaterThan(1.65);
        expect(largest).toBeLessThan(tree.height * 0.5);
        const smallSites = metrics.filter(metric => metric.span <= largest * 0.64).length;
        expect(smallSites).toBeGreaterThanOrEqual(Math.floor(metrics.length * 0.38));
        const elongatedSites = metrics.filter(metric => metric.aspect >= 1.28).length;
        expect(elongatedSites).toBeGreaterThanOrEqual(Math.floor(metrics.length * 0.25));
        expect((tree.foliage.getIndex()?.count ?? 0) / 3).toBeLessThanOrEqual(TREE_LOD_NEAR.maxClumps * 20);
      }
    }
  });

  it('gives seeded variants meaningfully different whole-crown silhouettes', () => {
    const library = buildTreeLibrary('crown-rhythm-diversity', 6, TREE_LOD_NEAR);
    for (const family of DECIDUOUS) {
      const envelopes = (library.get(family) ?? []).map(tree => geometryEnvelope(tree.foliage));
      expect(envelopes.length).toBeGreaterThanOrEqual(4);
      const widths = envelopes.map(envelope => Math.max(envelope.widthX, envelope.widthZ));
      const heights = envelopes.map(envelope => envelope.maxY - envelope.minY);
      const aspect = envelopes.map(envelope => envelope.widthX / Math.max(1e-6, envelope.widthZ));
      expect(Math.max(...widths) / Math.max(1e-6, Math.min(...widths))).toBeGreaterThan(1.08);
      expect(Math.max(...heights) / Math.max(1e-6, Math.min(...heights))).toBeGreaterThan(1.05);
      expect(Math.max(...aspect) - Math.min(...aspect)).toBeGreaterThan(0.08);
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
