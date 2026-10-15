import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BROWSER_CATALOGUE } from '../src/dev/architectureBrowserModel';
import { CONSTRUCTION_ART_CASES, constructionArtConfig } from '../src/dev/constructionArtCases';
import type { FacadePlan } from '../src/render/architecture/FacadePlan';
import { surfaceArtLayout } from '../src/render/architecture/SurfaceArtPrograms';

const directory = process.argv[2] ?? 'output/construction-art';
mkdirSync(directory,{recursive:true});
const rows = [];
for (const request of CONSTRUCTION_ART_CASES) {
  const builder = new AssetBuilder('art-coverage');
  try {
    const entry = BROWSER_CATALOGUE.find(e => e.id===request.archetype)!;
    const root = builder.getAsset('building',constructionArtConfig(entry,request.period,request.scenario)).mesh;
    const plan = root.userData['facadePlan'] as FacadePlan | undefined;
    const surfaces: { material: string; triangles: number; painted: number; partial: number }[] = [];
    const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
    full.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const index = object.geometry.index, uv = object.geometry.getAttribute('aFacadeUv');
      let painted=0,partial=0;
      if(index && uv) for(let i=0;i<index.count;i+=3) {
        const masks=[0,1,2].map(k=>uv.getZ(index.getX(i+k)));
        if(masks.every(m=>m>0)) painted++;
        else if(masks.some(m=>m>0)) partial++;
      }
      surfaces.push({material:object.name,triangles:(index?.count??0)/3,painted,partial});
    });
    rows.push({...request,resolvedPeriod:plan?.spec.period,materials:plan?.materials,
      programs:plan ? surfaceArtLayout(plan).map(c=>c.program) : [],surfaces,
      geometryAudit:plan && surfaces.some(s=>s.painted) ? 'bound' : 'missing-artwork',
      visualAcceptance:'unreviewed'});
  } catch(error) { rows.push({...request,geometryAudit:'error',error:String(error),visualAcceptance:'unreviewed'}); }
  finally { builder.dispose(); }
}
writeFileSync(`${directory}/catalogue.json`,JSON.stringify({
  scope:'All catalogue periods × all period-valid browser evidence scenarios; resolved assignments recorded. This is not all possible role-material assignments.',
  count:rows.length,rows,externalGaps:['RoadSurfaceMaterial earth/paving shader','TransportStructures incidental dock/bridge fixtures','IndustryRenderer external machinery','EnergyRenderer external machinery'],
},null,2));
console.log(JSON.stringify({cases:rows.length,missing:rows.filter(r=>r.geometryAudit!=='bound').map(r=>r.id)}));
