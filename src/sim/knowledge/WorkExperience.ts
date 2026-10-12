import type { KnowledgeDomain, Settlement } from '../types';
import { materialEconomy } from '../resources/Inventory';

/** Work evidence shares the material economy's rolling window and never supplies extra labour. */
export function recordKnowledgeWork(s: Settlement, domain: KnowledgeDomain, work: number): void {
  const flows = materialEconomy(s).flows;
  if (!flows || work <= 0) return;
  const evidence = flows.work ??= {};
  evidence[domain] = (evidence[domain] ?? 0) + work / 12;
  // These are observations demonstrated by this work itself, rather than every entry in the
  // domain. Operating shafts and heated recipes report their more specific skills separately.
  const exercised: Partial<Record<KnowledgeDomain, readonly string[]>> = {
    mechanics: ['leverage'], records: ['counting-measure', 'durable-records'],
    navigation: ['buoyancy-currents'], agriculture: ['seasonal-observation'],
  };
  for (const id of exercised[domain] ?? []) {
    const record = s.knowledge.records[id];
    if (!record || record.dormant) continue;
    record.practice = Math.min(1, record.practice + Math.log1p(work) * 0.0007);
    record.lastUsedMonth = flows.month;
  }
}

export function practicalActivity(s: Settlement, domain: KnowledgeDomain, workers: number): number {
  const observed = s.materialEconomy?.flows?.work?.[domain] ?? 0;
  return Math.min(1, observed / Math.max(0.5, workers * 0.25));
}
