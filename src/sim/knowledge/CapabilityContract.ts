import { DEFAULT_CONFIG, type GodboxConfig } from '../../config';
import type { KnowledgeRecord, Settlement } from '../types';
import { KNOWLEDGE_BY_ID } from './catalog';

export type KnowledgeLifecycleStage = 'unknown' | 'idea' | 'experimental' | 'adopted' | 'transformed';
export type KnowledgeUseRequirement = 'experimental' | 'adopted' | 'transformed';

export type KnowledgeStageThresholds = Pick<GodboxConfig['historicalPace'], 'adoptionTheory' | 'adoptionPractice' | 'transformationPractice'>;

const DEFAULT_THRESHOLDS: KnowledgeStageThresholds = {
  adoptionTheory: DEFAULT_CONFIG.historicalPace.adoptionTheory,
  adoptionPractice: DEFAULT_CONFIG.historicalPace.adoptionPractice,
  transformationPractice: DEFAULT_CONFIG.historicalPace.transformationPractice,
};

const STAGE_RANK: Record<KnowledgeLifecycleStage, number> = {
  unknown: 0,
  idea: 1,
  experimental: 2,
  adopted: 3,
  transformed: 4,
};

const REQUIREMENT_RANK: Record<KnowledgeUseRequirement, number> = {
  experimental: STAGE_RANK.experimental,
  adopted: STAGE_RANK.adopted,
  transformed: STAGE_RANK.transformed,
};

function adoptionBasis(record: KnowledgeRecord): number {
  const definition = KNOWLEDGE_BY_ID.get(record.id);
  return definition?.kind === 'understanding' ? record.theory : record.practice;
}

function adoptionThreshold(record: KnowledgeRecord, thresholds: KnowledgeStageThresholds): number {
  const definition = KNOWLEDGE_BY_ID.get(record.id);
  return definition?.kind === 'understanding' ? thresholds.adoptionTheory : thresholds.adoptionPractice;
}

/**
 * Returns the social lifecycle stage of a piece of knowledge.
 *
 * Inherited knowledge represents established communal practice at the simulation horizon, not a
 * fresh discovery, so it begins locally adopted unless it later becomes dormant. Major discoveries
 * use explicit adoption/transformation dates recorded by KnowledgeSystem. Minor practices do not
 * create headline history events, so mature local practice is treated as adopted once it crosses
 * the same adoption threshold. A major capability can therefore never silently become
 * civilization-wide simply because its raw practice score is high.
 */
export function knowledgeLifecycleStage(
  settlement: Settlement,
  id: string,
  thresholds: KnowledgeStageThresholds = DEFAULT_THRESHOLDS,
): KnowledgeLifecycleStage {
  const record = settlement.knowledge.records[id];
  if (!record || record.dormant) return 'unknown';
  if (record.transformedMonth !== undefined) return 'transformed';
  if (record.adoptedMonth !== undefined || record.source === 'inheritance') return 'adopted';

  const definition = KNOWLEDGE_BY_ID.get(id);
  const threshold = Math.max(0.01, adoptionThreshold(record, thresholds));
  const basis = adoptionBasis(record);

  // Minor/local practices intentionally avoid producing a global historical adoption event. Once
  // their lived use is mature enough, they are nevertheless routine local capabilities.
  if (definition && !definition.major && basis >= threshold) return 'adopted';

  return basis >= threshold * 0.45 ? 'experimental' : 'idea';
}

export function hasKnowledgeCapability(
  settlement: Settlement,
  id: string,
  requirement: KnowledgeUseRequirement = 'adopted',
  thresholds: KnowledgeStageThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return STAGE_RANK[knowledgeLifecycleStage(settlement, id, thresholds)] >= REQUIREMENT_RANK[requirement];
}

/**
 * Stage-aware replacement for using raw `practice` as proof that society can deploy a technology.
 * The returned magnitude remains the recorded practice score, but it is zero until the required
 * social stage exists. Use `experimental` only for prototypes/research, `adopted` for routine local
 * use, and `transformed` for network, industrial, military, or civilization-scale effects.
 */
export function capabilityPractice(
  settlement: Settlement,
  id: string,
  requirement: KnowledgeUseRequirement = 'adopted',
  thresholds: KnowledgeStageThresholds = DEFAULT_THRESHOLDS,
): number {
  if (!hasKnowledgeCapability(settlement, id, requirement, thresholds)) return 0;
  return settlement.knowledge.records[id]?.practice ?? 0;
}

export function capabilityTheory(
  settlement: Settlement,
  id: string,
  requirement: KnowledgeUseRequirement = 'adopted',
  thresholds: KnowledgeStageThresholds = DEFAULT_THRESHOLDS,
): number {
  if (!hasKnowledgeCapability(settlement, id, requirement, thresholds)) return 0;
  return settlement.knowledge.records[id]?.theory ?? 0;
}
