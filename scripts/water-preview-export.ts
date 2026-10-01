import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation';
import { GODBOX_CONFIG } from '../godbox.config';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundColorSampler } from '../src/render/terrain/WaterGround';
import type * as THREE from 'three';

/** Offline geometry export of the real terrain + inland water meshes for software rasterisation. */
const seed = process.argv[2] ?? GODBOX_CONFIG.seed!;
const world = new Simulation({ ...GODBOX_CONFIG, startMode: 'arrival', seed }).state.world;
const surface = new TerrainSurface(world);
const ground = surface.buildMesh(seed);
const water = buildInlandWater(world, undefined, undefined, renderedGroundColorSampler(world, surface, seed))!;
const dump = (mesh: THREE.Mesh) => {
  const g = mesh.geometry; const p = g.getAttribute('position'); const c = g.getAttribute('color');
  const idx = g.index; const out = { p: [] as number[], c: [] as number[] };
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i++) { const v = idx ? idx.getX(i) : i; out.p.push(+p.getX(v).toFixed(4), +p.getY(v).toFixed(4), +p.getZ(v).toFixed(4)); out.c.push(c ? +c.getX(v).toFixed(3) : 0.5, c ? +c.getY(v).toFixed(3) : 0.5, c ? +c.getZ(v).toFixed(3) : 0.5); }
  return out;
};
const skirt = water.children[0] as THREE.Mesh | undefined;
// Aim the preview camera at the busiest wall in the map: whatever still needs closing shows there.
const wall = skirt?.geometry.getAttribute('position');
const patches = new Map<string, number>();
if (wall) for (let i = 0; i < wall.count; i += 6) {
  const key = `${Math.floor(wall.getX(i) / 8)}:${Math.floor(wall.getZ(i) / 8)}`;
  patches.set(key, (patches.get(key) ?? 0) + Math.abs(wall.getY(i) - wall.getY(i + 1)));
}
let busiest = '0:0';
for (const [key, height] of patches) if (height > (patches.get(busiest) ?? 0)) busiest = key;
const [patchX, patchZ] = busiest.split(':').map(Number);
const fx = patchX! * 8 + 4, fz = patchZ! * 8 + 4;
writeFileSync('node_modules/.tmp/water-preview.json', JSON.stringify({ seed, focus: [fx, fz], ground: dump(ground), water: dump(water), skirt: skirt ? dump(skirt) : { p: [], c: [] }, oceanY: surface.seaLevelY - 0.02 }));
console.log('exported', seed, 'focus', fx, fz);
