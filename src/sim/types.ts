import type { TerrainField, WorldLandmark } from './terrain/TerrainField';
import type { WaterDepthState } from './terrain/SurfaceGeometry';
import type { RouteTransport, TransportationState } from './transport/types';
import type { SettlementDevelopment, StructureDevelopment } from './development/types';
import type { ForestCommunity, Geology, LandModification, ModificationKind, Soil } from './environment/types';

export type { LandmarkKind, TerrainField, WorldLandmark } from './terrain/TerrainField';

export interface Vec2 {
  x: number;
  z: number;
}

export type Biome = 'water' | 'wetland' | 'grassland' | 'forest' | 'dryland' | 'highland' | 'mountain';

/** Geomorphology of a cell. Biome says what grows there; landform says what shape it is. */
export type Landform =
  | 'ocean'
  | 'shore'
  | 'lowland'
  | 'basin'
  | 'valley'
  | 'hill'
  | 'plateau'
  | 'ridge'
  | 'peak'
  | 'canyon';

export interface WorldCell {
  geology?: Geology;
  soil?: Soil;
  ecology?: ForestCommunity;
  modifications?: Partial<Record<ModificationKind, LandModification>>;
  x: number;
  z: number;
  worldX: number;
  worldZ: number;
  elevation: number;
  moisture: number;
  temperature: number;
  fertility: number;
  wood: number;
  /** Authoritative forest standing stock; WeatherSystem owns slow regrowth. */
  forestCapacity?: number;
  lastLoggingMonth?: number;
  minerals: number;
  habitability: number;
  movementCost: number;
  water: boolean;
  coast: boolean;
  river: boolean;
  /** Standing inland water rather than ocean. */
  lake: boolean;
  /** 0..1 normalised steepness of the ground. */
  slope: number;
  /** 0..1 elevation range within a short radius; high where the land is dramatic. */
  relief: number;
  /** 0..1 river discharge routed through this cell. */
  flow: number;
  /** 0..1 exposed rock and scree. */
  rockiness: number;
  landform: Landform;
  biome: Biome;
}

export interface WorldState {
  size: number;
  cellSize: number;
  cells: WorldCell[];
  /** High-resolution sculpted surface the renderer meshes. */
  terrain: TerrainField;
  landmarks: readonly WorldLandmark[];
  seaLevel: number;
  mountainLevel: number;
  weather?: WeatherState;
  environmentRevision?: number;
  /** Geographically sited raw-material deposits; see src/sim/resources. */
  resourceDeposits: ResourceDeposit[];
}

/**
 * A physically sited pocket of a raw resource (herb stand, forest stand, ore body, quarry face).
 * Deposits are generated once, deterministically, from world cells at world-gen time. Settlements
 * must discover them before they can be worked, and non-renewable deposits are consumed by use.
 */
export interface ResourceDeposit {
  /** A connected province; optional only for old/custom single-cell fixtures. */
  cells?: Array<{ cellIndex: number; capacity: number; quality: number }>;
  provinceName?: string;
  depth?: number;
  exposure?: number;
  extractionDifficulty?: number;
  extracted?: number;
  expansionRecorded?: boolean;
  deforestationRecorded?: boolean;
  /** Surveyed dry carrying paths retained after abandonment. */
  accessTrails?: Vec2[][];
  id: string;
  resourceId: string;
  cellIndex: number;
  worldX: number;
  worldZ: number;
  /** 0..1 intrinsic richness/purity of this deposit, fixed at generation. */
  quality: number;
  /** Absolute local ceiling: original size for depletable deposits, sustainable standing stock for renewables. */
  capacity: number;
  /** Remaining share of capacity, 0..1. Renewables regenerate toward 1; non-renewables only fall. */
  abundance: number;
  renewable: boolean;
  depleted: boolean;
  /** Renewable deposits harvested faster than they regenerate accrue lasting ecological damage. */
  overharvested: boolean;
  /** SettlementId -> month first discovered. */
  discoveredBy: Record<string, number>;
  controlledBy?: string;
  establishedMonth?: number;
  lastWorkedMonth?: number;
  /** Fraction of the original body accessible to surface gathering. */
  surfaceShare?: number;
  accessibility?: number;
  abandonedMonth?: number;
}

/** Settlement stockpile of specific gathered/crafted materials, keyed by resource or recipe-output id. */
export type MaterialInventory = Record<string, number>;

export interface MaterialShipment {
  networkPath?: import('./transport/types').TraversalPath;
  accessPaths?: Vec2[][];
  depositId: string;
  resourceId: string;
  quantity: number;
  quality: number;
  path: Vec2[];
  remainingMonths: number;
}

/** Serialized material accounting; recipes and resource experience survive reload/replay. */
export interface MaterialEconomy {
  quality: Record<string, number>;
  experience: Record<string, number>;
  recipeResearch: Record<string, number>;
  inTransit: MaterialShipment[];
  demand: Record<string, number>;
  imports: Record<string, number>;
  delivered: Record<string, number>;
  lastEventMonth: Record<string, number>;
  bulkSnapshot: { wood: number; minerals: number };
  tools: number;
  arms: number;
  timberArms: number;
  medicineCoverage: number;
  energyDemand: number;
  energySupplied: number;
  labourUsed: number;
  shortageMonths: number;
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'heavy-rain' | 'snow' | 'heavy-snow' | 'thunderstorm' | 'windstorm' | 'tornado' | 'hurricane';
export type WeatherPrecipitation = 'none' | 'rain' | 'snow' | 'mixed';

export interface WeatherDescriptor {
  kind: WeatherKind;
  intensity: number;
  wind: number;
  precipitation: WeatherPrecipitation;
  /** Liquid-equivalent fraction falling as snow; absent on legacy descriptors. */
  snowFraction?: number;
}

export interface WeatherCellState extends WeatherDescriptor {
  x: number;
  z: number;
  confidence: number;
  durationMonths: number;
  temperature: number;
  windX: number;
  windZ: number;
  snowpack: number;
  blizzard: number;
  snowMonths: number;
  cropDamage: number;
  travelPenalty: number;
  runoff: number;
  floodRisk: number;
  floodDepth: number;
  waterDepth: number;
  floodState: WaterDepthState;
  floodMonths: number;
  treeDamage: number;
  lastWindthrowMonth: number;
}

export interface WeatherFront extends WeatherDescriptor {
  id: string;
  x: number;
  z: number;
  radius: number;
  directionX: number;
  directionZ: number;
  velocity: number;
  lifespan: number;
  ageMonths: number;
  severity: number;
}

export interface WeatherState {
  month: number;
  wind: number;
  windX: number;
  windZ: number;
  fronts: WeatherFront[];
  cells: WeatherCellState[];
  tornadoes: TornadoState[];
  forestScars: TornadoState[];
  lightning?: Array<{ id: string; month: number; x: number; z: number; intensity: number }>;
}

export interface TornadoState {
  id: string;
  frontId: string;
  month: number;
  intensity: number;
  width: number;
  speed: number;
  lifetimeHours: number;
  direction: Vec2;
  path: Vec2[];
}

export interface Traits {
  curiosity: number;
  cooperation: number;
  sociability: number;
  aggression: number;
  ambition: number;
  riskTolerance: number;
  empathy: number;
  conformity: number;
  courage: number;
  patience: number;
  conscientiousness: number;
  loyalty: number;
}

export interface MoralValues {
  care: number;
  fairness: number;
  groupLoyalty: number;
  authority: number;
  tradition: number;
  autonomy: number;
  violenceTolerance: number;
  corruptionTolerance: number;
  outsiderConcern: number;
  stewardship: number;
  futureGenerations: number;
}

export interface PersonalPressures {
  hunger: number;
  safety: number;
  shelter: number;
  livelihood: number;
  family: number;
  status: number;
  belonging: number;
}

export type Activity =
  | 'gather'
  | 'farm'
  | 'craft'
  | 'construct'
  | 'transport'
  | 'trade'
  | 'study'
  | 'worship'
  | 'patrol'
  | 'assist'
  | 'shelter'
  | 'flee'
  | 'rest'
  | 'socialize'
  | 'travel'
  | 'migrate';
export type Occupation = 'farmer' | 'forager' | 'builder' | 'artisan' | 'carrier' | 'keeper' | 'child' | 'elder';

/** Specific social role layered over the stable economic occupation buckets. */
export type PersonRole =
  | 'child'
  | 'elder'
  | 'gatherer'
  | 'hunter'
  | 'farmer'
  | 'fisher'
  | 'laborer'
  | 'builder'
  | 'craft-worker'
  | 'ritual-specialist'
  | 'trader'
  | 'miner'
  | 'soldier'
  | 'guard'
  | 'administrator'
  | 'scholar'
  | 'healer'
  | 'priest'
  | 'sailor'
  | 'transporter'
  | 'factory-worker'
  | 'engineer'
  | 'machinist'
  | 'railway-worker'
  | 'merchant'
  | 'manager'
  | 'scientist'
  | 'dock-worker'
  | 'researcher'
  | 'energy-technician'
  | 'medical-worker'
  | 'logistics-worker'
  | 'machine-systems-specialist'
  | 'space-worker';

export type DestinationKind =
  | 'home'
  | 'field'
  | 'workshop'
  | 'market'
  | 'plaza'
  | 'shrine'
  | 'civic-building'
  | 'construction-site'
  | 'station'
  | 'dock'
  | 'warehouse'
  | 'industrial-site'
  | 'knowledge-institution'
  | 'patrol-route'
  | 'safe-area';

export type SchedulePhase = 'home' | 'commute' | 'work' | 'meal' | 'social' | 'ritual' | 'emergency';

export interface PersonNavigation {
  destinationKind: DestinationKind;
  destinationId: string;
  reason: string;
  waypoints: Vec2[];
  waypointIndex: number;
  schedulePhase: SchedulePhase;
  traveling: boolean;
  /** Water is legal only while explicitly represented by ferry/boat transport. */
  crossingMode?: 'walk' | 'bridge' | 'ferry' | 'boat' | 'rail';
}

export interface PersonAppearance {
  heightScale: number;
  buildScale: number;
  posture: number;
  garment: 'simple' | 'workwear' | 'layered' | 'ceremonial' | 'uniform' | 'technical';
  headwear: 'none' | 'wrap' | 'brim' | 'cap' | 'helmet';
  carriedItem: 'none' | 'hoe' | 'hammer' | 'basket' | 'staff' | 'ledger' | 'toolkit' | 'bag';
  textilePattern: CultureStyle['pattern'];
  materialQuality: number;
}

export interface SocialPosition {
  householdWealth: number;
  resourceAccess: number;
  occupationStatus: number;
  educationAccess: number;
  politicalInfluence: number;
  institutionalPosition: number;
}

export interface PersonalInfluence {
  office: number;
  wealth: number;
  military: number;
  scholarship: number;
  religion: number;
  network: number;
  reputation: number;
  total: number;
}

export interface IdeaStance {
  ideaId: string;
  support: number;
  encounteredMonth: number;
  lastDiscussedMonth: number;
}

export interface HistoricalIdentity {
  status: 'ordinary' | 'notable' | 'historical';
  score: number;
  reasons: string[];
  eventIds: string[];
  promotedMonth?: number;
}

export interface Person {
  id: string;
  name: string;
  sex: 'female' | 'male';
  ageMonths: number;
  bornMonth: number;
  parents: string[];
  children: string[];
  partnerId?: string;
  householdId: string;
  homeId: string;
  cultureId: string;
  position: Vec2;
  target: Vec2;
  occupation: Occupation;
  activity: Activity;
  institutionId?: string;
  health: number;
  energy: number;
  prestige: number;
  traits: Traits;
  alive: boolean;
  role?: PersonRole;
  workplaceId?: string;
  values?: MoralValues;
  pressures?: PersonalPressures;
  appearance?: PersonAppearance;
  socialPosition?: SocialPosition;
  influence?: PersonalInfluence;
  ideas?: IdeaStance[];
  navigation?: PersonNavigation;
  historical?: HistoricalIdentity;
}

export interface Household {
  id: string;
  settlementId: string;
  homePosition: Vec2;
  memberIds: string[];
  wealth: number;
  foodSecurity: number;
  socialStanding: number;
  materialQuality: number;
  occupationMix: Partial<Record<Occupation, number>>;
  active: boolean;
}

export type SocialRelationshipKind = 'family' | 'colleague' | 'friend' | 'rival' | 'mentor' | 'superior' | 'political-ally' | 'intellectual-collaborator' | 'neighbor';

export interface SocialRelationship {
  id: string;
  a: string;
  b: string;
  kind: SocialRelationshipKind;
  trust: number;
  strength: number;
  formedMonth: number;
  lastContactMonth: number;
}

export type IdeaTopic = 'technology' | 'religion' | 'government' | 'trade' | 'social-organization' | 'war' | 'peace' | 'science' | 'reform' | 'tradition' | 'environment' | 'machine-intelligence' | 'space' | 'fermi-hypothesis';
export type IdeaStatus = 'emerging' | 'spreading' | 'adopted' | 'rejected' | 'suppressed' | 'dormant';

export interface SocialIdea {
  id: string;
  conceptId: string;
  name: string;
  topic: IdeaTopic;
  settlementId: string;
  originatorId: string;
  institutionId?: string;
  originatedMonth: number;
  status: IdeaStatus;
  support: number;
  opposition: number;
  reach: number;
  momentum: number;
  generation: number;
  parentIdeaId?: string;
  lastChangedMonth: number;
}

export interface ResourceStock {
  food: number;
  wood: number;
  minerals: number;
  goods: number;
  wealth: number;
}

export interface PoliticalPower {
  personalPrestige: number;
  kinship: number;
  military: number;
  religious: number;
  merchant: number;
  council: number;
  institutional: number;
  wealth: number;
}

export type KnowledgeDomain = 'agriculture' | 'materials' | 'navigation' | 'records' | 'medicine' | 'mechanics' | 'energy' | 'manufacturing' | 'chemistry' | 'transport' | 'physics' | 'computation' | 'biology' | 'aerospace';
export type KnowledgeKind = 'understanding' | 'practice' | 'capability';

export interface KnowledgeRecord {
  id: string;
  theory: number;
  practice: number;
  discoveredMonth: number;
  lastUsedMonth: number;
  originSettlementId: string;
  lineageId: string;
  parentLineages: string[];
  source: 'inheritance' | 'discovery' | 'diffusion' | 'rediscovery' | 'conquest';
  dormant: boolean;
  /** Discovery records the idea; these dates record when communities can use it broadly. */
  adoptedMonth?: number;
  transformedMonth?: number;
  attributedPersonId?: string;
  institutionId?: string;
}

export interface LostKnowledgeRecord {
  id: string;
  lostMonth: number;
  peakTheory: number;
  peakPractice: number;
  lineageId: string;
  reason: string;
}

export interface KnowledgePortfolio {
  records: Record<string, KnowledgeRecord>;
  lost: Record<string, LostKnowledgeRecord>;
  experimentation: Record<KnowledgeDomain, number>;
  exposure: Record<string, number>;
  literacy: number;
  preservation: number;
}

export interface InfrastructureState {
  roads: number;
  ports: number;
  bridges: number;
  workshops: number;
  archives: number;
  rail: number;
  power: number;
  factories: number;
}

export interface IndustrialState {
  active: boolean;
  intensity: number;
  startedMonth?: number;
  stage: 'pre-industrial' | 'experimental-engines' | 'specialist-workshops' | 'commercial-machinery' | 'transport-integration' | 'industrial-transformation';
  stageStartedMonth?: number;
  stageProgress: number;
  route: string[];
  routeName?: string;
  vulnerableInputs: string[];
}

export interface Settlement {
  id: string;
  development?: SettlementDevelopment;
  structurePlots?: StructurePlot[];
  structurePlotTarget?: number;
  weatherRecoverySince?: number;
  lastSnowEventMonth?: number;
  name: string;
  position: Vec2;
  cellIndex: number;
  foundedMonth: number;
  cultureShares: Record<string, number>;
  resources: ResourceStock;
  monthlyBalance: ResourceStock;
  buildings: number;
  targetBuildings: number;
  constructionProgress: number;
  specialization: 'agriculture' | 'forestry' | 'mining' | 'craft' | 'exchange';
  foodSecurity: number;
  prosperity: number;
  knowledge: KnowledgePortfolio;
  infrastructure: InfrastructureState;
  industry: IndustrialState;
  pollution: number;
  urbanization: number;
  climateStress: number;
  conflictPressure: number;
  crisisMonths: number;
  depopulationMonths: number;
  politicalPower: PoliticalPower;
  polityId: string;
  institutionIds: string[];
  alive: boolean;
  /** Gathered raw materials and crafted goods from the resource/recipe system. */
  materials: MaterialInventory;
  /** Deposit IDs this settlement has found (may or may not still be workable). */
  discoveredDeposits: string[];
  /** Deposit IDs this settlement is actively extracting from. */
  workedDeposits: string[];
  /** Recipe IDs this settlement has successfully produced at least once. */
  knownRecipes: string[];
  materialEconomy?: MaterialEconomy;
}

export interface StructurePlot {
  id: string;
  development?: StructureDevelopment;
  worldX: number;
  worldZ: number;
  radius: number;
  width: number;
  height: number;
  depth: number;
  condition: number;
  foundedMonth: number;
  damagedMonth?: number;
  floodDepth?: number;
  floodMonths?: number;
  accessRestricted?: boolean;
  fire?: StructureFire;
  /** Retained after extinction; repair removes char, ground scars weather slowly. */
  char?: number;
  scorch?: number;
}

export type FireCause = 'accident' | 'lightning' | 'attack' | 'spread' | 'sabotage' | 'wildfire' | 'developer';
export type FireStage = 'ignition' | 'growing' | 'involved' | 'weakening' | 'smouldering';
export interface StructureFire {
  cause: FireCause;
  startedMonth: number;
  age: number;
  stage: FireStage;
  intensity: number;
  fuel: number;
  initialFuel: number;
  smoulderMonths: number;
}

export interface CultureDimensions {
  cooperation: number;
  hierarchy: number;
  militarism: number;
  tradeOrientation: number;
  curiosity: number;
  religiousTendency: number;
  institutionalTrust: number;
  outsiderOpenness: number;
  longTermOrientation: number;
}

export interface CultureStyle {
  primary: string;
  secondary: string;
  accent: string;
  symbol: 'sun-step' | 'river-eye' | 'woven-moon' | 'mountain-knot' | 'seed-spiral';
  pattern: 'chevron' | 'diamond' | 'terrace' | 'crossweave' | 'wave';
  nameSyllables: string[];
}

export interface Culture {
  id: string;
  name: string;
  dimensions: CultureDimensions;
  style: CultureStyle;
  memory: {
    tradeSuccess: number;
    collectiveSuccess: number;
    frontierViolence: number;
    militarySuccess: number;
  };
}

export type InstitutionKind = 'council' | 'temple' | 'merchant-association' | 'military-order' | 'craft-circle' | 'knowledge-keepers';

export interface Institution {
  id: string;
  name: string;
  kind: InstitutionKind;
  settlementId: string;
  cultureId: string;
  foundedMonth: number;
  support: number;
  prestige: number;
  resources: number;
  reach: number;
  members: number;
  interests: string[];
}

export interface Relation {
  id: string;
  a: string;
  b: string;
  contact: boolean;
  firstContactMonth?: number;
  trust: number;
  hostility: number;
  tradeDependency: number;
  culturalAffinity: number;
  grievances: number;
  territorialTension: number;
  allianceObligation: number;
  allied: boolean;
}

export interface TradeRoute {
  id: string;
  transport?: RouteTransport;
  weatherBlocked?: boolean;
  a: string;
  b: string;
  volume: number;
  ageMonths: number;
  caravanProgress: number;
  caravanDirection: 1 | -1;
  mode: 'land' | 'water';
  knowledgeFlow: number;
  cumulativeKnowledge: number;
  active: boolean;
}

export type WarCause = 'resource-pressure' | 'territorial-dispute' | 'retaliation' | 'political-ambition' | 'alliance-commitment';

export interface WarCampaign {
  /** Surveyed dry-ground corridor, shared by simulation, camera and animation. */
  route: Vec2[];
  distance: number;
  marchMonths: number;
  phaseSinceMonth: number;
  battleCount: number;
  supplyA: number;
  supplyB: number;
  exhaustionA: number;
  exhaustionB: number;
  blockedMonths: number;
  battleStartedMonth?: number;
  lastBattleMonth?: number;
  initialStrengthA: number;
  initialStrengthB: number;
  dispatches: string[];
  advantage: -1 | 0 | 1;
}

export interface War {
  id: string;
  attacker: string;
  defender: string;
  cause: WarCause;
  startMonth: number;
  strengthA: number;
  strengthB: number;
  casualtiesA: number;
  casualtiesB: number;
  progress: number;
  phase: 'mobilizing' | 'marching' | 'battle' | 'retreat' | 'occupation' | 'negotiation';
  marchProgress: number;
  moraleA: number;
  moraleB: number;
  organizationA: number;
  organizationB: number;
  leadershipA: number;
  leadershipB: number;
  technologyA: number;
  technologyB: number;
  leaderAId?: string;
  leaderBId?: string;
  resolvedMonth?: number;
  campaign: WarCampaign;
  resolutionReason?: 'decision' | 'exhaustion' | 'impassable' | 'settlement-lost';
  active: boolean;
}

export interface Polity {
  id: string;
  name: string;
  settlementIds: string[];
  capitalId: string;
  formedMonth: number;
  lastTransitionMonth: number;
  arrangement: string;
  legitimacy: number;
  leadingPersonId?: string;
  phase: 'formation' | 'consolidation' | 'mature' | 'stressed' | 'declining';
  phaseSinceMonth: number;
  stability: number;
  dynastyHouseholdId?: string;
  dynastyName?: string;
  dynastyStartedMonth?: number;
  successionCount: number;
}

export type CivilizationScale = 'individual' | 'urban-industrial' | 'modern-statistical';
export type AdvancedSector = 'science' | 'energy' | 'health' | 'industry' | 'information' | 'aerospace' | 'defense' | 'biotechnology' | 'automation';
export type AdvancedInstitutionKind = 'research-network' | 'public-health-network' | 'atomic-regulator' | 'communications-network' | 'space-program' | 'machine-governance-body';
export type ExistentialRiskKind = 'nuclear-conflict' | 'pandemic' | 'ecological-overshoot' | 'climate-destabilization' | 'resource-stress' | 'autonomous-weapons' | 'machine-transition' | 'asteroid-impact' | 'supervolcanism' | 'political-fragmentation';
export type OutcomeClassification = 'EXTINCT' | 'COLLAPSED' | 'STAGNANT' | 'PLANETARY STABLE' | 'INTERPLANETARY' | 'POST-BIOLOGICAL' | 'UNKNOWN';
export type NuclearStrategicPhase = 'none' | 'atomic-monopoly' | 'stable-deterrence' | 'arms-competition' | 'negotiated-restraint' | 'disarmament' | 'crisis';
export type NuclearDoctrine = 'no-first-use' | 'minimum-deterrence' | 'retaliatory' | 'launch-on-warning' | 'war-fighting';
export type FermiHypothesis = 'intelligent-life-rare' | 'self-destruction' | 'interstellar-travel-impractical' | 'advanced-civilizations-quiet' | 'civilization-is-early' | 'observers-remain-hidden';

export interface StatisticalCohorts {
  children: number;
  workingAge: number;
  elders: number;
  biologicalShare: number;
}

export interface CityAggregate {
  settlementId: string;
  population: number;
  health: number;
  education: number;
  productivity: number;
  infrastructureReliability: number;
  emissions: number;
  resilience: number;
}

export interface StateAggregate {
  polityId: string;
  population: number;
  institutionalCapacity: number;
  publicTrust: number;
  riskTolerance: number;
  scientificCapacity: number;
  militaryPressure: number;
}

export interface AdvancedInstitution {
  id: string;
  kind: AdvancedInstitutionKind;
  foundedMonth: number;
  capacity: number;
  reliability: number;
  reach: number;
}

export interface NuclearPosture {
  polityId: string;
  programLevel: number;
  arsenalScale: number;
  survivability: number;
  warningReliability: number;
  commandControlReliability: number;
  riskTolerance: number;
  doctrine: NuclearDoctrine;
  weaponizedMonth?: number;
}

export interface ExistentialRiskPressure {
  kind: ExistentialRiskKind;
  hazard: number;
  vulnerability: number;
  mitigation: number;
  annualProbability: number;
  active: boolean;
  lastEventMonth?: number;
}

export interface AdvancedCivilizationState {
  scale: CivilizationScale;
  transitionMonth?: number;
  representedPopulation: number;
  peakRepresentedPopulation: number;
  cohorts: StatisticalCohorts;
  cities: CityAggregate[];
  states: StateAggregate[];
  sectors: Record<AdvancedSector, number>;
  institutions: AdvancedInstitution[];
  governance: {
    coordination: number;
    institutionalCapacity: number;
    fragmentation: number;
    publicTrust: number;
  };
  developmentPriorities: {
    space: number;
    machine: number;
    welfare: number;
    defense: number;
  };
  environment: {
    emissions: number;
    climateStress: number;
    ecologicalPressure: number;
    resourcePressure: number;
  };
  atomic: {
    thresholdMonth?: number;
    applications: { energy: number; medicine: number; research: number; propulsion: number; weaponry: number };
    postures: NuclearPosture[];
    nuclearUseCount: number;
    majorExchangeCount: number;
  };
  strategic: {
    phase: NuclearStrategicPhase;
    crisisIntensity: number;
    armsCompetitionYears: number;
    restraintYears: number;
  };
  machine: {
    capability: number;
    scienceIntegration: number;
    economicAutomation: number;
    governanceIntegration: number;
    militaryAutonomy: number;
    alignmentReliability: number;
    observability: number;
  };
  space: {
    satellites: number;
    orbitalInfrastructure: number;
    lunarActivity: number;
    offworldSettlements: number;
    interplanetaryPopulation: number;
    selfSustainingBodies: number;
    resourceActivity: number;
  };
  fermi: {
    recognizedMonth?: number;
    hypotheses: FermiHypothesis[];
    setiInvestment: number;
    broadcasting: number;
    securityCaution: number;
    spaceInvestment: number;
  };
  risks: Record<ExistentialRiskKind, ExistentialRiskPressure>;
  outcome: {
    classification: OutcomeClassification | null;
    classifiedMonth?: number;
    confidence: number;
    rationale: string[];
  };
  technologicalPeak: number;
  lastMajorCapabilityMonth: number;
  collapseDurationMonths: number;
  resilientDurationMonths: number;
}

export type HistoricalEventType =
  | 'world-awakening'
  | 'birth'
  | 'death'
  | 'settlement-founded'
  | 'settlement-abandoned'
  | 'major-migration'
  | 'first-contact'
  | 'trade-route-established'
  | 'knowledge-exchange'
  | 'discovery'
  | 'knowledge-lost'
  | 'knowledge-rediscovered'
  | 'knowledge-adopted'
  | 'technology-transformation'
  | 'technology-widespread'
  | 'infrastructure-built'
  | 'archive-destroyed'
  | 'industrialization'
  | 'industrialization-stage'
  | 'institution-formed'
  | 'alliance-formed'
  | 'alliance-ended'
  | 'war-declared'
  | 'war-campaign'
  | 'battle'
  | 'war-ended'
  | 'political-transition'
  | 'leadership-succession'
  | 'cultural-shift'
  | 'harvest-crisis'
  | 'recovery'
  | 'statistical-transition'
  | 'atomic-threshold'
  | 'nuclear-energy'
  | 'nuclear-medicine'
  | 'nuclear-weapons-developed'
  | 'nuclear-restraint'
  | 'nuclear-disarmament'
  | 'nuclear-crisis'
  | 'nuclear-use'
  | 'nuclear-exchange'
  | 'pandemic'
  | 'ecological-crisis'
  | 'climate-crisis'
  | 'resource-crisis'
  | 'resource-deposit-discovered'
  | 'resource-site-established'
  | 'resource-depleted'
  | 'recipe-learned'
  | 'resource-site-abandoned'
  | 'resource-trade'
  | 'autonomous-weapons-crisis'
  | 'machine-intelligence-transition'
  | 'first-orbit'
  | 'offworld-settlement'
  | 'interplanetary-transition'
  | 'fermi-question'
  | 'fermi-hypothesis'
  | 'natural-catastrophe'
  | 'civilization-collapse'
  | 'civilization-recovery'
  | 'planetary-stability'
  | 'post-biological-transition'
  | 'observation-lost'
  | 'outcome-classified';

export interface HistoricalEvent {
  id: string;
  month: number;
  type: HistoricalEventType;
  location?: Vec2;
  locationId?: string;
  actors: string[];
  causes: string[];
  context: Record<string, string | number | boolean>;
  outcome: string;
  affectedPopulation: number;
  magnitude: number;
  significance: number;
  tags: string[];
  summary: string;
}

export interface SimulationStats {
  births: number;
  deaths: number;
  migrations: number;
  trades: number;
  knowledgeExchanges: number;
  discoveries: number;
  knowledgeLost: number;
  rediscoveries: number;
  knowledgeAdoptions: number;
  technologyTransformations: number;
  industrializations: number;
  wars: number;
  battles: number;
  peakPopulation: number;
  settlementsFounded: number;
  settlementsAbandoned: number;
  atomicThresholds: number;
  nuclearWeaponsStates: number;
  nuclearUses: number;
  nuclearWars: number;
  pandemics: number;
  firstOrbits: number;
  offworldSettlements: number;
  interplanetaryTransitions: number;
  postBiologicalTransitions: number;
  civilizationCollapses: number;
  existentialRiskEvents: number;
}

export interface SimulationState {
  engineVersion: string;
  seed: string;
  month: number;
  world: WorldState;
  weather: WeatherState;
  people: Person[];
  households?: Household[];
  socialRelationships?: SocialRelationship[];
  ideas?: SocialIdea[];
  settlements: Settlement[];
  cultures: Culture[];
  institutions: Institution[];
  relations: Relation[];
  tradeRoutes: TradeRoute[];
  transportation: TransportationState;
  wars: War[];
  polities: Polity[];
  history: HistoricalEvent[];
  stats: SimulationStats;
  advanced: AdvancedCivilizationState;
}
