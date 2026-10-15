/** Production cost evidence for the controlled flagship fixtures. */
import * as THREE from 'three';
import {mkdirSync,writeFileSync} from 'node:fs';
import {AssetBuilder} from '../src/render/assets/AssetBuilder';
import {ARCHITECTURE_FLAGSHIPS} from '../src/dev/architectureFlagshipCases';
const builder=new AssetBuilder('flagship-metrics');
const records=ARCHITECTURE_FLAGSHIPS.map(c=>{
 const asset=builder.getAsset('building',c.config);
 const levels=asset.mesh instanceof THREE.LOD?asset.mesh.levels.map(l=>l.object):[asset.mesh];
 return {id:c.id,period:c.period,levels:levels.map(root=>{
  let vertices=0,meshes=0;const materials=new Set<string>();
  root.traverse(o=>{if(o instanceof THREE.Mesh){vertices+=o.geometry.getAttribute('position').count;meshes++;for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m.name);}});
  return {vertices,meshes,materials:[...materials]};
 })};
});
mkdirSync('output/architecture-flagships',{recursive:true});writeFileSync('output/architecture-flagships/metrics.json',JSON.stringify(records,null,2));
console.log(JSON.stringify(records));builder.dispose();
