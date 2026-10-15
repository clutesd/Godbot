/** Largest contributors to one tier of one case: solids grouped by mesh and rounded size. */
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { CONSTRUCTION_ART_CASES, constructionArtConfig } from '../../src/dev/constructionArtCases';
import { BROWSER_CATALOGUE } from '../../src/dev/architectureBrowserModel';
const c = CONSTRUCTION_ART_CASES.find(x => x.id === process.argv[2])!, tierIndex = Number(process.argv[3] ?? 3);
const root = new AssetBuilder('lod-solids').getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === c.archetype)!, c.period, c.scenario)).mesh as THREE.LOD;
const tier = root.levels[tierIndex]!.object;
tier.traverse(o => {
  if (!(o instanceof THREE.Mesh)) return;
  const g = o.geometry as THREE.BufferGeometry, idx = g.index!, pos = g.getAttribute('position');
  // Histogram triangles by normal direction and plane offset.
  const planes = new Map<string, number>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); cc.fromBufferAttribute(pos, idx.getX(i + 2));
    const n = b.clone().sub(a).cross(cc.clone().sub(a)).normalize();
    const k = `${n.toArray().map(v => v.toFixed(2)).join(',')} d=${n.dot(a).toFixed(3)}`;
    planes.set(k, (planes.get(k) ?? 0) + 1);
  }
  console.log(o.name, o.userData['surface'], idx.count / 3, [...planes].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${v}@${k}`).join(' | '));
});
