import type { CultureStyle, ResourceStock } from '../types';

export const SETTLEMENT_NEEDS = ['food', 'housing', 'trade', 'government', 'security', 'religion', 'knowledge', 'healthcare', 'manufacturing', 'transport', 'energy', 'water', 'memory'] as const;
export type SettlementNeed = typeof SETTLEMENT_NEEDS[number];
/** Reusable physical arrangements, not a catalogue of named institutions. */
export type StructureForm = 'dwelling' | 'field' | 'store' | 'gathering' | 'hall' | 'sanctuary' | 'tower' | 'workshop' | 'works' | 'marker';
export type StructureMaterial = 'earth' | 'timber' | 'masonry' | 'ceramic' | 'metal';
export type ServiceSupply = Partial<Record<SettlementNeed, number>>;

export const DEVELOPMENT_BLOCK_CODES = [
  'response-unavailable',
  'no-builders',
  'insufficient-food',
  'insufficient-wood',
  'insufficient-minerals',
  'insufficient-goods',
  'insufficient-wealth',
  'fuel-reserve',
  'insufficient-structural-material',
  'insufficient-processed-material',
  'invalid-existing-plot',
  'no-valid-plot',
] as const;
export type DevelopmentBlockCode = typeof DEVELOPMENT_BLOCK_CODES[number];

/** One concrete reason a candidate structure could not begin during an annual development attempt. */
export interface DevelopmentBlocker {
  code: DevelopmentBlockCode;
  /** Generic budget channel when the blocker is a settlement resource shortage. */
  resource?: keyof ResourceStock;
  /** Physical material/component or requirement id when the blocker is material-specific. */
  material?: string;
  available?: number;
  required?: number;
  /** Compact deterministic context such as acceptable material substitutions or a plot id. */
  detail?: string;
}

/** Diagnostic trace for one unmet need considered during the annual project-start decision. */
export interface DevelopmentCandidateDecision {
  need: SettlementNeed;
  desiredLevel: number;
  responseName?: string;
  responseLevel?: number;
  action?: StructureHistoryEntry['action'];
  plotId?: string;
  blockers: DevelopmentBlocker[];
}

/**
 * The most recent annual project-start decision. This is observational state only: it records the
 * exact gates already used by SettlementDevelopmentSystem and must never introduce a new gate.
 */
export interface DevelopmentAttemptDecision {
  month: number;
  outcome: 'started' | 'blocked' | 'no-pressure';
  selectedNeed?: SettlementNeed;
  plotId?: string;
  candidates: DevelopmentCandidateDecision[];
}

export interface SettlementWaterState {
  /** Simulation month in which this state was last applied. */
  evaluatedMonth: number;
  /** 0..1 local water physically available from soil, rivers, lakes and current runoff. */
  availability: number;
  /** 0..1 ability to keep supplying water through seasonal and drought variation. */
  reliability: number;
  /** 0..1 fitness for domestic use after pollution, flooding and sanitation are considered. */
  quality: number;
  /** 0..1 practical irrigation capability that can stabilize crop output. */
  irrigation: number;
  /** 0..1 public-health protection from managed water and sanitation. */
  sanitation: number;
  /** 0..1 hydrologic scarcity pressure currently felt by the settlement. */
  droughtStress: number;
  /** 0..1 contamination pressure from floodwater mixing with settled land. */
  floodContamination: number;
  /** 0..1 access to nearby non-ocean surface water on the fine hydrology field. */
  surfaceAccess: number;
  /** Effective built water-storage / distribution service from active structures. */
  builtService: number;
  droughtMonths: number;
  lastCrisisMonth?: number;
  lastRecoveryMonth?: number;
}

export interface DevelopmentResponse {
  /** Small physical adaptations use worker-months, not the historical development index. */
  adaptation?: 'lean-to' | 'earth-shelter' | 'hut' | 'cache';
  temporary?: boolean;
  insulation?: number;
  need: SettlementNeed;
  form: StructureForm;
  name: string;
  level: number;
  material: StructureMaterial;
  cultureId: string;
  style: CultureStyle;
  institutionId?: string;
  services: ServiceSupply;
  reasons: string[];
  /** Practical capabilities observed when the response was selected. */
  capabilities: string[];
  cost: ResourceStock;
  /** Processed materials paid alongside ordinary construction budgets. */
  materialCost?: Record<string, number>;
  labor: number;
}

export interface StructureHistoryEntry {
  month: number;
  action: 'founded' | 'expanded' | 'upgraded' | 'repurposed' | 'abandoned' | 'ruined' | 'reused';
  name: string;
  need: SettlementNeed;
  cultureId: string;
  institutionId?: string;
  reasons: string[];
  form?: StructureForm;
  level?: number;
  material?: StructureMaterial;
}

export interface StructureDevelopment extends DevelopmentResponse {
  status: 'active' | 'abandoned' | 'ruin';
  origin: StructureHistoryEntry;
  /** Origin is permanent; the most recent twelve transitions are retained. */
  history: StructureHistoryEntry[];
  transitionCount: number;
  lastUsedMonth: number;
  underusedSince?: number;
}

export interface DevelopmentProject {
  blockedReasons?: string[];
  labourSpent?: number;
  lastWorkMonth?: number;
  plotId: string;
  response: DevelopmentResponse;
  action: StructureHistoryEntry['action'];
  startedMonth: number;
  progress: number;
  spent: ResourceStock;
}

export interface SettlementDevelopment {
  pressures: ServiceSupply;
  unmet: ServiceSupply;
  informal: ServiceSupply;
  providers: Partial<Record<SettlementNeed, string>>;
  evaluatedMonth: number;
  nextAttemptMonth: number;
  revision: number;
  /** Dynamic coupling between physical hydrology and civilization. Optional for old archives. */
  water?: SettlementWaterState;
  /** Latest annual explanation of why construction started or why every candidate was blocked. */
  lastAttempt?: DevelopmentAttemptDecision;
  project?: DevelopmentProject;
}
