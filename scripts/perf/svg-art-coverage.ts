/** Triangle coverage of SVG artwork over production buildings: painted vs unpainted, by surface. */
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { CONSTRUCTION_ART_CASES, constructionArtConfig } from '../../src/dev/constructionArtCases';
import { BROWSER_CATALOGUE } from '../../src/dev/architectureBrowserModel';
const stride = Number(process.argv[2] ?? 6);
const unpainted = new Map<string, number>();
let painted = 0, total = 0, cases = 0;
for (const c of CONSTRUCTION_ART_CASES.filter((x, i) => process.argv[3] ? x.id === process.argv[3] : i % stride === 0)) {
  const builder = new AssetBuilder('coverage');
  const root = builder.getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === c.archetype)!, c.period, c.scenario)).mesh;
  const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
  full.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const tris = (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
    total += tris;
    if (o.geometry.hasAttribute('aFacadeTile') || o.geometry.hasAttribute('aFacadeUv')) painted += tris;
    else { const key = `${o.name || '(unnamed)'}|${o.userData['surface'] ?? ''}`; unpainted.set(key, (unpainted.get(key) ?? 0) + tris); }
  });
  cases++;
  builder.dispose();
}
console.log(JSON.stringify({ cases, triangles: total, painted, share: +(painted / total).toFixed(4) }));
console.log([...unpainted].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${(v / total * 100).toFixed(2)}%`).join('\n'));
