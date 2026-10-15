/** Isolated headless WebGL regression capture, using the repository's Chromium/CDP test pattern. */
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=process.argv[2]??'output/architecture-flagships';mkdirSync(dir,{recursive:true});
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
 for(const id of ['all','court-house','town-house','threshing-barn','stable-yard','grain-store','smock-mill'])for(const neutral of [false,true]){
  await send('Page.navigate',{url:`http://127.0.0.1:5175/architecture-flagships.html?clean=1&case=${id}${neutral?'&neutral=1':''}`});
  let stats;
  for(let i=0;i<200;i++){await sleep(150);stats=await evaluate('window.godboxFlagshipQa?.stats()').catch(()=>undefined);if(stats?.drawCalls>0)break;}
  if(!stats?.drawCalls){report.diagnostics=await evaluate('({url:location.href,title:document.title,text:document.body.innerText,ready:document.readyState})');const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(dir+'/failed.png',Buffer.from(s.data,'base64'));throw new Error(id+' did not render');}
  await sleep(700);stats=await evaluate('godboxFlagshipQa.stats()');
  const gpu=await evaluate("(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);})()");
  if(id==='smock-mill'){await evaluate('godboxFlagshipQa.advance(2)');const later=await evaluate('godboxFlagshipQa.stats()');if(JSON.stringify(stats.rotations)===JSON.stringify(later.rotations)){report.failedMotion={stats,later};throw new Error('Production wind machinery did not advance');}}
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${id}-${neutral?'neutral':'materials'}.png`,Buffer.from(shot.data,'base64'));
  report.cases.push({id,neutral,gpu,...stats});
 }
 if(errors.length||report.cases.some(c=>c.errors.length))throw new Error('WebGL review reported runtime errors');
 console.log(`Captured ${report.cases.length} production WebGL views; live mill motion verified.`);
}finally{
 writeFileSync(`${dir}/webgl-report.json`,JSON.stringify(report,null,2));
 if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}else browser.kill();
}
