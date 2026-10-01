import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import { renderedGroundSampler } from './WaterGround';
import { terrainTriangleAt } from '../../sim/terrain/TerrainTopology';

type Point = [number, number, number];
interface Face { p: [Point, Point, Point]; name: string }
export interface WaterGeometryAudit {
  meshes: Record<string, number>;
  invalidValues: number;
  duplicateFaces: number;
  stackedSamples: number;
  hangingEdges: number;
  interiorHoles: number;
  riverSamples: number;
  brokenRiverSamples: number;
  buriedSamples: number;
  extremeFaces: number;
  unsupportedPeaks: number;
  maxLocalRise: number;
  maxDepthExcess: number;
  maxSlope: number;
  maxAspect: number;
  shorelineSlivers: number;
  examples: string[];
}

/** Independent inspection of actual draw geometry, including children, indices and world
 * transforms. Deliberately does not call the water reconstruction or trust its depth attributes.
 * All surface meshes participate, irrespective of name, vertex count or waterfall classification. */
export function auditWaterGeometry(world: WorldState, group: THREE.Object3D): WaterGeometryAudit {
  const result: WaterGeometryAudit = { meshes: {}, invalidValues: 0, duplicateFaces: 0,
    stackedSamples: 0, hangingEdges: 0, interiorHoles: 0, riverSamples: 0, brokenRiverSamples: 0,
    buriedSamples: 0, extremeFaces: 0, unsupportedPeaks: 0, maxLocalRise: 0,
    maxDepthExcess: 0, maxSlope: 0, maxAspect: 0, shorelineSlivers: 0, examples: [] };
  const t = world.terrain, ground = renderedGroundSampler(world), faces: Face[] = [];
  const pointKey = (p: Point): string => p.join(':');
  const faceKeys = new Set<string>(), points = new Map<string, Point>();
  const edges = new Map<string, { count: number; a: Point; b: Point }>();
  const example = (label: string, p: Point): void => { if (result.examples.length < 12) result.examples.push(`${label}: ${p.map(v => v.toFixed(4)).join(',')}`); };
  group.updateWorldMatrix(true, true);
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
    const g = object.geometry as THREE.BufferGeometry, p = g.getAttribute('position'), v = new THREE.Vector3();
    if (!p) return;
    for (const attr of Object.values(g.attributes)) for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < attr.itemSize; c++) if (!Number.isFinite(attr.getComponent(i, c))) result.invalidValues++;
    }
    if (!(object instanceof THREE.Mesh) || object.name === 'receded-water-wetness') return;
    const n = g.index?.count ?? p.count;
    result.meshes[object.name || '(unnamed)'] = (result.meshes[object.name || '(unnamed)'] ?? 0) + n / 3;
    for (let i = 0; i < n; i += 3) {
      const ps = [0, 1, 2].map(k => {
        v.fromBufferAttribute(p, g.index ? g.index.getX(i + k) : i + k).applyMatrix4(object.matrixWorld);
        return v.toArray() as Point;
      }) as [Point, Point, Point];
      if (!ps.flat().every(Number.isFinite)) continue;
      const keys = ps.map(pointKey), fk = [...keys].sort().join('|');
      if (faceKeys.has(fk)) result.duplicateFaces++; else faceKeys.add(fk);
      for (let k = 0; k < 3; k++) {
        points.set(keys[k]!, ps[k]!);
        const j = (k + 1) % 3, ek = [keys[k]!, keys[j]!].sort().join('|');
        const edge = edges.get(ek);
        if (edge) edge.count++; else edges.set(ek, { count: 1, a: ps[k]!, b: ps[j]! });
      }
      faces.push({ p: ps, name: object.name });
    }
  });
  const inside = (p: Point): boolean => p[0] >= t.originX - 1e-5 && p[2] >= t.originZ - 1e-5
    && p[0] <= t.originX + (t.resolution - 1) * t.step + 1e-5
    && p[2] <= t.originZ + (t.resolution - 1) * t.step + 1e-5;
  const authorityDepth = (p: Point): number => {
    const { indices } = terrainTriangleAt(t, p[0], p[2]);
    let max = 0;
    for (const i of indices) if (t.waterLevel[i]! >= 0) max = Math.max(max,
      elevationToY(t.waterLevel[i]!, world.seaLevel) - ground(t.originX + i % t.resolution * t.step,
        t.originZ + Math.floor(i / t.resolution) * t.step));
    return max;
  };
  for (const p of points.values()) {
    if (!inside(p)) continue;
    const depth = p[1] - ground(p[0], p[2]), excess = depth - authorityDepth(p);
    if (depth < -2e-5) { result.buriedSamples++; example('buried', p); }
    result.maxDepthExcess = Math.max(result.maxDepthExcess, excess);
  }
  const atDomainEdge = (a: Point, b: Point): boolean => [0, 2].some(axis => {
    const min = axis === 0 ? t.originX : t.originZ, max = min + (t.resolution - 1) * t.step;
    return [min, max].some(bound => Math.abs(a[axis]! - bound) < 1e-5 && Math.abs(b[axis]! - bound) < 1e-5);
  });
  for (const edge of edges.values()) {
    if (edge.count !== 1 || !inside(edge.a) || !inside(edge.b)) continue;
    // The external ocean ring has long edges against subdivided domain edges; its plane is equal.
    if (atDomainEdge(edge.a, edge.b) && Math.max(edge.a[1], edge.b[1]) < 0.0003) continue;
    if (Math.max(...[edge.a, edge.b].map(p => p[1] - ground(p[0], p[2]))) > 0.0003) {
      result.hangingEdges++; example('hanging edge', edge.a);
    }
  }
  const cells = new Map<string, number[]>(), cell = t.step;
  const cellKey = (x: number, z: number): string => `${x}:${z}`;
  for (const [index, face] of faces.entries()) {
    const [a, b, c] = face.p;
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const normal = ab.clone().cross(ac);
    const longest = Math.max(ab.lengthSq(), ac.lengthSq(), ab.clone().sub(ac).lengthSq());
    const aspect = longest / Math.max(1e-20, normal.length());
    const slope = Math.hypot(normal.x, normal.z) / Math.max(1e-20, Math.abs(normal.y));
    result.maxAspect = Math.max(result.maxAspect, aspect);
    if (inside(a) && inside(b) && inside(c)) {
      result.maxSlope = Math.max(result.maxSlope, slope);
      // Thin shoreline slivers are unavoidable exact intersections. They must still lie on a
      // sensible plane: aspect alone may not authorize throwing away shoreline coverage.
      const shore = face.p.some(p => p[1] - ground(p[0], p[2]) < 0.0003);
      if (aspect > 1e4 && shore) result.shorelineSlivers++;
      if (slope > 5 || (aspect > 1e4 && !shore)) {
        result.extremeFaces++; example('extreme face', a);
      }
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]) {
        const p = [0, 1, 2].map(axis => face.p.reduce((sum, v, k) => sum + v[axis]! * weights[k]!, 0)) as Point;
        if (p[1] - ground(p[0], p[2]) < -2e-5) result.buriedSamples++;
        result.maxDepthExcess = Math.max(result.maxDepthExcess, p[1] - ground(p[0], p[2]) - authorityDepth(p));
      }
    }
    // The ocean's external ring is outside the authoritative domain and needs no search buckets.
    if (!inside(a) && !inside(b) && !inside(c)) continue;
    const minX = Math.max(t.originX, Math.min(a[0], b[0], c[0])), maxX = Math.min(t.originX + (t.resolution - 1) * t.step, Math.max(a[0], b[0], c[0]));
    const minZ = Math.max(t.originZ, Math.min(a[2], b[2], c[2])), maxZ = Math.min(t.originZ + (t.resolution - 1) * t.step, Math.max(a[2], b[2], c[2]));
    for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++) for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
      const key = cellKey(x, z); if (!cells.has(key)) cells.set(key, []); cells.get(key)!.push(index);
    }
  }
  const levelsAt = (x: number, z: number): number[] => {
    const levels: number[] = [];
    for (const index of cells.get(cellKey(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
      const [a, b, c] = faces[index]!.p;
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-14) continue;
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      if (u < -1e-5 || v < -1e-5 || 1 - u - v < -1e-5) continue;
      const y = a[1] * u + b[1] * v + c[1] * (1 - u - v);
      if (!levels.some(level => Math.abs(level - y) < 1e-5)) levels.push(y);
    }
    return levels;
  };
  for (let i = 0; i < t.height.length; i++) {
    if (t.waterLevel[i]! < 0) continue;
    const x = t.originX + i % t.resolution * cell, z = t.originZ + Math.floor(i / t.resolution) * cell;
    const level = elevationToY(t.waterLevel[i]!, world.seaLevel);
    const samples = levelsAt(x, z);
    if (samples.length > 1) result.stackedSamples++;
    if (level - ground(x, z) > 0.001 && !samples.length) { result.interiorHoles++; example('wet sample hole', [x, level, z]); }
    const next = t.drainage?.downstream[i] ?? -1;
    if (!t.river[i] || next < 0 || t.waterLevel[next]! < 0) continue;
    const nx = t.originX + next % t.resolution * cell, nz = t.originZ + Math.floor(next / t.resolution) * cell;
    for (const fraction of [0.125, 0.25, 0.5, 0.75, 0.875]) {
      const px = x + (nx - x) * fraction, pz = z + (nz - z) * fraction;
      const expected = level + (elevationToY(t.waterLevel[next]!, world.seaLevel) - level) * fraction;
      result.riverSamples++;
      const levels = levelsAt(px, pz);
      if (!levels.some(y => Math.abs(y - expected) < 0.0003)) { result.brokenRiverSamples++; example('broken river', [px, expected, pz]); }
      if (levels.length > 1) result.stackedSamples++;
    }
  }
  // Query the actual triangles at a ring, not just their vertices: a coarsely tessellated surface
  // still counts as surrounding water. Only an unsupported rise is a peak, not a river headwater.
  for (const p of points.values()) {
    if (!inside(p) || p[1] < 0.0003) continue;
    const around: number[] = [];
    for (let angle = 0; angle < 8; angle++) around.push(...levelsAt(p[0] + Math.cos(angle * Math.PI / 4) * cell, p[2] + Math.sin(angle * Math.PI / 4) * cell));
    if (around.length < 4) continue;
    const rise = p[1] - Math.max(...around);
    result.maxLocalRise = Math.max(result.maxLocalRise, rise);
    if (rise > 0.45 && p[1] - ground(p[0], p[2]) - authorityDepth(p) > 0.001) {
      result.unsupportedPeaks++; example('unsupported peak', p);
    }
  }
  return result;
}
