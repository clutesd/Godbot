/** Building LOD tiers inside the running game: automatic tiers versus every building forced to
 * full detail, from street to world distance, with the game loop frozen so both frames match.
 *
 *   node scripts/perf/lod-game.mjs <out-dir> [--seed name] [--months 600]
 * Requires `npm run dev -- --port 5183`. */
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:fallback;};
const out=args[0]??'output/svg-art-review/lod-game';mkdirSync(out,{recursive:true});
const months=Number(option('months',600)),seed=option('seed','svg-art-game');
const browserPath=[process.env.GODBOX_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const profile=mkdtempSync(join(tmpdir(),'lod-game-'));
const browser=spawn(browserPath,['--headless=new','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--window-size=1280,800','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0;const pending=new Map(),errors=[];
function send(method,params={}){const n=++id;socket.send(JSON.stringify({id:n,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timed out`));},600000);pending.set(n,{resolve,reject,timer:t});});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function grab(){return (await send('Page.captureScreenshot',{format:'png'})).data;}
async function settle(){for(let i=0;i<900;i++){const p=await evaluate('(()=>{if(window.__svgDraw)__svgDraw();return __godboxRenderer.assetBuilder.facadeTextures.stats().pending})()');if(!p)return;await sleep(100);}}

async function pair(name,title){
  const shots=[],stats=[];
  for(const mode of ['full','auto']){
    await evaluate(`__lodMode(${JSON.stringify(mode)})`);await evaluate('__svgDraw()');await sleep(200);await evaluate('__svgDraw()');
    shots.push(await grab());stats.push(await evaluate('__lodBench(60)'));
  }
  const jpeg=await evaluate(`(async()=>{const load=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s;});
    const a=await load(${JSON.stringify(shots[0])}),b=await load(${JSON.stringify(shots[1])});const c=document.createElement('canvas');c.width=a.width*2+6;c.height=a.height+28;
    const g=c.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,c.width,c.height);g.drawImage(a,0,28);g.drawImage(b,a.width+6,28);
    g.fillStyle='#eee';g.font='16px sans-serif';g.fillText('every building full detail  ·  ${title}',8,19);g.fillText('automatic LOD tiers',a.width+14,19);return c.toDataURL('image/jpeg',.9).slice(23);})()`);
  writeFileSync(`${out}/${name}.jpg`,Buffer.from(jpeg,'base64'));
  return {name,full:stats[0],auto:stats[1]};
}
const report={seed,months,views:[],errors};
try{
  let debug;for(let i=0;i<200&&!debug;i++){const p=join(profile,'DevToolsActivePort');if(existsSync(p)){try{debug=Number(readFileSync(p,'utf8').split('\n')[0]);}catch{/* starting */}}if(!debug)await sleep(100);}
  const page=(await fetch(`http://127.0.0.1:${debug}/json/list`).then(r=>r.json())).find(p=>p.type==='page');
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://localhost:${process.env.GODBOX_PORT??5183}/?seed=${encodeURIComponent(seed)}`});
  for(let i=0;i<600;i++){if(await evaluate('typeof window.__godboxDebugAdvance==="function"'))break;await sleep(200);}
  console.log('hook ready');
  // The arrival film and founding orientation gate monthly history; drive them as the game would.
  for(let i=0;i<400;i++){
    const phase=await evaluate('(()=>{const a=__godboxArrival.state.arrival;if(!a)return "none";if(a.phase!=="HISTORY_RUNNING"&&a.phase!=="FOUNDING_ORIENTATION")__godboxArrival.advance(20);return a.phase;})()');
    if(i%20===0)console.log('phase',phase);
    if(phase==='HISTORY_RUNNING'||phase==='none')break;
    await sleep(phase==='FOUNDING_ORIENTATION'?1000:50);
  }
  for(let m=0;m<months;m+=12){
    const r=await evaluate('(()=>{const r=__godboxDebugAdvance(12);let n=0,svg=0,meshes=0;__godboxRenderer.scene.traverse(o=>{if(o.userData&&o.userData.facadePlan)n++;if(o.isMesh){meshes++;if(String(o.material&&o.material.name).includes(":svg-facade"))svg++;}});const f=__godboxRenderer.assetBuilder.facadeTextures.stats();return {month:r.month,year:r.year,plans:n,svgMeshes:svg,meshes,entries:f.entries,ready:f.ready,settlements:__godboxArrival.state.settlements?.length,buildings:(__godboxArrival.state.settlements??[]).reduce((s,x)=>s+(x.buildings?.length??x.developments?.length??0),0)};})()');
    console.log(JSON.stringify(r));
  }
  // Construction transitions run in presentation time: let the live game loop finish them.
  for(let i=0;i<Number(option('settle',90));i++){const s=await evaluate(`(()=>{const m={};__godboxRenderer.scene.traverse(o=>{if(o.userData&&o.userData.facadePlan){const k=o.isLOD?'lod':'stage'+o.userData.facadePlan.spec.stage;m[k]=(m[k]||0)+1;}});return m;})()`);
    if(i%10===0)console.log('settling',JSON.stringify(s));await sleep(1000);}
  await evaluate(`(()=>{window.requestAnimationFrame=()=>0;const v=__godboxRenderer;
    window.__svgDraw=()=>{v.assetBuilder.facadeTextures.updateQuality(v.scene,v.camera,performance.now()+1e9);v.postProcessing.render(v.ecology.night.value);};
    const lods=()=>{const l=[];v.scene.traverse(o=>{if(o.isLOD&&o.levels[0]&&o.levels[0].object.name==='building-full-detail')l.push(o);});return l;};
    window.__lodMode=m=>{for(const o of lods()){o.autoUpdate=m==='auto';if(m==='full')o.levels.forEach((x,i)=>x.object.visible=i===0);}};
    window.__lodBench=n=>{const gl=v.renderer.getContext(),t=[];for(let i=0;i<n+10;i++){const s=performance.now();__svgDraw();gl.finish();if(i>=10)t.push(performance.now()-s);}t.sort((a,b)=>a-b);
      const tiers=[0,0,0,0];for(const o of lods()){const k=o.levels.findIndex(x=>x.object.visible);if(k>=0)tiers[k]++;}
      return {medianMs:+t[t.length>>1].toFixed(2),p95Ms:+t[Math.floor(t.length*.95)].toFixed(2),calls:v.renderer.info.render.calls,triangles:v.renderer.info.render.triangles,tiers,geometries:v.renderer.info.memory.geometries,textures:v.renderer.info.memory.textures};};})()`);
  // The settlement with the most completed LOD buildings, framed by its centre.
  const target=await evaluate(`(()=>{const v=__godboxRenderer,pts=[];v.scene.updateMatrixWorld(true);v.scene.traverse(o=>{if(o.isLOD&&o.levels[0]&&o.levels[0].object.name==='building-full-detail')pts.push(o.getWorldPosition(new o.position.constructor()));});
    let best=null,score=-1;for(const p of pts){const n=pts.filter(q=>q.distanceTo(p)<6).length;if(n>score){score=n;best=p;}}
    return best?{x:best.x,y:best.y,z:best.z,count:pts.length,cluster:score}:null;})()`);
  if(!target){report.lodNames=await evaluate(`(()=>{const m={};__godboxRenderer.scene.traverse(o=>{if(o.isLOD){const k=o.name+'|'+o.levels.length+'|'+(o.levels[0]&&o.levels[0].object.name)+'|'+o.visible;m[k]=(m[k]||0)+1;}});return m;})()`);
    report.plans=await evaluate(`(()=>{const m={};__godboxRenderer.scene.traverse(o=>{if(o.userData&&o.userData.facadePlan){const k=(o.isLOD?'LOD':o.type)+'|'+o.name+'|'+(o.parent&&o.parent.name);m[k]=(m[k]||0)+1;}});return m;})()`);
    console.log('diagnostic',JSON.stringify({lods:report.lodNames,plans:report.plans}));throw new Error('No completed LOD buildings in the scene');}
  report.target=target;console.log('target',JSON.stringify(target));
  for(const [name,distance,height] of [['street',6,2.2],['neighbourhood',14,6],['settlement',30,14],['establishing',60,30],['world',120,70]]){
    await evaluate(`(()=>{const c=__godboxRenderer.camera,t=${JSON.stringify(target)};c.position.set(t.x+Math.sin(.6)*${distance},t.y+${height},t.z+Math.cos(.6)*${distance});c.lookAt(t.x,t.y,t.z);c.updateMatrixWorld();})()`);
    await evaluate('__lodMode("auto")');await evaluate('__svgDraw()');await settle();
    const r=await pair(`lod-game-${name}`,`${name} (${distance} units)`);report.views.push(r);console.log(name,JSON.stringify(r));
  }
  report.facade=await evaluate('__godboxRenderer.assetBuilder.facadeTextures.stats()');
}finally{
  writeFileSync(`${out}/lod-game.json`,JSON.stringify(report,null,2));
  if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}else browser.kill();
  await sleep(500);if(browser.exitCode===null)browser.kill();
}
console.log(JSON.stringify({views:report.views.length,errors:errors.slice(0,5)}));
