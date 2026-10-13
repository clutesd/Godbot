/** Real WebGL acceptance matrix for the production-derived hybrid workshop.
 * Run Vite on 5179, then node scripts/perf/hybrid-facades.mjs [artifact-directory]. */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const PORT = Number(process.env.GODBOX_PORT ?? 5179);
const DEBUG_PORT = 9235;
const OUT_DIR = process.argv[2] ?? 'node_modules/.tmp/hybrid-facades';
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function cdpTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return response.json();
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
}

async function connect(urlFragment) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await cdpTargets();
      const page = targets.find(t => t.type === 'page' && t.url.includes(urlFragment));
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', () => reject(new Error('socket error')), { once: true });
        });
        return new Session(socket);
      }
    } catch { /* still starting */ }
    await sleep(500);
  }
  throw new Error(`could not attach over CDP to ${urlFragment}`);
}

const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function launchBrowser(page) {
  const browserPath = BROWSER_CANDIDATES.find(p => existsSync(p));
  if (!browserPath) throw new Error('no chromium-family browser found');
  const userDataDir = `C:/Users/Colin/AppData/Local/Temp/godbox-hybrid-facade-profile`;
  return spawn(browserPath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--window-size=1600,1000',
    `http://localhost:${PORT}/${page}`,
  ], { stdio: 'ignore' });
}

async function shot(session, outPath) {
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log('saved', outPath);
}


const errors = [];
const page = 'architecture-browser.html?view=street&archetype=workshop&period=medieval&material-scenario=stone&culture=highland&stage=7&seed=hybrid-workshop&program=auto';
const browser = launchBrowser(page);
let session;
const report = { cases: [], benchmarks: [], errors };
try {
  session = await connect('architecture-browser');
  await session.send('Runtime.enable');
  session.socket.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description));
  });
  for (let i = 0; i < 120; i++) {
    const ready = await session.evaluate('window.godboxArchitectureQa?.stats()');
    if (ready?.facade.ready) break;
    await sleep(250);
  }
  const initial = await session.evaluate('godboxArchitectureQa.stats()');
  report.initial = initial;
  const surfaces = await session.evaluate('godboxArchitectureQa.surfaces()');
  report.surfaces = surfaces.map(surface => ({ name: surface.name, material: surface.material, atlas: surface.atlas }));
  for (const surface of surfaces) if (surface.pixels) writeFileSync(`${OUT_DIR}/${surface.atlas}.png`, Buffer.from(surface.pixels.split(',')[1], 'base64'));
  report.gpu = await session.evaluate(`(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })()`);
  if (!initial.facade.ready || !initial.subjects.some(s => s.status === 'hybrid')) throw new Error('Workshop did not enter the actual hybrid pipeline');
  await session.evaluate('godboxArchitectureQa.camera(0.4, 0.12)');
  for (const enabled of [false, true, false, true]) {
    report.benchmarks.push({ enabled, ...await session.evaluate(`godboxArchitectureQa.benchmark(${enabled}, 90)`) });
  }
  await session.evaluate("document.getElementById('hybrid-facades').checked = false; document.getElementById('hybrid-facades').dispatchEvent(new Event('change'))");
  await shot(session, `${OUT_DIR}/before.png`);
  await session.evaluate("document.getElementById('hybrid-facades').checked = true; document.getElementById('hybrid-facades').dispatchEvent(new Event('change'))");
  await shot(session, `${OUT_DIR}/after.png`);
  await session.evaluate('godboxArchitectureQa.detail()');
  for (const enabled of [false, true]) {
    await session.evaluate(`document.getElementById('hybrid-facades').checked = ${enabled}; document.getElementById('hybrid-facades').dispatchEvent(new Event('change'))`);
    await sleep(80); await shot(session, `${OUT_DIR}/detail-${enabled ? 'after' : 'before'}.png`);
  }
  await session.send('Page.navigate', { url: `http://localhost:${PORT}/${page}` });
  await sleep(1500);
  for (const lighting of ['day', 'raking', 'overcast', 'night']) {
    await session.evaluate(`document.getElementById('lighting').value = '${lighting}'; document.getElementById('lighting').dispatchEvent(new Event('change'))`);
    for (const pitch of [0.08, 0.5]) for (let heading = 0; heading < 8; heading++) {
      await session.evaluate(`godboxArchitectureQa.camera(${heading * Math.PI / 4}, ${pitch})`);
      await sleep(70);
      await shot(session, `${OUT_DIR}/${lighting}-${pitch}-${heading}.png`);
      report.cases.push({ lighting, pitch, heading, ...await session.evaluate('godboxArchitectureQa.stats()') });
    }
  }
  await session.send('Page.navigate', { url: `http://localhost:${PORT}/${page}` });
  await sleep(1500);
  await session.evaluate('godboxArchitectureQa.crowd(64)');
  report.crowd = [];
  for (const enabled of [false, true, false, true]) report.crowd.push({ enabled, ...await session.evaluate(`godboxArchitectureQa.benchmark(${enabled}, 90)`) });
  // Each stage uses a fresh owner: exercise raster admission, not a prior scene's budget fallback.
  for (let stage = 0; stage <= 7; stage++) {
    await session.send('Page.navigate', { url: `http://localhost:${PORT}/${page.replace('stage=7', `stage=${stage}`)}` });
    await sleep(1200);
    const stats = await session.evaluate('godboxArchitectureQa.stats()');
    report.cases.push({ stage, ...stats });
    await shot(session, `${OUT_DIR}/stage-${stage}.png`);
  }
  // History/culture variations use the same production inputs and authority.
  for (const [period, culture] of [['earlyModern', 'river'], ['industrial', 'sun'], ['medieval', 'moon'], ['classical', 'river']]) {
    await session.send('Page.navigate', { url: `http://localhost:${PORT}/${page.replace('period=medieval', `period=${period}`).replace('culture=highland', `culture=${culture}`)}` });
    await sleep(1500);
    report.cases.push({ period, culture, ...await session.evaluate('godboxArchitectureQa.stats()') });
    await shot(session, `${OUT_DIR}/${period}-${culture}.png`);
  }
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ initial: report.initial.facade, benchmarks: report.benchmarks, crowd: report.crowd, cases: report.cases.length, errors }, null, 2));
  if (errors.length) throw new Error('Browser reported rendering errors');
} finally {
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
  session?.socket.close(); browser.kill();
}
