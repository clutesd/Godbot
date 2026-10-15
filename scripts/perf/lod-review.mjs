/** LOD tier review sheets from the production architecture browser: every tier side by side, same camera.
 *
 *   node scripts/perf/lod-review.mjs <out-dir> <case,...> [--views near,street,settlement] [--street period:a+b] [--count 12]
 *
 * A case is `archetype-period-scenario` as in svg-art-review.mjs. Requires `npm run dev -- --port 5183`. */
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:fallback;};
const out=args[0]??'output/svg-art-review/lod';mkdirSync(out,{recursive:true});
const cases=(args[1]&&!args[1].startsWith('--')?args[1]:'').split(',').filter(Boolean);
const views=option('views','near,settlement').split(',');
const streets=(option('street','')).split(',').filter(Boolean);
const lighting=option('light','day');
const port=process.env.GODBOX_PORT??5183;
const browserPath=[process.env.GODBOX_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const profile=mkdtempSync(join(tmpdir(),'lod-review-'));
const W=Number(option('width',640)),H=Number(option('height',520));
const browser=spawn(browserPath,['--headless=new','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run',`--window-size=${W},${H}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0;const pending=new Map(),errors=[];
function send(method,params={}){const n=++id;socket.send(JSON.stringify({id:n,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timed out`));},240000);pending.set(n,{resolve,reject,timer});});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
const qa=s=>evaluate(`godboxArchitectureQa.${s}`);
async function ready(){for(let i=0;i<600;i++){const s=await evaluate('window.godboxArchitectureQa?.stats()').catch(()=>null);if(s?.subjects.length&&!s.facade.pending)return s;await sleep(100);}throw new Error('Artwork readiness timeout');}
async function grab(){return (await send('Page.captureScreenshot',{format:'png'})).data;}
const LABELS=['full detail (tier 0)','street (tier 1, 20+)','settlement (tier 2, 42+)','skyline (tier 3, 96+)'];
async function sheet(name,title,tiers=[0,1,2,3]){
  const shots=[],render=[];
  for(const t of tiers){await qa(`lod(${t})`);await sleep(40);await ready();await qa(`lod(${t})`);await sleep(40);shots.push(await grab());
    render.push((await qa('stats()')).render);}
  const jpeg=await evaluate(`(async()=>{const load=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s;});
    const imgs=await Promise.all(${JSON.stringify(shots)}.map(load));const w=imgs[0].width,h=imgs[0].height;const c=document.createElement('canvas');c.width=w*imgs.length+6*(imgs.length-1);c.height=h+28;
    const g=c.getContext('2d');g.fillStyle='#111';g.fillRect(0,0,c.width,c.height);g.fillStyle='#eee';g.font='15px sans-serif';
    const labels=${JSON.stringify(tiers.map(t=>LABELS[t]))};imgs.forEach((im,i)=>{g.drawImage(im,i*(w+6),28);g.fillText(labels[i]+(i===0?' · ${title}':''),i*(w+6)+8,19);});
    return c.toDataURL('image/jpeg',.9).slice(23);})()`);
  writeFileSync(`${out}/${name}.jpg`,Buffer.from(jpeg,'base64'));
  return {name,render};
}
/** yaw, pitch, radius in building spans, fov. `near` magnifies a distant tier so its construction is legible. */
const VIEW={
  near:{yaw:.62,pitch:.3,span:2.4,fov:38},
  street:{yaw:.62,pitch:.12,span:5,fov:38},
  settlement:{yaw:.62,pitch:.42,span:22,fov:14},
  roof:{yaw:.62,pitch:.3,span:2.4,fov:11,aim:.85},
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
    const arch=archetype.replaceAll('_','-');
    await send('Page.navigate',{url:`http://localhost:${port}/architecture-browser.html?view=solo&archetype=${arch}&period=${period}&material-scenario=${scenario}&culture=highland&stage=7&seed=${option('seed','art-review')}&full-detail=true${lighting!=='day'?`&lighting=${lighting}`:''}`});
    await sleep(300);await ready();await qa('labels(false)');
    const {span,height}=await qa('extent()');
    const record={id:c,span,height,views:[]};report.cases.push(record);
    for(const v of views){const p=VIEW[v];
      await qa(`orbit(${p.yaw},${p.pitch},${p.span*span},${p.fov},${height*(p.aim??.4)})`);
      record.views.push(await sheet(`${c}-${v}`,`${c} ${v}`));}
    console.log(c,'ok');break;
  } catch(error) { console.log(c,'attempt',attempt,'failed',String(error).slice(0,200)); if(report.cases.at(-1)?.id===c)report.cases.pop(); }
  for(const s of streets){
    const [period,list]=s.split(':');const subjects=(list??'house').split('+');
    await send('Page.navigate',{url:`http://localhost:${port}/architecture-browser.html?view=solo&archetype=${subjects[0]}&period=${period}&culture=highland&stage=7&seed=street&full-detail=true${lighting!=='day'?`&lighting=${lighting}`:''}`});
    await sleep(300);await ready();await qa('labels(false)');
    await qa(`street(${Number(option('count',12))},${JSON.stringify(subjects)},.55,.3)`);await sleep(200);await ready();
    const shots=[];
    for(const [v,yaw,pitch,radius,fov] of [['street',.55,.22,1,38],['settlement',.55,.5,3.2,22]]){
      const {span}=await qa('extent()');
      await qa(`orbit(${yaw},${pitch},${radius*span},${fov},.15)`);
      shots.push(await sheet(`street-${period}-${subjects.join('+')}-${v}`,`street ${period} ${v}`));
    }
    // Frame cost at the settlement camera: every building forced to full detail, then automatic tiers.
    const bench={};
    for(const [name,tier] of [['full',0],['auto',-1]]){await qa(`lod(${tier})`);await sleep(100);await ready();bench[name]=await qa('benchmark(true,120)');}
    bench.memory=(await qa('stats()')).memory;bench.facade=(await qa('stats()')).facade;
    report.streets.push({id:s,shots,bench});console.log('street',s,'ok',JSON.stringify(bench));
  }
} finally {
  writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  socket?.close();browser.kill();
}
