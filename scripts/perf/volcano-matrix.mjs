/** Real WebGL acceptance matrix. Start Vite first; GODBOX_PORT defaults to 5181. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const port = Number(process.env.GODBOX_PORT ?? 5181);
const debugPort = Number(process.env.GODBOX_CDP_PORT ?? 9231);
const output = resolve(process.argv[2] ?? 'output/volcano');
mkdirSync(output, { recursive: true });
const browser = [process.env.GODBOX_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(path => path && existsSync(path));
if (!browser) throw new Error('Set GODBOX_BROWSER to a Chromium executable.');
const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-gpu-sandbox',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'godbox-volcano-'))}`,
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const request = ++id;
    const timeout = setTimeout(() => { pending.delete(request); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(request, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: request, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
try {
  let target;
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(page => page.type === 'page'); } catch { /* browser starting */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Browser did not start.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const runtimeErrors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  };
  await send('Runtime.enable');
  const reports = [];
  for (const phase of ['dormant', 'unrest', 'erupting', 'cooling']) for (const night of [false, true]) {
    runtimeErrors.length = 0;
    const name = `${phase}-${night ? 'night' : 'day'}`;
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/volcano-preview.html?phase=${phase}&still${night ? '&night' : ''}` });
    let report;
    for (let attempt = 0; attempt < 120; attempt++) {
      const raw = await evaluate('document.getElementById("webgl-result")?.textContent');
      if (raw) { const parsed = JSON.parse(raw); if (parsed.complete && parsed.phase === phase) { report = parsed; break; } }
      await sleep(250);
    }
    if (!report) throw new Error(`${name} did not finish: ${JSON.stringify(runtimeErrors)}`);
    reports.push({ name, ...report, runtimeErrors: [...runtimeErrors] });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(JSON.stringify(reports.at(-1)));
    if (report.errors.length || report.glError || !report.visible || runtimeErrors.length) throw new Error(`${name} failed WebGL validation`);
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(reports, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch { /* process already exited */ }
    socket.close();
  }
  child.kill();
  // Chromium can leave the CDP close handshake pending after shutting down on Windows.
  setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref();
}
