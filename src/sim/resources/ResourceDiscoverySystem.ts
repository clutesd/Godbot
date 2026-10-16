import { mastery } from '../knowledge/KnowledgeSystem';
import type { ResourceDeposit, Settlement, SimulationState } from '../types';
import { ExtractionAccessibility } from './ExtractionAccessibility';
import { RESOURCE_BY_ID } from './catalog';

/** Location knowledge is independent of recognizing a material's usefulness and exploiting it. */
export function resourceKnowledge(s: Settlement, d: ResourceDeposit) {
  const definition = RESOURCE_BY_ID.get(d.resourceId);
  const understood = !!definition && (!definition.understandingKnowledge || mastery(s, definition.understandingKnowledge).theory >= 0.12);
  return { visible: (d.exposure ?? 1) >= 0.18, discovered: s.discoveredDeposits.includes(d.id), understood,
    deepExtraction: !!definition?.extractionKnowledge && mastery(s, definition.extractionKnowledge).practice >= 0.3 && s.infrastructure.workshops >= 0.05 };
}

/** How far (in cells) a camp's gatherers range when actively searching for materials it needs. */
export const SCOUTING_REACH_CELLS = 6;

const accessibility = new WeakMap<SimulationState, ExtractionAccessibility>();
/** Gatherers refuse hauls costlier than this (see ResourceSystem.gather). */
export const MAX_GATHER_ACCESS_COST = 8;

/** Whether surface material of this kind lies inside the scouting reach over a walkable route, discovered or not. */
export function surfaceMaterialInReach(state: SimulationState, s: Settlement, resourceId: string): boolean {
  let access = accessibility.get(state);
  if (!access) accessibility.set(state, access = new ExtractionAccessibility(state));
  const { world } = state;
  return world.resourceDeposits.some(d => d.resourceId === resourceId && !d.depleted && (d.exposure ?? 1) >= 0.5
    && Math.hypot(d.worldX - s.position.x, d.worldZ - s.position.z) / world.cellSize <= SCOUTING_REACH_CELLS
    && (access.resolve(s, d)?.cost ?? Infinity) <= MAX_GATHER_ACCESS_COST);
}

export function discoveryReadiness(s: Settlement, d: ResourceDeposit): number {
  const knowledge = resourceKnowledge(s, d);
  const prospecting = mastery(s, 'material-testing').practice;
  // Buried bodies require prospecting or extraction experience; understanding is a separate gate.
  if (!knowledge.visible && prospecting < 0.3) return 0;
  return Math.min(1.5, (d.exposure ?? 1) + prospecting * (1 - (d.exposure ?? 1)) + (s.workedDeposits.length ? 0.08 : 0));
}

export function discoverProvince(s: Settlement, d: ResourceDeposit, month: number): boolean {
  if (s.discoveredDeposits.includes(d.id)) return false;
  s.discoveredDeposits.push(d.id);
  d.discoveredBy[s.id] = month;
  return true;
}
