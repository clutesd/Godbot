/** Recycle test browsers to bound navigation/SVG decoder memory during the exhaustive sweep. */
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,statfsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const indices=process.argv.slice(2).map(Number);
if(!indices.length)throw new Error('Pass assigned shard indices, e.g. 0 1');
const root='output/construction-art';
const catalogue=JSON.parse(readFileSync(`${root}/catalogue.json`,'utf8'));
const totals=indices.map(index=>catalogue.rows.filter((_,i)=>i%4===index).length);
const noProgress=new Map();
const fingerprint=createHash('sha256').update(['src/render/architecture/SurfaceArtPrograms.ts','src/render/architecture/FacadeSvg.ts','src/render/architecture/FacadeTextures.ts','src/render/assets/BuildingComposer.ts','src/dev/architectureBrowser.ts'].map(f=>readFileSync(f,'utf8')).join('')).digest('hex');
for(let round=0;round<Math.ceil(Math.max(...totals)/20)+4;round++){
 let remaining=false;
 for(const index of indices){
  const out=`${root}/shard-${index}`,file=`${out}/acceptance.json`;
  let count=0;try{const report=JSON.parse(readFileSync(file,'utf8'));if(report.sourceFingerprint===fingerprint)count=report.cases.filter(c=>c.views?.length===6&&c.performance?.length===2).length;}catch{/* An interrupted write is recaptured. */}
  const total=catalogue.rows.filter((_,i)=>i%4===index).length;
  if(count>=total)continue;
  remaining=true;
  const space=statfsSync(root);if(Number(space.bavail)*Number(space.bsize)<768*1024*1024)throw new Error('Capture stopped: less than 768 MiB free');
  console.log(`Shard ${index}: ${count}/${total} complete`);
  spawnSync(process.execPath,['scripts/perf/construction-art-acceptance.mjs',out,'--resume'],{
   env:{...process.env,ART_SHARDS:'4',ART_SHARD_INDEX:String(index),ART_CATALOGUE_PATH:`${root}/catalogue.json`,ART_PROFILE:resolve(out,'browser-profile'),ART_BATCH:'20'},stdio:'inherit',windowsHide:true,
  });
  if(!existsSync(file))throw new Error(`No report from shard ${index}`);
  let after=0;try{after=JSON.parse(readFileSync(file,'utf8')).cases.filter(c=>c.views?.length===6&&c.performance?.length===2).length;}catch{/* Retry an interrupted report. */}
  noProgress.set(index,after>count?0:(noProgress.get(index)??0)+1);
  if(noProgress.get(index)>=3)throw new Error(`Shard ${index} made no progress in three attempts`);
 }
 if(!remaining)break;
}
