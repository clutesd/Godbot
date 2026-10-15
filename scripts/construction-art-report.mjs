/** Combine sharded WebGL evidence without promoting technical checks to artistic acceptance. */
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const out=process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'output/construction-art';
const catalogue=JSON.parse(readFileSync(`${out}/catalogue.json`,'utf8'));
const records=new Map(),sources=new Set(),runtimeErrors=[];
const fingerprint=createHash('sha256').update(['src/render/architecture/SurfaceArtPrograms.ts','src/render/architecture/FacadeSvg.ts','src/render/architecture/FacadeTextures.ts','src/render/assets/BuildingComposer.ts','src/dev/architectureBrowser.ts'].map(f=>readFileSync(f,'utf8')).join('')).digest('hex');
let equivalence;
const equivalencePath=`${out}/source-equivalence.json`;
if(existsSync(equivalencePath)){
 const proof=JSON.parse(readFileSync(equivalencePath,'utf8'));
 const source=readFileSync('src/render/architecture/FacadeTextures.ts','utf8').replaceAll('\r\n','\n');
 const nonRaster=source.slice(0,source.indexOf('  private raster('))+source.slice(source.indexOf('  setEnabled(',source.indexOf('  private raster(')));
 if(proof.to===fingerprint&&proof.nonRasterCodeUnchanged&&proof.nonRasterSha256===createHash('sha256').update(nonRaster).digest('hex'))equivalence=proof;
}
const inputs=[{path:`${out}/acceptance.json`,directory:'.'},...[0,1,2,3].map(i=>({path:`${out}/shard-${i}/acceptance.json`,directory:`shard-${i}`}))]
 .filter(input=>existsSync(input.path)).sort((a,b)=>statSync(a.path).mtimeMs-statSync(b.path).mtimeMs);
for(const {path,directory} of inputs){
 try{
  const r=JSON.parse(readFileSync(path,'utf8'));if(r.sourceFingerprint!==fingerprint&&r.sourceFingerprint!==equivalence?.from)continue;
  sources.add(r.sourceFingerprint);runtimeErrors.push(...r.errors??[]);
  for(const c of r.cases){
   if(r.sourceFingerprint!==fingerprint&&[c.stats,c.finalStats].some(s=>!s?.facade?.resolutions||Object.keys(s.facade.resolutions).some(size=>Number(size)!==equivalence.unchangedRasterHeight)))continue;
   records.set(c.id,{...c,directory,capturedSourceFingerprint:r.sourceFingerprint});
  }
 }catch(error){runtimeErrors.push(`Unreadable capture report ${path}: ${String(error)}`);}
}
const rows=catalogue.rows.map(c=>{
 const capture=records.get(c.id);
 const materialDefects=[];
 const renderedMaterials=capture?.stats?.subjects?.[0]?.spec?.materials;
 const renderedPrograms=capture?.stats?.subjects?.[0]?.programs??[];
 for(const material of new Set(renderedPrograms.map(p=>p.split('/')[3]))) {
  const surfaces=(capture?.coverage??[]).filter(s=>s.material===material);
  if(surfaces.length&&surfaces.some(s=>s.triangles>0)&&surfaces.every(s=>s.painted===0))materialDefects.push(`No painted triangles for emitted ${material}`);
 }
 if(Object.values(renderedMaterials??c.materials??{}).includes('terracotta'))materialDefects.push('Terracotta uses a provisional continuous finish; pressed ceramic detail remains deficient');
 return {...c,renderedMaterials,renderedPrograms,capture,defects:[...(capture?.failures??[]),...materialDefects],visualAcceptance:'unreviewed'};
});
const summary={total:rows.length,captured:records.size,views:[...records.values()].reduce((s,c)=>s+(c.views?.length??0),0),
 technicallyDeficient:rows.filter(c=>c.capture&&c.defects.length).length,uncaptured:rows.filter(c=>!c.capture).length,
 artisticallyAccepted:0,currentSourceFingerprint:fingerprint,sourceFingerprints:[...sources],rasterResourceEquivalence:equivalence,runtimeErrors,externalGaps:[...catalogue.externalGaps,
 'Memorial compositions without a BuildingSpec','Regional silhouette LOD has no SVG',
 'Curved surface projection and repeated joinery require further visual review'],
 performanceConditions:'Up to four concurrent headless Edge capture browsers, recycled in short batches. Frame timings are observations under contention, not isolated GPU overhead measurements.',
};
const measurements=[...records.values()].flatMap(c=>(c.performance??[]).map(p=>({id:c.id,...p})));
let isolatedPerformance;
const performancePath=`${out}/isolated-performance/acceptance.json`;
if(existsSync(performancePath)){
 const run=JSON.parse(readFileSync(performancePath,'utf8'));
 if(run.sourceFingerprint===fingerprint&&run.settlement?.phase==='complete'){
  const s=run.settlement;
  isolatedPerformance={sourceFingerprint:run.sourceFingerprint,gpu:run.gpu,count:s.count,buildMs:s.buildMs,rasterReadyMs:s.rasterReadyMs,
   atlas:s.stats.facade,rendererMemory:s.stats.memory,warmRuns:s.performance,difference:s.difference,browserJsHeap:s.browserHeap,
   lods:s.stats.subjects.reduce((counts,s)=>{counts[s.lod]=(counts[s.lod]??0)+1;return counts;},{}),
   concerns:['Cold rasterization remains too slow for production acceptance','The regional LOD fixture has insufficient visible SVG difference','Warm frame timings do not measure cold-generation responsiveness or establish general overhead']};
 }
}
writeFileSync(`${out}/coverage-report.json`,JSON.stringify({summary,isolatedPerformance,rows,measurements},null,2));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Construction SVG acceptance gallery</title><style>
body{font:15px system-ui;background:#192126;color:#e4e1d6;margin:28px}p{max-width:1000px;line-height:1.5}input,select{padding:10px;background:#28353c;color:#eee;border:1px solid #73818a}input{width:360px}article{border-top:1px solid #53636c;padding-top:8px;margin:24px 0}.pair{display:flex;gap:10px}figure{width:49%;margin:0}img{width:100%;background:#101719}figcaption{padding:6px}summary{cursor:pointer;padding:10px}pre{white-space:pre-wrap;max-height:500px;overflow:auto}.defect{color:#f6b392}.pending{color:#c9c292}h2{font-size:19px}a{color:#9ad0df}</style>
<h1>Construction SVG: production WebGL comparisons</h1><p>${summary.captured} / ${summary.total} evidence cases captured; ${summary.views} matched view pairs. ${summary.technicallyDeficient} captured cases have recorded deficiencies. <strong>Artistic acceptance is pending for every case.</strong> The matrix covers period-valid evidence scenarios, with actual resolved role materials recorded; it does not enumerate every possible role-assignment permutation or culture/climate/history combination.</p>
<p>${esc(summary.performanceConditions)} GPU estimates include the three SVG mip chains, excluding other scene textures, geometry and transient SVG raster memory.</p>
${equivalence?`<p>Full-resolution comparisons predate a decoder-resource correction. Artwork, shader, projection and full-resolution SVG bytes are unchanged; code outside rasterization was checked unchanged. Lower-resolution settlement performance requires a separate new run. <a href="source-equivalence.json">Equivalence record</a>.</p>`:''}
<p>Uncovered or limited: ${summary.externalGaps.map(esc).join('; ')}.</p>
${isolatedPerformance?`<details><summary>Isolated 64-variant residency/performance test — acceptance remains open</summary><p>${isolatedPerformance.atlas.ready} atlas variants ready, ${(isolatedPerformance.atlas.estimatedGpuBytes/1048576).toFixed(1)} MiB estimated atlas memory. Cold fixture build ${(isolatedPerformance.buildMs/1000).toFixed(2)} s; raster readiness ${(isolatedPerformance.rasterReadyMs/1000).toFixed(1)} s. This regional view uses production LOD and does not demonstrate pedestrian craft quality across all 64 models. <a href="isolated-performance/acceptance.json">Full measurement record</a>.</p><p>${isolatedPerformance.concerns.map(esc).join('; ')}.</p><div class="pair"><figure><img loading="lazy" src="isolated-performance/settlement-off.jpg"><figcaption>Regional LOD · SVG off</figcaption></figure><figure><img loading="lazy" src="isolated-performance/settlement-on.jpg"><figcaption>Regional LOD · SVG on (difference is insufficient)</figcaption></figure></div><pre>${esc(JSON.stringify(isolatedPerformance,null,2))}</pre></details>`:''}
<input id="filter" placeholder="Filter archetype, era, material scenario"><select id="status"><option value="all">All cases</option><option value="defect">Deficient</option><option value="missing">Not captured</option><option value="captured">Technical checks passed</option></select>
<main>${rows.map(c=>`<article data-key="${esc(c.id.toLowerCase())}" data-status="${!c.capture?'missing':c.defects.length?'defect':'captured'}"><h2>${esc(c.id)}</h2><p class="${c.defects.length?'defect':'pending'}">${c.capture?c.defects.length?c.defects.map(esc).join('; '):'Technical checks passed. Visual craftsmanship remains unapproved.':'No final WebGL capture.'}</p>${c.capture?`<details><summary>Inspect matched renders and evidence</summary>${c.capture.views.map(v=>`<h3>${v.name}</h3><div class="pair"><figure><img loading="lazy" src="${c.capture.directory}/${c.id}-${v.name}-off.jpg"><figcaption>SVG off</figcaption></figure><figure><img loading="lazy" src="${c.capture.directory}/${c.id}-${v.name}-on.jpg"><figcaption>SVG on · mean channel difference ${v.meanChannelDelta.toFixed(2)}</figcaption></figure></div>`).join('')}<details><summary>Programs, surface coverage, memory and timings</summary><pre>${esc(JSON.stringify(c.capture,null,2))}</pre></details></details>`:''}</article>`).join('')}</main>
<script>const searchInput=document.getElementById('filter'),statusInput=document.getElementById('status');function apply(){document.querySelectorAll('article').forEach(e=>e.hidden=!e.dataset.key.includes(searchInput.value.toLowerCase())||(statusInput.value!=='all'&&e.dataset.status!==statusInput.value))}searchInput.oninput=apply;statusInput.onchange=apply</script>`;
writeFileSync(`${out}/gallery.html`,html);
console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--check')&&(summary.uncaptured||summary.technicallyDeficient||runtimeErrors.length))process.exitCode=1;
