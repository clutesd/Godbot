import type { CultureStyle, ResourceStock } from '../types';

export const SETTLEMENT_NEEDS = ['food', 'housing', 'trade', 'government', 'security', 'religion', 'knowledge', 'healthcare', 'manufacturing', 'transport', 'energy', 'water', 'memory'] as const;
export type SettlementNeed = typeof SETTLEMENT_NEEDS[number];
/** Reusable physical arrangements, not a catalogue of named institutions. */
export type StructureForm = 'dwelling' | 'field' | 'store' | 'gathering' | 'hall' | 'sanctuary' | 'tower' | 'workshop' | 'works' | 'marker';
export type StructureMaterial = 'earth' | 'timber' | 'masonry' | 'ceramic' | 'metal';
export type ServiceSupply = Partial<Record<SettlementNeed, number>>;

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
  project?: DevelopmentProject;
}
