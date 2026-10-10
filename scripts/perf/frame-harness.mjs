/**
 * Reproducible in-browser frame-pacing harness for GODBOX.
 *
 * Drives a real Chromium (Edge) over the DevTools Protocol against the Vite dev server, samples
 * the running observation, and reports the frame-time distribution, renderer scene statistics and
 * heap growth. Nothing here is mocked: it is the actual renderer on the actual GPU, which is the
 * only place GPU cost, draw calls and composited frame pacing are real.
 *
 * Usage:
 *   npx vite --port 5179 --strictPort          # in another terminal
 *   node scripts/perf/frame-harness.mjs [--seconds=40] [--scenario=name] [--headless] [--json]
 *
 * Requires a Chromium-family browser; set GODBOX_BROWSER to override autodetection.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.GODBOX_PORT ?? 5179);
const DEBUG_PORT = Number(process.env.GODBOX_CDP_PORT ?? 9222);

const BROWSER_CANDIDATES = [
  process.env.GODBOX_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

/**
 * Scenarios are expressed as in-page scripts so each one exercises the real renderer rather than a
 * reconstruction of it. `advance` uses the existing dev hook to reach a world state; `camera`
 * chooses between the autonomous documentary camera and manual movement.
 */
const SCENARIOS = {
  'mature-camera': {
    description: 'Autonomous documentary camera through an established settlement',
    advanceMonths: 1_440,
  },
  dense: {
    description: 'Population pressing the soft cap',
    advanceMonths: 7_200,
  },
  industrial: {
    description: 'Industry, energy and transport networks active',
    advanceMonths: 19_200,
  },
  'deep-time': {
    description: 'Full history buffer and advanced civilization',
    advanceMonths: 72_000,
  },
  opening: {
    description: 'Arrival film and founding presentation, no advance',
    advanceMonths: 0,
  },
};

const argument = (name, fallback) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  return raw === undefined ? fallback : raw;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function cdpTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return response.json();
}

/** Minimal CDP client over the built-in WebSocket. */
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
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 180_000);
    });
  }

  /** Evaluates an expression in the page and returns its JSON value, awaiting promises. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlocking: false,
    });
    if (result.exceptionDetails) {
      throw new Error(`page error: ${result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text}`);
    }
    return result.result.value;
  }
}

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await cdpTargets();
      const page = targets.find(t => t.type === 'page' && t.url.includes(String(PORT)));
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', () => reject(new Error('socket error')), { once: true });
        });
        return new Session(socket);
      }
    } catch {
      // The browser is still starting up.
    }
    await sleep(500);
  }
  throw new Error('could not attach to the GODBOX page over CDP');
}

/**
 * Installed in the page: records every animation frame's wall-clock interval alongside the
 * renderer's own reported CPU cost, so display-level pacing (what the viewer feels) is measured
 * separately from main-thread work (what the profiler can attribute).
 */
const INSTALL_PROBE = `(() => {
  if (window.__godboxFrameProbe) return 'already-installed';
  const probe = {
    intervals: [],
    longFrames: [],
    started: performance.now(),
    lastFrameAt: performance.now(),
    drawCalls: 0,
    triangles: 0,
    peakDrawCalls: 0,
    peakTriangles: 0,
  };
  window.__godboxFrameProbe = probe;
  // three resets renderer.info at the start of every render() call, including each post-processing
  // pass, so the only way to see a frame's real totals is to own the reset ourselves. This probe's
  // rAF is registered after the application's, so it runs once the frame is fully submitted.
  const info = window.__godboxRenderer?.renderer?.info;
  if (info) info.autoReset = false;
  const tick = () => {
    const now = performance.now();
    const interval = now - probe.lastFrameAt;
    probe.lastFrameAt = now;
    probe.intervals.push(interval);
    const calls = info?.render?.calls ?? 0;
    const triangles = info?.render?.triangles ?? 0;
    if (calls > 0) {
      probe.drawCalls = calls;
      probe.triangles = triangles;
      probe.peakDrawCalls = Math.max(probe.peakDrawCalls, calls);
      probe.peakTriangles = Math.max(probe.peakTriangles, triangles);
    }
    if (interval > 25) {
      probe.longFrames.push({
        atSeconds: Number(((now - probe.started) / 1000).toFixed(2)),
        intervalMs: Number(interval.toFixed(2)),
        drawCalls: calls,
        triangles,
      });
    }
    if (info) info.reset();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'installed';
})()`;

/** Reads the renderer's own scene statistics. `info` is reset by three each rendered frame. */
const SCENE_STATS = `(() => {
  const view = window.__godboxRenderer;
  if (!view) return null;
  const gl = view.renderer;
  const probe = window.__godboxFrameProbe;
  let objects = 0, meshes = 0, visibleMeshes = 0, shadowCasters = 0, transparent = 0, points = 0;
  const materials = new Set(), geometries = new Set();
  view.scene?.traverse((object) => {
    objects++;
    if (object.isPoints) points++;
    if (!object.isMesh) return;
    meshes++;
    if (object.visible) visibleMeshes++;
    if (object.castShadow) shadowCasters++;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material.uuid);
      if (material.transparent) transparent++;
    }
    if (object.geometry) geometries.add(object.geometry.uuid);
  });
  return {
    drawCalls: probe?.drawCalls ?? null,
    triangles: probe?.triangles ?? null,
    peakDrawCalls: probe?.peakDrawCalls ?? null,
    peakTriangles: probe?.peakTriangles ?? null,
    programs: gl?.info?.programs?.length ?? null,
    textureCount: gl?.info?.memory?.textures ?? null,
    geometryCount: gl?.info?.memory?.geometries ?? null,
    sceneObjects: objects,
    meshes,
    visibleMeshes,
    shadowCasters,
    transparentMaterialSlots: transparent,
    pointClouds: points,
    uniqueMaterials: materials.size,
    uniqueGeometries: geometries.size,
    pixelRatio: gl?.getPixelRatio?.() ?? null,
    drawingBuffer: gl ? [gl.domElement.width, gl.domElement.height] : null,
  };
})()`;

function distribution(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const at = (fraction) => Number((ordered[Math.min(ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * fraction) - 1))]).toFixed(2));
  return {
    frames: values.length,
    p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: at(1),
    meanMs: Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)),
    over16_7: values.filter(v => v > 16.7).length,
    over25: values.filter(v => v > 25).length,
    over50: values.filter(v => v > 50).length,
    effectiveFps: Number((1000 / (values.reduce((sum, v) => sum + v, 0) / values.length)).toFixed(1)),
  };
}

async function main() {
  const seconds = Number(argument('seconds', 40));
  const scenarioName = argument('scenario', 'mature-camera');
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    console.error(`unknown scenario '${scenarioName}'. available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  const headless = process.argv.includes('--headless');
  const asJson = process.argv.includes('--json');
  const log = (...args) => { if (!asJson) console.error(...args); };

  const browserPath = BROWSER_CANDIDATES.find(candidate => existsSync(candidate));
  if (!browserPath) throw new Error('no Chromium-family browser found; set GODBOX_BROWSER');

  const profileDir = mkdtempSync(join(tmpdir(), 'godbox-perf-'));
  const flags = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1600,900',
    // The observation is GPU-bound work; never let Chromium silently fall back to software.
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  ];
  if (headless) flags.push('--headless=new');
  flags.push(`http://localhost:${PORT}/`);

  log(`launching ${browserPath.split(/[/\\]/).pop()} (${headless ? 'headless' : 'headful'})...`);
  const browser = spawn(browserPath, flags, { stdio: 'ignore', detached: false });

  let session;
  try {
    session = await connect();
    await session.send('Runtime.enable');
    log('attached. waiting for the observation to boot...');

    // Wait until the renderer and the dev performance hook exist.
    for (let attempt = 0; ; attempt++) {
      const ready = await session.evaluate('Boolean(window.__godboxRenderer && window.__godboxPerformance)');
      if (ready) break;
      if (attempt > 120) throw new Error('the observation did not finish booting');
      await sleep(1000);
    }

    const gpu = await session.evaluate(`(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
               vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : 'unknown' };
    })()`);
    log(`gpu: ${gpu.renderer}`);

    if (scenario.advanceMonths > 0) {
      // Simulation.step() is a no-op until the Arrival authority gate opens, so the film has to be
      // run out first; otherwise the scenario silently measures the opening world instead.
      log('completing the Arrival film to open the authority gate...');
      await session.evaluate('window.__godboxArrival && window.__godboxArrival.advance(600)');
      let gateOpen = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        gateOpen = await session.evaluate(
          `(window.__godboxArrival?.state?.arrival?.phase ?? 'none') === 'HISTORY_RUNNING'`);
        if (gateOpen) break;
        await sleep(500);
      }
      if (!gateOpen) {
        // The founding presentation is camera-gated and can outlast a benchmark window. Retiring
        // the prologue outright is what the headless harnesses do and leaves history authoritative.
        log('founding presentation still running; retiring the prologue directly');
        await session.evaluate('window.__godboxArrival.state.arrival = undefined');
      }

      log(`advancing ${scenario.advanceMonths} months to reach '${scenarioName}'...`);
      // Chunked through the dev hook so one call never blocks the page for minutes.
      const chunk = 240;
      for (let advanced = 0; advanced < scenario.advanceMonths; advanced += chunk) {
        await session.evaluate(`window.__godboxDebugAdvance(${Math.min(chunk, scenario.advanceMonths - advanced)})`);
      }
      const reached = await session.evaluate('window.__godboxPerformance().month');
      if (reached < scenario.advanceMonths * 0.95) {
        throw new Error(`scenario '${scenarioName}' only reached month ${reached} of ${scenario.advanceMonths};`
          + ' the measurement would not represent the intended world state');
      }
      log(`reached month ${reached} (year ${Math.floor(reached / 12)})`);
      // Let presentation maintenance settle at the new world state before sampling frames.
      await sleep(4000);
    }

    await session.evaluate('window.__godboxResetPerformance && window.__godboxResetPerformance()');
    await session.evaluate(INSTALL_PROBE);
    const heapBefore = await session.evaluate('performance.memory ? performance.memory.usedJSHeapSize : null');

    const cpuProfilePath = argument('cpu-profile', null);
    if (cpuProfilePath) {
      await session.send('Profiler.enable');
      await session.send('Profiler.setSamplingInterval', { interval: 200 });
      await session.send('Profiler.start');
    }

    log(`sampling ${seconds}s of frames...`);
    await sleep(seconds * 1000);

    if (cpuProfilePath) {
      const { profile } = await session.send('Profiler.stop');
      writeFileSync(cpuProfilePath, JSON.stringify(profile));
      log(`wrote page cpu profile to ${cpuProfilePath}`);
    }

    const intervals = await session.evaluate('window.__godboxFrameProbe.intervals.slice()');
    const longFrames = await session.evaluate('window.__godboxFrameProbe.longFrames.slice(-40)');
    const scene = await session.evaluate(SCENE_STATS);
    const internal = await session.evaluate('window.__godboxPerformance()');
    const heapAfter = await session.evaluate('performance.memory ? performance.memory.usedJSHeapSize : null');

    const report = {
      scenario: scenarioName,
      description: scenario.description,
      gpu,
      headless,
      sampledSeconds: seconds,
      displayPacing: distribution(intervals.slice(5)),
      mainThreadCpu: internal.frame,
      simulation: {
        month: internal.month, year: internal.year,
        tickMeanMs: internal.tick?.total?.meanMs ?? null,
        tickP95Ms: internal.tick?.total?.p95Ms ?? null,
        tickMaxMs: internal.tick?.total?.maxMs ?? null,
        pendingTicks: internal.scheduler?.pendingTicks ?? null,
        estimatedTickMs: internal.scheduler?.estimatedTickMs ?? null,
        hottestPhases: Object.entries(internal.tick?.phases ?? {})
          .sort((a, b) => (b[1].meanMs * b[1].count) - (a[1].meanMs * a[1].count))
          .slice(0, 6)
          .map(([phase, stats]) => ({ phase, meanMs: stats.meanMs, p95Ms: stats.p95Ms, maxMs: stats.maxMs })),
      },
      scene,
      sectionAttribution: internal.sections ?? null,
      heap: {
        beforeMiB: heapBefore === null ? null : Number((heapBefore / 1048576).toFixed(1)),
        afterMiB: heapAfter === null ? null : Number((heapAfter / 1048576).toFixed(1)),
        growthMiB: heapBefore === null || heapAfter === null
          ? null : Number(((heapAfter - heapBefore) / 1048576).toFixed(1)),
      },
      worstFrames: longFrames,
    };

    if (asJson) console.log(JSON.stringify(report, null, 2));
    else {
      const d = report.displayPacing;
      console.log(`\n=== ${scenarioName} === ${scenario.description}`);
      console.log(`gpu: ${gpu.renderer}`);
      console.log(`display pacing over ${d.frames} frames: p50 ${d.p50Ms}ms  p95 ${d.p95Ms}ms`
        + `  p99 ${d.p99Ms}ms  max ${d.maxMs}ms  (~${d.effectiveFps} fps)`);
      console.log(`  frames >16.7ms: ${d.over16_7} (${((d.over16_7 / d.frames) * 100).toFixed(1)}%)`
        + `  >25ms: ${d.over25}  >50ms: ${d.over50}`);
      const c = report.mainThreadCpu;
      console.log(`main-thread frame cpu: p50 ${c.p50Ms}ms  p95 ${c.p95Ms}ms  p99 ${c.p99Ms}ms  max ${c.maxMs}ms`);
      console.log(`simulation: year ${report.simulation.year} | tick mean ${report.simulation.tickMeanMs}ms`
        + ` p95 ${report.simulation.tickP95Ms}ms max ${report.simulation.tickMaxMs}ms`
        + ` | pending ${report.simulation.pendingTicks}`);
      for (const phase of report.simulation.hottestPhases) {
        console.log(`    ${phase.phase.padEnd(22)} mean ${phase.meanMs}ms  max ${phase.maxMs}ms`);
      }
      console.log(`scene: ${scene.drawCalls} draw calls | ${scene.triangles?.toLocaleString()} triangles`
        + ` | ${scene.programs} programs | ${scene.sceneObjects} objects | ${scene.meshes} meshes`
        + ` (${scene.visibleMeshes} visible, ${scene.shadowCasters} shadow casters)`);
      console.log(`       ${scene.uniqueMaterials} unique materials | ${scene.uniqueGeometries} unique geometries`
        + ` | peak ${scene.peakDrawCalls} draws / ${scene.peakTriangles?.toLocaleString()} tris`
        + ` | ${scene.textureCount} textures | pixelRatio ${scene.pixelRatio}`
        + ` | buffer ${scene.drawingBuffer?.join('x')}`);
      console.log(`heap: ${report.heap.beforeMiB} -> ${report.heap.afterMiB} MiB (growth ${report.heap.growthMiB} MiB)`);
      const attribution = report.sectionAttribution;
      if (attribution?.enabled) {
        console.log(`renderer sections over ${attribution.frames} frames`
          + ` (${attribution.longFrames} frames >${attribution.hitchThresholdMs}ms):`);
        for (const section of attribution.sections.slice(0, 8)) {
          if (section.meanMs < 0.01 && section.maxMs < 0.5) continue;
          console.log(`    ${(section.shareOfFrame * 100).toFixed(1).padStart(5)}%  ${section.section.padEnd(26)}`
            + ` mean ${section.meanMs.toFixed(3)}ms  max ${section.maxMs.toFixed(2)}ms`);
        }
        for (const frame of attribution.worst.slice(0, 4)) {
          const blame = frame.sections.slice(0, 4).map(s => `${s.section} ${s.ms.toFixed(1)}ms`).join(', ');
          console.log(`    LONG FRAME ${frame.frameMs.toFixed(1)}ms at t+${frame.atSeconds}s -> ${blame}`);
        }
      }
      if (report.worstFrames.length) {
        console.log('worst frames (>25ms):');
        for (const frame of report.worstFrames.slice(-12)) {
          console.log(`    t+${String(frame.atSeconds).padStart(6)}s  ${String(frame.intervalMs).padStart(7)}ms`
            + `  draws ${frame.drawCalls}  tris ${frame.triangles?.toLocaleString()}`);
        }
      }
    }
  } finally {
    try { session?.socket.close(); } catch { /* already closed */ }
    browser.kill();
  }
}

main().catch((error) => { console.error(`frame-harness failed: ${error.message}`); process.exit(1); });
