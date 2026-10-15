/** Side-by-side SVG-off | SVG-on review sheets from the production architecture browser.
 * Each sheet shares geometry, lighting and camera; only the artwork toggle changes.
 *
 *   node scripts/perf/svg-art-review.mjs <out-dir> <case,...> [--views overview,face,eye,detail,oblique] [--street period:archetypes]
 *
 * A case is `archetype-period-scenario`, e.g. house-medieval-timber. Requires `npm run dev -- --port 5183`. */
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:fallback;};
const out=args[0]??'output/svg-art-review';mkdirSync(out,{recursive:true});
const cases=(args[1]&&!args[1].startsWith('--')?args[1]:'').split(',').filter(Boolean);
const views=option('views','overview,face,detail').split(',');
const streets=(option('street','')).split(',').filter(Boolean);
const lighting=option('light','day');
const port=process.env.GODBOX_PORT??5183;
const browserPath=[process.env.GODBOX_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const profile=mkdtempSync(join(tmpdir(),'svg-art-review-'));
const W=Number(option('width',1100)),H=Number(option('height',800));
const browser=spawn(browserPath,['--headless=new','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run',`--window-size=${W},${H}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0;const pending=new Map(),errors=[];
function send(method,params={}){const n=++id;socket.send(JSON.stringify({id:n,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timed out`));},240000);pending.set(n,{resolve,reject,timer});});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
const qa=s=>evaluate(`godboxArchitectureQa.${s}`);
async function ready(){for(let i=0;i<600;i++){const s=await evaluate('window.godboxArchitectureQa?.stats()').catch(()=>null);if(s?.subjects.length&&!s.facade.pending && !s.preparation?.pending)return s;await sleep(100);}throw new Error('Artwork readiness timeout');}
async function grab(){return (await send('Page.captureScreenshot',{format:'png'})).data;}
/** Composes the two captures in the page itself, so no image library is needed. */
async function sheet(name,title){
  await qa('svg(false)');await sleep(30);const off=await grab();
  await qa('svg(true)');await sleep(30);const on=await grab();
  const jpeg=await evaluate(`(async()=>{const load=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s;});
    const a=await load(${JSON.stringify(off)}),b=await load(${JSON.stringify(on)});const c=document.createElement('canvas');c.width=a.width*2+6;c.height=a.height+28;
    const g=c.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,c.width,c.height);g.drawImage(a,0,28);g.drawImage(b,a.width+6,28);
    g.fillStyle='#eee';g.font='16px sans-serif';g.fillText('SVG off  ·  ${title}',8,19);g.fillText('SVG on',a.width+14,19);return c.toDataURL('image/jpeg',.9).slice(23);})()`);
  writeFileSync(`${out}/${name}.jpg`,Buffer.from(jpeg,'base64'));
  const delta=await qa('compare()');
  return {name,meanChannelDelta:+delta.meanChannelDelta.toFixed(2),changedPixelFraction:+delta.changedPixelFraction.toFixed(4),glError:delta.glError};
}
const VIEW={
  overview:'camera(.62,.3)',
  high:'camera(.8,.62)',
  face:'face(0,1.25)',
  rear:'face(2,1.25)',
  side:'face(1,1.25)',
  eye:'face(0,.55,.15,.42,.5)',
  detail:'face(0,.32,.12,.3,.25)',
  oblique:'face(0,.9,.35,.55,.9)',
};
const report={cases:[],streets:[],errors};
try{
  let debug;for(let i=0;i<200&&!debug;i++){const path=join(profile,'DevToolsActivePort');if(existsSync(path)){try{debug=Number(readFileSync(path,'utf8').split('\n')[0]);}catch{/* still starting */}}if(!debug)await sleep(100);}
  const page=(await fetch(`http://127.0.0.1:${debug}/json/list`).then(r=>r.json())).find(p=>p.type==='page');
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(m.params.type))errors.push(m.params.args.map(a=>a.value??a.description).join(' ').slice(0,400));};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
  for(const c of cases) for(let attempt=0;attempt<2;attempt++) try {
    const [archetype,period,...rest]=c.split('-');const scenario=rest.join('-')||'auto';
    // Hyphenated archetypes (animal-pen, civic-hall…) are passed with '_' in place of '-'.
    const arch=archetype.replaceAll('_','-');
    const seed=option('seed','art-review');
    await send('Page.navigate',{url:`http://localhost:${port}/architecture-browser.html?view=solo&archetype=${arch}&period=${period}&material-scenario=${scenario}&culture=highland&stage=7&seed=${seed}&full-detail=true${lighting!=='day'?`&lighting=${lighting}`:''}`});
    await sleep(300);await ready();await qa('labels(false)');
    const record={id:c,views:[]};report.cases.push(record);
    for(const v of views){await qa(VIEW[v]);await sleep(50);await ready();record.views.push(await sheet(`${c}-${v}`,`${c} ${v}`));}
    record.stats=(await qa('stats()')).facade;
    console.log(c,JSON.stringify(record.views.map(v=>[v.name,v.meanChannelDelta])));
    break;
  } catch(error) { console.log(c,'attempt',attempt,'failed',String(error).slice(0,200)); if(report.cases.at(-1)?.id===c)report.cases.pop(); }
  for(const s of streets){
    const [period,list]=s.split(':');const subjects=(list??'house').split('+');
    await send('Page.navigate',{url:`http://localhost:${port}/architecture-browser.html?view=solo&archetype=${subjects[0]}&period=${period}&culture=highland&stage=7&seed=street&full-detail=true${lighting!=='day'?`&lighting=${lighting}`:''}`});
    await sleep(300);await ready();await qa('labels(false)');
    await qa(`street(${Number(option('count',10))},${JSON.stringify(subjects)},.55,.3)`);await sleep(200);await ready();
    const shots=[await sheet(`street-${period}-${subjects.join('+')}`,`street ${period}`)];
    if(await evaluate('typeof godboxArchitectureQa.streetEye')==='function'){await qa('streetEye()');await sleep(100);await ready();shots.push(await sheet(`street-${period}-${subjects.join('+')}-eye`,`street eye ${period}`));}
    const entry={id:s,shots,stats:(await qa('stats()')).facade};
    if(args.includes('--bench')){
      // Warm, alternating off/on samples on the same frame; SVG-off uses the untouched production shader.
      entry.bench=[];for(const enabled of [false,true,false,true])entry.bench.push({enabled,...await qa(`benchmark(${enabled},120)`)});
      const all=await qa('stats()');entry.render=all.render;entry.memory=all.memory;
      entry.heap=await evaluate('performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null');
      entry.gpu=await evaluate("(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):''})()");
    }
    report.streets.push(entry);
    console.log(s,JSON.stringify(shots.map(v=>[v.name,v.meanChannelDelta])));
  }
}finally{
  writeFileSync(`${out}/review.json`,JSON.stringify(report,null,2));
  if(socket?.readyState===WebSocket.OPEN){await send('Browser.close').catch(()=>{});socket.close();}else browser.kill();
  await sleep(500);if(browser.exitCode===null)browser.kill();
}
if(errors.length)console.log('errors',errors.slice(0,10));
