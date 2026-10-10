import type { Settlement } from '../types';

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

/** One kiln firing's worth of upkeep on the practice of an understanding it demonstrates. */
const PRACTICE_PER_UNIT = 0.0012;
/**
 * One contained kiln firing's contribution to the energy domain's accumulated experimental mass.
 * Sized so that a community firing kilns and burning charcoal every month becomes the best-placed
 * one in the world to work out how a fire behaves, well clear of the standing level that mere
 * fuel scarcity produces, while a community that fires nothing stays at that standing level.
 */
const INSIGHT_PER_UNIT = 0.01;

/**
 * Only knowledge the settlement already holds is refreshed, and only toward the level its own
 * work demonstrates. Nothing here grants a record, so work in a domain is evidence about ideas
 * the community has had, never a substitute for having them.
 */
function exercise(s: Settlement, id: string, amount: number, month: number): void {
  const record = s.knowledge.records[id];
  if (!record || record.dormant || !(amount > 0)) return;
  record.practice = clamp(record.practice + amount);
  record.lastUsedMonth = month;
}

/**
 * Controlled fire is a skill that only survives being used, and combustion is an idea that only
 * occurs to people who watch contained fires do work. Every authority that actually applies
 * sustained heat — a charcoal burn, a pottery or brick kiln, a furnace, a winter hearth — reports
 * it here, with `intensity` measured against one kiln firing.
 *
 * `containment` separates the two things a fire teaches. Tending any fire keeps controlled fire in
 * practice, so it does not affect that. But only fire held inside something — a kiln, a furnace, a
 * covered burn — shows how airflow, fuel and vessel geometry change the heat. That is both what
 * the energy domain's experimental mass represents and what putting combustion dynamics into
 * practice means, so an open hearth keeps a community's hands in while teaching it almost nothing
 * about containment.
 *
 * Discovery itself is still decided by `KnowledgeSystem` against the usual prerequisites,
 * readiness and chance: a community with no heat work accumulates no evidence and reaches no
 * combustion knowledge.
 */
export function recordHeatWork(s: Settlement, intensity: number, month: number, containment = 1): void {
  if (!(intensity > 0)) return;
  const contained = intensity * Math.max(0, containment);
  exercise(s, 'fire-control', PRACTICE_PER_UNIT * intensity, month);
  exercise(s, 'combustion-dynamics', PRACTICE_PER_UNIT * contained, month);
  if (contained > 0) s.knowledge.experimentation.energy = Math.min(3, s.knowledge.experimentation.energy + INSIGHT_PER_UNIT * contained);
}

/**
 * Transforming a material is how a community learns what materials do: a batch that fractured,
 * slumped, or held is evidence about hardness, heat response and durability. Every craft cycle
 * reports the work it did, so material testing is put into practice by the people doing the
 * testing rather than only reasoned about.
 */
export function recordMaterialWork(s: Settlement, intensity: number, month: number): void {
  if (!(intensity > 0)) return;
  exercise(s, 'material-testing', PRACTICE_PER_UNIT * 0.7 * intensity, month);
}
