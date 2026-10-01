import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation';
import { GODBOX_CONFIG } from '../godbox.config';
import { WaterSystem } from '../src/render/terrain/WaterSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';
import { auditWaterGeometry } from '../src/render/terrain/WaterGeometryAudit';

const seed = process.argv[2] ?? 'witness-the-saffron-river';
const label = process.argv[3] ?? 'before';
const simulation = new Simulation({ ...GODBOX_CONFIG, startMode: 'arrival', seed });
if (process.argv[4]) simulation.step(Number(process.argv[4]));
const world = simulation.state.world;
const surface = new TerrainSurface(world), ground = renderedGroundSampler(world), t = world.terrain;
const started = performance.now();
const system = new WaterSystem(world, surface, seed);
const buildMs = performance.now() - started;
const parts: unknown[] = [];
system.group.updateMatrixWorld(true);
const dump = (mesh: THREE.Mesh) => {
  const p = mesh.geometry.getAttribute('position'), c = mesh.geometry.getAttribute('color');
  const index = mesh.geometry.index, positions: number[] = [], colors: number[] = [];
  const v = new THREE.Vector3();
  let maxDepth = 0, maxExcess = 0, maxSlope = 0, invalid = 0;
  let worst: number[] = [];
  for (let i = 0; i < (index?.count ?? p.count); i++) {
    const j = index ? index.getX(i) : i;
    v.fromBufferAttribute(p, j).applyMatrix4(mesh.matrixWorld);
    positions.push(v.x, v.y, v.z); colors.push(c?.getX(j) ?? 0.2, c?.getY(j) ?? 0.5, c?.getZ(j) ?? 0.5);
    if (![v.x, v.y, v.z].every(Number.isFinite)) invalid++;
    const depth = v.y - ground(v.x, v.z);
    maxDepth = Math.max(maxDepth, depth);
    const ix = Math.floor((v.x - t.originX) / t.step), iz = Math.floor((v.z - t.originZ) / t.step);
    let authorityDepth = 0;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = Math.max(0, Math.min(t.resolution - 1, ix + dx!)), z = Math.max(0, Math.min(t.resolution - 1, iz + dz!));
      const k = z * t.resolution + x;
      if (t.waterLevel[k]! >= 0) authorityDepth = Math.max(authorityDepth, elevationToY(t.waterLevel[k]!, world.seaLevel) - elevationToY(t.height[k]!, world.seaLevel));
    }
    if (depth - authorityDepth > maxExcess) { maxExcess = depth - authorityDepth; worst = [v.x, v.y, v.z, depth, authorityDepth]; }
  }
  for (let i = 0; i < positions.length; i += 9) {
    const a = new THREE.Vector3(...positions.slice(i, i + 3) as [number, number, number]);
    const b = new THREE.Vector3(...positions.slice(i + 3, i + 6) as [number, number, number]).sub(a);
    const c = new THREE.Vector3(...positions.slice(i + 6, i + 9) as [number, number, number]).sub(a);
    const n = b.cross(c);
    if (Math.abs(n.y) > 1e-9) maxSlope = Math.max(maxSlope, Math.hypot(n.x, n.z) / Math.abs(n.y));
  }
  parts.push({ name: mesh.name, triangles: positions.length / 9, maxDepth, maxExcess, maxSlope, invalid, worst });
  return { name: mesh.name, p: positions, c: colors };
};
const meshes: ReturnType<typeof dump>[] = [];
system.group.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(dump(o)); });
const terrain = surface.buildMesh(seed);
terrain.updateMatrixWorld(true);
const terrainDump = dump(terrain);
const report = { seed, buildMs, parts: parts.slice(0, -1), audit: auditWaterGeometry(world, system.group) };
mkdirSync('node_modules/.tmp/water', { recursive: true });
writeFileSync(`node_modules/.tmp/water/${seed}-${label}.json`, JSON.stringify({ ...report, ground: terrainDump, meshes }));
console.log(JSON.stringify(report, null, 2));
