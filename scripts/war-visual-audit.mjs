import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Browser integration audit. Screenshots and errors come from the actual Vite scene on WebGL.
const port = 9346;
const browserPath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!browserPath) throw new Error('Chromium browser unavailable');
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'godbox-war-'))}`, '--no-first-run',
  '--no-default-browser-check', '--window-size=1600,1000', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* boot */ }
    if (target) break;
    await sleep(100);
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error'
      && !message.params.entry.url?.endsWith('favicon.ico')) errors.push(message.params.entry);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(message.error);
      else waiter.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable');
  if (process.argv.includes('--mobile')) await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  mkdirSync('output/war-review', { recursive: true });
  const reports = [];
  const seconds = Number(process.argv.find(arg => arg.startsWith('--seconds='))?.split('=')[1] ?? 9);
  const escalation = process.argv.find(arg => arg.startsWith('--escalation='))?.split('=')[1];
  const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const cases = requested.length ? requested : ['club', 'spear', 'bow', 'rifle', 'modern', 'aftermath'];
  for (const kit of cases) {
    errors.length = 0;
    await send('Page.navigate', { url: `http://localhost:5179/tests/war-preview.html?stage=${kit === 'aftermath' ? 'aftermath' : 'battle'}&equipment=${kit}${escalation ? '&escalation=' + encodeURIComponent(escalation) : ''}` });
    const expectedMethod = kit === 'aftermath' ? 'club' : kit;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (await evaluate(`window.__warPreview?.method === ${JSON.stringify(expectedMethod)}`)) break;
      await sleep(500);
    }
    for (let frame = 0; frame < 240; frame++) {
      if (await evaluate(`window.__warPreview?.view.structureDestruction.elapsed >= ${8 + seconds}`)) break;
      await sleep(250);
    }
    const report = await evaluate(`(() => {
      const { view, war } = window.__warPreview;
      return { phase: war.phase, observation: view.observation.label,
        selectedMethod: window.__warPreview.method,
        methodOptions: document.querySelector('#campaign-method').options.length,
        escalation: window.__warPreview.escalation,
        casualties: {
          alive: window.__warPreview.state.people.filter(person => person.alive).length,
          deaths: window.__warPreview.state.stats.deaths,
          reportedLosses: Number(document.querySelector('[data-field="losses"]')?.textContent.replaceAll(',', '')),
          events: window.__warPreview.state.history.filter(event => event.type === 'battle' || event.type === 'nuclear-use' || event.type === 'nuclear-exchange')
            .map(event => ({ type: event.type, deaths: event.affectedPopulation, fraction: event.context.populationLossFraction ?? null })),
        },
        destruction: {
          battleClock: Array.from(view.warRenderer.visuals.values()).map(v => ({ start: v.battleTime, event: v.eventId })),
          elapsed: view.structureDestruction.elapsed,
          impacts: window.__warPreview.state.history.filter(e => e.impacts?.length).map(e => ({ type: e.type, hits: e.impacts })),
          plots: window.__warPreview.state.settlements.flatMap(s => s.structurePlots ?? []).filter(p => p.destruction).map(p => ({ id: p.id, condition: p.condition, burning: !!p.fire, vaporized: p.destruction.vaporized })),
          bodies: window.__warPreview.state.bodies?.filter(b => b.combatImpact).map(b => ({ id: b.id, weapon: b.combatImpact.weapon, vaporized: b.combatImpact.vaporized, removed: b.removed?.reason })),
          dust: view.warRenderer.group.getObjectByName('Building collapse dust and vaporization ash')?.count ?? 0,
        },
        strategic: {
          cloud: view.warRenderer.group.getObjectByName('Nuclear mushroom cloud')?.count ?? 0,
          biologicalMarkers: view.warRenderer.group.getObjectByName('Abstract biological crisis markers')?.visible ?? false,
          nuclearEvents: window.__warPreview.state.history.filter(event => event.type === 'nuclear-use' || event.type === 'nuclear-exchange').map(event => event.type),
        },
        camera: view.camera.position.toArray(), target: view.cameraDirector.desiredTarget.toArray(),
        role: view.cameraDirector.activeSequence?.role, age: view.cameraDirector.shotAge,
        figures: view.warRenderer.report,
        advanced: Object.fromEntries(['Advanced swarm drones', 'Drone rotor blur', 'Missile exhaust trails',
          'Strike ignition flashes', 'Strike smoke plumes', 'Strike ground dust'].map(name => {
          const object = view.warRenderer.group.getObjectByName(name);
          return [name, object?.count ?? 0];
        })),
        failedPrograms: view.renderer.info.programs.filter(p => p.diagnostics?.runnable === false).map(p => p.name) };
    })()`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`output/war-review/${kit}.png`, Buffer.from(screenshot.data, 'base64'));
    reports.push({ kit, ...report, errors: [...errors] });
    console.log(JSON.stringify(reports.at(-1)));
  }
  if (process.argv.includes('--controls')) {
    const ready = async (method, stage, escalation) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if (await evaluate(`window.__warPreview?.method === ${JSON.stringify(method)} && document.querySelector('#campaign-stage')?.value === ${JSON.stringify(stage)} ${escalation ? `&& window.__warPreview.escalation === ${JSON.stringify(escalation)}` : ''}`)) return;
        } catch { /* navigation destroys the previous execution context */ }
        await sleep(200);
      }
      throw new Error(`Preview did not switch to ${method}/${stage}`);
    };
    if (await evaluate(`Boolean(document.querySelector('#campaign-escalation'))`)) {
      const method = await evaluate(`window.__warPreview.method`);
      for (const escalation of ['exchange', 'deterrence']) {
        await evaluate(`(() => { const select = document.querySelector('#campaign-escalation'); select.value = ${JSON.stringify(escalation)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await ready(method, 'battle', escalation);
        const events = await evaluate(`window.__warPreview.state.history.filter(event => event.type === 'nuclear-use' || event.type === 'nuclear-exchange').map(event => event.type)`);
        if (escalation === 'exchange' && !events.includes('nuclear-exchange') || escalation === 'deterrence' && events.length) throw new Error('Nuclear escalation did not match its evidence');
      }
      console.log('Nuclear escalation and deterrence controls passed.');
    }
    await evaluate(`(() => {
      const select = document.querySelector('#campaign-method');
      select.value = 'sword'; select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await ready('sword', 'battle');
    await evaluate(`document.querySelector('#campaign-next').click()`);
    await ready('siege', 'battle');
    await evaluate(`document.querySelector('#campaign-previous').click()`);
    await ready('sword', 'battle');
    await evaluate(`(() => {
      const select = document.querySelector('#campaign-stage');
      select.value = 'march'; select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await ready('sword', 'march');
    const phase = await evaluate(`window.__warPreview.war.phase`);
    if (phase !== 'marching') throw new Error(`March preview entered ${phase}`);
    await evaluate(`document.querySelector('#campaign-replay').click()`);
    await sleep(500);
    await ready('sword', 'march');
    console.log('Preview dropdown, next, previous, stage and replay controls passed.');
  }
  writeFileSync('output/war-review/audit.json', JSON.stringify(reports, null, 2));
  if (reports.some(r => r.errors.length || r.failedPrograms.length)) process.exitCode = 1;
} finally { socket?.close(); browser.kill(); }
