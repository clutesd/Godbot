/** Triangle and draw-call cost of each building LOD tier across the art-review matrix.
 *   npx tsx scripts/perf/lod-profile.ts [stride] [caseId] [--solids] */
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { CONSTRUCTION_ART_CASES, constructionArtConfig } from '../../src/dev/constructionArtCases';
import { BROWSER_CATALOGUE } from '../../src/dev/architectureBrowserModel';
const stride = Number(process.argv[2] ?? 6), only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
const cost = (o: THREE.Object3D) => { let meshes = 0, tris = 0; o.traverse(m => { if (m instanceof THREE.Mesh) { meshes++; tris += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3; } }); return { meshes, tris }; };
const totals = [0, 0, 0, 0], calls = [0, 0, 0, 0]; let cases = 0, assetMs = 0, deriveMs = 0;
const byName = new Map<string, number>();
for (const c of CONSTRUCTION_ART_CASES.filter((x, i) => only ? x.id === only : i % stride === 0)) {
  const builder = new AssetBuilder('lod-profile');
  const started = performance.now();
  const root = builder.getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === c.archetype)!, c.period, c.scenario)).mesh;
  assetMs += performance.now() - started;
  if (!(root instanceof THREE.LOD)) { builder.dispose(); continue; }
  deriveMs += Number(root.userData['lodBuildMs'] ?? 0);
  const tiers = root.levels.map(l => cost(l.object));
  tiers.forEach((t, i) => { totals[i]! += t.tris; calls[i]! += t.meshes; });
  cases++;
  if (only || process.argv.includes('--verbose')) console.log(c.id, tiers.map(t => `${t.meshes}/${t.tris}`).join(' '));
  root.levels.at(-1)!.object.traverse(m => { if (m instanceof THREE.Mesh) { const k = `${m.name}|${m.userData['surface'] ?? ''}`; byName.set(k, (byName.get(k) ?? 0) + (m.geometry.index?.count ?? 0) / 3); } });
  builder.dispose();
}
console.log(JSON.stringify({ cases, meanTriangles: totals.map(t => Math.round(t / cases)), meanMeshes: calls.map(t => +(t / cases).toFixed(1)), meanAssetMs: +(assetMs / cases).toFixed(1), meanLodBuildMs: +(deriveMs / cases).toFixed(1) }));
console.log('last tier triangles by mesh:\n' + [...byName].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k} ${Math.round(v / cases)}`).join('\n'));
