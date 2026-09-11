import { cellAt } from '../world';
import { nearestIndex, sampleField, type TerrainField } from '../terrain/TerrainField';
import { surfaceHeightAt, surfaceWaterAt } from '../terrain/SurfaceGeometry';
import type { Vec2, WorldCell, WorldState } from '../types';
import type { NetworkMode, RoutePoint } from './types';

export const gradeLimit = (mode: NetworkMode): number => mode === 'rail' ? 0.10 : 0.36;
export const pointKey = (p: Vec2): string => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;
export const edgeKey = (a: Vec2, b: Vec2, mode: NetworkMode): string => `${mode}:${[pointKey(a), pointKey(b)].sort().join('>')}`;
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.z - a.z);

/** Fine hydrology is authoritative at an exact point; coarse cell water flags are descriptive only. */
export function waterAt(world: WorldState, p: Vec2, cell: WorldCell | undefined = cellAt(world, p.x, p.z)): boolean {
  if (!cell) return true;
  const i = nearestIndex(world.terrain, p.x, p.z);
  return world.terrain.river[i] === 1 || world.terrain.lake[i] === 1
    || world.terrain.waterLevel[i]! >= 0 || sampleField(world.terrain, world.terrain.height, p.x, p.z) < world.seaLevel;
}

export function landAllowed(world: WorldState, p: Vec2, mode: NetworkMode | 'walk'): boolean {
  const cell = cellAt(world, p.x, p.z);
  if (!cell || waterAt(world, p, cell) || cell.landform === 'peak' || cell.landform === 'canyon') return false;
  const snow = world.weather?.cells[cell.z * world.size + cell.x]?.snowpack ?? 0;
  return cell.slope <= (mode === 'rail' ? 0.28 : mode === 'road' ? 0.45 : 0.54) && snow < (mode === 'rail' ? 1.45 : mode === 'road' ? 1.2 : 1);
}

export function snowTravelMultiplier(world: WorldState, point: Vec2, mode: NetworkMode | 'walk', maintenance = 0): number {
  if (mode === 'water') return 1;
  const cell = cellAt(world, point.x, point.z);
  const weather = cell ? world.weather?.cells[cell.z * world.size + cell.x] : undefined;
  if (!weather) return 1;
  const resistance = mode === 'rail' ? 0.45 : mode === 'road' ? 1.4 : 3;
  return 1 + (weather.snowpack * resistance + weather.blizzard * 0.8) * (1 - Math.min(0.7, Math.max(0, maintenance) * 0.7));
}

export function samplesBetween(world: WorldState, a: Vec2, b: Vec2): Vec2[] {
  const count = Math.max(1, Math.ceil(distance(a, b) / Math.min(0.35, world.terrain.step / 3)));
  return Array.from({ length: count + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / count, z: a.z + (b.z - a.z) * i / count }));
}

function fineSampleDry(field: TerrainField, seaLevel: number, cellX: number, cellZ: number): boolean {
  if (cellX < 0 || cellZ < 0 || cellX >= field.resolution || cellZ >= field.resolution) return false;
  const index = cellZ * field.resolution + cellX;
  return field.waterLevel[index]! < 0 && !field.river[index] && !field.lake[index] && field.height[index]! >= seaLevel;
}

/** Exact supercover over fine hydrology samples, including corner-touching channels. */
export function fineSegmentDry(world: WorldState, a: Vec2, b: Vec2): boolean {
  const field = world.terrain;
  const ax = (a.x - field.originX) / field.step;
  const az = (a.z - field.originZ) / field.step;
  const bx = (b.x - field.originX) / field.step;
  const bz = (b.z - field.originZ) / field.step;
  let x = Math.round(ax);
  let z = Math.round(az);
  const ex = Math.round(bx);
  const ez = Math.round(bz);
  const dx = bx - ax;
  const dz = bz - az;
  const sx = Math.sign(dx);
  const sz = Math.sign(dz);
  let tx = sx ? (x + sx * 0.5 - ax) / dx : Infinity;
  let tz = sz ? (z + sz * 0.5 - az) / dz : Infinity;
  if (!fineSampleDry(field, world.seaLevel, x, z)) return false;
  while (x !== ex || z !== ez) {
    if (tx < tz) { x += sx; tx += Math.abs(1 / dx); }
    else if (tz < tx) { z += sz; tz += Math.abs(1 / dz); }
    else {
      if (!fineSampleDry(field, world.seaLevel, x + sx, z) || !fineSampleDry(field, world.seaLevel, x, z + sz)) return false;
      x += sx; z += sz; tx += Math.abs(1 / dx); tz += Math.abs(1 / dz);
    }
    if (!fineSampleDry(field, world.seaLevel, x, z)) return false;
  }
  return true;
}

export interface SurveyedEdge { points: RoutePoint[]; kind: 'surface' | 'bridge' | 'shipping'; cost: number; length: number }

/** Survey geometry is retained as real infrastructure, including bank-to-bank bridge decks. */
export function surveyEdge(world: WorldState, a: Vec2, b: Vec2, mode: NetworkMode, bridge = false): SurveyedEdge | undefined {
  if (mode !== 'water' && (!landAllowed(world, a, mode) || !landAllowed(world, b, mode)
    || (!bridge && !fineSegmentDry(world, a, b)))) return undefined;
  const samples = samplesBetween(world, a, b);
  const wet = samples.map(p => waterAt(world, p));
  if (mode === 'water') {
    if (samples.some(p => !navigableAt(world, p))) return undefined;
    const points = samples.map(p => ({ ...p, y: surfaceWaterAt(world, p.x, p.z) }));
    if (points.some(p => !Number.isFinite(p.y))) return undefined;
    // No teleportation up waterfalls or between disconnected bodies of water.
    if (points.some((p, i) => i > 0 && Math.abs(p.y - points[i - 1]!.y) > 0.12)) return undefined;
    return { points, kind: 'shipping', cost: distance(a, b), length: distance(a, b) };
  }
  const crossing = wet.some(Boolean);
  if (!crossing && !fineSegmentDry(world, a, b)) return undefined;
  if (crossing && (!bridge || !landAllowed(world, a, mode) || !landAllowed(world, b, mode))) return undefined;
  if (!crossing && samples.some(p => !landAllowed(world, p, mode))) return undefined;
  if (!crossing) {
    const length = Math.max(0.00001, distance(a, b));
    const halfWidth = mode === 'rail' ? 0.425 : 0.31;
    const nx = -(b.z - a.z) / length * halfWidth;
    const nz = (b.x - a.x) / length * halfWidth;
    for (const side of [-1, 1]) {
      const left = { x: a.x + nx * side, z: a.z + nz * side };
      const right = { x: b.x + nx * side, z: b.z + nz * side };
      if (!fineSegmentDry(world, left, right) || samples.some(p => !landAllowed(world, { x: p.x + nx * side, z: p.z + nz * side }, mode))) return undefined;
    }
  }
  if (crossing) {
    // Short river bridges only. Lakes, ocean, flooded plains and multiple channels need later engineering.
    if (distance(a, b) > world.cellSize * 3.1) return undefined;
    let leftWater = false;
    let entered = false;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i]!;
      if (wet[i]) {
        if (leftWater) return undefined;
        entered = true;
        const index = nearestIndex(world.terrain, p.x, p.z);
        if (world.terrain.lake[index] || world.terrain.height[index]! < world.seaLevel || !world.terrain.river[index]) return undefined;
      } else if (entered) leftWater = true;
    }
  }
  const ay = surfaceHeightAt(world, a.x, a.z) + 0.04;
  const by = surfaceHeightAt(world, b.x, b.z) + 0.04;
  const points = samples.map((p, i) => ({ ...p, y: crossing ? ay + (by - ay) * i / (samples.length - 1) : surfaceHeightAt(world, p.x, p.z) + 0.04 }));
  let maxGrade = 0;
  let climbing = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (crossing && wet[i] && p.y < surfaceWaterAt(world, p.x, p.z) + 0.22) return undefined;
    if (crossing && !wet[i] && p.y < surfaceHeightAt(world, p.x, p.z) - 0.02) return undefined;
    if (i === 0) continue;
    const delta = Math.abs(p.y - points[i - 1]!.y);
    maxGrade = Math.max(maxGrade, delta / distance(p, points[i - 1]!));
    climbing += delta;
  }
  if (maxGrade > gradeLimit(mode)) return undefined;
  const cell = cellAt(world, b.x, b.z)!;
  const terrainCost = (cell.landform === 'ridge' ? 5 : cell.landform === 'hill' ? 1.5 : 0) + cell.rockiness * 1.5 + cell.slope * 3;
  const length = distance(a, b);
  const cost = length * (1 + maxGrade ** 2 * (mode === 'rail' ? 280 : 32) + terrainCost) + climbing * (mode === 'rail' ? 35 : 8);
  return { points, length, cost: cost * (crossing ? 7 : 1), kind: crossing ? 'bridge' : 'surface' };
}

export function navigableAt(world: WorldState, p: Vec2): boolean {
  if (!cellAt(world, p.x, p.z)) return false;
  const water = surfaceWaterAt(world, p.x, p.z);
  return Number.isFinite(water) && water - surfaceHeightAt(world, p.x, p.z) >= 0.06;
}

/** Stable binary heap, shared by terrain and completed-network searches. */
export class MinQueue {
  private values: { key: string; score: number }[] = [];
  get size(): number { return this.values.length; }
  push(key: string, score: number): void {
    const item = { key, score };
    let i = this.values.length;
    this.values.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(item, this.values[parent]!)) break;
      this.values[i] = this.values[parent]!;
      i = parent;
    }
    this.values[i] = item;
  }
  pop(): { key: string; score: number } | undefined {
    const first = this.values[0];
    const tail = this.values.pop();
    if (!first || !tail || !this.values.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.values.length) {
      const left = i * 2 + 1;
      const right = left + 1;
      const child = right < this.values.length && this.less(this.values[right]!, this.values[left]!) ? right : left;
      if (!this.less(this.values[child]!, tail)) break;
      this.values[i] = this.values[child]!;
      i = child;
    }
    this.values[i] = tail;
    return first;
  }
  private less(a: { key: string; score: number }, b: { key: string; score: number }): boolean {
    return a.score < b.score || (a.score === b.score && a.key < b.key);
  }
}
