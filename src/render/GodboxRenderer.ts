import * as THREE from 'three';
import { transportRibbon } from './transport/TransportGeometry';
import { gradeViolations, positionAlongPath } from '../sim/transport/TransportNetwork';
import type { GodboxConfig } from '../config';
import type { Historian } from '../historian/Historian';
import { SeededRandom } from '../sim/prng';
import type { Culture, Person, PersonRole, Settlement, SimulationState, Vec2 } from '../sim/types';
import { CameraDirector, type CurrentObservation } from './CameraDirector';
import { AnimationController } from './animation/AnimationController';
import { AssetBuilder } from './assets/AssetBuilder';
import { BUILD_STAGE, stageFromName, type BuildStage } from './assets/BuildingComposer';
import { eraRank, type BuildingRole } from './assets/BuildingGrammar';
import { MaterialPalette, type Era } from './materials/MaterialPalette';
import { PlacementContract } from './placement/PlacementContract';
import { PlacementFootprint } from './placement/PlacementFootprint';
import { createSettlementLayoutPlan, districtForPlot, type BuildingDistrict, type SettlementLayoutPlan } from './placement/SettlementLayoutPlan';
import { TerrainQueries } from './placement/TerrainQueries';
import { TransitionTimeline } from './presentation/TransitionTimeline';
import { VisualStateResolver } from './presentation/VisualStateResolver';
import { CultureStyleProfileFactory } from './style/CultureStyleProfile';
import { SkyAtmosphere } from './atmosphere/SkyAtmosphere';
import { softPointTexture } from './atmosphere/sprites';
import { TerrainDecor } from './terrain/TerrainDecor';
import { TerrainSurface } from './terrain/TerrainSurface';
import { WaterSystem } from './terrain/WaterSystem';
import { WeatherRenderer } from './atmosphere/WeatherRenderer';
import { VegetationRenderer } from './vegetation/VegetationRenderer';

interface SettlementVisual {
  group: THREE.Group;
  buildingCount: number;
  institutionCount: number;
  routeCount: number;
  politySize: number;
  developmentSignature: string;
  /** Lifecycle stage of every plot, so a structure is re-emitted as it rises. */
  constructionSignature: string;
  powerLevel: number;
  lights: SettlementLightEntry[];
  smokeSources: SmokeSource[];
}

interface SettlementLightEntry {
  light: THREE.PointLight;
  base: number;
  /** 0 for steady lamps; >0 gives firelight wobble. */
  flicker: number;
}

interface SmokeSource {
  worldX: number;
  worldY: number;
  worldZ: number;
  strength: number;
  /** 0..1 plume brightness; polluted industry runs darker. */
  shade: number;
}

interface BuildingPlacement {
  key: string;
  localX: number;
  localZ: number;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  major: boolean;
  district: BuildingDistrict;
  /** The structure this plot is destined to hold. Earlier eras render its ancestor. */
  role: BuildingRole;
  /** Era at founding. A plot never renders older than the day it was laid out. */
  builtEra: Era;
  /** 0..1 resistance to modernisation, which is what keeps old buildings among new ones. */
  conservatism: number;
  /** Cache bucket, so structures of the same kind share one geometry. */
  variation: number;
}

interface VegetationPlacement {
  worldX: number;
  worldZ: number;
}

interface RoutePlacementReport {
  routeId: string;
  mode: 'land' | 'water';
  railSupported: boolean;
  samples: number;
  waterSamples: number;
  bridgeSegments: number;
  maxTerrainError: number;
  gradeViolations: number;
}

export interface PlacementSmokeReport {
  buildings: { persistent: number; underwater: number; drifted: number };
  people: { represented: number; visible: number; underwater: number; invalidRoutes: number; insideBuildings: number; outOfScale: number; validCrossings: number };
  vegetation: { placed: number; underwater: number };
  routes: { active: number; waterCrossings: number; unresolvedCrossings: number; maxTerrainError: number; roadGradeViolations: number; railGradeViolations: number };
}

/** Camera distance at which the forest re-sorts its detail tiers. */
const VEGETATION_LOD_INTERVAL_SECONDS = 0.4;

const ERA_ORDER: readonly Era[] = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'];

const SMOKE_PUFFS_PER_SOURCE = 5;
/** Point lights across all settlements; beyond this, forward shading cost outruns the mood. */
const SETTLEMENT_LIGHT_BUDGET = 18;
/**
 * Authoritative humanoid world scale. All person geometry, position offsets and
 * `heightScale`/`buildScale` are expressed relative to a canonical adult of height 1; this
 * factor converts that canonical rig into world units so a normal adult reads as clearly
 * smaller than the smallest inhabited structure (huts/shelters) and never approaches an
 * ordinary house. Applying it once, at the top of the scale chain, keeps LOD and camera
 * framing changes from ever altering apparent world-space height.
 */
const HUMAN_WORLD_SCALE = 0.28;
/** Canonical adult humanoid height in world units (feet to crown) at `heightScale === 1`. */
export const CANONICAL_ADULT_HEIGHT = HUMAN_WORLD_SCALE * 0.96;
const PERSON_ROLE_CUES = {
  earth: new THREE.Color('#667a42'), water: new THREE.Color('#3f6e78'), labor: new THREE.Color('#9a6b36'),
  trade: new THREE.Color('#b58137'), guard: new THREE.Color('#4e5866'), ritual: new THREE.Color('#a45d85'),
  civic: new THREE.Color('#5b4d78'), knowledge: new THREE.Color('#58779b'), industry: new THREE.Color('#596369'),
  ordinary: new THREE.Color('#84614f'),
} as const;

export const visiblePersonBudgetForDensity = (density: number): number => Math.max(48, Math.round(384 * density));

export class GodboxRenderer {
  readonly observation: CurrentObservation;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900);
  private readonly cameraDirector: CameraDirector;
  private readonly random: SeededRandom;
  private readonly sun = new THREE.DirectionalLight('#ffe2b5', 3.4);
  private readonly moon = new THREE.DirectionalLight('#8fa6d9', 0.16);
  private readonly hemisphere = new THREE.HemisphereLight('#91b6ca', '#5c392e', 1.5);
  private readonly catastropheLight = new THREE.PointLight('#fff4d2', 0, 120, 1.4);
  private readonly people: THREE.InstancedMesh;
  private readonly peopleHeads: THREE.InstancedMesh;
  private readonly peopleArms: THREE.InstancedMesh;
  private readonly peopleLegs: THREE.InstancedMesh;
  private readonly peopleTools: THREE.InstancedMesh;
  private readonly peopleHeadwear: THREE.InstancedMesh;
  private readonly peopleCargo: THREE.InstancedMesh;
  private readonly personMatrix = new THREE.Matrix4();
  private readonly personColor = new THREE.Color();
  private readonly personDetailColor = new THREE.Color();
  private readonly partPosition = new THREE.Vector3();
  private readonly partQuaternion = new THREE.Quaternion();
  private readonly partScale = new THREE.Vector3();
  private readonly animationController: AnimationController;
  private readonly assetBuilder: AssetBuilder;
  private readonly visualStateResolver = new VisualStateResolver();
  private readonly transitionTimeline = new TransitionTimeline();
  private readonly cultureById = new Map<string, Culture>();
  private readonly terrainQueries: TerrainQueries;
  private readonly placementContract: PlacementContract;
  private readonly placementFootprints: PlacementFootprint;
  private readonly accentByCulture = new Map<string, THREE.Color>();
  private readonly dayColor = new THREE.Color('#91aaa0');
  private readonly duskColor = new THREE.Color('#b87569');
  private readonly nightColor = new THREE.Color('#11172d');
  private readonly fogDayColor = new THREE.Color('#75837d');
  private readonly aftermathColor = new THREE.Color('#403f43');
  private readonly zenithDayColor = new THREE.Color('#6f9dc4');
  private readonly zenithNightColor = new THREE.Color('#0d1428');
  private readonly horizonDayColor = new THREE.Color('#cfd8d3');
  private readonly horizonDuskColor = new THREE.Color('#e0a077');
  private readonly horizonNightColor = new THREE.Color('#1b2340');
  private readonly skyZenith = new THREE.Color();
  private readonly skyHorizon = new THREE.Color();
  private readonly skyColor = new THREE.Color();
  private readonly settlementVisuals = new Map<string, SettlementVisual>();
  private readonly settlementBuildingPlacements = new Map<string, BuildingPlacement[]>();
  private readonly landmarkPlacements = new Map<string, { worldX: number; worldZ: number; role: BuildingRole; rotationY: number }>();
  private readonly infrastructurePlacements = new Map<string, { worldX: number; worldZ: number }>();
  private readonly palettesByCultureEra = new Map<string, MaterialPalette>();
  private readonly vegetationPlacements: VegetationPlacement[] = [];
  private readonly terrainSurface: TerrainSurface;
  private readonly waterSystem: WaterSystem;
  private readonly weatherRenderer: WeatherRenderer;
  private readonly terrainDecor: TerrainDecor;
  private readonly vegetation: VegetationRenderer;
  private readonly skyAtmosphere: SkyAtmosphere;
  private vegetationLodAccumulator = 0;
  private readonly routePlacementReports = new Map<string, RoutePlacementReport>();
  private readonly routeGroup = new THREE.Group();
  private readonly caravanGroup = new THREE.Group();
  private readonly warGroup = new THREE.Group();
  private readonly atmosphere: THREE.Points;
  private readonly smoke: THREE.InstancedMesh;
  private readonly activeSmokeSources: SmokeSource[] = [];
  private visiblePeople: Person[] = [];
  private visiblePeopleMonth = -1;
  private visiblePeoplePopulation = -1;
  private readonly lastPersonGroundPosition = new Map<string, Vec2>();
  private readonly smokeMatrix = new THREE.Matrix4();
  private readonly smokeColor = new THREE.Color();
  private readonly sunLowColor = new THREE.Color('#ff9a55');
  private readonly sunHighColor = new THREE.Color('#fff1d6');
  private lastRouteSignature = '';
  private lastWarSignature = '';
  private lastSettlementSignature = '';
  private structuralAccumulator = 0;
  private lastVisualSeason = -1;
  private latestCatastrophe?: SimulationState['history'][number];
  private lastCatastropheHistoryLength = -1;
  private lastCatastropheMonth = -1;
  private width = 1;
  private height = 1;
  private readonly resizeHandler = (): void => this.resize();

  constructor(private readonly host: HTMLElement, private readonly config: GodboxConfig, private readonly state: SimulationState, historian: Historian) {
    this.random = new SeededRandom(`${config.seed}:visuals`);
    this.animationController = new AnimationController(`${config.seed}:humanoid-animation`);
    this.assetBuilder = new AssetBuilder(`${config.seed}:asset-builder`);
    this.terrainQueries = new TerrainQueries(state.world);
    this.placementContract = new PlacementContract(state.world);
    this.placementFootprints = new PlacementFootprint(state.world, this.placementContract, `${config.seed}:visual-footprints`);
    for (const culture of state.cultures) {
      this.cultureById.set(culture.id, culture);
      this.accentByCulture.set(culture.id, new THREE.Color(culture.style.accent));
    }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.config.render.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#899b91');
    this.scene.fog = new THREE.FogExp2('#93a5a4', 0.0072);
    this.cameraDirector = new CameraDirector(this.camera, config, historian);
    this.observation = this.cameraDirector.observation;

    this.terrainSurface = new TerrainSurface(state.world);
    this.setupLights();
    this.createTerrain();
    this.waterSystem = new WaterSystem(state.world, this.terrainSurface, config.seed);
    this.scene.add(this.waterSystem.group);
    this.vegetation = new VegetationRenderer(
      state.world,
      this.terrainSurface,
      config.seed,
      Math.round(3000 * config.render.visualDensity),
      state.settlements.map((settlement) => settlement.position),
    );
    this.scene.add(this.vegetation.group);
    this.weatherRenderer = new WeatherRenderer(state.world, this.terrainSurface, config.seed);
    this.weatherRenderer.bindScene(this.scene);
    this.scene.add(this.weatherRenderer.group);
    this.terrainDecor = new TerrainDecor(state.world, this.terrainSurface, config.seed, config.render.visualDensity);
    this.scene.add(this.terrainDecor.group);
    this.skyAtmosphere = new SkyAtmosphere(state.world, this.terrainSurface, config.seed);
    this.scene.add(this.skyAtmosphere.group);
    this.atmosphere = this.createBlossomDrift();
    this.scene.add(this.atmosphere, this.routeGroup, this.caravanGroup, this.warGroup);
    this.smoke = this.createSmokePool();
    this.scene.add(this.smoke);
    this.updateSeasonalPresentation(true);
    this.scene.add(this.catastropheLight);

    const visiblePersonBudget = visiblePersonBudgetForDensity(this.config.render.visualDensity);
    const peopleGeometry = new THREE.CapsuleGeometry(0.12, 0.34, 2, 5);
    const peopleMaterial = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true });
    this.people = new THREE.InstancedMesh(peopleGeometry, peopleMaterial, visiblePersonBudget);
    this.people.castShadow = true;
    this.people.frustumCulled = false;
    this.peopleHeads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 1), peopleMaterial, visiblePersonBudget);
    this.peopleArms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 5).translate(0, -0.17, 0), peopleMaterial, visiblePersonBudget * 2);
    this.peopleLegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.032, 0.04, 0.36, 5).translate(0, -0.18, 0), peopleMaterial, visiblePersonBudget * 2);
    this.peopleTools = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.36, 0.05), new THREE.MeshStandardMaterial({ color: '#8a6a3e', roughness: 0.88, metalness: 0.05, vertexColors: true }), visiblePersonBudget);
    this.peopleHeadwear = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.14, 0.12, 7), new THREE.MeshStandardMaterial({ roughness: 0.86, vertexColors: true }), visiblePersonBudget);
    this.peopleCargo = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.18, 0.16), new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true }), visiblePersonBudget);
    this.peopleHeads.castShadow = true;
    this.peopleArms.castShadow = true;
    this.peopleLegs.castShadow = true;
    this.peopleTools.castShadow = true;
    this.peopleHeadwear.castShadow = true;
    this.peopleCargo.castShadow = true;
    this.people.frustumCulled = false;
    this.peopleHeads.frustumCulled = false;
    this.peopleArms.frustumCulled = false;
    this.peopleLegs.frustumCulled = false;
    this.peopleTools.frustumCulled = false;
    this.peopleHeadwear.frustumCulled = false;
    this.peopleCargo.frustumCulled = false;
    this.scene.add(this.people, this.peopleHeads, this.peopleArms, this.peopleLegs, this.peopleTools, this.peopleHeadwear, this.peopleCargo);
    this.syncSettlements(true);
    this.syncRoutes(true);
    this.syncWars(true);
    this.resize();
    window.addEventListener('resize', this.resizeHandler);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.transitionTimeline.updateTime(deltaSeconds);
    this.updateDayNight(elapsedSeconds);
    this.updateAdvancedAtmosphere(elapsedSeconds);
    this.updateSeasonalPresentation();
    this.vegetation.updateLeaves(elapsedSeconds);
    this.updatePeople(deltaSeconds, elapsedSeconds);
    this.structuralAccumulator += deltaSeconds;
    if (this.structuralAccumulator >= 1 / Math.max(1, this.config.render.structuralUpdatesPerSecond)) {
      this.structuralAccumulator = 0;
      this.waterSystem.syncHydrology();
      this.syncSettlements();
      this.syncRoutes();
      this.syncWars();
      this.transitionTimeline.pruneCompleted();
    }
    this.updateCaravans();
    this.updateSmoke(elapsedSeconds);
    this.waterSystem.update(elapsedSeconds);
    this.skyAtmosphere.update(deltaSeconds, elapsedSeconds);
    this.skyAtmosphere.followCamera(this.camera);
    this.vegetationLodAccumulator += deltaSeconds;
    if (this.vegetationLodAccumulator >= VEGETATION_LOD_INTERVAL_SECONDS) {
      this.vegetationLodAccumulator = 0;
      this.vegetation.setDisturbance(this.state.settlements);
      this.vegetation.setEcologyYear(Math.floor(this.state.month / 12));
      this.vegetation.updateLod(this.camera.position);
    }
    this.atmosphere.rotation.y += deltaSeconds * 0.012;
    const positions = this.atmosphere.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index) - deltaSeconds * 0.11;
      positions.setY(index, y < 1.5 ? 18 + (index % 11) : y);
    }
    positions.needsUpdate = true;
    this.cameraDirector.update(deltaSeconds, elapsedSeconds, this.state, (x, z) => this.elevationAt(x, z));
    this.weatherRenderer.update(deltaSeconds, elapsedSeconds, this.camera);
    const blizzard = this.weatherRenderer.report.blizzard;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density += blizzard * 0.035;
      this.scene.fog.color.lerp(this.fogDayColor, blizzard * 0.7);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private setupLights(): void {
    this.sun.position.set(42, 70, 26);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -75;
    this.sun.shadow.camera.right = 75;
    this.sun.shadow.camera.top = 75;
    this.sun.shadow.camera.bottom = -75;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.03;
    this.moon.position.set(-32, 48, -21);
    this.scene.add(this.hemisphere, this.sun, this.moon);
  }

  /** One continuous sculpted surface plus its apron, in place of the old per-cell boxes. */
  private createTerrain(): void {
    this.scene.add(this.terrainSurface.buildMesh(this.config.seed), this.terrainSurface.buildApron());
  }

  private updateSeasonalPresentation(force = false): void {
    const season = this.state.month % 12;
    if (!force && season === this.lastVisualSeason) return;
    this.lastVisualSeason = season;
    this.vegetation.setSeason(season);
    this.vegetation.updateLod(this.camera.position);
    const isSpring = season >= 1 && season <= 3;
    const isAutumn = season >= 7 && season <= 9;
    const isWinter = season >= 10 || season === 0;
    this.dayColor.set(isSpring ? '#96ada2' : isAutumn ? '#b09272' : isWinter ? '#aab9c0' : '#91aaa0');
    this.fogDayColor.set(isSpring ? '#93a5a4' : isAutumn ? '#a68f78' : isWinter ? '#a9b6bb' : '#8b9a95');
    this.horizonDayColor.set(isSpring ? '#d6dcd4' : isAutumn ? '#dcc3a1' : isWinter ? '#d3dde1' : '#cfd8d3');
    this.skyAtmosphere.setMistStrength(isAutumn ? 0.62 : isWinter ? 0.5 : isSpring ? 0.44 : 0.3);
    if (this.atmosphere.material instanceof THREE.PointsMaterial) {
      this.atmosphere.material.opacity = isSpring ? 0.72 : isAutumn ? 0.12 : isWinter ? 0.05 : 0.22;
      this.atmosphere.material.needsUpdate = true;
    }
  }

  private createBlossomDrift(): THREE.Points {
    const count = Math.max(80, Math.round(520 * this.config.render.visualDensity));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    const span = this.state.world.size * this.state.world.cellSize;
    for (let index = 0; index < count; index += 1) {
      const x = this.random.range(-span / 2, span / 2);
      const z = this.random.range(-span / 2, span / 2);
      positions[index * 3] = x;
      positions[index * 3 + 1] = this.terrainSurface.heightAt(x, z) + this.random.range(1.2, 9);
      positions[index * 3 + 2] = z;
      color.set(this.random.chance(0.78) ? '#ed9eb2' : '#e7c58f');
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 0.24, map: softPointTexture(), transparent: true, opacity: 0.55, depthWrite: false, vertexColors: true, sizeAttenuation: true });
    return new THREE.Points(geometry, material);
  }

  private updatePeople(deltaSeconds: number, elapsedSeconds: number): void {
    this.refreshVisiblePeople();
    const count = Math.min(this.people.instanceMatrix.count, this.visiblePeople.length);
    this.people.count = count;
    this.peopleHeads.count = count;
    this.peopleArms.count = count * 2;
    this.peopleLegs.count = count * 2;
    this.peopleTools.count = count;
    this.peopleHeadwear.count = count;
    this.peopleCargo.count = count;
    for (let index = 0; index < count; index += 1) {
      const person = this.visiblePeople[index];
      if (!person) continue;
      const display = this.resolvePersonRenderPosition(person);
      const detailed = Math.hypot(this.camera.position.x - display.x, this.camera.position.z - display.z) < 58;
      this.animationController.getOrCreateCharacterState(person.id, person.occupation);
      if (detailed) this.animationController.updateCharacterAnimation(person.id, deltaSeconds, person.activity);
      const pose = detailed ? this.animationController.getCurrentPose(person.id) : null;
      const moving = person.navigation?.traveling === true;
      const bob = Math.sin(elapsedSeconds * (4.1 + stableUnit(`${person.id}:stride`) * 1.2) + stableUnit(person.id) * Math.PI * 2) * (moving ? 0.03 : person.activity === 'rest' ? 0.006 : 0.015);
      const y = this.elevationAt(display.x, display.z);
      const ageScale = person.ageMonths < 14 * 12 ? 0.64 + person.ageMonths / (14 * 12) * 0.08 : person.ageMonths > 68 * 12 ? 0.88 : 1;
      const heightScale = HUMAN_WORLD_SCALE * ageScale * (person.appearance?.heightScale ?? 1);
      const buildScale = person.appearance?.buildScale ?? 1;
      const facing = Math.atan2(person.target.x - person.position.x, person.target.z - person.position.z);
      this.setInstanceTransform(this.people, index, display.x, y + 0.44 * heightScale + bob + (pose?.positionOffset.y ?? 0) * 0.08, display.z, heightScale * buildScale, heightScale, heightScale * buildScale, 0, facing + (pose?.pelvisRotation ?? 0), person.appearance?.posture ?? 0);
      const culture = this.cultureById.get(person.cultureId);
      this.personColor.set(culture?.style.primary ?? '#d96c86');
      this.personColor.lerp(this.roleCue(person.role), 0.42);
      this.personColor.offsetHSL(0, 0, ((person.appearance?.materialQuality ?? 0.5) - 0.5) * 0.13);
      this.people.setColorAt(index, this.personColor);
      this.setInstanceTransform(this.peopleHeads, index, display.x, y + 0.84 * heightScale + bob, display.z, heightScale, heightScale, heightScale, 0, facing + (pose?.headRotation ?? 0), 0);
      this.personDetailColor.set(culture?.style.accent ?? '#d9a748').lerp(this.personColor, 0.32);
      this.peopleHeads.setColorAt(index, this.personDetailColor);
      const limbScale = detailed ? heightScale : 0.001;
      this.setLimbInstance(index * 2, display.x, y, display.z, limbScale, heightScale, facing, -0.15 * buildScale * heightScale, 0.62, pose?.leftShoulderRotation ?? 0.1, this.peopleArms);
      this.setLimbInstance(index * 2 + 1, display.x, y, display.z, limbScale, heightScale, facing, 0.15 * buildScale * heightScale, 0.62, pose?.rightShoulderRotation ?? -0.1, this.peopleArms);
      this.peopleArms.setColorAt(index * 2, this.personColor);
      this.peopleArms.setColorAt(index * 2 + 1, this.personColor);
      this.setLimbInstance(index * 2, display.x, y, display.z, limbScale, heightScale, facing, -0.07 * buildScale * heightScale, 0.36, pose?.leftHipRotation ?? 0, this.peopleLegs);
      this.setLimbInstance(index * 2 + 1, display.x, y, display.z, limbScale, heightScale, facing, 0.07 * buildScale * heightScale, 0.36, pose?.rightHipRotation ?? 0, this.peopleLegs);
      this.peopleLegs.setColorAt(index * 2, this.personColor);
      this.peopleLegs.setColorAt(index * 2 + 1, this.personColor);
      const carried = person.appearance?.carriedItem ?? 'none';
      const longTool = ['hoe', 'hammer', 'staff', 'toolkit'].includes(carried);
      const toolScale = detailed && longTool ? heightScale : 0.001;
      this.setInstanceTransform(this.peopleTools, index, display.x + Math.sin(facing) * 0.17, y + 0.55 * heightScale + bob, display.z + Math.cos(facing) * 0.17, toolScale, toolScale, toolScale, Math.PI / 7, facing, carried === 'hoe' ? 0.7 : carried === 'staff' ? 0.02 : 0.15);
      this.personDetailColor.set(['guard', 'soldier', 'engineer', 'machinist'].includes(person.role ?? '') ? '#747d80' : carried === 'staff' ? (culture?.style.accent ?? '#d9a748') : '#7b5835');
      this.peopleTools.setColorAt(index, this.personDetailColor);

      const headwear = person.appearance?.headwear ?? 'none';
      const hatScale = !detailed || headwear === 'none' ? 0.001 : heightScale;
      const hatWidth = headwear === 'brim' ? 1.35 : headwear === 'helmet' ? 0.82 : 0.95;
      const hatHeight = headwear === 'cap' ? 0.52 : headwear === 'brim' ? 0.32 : 0.86;
      this.setInstanceTransform(this.peopleHeadwear, index, display.x, y + 0.99 * heightScale + bob, display.z, hatScale * hatWidth, hatScale * hatHeight, hatScale * hatWidth, 0, facing, 0);
      this.personDetailColor.set(culture?.style.secondary ?? '#313550').lerp(this.roleCue(person.role), headwear === 'helmet' ? 0.2 : 0.42);
      this.peopleHeadwear.setColorAt(index, this.personDetailColor);

      const cargoVisible = ['basket', 'ledger', 'bag'].includes(carried) || (person.activity === 'transport' && carried === 'none');
      const cargoScale = detailed && cargoVisible ? heightScale : 0.001;
      this.setInstanceTransform(this.peopleCargo, index, display.x + Math.cos(facing) * 0.2, y + 0.47 * heightScale + bob, display.z - Math.sin(facing) * 0.2, cargoScale, cargoScale, cargoScale, 0, facing, carried === 'basket' ? 0.15 : 0);
      this.personDetailColor.set(carried === 'ledger' ? (culture?.style.accent ?? '#d9a748') : '#8b6840');
      this.peopleCargo.setColorAt(index, this.personDetailColor);
    }
    this.people.instanceMatrix.needsUpdate = true;
    this.peopleHeads.instanceMatrix.needsUpdate = true;
    this.peopleArms.instanceMatrix.needsUpdate = true;
    this.peopleLegs.instanceMatrix.needsUpdate = true;
    this.peopleTools.instanceMatrix.needsUpdate = true;
    this.peopleHeadwear.instanceMatrix.needsUpdate = true;
    this.peopleCargo.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    if (this.peopleHeads.instanceColor) this.peopleHeads.instanceColor.needsUpdate = true;
    if (this.peopleArms.instanceColor) this.peopleArms.instanceColor.needsUpdate = true;
    if (this.peopleLegs.instanceColor) this.peopleLegs.instanceColor.needsUpdate = true;
    if (this.peopleTools.instanceColor) this.peopleTools.instanceColor.needsUpdate = true;
    if (this.peopleHeadwear.instanceColor) this.peopleHeadwear.instanceColor.needsUpdate = true;
    if (this.peopleCargo.instanceColor) this.peopleCargo.instanceColor.needsUpdate = true;
  }

  private refreshVisiblePeople(): void {
    if (this.visiblePeopleMonth === this.state.month && this.visiblePeoplePopulation === this.state.people.length) return;
    this.visiblePeopleMonth = this.state.month;
    this.visiblePeoplePopulation = this.state.people.length;
    const capacity = this.people.instanceMatrix.count;
    this.visiblePeople = this.state.people
      .filter((person) => person.alive && this.personOnRenderableGround(person))
      .sort((a, b) => stableHash(`${this.config.seed}:${a.id}:visible`) - stableHash(`${this.config.seed}:${b.id}:visible`))
      .slice(0, capacity);
  }

  private personOnRenderableGround(person: Person): boolean {
    const terrain = this.terrainQueries.queryTerrainAt(person.position.x, person.position.z);
    return Boolean(terrain && !terrain.water && terrain.maxSlope <= 40);
  }

  private resolvePersonRenderPosition(person: Person): Vec2 {
    let position = { ...person.position };
    const settlement = this.state.settlements.find((candidate) => candidate.id === person.homeId);
    const placements = settlement ? this.settlementBuildingPlacements.get(settlement.id) ?? [] : [];
    if (settlement && person.navigation?.destinationKind === 'construction-site' && !person.navigation.traveling && settlement.constructionProgress > 0) {
      const site = placements[this.shownBuildingCount(settlement)];
      if (site) {
        const angle = stableUnit(`${person.id}:construction-ring`) * Math.PI * 2;
        const radius = Math.max(site.width, site.depth) * 0.68 + 0.34;
        position = { x: site.worldX + Math.cos(angle) * radius, z: site.worldZ + Math.sin(angle) * radius };
      }
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (const placement of placements) {
        const clearance = Math.max(placement.width, placement.depth) * 0.52 + 0.2;
        const dx = position.x - placement.worldX;
        const dz = position.z - placement.worldZ;
        const separation = Math.hypot(dx, dz);
        if (separation >= clearance) continue;
        const angle = separation > 0.001 ? Math.atan2(dz, dx) : stableUnit(`${person.id}:${placement.key}`) * Math.PI * 2;
        position = { x: placement.worldX + Math.cos(angle) * clearance, z: placement.worldZ + Math.sin(angle) * clearance };
      }
    }
    const terrain = this.terrainQueries.queryTerrainAt(position.x, position.z);
    if (!terrain || terrain.water || terrain.maxSlope > 40) position = this.lastPersonGroundPosition.get(person.id) ?? this.nearestRenderableGround(person.position, person.id);
    this.lastPersonGroundPosition.set(person.id, { ...position });
    return position;
  }

  private nearestRenderableGround(origin: Vec2, identity: string): Vec2 {
    const phase = stableUnit(identity) * Math.PI * 2;
    for (let radius = 0; radius <= this.state.world.cellSize * 5; radius += this.state.world.cellSize * 0.25) {
      for (let index = 0; index < 12; index += 1) {
        const angle = phase + index / 12 * Math.PI * 2;
        const candidate = { x: origin.x + Math.cos(angle) * radius, z: origin.z + Math.sin(angle) * radius };
        const terrain = this.terrainQueries.queryTerrainAt(candidate.x, candidate.z);
        if (terrain && !terrain.water && terrain.maxSlope <= 40) return candidate;
      }
    }
    return origin;
  }

  private roleCue(role: PersonRole | undefined): THREE.Color {
    if (role === 'farmer' || role === 'gatherer' || role === 'hunter') return PERSON_ROLE_CUES.earth;
    if (role === 'fisher' || role === 'sailor' || role === 'dock-worker') return PERSON_ROLE_CUES.water;
    if (role === 'builder' || role === 'laborer' || role === 'miner') return PERSON_ROLE_CUES.labor;
    if (role === 'trader' || role === 'merchant' || role === 'transporter') return PERSON_ROLE_CUES.trade;
    if (role === 'guard' || role === 'soldier') return PERSON_ROLE_CUES.guard;
    if (role === 'priest' || role === 'ritual-specialist') return PERSON_ROLE_CUES.ritual;
    if (role === 'administrator' || role === 'manager') return PERSON_ROLE_CUES.civic;
    if (role && ['scholar', 'scientist', 'researcher', 'medical-worker', 'healer'].includes(role)) return PERSON_ROLE_CUES.knowledge;
    if (role && ['factory-worker', 'engineer', 'machinist', 'railway-worker', 'energy-technician', 'logistics-worker', 'machine-systems-specialist', 'space-worker'].includes(role)) return PERSON_ROLE_CUES.industry;
    return PERSON_ROLE_CUES.ordinary;
  }

  private setLimbInstance(index: number, x: number, y: number, z: number, scale: number, heightScale: number, facing: number, side: number, height: number, swing: number, mesh: THREE.InstancedMesh): void {
    const sideX = Math.cos(facing) * side;
    const sideZ = -Math.sin(facing) * side;
    // Position the pivot (shoulder/hip) with the body's real height scale, never the LOD scale,
    // so limbs stay attached to the torso even when the limb geometry itself is collapsed.
    this.setInstanceTransform(mesh, index, x + sideX, y + height * heightScale, z + sideZ, scale, scale, scale, swing, facing, 0);
  }

  private setInstanceTransform(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number): void {
    this.partPosition.set(x, y, z);
    this.partQuaternion.setFromEuler(new THREE.Euler(rotationX, rotationY, rotationZ));
    this.partScale.set(scaleX, scaleY, scaleZ);
    this.personMatrix.compose(this.partPosition, this.partQuaternion, this.partScale);
    mesh.setMatrixAt(index, this.personMatrix);
  }

  private syncSettlements(force = false): void {
    const signature = this.state.settlements.map((settlement) => {
      const routeCount = this.state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
      const politySize = this.state.polities.find((polity) => polity.id === settlement.polityId)?.settlementIds.length ?? 1;
      return `${settlement.id}:${settlement.alive ? settlement.buildings : 0}:${settlement.institutionIds.length}:${routeCount}:${politySize}:${this.developmentSignature(settlement)}:${this.constructionSignature(settlement.id)}`;
    }).join('|');
    if (!force && signature === this.lastSettlementSignature) return;
    this.lastSettlementSignature = signature;
    for (const settlement of this.state.settlements) {
      if (!settlement.alive) {
        const visual = this.settlementVisuals.get(settlement.id);
        if (visual) visual.group.visible = false;
        continue;
      }
      const existing = this.settlementVisuals.get(settlement.id);
      const routeCount = this.state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
      const politySize = this.state.polities.find((polity) => polity.id === settlement.polityId)?.settlementIds.length ?? 1;
      const developmentSignature = this.developmentSignature(settlement);
      const constructionSignature = this.constructionSignature(settlement.id);
      const event = this.visualStateResolver.trackEntity(settlement.id, 'settlement', { infrastructure: settlement.infrastructure, buildings: settlement.buildings, alive: settlement.alive }, this.state.month);
      if (event?.kind === 'infrastructure-added') this.transitionTimeline.createBuildingUpgrade(settlement.id, 0, 1, event.associatedData);
      if (existing && existing.buildingCount === settlement.buildings && existing.institutionCount === settlement.institutionIds.length && existing.routeCount === routeCount && existing.politySize === politySize && existing.developmentSignature === developmentSignature && existing.constructionSignature === constructionSignature) continue;
      if (existing) {
        this.scene.remove(existing.group);
        this.disposeGroup(existing.group);
      }
      const visual = this.createSettlementVisual(settlement);
      this.settlementVisuals.set(settlement.id, visual);
      this.scene.add(visual.group);
    }
    this.refreshSmokeSources();
    this.weatherRenderer.bindScene(this.scene);
  }

  /** Concatenated lifecycle stages of a settlement's plots. Changes as structures rise. */
  private constructionSignature(settlementId: string): string {
    const placements = this.settlementBuildingPlacements.get(settlementId);
    if (!placements) return '';
    let signature = '';
    for (const placement of placements) signature += this.constructionStageFor(placement.key);
    return signature;
  }

  private createSettlementVisual(settlement: Settlement): SettlementVisual {
    const group = new THREE.Group();
    const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);
    group.position.set(settlement.position.x, settlementY, settlement.position.z);
    const culture = this.dominantCulture(settlement);
    const era = this.eraForSettlement(settlement);
    const visualRandom = this.random.fork(settlement.id);
    const cultureStyle = culture?.style ?? { primary: '#c36557', secondary: '#313550', accent: '#d9a748', symbol: 'sun-step' as const, pattern: 'chevron' as const, nameSyllables: ['go', 'do'] };
    const palette = this.getPalette(cultureStyle, era);
    const profile = CultureStyleProfileFactory.createFromCulture(culture?.id ?? 'fallback', cultureStyle);
    const shownBuildings = this.shownBuildingCount(settlement);
    const layout = this.layoutForSettlement(settlement, era);
    const hasActiveConstruction = settlement.constructionProgress > 0 && settlement.buildings < settlement.targetBuildings;
    const reservedPlacements = this.getSettlementBuildingPlacements(settlement, shownBuildings + (hasActiveConstruction ? 1 : 0), layout);
    const placements = reservedPlacements.slice(0, shownBuildings);
    for (const placement of placements) {
      const terrainY = this.elevationAt(placement.worldX, placement.worldZ) - settlementY;
      const buildingEra = this.eraForBuilding(placement, era);
      // Stage tracks this plot's own era, so each structure is upgraded in place on its own
      // schedule rather than the whole settlement being reskinned at once.
      const condition = settlement.structurePlots?.find((plot) => plot.id === placement.key)?.condition ?? 1;
      const event = this.visualStateResolver.trackEntity(placement.key, 'building', { stage: eraRank(buildingEra) + 1, damaged: condition < 0.85, ruined: condition === 0 }, this.state.month);
      if (event?.kind === 'building-founded') this.transitionTimeline.createBuildingConstruction(placement.key, { settlementId: settlement.id });
      if (event?.kind === 'building-upgraded') this.transitionTimeline.createBuildingUpgrade(placement.key, Number(event.associatedData['fromStage'] ?? 0), Number(event.associatedData['toStage'] ?? 1), { settlementId: settlement.id });
      const structure = this.createPlacedBuilding(placement, cultureStyle, buildingEra, terrainY);
      if (condition < 1) {
        structure.scale.y *= 0.12 + condition * 0.88;
        structure.rotation.z += (1 - condition) * 0.12;
      }
      structure.traverse((object) => {
        if (object instanceof THREE.Mesh) object.userData['weatherSurface'] = true;
      });
      group.add(structure);
    }
    const activeSite = hasActiveConstruction ? reservedPlacements[shownBuildings] : undefined;
    if (activeSite) group.add(this.createActiveConstructionSite(activeSite, palette, settlementY, settlement.constructionProgress));
    if (eraRank(era) >= 2) this.addCivicPlaza(group, palette, profile, era);
    this.addGroundCraft(group, era, palette, visualRandom);
    this.addRoutePortals(group, settlement, layout, era, palette);
    const axisAngle = this.random.fork(`${settlement.id}:axis`).float() * Math.PI * 2;
    if (eraRank(era) >= 2) this.addCeremonialAxis(group, palette, profile, era, axisAngle);
    this.addBanner(group, culture, settlement.institutionIds.length);
    this.addBlossomTree(group, visualRandom);
    const routeCount = this.state.tradeRoutes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id)).length;
    const politySize = this.state.polities.find((polity) => polity.id === settlement.polityId)?.settlementIds.length ?? 1;
    const importance = settlement.buildings / 24 + settlement.institutionIds.length * 0.25 + routeCount * 0.2;
    if (importance >= 1 && eraRank(era) >= 2) this.addLandmark(group, settlement, cultureStyle, era, axisAngle, settlementY);
    if (routeCount > 0 && eraRank(era) >= 2) this.addMarket(group, settlement, layout, culture, Math.min(4, routeCount));
    if (politySize > 1) this.addWaystones(group, culture, Math.min(5, politySize));
    const smokeSources: SmokeSource[] = [];
    this.addInfrastructure(group, settlement, culture, smokeSources);
    this.addEraDressing(group, era, palette, visualRandom);
    this.addSpecializationDressing(group, settlement, era, palette, smokeSources, routeCount);
    this.addHearthSmoke(placements, era, smokeSources);
    const lights = this.addSettlementLighting(group, era, palette, visualRandom);
    group.userData['settlementId'] = settlement.id;
    group.traverse((object) => { if (object instanceof THREE.Mesh) object.userData['weatherSurface'] = true; });
    return { group, buildingCount: settlement.buildings, institutionCount: settlement.institutionIds.length, routeCount, politySize, developmentSignature: this.developmentSignature(settlement), constructionSignature: this.constructionSignature(settlement.id), powerLevel: settlement.infrastructure.power, lights, smokeSources };
  }

  /**
   * Ground treatment under the settlement: packed earth for camps, swept dirt paths for
   * villages, and paved spokes once formal engineering arrives. Paths radiating from the core
   * are what make the layout read as intentional from the documentary camera.
   */
  private layoutForSettlement(settlement: Settlement, era = this.eraForSettlement(settlement)): SettlementLayoutPlan {
    return createSettlementLayoutPlan({ settlement, settlements: this.state.settlements, routes: this.state.tradeRoutes, transportation: this.state.transportation, eraRank: eraRank(era), seed: this.config.seed });
  }

  private shownBuildingCount(settlement: Settlement): number {
    return Math.min(Math.max(12, Math.round(32 * this.config.render.visualDensity)), settlement.buildings + Math.floor(settlement.urbanization * 8));
  }

  private addGroundCraft(group: THREE.Group, era: Era, palette: MaterialPalette, random: SeededRandom): void {
    const rank = eraRank(era);
    if (rank === 0) {
      const earth = new THREE.Mesh(
        new THREE.CircleGeometry(2.3, 20),
        new THREE.MeshStandardMaterial({ color: '#7d6549', roughness: 1 }),
      );
      earth.rotation.x = -Math.PI / 2;
      earth.position.y = 0.012;
      earth.receiveShadow = true;
      group.add(earth);
      return;
    }
    const paved = rank >= 3;
    const material = paved
      ? palette.getSurfaceMaterial('ground')
      : new THREE.MeshStandardMaterial({ color: '#8a7052', roughness: 1 });
    const spokes = rank >= 4 ? 6 : rank >= 2 ? 5 : 4;
    const startAngle = random.range(0, Math.PI * 2);
    for (let index = 0; index < spokes; index += 1) {
      const angle = startAngle + (index / spokes) * Math.PI * 2 + random.range(-0.12, 0.12);
      const length = 2.6 + rank * 0.55 + random.range(0, 0.8);
      const width = paved ? 0.4 : 0.3;
      const path = new THREE.Mesh(new THREE.BoxGeometry(width, 0.014, length), material);
      const reach = 1.2 + length / 2;
      path.position.set(Math.cos(angle) * reach, 0.014, Math.sin(angle) * reach);
      path.rotation.y = -angle + Math.PI / 2;
      path.receiveShadow = true;
      group.add(path);
    }
  }

  private addRoutePortals(group: THREE.Group, settlement: Settlement, layout: SettlementLayoutPlan, era: Era, palette: MaterialPalette): void {
    const rank = eraRank(era);
    const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);
    for (const portal of layout.portals.slice(0, 5)) {
      const worldX = settlement.position.x + portal.localX;
      const worldZ = settlement.position.z + portal.localZ;
      const terrain = this.terrainQueries.queryTerrainAt(worldX, worldZ);
      // Gates and stations are dry-ground, relatively level structures. Docks are the explicit
      // exception and may meet a shallow water cell at the shoreline.
      if (!terrain || (portal.kind !== 'dock' && (terrain.water || terrain.maxSlope > 18))) continue;
      const waterY = terrain.water ? this.terrainSurface.waterYAt(worldX, worldZ) : Number.NEGATIVE_INFINITY;
      const localY = terrain.water && Number.isFinite(waterY) ? waterY - settlementY + 0.06 : this.elevationAt(worldX, worldZ) - settlementY + 0.04;
      if (portal.kind === 'dock') {
        if (!portal.bank) continue;
        const bankX = portal.bank.x - settlement.position.x;
        const bankZ = portal.bank.z - settlement.position.z;
        const bankY = this.elevationAt(portal.bank.x, portal.bank.z) - settlementY + 0.06;
        const horizontal = Math.hypot(portal.localX - bankX, portal.localZ - bankZ);
        const dock = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, Math.hypot(horizontal, localY - bankY)), new THREE.MeshStandardMaterial({ color: '#6d4f3d', roughness: 0.9 }));
        dock.position.set((portal.localX + bankX) / 2, (localY + bankY) / 2, (portal.localZ + bankZ) / 2);
        dock.rotation.set(-Math.atan2(localY - bankY, horizontal), Math.atan2(portal.localX - bankX, portal.localZ - bankZ), 0, 'YXZ');
        dock.castShadow = true;
        dock.userData['portalKind'] = portal.kind;
        group.add(dock);
        continue;
      }
      if (portal.kind === 'station') {
        const station = new THREE.Group();
        const platform = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.55), palette.getSurfaceMaterial('ground'));
        const roof = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.38), new THREE.MeshStandardMaterial({ color: '#596167', roughness: 0.58, metalness: 0.2 }));
        roof.position.y = 0.55;
        station.add(platform, roof);
        station.position.set(portal.localX, localY, portal.localZ);
        station.rotation.y = portal.angle + Math.PI / 2;
        station.userData['portalKind'] = portal.kind;
        group.add(station);
        continue;
      }
      if (rank < 2) continue;
      const gate = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color: '#746757', roughness: 0.86 });
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), material);
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), material);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.16), material);
      left.position.set(-0.36, 0.34, 0);
      right.position.set(0.36, 0.34, 0);
      lintel.position.set(0, 0.72, 0);
      gate.add(left, right, lintel);
      gate.position.set(portal.localX, localY, portal.localZ);
      gate.rotation.y = portal.angle + Math.PI / 2;
      gate.userData['portalKind'] = portal.kind;
      group.add(gate);
    }
  }

  /**
   * The civic heart: swept paving with a ring of motif insets, giving the settlement a focal
   * point that the surrounding buildings visibly address. It gains a speaker's platform, formal
   * corner markers and finally an illuminated inlay as the society matures.
   */
  private addCivicPlaza(group: THREE.Group, palette: MaterialPalette, profile: ReturnType<typeof CultureStyleProfileFactory.createFromCulture>, era: Era): void {
    const radius = 1.9 * profile.getScaleFactor(era);
    const paving = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), palette.getSurfaceMaterial('ground'));
    paving.rotation.x = -Math.PI / 2;
    paving.position.y = 0.02;
    paving.receiveShadow = true;
    group.add(paving);

    const tiles = 8 + Math.round(profile.getTrimDensity(era) * 8);
    const tile = new THREE.BoxGeometry(radius * 0.2, 0.03, radius * 0.09);
    const insets = new THREE.InstancedMesh(tile, palette.getSurfaceMaterial('motif'), tiles);
    insets.receiveShadow = true;
    for (let index = 0; index < tiles; index += 1) {
      const angle = (index / tiles) * Math.PI * 2;
      this.setInstanceTransform(insets, index, Math.cos(angle) * radius * 0.72, 0.03, Math.sin(angle) * radius * 0.72, 1, 1, 1, 0, -angle, 0);
    }
    insets.instanceMatrix.needsUpdate = true;
    group.add(insets);

    const rank = eraRank(era);
    if (rank >= 3) {
      const stone = palette.getSurfaceMaterial('stone');
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.36, radius * 0.42, 0.12, 8), stone);
      platform.position.y = 0.06;
      platform.castShadow = true;
      platform.receiveShadow = true;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.3, radius * 0.36, 0.03, 8), palette.getSurfaceMaterial('motif'));
      crown.position.y = 0.135;
      crown.receiveShadow = true;
      group.add(platform, crown);
    }
    if (rank >= 4) {
      const stone = palette.getSurfaceMaterial('stone');
      const motif = palette.getSurfaceMaterial('motif');
      for (let corner = 0; corner < 4; corner += 1) {
        const angle = Math.PI / 4 + (corner / 4) * Math.PI * 2;
        const x = Math.cos(angle) * radius * 1.08;
        const z = Math.sin(angle) * radius * 1.08;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.09), stone);
        post.position.set(x, 0.17, z);
        post.castShadow = true;
        const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), motif);
        cap.position.set(x, 0.4, z);
        group.add(post, cap);
      }
    }
    if (rank >= 5) {
      const inlay = new THREE.Mesh(new THREE.RingGeometry(radius * 0.5, radius * 0.58, 28), palette.getSurfaceMaterial('glow'));
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.y = 0.033;
      group.add(inlay);
    }
  }

  /**
   * Processional route from the civic heart outward: patterned paving, paired stone lanterns
   * and torii gates. The culture's architectural language applied at city scale.
   */
  private addCeremonialAxis(group: THREE.Group, palette: MaterialPalette, profile: ReturnType<typeof CultureStyleProfileFactory.createFromCulture>, era: Era, angle: number): void {
    const rank = eraRank(era);
    const identity = this.random.fork(`axis-identity:${angle.toFixed(4)}`);
    const scaleFactor = profile.getScaleFactor(era);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const perpX = -dirZ;
    const perpZ = dirX;
    const yaw = Math.atan2(dirX, dirZ);
    const start = 2 * scaleFactor;
    const length = (3.6 + rank * 0.9) * identity.range(0.85, 1.25);
    const ground = palette.getSurfaceMaterial('ground');
    const timber = palette.getSurfaceMaterial('timber');
    const motif = palette.getSurfaceMaterial('motif');
    const glowMaterial = palette.getSurfaceMaterial('glow');
    const stone = palette.getSurfaceMaterial('stone');

    const paving = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.016, length), ground);
    paving.position.set(dirX * (start + length / 2), 0.016, dirZ * (start + length / 2));
    paving.rotation.y = yaw;
    paving.receiveShadow = true;
    group.add(paving);

    const gates = (rank >= 4 ? 3 : 2) + (identity.chance(0.35) ? 1 : 0);
    for (let index = 0; index < gates; index += 1) {
      const distance = start + ((index + 1) / gates) * length;
      const gx = dirX * distance;
      const gz = dirZ * distance;
      const gateHalf = 0.55 * scaleFactor;
      const gateHeight = 1.05 * scaleFactor;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, gateHeight, 0.08), timber);
        post.position.set(gx + perpX * gateHalf * side, gateHeight / 2, gz + perpZ * gateHalf * side);
        post.castShadow = true;
        group.add(post);
      }
      const nuki = new THREE.Mesh(new THREE.BoxGeometry(gateHalf * 1.88, 0.05, 0.06), timber);
      nuki.position.set(gx, gateHeight * 0.72, gz);
      nuki.rotation.y = yaw;
      group.add(nuki);
      const kasagi = new THREE.Mesh(new THREE.BoxGeometry(gateHalf * 2.44, 0.07, 0.12), motif);
      kasagi.position.set(gx, gateHeight + 0.05, gz);
      kasagi.rotation.y = yaw;
      kasagi.castShadow = true;
      group.add(kasagi);
    }

    const lanternPairs = rank >= 3 ? 3 : 2;
    for (let index = 0; index < lanternPairs; index += 1) {
      const distance = start + ((index + 0.5) / lanternPairs) * length;
      for (const side of [-1, 1]) {
        const lx = dirX * distance + perpX * 0.62 * side;
        const lz = dirZ * distance + perpZ * 0.62 * side;
        const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), stone);
        pedestal.position.set(lx, 0.08, lz);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.075), glowMaterial);
        lamp.position.set(lx, 0.2, lz);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.1), stone);
        cap.position.set(lx, 0.25, lz);
        group.add(pedestal, lamp, cap);
      }
    }
  }

  /** The landmark family a settlement earns reflects what it actually is. Locked at founding. */
  private landmarkRoleFor(settlement: Settlement, era: Era): BuildingRole {
    const rank = eraRank(era);
    if (rank >= 5) return this.state.advanced.atomic.applications.energy > 0.2 ? 'energy' : 'research';
    if (rank === 4) return settlement.infrastructure.archives > 0.3 ? 'hall' : 'foundry';
    if (rank === 3) return settlement.specialization === 'craft' ? 'market' : 'gate-tower';
    return 'shrine';
  }

  /**
   * One signature structure for settlements that have earned it, sited at the end of the
   * ceremonial axis. Rare by construction — importance gates it — so a skyline with a landmark
   * means something.
   */
  private addLandmark(group: THREE.Group, settlement: Settlement, cultureStyle: Culture['style'], era: Era, axisAngle: number, settlementY: number): void {
    let placement = this.landmarkPlacements.get(settlement.id);
    if (!placement) {
      const axisLength = 2 + 3.6 + eraRank(era) * 0.9;
      for (const extra of [1.8, 2.8, 4, 5.4]) {
        const distance = axisLength + extra;
        const worldX = settlement.position.x + Math.cos(axisAngle) * distance;
        const worldZ = settlement.position.z + Math.sin(axisAngle) * distance;
        const validation = this.placementContract.validate({
          type: 'major-building',
          worldX,
          worldZ,
          footprintRadius: 1.7,
          biomeWhitelist: ['grassland', 'forest', 'dryland', 'highland', 'wetland'],
        });
        if (!validation.valid || validation.terrain.water) continue;
        const footprint = this.placementFootprints.registerFootprint({
          kind: 'building',
          worldX,
          worldZ,
          radius: 1.7,
          placedMonth: this.state.month,
          entityId: `${settlement.id}:landmark`,
          persistent: true,
        });
        if (!footprint.success) continue;
        placement = {
          worldX,
          worldZ,
          role: this.landmarkRoleFor(settlement, era),
          rotationY: Math.atan2(-(worldX - settlement.position.x), -(worldZ - settlement.position.z)),
        };
        this.landmarkPlacements.set(settlement.id, placement);
        break;
      }
    }
    if (!placement) return;
    const asset = this.assetBuilder.getAsset('building', {
      seed: `${cultureStyle.primary}:${cultureStyle.symbol}:landmark:${placement.role}`,
      culture: cultureStyle,
      era,
      variant: `${placement.role}#${BUILD_STAGE.DETAIL}`,
    });
    const landmark = asset.mesh.clone(true);
    const grammarWidth = Number(asset.mesh.userData['footprintWidth'] ?? 1);
    const grammarDepth = Number(asset.mesh.userData['footprintDepth'] ?? 1);
    const fit = 2.9 / Math.max(grammarWidth, grammarDepth);
    landmark.position.set(placement.worldX - settlement.position.x, this.elevationAt(placement.worldX, placement.worldZ) - settlementY, placement.worldZ - settlement.position.z);
    landmark.rotation.y = placement.rotationY;
    landmark.scale.setScalar(fit);
    landmark.userData['sharedAsset'] = true;
    landmark.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    group.add(landmark);
  }

  private getPalette(cultureStyle: Culture['style'], era: Era): MaterialPalette {    const key = `${cultureStyle.primary}:${cultureStyle.secondary}:${cultureStyle.accent}:${era}`;
    let palette = this.palettesByCultureEra.get(key);
    if (!palette) {
      palette = new MaterialPalette({ culture: cultureStyle, era });
      this.palettesByCultureEra.set(key, palette);
    }
    return palette;
  }

  private createPlacedBuilding(placement: BuildingPlacement, cultureStyle: Culture['style'], era: Era, terrainY: number): THREE.Object3D {
    const stage = this.constructionStageFor(placement.key);
    // Geometry is shared per (culture, era, role, variation, stage) rather than per instance,
    // so a hundred houses cost a handful of buffers.
    const asset = this.assetBuilder.getAsset('building', {
      seed: `${cultureStyle.primary}:${cultureStyle.symbol}:${placement.role}:v${placement.variation}`,
      culture: cultureStyle,
      era,
      variant: `${placement.role}#${stage}`,
    });
    const building = asset.mesh.clone(true);

    // Fit the canonical grammar footprint into the reserved placement footprint. Uniform, so
    // proportions survive, and bounded by the footprint, so nothing spills onto its neighbour.
    const grammarWidth = Number(asset.mesh.userData['footprintWidth'] ?? 1);
    const grammarDepth = Number(asset.mesh.userData['footprintDepth'] ?? 1);
    const fit = Math.min(placement.width / grammarWidth, placement.depth / grammarDepth);

    building.position.set(placement.localX, terrainY, placement.localZ);
    building.rotation.y = placement.rotationY;
    building.scale.setScalar(fit);
    building.userData['placementKey'] = placement.key;
    building.userData['worldX'] = placement.worldX;
    building.userData['worldZ'] = placement.worldZ;
    building.userData['sharedAsset'] = true;
    building.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    if (stage < BUILD_STAGE.DETAIL) {
      building.add(this.createScaffold(placement, this.getPalette(cultureStyle, era), grammarWidth * fit, grammarDepth * fit, stage));
    }
    return building;
  }

  /**
   * Construction lifecycle stage for a plot. Drives which parts of the structure exist, so a
   * building rises foundation → frame → walls → roof → detail instead of popping into place.
   */
  private constructionStageFor(key: string): BuildStage {
    const transition = this.transitionTimeline.getTransitionsForEntity(key)
      .find((candidate) => candidate.kind === 'building-construction');
    if (!transition) return BUILD_STAGE.DETAIL;
    const frame = this.transitionTimeline.getCurrentFrameForTransition(transition.id);
    return stageFromName(frame?.visualState['stage'] as string | undefined);
  }

  /** Builder's scaffolding, so half-built plots read as sites of work rather than damage. */
  private createScaffold(placement: BuildingPlacement, palette: MaterialPalette, width: number, depth: number, stage: BuildStage): THREE.Group {
    const scaffold = new THREE.Group();
    const material = palette.getSurfaceMaterial('timber');
    const height = placement.height * (0.35 + stage * 0.16);
    const geometry = new THREE.BoxGeometry(0.024, height, 0.024);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const pole = new THREE.Mesh(geometry, material);
      pole.position.set(sx * width * 0.62, height * 0.5, sz * depth * 0.62);
      pole.castShadow = true;
      scaffold.add(pole);
    }
    return scaffold;
  }

  private createActiveConstructionSite(placement: BuildingPlacement, palette: MaterialPalette, settlementY: number, progress: number): THREE.Group {
    const site = new THREE.Group();
    site.position.set(placement.localX, this.elevationAt(placement.worldX, placement.worldZ) - settlementY, placement.localZ);
    site.rotation.y = placement.rotationY;
    site.userData['placementKey'] = placement.key;
    site.userData['constructionSite'] = true;
    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(placement.width * 0.9, 0.06 + progress * 0.08, placement.depth * 0.9),
      palette.getSurfaceMaterial(progress > 0.55 ? 'stone' : 'ground'),
    );
    foundation.position.y = (0.06 + progress * 0.08) * 0.5;
    foundation.receiveShadow = true;
    const stage = Math.max(BUILD_STAGE.FOUNDATION, Math.min(BUILD_STAGE.WALLS, Math.floor(progress * (BUILD_STAGE.WALLS + 1)))) as BuildStage;
    site.add(foundation, this.createScaffold(placement, palette, placement.width, placement.depth, stage));
    return site;
  }

  private eraForSettlement(settlement: Settlement): Era {
    if (this.state.advanced.machine.capability > 0.55 || this.state.advanced.space.orbitalInfrastructure > 0.15) return 'advanced';
    if (settlement.industry.active || settlement.infrastructure.factories > 0.12 || settlement.infrastructure.power > 0.12) return 'industrial';
    if (settlement.infrastructure.archives > 0.2 || settlement.infrastructure.workshops > 0.28) return 'preIndustrial';
    if (settlement.urbanization > 0.2 || settlement.infrastructure.roads > 0.2) return 'village';
    if (settlement.buildings > 8) return 'early';
    return 'primitive';
  }

  /**
   * A settlement modernises unevenly. Conservative plots — and ceremonial ones especially —
   * lag behind, so a mature town still shows the shrine and the old houses it grew around.
   */
  private eraForBuilding(placement: BuildingPlacement, settlementEra: Era): Era {
    const settlementRank = eraRank(settlementEra);
    const builtRank = eraRank(placement.builtEra);
    if (settlementRank <= builtRank) return placement.builtEra;
    const ceremonial = placement.district === 'sacred' || placement.district === 'civic';
    const lag = (placement.conservatism > 0.82 ? 2 : placement.conservatism > 0.55 ? 1 : 0) + (ceremonial ? 1 : 0);
    const rank = Math.max(builtRank, Math.min(settlementRank, settlementRank - lag));
    return ERA_ORDER[rank] ?? settlementEra;
  }

  /**
   * Settlement zoning. Plots are laid out in rings from a civic/sacred core, through
   * households, out to craft yards and finally an industrial edge, so the built environment
   * reads as a town rather than a scatter of boxes.
   */
  private districtForIndex(index: number, settlement: Settlement): BuildingDistrict {
    return districtForPlot(index, settlement);
  }

  /**
   * The structure a plot is ultimately destined to hold. Grammar resolution clamps this to
   * whatever the era can actually build, so a future foundry stands as a workshop for
   * centuries first and the skyline never jumps lineage. Founding era weights the mix: plots
   * laid out by an industrial society are destined for heavier stock than a village's.
   */
  private roleForDistrict(district: BuildingDistrict, index: number, random: SeededRandom, foundingEra: Era): BuildingRole {
    const rank = eraRank(foundingEra);
    switch (district) {
      case 'civic':
        return 'hall';
      case 'sacred':
        return index % (rank >= 3 ? 7 : 13) === 1 ? 'gate-tower' : 'shrine';
      case 'market':
        return rank >= 3 && random.float() < 0.3 ? 'warehouse' : 'market';
      case 'craft':
        if (rank >= 3) return random.float() < 0.25 ? 'granary' : random.float() < 0.75 ? 'workshop' : 'warehouse';
        return random.float() < 0.4 ? 'granary' : 'workshop';
      case 'industrial':
        if (rank >= 5) {
          const draw = random.float();
          if (draw < 0.22) return 'research';
          if (draw < 0.38) return 'energy';
          return draw < 0.62 ? 'factory' : 'warehouse';
        }
        return random.float() < 0.35 ? 'foundry' : random.float() < 0.6 ? 'factory' : 'warehouse';
      case 'residential':
      default:
        return random.float() < (rank >= 4 ? 0.42 : 0.28) ? 'compound' : 'house';
    }
  }

  /**
   * Ceremonial structures come with a precinct — forecourt, gateway, court wall — so their
   * plot is reserved large enough to contain it. Without this the courts of neighbouring
   * shrines overlap.
   */
  private plotScaleFor(role: BuildingRole): number {
    switch (role) {
      case 'hall':
      case 'shrine':
      case 'gate-tower':
        return 2.6;
      case 'compound':
        return 1.9;
      case 'ritual-marker':
        return 1.6;
      default:
        return 1.15;
    }
  }

  private getSettlementBuildingPlacements(settlement: Settlement, shownBuildings: number, layout = this.layoutForSettlement(settlement)): BuildingPlacement[] {
    void layout;
    const existing = this.settlementBuildingPlacements.get(settlement.id) ?? [];
    if (existing.length >= shownBuildings) return existing.slice(0, shownBuildings);

    const foundingEra = this.eraForSettlement(settlement);
    const placements = [...existing];
    for (let index = placements.length; index < shownBuildings; index += 1) {
      const random = this.random.fork(`${settlement.id}:building-placement:${index}`);
      const district = this.districtForIndex(index, settlement);
      const plot = settlement.structurePlots?.[index];
      if (!plot) break;
      const role = this.roleForDistrict(district, index, random, foundingEra);
      const major = district === 'civic' || district === 'sacred' || district === 'industrial';
      const plotScale = this.plotScaleFor(role);
      const width = Math.min(plot.width, plot.width * plotScale / 2.6);
      const height = plot.height;
      const depth = Math.min(plot.depth, width * 0.82);
      // Reserve for the finished structure and its precinct, not the primitive ancestor, so
      // later upgrades never need to claim new ground and buildings never drift.
      const footprintRadius = plot.radius;
      let placement: BuildingPlacement | undefined;

      for (let attempt = 0; attempt < 1 && !placement; attempt += 1) {
        const worldX = plot.worldX;
        const worldZ = plot.worldZ;
        const localX = worldX - settlement.position.x;
        const localZ = worldZ - settlement.position.z;
        this.placementFootprints.registerFootprint({
          kind: 'building',
          worldX,
          worldZ,
          radius: footprintRadius,
          placedMonth: this.state.month,
          entityId: `${settlement.id}:building:${index}`,
          persistent: true,
        });
        placement = {
          key: `${settlement.id}:building:${index}`,
          localX,
          localZ,
          worldX,
          worldZ,
          width,
          depth,
          height,
          // Composed buildings face +Z, so aim each entrance back at the civic core.
          rotationY: Math.atan2(-localX, -localZ) + random.range(-0.16, 0.16),
          major,
          district,
          role,
          builtEra: foundingEra,
          conservatism: random.float(),
          variation: Math.floor(random.float() * 4),
        };
      }

      if (placement) placements.push(placement);
      else break;
    }

    this.settlementBuildingPlacements.set(settlement.id, placements);
    return placements.slice(0, shownBuildings);
  }

  private developmentSignature(settlement: Settlement): string {
    const infrastructure = settlement.infrastructure;
    const stops = Object.values(this.state.transportation.stops).filter(stop => stop.settlementId === settlement.id && stop.status === 'complete').map(stop => stop.id).join(',');
    // The era is part of the signature because its thresholds do not line up with the coarse
    // buckets below, and a missed era change would leave a settlement rendered as its past.
    return [this.eraForSettlement(settlement), ...[infrastructure.roads, infrastructure.ports, infrastructure.bridges, infrastructure.workshops, infrastructure.archives, infrastructure.rail, infrastructure.power, infrastructure.factories, settlement.industry.intensity, settlement.urbanization, settlement.constructionProgress, this.state.advanced.atomic.applications.energy, this.state.advanced.machine.capability, this.state.advanced.space.orbitalInfrastructure]
      .map((value) => Math.floor(value * 5)), stops, ...(settlement.structurePlots ?? []).map((plot) => Math.floor(plot.condition * 20))].join(':');
  }

  private addInfrastructure(group: THREE.Group, settlement: Settlement, culture: Culture | undefined, smokeSources: SmokeSource[]): void {
    const accent = culture?.style.accent ?? '#d9a748';
    const metal = new THREE.MeshStandardMaterial({ color: '#545c62', roughness: 0.58, metalness: 0.42 });
    void smokeSources;

    if (settlement.infrastructure.power > 0.1) {
      const lampMaterial = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2 });
      const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);
      for (let index = 0; index < 7; index += 1) {
        const angle = index / 7 * Math.PI * 2;
        const localX = Math.cos(angle) * 4.7;
        const localZ = Math.sin(angle) * 4.7;
        const worldX = settlement.position.x + localX;
        const worldZ = settlement.position.z + localZ;
        const terrain = this.terrainQueries.queryTerrainAt(worldX, worldZ);
        if (!terrain || terrain.water || terrain.maxSlope > 35) continue;
        const groundY = this.elevationAt(worldX, worldZ) - settlementY;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.8, 6), metal);
        pole.position.set(localX, groundY + 0.9, localZ);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lampMaterial);
        bulb.position.set(pole.position.x, groundY + 1.78, pole.position.z);
        group.add(pole, bulb);
      }
    }
    this.addAdvancedInfrastructure(group, settlement, culture, metal);
  }

  /** Advanced landmarks still use the placement contract; capability never licenses drift. */
  private addAdvancedInfrastructure(group: THREE.Group, settlement: Settlement, culture: Culture | undefined, metal: THREE.MeshStandardMaterial): void {
    const primary = culture?.style.primary ?? '#c36557';
    const secondary = culture?.style.secondary ?? '#313550';
    const accent = culture?.style.accent ?? '#d9a748';
    const wall = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.78, metalness: 0.08 });
    const roof = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.6, metalness: 0.24 });
    const motifSides = culture?.style.pattern === 'wave' ? 10 : culture?.style.pattern === 'diamond' || culture?.style.pattern === 'crossweave' ? 4 : 6;
    const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);

    if (this.state.advanced.atomic.applications.energy > 0.16) {
      const position = this.validatedInfrastructurePosition(settlement, 'reactor', 6.1, -4.8, 1.45);
      if (position) {
        const reactor = new THREE.Group();
        reactor.position.set(position.worldX - settlement.position.x, this.elevationAt(position.worldX, position.worldZ) - settlementY, position.worldZ - settlement.position.z);
        reactor.userData['placementKey'] = `${settlement.id}:infrastructure:reactor`;
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.42, motifSides), wall);
        plinth.position.y = 0.21;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.94, motifSides * 2, 7, 0, Math.PI * 2, 0, Math.PI / 2), roof);
        dome.position.y = 0.42;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.08, 6, motifSides * 2), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.28 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.52;
        reactor.add(plinth, dome, ring);
        group.add(reactor);
      }
    }
    if (this.state.advanced.machine.capability > 0.5) {
      const position = this.validatedInfrastructurePosition(settlement, 'machine-lattice', -6.4, -4.6, 0.82);
      if (position) {
        const lattice = new THREE.Group();
        lattice.position.set(position.worldX - settlement.position.x, this.elevationAt(position.worldX, position.worldZ) - settlementY, position.worldZ - settlement.position.z);
        lattice.userData['placementKey'] = `${settlement.id}:infrastructure:machine-lattice`;
        for (let index = 0; index < 3; index += 1) {
          const frame = new THREE.Mesh(new THREE.TorusGeometry(0.58 - index * 0.11, 0.055, 5, motifSides), index === 1 ? wall : metal);
          frame.position.y = 0.8 + index * 0.7;
          frame.rotation.set(Math.PI / 2, index * 0.42, index * 0.28);
          lattice.add(frame);
        }
        const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 2.6, motifSides), roof);
        spine.position.y = 1.3;
        lattice.add(spine);
        group.add(lattice);
      }
    }
    if (this.state.advanced.space.orbitalInfrastructure > 0.18) {
      const position = this.validatedInfrastructurePosition(settlement, 'orbital-mast', 5.8, 4.8, 0.68);
      if (position) {
        const mast = new THREE.Group();
        mast.position.set(position.worldX - settlement.position.x, this.elevationAt(position.worldX, position.worldZ) - settlementY, position.worldZ - settlement.position.z);
        mast.userData['placementKey'] = `${settlement.id}:infrastructure:orbital-mast`;
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.36, 5.8, motifSides), metal);
        tower.position.y = 2.9;
        const crown = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.08, 6, motifSides * 2), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.7, metalness: 0.42, roughness: 0.38 }));
        crown.rotation.x = Math.PI / 2;
        crown.position.y = 5.42;
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.25, motifSides), wall);
        fin.position.y = 6.25;
        mast.add(tower, crown, fin);
        group.add(mast);
      }
    }
  }

  private validatedInfrastructurePosition(settlement: Settlement, kind: string, desiredX: number, desiredZ: number, radius: number): { worldX: number; worldZ: number } | undefined {
    const key = `${settlement.id}:infrastructure:${kind}`;
    const cached = this.infrastructurePlacements.get(key);
    if (cached) return cached;
    for (let attempt = 0; attempt < 96; attempt += 1) {
      const angle = stableUnit(`${this.config.seed}:${key}:${attempt}`) * Math.PI * 2;
      const spread = attempt === 0 ? 0 : 0.45 + Math.sqrt(attempt) * 0.62;
      const worldX = settlement.position.x + desiredX + Math.cos(angle) * spread;
      const worldZ = settlement.position.z + desiredZ + Math.sin(angle) * spread;
      const validation = this.placementContract.validate({ type: 'major-building', worldX, worldZ, footprintRadius: radius, biomeWhitelist: ['grassland', 'forest', 'dryland', 'highland', 'wetland'] });
      if (!validation.valid) continue;
      const registered = this.placementFootprints.registerFootprint({ kind: 'building', worldX, worldZ, radius, placedMonth: this.state.month, entityId: key, persistent: true });
      if (!registered.success) continue;
      const placement = { worldX, worldZ };
      this.infrastructurePlacements.set(key, placement);
      return placement;
    }
    return undefined;
  }

  private addBanner(group: THREE.Group, culture: Culture | undefined, institutionCount: number): void {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#3a2928', roughness: 0.9 }));
    pole.position.set(-0.8, 1.6, 0.15);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 1.3), new THREE.MeshStandardMaterial({ color: culture?.style.primary ?? '#d96c86', side: THREE.DoubleSide, roughness: 0.75 }));
    cloth.position.set(-0.36, 2.18, 0.15);
    const symbol = culture?.style.symbol ?? 'sun-step';
    const markGeometry = symbol === 'river-eye' ? new THREE.RingGeometry(0.1, 0.22, 12, 1, 0, Math.PI)
      : symbol === 'woven-moon' ? new THREE.RingGeometry(0.12, 0.23, 10, 1, 0.4, Math.PI * 1.45)
        : symbol === 'mountain-knot' ? new THREE.CircleGeometry(0.22, 3)
          : symbol === 'seed-spiral' ? new THREE.TorusGeometry(0.15, 0.045, 5, 10)
            : new THREE.RingGeometry(0.1, 0.22, 8);
    const mark = new THREE.Mesh(markGeometry, new THREE.MeshStandardMaterial({ color: culture?.style.accent ?? '#efb758', side: THREE.DoubleSide }));
    mark.position.set(-0.36, 2.18, 0.16);
    group.add(pole, cloth, mark);
    const patternSides = culture?.style.pattern === 'diamond' || culture?.style.pattern === 'crossweave' ? 4 : culture?.style.pattern === 'wave' ? 8 : 3;
    for (let index = 0; index < 3; index += 1) {
      const motif = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.065, patternSides), new THREE.MeshStandardMaterial({ color: culture?.style.secondary ?? '#342a58', side: THREE.DoubleSide }));
      motif.position.set(-0.58 + index * 0.22, 1.77, 0.165);
      motif.rotation.z = culture?.style.pattern === 'terrace' ? index * 0.25 : Math.PI / 4;
      group.add(motif);
    }
    for (let index = 0; index < Math.min(3, institutionCount); index += 1) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.75), new THREE.MeshStandardMaterial({ color: culture?.style.accent ?? '#efb758', side: THREE.DoubleSide }));
      ribbon.position.set(0.1 + index * 0.17, 1.85, -0.1);
      ribbon.rotation.y = 0.35;
      group.add(ribbon);
    }
  }

  /** Blossom trees are the settlement's soft signature; count and siting are per-settlement deterministic. */
  private addBlossomTree(group: THREE.Group, random: SeededRandom): void {
    const count = 1 + (random.chance(0.55) ? 1 : 0) + (random.chance(0.25) ? 1 : 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#65413f', roughness: 1 });
    const blossomMaterial = new THREE.MeshStandardMaterial({ color: '#df829b', roughness: 0.95 });
    const petalMaterial = new THREE.MeshStandardMaterial({ color: '#e8aabb', roughness: 1, transparent: true, opacity: 0.55 });
    for (let tree = 0; tree < count; tree += 1) {
      const angle = random.range(0, Math.PI * 2);
      const radius = random.range(2.6, 5.4);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const scale = random.range(0.72, 1.28);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * scale, 0.16 * scale, 1.65 * scale, 7), trunkMaterial);
      trunk.position.set(x, 0.82 * scale, z);
      trunk.castShadow = true;
      group.add(trunk);
      for (let index = 0; index < 5; index += 1) {
        const blossom = new THREE.Mesh(new THREE.IcosahedronGeometry(random.range(0.35, 0.55) * scale, 1), blossomMaterial);
        blossom.position.set(x + random.range(-0.52, 0.52) * scale, (1.65 + random.range(-0.1, 0.65)) * scale, z + random.range(-0.45, 0.45) * scale);
        blossom.castShadow = true;
        group.add(blossom);
      }
      const petals = new THREE.Mesh(new THREE.CircleGeometry(0.62 * scale, 12), petalMaterial);
      petals.rotation.x = -Math.PI / 2;
      petals.position.set(x, 0.018, z);
      group.add(petals);
    }
  }

  private addMarket(group: THREE.Group, settlement: Settlement, layout: SettlementLayoutPlan, culture: Culture | undefined, count: number): void {
    const wood = new THREE.MeshStandardMaterial({ color: '#72503b', roughness: 0.95 });
    const clothColors = [culture?.style.accent ?? '#efb758', culture?.style.primary ?? '#d96c86'];
    const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);
    const anchor = layout.anchors.market;
    const placedStalls: Array<{ worldX: number; worldZ: number }> = [];
    for (let index = 0; index < count; index += 1) {
      const phase = stableUnit(`${this.config.seed}:${settlement.id}:market-stall:${index}`) * Math.PI * 2;
      let position: { localX: number; localZ: number; worldX: number; worldZ: number } | undefined;
      for (let attempt = 0; attempt < 48; attempt += 1) {
        const angle = phase + attempt * 2.399;
        const radius = anchor.radius * 0.52 + 0.48 + Math.sqrt(attempt) * 0.18;
        const localX = anchor.localX + Math.cos(angle) * radius;
        const localZ = anchor.localZ + Math.sin(angle) * radius;
        const worldX = settlement.position.x + localX;
        const worldZ = settlement.position.z + localZ;
        const validation = this.placementContract.validate({ type: 'small-building', worldX, worldZ, footprintRadius: 0.48, biomeWhitelist: ['grassland', 'forest', 'dryland', 'highland', 'wetland'] });
        if (!validation.valid || !this.placementFootprints.isAreaClear(worldX, worldZ, 0.48).clear || placedStalls.some((placed) => Math.hypot(worldX - placed.worldX, worldZ - placed.worldZ) < 1.02)) continue;
        position = { localX, localZ, worldX, worldZ };
        placedStalls.push({ worldX, worldZ });
        break;
      }
      if (!position) continue;
      const angle = Math.atan2(position.localZ - anchor.localZ, position.localX - anchor.localX);
      const stall = new THREE.Group();
      stall.position.set(position.localX, this.elevationAt(position.worldX, position.worldZ) - settlementY, position.localZ);
      const table = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.48), wood);
      table.position.y = 0.42;
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.68), new THREE.MeshStandardMaterial({ color: clothColors[index % clothColors.length], roughness: 0.9 }));
      canopy.position.y = 1.05;
      const posts = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.96, 0.05), wood);
      posts.position.set(-0.38, 0.62, -0.2);
      const secondPost = posts.clone();
      secondPost.position.x = 0.38;
      stall.add(table, canopy, posts, secondPost);
      stall.rotation.y = -angle + Math.PI / 2;
      group.add(stall);
    }
  }

  private addWaystones(group: THREE.Group, culture: Culture | undefined, count: number): void {
    const stone = new THREE.MeshStandardMaterial({ color: '#625e59', roughness: 1 });
    const accent = new THREE.MeshStandardMaterial({ color: culture?.style.accent ?? '#efb758', roughness: 0.78 });
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2 + 0.3;
      const marker = new THREE.Group();
      marker.position.set(Math.cos(angle) * 6.4, 0, Math.sin(angle) * 6.4);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.8, 4), stone);
      pillar.position.y = 0.4;
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), accent);
      cap.position.y = 0.9;
      marker.add(pillar, cap);
      group.add(marker);
    }
  }

  /**
   * Era-scaled night lighting. A camp reads as one flickering fire, a village as a few warm
   * lanterns, an industrial city as rows of cooler street light — the distribution itself
   * makes the era legible after dark.
   */
  private addSettlementLighting(group: THREE.Group, era: Era, palette: MaterialPalette, random: SeededRandom): SettlementLightEntry[] {
    const rank = eraRank(era);
    const aliveSettlements = Math.max(1, this.state.settlements.filter((candidate) => candidate.alive).length);
    const desired = rank <= 1 ? 1 : rank === 2 ? 2 : rank <= 4 ? 3 : 4;
    const count = Math.min(desired, Math.max(1, Math.floor(SETTLEMENT_LIGHT_BUDGET / aliveSettlements)));
    const entries: SettlementLightEntry[] = [];
    const glow = palette.getSurfaceMaterial('glow');
    const postMaterial = rank >= 4 ? palette.getSurfaceMaterial('metal') : palette.getSurfaceMaterial('timber');

    const attach = (x: number, y: number, z: number, color: THREE.ColorRepresentation, base: number, flicker: number, distance: number): void => {
      const light = new THREE.PointLight(color, 0, distance, 2);
      light.position.set(x, y, z);
      light.castShadow = false;
      group.add(light);
      entries.push({ light, base, flicker });
    };

    if (rank <= 1) {
      const stone = palette.getSurfaceMaterial('stone');
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2 + random.range(-0.1, 0.1);
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.085, 0), stone);
        rock.position.set(Math.cos(angle) * 0.42, 0.05, Math.sin(angle) * 0.42);
        rock.castShadow = true;
        group.add(rock);
      }
      const embers = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), glow);
      embers.position.y = 0.07;
      group.add(embers);
      attach(0, 0.55, 0, '#ff9448', 2, 0.42, 9);
      return entries;
    }

    const color = rank >= 5 ? '#dceaff' : rank === 4 ? '#ffe4ae' : '#ffc37e';
    const base = rank >= 5 ? 3.4 : rank === 4 ? 3 : 2.3;
    const distance = rank >= 4 ? 16 : 12;
    const flicker = rank <= 3 ? 0.14 : 0;
    const radius = 2.7 + rank * 0.35;
    const startAngle = random.range(0, Math.PI * 2);
    for (let index = 0; index < count; index += 1) {
      const angle = startAngle + (index / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = rank >= 4 ? 1.9 : 1.35;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.045, height, 6), postMaterial);
      pole.position.set(x, height / 2, z);
      pole.castShadow = true;
      const head = new THREE.Mesh(rank >= 4 ? new THREE.SphereGeometry(0.085, 8, 6) : new THREE.BoxGeometry(0.13, 0.15, 0.13), glow);
      head.position.set(x, height + 0.06, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(rank >= 4 ? 0.045 : 0.11, 0.13, 0.06, rank >= 4 ? 8 : 4), postMaterial);
      cap.position.set(x, height + 0.17, z);
      group.add(pole, head, cap);
      attach(x, height + 0.1, z, color, base, flicker, distance);
    }
    return entries;
  }

  /**
   * Small working props keyed to the era: drying racks for camps, a well for villages, wall
   * fragments for pre-industrial towns, freight for industry, panel arrays for the advanced.
   * These are the background verbs of daily life the buildings alone cannot speak.
   */
  private addEraDressing(group: THREE.Group, era: Era, palette: MaterialPalette, random: SeededRandom): void {
    const rank = eraRank(era);
    const timber = palette.getSurfaceMaterial('timber');
    const stone = palette.getSurfaceMaterial('stone');
    if (rank <= 1) {
      for (let index = 0; index < 2; index += 1) {
        const angle = random.range(0, Math.PI * 2);
        const radius = random.range(1.6, 3);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const yaw = random.range(0, Math.PI);
        for (const side of [-0.34, 0.34]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.62, 5), timber);
          post.position.set(x + Math.cos(yaw) * side, 0.31, z - Math.sin(yaw) * side);
          post.castShadow = true;
          group.add(post);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.03, 0.03), timber);
        rail.position.set(x, 0.58, z);
        rail.rotation.y = yaw;
        group.add(rail);
        const hide = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshStandardMaterial({ color: '#a5825d', roughness: 1, side: THREE.DoubleSide }));
        hide.position.set(x, 0.42, z);
        hide.rotation.y = yaw;
        group.add(hide);
      }
      return;
    }
    if (rank <= 3) {
      // The village well: a stone drum, two posts, a windlass bar.
      const angle = random.range(0, Math.PI * 2);
      const x = Math.cos(angle) * 2.4;
      const z = Math.sin(angle) * 2.4;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.3, 8), stone);
      drum.position.set(x, 0.15, z);
      drum.castShadow = true;
      group.add(drum);
      for (const side of [-0.3, 0.3]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.72, 0.045), timber);
        post.position.set(x + side, 0.36, z);
        group.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.66, 5), timber);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(x, 0.66, z);
      group.add(bar);
    }
    if (rank === 3) {
      // Fragments of town wall with gate posts mark the formal edge.
      const wallAngle = random.range(0, Math.PI * 2);
      for (const offset of [-0.5, 0.5]) {
        const segment = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.16), stone);
        const sx = Math.cos(wallAngle) * 6 + Math.cos(wallAngle + Math.PI / 2) * offset * 2.6;
        const sz = Math.sin(wallAngle) * 6 + Math.sin(wallAngle + Math.PI / 2) * offset * 2.6;
        segment.position.set(sx, 0.25, sz);
        segment.rotation.y = -wallAngle + Math.PI / 2;
        segment.castShadow = true;
        group.add(segment);
      }
    }
    if (rank >= 4) {
      // Freight yard clutter: crates and barrels near the working edge.
      const yardAngle = random.range(0, Math.PI * 2);
      const yardX = Math.cos(yardAngle) * 4.6;
      const yardZ = Math.sin(yardAngle) * 4.6;
      for (let index = 0; index < 5; index += 1) {
        const crate = random.chance(0.6);
        const size = random.range(0.14, 0.24);
        const prop = crate
          ? new THREE.Mesh(new THREE.BoxGeometry(size, size, size), timber)
          : new THREE.Mesh(new THREE.CylinderGeometry(size * 0.5, size * 0.55, size, 8), timber);
        prop.position.set(yardX + random.range(-0.7, 0.7), size / 2, yardZ + random.range(-0.7, 0.7));
        prop.rotation.y = random.range(0, Math.PI);
        prop.castShadow = true;
        group.add(prop);
      }
    }
    if (rank >= 5) {
      const metal = palette.getSurfaceMaterial('metal');
      const glowMaterial = palette.getSurfaceMaterial('glow');
      const angle = random.range(0, Math.PI * 2);
      const x = Math.cos(angle) * 5.4;
      const z = Math.sin(angle) * 5.4;
      for (let index = 0; index < 3; index += 1) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.34), index === 1 ? glowMaterial : metal);
        panel.position.set(x + (index - 1) * 0.58, 0.24, z);
        panel.rotation.z = 0.42;
        panel.rotation.y = -angle;
        panel.castShadow = true;
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), metal);
        foot.position.set(x + (index - 1) * 0.58, 0.12, z);
        group.add(panel, foot);
      }
    }
  }

  /**
   * What a settlement is good at, planted where the camera can read it: field rows for
   * farmers, log stacks for foresters, spoil heaps and scaffolds for miners, a kiln and goods
   * yard for crafters, a caravan rest for traders. Deterministic per settlement.
   */
  private addSpecializationDressing(group: THREE.Group, settlement: Settlement, era: Era, palette: MaterialPalette, smokeSources: SmokeSource[], routeCount: number): void {
    const rank = eraRank(era);
    if (rank < 1) return;
    const random = this.random.fork(`${settlement.id}:specialization`);
    const timber = palette.getSurfaceMaterial('timber');
    const stone = palette.getSurfaceMaterial('stone');
    const angle = random.range(0, Math.PI * 2);
    const baseRadius = 5 + rank * 0.5;
    const baseX = Math.cos(angle) * baseRadius;
    const baseZ = Math.sin(angle) * baseRadius;
    const settlementY = this.elevationAt(settlement.position.x, settlement.position.z);

    if (settlement.specialization === 'agriculture') {
      const soil = new THREE.MeshStandardMaterial({ color: '#5d4632', roughness: 1 });
      const crop = new THREE.MeshStandardMaterial({ color: '#7f9946', roughness: 1 });
      for (let plot = 0; plot < 2; plot += 1) {
        const px = baseX + (plot === 0 ? 0 : Math.cos(angle + 1.2) * 2.1);
        const pz = baseZ + (plot === 0 ? 0 : Math.sin(angle + 1.2) * 2.1);
        const bed = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 1.15), soil);
        bed.position.set(px, 0.03, pz);
        bed.rotation.y = angle;
        bed.receiveShadow = true;
        group.add(bed);
        for (let row = 0; row < 4; row += 1) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), crop);
          const offset = (row - 1.5) * 0.26;
          line.position.set(px + Math.sin(angle) * offset, 0.1, pz + Math.cos(angle) * offset);
          line.rotation.y = angle;
          line.castShadow = true;
          group.add(line);
        }
      }
    } else if (settlement.specialization === 'forestry') {
      // A stacked log pile and a pair of saw trestles.
      for (let layer = 0; layer < 3; layer += 1) {
        const logs = 3 - layer;
        for (let index = 0; index < logs; index += 1) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.15, 7), timber);
          log.rotation.z = Math.PI / 2;
          log.rotation.y = angle;
          const spread = (index - (logs - 1) / 2) * 0.19;
          log.position.set(baseX + Math.sin(angle) * spread, 0.09 + layer * 0.155, baseZ + Math.cos(angle) * spread);
          log.castShadow = true;
          group.add(log);
        }
      }
      for (const side of [-0.7, 0.7]) {
        const trestle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.34), timber);
        trestle.position.set(baseX + Math.cos(angle) * 1.4 + Math.sin(angle) * side, 0.2, baseZ + Math.sin(angle) * 1.4 + Math.cos(angle) * side);
        group.add(trestle);
      }
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 1.6), timber);
      plank.position.set(baseX + Math.cos(angle) * 1.4, 0.42, baseZ + Math.sin(angle) * 1.4);
      plank.rotation.y = -angle;
      group.add(plank);
    } else if (settlement.specialization === 'mining') {
      const spoil = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.62, 9), new THREE.MeshStandardMaterial({ color: '#4f4a4d', roughness: 1 }));
      spoil.position.set(baseX, 0.31, baseZ);
      spoil.castShadow = true;
      group.add(spoil);
      // Head-frame scaffold over the working.
      const platformX = baseX + Math.cos(angle + 1.4) * 1.5;
      const platformZ = baseZ + Math.sin(angle + 1.4) * 1.5;
      for (const [sx, sz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.05), timber);
        leg.position.set(platformX + sx, 0.42, platformZ + sz);
        group.add(leg);
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.78), timber);
      deck.position.set(platformX, 0.88, platformZ);
      deck.castShadow = true;
      group.add(deck);
      const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.7, metalness: 0.3 }));
      ore.position.set(baseX + 0.7, 0.12, baseZ + 0.4);
      group.add(ore);
    } else if (settlement.specialization === 'craft') {
      // A beehive kiln with live smoke and a goods yard of pots.
      const kiln = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), stone);
      kiln.position.set(baseX, 0.02, baseZ);
      kiln.castShadow = true;
      group.add(kiln);
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.1), palette.getSurfaceMaterial('shadow'));
      mouth.position.set(baseX + Math.cos(angle) * 0.36, 0.12, baseZ + Math.sin(angle) * 0.36);
      mouth.rotation.y = -angle;
      group.add(mouth);
      if (rank >= 2) {
        smokeSources.push({
          worldX: settlement.position.x + baseX,
          worldY: settlementY + 0.55,
          worldZ: settlement.position.z + baseZ,
          strength: 0.45,
          shade: 0.78,
        });
      }
      const clay = new THREE.MeshStandardMaterial({ color: '#9d6b3d', roughness: 0.85 });
      for (let index = 0; index < 4; index += 1) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.16, 8), clay);
        pot.position.set(baseX + Math.cos(angle + 2 + index * 0.5) * 0.85, 0.08, baseZ + Math.sin(angle + 2 + index * 0.5) * 0.85);
        pot.castShadow = true;
        group.add(pot);
      }
    }

    // Heavy trade earns a caravan rest regardless of base specialization.
    if ((settlement.specialization === 'exchange' || routeCount >= 3) && rank >= 2) {
      const restX = Math.cos(angle + Math.PI * 0.66) * (baseRadius - 0.5);
      const restZ = Math.sin(angle + Math.PI * 0.66) * (baseRadius - 0.5);
      for (const [sx, sz] of [[-0.5, -0.35], [0.5, -0.35], [0, 0.45]] as const) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), timber);
        post.position.set(restX + sx, 0.45, restZ + sz);
        group.add(post);
      }
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 1.05), palette.getSurfaceMaterial('cloth'));
      canopy.position.set(restX, 0.94, restZ);
      canopy.rotation.z = 0.06;
      canopy.castShadow = true;
      group.add(canopy);
      for (let index = 0; index < 3; index += 1) {
        const bale = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.26), timber);
        bale.position.set(restX + (index - 1) * 0.3, 0.08, restZ - 0.1);
        bale.rotation.y = index * 0.6;
        bale.castShadow = true;
        group.add(bale);
      }
    }
  }

  /** Woodsmoke over the rooftops: the cheapest possible signal that people live here. */
  private addHearthSmoke(placements: BuildingPlacement[], era: Era, sources: SmokeSource[]): void {
    const rank = eraRank(era);
    if (rank < 1 || rank > 4) return;
    let hearths = 0;
    for (const placement of placements) {
      if (hearths >= 2) break;
      if (placement.district !== 'residential') continue;
      sources.push({
        worldX: placement.worldX,
        worldY: this.elevationAt(placement.worldX, placement.worldZ) + 1.05,
        worldZ: placement.worldZ,
        strength: 0.3,
        shade: 0.88,
      });
      hearths += 1;
    }
    if (rank >= 3) {
      let industrialSources = 0;
      for (const placement of placements) {
        if (industrialSources >= 2) break;
        if (placement.role !== 'factory' && placement.role !== 'foundry' && placement.role !== 'workshop') continue;
        sources.push({
          worldX: placement.worldX,
          worldY: this.elevationAt(placement.worldX, placement.worldZ) + placement.height * 0.72,
          worldZ: placement.worldZ,
          strength: placement.role === 'factory' ? 0.72 : 0.48,
          shade: placement.role === 'factory' ? 0.48 : 0.64,
        });
        industrialSources += 1;
      }
    }
  }

  private createSmokePool(): THREE.InstancedMesh {
    const capacity = Math.max(60, Math.round(210 * this.config.render.visualDensity));
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Flattens per-settlement plume sources into the shared instanced pool. */
  private refreshSmokeSources(): void {
    this.activeSmokeSources.length = 0;
    const maxSources = Math.floor(this.smoke.instanceMatrix.count / SMOKE_PUFFS_PER_SOURCE);
    for (const visual of this.settlementVisuals.values()) {
      if (this.activeSmokeSources.length >= maxSources) break;
      if (!visual.group.visible) continue;
      for (const source of visual.smokeSources) {
        if (this.activeSmokeSources.length >= maxSources) break;
        this.activeSmokeSources.push(source);
      }
    }
    for (let index = 0; index < this.activeSmokeSources.length * SMOKE_PUFFS_PER_SOURCE; index += 1) {
      const source = this.activeSmokeSources[Math.floor(index / SMOKE_PUFFS_PER_SOURCE)];
      if (!source) continue;
      this.smokeColor.setScalar(source.shade);
      this.smoke.setColorAt(index, this.smokeColor);
    }
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }

  /** Rising, drifting, dissolving plumes — scale carries the fade so one material serves all. */
  private updateSmoke(elapsedSeconds: number): void {
    const active = this.activeSmokeSources.length * SMOKE_PUFFS_PER_SOURCE;
    this.smoke.count = active;
    if (active === 0) return;
    for (let index = 0; index < active; index += 1) {
      const source = this.activeSmokeSources[Math.floor(index / SMOKE_PUFFS_PER_SOURCE)];
      if (!source) continue;
      const phase = (index % SMOKE_PUFFS_PER_SOURCE) / SMOKE_PUFFS_PER_SOURCE + index * 0.083;
      const speed = (0.8 + source.strength * 0.5) / 7;
      const t = (elapsedSeconds * speed + phase) % 1;
      const rise = 1.3 + source.strength * 2.3;
      const drift = t * t * (0.55 + source.strength * 0.4);
      const fade = Math.sin(Math.PI * Math.min(1, t * 1.12));
      const scale = Math.max(0.001, (0.09 + (0.2 + source.strength * 0.3) * t) * fade);
      this.smokeMatrix.makeScale(scale, scale * 0.82, scale);
      this.smokeMatrix.setPosition(source.worldX + drift * 0.62, source.worldY + t * rise, source.worldZ + drift * 0.3);
      this.smoke.setMatrixAt(index, this.smokeMatrix);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  private syncRoutes(force = false): void {
    const network = this.state.transportation;
    const signature = String(network.revision);
    if (!force && signature === this.lastRouteSignature) return;
    this.lastRouteSignature = signature;
    this.clearGroup(this.routeGroup);
    this.routePlacementReports.clear();
    for (const segment of Object.values(network.segments)) {
      if (segment.mode === 'water' || segment.status === 'planned') continue;
      if (segment.status === 'under-construction') {
        const point = segment.points[0];
        if (!point) continue;
        const marker = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), new THREE.MeshStandardMaterial({ color: '#c79958' }));
        marker.position.set(point.x, point.y + 0.2, point.z);
        marker.userData['constructionSegmentId'] = segment.id;
        this.routeGroup.add(marker);
        continue;
      }
      const rail = segment.mode === 'rail';
      const bridge = segment.kind === 'bridge';
      const width = rail ? 0.85 : 0.62;
      const bed = new THREE.Mesh(transportRibbon(this.state.world, segment, width), new THREE.MeshStandardMaterial({ color: rail ? '#625f58' : bridge ? '#8c8170' : '#987b57', roughness: 0.94, side: THREE.DoubleSide }));
      bed.userData['segmentId'] = segment.id;
      bed.receiveShadow = true;
      this.routeGroup.add(bed);
      bed.userData['weatherSurface'] = true;
      if (rail || bridge) {
        for (const side of [-1, 1]) {
          const line = new THREE.Mesh(transportRibbon(this.state.world, segment, rail ? 0.055 : 0.04, side * (rail ? 0.25 : width * 0.48), rail ? 0.045 : 0.25), new THREE.MeshStandardMaterial({ color: rail ? '#9a9ea0' : '#776958', metalness: rail ? 0.65 : 0.05, roughness: 0.6, side: THREE.DoubleSide }));
          this.routeGroup.add(line);
        }
      }
      if (bridge) {
        for (const point of [segment.points[0]!, segment.points[segment.points.length - 1]!]) {
          const ground = this.elevationAt(point.x, point.z);
          const height = Math.max(0.3, point.y - ground + 0.3);
          const post = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.18), new THREE.MeshStandardMaterial({ color: '#817768', roughness: 0.9 }));
          post.position.set(point.x, point.y - height / 2, point.z);
          this.routeGroup.add(post);
        }
      }
      this.routePlacementReports.set(segment.id, { routeId: segment.id, mode: 'land', railSupported: rail,
        samples: segment.points.length, waterSamples: bridge ? segment.points.length - 2 : 0,
        bridgeSegments: bridge ? 1 : 0, maxTerrainError: bridge ? 0 : segment.points.reduce((error, p) => Math.max(error, Math.abs(p.y - this.elevationAt(p.x, p.z) - 0.04)), 0), gradeViolations: gradeViolations(segment) });
    }
    this.weatherRenderer.bindScene(this.scene);
  }

  private createCaravan(): THREE.Group {
    const caravan = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.38, 0.7), new THREE.MeshStandardMaterial({ color: '#d8a849', roughness: 0.78 }));
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.62, 4), new THREE.MeshStandardMaterial({ color: '#31506a', roughness: 0.86 }));
    canopy.rotation.x = Math.PI / 2;
    canopy.position.y = 0.35;
    caravan.add(body, canopy);
    return caravan;
  }

  private createBoat(): THREE.Group {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.25, 4), new THREE.MeshStandardMaterial({ color: '#784738', roughness: 0.84 }));
    hull.rotation.x = Math.PI / 2;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 5), new THREE.MeshStandardMaterial({ color: '#4e372f', roughness: 1 }));
    mast.position.y = 0.5;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.56), new THREE.MeshStandardMaterial({ color: '#e7c183', side: THREE.DoubleSide, roughness: 0.92 }));
    sail.position.set(0.25, 0.61, 0);
    sail.rotation.y = Math.PI / 2;
    boat.add(hull, mast, sail);
    return boat;
  }

  private createTrain(settlement: Settlement): THREE.Group {
    const culture = this.dominantCulture(settlement);
    const train = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: culture?.style.primary ?? '#a35348', roughness: 0.58, metalness: 0.32 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: culture?.style.accent ?? '#e2af4e', roughness: 0.54, metalness: 0.25 });
    for (let index = 0; index < 1; index += 1) {
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 1.05), bodyMaterial);
      carriage.position.z = index * 0.86;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 1.1), trimMaterial);
      trim.position.set(0, 0.18, index * 0.86);
      train.add(carriage, trim);
    }
    return train;
  }

  private updateCaravans(): void {
    const trips = this.state.tradeRoutes.filter(route => route.active && route.transport?.trip && route.transport.trip.status !== 'arrived');
    const ids = new Set(trips.map(route => route.transport!.trip!.id));
    for (const object of [...this.caravanGroup.children]) {
      if (ids.has(object.userData['tripId'] as string)) continue;
      this.caravanGroup.remove(object);
      object.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(material => material.dispose()); } });
    }
    for (const route of trips) {
      const trip = route.transport!.trip!;
      let vehicle = this.caravanGroup.children.find(object => object.userData['tripId'] === trip.id);
      if (!vehicle) {
        const origin = this.state.settlements.find(s => s.id === trip.origin);
        if (!origin) continue;
        vehicle = trip.mode === 'water' ? this.createBoat() : trip.mode === 'rail' ? this.createTrain(origin) : trip.mode === 'walk' ? this.createFreightCarrier() : this.createCaravan();
        vehicle.userData['tripId'] = trip.id;
        vehicle.userData['transportMode'] = trip.mode;
        this.caravanGroup.add(vehicle);
      }
      const pose = positionAlongPath(trip.path, trip.distance);
      vehicle.visible = Boolean(pose && trip.status === 'moving');
      if (!pose) continue;
      vehicle.position.set(pose.position.x, pose.position.y + (trip.mode === 'walk' ? 0 : 0.29), pose.position.z);
      if (trip.mode === 'water') vehicle.position.y = this.terrainSurface.waterYAt(pose.position.x, pose.position.z) + 0.18;
      vehicle.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    }
  }

  private createFreightCarrier(): THREE.Group {
    const carrier = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.24, 3, 5), new THREE.MeshStandardMaterial({ color: '#86694b' }));
    body.position.y = 0.27;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.19, 0.13), new THREE.MeshStandardMaterial({ color: '#b59c6c' }));
    pack.position.set(0, 0.27, -0.11);
    carrier.add(body, pack);
    return carrier;
  }

  private syncWars(force = false): void {
    const wars = this.state.wars.filter((war) => war.active);
    const signature = wars.map((war) => `${war.id}:${war.phase}:${Math.round(war.marchProgress * 10)}:${Math.round(war.progress * 10)}`).join('|');
    if (!force && signature === this.lastWarSignature) return;
    this.lastWarSignature = signature;
    this.clearGroup(this.warGroup);
    for (const war of wars) {
      const a = this.state.settlements.find((settlement) => settlement.id === war.attacker);
      const b = this.state.settlements.find((settlement) => settlement.id === war.defender);
      if (!a || !b) continue;
      const attackerCulture = this.dominantCulture(a);
      const defenderCulture = this.dominantCulture(b);
      const advance = war.phase === 'mobilizing' ? 0.08 : war.phase === 'marching' ? 0.12 + war.marchProgress * 0.58 : war.phase === 'retreat' ? 0.36 : war.phase === 'occupation' ? 0.92 : 0.76;
      const attackerX = THREE.MathUtils.lerp(a.position.x, b.position.x, advance);
      const attackerZ = THREE.MathUtils.lerp(a.position.z, b.position.z, advance);
      const defenderX = THREE.MathUtils.lerp(a.position.x, b.position.x, 0.9);
      const defenderZ = THREE.MathUtils.lerp(a.position.z, b.position.z, 0.9);
      const attackerForce = this.createForceMarker(attackerCulture?.style.primary ?? '#cf563f', attackerCulture?.style.accent ?? '#efb758', war.strengthA);
      attackerForce.position.set(attackerX, this.elevationAt(attackerX, attackerZ) + 0.24, attackerZ);
      attackerForce.rotation.y = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z);
      const defenderForce = this.createForceMarker(defenderCulture?.style.primary ?? '#31506a', defenderCulture?.style.accent ?? '#43a5a0', war.strengthB);
      defenderForce.position.set(defenderX, this.elevationAt(defenderX, defenderZ) + 0.24, defenderZ);
      defenderForce.rotation.y = Math.atan2(a.position.x - b.position.x, a.position.z - b.position.z);
      this.warGroup.add(attackerForce, defenderForce);
      if (war.phase === 'battle') {
        const x = (attackerX + defenderX) / 2;
        const z = (attackerZ + defenderZ) / 2;
        const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.54, 0), new THREE.MeshStandardMaterial({ color: '#cf563f', emissive: '#8c261f', emissiveIntensity: 1.1, roughness: 0.5 }));
        marker.position.set(x, this.elevationAt(x, z) + 1.25, z);
        marker.rotation.z = Math.PI / 4;
        this.warGroup.add(marker);
      }
    }
  }

  private createForceMarker(primary: string, accent: string, strength: number): THREE.Group {
    const force = new THREE.Group();
    const count = Math.max(2, Math.min(6, Math.ceil(strength / 3)));
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.8 });
    for (let index = 0; index < count; index += 1) {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.48, 5), bodyMaterial);
      body.position.set((index % 3 - 1) * 0.34, 0.3, Math.floor(index / 3) * 0.32);
      body.castShadow = true;
      force.add(body);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.25, 5), new THREE.MeshStandardMaterial({ color: '#3a2928', roughness: 1 }));
    pole.position.set(-0.52, 0.63, 0.1);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.5), new THREE.MeshStandardMaterial({ color: accent, side: THREE.DoubleSide, roughness: 0.82 }));
    banner.position.set(-0.3, 0.92, 0.1);
    force.add(pole, banner);
    return force;
  }

  private updateDayNight(elapsedSeconds: number): void {
    const phase = (elapsedSeconds / 58 + 0.16) % 1;
    const daylight = THREE.MathUtils.smoothstep(Math.sin(phase * Math.PI * 2) * 0.5 + 0.5, 0.12, 0.72);
    const angle = phase * Math.PI * 2;
    this.sun.position.set(Math.cos(angle) * 72, Math.sin(angle) * 64, 24);
    this.sun.intensity = 0.08 + daylight * 3.25;
    this.moon.intensity = 0.12 + (1 - daylight) * 0.78;
    this.hemisphere.intensity = 0.22 + daylight * 1.3;
    const sky = daylight > 0.35
      ? this.skyColor.copy(this.duskColor).lerp(this.dayColor, (daylight - 0.35) / 0.65)
      : this.skyColor.copy(this.nightColor).lerp(this.duskColor, daylight / 0.35);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(sky);
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.copy(sky).lerp(this.fogDayColor, daylight * 0.34);
    // The gradient dome is what gives a wide shot something behind the ridgeline.
    this.skyZenith.copy(this.zenithNightColor).lerp(this.zenithDayColor, THREE.MathUtils.smoothstep(daylight, 0.05, 0.7));
    this.skyHorizon.copy(this.horizonNightColor).lerp(this.horizonDuskColor, THREE.MathUtils.smoothstep(daylight, 0.02, 0.42));
    this.skyHorizon.lerp(this.horizonDayColor, THREE.MathUtils.smoothstep(daylight, 0.4, 0.86));
    this.skyAtmosphere.setPalette(this.skyZenith, this.skyHorizon);
    this.skyAtmosphere.setCloudTint(this.skyHorizon);
    this.sun.color.copy(this.sunLowColor).lerp(this.sunHighColor, Math.min(1, daylight * 1.45));
    const night = 1 - daylight;
    this.assetBuilder.setNightFactor(night);
    for (const palette of this.palettesByCultureEra.values()) palette.setNightFactor(night);
    const flickerTime = elapsedSeconds * 8.6;
    let lampIndex = 0;
    for (const visual of this.settlementVisuals.values()) {
      for (const entry of visual.lights) {
        lampIndex += 1;
        const wobble = entry.flicker > 0
          ? 1 + entry.flicker * Math.sin(flickerTime + lampIndex * 2.17) * Math.sin(flickerTime * 0.73 + lampIndex * 1.37)
          : 1;
        entry.light.intensity = night * entry.base * wobble * (1 + visual.powerLevel * 1.9);
      }
    }
  }

  private updateAdvancedAtmosphere(elapsedSeconds: number): void {
    if (this.lastCatastropheHistoryLength !== this.state.history.length || this.lastCatastropheMonth !== this.state.month) {
      this.latestCatastrophe = undefined;
      for (let index = this.state.history.length - 1; index >= 0; index -= 1) {
        const candidate = this.state.history[index];
        if (!candidate || this.state.month - candidate.month > 36) break;
        if (candidate.type === 'nuclear-use' || candidate.type === 'nuclear-exchange' || candidate.type === 'natural-catastrophe' && !candidate.tags.includes('weather')) {
          this.latestCatastrophe = candidate;
          break;
        }
      }
      this.lastCatastropheHistoryLength = this.state.history.length;
      this.lastCatastropheMonth = this.state.month;
    }
    const event = this.latestCatastrophe;
    const age = event ? Math.max(0, this.state.month - event.month) : Number.POSITIVE_INFINITY;
    const severity = event?.type === 'nuclear-exchange' ? 1 : event?.type === 'nuclear-use' ? 0.38 : event ? 0.62 : 0;
    const aftermath = severity * Math.max(0, 1 - age / 36);
    this.renderer.toneMappingExposure = 1.12 - aftermath * 0.34;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = 0.0072 + aftermath * 0.017;
      if (aftermath > 0) this.scene.fog.color.lerp(this.aftermathColor, aftermath * 0.68);
    }
    const material = this.atmosphere.material;
    if (material instanceof THREE.PointsMaterial) material.opacity = 0.55 - aftermath * 0.34;
    if (event?.location) {
      this.catastropheLight.position.set(event.location.x, this.elevationAt(event.location.x, event.location.z) + 7, event.location.z);
    }
    const flashWindow = age <= 2 && severity > 0 ? 1 : 0;
    this.catastropheLight.intensity = flashWindow * severity * Math.max(0, Math.sin(elapsedSeconds * 2.7) ** 18) * 46;
  }

  private dominantCulture(settlement: Settlement): Culture | undefined {
    const id = Object.entries(settlement.cultureShares).sort((a, b) => b[1] - a[1])[0]?.[0];
    return id ? this.cultureById.get(id) : undefined;
  }

  private elevationAt(x: number, z: number): number {
    return this.terrainSurface.heightAt(x, z);
  }

  getPlacementSmokeReport(): PlacementSmokeReport {
    const persistentFootprints = this.placementFootprints.getFootprintsByKind('building').filter((footprint) => footprint.persistent);
    const persistentBuildings = persistentFootprints.length;
    let underwaterBuildings = 0;
    let driftedBuildings = 0;
    for (const footprint of persistentFootprints) {
      const samples = [{ x: footprint.worldX, z: footprint.worldZ }, ...Array.from({ length: 12 }, (_, index) => {
        const angle = index / 12 * Math.PI * 2;
        return { x: footprint.worldX + Math.cos(angle) * footprint.radius, z: footprint.worldZ + Math.sin(angle) * footprint.radius };
      })];
      if (samples.some((point) => this.terrainQueries.queryTerrainAt(point.x, point.z)?.water)) underwaterBuildings += 1;
    }
    for (const [settlementId, placements] of this.settlementBuildingPlacements) {
      const visual = this.settlementVisuals.get(settlementId);
      for (const placement of placements) {
        if (!visual) continue;
        const mesh = visual.group.children.find((child) => child.userData['placementKey'] === placement.key);
        if (!mesh) continue;
        const worldPosition = new THREE.Vector3();
        mesh.getWorldPosition(worldPosition);
        if (Math.hypot(worldPosition.x - placement.worldX, worldPosition.z - placement.worldZ) > 0.001) driftedBuildings += 1;
      }
    }

    let underwaterVegetation = 0;
    for (const placement of this.vegetationPlacements) {
      const terrain = this.terrainQueries.queryTerrainAt(placement.worldX, placement.worldZ);
      if (terrain?.water) underwaterVegetation += 1;
    }

    const routeReports = Array.from(this.routePlacementReports.values());
    const waterCrossings = routeReports.filter((report) => report.mode === 'land' && report.waterSamples > 0).length;
    const unresolvedCrossings = routeReports.filter((report) => report.mode === 'land' && report.waterSamples > 0 && report.bridgeSegments === 0).length;
    const maxTerrainError = routeReports.reduce((max, report) => Math.max(max, report.maxTerrainError), 0);
    const roadGradeViolations = routeReports.filter((report) => report.mode === 'land' && !report.railSupported).reduce((sum, report) => sum + report.gradeViolations, 0);
    const railGradeViolations = routeReports.filter((report) => report.mode === 'land' && report.railSupported).reduce((sum, report) => sum + report.gradeViolations, 0);

    this.refreshVisiblePeople();
    let underwaterPeople = 0;
    let invalidPersonRoutes = 0;
    let peopleInsideBuildings = 0;
    let outOfScalePeople = 0;
    let validCrossings = 0;
    for (const person of this.state.people) {
      const crossing = person.navigation?.crossingMode;
      const explicitWaterCrossing = person.navigation?.traveling === true && (crossing === 'boat' || crossing === 'ferry');
      const terrain = this.terrainQueries.queryTerrainAt(person.position.x, person.position.z);
      if (terrain?.water && !explicitWaterCrossing) underwaterPeople += 1;
      if (explicitWaterCrossing) validCrossings += 1;
      if (!explicitWaterCrossing && !this.personRouteAvoidsWater(person)) invalidPersonRoutes += 1;
      const height = person.appearance?.heightScale ?? 1;
      const build = person.appearance?.buildScale ?? 1;
      // Authoritative adult range is ~0.85-1.15x canonical height; anything outside that (plus a
      // small float-safety margin) is an extreme-scale regression, not deterministic variation.
      if (height < 0.84 || height > 1.16 || build < 0.8 || build > 1.2) outOfScalePeople += 1;
      const display = this.resolvePersonRenderPosition(person);
      const placements = this.settlementBuildingPlacements.get(person.homeId) ?? [];
      if (placements.some((placement) => Math.hypot(display.x - placement.worldX, display.z - placement.worldZ) < Math.max(placement.width, placement.depth) * 0.5 + 0.12)) peopleInsideBuildings += 1;
    }

    return {
      buildings: { persistent: persistentBuildings, underwater: underwaterBuildings, drifted: driftedBuildings },
      people: { represented: this.state.people.length, visible: this.visiblePeople.length, underwater: underwaterPeople, invalidRoutes: invalidPersonRoutes, insideBuildings: peopleInsideBuildings, outOfScale: outOfScalePeople, validCrossings },
      vegetation: { placed: this.vegetationPlacements.length, underwater: underwaterVegetation },
      routes: { active: routeReports.length, waterCrossings, unresolvedCrossings, maxTerrainError, roadGradeViolations, railGradeViolations },
    };
  }

  private personRouteAvoidsWater(person: Person): boolean {
    const navigation = person.navigation;
    const points: readonly Vec2[] = navigation?.traveling
      ? [person.position, ...navigation.waypoints.slice(navigation.waypointIndex)]
      : navigation?.waypoints ?? [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      if (this.terrainQueries.queryTerrainAt(point.x, point.z)?.water) return false;
      const previous = points[index - 1];
      if (!previous) continue;
      const length = Math.hypot(point.x - previous.x, point.z - previous.z);
      const samples = Math.max(1, Math.ceil(length / (this.state.world.cellSize * 0.28)));
      for (let sample = 1; sample < samples; sample += 1) {
        const t = sample / samples;
        if (this.terrainQueries.queryTerrainAt(previous.x + (point.x - previous.x) * t, previous.z + (point.z - previous.z) * t)?.water) return false;
      }
    }
    return true;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      } else if (child instanceof THREE.Group) this.disposeGroup(child);
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        // Cached building geometry and palette materials are shared between every instance,
        // so tearing down one settlement must not free them.
        if (!object.geometry.userData['shared']) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material.userData['shared']) material.dispose();
        }
      }
    });
  }

  dispose(): void {
    this.weatherRenderer.dispose();
    window.removeEventListener('resize', this.resizeHandler);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.terrainQueries.dispose();
    this.placementContract.dispose();
    this.placementFootprints.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnit(value: string): number {
  return stableHash(value) / 0xffffffff;
}
