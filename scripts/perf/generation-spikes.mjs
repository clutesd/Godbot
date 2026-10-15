/** Isolated main-thread preparation calls and animation-frame gaps, with identical production inputs. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out = process.argv[2] ?? 'output/generation-spikes';
mkdirSync(out, { recursive: true });
const path = [process.env.GODBOX_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
if (!path) throw new Error('Chromium required');
const profile = mkdtempSync(join(tmpdir(), 'godbox-generation-'));
const browser = spawn(path, ['--headless=new', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, id = 0;
const pending = new Map(), errors = [], report = { errors, runs: [] };
function send(method, params = {}) {
  const n = ++id;
  socket.send(JSON.stringify({ id: n, method, params }));
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method} timed out`)); }, 180000); pending.set(n, { resolve, reject, timer }); });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
try {
  let port;
  for (let i = 0; i < 200 && !port; i++) { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* starting */ } if (!port) await sleep(100); }
  const page = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(p => p.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data), p = pending.get(message.id);
    if (p) { clearTimeout(p.timer); pending.delete(message.id); if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${process.env.GODBOX_PORT ?? 5183}/architecture-browser.html?view=solo&archetype=house&period=industrial&material-scenario=brick&full-detail=true` });
  for (let i = 0; i < 600; i++) {
    const s = await evaluate('window.godboxArchitectureQa?.stats()').catch(() => null);
    if (s?.subjects.length && !s.facade.pending && !s.preparation.pending) break;
    if (i === 599) throw new Error('Viewer preparation timed out');
    await sleep(100);
  }
  for (const background of [false, true]) {
    if (background) report.nativeSvgBitmapDecode = await evaluate(`(async()=>{try{const bitmap=await createImageBitmap(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'],{type:'image/svg+xml'}));bitmap.close();return true;}catch{return false;}})()`);
    await send('HeapProfiler.collectGarbage'); await sleep(300);
    const result = await evaluate(`godboxArchitectureQa.generation(${Number(process.argv[3] ?? 8)},${background})`);
    report.runs.push(result); console.log(JSON.stringify(result));
  }
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); } else browser.kill();
  await sleep(500); if (browser.exitCode === null) browser.kill();
}
if (errors.length || report.runs.some(r => r.facade.failed || r.facade.pending || r.preparation.failed)) process.exitCode = 1;
