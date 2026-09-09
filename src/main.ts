import './style.css';
import { GODBOX_CONFIG } from '../godbox.config';
import { AudioDirector } from './audio/AudioDirector';
import type { AudioEra } from './audio/audio.manifest';
import { configWith } from './config';
import { Historian } from './historian/Historian';
import { PresentationDirector, type PresentationTelemetry } from './historian/PresentationDirector';
import {
  HistorianArchiveStore,
  RunRecordBuilder,
  computeCrossRunContext,
  createRunIdentity,
  experimentFingerprint,
  seedForObservation,
  type RunArchiveRecord,
} from './historian/RunArchive';
import { Simulation } from './sim/Simulation';
import { representedPopulation } from './sim/advanced/AdvancedCivilizationSystem';
import type { SimulationState } from './sim/types';
import type { GodboxRenderer, PlacementSmokeReport } from './render/GodboxRenderer';

declare global {
  interface Window {
    __godboxRenderer?: GodboxRenderer;
    __godboxPlacementReport?: () => PlacementSmokeReport;
    __godboxDebugAdvance?: (months: number) => { month: number; year: number; placement: PlacementSmokeReport };
    __godboxPacing?: () => PresentationTelemetry;
    __godboxRestart?: (seed?: string) => Promise<void>;
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`GODBOX requires ${selector}`);
  return element;
}

const app = requiredElement<HTMLDivElement>('#app');

app.innerHTML = `
  <main class="world" aria-label="Autonomous GODBOX historical observation">
    <div class="viewport" id="viewport"></div>
    <div class="grain" aria-hidden="true"></div>
    <header class="identity">
      <div class="sigil" aria-hidden="true"><i></i><b></b></div>
      <div>
        <h1>GODBOX</h1>
        <p>You do not play GODBOX. You witness it.</p>
      </div>
    </header>
    <section class="chronicle" aria-live="polite">
      <div class="date" id="date">YEAR 0 &middot; SETTLEMENT ERA</div>
      <div class="population"><span id="population">0</span><small>represented people</small></div>
      <div class="rule"></div>
      <p class="place" id="place">The known world</p>
      <p class="activity" id="activity">A new history begins.</p>
      <p class="evidence" id="evidence">RECORDED FACT</p>
    </section>
    <footer class="runline">
      <span id="observation">OBSERVATION 01</span>
      <span class="pulse" id="run-status"><i></i> AUTONOMOUS</span>
      <span id="seed">SEED &middot; -</span>
      <button class="audio-toggle" id="audio-toggle" type="button" aria-pressed="false" aria-label="Mute ambient music" title="Mute ambient music">AUDIO ON</button>
      <span class="commandhint">/ &middot; COMMANDS</span>
    </footer>
    <form class="commandline" id="commandline" hidden>
      <span class="command-prompt" aria-hidden="true">/</span>
      <input id="command-input" type="text" autocomplete="off" spellcheck="false" aria-label="Observer command" />
    </form>
    <div class="opening" id="opening">
      <div class="opening-mark"></div>
      <h2 id="opening-title">GODBOX</h2>
      <p id="opening-observation">OBSERVATION 001</p>
      <small id="world-name">A world is being remembered</small>
      <small id="opening-seed">SEED -</small>
      <small id="opening-status">History is the protagonist.</small>
    </div>
  </main>
`;

const viewport = requiredElement<HTMLElement>('#viewport');
const dateElement = requiredElement<HTMLElement>('#date');
const populationElement = requiredElement<HTMLElement>('#population');
const placeElement = requiredElement<HTMLElement>('#place');
const activityElement = requiredElement<HTMLElement>('#activity');
const evidenceElement = requiredElement<HTMLElement>('#evidence');
const seedElement = requiredElement<HTMLElement>('#seed');
const observationElement = requiredElement<HTMLElement>('#observation');
const runStatusElement = requiredElement<HTMLElement>('#run-status');
const audioToggleElement = requiredElement<HTMLButtonElement>('#audio-toggle');
const openingElement = requiredElement<HTMLElement>('#opening');
const openingTitleElement = requiredElement<HTMLElement>('#opening-title');
const openingObservationElement = requiredElement<HTMLElement>('#opening-observation');
const worldNameElement = requiredElement<HTMLElement>('#world-name');
const openingSeedElement = requiredElement<HTMLElement>('#opening-seed');
const openingStatusElement = requiredElement<HTMLElement>('#opening-status');
const commandLineElement = requiredElement<HTMLElement>('#commandline');
const commandInputElement = requiredElement<HTMLInputElement>('#command-input');
const COMMAND_PLACEHOLDER = 'restart · restart seed · restart <seed>';
const AUDIO_MUTED_KEY = 'godbox.audio.muted';
commandInputElement.placeholder = COMMAND_PLACEHOLDER;

function readAudioMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(AUDIO_MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeAudioMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(AUDIO_MUTED_KEY, String(muted));
  } catch {
    // Private browsing or blocked storage should not affect the observation.
  }
}

let activeAudio: AudioDirector | undefined;
let audioMuted = readAudioMutedPreference();

function syncAudioToggle(): void {
  audioToggleElement.textContent = audioMuted ? 'AUDIO OFF' : 'AUDIO ON';
  audioToggleElement.setAttribute('aria-pressed', String(!audioMuted));
  audioToggleElement.setAttribute('aria-label', audioMuted ? 'Unmute ambient music' : 'Mute ambient music');
  audioToggleElement.title = audioMuted ? 'Unmute ambient music' : 'Mute ambient music';
}

audioToggleElement.addEventListener('click', () => {
  audioMuted = !audioMuted;
  writeAudioMutedPreference(audioMuted);
  activeAudio?.setMuted(audioMuted);
  syncAudioToggle();
});

const unlockAudio = (): void => { activeAudio?.resume(); };
window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);
syncAudioToggle();

const monthNames = ['LATE WINTER', 'EARLY SPRING', 'SPRING', 'LATE SPRING', 'EARLY SUMMER', 'SUMMER', 'LATE SUMMER', 'EARLY AUTUMN', 'AUTUMN', 'LATE AUTUMN', 'EARLY WINTER', 'WINTER'];

function audioEra(state: SimulationState): AudioEra {
  if (state.advanced.space.selfSustainingBodies >= 2) return 'interplanetary';
  if (state.advanced.machine.capability >= 0.7) return 'machine';
  if (state.advanced.atomic.thresholdMonth !== undefined) return 'atomic';
  if (state.settlements.some((settlement) => settlement.industry.active)) return 'industrial';
  if (state.settlements.some((settlement) => settlement.knowledge.records['durable-records'])) return 'recorded';
  if (state.settlements.some((settlement) => settlement.urbanization >= 0.3)) return 'urban';
  return 'settlement';
}

function inferredEra(state: SimulationState): string {
  return `${audioEra(state).toUpperCase()} ERA`;
}

async function replayToMonth(simulation: Simulation, month: number): Promise<void> {
  const target = Math.max(0, month);
  while (simulation.state.month < target) {
    simulation.step(Math.min(240, target - simulation.state.month));
    openingStatusElement.textContent = `RESTORING YEAR ${simulation.year.toLocaleString()}`;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}

function matchingOngoingRun(records: readonly RunArchiveRecord[], familyFingerprint: string, baseSeed: string): RunArchiveRecord | undefined {
  return [...records].reverse().find((record) => record.status === 'ongoing'
    && record.identity.experimentFingerprint === familyFingerprint
    && record.identity.baseSeed === baseSeed);
}

let activeRun: { conclude: (reason: string) => Promise<void> } | undefined;
let activeSeed = '';
let rafId = 0;
let openingTimeout = 0;
let restartInProgress = false;

function generateSeed(): string {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `world-${[...values].map((value) => value.toString(36)).join('')}`;
}

/** Ends the current run cleanly and begins a fresh observation from Year 0. */
async function restartObservation(seed: string): Promise<void> {
  if (restartInProgress) return;
  restartInProgress = true;
  try {
    await activeRun?.conclude('The observer restarted this world from Year 0.');
    window.clearTimeout(openingTimeout);
    await beginObservation(seed);
  } finally {
    restartInProgress = false;
  }
}

function executeObserverCommand(raw: string): string {
  const parts = raw.trim().replace(/^\/+/, '').split(/\s+/).filter(Boolean);
  const command = (parts[0] ?? '').toLowerCase();
  if (command === 'restart') {
    const argument = parts.slice(1).join(' ').trim();
    const seed = argument === '' || argument.toLowerCase() === 'random'
      ? generateSeed()
      : argument.toLowerCase() === 'seed'
        ? activeSeed
        : argument;
    if (!seed) return 'No active observation to replay.';
    void restartObservation(seed);
    return `RESTARTING · SEED ${seed.toUpperCase()}`;
  }
  if (command === 'help') return COMMAND_PLACEHOLDER;
  return `Unknown command: /${command}`;
}

window.addEventListener('keydown', (event) => {
  if (event.key === '/' && commandLineElement.hidden && document.activeElement !== commandInputElement) {
    event.preventDefault();
    commandInputElement.placeholder = COMMAND_PLACEHOLDER;
    commandInputElement.value = '';
    commandLineElement.hidden = false;
    commandInputElement.focus();
  } else if (event.key === 'Escape' && !commandLineElement.hidden) {
    commandLineElement.hidden = true;
    commandInputElement.blur();
  }
});

commandLineElement.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = executeObserverCommand(commandInputElement.value);
  commandInputElement.value = '';
  commandInputElement.placeholder = message;
  commandLineElement.hidden = true;
  commandInputElement.blur();
});

if (import.meta.env.DEV) {
  window.__godboxRestart = (seed?: string) => restartObservation(seed ?? generateSeed());
}

async function beginObservation(seedOverride?: string): Promise<void> {
  const baseConfig = configWith(GODBOX_CONFIG);
  const archiveStore = new HistorianArchiveStore();
  const previousRuns = await archiveStore.list();
  const resumable = seedOverride === undefined && baseConfig.experiment.resumeOngoing
    ? matchingOngoingRun(previousRuns, experimentFingerprint(baseConfig), baseConfig.seed)
    : undefined;

  let simulation: Simulation;
  let identity: RunArchiveRecord['identity'];
  if (resumable) {
    simulation = new Simulation(resumable.configuration);
    identity = resumable.identity;
  } else {
    const observationNumber = await archiveStore.nextObservationNumber();
    simulation = new Simulation({ ...GODBOX_CONFIG, seed: seedOverride ?? seedForObservation(baseConfig.seed, observationNumber) });
    identity = createRunIdentity(simulation.config, simulation.state, observationNumber, new Date().toISOString(), baseConfig.seed);
  }
  activeSeed = simulation.config.seed;
  openingTitleElement.textContent = 'GODBOX';
  openingStatusElement.textContent = 'History is the protagonist.';
  runStatusElement.innerHTML = '<i></i> AUTONOMOUS';
  openingElement.classList.remove('departed', 'ending');

  const observationLabel = `OBSERVATION ${String(identity.observationNumber).padStart(3, '0')}`;
  seedElement.textContent = `SEED · ${simulation.config.seed.toUpperCase()}`;
  observationElement.textContent = observationLabel;
  openingObservationElement.textContent = observationLabel;
  worldNameElement.textContent = `WORLD: ${identity.worldName.replace(/^The /, '')}`;
  openingSeedElement.textContent = `SEED: ${simulation.config.seed}`;
  if (resumable) await replayToMonth(simulation, resumable.lastRecordedMonth);

  const historian = new Historian(simulation.config, { observationNumber: identity.observationNumber, crossRunContext: computeCrossRunContext(previousRuns) });
  const archive = new RunRecordBuilder(identity, simulation.config, simulation.state, resumable);
  const { GodboxRenderer } = await import('./render/GodboxRenderer');
  const view = new GodboxRenderer(viewport, simulation.config, simulation.state, historian);
  window.__godboxRenderer = view;
  window.__godboxPlacementReport = () => view.getPlacementSmokeReport();
  if (import.meta.env.DEV) {
    window.__godboxDebugAdvance = (months: number) => {
      simulation.step(Math.max(0, Math.floor(months)));
      view.update(1 / 60, performance.now() / 1000);
      return { month: simulation.state.month, year: simulation.year, placement: view.getPlacementSmokeReport() };
    };
  }
  const presentation = new PresentationDirector(simulation.config);
  window.__godboxPacing = () => presentation.telemetry();
  const audio = new AudioDirector(simulation.config);
  activeAudio = audio;
  audio.setMuted(audioMuted);
  syncAudioToggle();

  let lastTime = performance.now();
  let elapsedSeconds = 0;
  let accumulator = 0;
  let displayPopulation = representedPopulation(simulation.state);
  let lastObservationRevision = -1;
  let lastArchivedMonth = simulation.state.month;
  let runEnded = false;
  let saveQueue = Promise.resolve();

  const persist = (completion?: Parameters<RunRecordBuilder['update']>[4]): Promise<void> => {
    const record = archive.update(simulation.state, historian.representativePersonIds, historian.statements, historian.predictions, completion);
    lastArchivedMonth = simulation.state.month;
    saveQueue = saveQueue.then(() => archiveStore.save(record));
    return saveQueue;
  };

  const finishObservation = async (reason: 'horizon' | 'extinction'): Promise<void> => {
    if (runEnded) return;
    runEnded = true;
    audio.transitionTo('ending', undefined, audioEra(simulation.state));
    const summary = simulation.summary();
    const classification = summary.outcomeClassification;
    const reasonText = reason === 'extinction'
      ? `${identity.worldName} ended with no surviving represented population after ${simulation.year.toLocaleString()} years.`
      : `${identity.worldName} completed its configured ${simulation.config.experiment.runYears.toLocaleString()}-year observation as ${classification}.`;
    runStatusElement.innerHTML = '<i></i> ARCHIVED';
    await persist({ status: 'completed', classification, reason: reasonText });
    openingTitleElement.textContent = 'GODBOX';
    openingObservationElement.textContent = `${observationLabel} COMPLETE`;
    worldNameElement.textContent = identity.worldName;
    openingSeedElement.textContent = `${classification} · YEAR ${simulation.year.toLocaleString()}`;
    openingStatusElement.textContent = simulation.config.experiment.autoNextRun ? 'The archive closes. Another world follows.' : 'The archive closes.';
    openingElement.classList.add('ending');
    openingElement.classList.remove('departed');
    if (simulation.config.experiment.autoNextRun) {
      window.setTimeout(() => window.location.reload(), simulation.config.experiment.intermissionSeconds * 1000);
    }
  };

  await persist();

  const frame = (now: number): void => {
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    elapsedSeconds += deltaSeconds;
    const monthsPerSecond = presentation.update(deltaSeconds, simulation.state, view.observation);
    const tickDuration = 1 / Math.max(0.1, monthsPerSecond);
    if (simulation.config.autoRun && !runEnded) {
      accumulator += deltaSeconds;
      let ticks = 0;
      // Adaptive tick budget: quiet deep time runs wide steps; wars, migrations, and
      // transformations get fine steps. Simulation rules stay independent of render FPS.
      const tickBudget = presentation.tickBudget(simulation.state);
      while (accumulator >= tickDuration && ticks < tickBudget) {
        simulation.step();
        accumulator -= tickDuration;
        ticks += 1;
      }
    }
    view.update(deltaSeconds, elapsedSeconds);
    audio.update(deltaSeconds);
    if (view.observation.revision !== lastObservationRevision) {
      lastObservationRevision = view.observation.revision;
      audio.transitionTo(view.observation.audioCategory, view.observation.statement?.voiceAssetId, audioEra(simulation.state));
      evidenceElement.textContent = view.observation.statement?.epistemicStatus.replaceAll('-', ' ').toUpperCase() ?? 'RECORDED FACT';
      evidenceElement.dataset['status'] = view.observation.statement?.epistemicStatus ?? 'recorded-fact';
    }
    const observedPopulation = representedPopulation(simulation.state);
    displayPopulation += (observedPopulation - displayPopulation) * Math.min(1, deltaSeconds * 4);
    const month = simulation.state.month % 12;
    const day = Math.min(30, Math.floor(accumulator / tickDuration * 30) + 1);
    dateElement.textContent = `YEAR ${simulation.year.toLocaleString()} · ${inferredEra(simulation.state)} · ${monthNames[month] ?? 'SPRING'} · DAY ${day}`;
    populationElement.textContent = Math.round(displayPopulation).toLocaleString();
    placeElement.textContent = view.observation.label;
    activityElement.textContent = view.observation.detail;
    if (simulation.state.month - lastArchivedMonth >= 120) void persist();
    const extinct = observedPopulation === 0 || simulation.state.advanced.outcome.classification === 'EXTINCT';
    const atHorizon = simulation.state.month >= simulation.config.experiment.runYears * 12;
    if (!runEnded && (extinct || atHorizon)) void finishObservation(extinct ? 'extinction' : 'horizon');
    rafId = window.requestAnimationFrame(frame);
  };

  const persistWhenHidden = (): void => { if (document.visibilityState === 'hidden' && !runEnded) void persist(); };
  const persistBeforeUnload = (): void => {
    if (!runEnded) {
      void persist();
      audio.stop();
      if (activeAudio === audio) activeAudio = undefined;
      view.dispose();
    }
  };
  const conclude = async (reason: string): Promise<void> => {
    if (runEnded) return;
    runEnded = true;
    window.cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', persistWhenHidden);
    window.removeEventListener('beforeunload', persistBeforeUnload);
    await persist({ status: 'completed', classification: simulation.summary().outcomeClassification, reason });
    audio.stop();
    if (activeAudio === audio) activeAudio = undefined;
    view.dispose();
  };
  activeRun = { conclude };
  document.addEventListener('visibilitychange', persistWhenHidden);
  window.addEventListener('beforeunload', persistBeforeUnload);
  rafId = window.requestAnimationFrame(frame);
  openingTimeout = window.setTimeout(() => openingElement.classList.add('departed'), resumable ? 1000 : 2800);
}

void beginObservation().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  activityElement.textContent = `The observation could not begin: ${detail}`;
  evidenceElement.textContent = 'LOCAL FAILURE';
  openingStatusElement.textContent = `LOCAL FAILURE · ${detail}`;
});
