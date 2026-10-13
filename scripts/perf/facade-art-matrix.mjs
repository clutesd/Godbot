/**
 * Visual + performance matrix for the SVG architectural art pass, driven through real WebGL.
 *
 *   npx vite --port 5181 --strictPort        (in another terminal)
 *   node scripts/perf/facade-art-matrix.mjs <out-dir> [hybrid|procedural] [--quick] [--glazing]
 *
 * `procedural` captures the untouched production shading (facade strength 0) for a before/after.
 * `--glazing` reviews 19 period/archetype variants, four lights/elevations and 32 workshop stages.
 * Every framing is computed from the building's own FacadePlan, so the same shot list lines up
 * across code revisions. Writes PNG/JPEG shots, contact sheets are assembled separately.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const PORT = Number(process.env.GODBOX_PORT ?? 5181);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9243);
const OUT = process.argv[2] ?? 'output/facade-art/run';
const MODE = process.argv[3] ?? 'hybrid';
const QUICK = process.argv.includes('--quick');
const GLAZING = process.argv.includes('--glazing');
const ROOF_CHECK = process.argv.includes('--roof-check');
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BASE = `http://localhost:${PORT}/architecture-browser.html?view=street&archetype=workshop&material-scenario=stone&stage=7&program=auto&shadows=true`;
const subject = (extra = {}) => {
  const params = { period: 'medieval', culture: 'highland', climate: 'temperate', seed: 'hybrid-workshop', ...extra };
  const url = new URL(BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('hybrid-facades', String(MODE === 'hybrid'));
  return url.href;
};

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!edge) throw new Error('no chromium-family browser found');
const browser = spawn(edge, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${process.env.TEMP ?? '.'}/godbox-facade-art-${DEBUG_PORT}`,
  '--headless=new', '--disable-extensions', '--no-first-run', '--disable-gpu-sandbox', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });

let socket; let nextId = 1; const pending = new Map(); const errors = [];
const send = (method, params = {}) => {
  const id = nextId++; socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 180_000);
    pending.set(id, { resolve, reject, timer });
  });
};
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const shot = async (name, clip = { x: 0, y: 0, width: 1600, height: 1000 }) => {
  const { data } = await send('Page.captureScreenshot', { format: name.endsWith('.jpg') ? 'jpeg' : 'png', quality: 90, clip: { ...clip, scale: 1 } });
  writeFileSync(`${OUT}/${name}`, Buffer.from(data, 'base64'));
};
const qa = expression => evaluate(`godboxArchitectureQa.${expression}`);
async function open(url) {
  await send('Page.navigate', { url });
  await sleep(350);
  for (let i = 0; i < 240; i++) {
    const ready = await evaluate('window.godboxArchitectureQa?.stats()').catch(() => undefined);
    if (ready && ready.facade.pending === 0 && ready.subjects.length) break;
    await sleep(250);
  }
  await qa('labels(false)');
  await sleep(400);
}
async function waitFacades() {
  for (let i = 0; i < 240; i++) { const s = await qa('stats()'); if (s.facade.pending === 0) return s; await sleep(250); }
  return qa('stats()');
}
const light = async mode => { await evaluate(`(() => { const s = document.getElementById('lighting'); s.value = '${mode}'; s.dispatchEvent(new Event('change')); })()`); await sleep(120); };

const report = { mode: MODE, cases: [], benchmarks: {}, errors };
try {
  for (let attempt = 0; attempt < 60 && !socket; attempt++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === 'page');
      if (page) { socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; }); }
    } catch { socket = undefined; await sleep(300); }
  }
  socket.onmessage = event => {
    const m = JSON.parse(event.data); const entry = pending.get(m.id);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); if (m.error) entry.reject(new Error(m.error.message)); else entry.resolve(m.result); }
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  if (GLAZING) {
    for (const period of ['earlyModern', 'industrial', 'modern', 'contemporary']) {
      for (const archetype of ['house', 'civic-hall', 'market', 'workshop', 'factory']) {
        if (period === 'earlyModern' && archetype === 'factory') continue;
        await open(subject({ period, archetype, 'material-scenario': period === 'modern' || period === 'contemporary' ? 'composite' : 'glazed-masonry' }));
        const stats = await waitFacades();
        if (stats.facade.failed || !stats.facade.ready) throw new Error(`Missing SVG glazing: ${period}/${archetype}`);
        await qa('face(0, 3.2)'); await sleep(100);
        const record = { period, archetype, ...stats, surfaces: await qa('surfaces()').then(s => s.map(surface => ({ name: surface.name, material: surface.material, atlas: surface.atlas, night: surface.night }))) };
        report.cases.push(record);
        await qa('camera(0.62, 0.38)'); await light('day'); await shot(`${period}-${archetype}.jpg`);
        if (!QUICK) {
          for (const mode of (ROOF_CHECK ? ['day'] : ['day', 'raking', 'overcast', 'night'])) {
            await light(mode);
            for (let face = 0; face < 4; face++) {
              await qa(`face(${face}, 2.2)`); await shot(`${period}-${archetype}-${mode}-${face}.jpg`);
            }
            if (mode === 'night') {
              record.night = await qa('surfaces()').then(s => s.map(surface => surface.night));
              if (!record.night.length || record.night.some(value => !(value > 0))) throw new Error(`Night palette did not reach glazing: ${period}/${archetype}`);
            }
          }
        }
        if (archetype === 'workshop' || archetype === 'civic-hall') {
          const art = await qa('artwork()');
          if (art) writeFileSync(`${OUT}/${period}-${archetype}.svg`, art.albedo);
        }
      }
    }
    await light('day'); await qa('camera(0.4, 0.12)');
    report.benchmarks.single = [];
    for (const enabled of [false, true, false, true]) report.benchmarks.single.push({ enabled, ...await qa(`benchmark(${enabled}, 90)`) });
    report.gpu = await evaluate(`(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })()`);
    if (!QUICK) {
      await qa('crowd(64)');
      report.benchmarks.crowd = [];
      for (const enabled of [false, true, false, true]) report.benchmarks.crowd.push({ enabled, ...await qa(`benchmark(${enabled}, 90)`) });
      report.stages = [];
      for (const period of ['earlyModern', 'industrial', 'modern', 'contemporary']) for (let stage = 0; stage < 8; stage++) {
        await open(subject({ period, archetype: 'workshop', stage, 'material-scenario': period === 'modern' || period === 'contemporary' ? 'composite' : 'glazed-masonry' }));
        await qa('face(0, 1.45)'); await light('day'); await shot(`stage-${period}-${stage}.jpg`);
        report.stages.push({ period, stage, ...await qa('stats()') });
      }
    }
    console.log(JSON.stringify({ cases: report.cases.map(c => ({ period: c.period, archetype: c.archetype, glazing: c.subjects[0]?.spec?.materials.glazing, facade: c.facade, surfaces: c.surfaces.length })), benchmarks: report.benchmarks, errors }, null, 1));
  } else {
  await open(subject());
  report.initial = await waitFacades();
  const artwork = await qa('artwork()');
  if (artwork) for (const layer of ['albedo', 'relief', 'surface']) {
    writeFileSync(`${OUT}/facade-${layer}.svg`, artwork[layer]);
    const png = await evaluate(`(async () => {
      const svg = ${JSON.stringify(artwork[layer])};
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
        canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL().split(',')[1];
      } finally { URL.revokeObjectURL(url); }
    })()`);
    writeFileSync(`${OUT}/facade-${layer}.png`, Buffer.from(png, 'base64'));
  }
  report.gpu = await evaluate(`(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })()`);
  await light('day');
  // All sides: eight headings at a standing and an elevated pitch.
  for (const mode of QUICK ? ['day'] : ['day', 'raking', 'overcast', 'night']) {
  await light(mode);
  for (const pitch of QUICK ? [0.14] : [0.14, 0.45]) for (let heading = 0; heading < 8; heading++) {
    await qa(`camera(${heading * Math.PI / 4}, ${pitch})`); await sleep(60);
    await shot(`orbit-${mode}-${pitch}-${heading}.jpg`);
    report.cases.push({ lighting: mode, pitch, heading });
  }
  }
  await light('day');
  // Four elevations, head on, and oblique close-ups for relief.
  for (let face = 0; face < 4; face++) { await qa(`face(${face}, 2.2)`); await sleep(60); await shot(`elevation-${face}.jpg`); }
  await qa('face(0, 0.95, 0, 0.32, 0.38)'); await sleep(60); await shot('close-door.png');
  await qa('face(2, 0.62, 0.16, 0.6, 0.32)'); await sleep(60); await shot('close-window.png');
  await qa('detail(0.78)'); await sleep(60); await shot('close-corner.png');
  for (const mode of ['day', 'raking', 'overcast', 'night']) {
    await light(mode);
    await qa('camera(0.62, 0.16)'); await sleep(80); await shot(`light-${mode}.jpg`);
    await qa('face(2, 0.95, 0, 0.5, 0.55)'); await sleep(80); await shot(`light-close-${mode}.jpg`);
  }
  await light('day');
  await qa('camera(0.4, 0.12)');
  report.benchmarks.single = [];
  for (const enabled of [false, true, false, true]) report.benchmarks.single.push({ enabled, ...await qa(`benchmark(${enabled}, 90)`) });
  await qa(`benchmark(${MODE === 'hybrid'}, 1)`);

  // Settlement: a seeded street of workshops between houses, at street and overview heights.
  await open(subject());
  await qa("street(10, ['workshop', 'workshop', 'house'], 0.55, 0.22)");
  report.street = await waitFacades(); await sleep(300);
  await shot('settlement-street.jpg');
  await qa('camera(0.9, 0.55)'); await sleep(80); await shot('settlement-overview.jpg');
  report.benchmarks.street = [];
  for (const enabled of [false, true, false, true]) report.benchmarks.street.push({ enabled, ...await qa(`benchmark(${enabled}, 90)`) });

  if (!QUICK) {
    await open(subject());
    await qa('crowd(64)');
    report.benchmarks.crowd = [];
    for (const enabled of [false, true, false, true]) report.benchmarks.crowd.push({ enabled, ...await qa(`benchmark(${enabled}, 90)`) });
    for (let stage = 0; stage <= 7; stage++) {
      await open(subject().replace('stage=7', `stage=${stage}`));
      await qa('camera(0.62, 0.2)'); await sleep(80);
      await shot(`stage-${stage}.jpg`);
      report.cases.push({ stage, ...(await qa('stats()')).facade });
    }
    for (const [period, culture, climate] of [['medieval', 'river', 'wet'], ['medieval', 'sun', 'arid'], ['medieval', 'moon', 'cold'],
      ['classical', 'highland', 'temperate'], ['earlyModern', 'highland', 'temperate'], ['industrial', 'river', 'temperate']]) {
      await open(subject({ period, culture, climate }));
      await qa('camera(0.62, 0.16)'); await sleep(80);
      await shot(`variant-${period}-${culture}-${climate}.jpg`);
      const stats = await qa('stats()');
      report.cases.push({ period, culture, climate, status: stats.subjects[0]?.status, facade: stats.facade });
    }
  }
  }
  console.log(JSON.stringify({ gpu: report.gpu, initial: report.initial?.facade, benchmarks: report.benchmarks, errors }, null, 1));
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  socket?.close(); browser.kill();
}
