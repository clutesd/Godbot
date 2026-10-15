/** Real WebGL comparisons for every catalogue evidence case. No SVG-existence beauty passes.
 * Run catalogue generation first, then node scripts/perf/construction-art-acceptance.mjs [out] [--representatives]. */
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const out=process.argv[2]??'output/construction-art'; mkdirSync(out,{recursive:true});
const catalogue=JSON.parse(readFileSync(process.env.ART_CATALOGUE_PATH??`${out}/catalogue.json`,'utf8'));
let cases=catalogue.rows;
if(process.argv.includes('--representatives')) cases=cases.filter(c=>
  ['house','barn','stable','granary','factory','windmill','bridge'].includes(c.archetype)
  && ['bronzeIron','medieval','industrial','modern'].includes(c.period)
  && ['timber','stone','brick','composite'].includes(c.scenario));
const filter=process.env.ART_CASE_FILTER;if(filter)cases=cases.filter(c=>new RegExp(filter).test(c.id));
const limit=Number(process.env.ART_CASE_LIMIT??0); if(limit) cases=cases.slice(0,limit);
const shardCount=Number(process.env.ART_SHARDS??1),shardIndex=Number(process.env.ART_SHARD_INDEX??0);
if(shardCount>1)cases=cases.filter((_,i)=>i%shardCount===shardIndex);
const browserPath=[process.env.GODBOX_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
if(!browserPath)throw new Error('Chromium required');
const profile=process.env.ART_PROFILE??mkdtempSync(join(tmpdir(),'construction-art-'));mkdirSync(profile,{recursive:true});
const activePort=join(profile,'DevToolsActivePort');if(existsSync(activePort))unlinkSync(activePort);
const browser=spawn(browserPath,['--headless=new','--disable-features=BackForwardCache','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--window-size=1100,800','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0; const pending=new Map(),errors=[];
function send(method,params={}) { const n=++id; socket.send(JSON.stringify({id:n,method,params})); return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timed out`));},method==='Runtime.evaluate'?180000:60000);pending.set(n,{resolve,reject,timer});}); }
async function evaluate(expression) { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text); return r.result.value; }
const qa=s=>evaluate(`godboxArchitectureQa.${s}`);
const sourceFingerprint=createHash('sha256').update(['src/render/architecture/SurfaceArtPrograms.ts','src/render/architecture/FacadeSvg.ts','src/render/architecture/FacadeTextures.ts','src/render/assets/BuildingComposer.ts','src/dev/architectureBrowser.ts'].map(f=>readFileSync(f,'utf8')).join('')).digest('hex');
const report={sourceFingerprint,concurrentCaptureBrowsers:shardCount,shardIndex,scope:cases.length===catalogue.rows.length?'full-evidence-matrix':'subset',totalCatalogueCases:catalogue.rows.length,cases:[],errors,externalGaps:catalogue.externalGaps};
const assignedTotal=cases.length;
if(process.argv.includes('--resume')&&existsSync(`${out}/acceptance.json`)) {
  try {
    const previous=JSON.parse(readFileSync(`${out}/acceptance.json`,'utf8'));
    if(previous.sourceFingerprint!==sourceFingerprint)throw new Error('Source changed; refusing stale capture reuse');
    report.cases=previous.cases.filter(c=>c.views?.length===6&&c.performance?.length===2);
    const completed=new Set(report.cases.map(c=>c.id));cases=cases.filter(c=>!completed.has(c.id));
    console.log(`Resuming ${report.cases.length} completed cases; ${cases.length} remaining`);
  } catch(error) {console.warn(String(error));}
}
const batch=Number(process.env.ART_BATCH??0);if(batch)cases=cases.slice(0,batch);
async function ready(expected) { for(let i=0;i<200;i++) { const s=await evaluate('window.godboxArchitectureQa?.stats()').catch(()=>null);if(s?.subjects.length && !s.facade.pending && !s.preparation?.pending && (!expected || s.subjects[0].spec.archetype===expected.archetype && s.subjects[0].spec.period===expected.period))return s;await sleep(100); }throw new Error('Artwork readiness timeout'); }
async function shot(name) {const s=await send('Page.captureScreenshot',{format:'jpeg',quality:86});writeFileSync(`${out}/${name}.jpg`,Buffer.from(s.data,'base64'));}
function save() {
  writeFileSync(`${out}/acceptance.json`,JSON.stringify(report,null,2));
  const html=`<!doctype html><meta charset="utf-8"><title>Construction artwork review</title><style>body{margin:24px;background:#182025;color:#e3e1db;font:15px system-ui}input{padding:10px;width:420px}article{margin:30px 0;border-top:1px solid #53616a;padding-top:12px}.pair{display:flex;gap:8px}figure{margin:0;width:49%}img{width:100%}summary{cursor:pointer}pre{white-space:pre-wrap}.fail{color:#ffa779}</style><h1>Construction art: matched production renders</h1><p>${report.cases.length} / ${catalogue.rows.length} evidence cases captured. Scope: ${report.scope}. Automated differences are technical checks; every case requires visual review before artistic acceptance.</p><p>External gaps: ${catalogue.externalGaps.join('; ')}.</p><input id="filter" placeholder="Filter archetype, era or material"><main>${report.cases.map(c=>`<article data-key="${c.id}"><h2>${c.id}</h2><p class="${c.failures.length?'fail':''}">${c.failures.join('; ')||'Technical checks passed; artistic review pending'}</p>${(c.views??[]).map(v=>`<h3>${v.name}</h3><div class="pair"><figure><img loading="lazy" src="${c.id}-${v.name}-off.jpg"><figcaption>SVG off</figcaption></figure><figure><img loading="lazy" src="${c.id}-${v.name}-on.jpg"><figcaption>SVG on · mean change ${v.meanChannelDelta.toFixed(2)}</figcaption></figure></div>`).join('')}<details><summary>Selection, coverage and performance evidence</summary><pre>${JSON.stringify(c,null,2).replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre></details></article>`).join('')}</main><script>filter.oninput=()=>document.querySelectorAll('article').forEach(e=>e.hidden=!e.dataset.key.includes(filter.value.toLowerCase()))</script>`;
  writeFileSync(`${out}/gallery.html`,html);
}
try {
 let port;for(let i=0;i<200;i++){const path=join(profile,'DevToolsActivePort');if(existsSync(path)){try{port=Number(readFileSync(path,'utf8').split('\n')[0]);if(port)break;}catch{/* Chromium may still hold the startup file. */}}await sleep(100);}
 if(!port)throw new Error('Chromium debugger did not start');
 const page=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(p=>p.type==='page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 socket.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Capture browser closed'));}pending.clear();};
 socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
 for(const c of cases) {
   const record={id:c.id,failures:[],views:[],visualAcceptance:'unreviewed'};report.cases.push(record);
   try {
     await send('Page.navigate',{url:`http://localhost:${process.env.GODBOX_PORT??5183}${c.url}`});
     await sleep(150);record.stats=await ready(c);record.coverage=await qa('coverage()');
     if(record.coverage.some(s=>s.clampedVertices>0))record.failures.push('clamped material projection');
     if(record.coverage.some(s=>s.partial>0))record.failures.push('partial-triangle material projection');
     await qa('labels(false)');await qa('face(0,1.8)');await sleep(60);await ready();
     const s=record.stats;
     if(s.facade.failed||s.facade.budgetFallbacks||!s.facade.ready)record.failures.push('missing or unavailable raster artwork');
     if(s.subjects[0].spec.archetype!==c.archetype||s.subjects[0].spec.period!==c.period)record.failures.push('resolved identity differs from request');
     if(!s.subjects[0].programs?.every(p=>p.includes(`/${c.archetype}/${c.period}/`)))record.failures.push('incorrect art-program selection');
     for(const view of [{name:'overview',command:'camera(.55,.32)'},...Array.from({length:4},(_,i)=>({name:`face-${i}`,command:`face(${i},1.45)`})),{name:'detail',command:'face(0,.7,0,.45,.3)'}]) {
       await qa(view.command);await sleep(40);await ready();
       const delta=await qa('compare()');
       if(delta.glError)record.failures.push(`${view.name}: WebGL error ${delta.glError}`);
       if(delta.beforeRender.calls!==delta.afterRender.calls||delta.beforeRender.triangles!==delta.afterRender.triangles)record.failures.push(`${view.name}: topology changed on toggle`);
       if(delta.changedPixelFraction<.003||delta.meanChannelDelta<.10)record.failures.push(`${view.name}: insufficient visible SVG difference`);
       await qa('svg(false)');await shot(`${c.id}-${view.name}-off`);
       await qa('svg(true)');await shot(`${c.id}-${view.name}-on`);
       record.views.push({name:view.name,...delta});
     }
     record.performance=[];for(const enabled of [false,true])record.performance.push({enabled,...await qa(`benchmark(${enabled},30)`)});
     record.finalStats=await qa('stats()');
   }catch(error){record.failures.push(String(error));}
   writeFileSync(`${out}/acceptance.json`,JSON.stringify(report,null,2));
   if(report.cases.length%10===0){console.log(`Captured ${report.cases.length}/${assignedTotal}`);save();}
 }
 if(process.argv.includes('--settlement')) {
   const settlementCount=Number(process.env.ART_SETTLEMENT_COUNT??64);report.settlement={count:settlementCount,phase:'building'};
   const buildStart=performance.now();console.log(`Building ${settlementCount} unique assets`);
   await qa(`street(${settlementCount},['house','barn','granary','workshop','windmill','bridge'],.55,.32)`);
   report.settlement.buildMs=performance.now()-buildStart;report.settlement.phase='rasterizing';console.log(`Built in ${report.settlement.buildMs.toFixed(0)} ms`);
   const rasterStart=performance.now();for(let i=0;i<1200;i++){const s=await qa('stats()');if(!s.facade.pending && !s.preparation?.pending)break;await sleep(100);}
   Object.assign(report.settlement,{stats:await qa('stats()'),performance:[],phase:'benchmarking'});report.settlement.rasterReadyMs=performance.now()-rasterStart;console.log('Texture state',JSON.stringify(report.settlement.stats.facade));
   if(report.settlement.stats.facade.pending||report.settlement.stats.facade.failed||report.settlement.stats.facade.budgetFallbacks)throw new Error('Settlement textures are not completely ready');
   for(const enabled of [false,true,false,true]){console.log('Benchmark',enabled);report.settlement.performance.push({enabled,...await qa(`benchmark(${enabled},120)`)});}
   await qa('svg(false)');await shot('settlement-off');await qa('svg(true)');await shot('settlement-on');
   report.settlement.difference=await qa('compare()');
   report.settlement.phase='complete';report.settlement.browserHeap=await evaluate('performance.memory?({used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}):null');
 }
 report.gpu=await evaluate("(()=>{const c=document.querySelector('canvas');if(!c)return 'unavailable';const g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)})()");
}finally{save();if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}else browser.kill();
 await Promise.race([new Promise(resolve=>{if(browser.exitCode!==null)resolve();else browser.once('exit',resolve);}),sleep(5000)]);if(browser.exitCode===null)browser.kill();}
console.log(JSON.stringify({captured:report.cases.length,deficient:report.cases.filter(c=>c.failures.length).length,errors:errors.length}));
if(report.cases.some(c=>c.failures.length)||errors.length)process.exitCode=1;
