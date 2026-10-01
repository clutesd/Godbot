import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater, WaterSystem } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { auditWaterGeometry } from '../src/render/terrain/WaterGeometryAudit';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { elevationToY, surfaceHeightAt } from '../src/sim/terrain/SurfaceGeometry';

const OCEAN_COVER_Y = 0.06;

/** Open edges of the whole water body (surface plus skirt) that do not rest on the terrain. */
function hangingEdges(water: THREE.Mesh, ground: (x: number, z: number) => number): number {
  const meshes = [water, ...water.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)];
  const edges = new Map<string, { count: number; hang: number }>();
  const key = (p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
    `${Math.round(p.getX(i) * 1e4)}:${Math.round(p.getY(i) * 1e4)}:${Math.round(p.getZ(i) * 1e4)}`;
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position');
    for (let start = 0; start < p.count; start += 3) for (let corner = 0; corner < 3; corner++) {
      const a = start + corner, b = start + (corner + 1) % 3;
      const [ka, kb] = [key(p, a), key(p, b)];
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      // An edge ending at sea level lies under the ocean plane, which closes it.
      const hang = Math.max(p.getY(a), p.getY(b)) < OCEAN_COVER_Y ? 0
        : Math.max(p.getY(a) - ground(p.getX(a), p.getZ(a)), p.getY(b) - ground(p.getX(b), p.getZ(b)));
      const edge = edges.get(id);
      if (edge) edge.count++; else edges.set(id, { count: 1, hang });
    }
  }
  return [...edges.values()].filter(edge => edge.count === 1 && edge.hang > 0.002).length;
}

describe('inland water is closed against the terrain', () => {
  it('ends a reconstructed channel on terrain without manufacturing vertical skirts', () => {
    const world = new Simulation({ seed: 'perched-river', startingPopulation: 12, world: { size: 12 }, settlementCount: [1, 1] }).state.world;
    const t = world.terrain;
    t.waterLevel.fill(-1); t.river.fill(0); t.lake.fill(0); t.fall.fill(0);
    const column = Math.floor(t.resolution / 2);
    for (let z = 0; z < t.resolution; z++) for (let x = 0; x < t.resolution; x++) {
      const index = z * t.resolution + x;
      // A one-sample river running down a side slope: the downhill bank is far below the water.
      t.height[index] = world.seaLevel + 0.2 - x * 0.008;
      if (x === column && z > 2 && z < t.resolution - 3) { t.river[index] = 1; t.waterLevel[index] = t.height[index]! + 0.004; t.flow[index] = 0.6; }
    }
    const water = buildInlandWater(world)!;
    expect(water.getObjectByName('inland-water-skirt')).toBeUndefined();
    expect(hangingEdges(water, renderedGroundSampler(world))).toBe(0);
    water.geometry.dispose();
  });

  it('leaves no hanging water edge in the generated home world', () => {
    const world = new Simulation({ seed: 'witness-the-saffron-river', startingPopulation: 40,
      world: { size: 52, cellSize: 2.25, seaLevel: 0.34, mountainLevel: 0.72, noiseScale: 0.075 }, settlementCount: [2, 3] }).state.world;
    const water = buildInlandWater(world)!;
    expect(hangingEdges(water, renderedGroundSampler(world))).toBe(0);
    water.geometry.dispose();
    for (const child of water.children) (child as THREE.Mesh).geometry.dispose();
  });

  it('keeps surface grain off river and lake beds so water never speckles with dry ground', () => {
    const world = new Simulation({ seed: 'witness-the-saffron-river', startingPopulation: 20,
      world: { size: 40, cellSize: 2.25, seaLevel: 0.34 }, settlementCount: [2, 2] }).state.world;
    const t = world.terrain;
    let checked = 0;
    for (let index = 0; index < t.height.length; index++) {
      if (!(t.river[index] || t.lake[index]) || t.waterLevel[index]! < 0 || t.height[index]! < world.seaLevel) continue;
      const x = t.originX + index % t.resolution * t.step, z = t.originZ + Math.floor(index / t.resolution) * t.step;
      expect(surfaceHeightAt(world, x, z)).toBeLessThanOrEqual(elevationToY(t.waterLevel[index]!, world.seaLevel) + 1e-6);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  /** Height of the water surface over a point, or undefined where no water triangle covers it. */
  function surfaceAt(water: THREE.Mesh, x: number, z: number): number | undefined {
    const p = water.geometry.getAttribute('position');
    for (let f = 0; f < p.count; f += 3) {
      const [ax, az, bx, bz, cx, cz] = [0, 1, 2].flatMap(k => [p.getX(f + k), p.getZ(f + k)]) as [number, number, number, number, number, number];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6) return l1 * p.getY(f) + l2 * p.getY(f + 1) + (1 - l1 - l2) * p.getY(f + 2);
    }
    return undefined;
  }

  function lakeWorld(seed: string) {
    const world = new Simulation({ seed, startingPopulation: 12, world: { size: 12 }, settlementCount: [1, 1] }).state.world;
    const t = world.terrain;
    t.height.fill(world.seaLevel + 0.02); t.waterLevel.fill(world.seaLevel + 0.10);
    t.lake.fill(1); t.river.fill(0); t.fall.fill(0);
    return { world, t, centre: Math.floor(t.resolution / 2) * t.resolution + Math.floor(t.resolution / 2) };
  }
  const centreOf = (t: { originX: number; originZ: number; step: number; resolution: number }, index: number): [number, number] =>
    [t.originX + index % t.resolution * t.step, t.originZ + Math.floor(index / t.resolution) * t.step];

  it('preserves supplied lake levels and dry samples instead of repairing hydrology in the renderer', () => {
    const { world, t, centre } = lakeWorld('lake-holes');
    const pit = centre, seam = centre + 6, island = centre - 6;
    t.height[pit] = world.seaLevel - 0.02; t.waterLevel[pit] = world.seaLevel; t.lake[pit] = 0;
    t.height[seam] = world.seaLevel + 0.02; t.waterLevel[seam] = -1; t.lake[seam] = 0;
    t.height[island] = world.seaLevel + 0.16; t.waterLevel[island] = -1; t.lake[island] = 0;
    const water = buildInlandWater(world)!;
    // This deliberately inconsistent fixture must not be silently changed by rendering.
    // Generated basin classification is tested at the hydrology source in water-whole-group.
    expect(surfaceAt(water, ...centreOf(t, pit))).toBeCloseTo(0, 3);
    expect(surfaceAt(water, ...centreOf(t, seam))).toBeUndefined();
    expect(surfaceAt(water, ...centreOf(t, island))).toBeUndefined();
    water.geometry.dispose();
  });

  it('turns a lake that ends at the ocean into a cascade instead of a wall', () => {
    const { world, t } = lakeWorld('lake-outflow');
    const edge = Math.floor(t.resolution / 2);
    for (let z = 0; z < t.resolution; z++) for (let x = edge; x < t.resolution; x++) {
      const index = z * t.resolution + x;
      t.height[index] = world.seaLevel - 0.05; t.waterLevel[index] = world.seaLevel; t.lake[index] = 0;
    }
    const water = buildInlandWater(world)!;
    const boundaryX = t.originX + edge * t.step;
    const p = water.geometry.getAttribute('position');
    let lowest = Infinity, steepest = 0;
    const rapid = water.geometry.getAttribute('waterRapid');
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getX(i) - boundaryX) < t.step * 1.5) lowest = Math.min(lowest, p.getY(i));
      steepest = Math.max(steepest, rapid.getX(i));
    }
    // The surface descends to the sea across the shoreline, and the descent breaks white.
    expect(lowest).toBeLessThan(0.1);
    expect(steepest).toBeGreaterThan(0.3);
    for (const child of water.children) {
      const c = (child as THREE.Mesh).geometry.getAttribute('position');
      for (let i = 0; i < c.count; i += 3) {
        const x = (c.getX(i) + c.getX(i + 1) + c.getX(i + 2)) / 3;
        const z = (c.getZ(i) + c.getZ(i + 1) + c.getZ(i + 2)) / 3;
        // Only the shoreline itself: the fixture's own map border is a plain cliff.
        if (Math.abs(x - boundaryX) > t.step * 3 || Math.abs(z) > t.step * 10) continue;
        expect(Math.max(c.getY(i), c.getY(i + 1), c.getY(i + 2)) - Math.min(c.getY(i), c.getY(i + 1), c.getY(i + 2))).toBeLessThan(0.3);
      }
    }
    water.geometry.dispose();
  });

  /**
   * The eye catches a spike of water long before it catches a hole. Nothing may stand meaningfully
   * above the surface hydrology gave it: a lifted vertex reads as a cone or a slab hanging over
   * open water, which is far more obvious than any gap.
   */
  it('never stands water above the hydrology surface it represents', () => {
    for (const seed of ['world-8we87g1lgnchc', 'world-ggg777', 'spike-guard']) {
      const world = new Simulation({ seed, startingPopulation: 40,
        world: { size: 48, cellSize: 2.25, seaLevel: 0.34, mountainLevel: 0.72 }, settlementCount: [2, 3] }).state.world;
      const t = world.terrain;
      const water = buildInlandWater(world);
      if (!water) continue;
      const p = water.geometry.getAttribute('position');
      let worst = 0;
      let worstAt = '';
      for (let i = 0; i < p.count; i += 1) {
        const x = p.getX(i), z = p.getZ(i);
        const ix = Math.round((x - t.originX) / t.step), iz = Math.round((z - t.originZ) / t.step);
        // The highest surface any sample that could own this point actually carries.
        let highest = -Infinity;
        for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= t.resolution || jz >= t.resolution) continue;
          const level = t.waterLevel[jz * t.resolution + jx]!;
          if (level >= 0) highest = Math.max(highest, elevationToY(level, world.seaLevel));
        }
        if (!Number.isFinite(highest)) continue;
        const excess = p.getY(i) - highest;
        if (excess > worst) { worst = excess; worstAt = `${seed} (${x.toFixed(2)},${p.getY(i).toFixed(2)},${z.toFixed(2)}) over ${highest.toFixed(2)}`; }
      }
      expect(worst, worstAt).toBeLessThan(0.25);
      water.geometry.dispose();
      for (const child of water.children) (child as THREE.Mesh).geometry.dispose();
    }
  });

  /**
   * A cone of water reads instantly, and comparing against hydrology cannot see one: the sample
   * lending the height may legitimately sit that high. Judge the water against itself instead —
   * nothing may stand above the water in every direction around it. A steep stream is high only
   * against its downhill side, so it passes; a spike is high against all of them.
   */
  it('stands no cone of water above the water around it', () => {
    for (const seed of ['cone-guard', 'cone-guard-2']) {
      const world = new Simulation({ seed, startingPopulation: 40,
        world: { size: 48, cellSize: 2.25, seaLevel: 0.34, mountainLevel: 0.72 }, settlementCount: [2, 3] }).state.world;
      const system = new WaterSystem(world, new TerrainSurface(world), seed);
      // Sample triangle interiors around each point. Vertex-only rings miss coarse water
      // surfaces and formerly skipped precisely the large meshes this test should protect.
      const audit = auditWaterGeometry(world, system.group);
      expect(audit.maxLocalRise, JSON.stringify(audit)).toBeLessThan(0.45);
      expect(audit.unsupportedPeaks).toBe(0);
      system.dispose();
    }
  });
});
