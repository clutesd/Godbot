/** Lists the full-detail meshes of one art-review case: name, surface, colour, triangles, bounds. */
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { CONSTRUCTION_ART_CASES, constructionArtConfig } from '../../src/dev/constructionArtCases';
import { BROWSER_CATALOGUE } from '../../src/dev/architectureBrowserModel';
const c = CONSTRUCTION_ART_CASES.find(x => x.id === process.argv[2])!;
const root = new AssetBuilder('mesh-list').getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === c.archetype)!, c.period, c.scenario)).mesh;
const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
full.updateMatrixWorld(true);
full.traverse(o => { if (!(o instanceof THREE.Mesh)) return; const m = o.material as THREE.MeshStandardMaterial;
  const b = new THREE.Box3().setFromObject(o);
  console.log(o.name, o.userData['surface'], m.name, m.color?.getHexString(), m.transparent ? 'T' + m.opacity : '', (o.geometry.index?.count ?? 0) / 3, b.min.toArray().map(v => v.toFixed(2)).join(','), b.max.toArray().map(v => v.toFixed(2)).join(',')); });
