/**
 * architectureBrowser.ts
 *
 * Development-only visual QA browser for the architecture system.
 *
 * Every structure on screen comes out of the production `AssetBuilder.getAsset('building', …)`
 * path, so what is shown is exactly what the simulation renders: the same `resolveBuildingSpec`
 * decisions, the same `StructureGeometry`/`DedicatedStructures` emission, the same material
 * library and the same `THREE.LOD` assets. This file contains no showcase geometry — the only
 * meshes it creates are the ground plane and the row of period markers under the timeline.
 *
 * It is a viewer. It changes no simulation, architecture, construction, economy or renderer
 * behaviour, and nothing here is imported by anything outside `src/dev`.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CultureStyle } from '../sim/types';
import type { DevelopmentResponse, SettlementNeed, StructureForm } from '../sim/development/types';
import { AssetBuilder, type AssetConfig } from '../render/assets/AssetBuilder';
import { BUILD_STAGE, type BuildStage } from '../render/assets/BuildStages';
import type { BuildingRole } from '../render/assets/BuildingGrammar';
import {
  ARCHETYPE_LIBRARY, archetypeStageFor, type BuildingArchetype,
} from '../render/architecture/BuildingArchetype';
import {
  ARCHITECTURAL_PERIODS, PERIOD_LABELS, PERIOD_DRIVE, periodRank, type ArchitecturalPeriod,
} from '../render/architecture/ArchitecturalPeriod';
import { structuralFamily, type StructuralFamily } from '../render/architecture/StructuralFamily';
import { architecturalMaterial, isArchitecturalMaterial } from '../render/architecture/MaterialLibrary';
import { DEVELOPMENT_PROGRAM_INPUTS } from '../render/architecture/ProductionBuildingInputs';
import { BUILDING_ROLES, archetypeForRole } from '../render/architecture/ArchetypeRouting';
import type { MaterialAssignment } from '../render/architecture/BuildingSpec';
import { deriveMaterialEvidence } from '../render/architecture/MaterialSourcing';
import type { BuildingSpec } from '../render/architecture/BuildingSpec';
import { BROWSER_CATALOGUE, FOUNDING_ADAPTATIONS, MATERIAL_SCENARIOS, validBrowserPeriods, validMaterialScenarios, scenarioEvidence } from './architectureBrowserModel';
import { MillMotionSystem, type MillConditionWeather, type MillConditionWorld } from '../render/architecture/MillMotion';

if (!import.meta.env.DEV) throw new Error('The architecture browser is a development fixture.');

// --------------------------------------------------------------------------- dom

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const archetypeSelect = el<HTMLSelectElement>('archetype');
const categorySelect = el<HTMLSelectElement>('category');
const periodSelect = el<HTMLSelectElement>('period');
const cultureSelect = el<HTMLSelectElement>('culture');
const climateSelect = el<HTMLSelectElement>('climate');
const specializationSelect = el<HTMLSelectElement>('specialization');
const stageSelect = el<HTMLSelectElement>('stage');
const materialSelect = el<HTMLSelectElement>('material-scenario');
const catalogueGrid = el<HTMLDivElement>('catalogue-grid');
const programSelect = el<HTMLSelectElement>('program');
const prosperityInput = el<HTMLInputElement>('prosperity');
const waterfrontInput = el<HTMLInputElement>('waterfront');
const fullDetailInput = el<HTMLInputElement>('full-detail');
const shadowsInput = el<HTMLInputElement>('shadows');
const seedInput = el<HTMLInputElement>('seed');
const labelLayer = el<HTMLDivElement>('labels');
const inspector = el<HTMLElement>('inspector');

type ViewMode = 'gallery' | 'timeline' | 'street' | 'production' | 'era-matrix' | 'material-matrix' | 'catalogue' | 'founding';
let view: ViewMode = 'gallery';

// --------------------------------------------------------------------------- context presets

/**
 * Culture presets.
 *
 * `CultureStyleProfile` infers roof language, material bias and trim density from a culture's
 * symbol and pattern, so these four presets are chosen to land on four different roof languages
 * and material biases rather than to look pretty. Each differs in every field the asset cache
 * keys on, so switching culture never returns another preset's cached mesh.
 */
const CULTURES: readonly { id: string; label: string; style: CultureStyle }[] = [
  {
    id: 'highland', label: 'Highland — layered roof, stone bias',
    style: { primary: '#6d7f84', secondary: '#3d4a4e', accent: '#c6a86b', symbol: 'mountain-knot', pattern: 'terrace', nameSyllables: ['kar', 'dun'] },
  },
  {
    id: 'river', label: 'River — gable roof, timber bias',
    style: { primary: '#8a9d7a', secondary: '#4f6148', accent: '#d8c38a', symbol: 'river-eye', pattern: 'wave', nameSyllables: ['ael', 'mor'] },
  },
  {
    id: 'sun', label: 'Sun — stepped roof, clay bias',
    style: { primary: '#c08a52', secondary: '#8a5a33', accent: '#e8d6a2', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['tah', 'ras'] },
  },
  {
    id: 'moon', label: 'Moon — domed roof, mixed bias',
    style: { primary: '#9b8aa8', secondary: '#5c4f68', accent: '#cfc2d8', symbol: 'woven-moon', pattern: 'diamond', nameSyllables: ['sel', 'nuu'] },
  },
];

/**
 * Climate presets, expressed as the cell temperature/moisture the world model actually stores.
 * `climateZoneFrom` derives the zone from these, so each pair is picked to resolve to exactly one
 * of the six zones rather than naming the zone directly.
 */
const CLIMATES: readonly { id: string; label: string; temperature: number; moisture: number; floodDepth: number }[] = [
  { id: 'temperate', label: 'Temperate', temperature: 0.5, moisture: 0.45, floodDepth: 0 },
  { id: 'arid', label: 'Arid — thick mass, courtyards', temperature: 0.82, moisture: 0.18, floodDepth: 0 },
  { id: 'tropical', label: 'Tropical — deep eaves, open walls', temperature: 0.86, moisture: 0.62, floodDepth: 0 },
  { id: 'wet', label: 'Wet — raised floor, long eaves', temperature: 0.5, moisture: 0.8, floodDepth: 0.25 },
  { id: 'cold', label: 'Cold — steep roof, thick walls', temperature: 0.2, moisture: 0.3, floodDepth: 0 },
  { id: 'snowy', label: 'Snowy — steepest roof, raised floor', temperature: 0.18, moisture: 0.62, floodDepth: 0 },
];

/** The coarse structure class a period presumes, mirroring `presumedClass` in BuildingSpec. */
const PERIOD_CLASS = (period: ArchitecturalPeriod): DevelopmentResponse['material'] => {
  const rank = periodRank(period);
  if (rank <= 1) return 'earth';
  if (rank <= 3) return 'timber';
  if (rank <= 4) return 'masonry';
  if (rank === 5) return 'ceramic';
  return 'metal';
};

/**
 * A plausible need/form pairing per renderer role.
 *
 * The browser names its archetype explicitly, so these never steer archetype routing — but the
 * building grammar does read them, and a granary presented as `housing`/`dwelling` would be
 * given the wrong massing. Legacy roles use them for routing too, since those have no archetype.
 */
const ROLE_PROGRAM: Record<BuildingRole, { need: SettlementNeed; form: StructureForm }> = {
  shelter: { need: 'housing', form: 'dwelling' },
  'lean-to': { need: 'housing', form: 'dwelling' },
  'ritual-marker': { need: 'memory', form: 'marker' },
  'store-pit': { need: 'food', form: 'store' },
  hut: { need: 'housing', form: 'dwelling' },
  house: { need: 'housing', form: 'dwelling' },
  compound: { need: 'housing', form: 'dwelling' },
  granary: { need: 'food', form: 'store' },
  shrine: { need: 'religion', form: 'sanctuary' },
  market: { need: 'trade', form: 'gathering' },
  workshop: { need: 'manufacturing', form: 'workshop' },
  hall: { need: 'government', form: 'hall' },
  warehouse: { need: 'trade', form: 'store' },
  'gate-tower': { need: 'security', form: 'tower' },
  factory: { need: 'manufacturing', form: 'works' },
  foundry: { need: 'manufacturing', form: 'works' },
  research: { need: 'knowledge', form: 'hall' },
  energy: { need: 'energy', form: 'works' },
};

const STAGES: readonly { value: BuildStage; label: string }[] = [
  { value: BUILD_STAGE.DETAIL, label: 'Complete' },
  { value: BUILD_STAGE.FITOUT, label: 'Fit-out' },
  { value: BUILD_STAGE.UTILITIES, label: 'Utilities' },
  { value: BUILD_STAGE.ROOF, label: 'Roof' },
  { value: BUILD_STAGE.WALLS, label: 'Walls' },
  { value: BUILD_STAGE.FRAME, label: 'Frame' },
  { value: BUILD_STAGE.FOUNDATION, label: 'Foundation' },
  { value: BUILD_STAGE.SITE, label: 'Site set-out' },
];

const SPECIALIZATIONS = ['agriculture', 'forestry', 'mining', 'craft', 'exchange'] as const;

const ADAPTATION_CASES = FOUNDING_ADAPTATIONS;
const CATEGORIES = [...new Set(BROWSER_CATALOGUE.map(entry => entry.category))].sort();

// --------------------------------------------------------------------------- controls

const option = (select: HTMLSelectElement, value: string, label: string): void => {
  const node = document.createElement('option');
  node.value = value; node.textContent = label;
  select.append(node);
};

for (const [label, entries] of [
  ['Buildings', BROWSER_CATALOGUE.filter(entry => entry.geometry === 'generic')],
  ['Mills & machinery', BROWSER_CATALOGUE.filter(entry => entry.dedicatedKind === 'machine')],
  ['Infrastructure / dedicated', BROWSER_CATALOGUE.filter(entry => entry.geometry === 'dedicated' && entry.dedicatedKind !== 'machine')],
] as const) {
  const group = document.createElement('optgroup'); group.label = label;
  for (const entry of entries) {
    const node = document.createElement('option'); node.value = entry.id;
    node.textContent = `${entry.label} | ${entry.status}`; group.append(node);
  }
  archetypeSelect.append(group);
}
const foundingGroup = document.createElement('optgroup'); foundingGroup.label = 'Founding / early adaptations';
for (const entry of FOUNDING_ADAPTATIONS) {
  const node = document.createElement('option'); node.value = entry.id; node.textContent = entry.label; foundingGroup.append(node);
}
archetypeSelect.append(foundingGroup);
archetypeSelect.value = 'house';

option(categorySelect, 'all', 'All categories');
option(categorySelect, 'founding', 'Founding Structures');
for (const category of CATEGORIES) option(categorySelect, category, category);

for (const period of ARCHITECTURAL_PERIODS) {
  const drive = PERIOD_DRIVE[period];
  option(periodSelect, period, `${PERIOD_LABELS[period].label} · ${PERIOD_LABELS[period].approx} · ${drive.era} L${drive.level}`);
}
periodSelect.value = 'medieval';
for (const scenario of MATERIAL_SCENARIOS) option(materialSelect, scenario.id, scenario.label);

for (const culture of CULTURES) option(cultureSelect, culture.id, culture.label);
for (const climate of CLIMATES) option(climateSelect, climate.id, climate.label);
option(specializationSelect, 'none', 'None');
for (const specialization of SPECIALIZATIONS) option(specializationSelect, specialization, specialization);
option(programSelect, 'input', 'From input');
DEVELOPMENT_PROGRAM_INPUTS.forEach((program, index) => option(programSelect, String(index), `${program.need} / ${program.form}`));

for (const stage of STAGES) option(stageSelect, String(stage.value), stage.label);

// --------------------------------------------------------------------------- scene

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#aeb6a6');
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#f1f2df', '#58614a', 2.2));
const sun = new THREE.DirectionalLight('#fff1d5', 2.7);
sun.position.set(14, 26, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.02;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: '#808e6b', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.maxPolarAngle = Math.PI * 0.495;
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const resize = (): void => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

const assetBuilder = new AssetBuilder('architecture-browser');

/** Everything the browser puts on screen per rebuild, so one `remove` clears the whole layout. */
const stageRoot = new THREE.Group();
scene.add(stageRoot);

// --------------------------------------------------------------------------- motion preview

/**
 * Mill motion without a simulation.
 *
 * The browser has no live world, so the wind and river a mill sees are declared here, uniformly
 * across the preview, and the same `MillMotionSystem` the simulation uses reads them. Scrubbing
 * replays from rest at a fixed step, so a given time always shows the same pose. Play runs live.
 */
const millMotion = new MillMotionSystem(scene, { fullMotionRange: Infinity });
const PREVIEW_HZ = 30;
const PREVIEW_CELLS = 128;
const PREVIEW_CELL_SIZE = 2;
const pivotGeometry = new THREE.SphereGeometry(0.1, 10, 8);
// Drawn last and never occluded: a marker that writes no depth would otherwise be painted over by
// opaque geometry drawn after it in the front-to-back pass.
const pivotMaterial = new THREE.MeshBasicMaterial({ color: '#ff3b3b', depthTest: false, transparent: true });
let previewKey = '';
let previewWorld: MillConditionWorld = { size: PREVIEW_CELLS, cellSize: PREVIEW_CELL_SIZE, cells: [] };
let previewWeather: MillConditionWeather = { wind: 0, windX: 0, windZ: -1, cells: [] };
let previewClock = 0;
let playing = false;
let lastFrameTime = 0;

function previewInputs(): { wind: number; direction: number; flow: number; river: boolean } {
  return {
    wind: Number(el<HTMLInputElement>('wind').value),
    direction: Number(el<HTMLInputElement>('wind-direction').value),
    flow: Number(el<HTMLInputElement>('flow').value),
    river: el<HTMLInputElement>('river').checked,
  };
}

/** Rebuilds the uniform preview world only when a condition actually changes. */
function previewConditions(): void {
  const { wind, direction, flow, river } = previewInputs();
  const key = `${wind}|${direction}|${flow}|${river}`;
  if (key === previewKey) return;
  previewKey = key;
  const radians = direction * Math.PI / 180;
  // Air travels toward (windX, windZ). 270° sends it toward -Z, square on to a mill's entrance.
  const windX = Math.cos(radians);
  const windZ = Math.sin(radians);
  const count = PREVIEW_CELLS * PREVIEW_CELLS;
  const cell = { flow, river };
  const weatherCell = { wind, windX, windZ };
  previewWorld = { size: PREVIEW_CELLS, cellSize: PREVIEW_CELL_SIZE, cells: Array.from({ length: count }, () => cell) };
  previewWeather = { wind, windX, windZ, cells: Array.from({ length: count }, () => weatherCell) };
}

function motionFrame(deltaSeconds: number, elapsedSeconds: number) {
  previewConditions();
  return { deltaSeconds, elapsedSeconds, camera: camera.position, world: previewWorld, weather: previewWeather };
}

/** Plays the preview from rest up to the chosen time, so the same time always shows the same pose. */
function replayMotion(): void {
  millMotion.prune();
  const seconds = Number(el<HTMLInputElement>('motion-time').value);
  const steps = Math.round(seconds * PREVIEW_HZ);
  for (let step = 1; step <= steps; step += 1) millMotion.update(motionFrame(1 / PREVIEW_HZ, step / PREVIEW_HZ));
  previewClock = seconds;
}

/** Pivot markers, drawn at each rotor's own origin so the hub a part turns about is visible. */
function applyPivots(): void {
  const show = el<HTMLInputElement>('pivots').checked;
  for (const instance of instances) {
    instance.root.traverse(object => {
      if (!object.userData['millRotor']) return;
      for (const child of [...object.children]) if (child.name === 'pivot-marker') object.remove(child);
      if (!show) return;
      const marker = new THREE.Mesh(pivotGeometry, pivotMaterial);
      marker.name = 'pivot-marker';
      marker.renderOrder = 999;
      object.add(marker);
    });
  }
}

function syncPreviewOutputs(): void {
  el('wind-out').textContent = Number(el<HTMLInputElement>('wind').value).toFixed(2);
  el('wind-direction-out').textContent = el<HTMLInputElement>('wind-direction').value;
  el('flow-out').textContent = Number(el<HTMLInputElement>('flow').value).toFixed(2);
  el('motion-time-out').textContent = el<HTMLInputElement>('motion-time').value;
  el('yaw-out').textContent = el<HTMLInputElement>('yaw').value;
}

// --------------------------------------------------------------------------- instances

interface Instance {
  root: THREE.Object3D;
  pin: HTMLDivElement;
  anchor: THREE.Vector3;
  title: string;
  subtitle: string;
  archetype: BuildingArchetype | undefined;
  role: BuildingRole;
  period: ArchitecturalPeriod;
  requestedPeriod: ArchitecturalPeriod;
  stageName: string;
  definedIn: ArchitecturalPeriod | undefined;
  periodsOld: number;
  legacy: boolean;
  /** Missing production metadata is exposed rather than reconstructed by the viewer. */
  unpublished: boolean;
  lod: THREE.LOD | undefined;
  request: BuildRequest;
  config: AssetConfig;
}

let instances: Instance[] = [];
let selected = 0;

/** World units per canonical building unit. One building unit is roughly six metres. */
const WORLD_SCALE = 1;

interface BuildRequest {
  archetype?: BuildingArchetype;
  role: BuildingRole;
  period: ArchitecturalPeriod;
  legacy?: boolean;
  materialScenario?: string;
  subject?: string;
  /** Reproduce a raw compatibility role with no DevelopmentResponse, as ambient fabric does. */
  noDevelopment?: boolean;
  adaptation?: NonNullable<DevelopmentResponse['adaptation']>;
  program?: { need: SettlementNeed; form: StructureForm; material?: DevelopmentResponse['material'] };
  title: string;
  subtitle: string;
}

/** The production asset config for one card. Nothing else in the browser builds geometry. */
function configFor(request: BuildRequest): AssetConfig {
  const culture = CULTURES.find(entry => entry.id === cultureSelect.value) ?? CULTURES[0]!;
  const climate = CLIMATES.find(entry => entry.id === climateSelect.value) ?? CLIMATES[0]!;
  const drive = PERIOD_DRIVE[request.period];
  const program = ROLE_PROGRAM[request.role];
  const stage = Number(stageSelect.value) as BuildStage;
  const specialization = specializationSelect.value === 'none'
    ? undefined
    : specializationSelect.value as (typeof SPECIALIZATIONS)[number];

  // A seed that deliberately excludes the period, so the timeline shows one building carried
  // through its lineage rather than eight unrelated draws of the same archetype.
  const seed = `${seedInput.value}:${request.archetype ?? request.role}`;

  const selectedProgram = (programSelect.value === 'input' ? undefined : DEVELOPMENT_PROGRAM_INPUTS[Number(programSelect.value)]) ?? request.program ?? program;
  // Normal gallery cards use the minimal response needed to drive the requested period. The
  // Production Inputs view can deliberately omit it to reproduce raw compatibility roles, or
  // attach a founding adaptation to prove those too traverse production AssetBuilder.
  const development: DevelopmentResponse | undefined = request.noDevelopment ? undefined : {
    need: selectedProgram.need,
    form: selectedProgram.form,
    name: request.adaptation ?? request.archetype ?? request.role,
    level: drive.level,
    material: request.program?.material ?? PERIOD_CLASS(request.period),
    adaptation: request.adaptation,
    temporary: request.adaptation === 'lean-to',
    cultureId: culture.id,
    style: culture.style,
    services: {},
    reasons: [],
    capabilities: [],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 0,
  };

  const scenario = validMaterialScenarios(request.period).find(entry => entry.id === (request.materialScenario ?? materialSelect.value));
  if (development && scenario) {
    const evidence = scenarioEvidence(scenario, request.period);
    development.material = evidence.material ?? development.material;
    development.materialCost = evidence.materialCost;
    development.capabilities = evidence.capabilities;
  }

  return {
    seed,
    culture: culture.style,
    era: drive.era,
    variant: `${request.role}#${stage}`,
    development,
    archetype: request.archetype,
    prosperity: Number(prosperityInput.value),
    specialization,
    waterfront: waterfrontInput.checked,
    grammarContext: {
      temperature: climate.temperature,
      moisture: climate.moisture,
      floodDepth: climate.floodDepth,
    },
  };
}

const readString = (data: Record<string, unknown>, key: string): string | undefined => {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
};
const readNumber = (data: Record<string, unknown>, key: string, fallback: number): number => {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

function create(request: BuildRequest): Instance {
  const config = configFor(request);
  const asset = assetBuilder.getAsset('building', config);

  // The builder caches and hands back a shared instance. The browser clones it before laying it
  // out so that positioning a card can never move or rescale the asset the cache still owns.
  // `THREE.LOD.copy` carries its levels across, and clones share geometry and materials with the
  // production asset — which is also why nothing here ever disposes them.
  const root = asset.mesh.clone(true);
  millMotion.adopt(root);
  const data = asset.mesh.userData as Record<string, unknown>;

  const archetypeId = readString(data, 'architectureArchetype');
  const published = archetypeId !== undefined;
  const archetype = archetypeId && archetypeId in ARCHETYPE_LIBRARY
    ? archetypeId as BuildingArchetype
    : request.archetype;
  const periodId = readString(data, 'architecturePeriod');
  const period = periodId && (ARCHITECTURAL_PERIODS as readonly string[]).includes(periodId)
    ? periodId as ArchitecturalPeriod
    : request.period;

  const resolved = archetype ? archetypeStageFor(archetype, period) : undefined;

  const pin = document.createElement('div');
  pin.className = request.legacy ? 'pin legacy' : 'pin';
  labelLayer.append(pin);

  const instance: Instance = {
    root,
    pin,
    request,
    config,
    anchor: new THREE.Vector3(),
    title: request.title,
    subtitle: request.subtitle,
    archetype,
    role: request.role,
    period,
    requestedPeriod: request.period,
    stageName: resolved?.stage.name ?? '—',
    definedIn: resolved?.definedIn,
    periodsOld: resolved?.periodsOld ?? 0,
    legacy: request.legacy ?? false,
    unpublished: !published,
    lod: root instanceof THREE.LOD ? root : undefined,
  };

  // Lay cards out by what was actually drawn, so a mill's sails or millpond never overlap a neighbour.
  const drawn = new THREE.Box3().setFromObject(root);
  const reach = (min: number, max: number, fallback: number): number => Number.isFinite(min) ? Math.max(Math.abs(min), Math.abs(max)) * 2 : fallback;
  root.userData['browserFootprintWidth'] = reach(drawn.min.x, drawn.max.x, readNumber(data, 'footprintWidth', 1));
  root.userData['browserFootprintDepth'] = reach(drawn.min.z, drawn.max.z, readNumber(data, 'footprintDepth', 1));
  root.userData['browserHeight'] = readNumber(data, 'buildingHeight', 1);
  root.userData['browserMaterials'] = data['architectureMaterials'];
  root.userData['browserEquipment'] = data['architectureEquipment'];
  root.userData['browserFamily'] = readString(data, 'structuralFamily');
  root.userData['browserSilhouette'] = readString(data, 'architectureSilhouette');
  root.userData['browserWallAssembly'] = readString(data, 'wallAssembly');
  root.userData['browserFoundation'] = readString(data, 'foundationStyle');
  root.userData['browserDedicated'] = readString(data, 'dedicatedStructure');

  updatePinText(instance);
  return instance;
}

/** Pin clicks select by position, so they are wired once a layout's instance list is final. */
function wirePins(): void {
  instances.forEach((instance, index) => {
    instance.pin.onclick = () => {
      selected = index;
      const subject = instance.request.subject ?? instance.archetype;
      if (subject) archetypeSelect.value = subject;
      periodSelect.value = instance.requestedPeriod;
      if (instance.request.materialScenario) materialSelect.value = instance.request.materialScenario;
      syncChoices(); persistState(); refreshSelection();
    };
  });
}

const footprint = (instance: Instance): { width: number; depth: number; height: number } => ({
  width: readNumber(instance.root.userData, 'browserFootprintWidth', 1) * WORLD_SCALE,
  depth: readNumber(instance.root.userData, 'browserFootprintDepth', 1) * WORLD_SCALE,
  height: readNumber(instance.root.userData, 'browserHeight', 1) * WORLD_SCALE,
});

// --------------------------------------------------------------------------- layout

function clear(): void {
  stageRoot.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData['browserOwned']) object.geometry.dispose();
  });
  stageRoot.clear();
  catalogueGrid.replaceChildren();
  // Clones share geometry and materials with the cached production assets, so they are detached
  // and dropped rather than disposed. The AssetBuilder owns that lifetime and prunes its own cache.
  for (const instance of instances) instance.pin.remove();
  instances = [];
}

/** Lays cards out on a grid at one common world scale, so relative size stays readable. */
function grid(requests: readonly BuildRequest[]): void {
  const built = requests.map(create);
  instances = built;
  wirePins();

  let pitch = 2;
  for (const instance of built) {
    const size = footprint(instance);
    pitch = Math.max(pitch, size.width, size.depth);
  }
  pitch *= 1.45;

  const columns = Math.max(1, Math.ceil(Math.sqrt(built.length)));
  const rows = Math.ceil(built.length / columns);
  built.forEach((instance, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = (column - (columns - 1) / 2) * pitch;
    const z = (row - (rows - 1) / 2) * pitch;
    place(instance, x, z);
  });

  frameView(Math.max(columns, rows) * pitch);
}

const markerMaterials = [new THREE.MeshStandardMaterial({ color: '#9aa882', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#79866a', roughness: 1 })];

/** Lays cards out in one row, used by the timeline so the lineage reads left to right. */
function row(requests: readonly BuildRequest[], markers: boolean): void {
  const built = requests.map(create);
  instances = built;
  wirePins();

  let pitch = 2;
  for (const instance of built) pitch = Math.max(pitch, footprint(instance).width);
  pitch *= 1.5;

  built.forEach((instance, index) => {
    const x = (index - (built.length - 1) / 2) * pitch;
    place(instance, x, 0);
    if (markers) {
      // The one piece of geometry this file authors: a plinth strip marking each period slot.
      // It carries no architectural meaning and is never part of a building.
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(pitch * 0.9, 0.02, pitch * 0.9),
        markerMaterials[instance.periodsOld === 0 ? 0 : 1],
      );
      marker.userData['browserOwned'] = true;
      marker.position.set(x, 0.01, 0);
      marker.receiveShadow = true;
      stageRoot.add(marker);
    }
  });

  frameView(built.length * pitch * 0.9);
}

function place(instance: Instance, x: number, z: number): void {
  instance.root.position.set(x, 0, z);
  instance.root.scale.setScalar(WORLD_SCALE);
  instance.root.traverse(object => {
    if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  stageRoot.add(instance.root);
  instance.anchor.set(x, footprint(instance).height + 0.25, z);
}

function frameView(extent: number): void {
  if (view === 'street') {
    const size = instances[0] ? footprint(instances[0]) : { width: 2, depth: 2, height: 2 };
    // Eye height, set back far enough to take in the whole elevation.
    controls.target.set(0, size.height * 0.4, 0);
    camera.position.set(size.width * 0.75, Math.max(0.28, size.height * 0.28), size.depth * 1.5 + size.height * 1.35);
  } else {
    const span = Math.max(3, extent);
    controls.target.set(0, span * 0.06, 0);
    camera.position.set(span * 0.45, span * 0.5, span * 0.78);
  }
  // The yaw swings the framing about the subject, so side-mounted parts (a waterwheel in its race,
  // a wheel seen edge-on from the entrance) can be inspected without orbiting by hand.
  const yaw = Number(el<HTMLInputElement>('yaw').value) * Math.PI / 180;
  const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

// --------------------------------------------------------------------------- views

function visibleArchetypes(): readonly BuildingArchetype[] {
  const category = categorySelect.value;
  return BROWSER_CATALOGUE.filter(entry => category === 'all' || entry.category === category
    || category === 'founding' && entry.earliestPeriod === 'neolithic').map(entry => entry.id);
}

function subjectRequest(subject: string, period: ArchitecturalPeriod): BuildRequest {
  const adaptation = FOUNDING_ADAPTATIONS.find(entry => entry.id === subject);
  if (adaptation) return {
    archetype: adaptation.archetype, role: adaptation.role, adaptation: adaptation.adaptation,
    period, subject, title: adaptation.label, subtitle: 'Founding / early | production adaptation',
    program: { need: adaptation.need, form: adaptation.form, material: adaptation.material },
  };
  const entry = BROWSER_CATALOGUE.find(entry => entry.id === subject)!;
  // A catalogue archetype declares the programme it is shown with; roles without one fall back to their own.
  return { archetype: entry.id, role: entry.role, period, subject, title: entry.label, subtitle: `${entry.category} | ${entry.status}`, program: ARCHETYPE_LIBRARY[entry.id].presentationProgram };
}

function syncChoices(): void {
  const valid = validBrowserPeriods(archetypeSelect.value);
  const period = periodSelect.value as ArchitecturalPeriod;
  periodSelect.replaceChildren();
  for (const entry of valid) option(periodSelect, entry, PERIOD_LABELS[entry].label);
  if (!valid.includes(period)) option(periodSelect, period, `${PERIOD_LABELS[period].label} | Not available in this period`);
  periodSelect.value = period;
  const material = materialSelect.value;
  const allowed = validMaterialScenarios(period);
  materialSelect.replaceChildren();
  for (const scenario of MATERIAL_SCENARIOS) {
    option(materialSelect, scenario.id, scenario.label);
    materialSelect.lastElementChild!.toggleAttribute('disabled', !allowed.some(entry => entry.id === scenario.id));
  }
  materialSelect.value = allowed.some(entry => entry.id === material) ? material : 'auto';
}

function catalogueCards(period: ArchitecturalPeriod): void {
  for (const entry of BROWSER_CATALOGUE.filter(entry => visibleArchetypes().includes(entry.id))) {
    const card = document.createElement('button'); card.className = 'catalogue-card';
    const preview = instances.find(instance => instance.archetype === entry.id);
    const spec = preview?.root.userData['buildingSpec'] as BuildingSpec | undefined;
    const name = document.createElement('strong'); name.textContent = entry.label; card.append(name);
    const lines = [
      `${entry.status} | ${entry.category} | ${entry.geometry}${entry.dedicatedKind ? ` (${entry.dedicatedKind})` : ''}`,
      `${PERIOD_LABELS[entry.earliestPeriod].label} | ${PERIOD_LABELS[entry.periods.at(-1)!].label}`,
      `Families: ${spec ? structuralFamily(spec.family).label : entry.families.map(id => structuralFamily(id).label).join(', ')}`,
      `Supported roles: ${entry.reachedFromRoles.join(', ') || 'explicit catalogue request only'}; renderer: ${entry.role}`,
      spec ? `Current: ${architecturalMaterial(spec.materials.wall).label} / ${architecturalMaterial(spec.materials.frame).label} / ${architecturalMaterial(spec.materials.roofCovering).label}`
        : 'Current: Not available in this period',
    ];
    for (const text of lines) { const line = document.createElement('span'); line.textContent = text; card.append(line); }
    card.onclick = () => { archetypeSelect.value = entry.id; periodSelect.value = period; syncChoices(); setView('street'); };
    catalogueGrid.append(card);
  }
}

function rebuild(): void {
  syncChoices(); persistState(); clear();
  catalogueGrid.hidden = view !== 'catalogue';
  const period = periodSelect.value as ArchitecturalPeriod;
  const subject = archetypeSelect.value;
  const valid = validBrowserPeriods(subject);
  const requests: BuildRequest[] = [];
  const absent: string[] = [];
  if (view === 'timeline' || view === 'era-matrix') {
    for (const entry of valid) requests.push({ ...subjectRequest(subject, entry), title: PERIOD_LABELS[entry].label, subtitle: subjectRequest(subject, entry).title });
    el('count').textContent = `${subjectRequest(subject, period).title} | ${valid.length} valid periods`;
    el('absent').textContent = 'Same seed, culture, climate and prosperity; era/level drive the real historical period. Inherited stages remain visible.';
  } else if (view === 'street' || view === 'material-matrix') {
    if (valid.includes(period)) {
      if (view === 'street') requests.push(subjectRequest(subject, period));
      else for (const scenario of validMaterialScenarios(period)) requests.push({ ...subjectRequest(subject, period), materialScenario: scenario.id, title: scenario.label, subtitle: subjectRequest(subject, period).title });
      el('absent').textContent = view === 'material-matrix' ? 'Only material class, bill and capability evidence change. Identical results are shown honestly; no material is forced.' : '';
    } else el('absent').textContent = 'Not available in this period';
    el('count').textContent = `${subjectRequest(subject, period).title} | ${PERIOD_LABELS[period].label} | ${requests.length} previews`;
  } else if (view === 'founding' || view === 'gallery' && categorySelect.value === 'founding') {
    requests.push(...ADAPTATION_CASES.map(entry => subjectRequest(entry.id, 'neolithic')));
    for (const entry of BROWSER_CATALOGUE.filter(entry => entry.earliestPeriod === 'neolithic')) requests.push(subjectRequest(entry.id, 'neolithic'));
    el('count').textContent = `${requests.length} founding structures / earliest canonical stages`;
    el('absent').textContent = 'All previews use Neolithic production inputs and the same AssetBuilder/BuildingSpec path.';
  } else if (view === 'gallery' || view === 'catalogue') {
    for (const id of visibleArchetypes()) {
      if (validBrowserPeriods(id).includes(period)) requests.push(subjectRequest(id, period));
      else absent.push(ARCHETYPE_LIBRARY[id].label);
    }
    el('count').textContent = `${requests.length} available / ${visibleArchetypes().length} registered ? ${PERIOD_LABELS[period].label}`;
    el('absent').textContent = absent.length ? `Not available in this period: ${absent.join(', ')}.` : 'Every structure in this filter is available.';
  } else {
    const roleInputs: BuildRequest[] = BUILDING_ROLES.map(role => ({ role, period, legacy: true, noDevelopment: true,
      title: `role: ${role}`, subtitle: `compatibility input -> ${ARCHETYPE_LIBRARY[archetypeForRole(role)].label}` }));
    const adaptationInputs = ADAPTATION_CASES.map(entry => subjectRequest(entry.id, 'neolithic'));
    const earlyInputs = BROWSER_CATALOGUE.filter(entry => entry.status === 'active' && entry.earliestPeriod === 'neolithic').map(entry => subjectRequest(entry.id, 'neolithic'));
    const programInputs: BuildRequest[] = DEVELOPMENT_PROGRAM_INPUTS.map(program => ({ role: 'house', period, legacy: true, program: { ...program, material: PERIOD_CLASS(period) }, title: `purpose: ${program.need} / ${program.form}`, subtitle: 'authoritative development program' }));
    const activeInputs = BROWSER_CATALOGUE.filter(entry => entry.status === 'active' && entry.periods.includes(period)).map(entry => subjectRequest(entry.id, period));
    requests.push(...adaptationInputs, ...earlyInputs, ...roleInputs, ...programInputs, ...activeInputs);
    el('count').textContent = `${roleInputs.length} roles + ${adaptationInputs.length} founding adaptations + ${earlyInputs.length} earliest stages + ${programInputs.length} programs + ${activeInputs.length} active archetypes`;
    el('absent').textContent = 'Compatibility/program diagnostics show actual routing; explicit catalogue previews never request an unavailable period.';
  }
  if (view === 'timeline') row(requests, true); else grid(requests);
  selected = Math.max(0, instances.findIndex(instance => (instance.request.subject ?? instance.archetype) === subject && instance.requestedPeriod === period
    && (!instance.request.materialScenario || instance.request.materialScenario === materialSelect.value)));
  if (view === 'catalogue') catalogueCards(period);
  applyLodMode(); applyPivots(); replayMotion(); refreshSelection();
}

function applyLodMode(): void {
  const forced = fullDetailInput.checked;
  for (const instance of instances) {
    const lod = instance.lod;
    if (!lod) continue;
    lod.autoUpdate = !forced;
    if (forced) lod.levels.forEach((level, index) => { level.object.visible = index === 0; });
    else lod.update(camera);
  }
}

// --------------------------------------------------------------------------- inspector

function activeLevel(instance: Instance): string {
  const lod = instance.lod;
  if (!lod) return 'single mesh (no LOD at this stage)';
  const index = lod.levels.findIndex(level => level.object.visible);
  const level = lod.levels[index];
  if (!level) return 'none visible';
  return `${level.object.name || `level ${index}`} @ ${level.distance}+`;
}

function materialRows(assignment: unknown): string {
  if (!assignment || typeof assignment !== 'object') return '';
  const slots: (keyof MaterialAssignment)[] = [
    'foundation', 'frame', 'wall', 'infill', 'finish', 'roofStructure', 'roofCovering', 'trim', 'glazing', 'hardware',
  ];
  const record = assignment as Record<string, unknown>;
  const labels: Record<string, string> = {
    foundation: 'Foundation', frame: 'Frame', wall: 'Wall', infill: 'Infill', finish: 'Finish',
    roofStructure: 'Roof frame', roofCovering: 'Roof skin', trim: 'Trim', glazing: 'Glazing', hardware: 'Hardware',
  };
  return slots.map(slot => {
    const id = record[slot];
    if (typeof id !== 'string' || !isArchitecturalMaterial(id)) return `<dt>${labels[slot]}</dt><dd>none</dd>`;
    return `<dt>${labels[slot]}</dt><dd>${architecturalMaterial(id).label}</dd>`;
  }).join('');
}

/** Each rotor's drive, axis, pivot and current speed, read from the same data the motion system writes. */
function motionRows(root: THREE.Object3D): string {
  const rows: string[] = [];
  root.traverse(object => {
    const info = object.userData['millRotor'] as { axis: string; drive: string; motion?: string; ratio?: number; pivot: { x: number; y: number; z: number } } | undefined;
    if (!info) return;
    const speed = Number(object.userData['millSpeed'] ?? 0);
    const motion = info.motion ?? 'rotate';
    rows.push(`<b>${object.name}</b>: ${info.drive} → ${motion} ${info.axis}${info.ratio && info.ratio !== 1 ? ` ×${info.ratio.toFixed(2)}` : ''}${motion === 'yaw' ? '' : `, ${speed.toFixed(2)} rad/s`}`);
  });
  return rows.length ? rows.join('<br>') : 'none';
}

function refreshSelection(): void {
  instances.forEach((instance, index) => instance.pin.classList.toggle('sel', index === selected));
  const instance = instances[selected];
  if (!instance) { inspector.innerHTML = '<h3>Not available in this period</h3><p class="note">Choose a valid historical stage or another structure. No substitute is rendered.</p>'; return; }

  const data = instance.root.userData;
  const spec = data['buildingSpec'] as BuildingSpec | undefined;
  const entry = BROWSER_CATALOGUE.find(candidate => candidate.id === instance.archetype);
  const evidence = instance.config.development ? deriveMaterialEvidence({ response: instance.config.development }) : undefined;
  const scenario = validMaterialScenarios(instance.requestedPeriod).find(candidate => candidate.id === (instance.request.materialScenario ?? materialSelect.value)) ?? MATERIAL_SCENARIOS[0];
  const familyId = readString(data, 'browserFamily');
  const family = familyId ? structuralFamily(familyId as StructuralFamily) : undefined;
  const equipment = Array.isArray(data['browserEquipment']) ? data['browserEquipment'] as string[] : [];
  const size = footprint(instance);
  const dedicated = readString(data, 'browserDedicated');
  const lifted = instance.period !== instance.requestedPeriod;

  inspector.innerHTML = `
    <h3>${instance.title}</h3>
    <div class="cat">${instance.subtitle}</div>
    <dl>
      <dt>Archetype</dt><dd>${instance.archetype ? ARCHETYPE_LIBRARY[instance.archetype].label : '—'}</dd>
      <dt>Renderer role</dt><dd>${spec?.role ?? instance.role}</dd>
      <dt>Input role</dt><dd>${instance.request.role}</dd>
      <dt>Purpose</dt><dd>${readString(data, 'architecturePurpose') ?? '—'}</dd>
      <dt>Form</dt><dd>${readString(data, 'architectureForm') ?? 'unpublished'}</dd>
      <dt>Construction stage</dt><dd>${stageSelect.selectedOptions[0]?.textContent ?? 'Complete'}</dd>
      <dt>Adaptation</dt><dd>${readString(data, 'architectureAdaptation') ?? '—'}</dd>
      <dt>Stage name</dt><dd>${instance.stageName}</dd>
      <dt>Period</dt><dd>${PERIOD_LABELS[instance.period].label}<br><i>${PERIOD_LABELS[instance.period].approx}</i></dd>
      <dt>Stage set in</dt><dd>${instance.definedIn ? PERIOD_LABELS[instance.definedIn].label : '—'}${instance.periodsOld > 0 ? ` · ${instance.periodsOld} period${instance.periodsOld === 1 ? '' : 's'} old` : ' · new this period'}</dd>
    </dl>
    <dl>
      <dt>Family</dt><dd>${family ? family.label : '—'}</dd>
      <dt>Silhouette</dt><dd>${readString(data, 'browserSilhouette') ?? '—'}</dd>
      <dt>Wall</dt><dd>${readString(data, 'browserWallAssembly') ?? '—'}</dd>
      <dt>Footing</dt><dd>${readString(data, 'browserFoundation') ?? '—'}</dd>
    </dl>
    <dl>${materialRows(data['browserMaterials'])}</dl>
    <dl>
      <dt>Footprint</dt><dd>${size.width.toFixed(2)} × ${size.depth.toFixed(2)} units</dd>
      <dt>Height</dt><dd>${size.height.toFixed(2)} units</dd>
      <dt>Floors / bays</dt><dd>${spec?.floors ?? 'unpublished'} / ${spec?.bays ?? 'unpublished'}</dd>
      <dt>Annexes</dt><dd>${spec?.annexes ?? 'unpublished'}</dd>
      <dt>Opening density</dt><dd>${spec ? `${(spec.openings.density * 100).toFixed(1)}%` : 'unpublished'}</dd>
      <dt>Roof archetype</dt><dd>${spec?.roof.archetype ?? 'unpublished'}</dd>
      <dt>Geometry</dt><dd>${entry?.geometry ?? 'unpublished'}${dedicated ? ` | ${dedicated}` : ''}</dd>
      <dt>Catalogue status</dt><dd>${entry?.status ?? 'not a catalogue archetype'}</dd>
      <dt>Material scenario</dt><dd>${instance.config.development ? scenario?.label ?? 'Auto' : 'Raw compatibility input (scenario not applied)'}</dd>
      <dt>Evidence source</dt><dd>${spec?.provenance.evidenceGrade ?? evidence?.bestGrade ?? 'class'}</dd>
      <dt>Material bill</dt><dd>${Object.entries(instance.config.development?.materialCost ?? {}).map(([kind, amount]) => `${kind}: ${amount}`).join(', ') || 'none; production coarse-class fallback'}</dd>
      <dt>Capabilities</dt><dd>${instance.config.development?.capabilities.join(', ') || 'none supplied'}</dd>
      <dt>Equipment</dt><dd>${equipment.length ? equipment.join(', ') : 'none'}</dd>
      <dt>LOD</dt><dd id="active-lod">${activeLevel(instance)}</dd>
    </dl>
    <dl>
      <dt>Preview</dt><dd>wind ${Number(el<HTMLInputElement>('wind').value).toFixed(2)} from ${el<HTMLInputElement>('wind-direction').value}°, river ${el<HTMLInputElement>('river').checked ? `flow ${Number(el<HTMLInputElement>('flow').value).toFixed(2)}` : 'absent'}, t = ${el<HTMLInputElement>('motion-time').value}s</dd>
      <dt>Mill subtype</dt><dd>${readString(data, 'millSubtype') ?? '—'}</dd>
      <dt>Moving parts</dt><dd>${motionRows(instance.root)}</dd>
    </dl>
    ${dedicated ? `<p class="note">Dedicated composition: <b>${dedicated}</b>. Built by DedicatedStructures, not the standard wall/roof assembly.</p>` : ''}
    ${lifted ? `<p class="note">Requested ${PERIOD_LABELS[instance.requestedPeriod].label}; the resolver lifted it to ${PERIOD_LABELS[instance.period].label}, the earliest version that ever existed.</p>` : ''}
    ${instance.unpublished ? '<p class="note">This production asset published no architecture metadata. Requested identity is shown; missing resolved fields are not invented.</p>' : ''}
  `;
  const specDetails = document.createElement('details');
  const specLabel = document.createElement('summary');
  specLabel.textContent = 'Resolved BuildingSpec';
  const specText = document.createElement('pre');
  specText.style.whiteSpace = 'pre-wrap';
  specText.textContent = JSON.stringify(data['buildingSpec'], null, 2);
  specDetails.append(specLabel, specText);
  inspector.append(specDetails);
  const explanation = document.createElement('details');
  const heading = document.createElement('summary'); heading.textContent = 'Material decision evidence';
  const text = document.createElement('pre'); text.style.whiteSpace = 'pre-wrap';
  const supported = spec && evidence ? Object.entries(spec.materials).filter(([, id]) => isArchitecturalMaterial(id)).map(([slot, id]) => `${slot}: ${architecturalMaterial(id).label} - attested support ${(evidence.shares.get(id) ?? 0).toFixed(3)}`).join('\n') : 'No response bill; production class-only evidence';
  text.textContent = `${supported}\n\nFamily candidates (actual resolver scores):\n${spec?.provenance.familyRanking.map(rank => `${structuralFamily(rank.family).label}: ${rank.score.toFixed(4)}`).join('\n') ?? 'unpublished'}\n\nBills attest simulation material kinds, not exact finishes. The production resolver also weighs lineage, period, capabilities, climate, culture and prosperity. A scenario name does not guarantee its preferred material wins.`;
  explanation.append(heading, text); inspector.append(explanation);

}

// --------------------------------------------------------------------------- loop

const projected = new THREE.Vector3();

function updatePinText(instance: Instance): void {
  const family = readString(instance.root.userData, 'browserFamily');
  instance.pin.innerHTML = `<b>${instance.title}</b>${instance.stageName !== '—' ? `${instance.stageName}<br>` : ''}<i>${family ? structuralFamily(family as StructuralFamily).label : instance.subtitle}</i>`;
}

function updatePins(): void {
  for (const instance of instances) {
    projected.copy(instance.anchor).project(camera);
    const behind = projected.z > 1;
    instance.pin.style.display = behind ? 'none' : '';
    if (behind) continue;
    instance.pin.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
    instance.pin.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;

  }
}

function frame(): void {
  const now = performance.now();
  const delta = lastFrameTime === 0 ? 0 : Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (playing) {
    previewClock += delta;
    millMotion.update(motionFrame(delta, previewClock));
  }
  controls.update();
  if (!fullDetailInput.checked) for (const instance of instances) instance.lod?.update(camera);
  updatePins();
  const lodOutput = document.getElementById('active-lod');
  if (lodOutput && instances[selected]) lodOutput.textContent = activeLevel(instances[selected]!);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------------------- wiring

const stateControlIds = ['archetype', 'category', 'period', 'material-scenario', 'program', 'culture', 'climate', 'specialization', 'stage', 'seed', 'prosperity', 'wind', 'wind-direction', 'flow', 'motion-time', 'yaw'] as const;
const booleanControlIds = ['waterfront', 'full-detail', 'shadows', 'river', 'pivots', 'motion-play'] as const;
const viewModes: readonly ViewMode[] = ['gallery', 'timeline', 'street', 'production', 'era-matrix', 'material-matrix', 'catalogue', 'founding'];

function persistState(): void {
  const url = new URL(location.href);
  for (const id of stateControlIds) url.searchParams.set(id, el<HTMLInputElement | HTMLSelectElement>(id).value);
  for (const id of booleanControlIds) url.searchParams.set(id, String(el<HTMLInputElement>(id).checked));
  url.searchParams.set('view', view);
  history.replaceState(null, '', url);
}

function restoreState(): void {
  const query = new URL(location.href).searchParams;
  for (const id of stateControlIds) {
    const value = query.get(id); const control = el<HTMLInputElement | HTMLSelectElement>(id);
    if (value === null) continue;
    if (control instanceof HTMLSelectElement && !Array.from(control.options).some(entry => entry.value === value)) continue;
    control.value = value;
  }
  for (const id of booleanControlIds) if (query.has(id)) el<HTMLInputElement>(id).checked = query.get(id) === 'true';
  const savedView = query.get('view') as ViewMode;
  if (viewModes.includes(savedView)) view = savedView;
}

function setView(next: ViewMode): void {
  view = next;
  if (next === 'founding') {
    if (!validBrowserPeriods(archetypeSelect.value).includes('neolithic')) archetypeSelect.value = 'founding:lean-to';
    option(periodSelect, 'neolithic', PERIOD_LABELS.neolithic.label); periodSelect.value = 'neolithic';
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset['view'] === view)));
  el('archetype-hint').textContent = view === 'gallery' || view === 'production' || view === 'catalogue' ? '(selected subject)' : '';
  rebuild();
}

function cycleStructure(direction: number): void {
  const filtered = visibleArchetypes();
  const subjects = categorySelect.value === 'founding' || view === 'founding'
    ? [...FOUNDING_ADAPTATIONS.map(entry => entry.id), ...BROWSER_CATALOGUE.filter(entry => entry.earliestPeriod === 'neolithic').map(entry => entry.id)]
    : [...filtered, ...(categorySelect.value === 'all' ? FOUNDING_ADAPTATIONS.map(entry => entry.id) : [])];
  if (!subjects.length) return;
  const index = subjects.indexOf(archetypeSelect.value as BuildingArchetype);
  archetypeSelect.value = subjects[(index + direction + subjects.length) % subjects.length]!;
  syncChoices(); rebuild();
}

function cyclePeriod(direction: number, distinct = false): void {
  const subject = archetypeSelect.value;
  const valid = validBrowserPeriods(subject).filter(period => !distinct || subject.startsWith('founding:')
    || BROWSER_CATALOGUE.find(entry => entry.id === subject)?.stages.find(stage => stage.period === period)?.distinct);
  if (!valid.length) return;
  const current = periodRank(periodSelect.value as ArchitecturalPeriod);
  const next = direction > 0 ? valid.find(period => periodRank(period) > current) ?? valid[0]!
    : [...valid].reverse().find(period => periodRank(period) < current) ?? valid.at(-1)!;
  periodSelect.value = next; syncChoices(); rebuild();
}

function cycleMaterial(direction: number): void {
  const scenarios = validMaterialScenarios(periodSelect.value as ArchitecturalPeriod);
  const index = scenarios.findIndex(entry => entry.id === materialSelect.value);
  materialSelect.value = scenarios[(index + direction + scenarios.length) % scenarios.length]!.id; rebuild();
}

let seedCounter = 0;
function reseed(): void {
  seedCounter = Math.max(seedCounter, Number(seedInput.value.match(/:qa-(\d+)$/)?.[1] ?? 0)) + 1;
  seedInput.value = `${seedInput.value.replace(/:qa-\d+$/, '')}:qa-${seedCounter}`;
  rebuild();
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { button.onclick = () => setView(button.dataset['view'] as ViewMode); });
el('previous-structure').onclick = () => cycleStructure(-1);
el('next-structure').onclick = () => cycleStructure(1);
el('previous-era').onclick = () => cyclePeriod(-1);
el('next-era').onclick = () => cyclePeriod(1);
el('previous-stage').onclick = () => cyclePeriod(-1, true);
el('next-stage').onclick = () => cyclePeriod(1, true);
el('previous-material').onclick = () => cycleMaterial(-1);
el('next-material').onclick = () => cycleMaterial(1);
for (const id of ['culture', 'climate', 'specialization', 'stage', 'program', 'material-scenario']) el<HTMLSelectElement>(id).onchange = rebuild;
archetypeSelect.onchange = () => { syncChoices(); rebuild(); };
categorySelect.onchange = () => {
  if (categorySelect.value === 'founding') setView('founding');
  else { if (!visibleArchetypes().includes(archetypeSelect.value as BuildingArchetype)) archetypeSelect.value = visibleArchetypes()[0] ?? 'house'; syncChoices(); rebuild(); }
};
periodSelect.onchange = rebuild;
waterfrontInput.onchange = rebuild;
prosperityInput.oninput = () => { el('prosperity-out').textContent = Number(prosperityInput.value).toFixed(2); };
prosperityInput.onchange = rebuild;
fullDetailInput.onchange = () => { applyLodMode(); persistState(); refreshSelection(); };
shadowsInput.onchange = () => { sun.castShadow = shadowsInput.checked; persistState(); };
seedInput.onchange = rebuild;
el('reseed').onclick = reseed;
el('reset-seed').onclick = () => { seedCounter = 0; seedInput.value = 'browser'; rebuild(); };
for (const id of ['wind', 'wind-direction', 'flow', 'motion-time', 'yaw']) {
  el<HTMLInputElement>(id).oninput = syncPreviewOutputs;
}
el<HTMLInputElement>('yaw').onchange = () => { persistState(); rebuild(); };
for (const id of ['wind', 'wind-direction', 'flow', 'river', 'motion-time']) el<HTMLInputElement>(id).onchange = () => { persistState(); rebuild(); };
el<HTMLInputElement>('pivots').onchange = () => { persistState(); applyPivots(); };
el<HTMLInputElement>('motion-play').onchange = () => { playing = el<HTMLInputElement>('motion-play').checked; lastFrameTime = 0; };
window.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.closest('input,select,textarea,[contenteditable]') || target.isContentEditable)) return;
  if (window.getSelection()?.toString()) return;
  const keys: Record<string, () => void> = {
    ArrowLeft: () => cycleStructure(-1), ArrowRight: () => cycleStructure(1),
    ArrowUp: () => cyclePeriod(-1), ArrowDown: () => cyclePeriod(1),
    '[': () => cycleMaterial(-1), ']': () => cycleMaterial(1),
    r: reseed, g: () => setView('gallery'), t: () => setView('timeline'), s: () => setView('street'),
    e: () => setView('era-matrix'), m: () => setView('material-matrix'),
  };
  const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (action) { event.preventDefault(); action(); }
});

window.addEventListener('pagehide', () => {
  clear(); assetBuilder.dispose(); ground.geometry.dispose();
  (ground.material as THREE.Material).dispose(); markerMaterials.forEach(material => material.dispose());
  pivotGeometry.dispose(); pivotMaterial.dispose();
  controls.dispose(); renderer.dispose();
});
restoreState();
el('prosperity-out').textContent = Number(prosperityInput.value).toFixed(2);
syncPreviewOutputs();
// Machinery runs by default: a quern, a saw or a sail that is not working does not explain itself.
playing = el<HTMLInputElement>('motion-play').checked;
sun.castShadow = shadowsInput.checked;
setView(view);
requestAnimationFrame(frame);
