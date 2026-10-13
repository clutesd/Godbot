/**
 * Visual validation matrix for the baked structural AO pass (GODBOX occlusion review).
 *
 * Part A drives the architecture browser (deterministic archetype/period/material selection,
 * controllable occlusion strength) across building types at human scale, with occlusion
 * off/default, to check for defects per building category.
 *
 * Part B drives the production app (index.html) at a fixed camera and a grown settlement,
 * sampling the real day/night light rig at several `elapsedSeconds` values to cover midday,
 * low sun and night.
 *
 * Throwaway tooling for this review, not part of the maintained perf harness.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const PORT = 5179;
const DEBUG_PORT = 9224;
const OUT_DIR = process.argv[2] ?? 'C:/Users/Colin/AppData/Local/Temp/claude/occlusion-matrix';
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
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 60_000);
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
  const userDataDir = `C:/Users/Colin/AppData/Local/Temp/claude/occlusion-matrix-profile`;
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

// --- Part A: architecture browser, building-type sweep -------------------------------------

const BUILDING_CASES = [
  { archetype: 'house', period: 'medieval', label: 'house-timber' },
  { archetype: 'workshop', period: 'medieval', label: 'workshop-masonry' },
  { archetype: 'granary', period: 'medieval', label: 'granary-masonry' },
  { archetype: 'mill', period: 'medieval', label: 'mill-watermill' },
  { archetype: 'factory', period: 'industrial', label: 'factory-industrial' },
  { archetype: 'civic-hall', period: 'modern', label: 'civic-hall-modern' },
];

async function runPartA() {
  const proc = launchBrowser('architecture-browser.html');
  try {
    const session = await connect(String(PORT));
    await session.send('Page.enable');
    for (let tries = 0; tries < 40; tries++) {
      const ready = await session.evaluate(`!!document.querySelector('canvas')`);
      if (ready) break;
      await sleep(500);
    }
    await sleep(1500);

    await session.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.textContent.trim() === 'Street');
      if (btn) btn.click();
    })()`);
    await sleep(800);

    for (const { archetype, period, label } of BUILDING_CASES) {
      const applied = await session.evaluate(`(() => {
        const setNative = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const archetypeEl = document.getElementById('archetype');
        const periodEl = document.getElementById('period');
        if (!archetypeEl || !periodEl) return 'missing-controls';
        setNative(archetypeEl, '${archetype}');
        setNative(periodEl, '${period}');
        return { archetype: archetypeEl.value, period: periodEl.value };
      })()`);
      console.log(label, 'applied:', JSON.stringify(applied));
      await sleep(1200);

      for (const occlusion of [0, 1]) {
        await session.evaluate(`(() => {
          const input = document.getElementById('occlusion');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '${occlusion}');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await sleep(900);
        await shot(session, `${OUT_DIR}/A-${label}-occ${occlusion}.png`);
      }
    }
  } finally {
    proc.kill();
  }
}

// --- Part B: production app, lighting sweep -------------------------------------------------

/**
 * `elapsedSeconds` values chosen against GodboxRenderer.updateDayNight's ~58s cycle
 * (phase = elapsedSeconds/58 + 0.16; daylight = smoothstep(sin(phase*2pi)*0.5+0.5, 0.12, 0.72)):
 * these land on full midday, a low-angle sun near the daylight threshold, and deep night.
 */
const LIGHT_CASES = [
  { seconds: 15, label: 'midday' },
  { seconds: 28, label: 'low-angle-dusk' },
  { seconds: 43, label: 'night' },
  { seconds: 2, label: 'low-angle-dawn' },
];

async function runPartB() {
  const proc = launchBrowser('index.html');
  try {
    const session = await connect(`${PORT}/`);
    await session.send('Page.enable');
    for (let tries = 0; tries < 60; tries++) {
      const ready = await session.evaluate(`!!window.__godboxRenderer`);
      if (ready) break;
      await sleep(500);
    }
    // Grow the settlement so a mix of building types is actually standing.
    const advance = await session.evaluate(`(() => {
      if (!window.__godboxDebugAdvance) return 'no-debug-hook';
      return window.__godboxDebugAdvance(900);
    })()`);
    console.log('advanced settlement:', JSON.stringify(advance));
    await sleep(2000);

    for (const { seconds, label } of LIGHT_CASES) {
      const state = await session.evaluate(`(() => {
        const view = window.__godboxRenderer;
        view.updateDayNight(${seconds});
        return {
          sun: view.sun.intensity, moon: view.moon.intensity, hemisphere: view.hemisphere.intensity,
          sunY: view.sun.position.y,
        };
      })()`);
      console.log(label, JSON.stringify(state));
      await sleep(300);
      await shot(session, `${OUT_DIR}/B-${label}.png`);
    }
  } finally {
    proc.kill();
  }
}

async function main() {
  await runPartA();
  await runPartB();
  console.log('matrix complete ->', OUT_DIR);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
