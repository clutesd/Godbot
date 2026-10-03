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
  ARCHETYPE_LIBRARY, BUILDING_ARCHETYPES, archetypeEarliestPeriod, archetypeExistsIn,
  archetypeStageFor, archetypesForRole, buildingArchetype, type BuildingArchetype,
} from '../render/architecture/BuildingArchetype';
import {
  ARCHITECTURAL_PERIODS, PERIOD_LABELS, periodRank, type ArchitecturalPeriod,
} from '../render/architecture/ArchitecturalPeriod';
import { structuralFamily, type StructuralFamily } from '../render/architecture/StructuralFamily';
import { architecturalMaterial, isArchitecturalMaterial } from '../render/architecture/MaterialLibrary';
import { archetypeForRole } from '../render/architecture/ArchetypeRouting';
import type { MaterialAssignment } from '../render/architecture/BuildingSpec';
import type { Era } from '../render/materials/MaterialPalette';

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
const prosperityInput = el<HTMLInputElement>('prosperity');
const waterfrontInput = el<HTMLInputElement>('waterfront');
const fullDetailInput = el<HTMLInputElement>('full-detail');
const shadowsInput = el<HTMLInputElement>('shadows');
const seedInput = el<HTMLInputElement>('seed');
const labelLayer = el<HTMLDivElement>('labels');
const inspector = el<HTMLElement>('inspector');

type ViewMode = 'gallery' | 'timeline' | 'street' | 'legacy';
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

/**
 * The (era, development level) pair that drives each architectural period.
 *
 * `architecturalPeriod` derives the period from the presentation era's band and the response's
 * development level — it is never passed in directly — so browsing by period means driving it
 * through its real inputs. Level 1 sits at the era's floor and level 3 at its ceiling, which
 * makes every one of the eight periods reachable. No capabilities are supplied, because observed
 * capability can only raise the period floor and would override the choice made here.
 */
const PERIOD_DRIVE: Record<ArchitecturalPeriod, { era: Era; level: number }> = {
  neolithic: { era: 'early', level: 1 },
  bronzeIron: { era: 'early', level: 3 },
  classical: { era: 'preIndustrial', level: 1 },
  medieval: { era: 'preIndustrial', level: 2 },
  earlyModern: { era: 'preIndustrial', level: 3 },
  industrial: { era: 'industrial', level: 3 },
  modern: { era: 'advanced', level: 1 },
  contemporary: { era: 'advanced', level: 3 },
};

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

/** Renderer roles no archetype presents as. Derived, so it empties itself as archetypes land. */
const LEGACY_ROLES: readonly BuildingRole[] = (Object.keys(ROLE_PROGRAM) as BuildingRole[])
  .filter(role => archetypesForRole(role).length === 0);

const CATEGORIES = [...new Set(BUILDING_ARCHETYPES.map(id => ARCHETYPE_LIBRARY[id].category))].sort();

// --------------------------------------------------------------------------- controls

const option = (select: HTMLSelectElement, value: string, label: string): void => {
  const node = document.createElement('option');
  node.value = value; node.textContent = label;
  select.append(node);
};

for (const id of BUILDING_ARCHETYPES) {
  const definition = ARCHETYPE_LIBRARY[id];
  option(archetypeSelect, id, `${definition.label} · ${definition.category}`);
}
archetypeSelect.value = 'house';

option(categorySelect, 'all', 'All categories');
for (const category of CATEGORIES) option(categorySelect, category, category);

for (const period of ARCHITECTURAL_PERIODS) {
  const drive = PERIOD_DRIVE[period];
  option(periodSelect, period, `${PERIOD_LABELS[period].label} · ${PERIOD_LABELS[period].approx} · ${drive.era} L${drive.level}`);
}
periodSelect.value = 'medieval';

for (const culture of CULTURES) option(cultureSelect, culture.id, culture.label);
for (const climate of CLIMATES) option(climateSelect, climate.id, climate.label);
option(specializationSelect, 'none', 'None');
for (const specialization of SPECIALIZATIONS) option(specializationSelect, specialization, specialization);
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
  /**
   * The composition published no architecture userData. The open-gathering-precinct path in
   * BuildingComposer is the one composition that returns without calling `publishArchitecture`,
   * so a level-1 `gathering` structure resolves a full spec but reports none of it. The browser
   * falls back to what it requested and says so, rather than showing a card of dashes.
   */
  unpublished: boolean;
  lod: THREE.LOD | undefined;
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

  // The minimal response the architecture system needs: it supplies the development level that
  // drives the period, and the coarse structure class. With no project, no material bill and no
  // stock, `deriveMaterialEvidence` reduces to exactly the class-only evidence the no-response
  // path would use, so the browser adds no material bias of its own.
  const development: DevelopmentResponse = {
    need: program.need,
    form: program.form,
    name: request.archetype ?? request.role,
    level: drive.level,
    material: PERIOD_CLASS(request.period),
    cultureId: culture.id,
    style: culture.style,
    services: {},
    reasons: [],
    capabilities: [],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 0,
  };

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
  const asset = assetBuilder.getAsset('building', configFor(request));

  // The builder caches and hands back a shared instance. The browser clones it before laying it
  // out so that positioning a card can never move or rescale the asset the cache still owns.
  // `THREE.LOD.copy` carries its levels across, and clones share geometry and materials with the
  // production asset — which is also why nothing here ever disposes them.
  const root = asset.mesh.clone(true);
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

  root.userData['browserFootprintWidth'] = readNumber(data, 'footprintWidth', 1);
  root.userData['browserFootprintDepth'] = readNumber(data, 'footprintDepth', 1);
  root.userData['browserHeight'] = readNumber(data, 'buildingHeight', 1);
  root.userData['browserMaterials'] = data['architectureMaterials'];
  root.userData['browserEquipment'] = data['architectureEquipment'];
  root.userData['browserFamily'] = readString(data, 'structuralFamily');
  root.userData['browserSilhouette'] = readString(data, 'architectureSilhouette');
  root.userData['browserWallAssembly'] = readString(data, 'wallAssembly');
  root.userData['browserFoundation'] = readString(data, 'foundationStyle');
  root.userData['browserDedicated'] = readString(data, 'dedicatedStructure');

  return instance;
}

/** Pin clicks select by position, so they are wired once a layout's instance list is final. */
function wirePins(): void {
  instances.forEach((instance, index) => {
    instance.pin.onclick = () => { selected = index; refreshSelection(); };
  });
}

const footprint = (instance: Instance): { width: number; depth: number; height: number } => ({
  width: readNumber(instance.root.userData, 'browserFootprintWidth', 1) * WORLD_SCALE,
  depth: readNumber(instance.root.userData, 'browserFootprintDepth', 1) * WORLD_SCALE,
  height: readNumber(instance.root.userData, 'browserHeight', 1) * WORLD_SCALE,
});

// --------------------------------------------------------------------------- layout

function clear(): void {
  stageRoot.clear();
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
        new THREE.MeshStandardMaterial({
          color: instance.periodsOld === 0 ? '#9aa882' : '#79866a',
          roughness: 1,
        }),
      );
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
  controls.update();
}

// --------------------------------------------------------------------------- views

function visibleArchetypes(): readonly BuildingArchetype[] {
  const category = categorySelect.value;
  return BUILDING_ARCHETYPES.filter(id => category === 'all' || ARCHETYPE_LIBRARY[id].category === category);
}

function rebuild(): void {
  clear();
  selected = 0;
  const period = periodSelect.value as ArchitecturalPeriod;
  const absent: string[] = [];

  if (view === 'gallery') {
    const shown = visibleArchetypes().filter(id => {
      if (archetypeExistsIn(id, period)) return true;
      absent.push(`${ARCHETYPE_LIBRARY[id].label} (from ${PERIOD_LABELS[archetypeEarliestPeriod(id)].label})`);
      return false;
    });
    grid(shown.map(id => ({
      archetype: id,
      role: ARCHETYPE_LIBRARY[id].role,
      period,
      title: ARCHETYPE_LIBRARY[id].label,
      subtitle: ARCHETYPE_LIBRARY[id].category,
    })));
    el('count').textContent = `${shown.length} of ${BUILDING_ARCHETYPES.length} archetypes · ${PERIOD_LABELS[period].label}`;
    el('absent').textContent = absent.length
      ? `Not yet built in this period: ${absent.join(', ')}.`
      : 'Every archetype in this filter exists in this period.';
  } else if (view === 'timeline') {
    const id = archetypeSelect.value as BuildingArchetype;
    const definition = buildingArchetype(id);
    const earliest = archetypeEarliestPeriod(id);
    const periods = ARCHITECTURAL_PERIODS.filter(entry => periodRank(entry) >= periodRank(earliest));
    row(periods.map(entry => ({
      archetype: id,
      role: definition.role,
      period: entry,
      title: PERIOD_LABELS[entry].label,
      subtitle: PERIOD_LABELS[entry].approx,
    })), true);
    const changes = periods.filter(entry => archetypeStageFor(id, entry)?.periodsOld === 0).length;
    el('count').textContent = `${definition.label} · ${periods.length} periods · ${changes} distinct stages`;
    el('absent').textContent = `Lighter pads mark a period that defines a new stage; darker pads inherit the previous one. Appears from ${PERIOD_LABELS[earliest].label}.`;
  } else if (view === 'street') {
    const id = archetypeSelect.value as BuildingArchetype;
    const definition = buildingArchetype(id);
    grid([{
      archetype: id,
      role: definition.role,
      period,
      title: definition.label,
      subtitle: definition.category,
    }]);
    el('count').textContent = `${definition.label} · ${PERIOD_LABELS[period].label}`;
    el('absent').textContent = archetypeExistsIn(id, period)
      ? ''
      : `Not built until ${PERIOD_LABELS[archetypeEarliestPeriod(id)].label}; the resolver presents the earliest version of itself instead.`;
  } else {
    grid(LEGACY_ROLES.map(role => ({
      role,
      period,
      legacy: true,
      title: role,
      subtitle: `falls back to ${ARCHETYPE_LIBRARY[archetypeForRole(role)].label}`,
    })));
    el('count').textContent = `${LEGACY_ROLES.length} of ${Object.keys(ROLE_PROGRAM).length} renderer roles unmigrated`;
    el('absent').textContent = LEGACY_ROLES.length
      ? 'These renderer roles have no archetype declaring them. They still render, routed to a default archetype by role, and are the remaining migration surface.'
      : 'Every renderer role is now claimed by an architecture archetype.';
  }

  applyLodMode();
  refreshSelection();
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
    if (typeof id !== 'string' || !isArchitecturalMaterial(id)) return '';
    return `<dt>${labels[slot]}</dt><dd>${architecturalMaterial(id).label}</dd>`;
  }).join('');
}

function refreshSelection(): void {
  instances.forEach((instance, index) => instance.pin.classList.toggle('sel', index === selected));
  const instance = instances[selected];
  if (!instance) { inspector.innerHTML = '<h3>Nothing to show</h3><p class="note">No archetype matches the current filter.</p>'; return; }

  const data = instance.root.userData;
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
      <dt>Renderer role</dt><dd>${instance.role}</dd>
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
      <dt>Equipment</dt><dd>${equipment.length ? equipment.join(', ') : 'none'}</dd>
      <dt>LOD</dt><dd>${activeLevel(instance)}</dd>
    </dl>
    ${dedicated ? `<p class="note">Dedicated composition: <b>${dedicated}</b>. Built by DedicatedStructures, not the standard wall/roof assembly.</p>` : ''}
    ${lifted ? `<p class="note">Requested ${PERIOD_LABELS[instance.requestedPeriod].label}; the resolver lifted it to ${PERIOD_LABELS[instance.period].label}, the earliest version that ever existed.</p>` : ''}
    ${instance.unpublished ? '<p class="note">Composed as an <b>open gathering precinct</b> — a level-1 <i>gathering</i> structure. That path in BuildingComposer returns without publishing architecture userData, so family, materials and footing are unavailable here and the archetype and period shown are the ones requested.</p>' : ''}
  `;
}

// --------------------------------------------------------------------------- loop

const projected = new THREE.Vector3();

function updatePins(): void {
  for (const instance of instances) {
    projected.copy(instance.anchor).project(camera);
    const behind = projected.z > 1;
    instance.pin.style.display = behind ? 'none' : '';
    if (behind) continue;
    instance.pin.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
    instance.pin.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
    const family = readString(instance.root.userData, 'browserFamily');
    instance.pin.innerHTML = `<b>${instance.title}</b>${instance.stageName !== '—' ? `${instance.stageName}<br>` : ''}<i>${family ? structuralFamily(family as StructuralFamily).label : instance.subtitle}</i>`;
  }
}

function frame(): void {
  controls.update();
  if (!fullDetailInput.checked) for (const instance of instances) instance.lod?.update(camera);
  updatePins();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------------------- wiring

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
  button.onclick = () => {
    view = button.dataset['view'] as ViewMode;
    document.querySelectorAll<HTMLButtonElement>('[data-view]')
      .forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    el('archetype-hint').textContent = view === 'gallery' || view === 'legacy' ? '(subject of timeline/street)' : '';
    rebuild();
  };
});

for (const id of ['archetype', 'category', 'period', 'culture', 'climate', 'specialization', 'stage']) {
  el<HTMLSelectElement>(id).onchange = rebuild;
}
waterfrontInput.onchange = rebuild;
prosperityInput.oninput = () => { el('prosperity-out').textContent = Number(prosperityInput.value).toFixed(2); };
prosperityInput.onchange = rebuild;
fullDetailInput.onchange = () => { applyLodMode(); refreshSelection(); };
shadowsInput.onchange = () => { sun.castShadow = shadowsInput.checked; };
seedInput.onchange = rebuild;
// A counted sequence rather than a random one: every seed the browser hands out can be typed
// back in to reach the same buildings again, which is the whole point of a deterministic viewer.
let seedCounter = 0;
el('reseed').onclick = () => { seedInput.value = `browser-${++seedCounter}`; rebuild(); };
el('reset-seed').onclick = () => { seedCounter = 0; seedInput.value = 'browser'; rebuild(); };

el('prosperity-out').textContent = Number(prosperityInput.value).toFixed(2);
el('archetype-hint').textContent = '(subject of timeline/street)';
rebuild();
requestAnimationFrame(frame);
