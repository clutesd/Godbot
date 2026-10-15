/** SVG-off | SVG-on comparisons inside the running game, not the architecture viewer.
 * Advances a real simulation until it has built settlements, then frames real production
 * structures from street, three-quarter and settlement distances with the camera frozen.
 *
 *   node scripts/perf/svg-art-game.mjs <out-dir> [--seed name] [--months 360]
 * Requires `npm run dev -- --port 5183`. */
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:fallback;};
const out=args[0]??'output/svg-art-review/game';mkdirSync(out,{recursive:true});
const months=Number(option('months',360)),seed=option('seed','svg-art-game');
const browserPath=[process.env.GODBOX_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const profile=mkdtempSync(join(tmpdir(),'svg-art-game-'));
const browser=spawn(browserPath,['--headless=new','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--window-size=1280,800','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0;const pending=new Map(),errors=[];
function send(method,params={}){const n=++id;socket.send(JSON.stringify({id:n,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timed out`));},600000);pending.set(n,{resolve,reject,timer:t});});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function grab(){return (await send('Page.captureScreenshot',{format:'png'})).data;}
async function settle(){for(let i=0;i<900;i++){const p=await evaluate('(()=>{if(window.__svgDraw)__svgDraw();return __godboxRenderer.assetBuilder.facadeTextures.stats().pending})()');if(!p)return;await sleep(100);}}
async function sheet(name,title){
  await evaluate('(()=>{const v=__godboxRenderer;v.assetBuilder.facadeTextures.setEnabled(false,v.scene);__svgDraw();})()');await sleep(150);const off=await grab();
  await evaluate('(()=>{const v=__godboxRenderer;v.assetBuilder.facadeTextures.setEnabled(true,v.scene);__svgDraw();})()');await sleep(150);const on=await grab();
  const jpeg=await evaluate(`(async()=>{const load=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s;});
    const a=await load(${JSON.stringify(off)}),b=await load(${JSON.stringify(on)});const c=document.createElement('canvas');c.width=a.width*2+6;c.height=a.height+28;
    const g=c.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,c.width,c.height);g.drawImage(a,0,28);g.drawImage(b,a.width+6,28);
    g.fillStyle='#eee';g.font='16px sans-serif';g.fillText('SVG off  ·  ${title}',8,19);g.fillText('SVG on',a.width+14,19);return c.toDataURL('image/jpeg',.9).slice(23);})()`);
  writeFileSync(`${out}/${name}.jpg`,Buffer.from(jpeg,'base64'));
}
const report={seed,months,orientationSkipped:args.includes('--skip-orientation-wait'),views:[],errors};
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
    if(phase==='FOUNDING_ORIENTATION'&&args.includes('--skip-orientation-wait')) {
      // Renderer-only fixture: same state transition as Simulation.beginHistory(), after the
      // physical landing has completed. This run does not validate the orientation film.
      await evaluate('__godboxArrival.state.arrival.phase="HISTORY_RUNNING"');break;
    }
    if(phase==='HISTORY_RUNNING'||phase==='none')break;
    await sleep(phase==='FOUNDING_ORIENTATION'?1000:50);
  }
  for(let m=0;m<months;m+=12){
    const r=await evaluate('(()=>{const r=__godboxDebugAdvance(12);let n=0,svg=0,meshes=0;__godboxRenderer.scene.traverse(o=>{if(o.userData&&o.userData.facadePlan)n++;if(o.isMesh){meshes++;if(String(o.material&&o.material.name).includes(":svg-facade"))svg++;}});const f=__godboxRenderer.assetBuilder.facadeTextures.stats();return {month:r.month,year:r.year,plans:n,svgMeshes:svg,meshes,entries:f.entries,ready:f.ready,settlements:__godboxArrival.state.settlements?.length,buildings:(__godboxArrival.state.settlements??[]).reduce((s,x)=>s+(x.buildings?.length??x.developments?.length??0),0)};})()');
    console.log(JSON.stringify(r));
  }
  await sleep(1500);
  // A fast simulation advance can outrun asynchronous geometry. Keep drawing until the live
  // reconciliation queue adopts it, then freeze the matched captures.
  await evaluate('__godboxArrival.pause(true)');
  for(let i=0;i<1200;i++) {
    const s=await evaluate('(()=>{const r=__godboxRenderer;return {geometry:r.assetBuilder.getPreparationStats(),atlas:r.assetBuilder.facadeTextures.stats(),pending:r.scene.userData.settlementRenderBudget?.pending??0}})()');
    if(s.geometry.failed||s.atlas.failed)throw new Error(`Preparation failed: ${JSON.stringify(s)}`);
    if(!s.geometry.pending&&!s.atlas.pending&&!s.pending)break;
    if(i===1199)throw new Error(`Preparation did not settle: ${JSON.stringify(s)}`);
    await sleep(100);
  }
  // Freeze presentation time: stop the game's animation loop and draw zero-time frames ourselves,
  // so SVG off and on show the same instant, construction stage and camera.
  await evaluate(`(()=>{window.requestAnimationFrame=()=>0;const v=__godboxRenderer;window.__svgDraw=()=>{v.assetBuilder.facadeTextures.updateQuality(v.scene,v.camera,performance.now()+1e9);v.postProcessing.render(v.ecology.night.value);};})()`);
  await sleep(300);
  // Real production building roots carrying a facade plan, nearest the settlement centre first.
  // Real production buildings: roots carrying a facade plan, measured by their world bounds.
  const found=await evaluate(`(()=>{const v=__godboxRenderer,list=[],seen=new Set();v.scene.updateMatrixWorld(true);
    v.scene.traverseVisible(o=>{if(!o.userData||!(o.userData.facadePlan||o.userData.constructionSite))return;let p=o.parent;while(p){if(seen.has(p))return;p=p.parent;}seen.add(o);
      let box=null,plan=o.userData.facadePlan;o.traverseVisible(m=>{if(!m.isMesh||m.geometry.drawRange.count===0||!String(m.material&&m.material.name).includes(":svg-facade"))return;plan??=v.assetBuilder.facadeTextures.materialEntries.get(m.material)?.plan;if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();
        const b=m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);box=box?box.union(b):b;});
      if(!box||!plan)return;
      list.push({x:(box.min.x+box.max.x)/2,y:box.min.y,z:(box.min.z+box.max.z)/2,height:box.max.y-box.min.y,scale:Math.max(box.max.x-box.min.x,box.max.z-box.min.z,box.max.y-box.min.y),
        archetype:plan.spec.archetype,period:plan.spec.period,status:o.userData.facadeStatus||(o.userData.constructionSite?'construction':'none'),count:1});});
    return list.sort((a,b)=>b.scale-a.scale);})()`);
  report.buildings=found.length;report.statuses=found.reduce((m,b)=>{m[b.status]=(m[b.status]??0)+1;return m;},{});
  report.archetypes=[...new Set(found.map(b=>b.archetype))];
  console.log(`buildings ${found.length}`,JSON.stringify(report.statuses),report.archetypes.join(','));
  if(!found.length)throw new Error('No production buildings found');
  // A dense cluster: the building with the most neighbours within a few units.
  const centre=found[0];
  const near=found.slice(0,4);
  const views=[
    {name:'settlement',target:centre,distance:centre.scale*7,height:centre.scale*4,yaw:.6},
    ...near.slice(0,3).flatMap((b,i)=>[
      {name:`three-quarter-${i}`,target:b,distance:b.scale*1.8,height:b.scale*.9,yaw:.75+i*2.1},
      {name:`street-${i}`,target:b,distance:b.scale*1.05,height:b.height*.25,yaw:.3+i*2.1}]),
  ];
  for(const v of views){
    await evaluate(`(()=>{const r=__godboxRenderer,c=r.camera,t=${JSON.stringify(v.target)};
      c.position.set(t.x+Math.sin(${v.yaw})*${v.distance},t.y+${v.height},t.z+Math.cos(${v.yaw})*${v.distance});c.lookAt(t.x,t.y+(t.height??0)*.45,t.z);c.updateMatrixWorld();})()`);
    await sleep(300);await evaluate('__svgDraw()');await settle();await sleep(200);
    v.demand=await evaluate(`(()=>{const f=__godboxRenderer.assetBuilder.facadeTextures;return [...f.entries.values()].sort((a,b)=>b.demand-a.demand).slice(0,4).map(e=>({demand:Math.round(e.demand),resolution:e.resolution,distance:+e.distance.toFixed(2),density:Math.round(e.texelDensity)}));})()`);
    await sheet(`game-${v.name}`,`${v.name} · ${v.target.archetype} ${v.target.period}`);
    v.near=await evaluate(`(()=>{const r=__godboxRenderer,f=r.assetBuilder.facadeTextures,eye=r.camera.position,out=[];
      r.scene.traverseVisible(o=>{if(!o.isMesh||!String(o.material&&o.material.name).includes(":svg-facade"))return;
        const p=o.getWorldPosition(eye.clone());const d=p.distanceTo(eye);if(d>3)return;
        const e=f.materialEntries.get(o.material),t=o.geometry.getAttribute('aFacadeTile');let lo=Infinity,hi=-Infinity;
        if(t)for(let i=0;i<Math.min(t.count,400);i++){lo=Math.min(lo,t.getX(i));hi=Math.max(hi,t.getX(i));}
        const s=new eye.constructor();o.getWorldScale(s);
        const props=r.renderer.properties.get(o.material),u=props.uniforms||{};
        const rect=u.gbTileRect&&u.gbTileRect.value;let sample=null;
        if(rect&&e&&e.textures.albedo.image&&e.textures.albedo.image.getContext){const c=e.textures.albedo.image,ctx=c.getContext('2d');
          const x=Math.floor((rect.x+rect.z*.5)*c.width),y=Math.floor((1-(rect.y+rect.w*.5))*c.height);const px=ctx.getImageData(x-20,y-20,40,40).data;let mn=255,mx=0;for(let i=0;i<px.length;i+=4){mn=Math.min(mn,px[i]);mx=Math.max(mx,px[i]);}sample=[mn,mx];}
        out.push({gbKeys:Object.keys(u).filter(k=>k.startsWith('gb')).join(','),hook:String(o.material.onBeforeCompile).slice(0,60),key:String(o.material.customProgramCacheKey()).slice(-40),version:o.material.version,uni:!!u.gbTileRect,rect:rect&&[rect.x,rect.y,rect.z,rect.w].map(v=>+v.toFixed(3)),on:u.gbTileOn&&u.gbTileOn.value,scaleU:u.gbTileScale&&+u.gbTileScale.value.toFixed(2),ready:u.gbFacadeReady&&u.gbFacadeReady.value,strength:u.gbFacadeStrength&&u.gbFacadeStrength.value,sample,prog:props.currentProgram&&props.currentProgram.name,mat:o.material.name,d:+d.toFixed(2),res:e&&e.resolution,state:e&&e.state,img:e&&e.textures.albedo.image&&e.textures.albedo.image.width,tile:t?[+lo.toFixed(3),+hi.toFixed(3)]:null,uv:!!o.geometry.getAttribute('aFacadeUv'),scale:+s.x.toFixed(3),lodParent:!!(o.parent&&o.parent.parent&&o.parent.parent.isLOD),name:o.parent&&o.parent.name});});
      return out.slice(0,8);})()`);
    console.log('near',JSON.stringify(v.near));
    report.views.push({name:v.name,archetype:v.target.archetype,period:v.target.period,demand:v.demand,near:v.near});
    console.log(v.name,JSON.stringify(v.demand));
  }
  report.facade=await evaluate('__godboxRenderer.assetBuilder.facadeTextures.stats()');
  report.render=await evaluate('({...__godboxRenderer.renderer.info.render,...__godboxRenderer.renderer.info.memory})');
}finally{
  writeFileSync(`${out}/game.json`,JSON.stringify(report,null,2));
  if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}else browser.kill();
  await sleep(500);if(browser.exitCode===null)browser.kill();
}
console.log(JSON.stringify({views:report.views.length,facade:report.facade,errors:errors.slice(0,5)}));
