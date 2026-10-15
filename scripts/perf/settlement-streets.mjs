/** Isolated headless WebGL regression capture, using the repository's Chromium/CDP test pattern. */
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=process.argv[2]??'output/settlement-streets';mkdirSync(dir,{recursive:true});
const browserPath=[process.env.GODBOX_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
if(!browserPath)throw new Error('Chromium is required for production shader validation');
const profile=mkdtempSync(join(tmpdir(),'godbox-architecture-qa-'));
const browser=spawn(browserPath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--window-size=1440,1100','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket,nextId=1;const pending=new Map(),errors=[];
function send(method,params={}){const id=nextId++;socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
const report={cases:[],errors};
try{
 let port;
 for(let i=0;i<60;i++){const path=join(profile,'DevToolsActivePort');if(existsSync(path)){port=Number(readFileSync(path,'utf8').split('\n')[0]);break;}await sleep(200);}
 if(!port)throw new Error('Headless browser did not start');
 const page=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(p=>p.type==='page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 socket.onmessage=event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 const reviews = [
  {id:'medieval-street',query:'view=street&archetype=house&period=medieval&material-scenario=timber&culture=river&climate=temperate&seed=street-review'},
  {id:'classical-street',query:'view=street&archetype=house&period=classical&material-scenario=earth&culture=sun&climate=arid&seed=street-review'},
  {id:'industrial-street',query:'view=street&archetype=house&period=industrial&material-scenario=glazed-masonry&culture=river&climate=temperate&seed=street-review'},
  {id:'workshop-solo',query:'view=solo&archetype=workshop&period=medieval&material-scenario=stone&culture=highland&climate=temperate&seed=svg-review'},
  {id:'workshop-materials',query:'view=material-matrix&archetype=workshop&period=medieval&culture=highland&climate=temperate&seed=svg-review'},
 ];
 for(const review of reviews){
  await send('Page.navigate',{url:'http://127.0.0.1:5175/architecture-browser.html?'+review.query+'&full-detail=true&hybrid-facades=true'});
  let stats;
  for(let i=0;i<240;i++){await sleep(150);stats=await evaluate('window.godboxArchitectureQa?.stats()').catch(()=>undefined);if(stats?.subjects?.length&&stats.facade.pending===0)break;}
  if(!stats?.subjects?.length||stats.facade.pending)throw new Error(review.id+' did not finish rendering/rasterizing');
  await evaluate('godboxArchitectureQa.labels(false); godboxArchitectureQa.camera(.6,.52)');
  const setSvg=enabled=>evaluate(`(()=>{const c=document.getElementById('hybrid-facades');c.checked=${enabled};c.dispatchEvent(new Event('change'));godboxArchitectureQa.camera(.6,.52);})()`);
  await setSvg(true);
  let on=await evaluate('godboxArchitectureQa.stats()'), paintedOn=await evaluate('godboxArchitectureQa.surfaces().length');
  let shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${review.id}-svg-on.png`,Buffer.from(shot.data,'base64'));
  const originalShot=shot.data;
  if(review.id === 'workshop-materials' && paintedOn === 0)throw new Error('Workshop review has no SVG to verify');
  await setSvg(false);
  const off=await evaluate('godboxArchitectureQa.stats()'), paintedOff=await evaluate('godboxArchitectureQa.surfaces().length');
  shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${review.id}-svg-off.png`,Buffer.from(shot.data,'base64'));
  if(paintedOn&&paintedOff)throw new Error('SVG materials remained attached while disabled');
  if(on.render.calls!==off.render.calls||on.render.triangles!==off.render.triangles)throw new Error('SVG switch changed geometry or draw calls');
  if(paintedOn&&originalShot===shot.data)throw new Error('SVG switch did not visibly change the frame');
  await setSvg(true); const paintedRestored=await evaluate('godboxArchitectureQa.surfaces().length');
  if(paintedOn!==paintedRestored)throw new Error('SVG material restoration failed');
  await evaluate("(()=>{const c=document.getElementById('neutral-materials');c.checked=true;c.dispatchEvent(new Event('change'));godboxArchitectureQa.camera(.6,.52);})()");
  shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${review.id}-neutral.png`,Buffer.from(shot.data,'base64'));
  if(review.id.includes('street')) {
   await evaluate("godboxArchitectureQa.neutral(false); godboxArchitectureQa.svg(true); godboxArchitectureQa.streetEye()");
   shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${review.id}-eye.png`,Buffer.from(shot.data,'base64'));
  }
  const gpu=await evaluate("(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);})()");
  report.cases.push({id:review.id,gpu,svgOn:paintedOn,svgOff:paintedOff,svgRestored:paintedRestored,on,off});
 }
 // Rebuild while disabled, then restore: this catches lost clone bindings and exhausted atlases.
 await evaluate("(()=>{const n=document.getElementById('neutral-materials');n.checked=false;n.dispatchEvent(new Event('change'));const c=document.getElementById('hybrid-facades');c.checked=false;c.dispatchEvent(new Event('change'));const seed=document.getElementById('seed');seed.value='svg-rebuild-check';seed.dispatchEvent(new Event('change'));})()");
 for(let i=0;i<200;i++){await sleep(150);if((await evaluate('godboxArchitectureQa.stats().facade.pending'))===0)break;}
 await evaluate('godboxArchitectureQa.camera(.6,.52)');
 if(await evaluate('godboxArchitectureQa.surfaces().length'))throw new Error('Disabled SVG returned after a rebuild');
 await evaluate("(()=>{const c=document.getElementById('hybrid-facades');c.checked=true;c.dispatchEvent(new Event('change'));godboxArchitectureQa.camera(.6,.52);})()");
 if((await evaluate('godboxArchitectureQa.surfaces().length'))===0)throw new Error('SVG could not return after rebuilding while off');
 report.rebuildWhileOffVerified=true;
 if(errors.length||report.cases.some(c=>c.on.facade.failed))throw new Error('WebGL review reported runtime errors');
 console.log(`Captured ${report.cases.length*3+3} production street/facade views; SVG detach/restore and stable geometry verified.`);
}finally{
 writeFileSync(`${dir}/webgl-report.json`,JSON.stringify(report,null,2));
 if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}else browser.kill();
}
