import type { HistoricalEvent, HistoricalEventType, OutcomeClassification, Vec2 } from '../sim/types';
export type { HistoricalEvent } from '../sim/types';

export type EpistemicStatus = 'recorded-fact' | 'derived-statistic' | 'probabilistic-inference';

export type ObservationKind =
  | 'world-establishing'
  | 'regional-travel'
  | 'settlement-approach'
  | 'street-observation'
  | 'worker-follow'
  | 'traveler-follow'
  | 'institution-exterior'
  | 'discovery-scene'
  | 'battle-overview'
  | 'aftermath-pullback'
  | 'city-growth-timelapse'
  | 'night-transition'
  | 'infrastructure-scene'
  | 'landscape-pause'
  | 'atomic-threshold'
  | 'orbital-establishing'
  | 'civilization-ending'
  | 'historian-context';

export type AudioCategory = 'ambient-wilderness' | 'settlement' | 'ritual-culture' | 'discovery' | 'conflict' | 'tragedy' | 'industry' | 'historian' | 'major-threshold' | 'ending';

export interface HistorianClaimSet {
  population?: { month: number; value: number; scopeEntityId?: string };
  warId?: string;
  knowledgeId?: string;
  entityIds?: string[];
  eventType?: HistoricalEventType;
}

export interface HistorianStatement {
  id: string;
  month: number;
  text: string;
  epistemicStatus: EpistemicStatus;
  sourceEventIds: string[];
  sourceEntityIds: string[];
  sourceArchiveIds: string[];
  claims: HistorianClaimSet;
  voiceAssetId?: string;
}

export interface CandidateScoreBreakdown {
  novelty: number;
  magnitude: number;
  populationAffected: number;
  rarity: number;
  technological: number;
  political: number;
  cultural: number;
  consequence: number;
  continuity: number;
  repetitionPenalty: number;
}

export interface ObservationCandidate {
  id: string;
  subjectId: string;
  kind: ObservationKind;
  position: Vec2;
  title: string;
  statement: HistorianStatement;
  score: number;
  interest: number;
  audioCategory: AudioCategory;
  breakdown: CandidateScoreBreakdown;
  event?: HistoricalEvent;
}

export interface HistorianPrediction {
  id: string;
  madeMonth: number;
  horizonMonth: number;
  subjectIds: string[];
  predictedEventType: HistoricalEventType;
  sourceEntityIds: string[];
  resolved: boolean;
  occurred?: boolean;
}

export interface CrossRunContext {
  totalRuns: number;
  completedRuns: number;
  industrializedRuns: number;
  industrializedFraction: number | null;
  medianWritingYear: number | null;
  medianWarsPerMillennium: number | null;
  collapseFrequency: number | null;
  tradeKnowledgeCorrelation: number | null;
  atomicThresholdRuns: number;
  atomicThresholdFraction: number | null;
  medianAtomicThresholdYear: number | null;
  nuclearWeaponsRuns: number;
  nuclearWeaponsFraction: number | null;
  nuclearWarRuns: number;
  nuclearWarFraction: number | null;
  medianSurvivalYearsAfterAtomic: number | null;
  survivedThreeCenturiesAfterAtomic: number;
  interplanetaryRuns: number;
  interplanetaryFraction: number | null;
  extinctionOrCollapseRuns: number;
  postBiologicalOrUnknownRuns: number;
  outcomeCounts: Partial<Record<OutcomeClassification, number>>;
  archiveIds: string[];
}
