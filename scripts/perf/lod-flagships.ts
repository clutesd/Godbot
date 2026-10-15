/** Triangle cost of every LOD tier of each flagship case. */
import * as THREE from 'three';
import { AssetBuilder } from '../../src/render/assets/AssetBuilder';
import { ARCHITECTURE_FLAGSHIPS } from '../../src/dev/architectureFlagshipCases';
for (const c of ARCHITECTURE_FLAGSHIPS) {
  const builder = new AssetBuilder('lod-flagships'), root = builder.getAsset('building', c.config).mesh;
  const tris = (o: THREE.Object3D) => { let n = 0; o.traverse(m => { if (m instanceof THREE.Mesh) n += (m.geometry.index?.count ?? 0) / 3; }); return n; };
  console.log(c.id, root instanceof THREE.LOD ? root.levels.map(l => tris(l.object)).join(' / ') : `single ${tris(root)}`);
  builder.dispose();
}
