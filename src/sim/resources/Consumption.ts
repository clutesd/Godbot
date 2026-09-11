import { mastery } from '../knowledge/KnowledgeSystem';
import type { Settlement, SimulationState } from '../types';
import { MATERIAL_CATALOG } from './catalog';
import { materialEconomy, takeMaterial } from './Inventory';
import { useLabour, type LabourBudget } from './Processing';
import type { ResourceEventDraft } from './ResourceSystem';

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

export function consumeMaterials(state: SimulationState, s: Settlement, people: SimulationState['people'], budget: LabourBudget, events: ResourceEventDraft[]): void {
  const economy = materialEconomy(s);
  const city = state.advanced.scale === 'modern-statistical' ? state.advanced.cities.find(c => c.settlementId === s.id) : undefined;
  const population = city?.population ?? people.length;
  const need = Math.max(0.1, population * 0.02);
  economy.medicineCoverage = clamp(takeMaterial(s, 'herbal-remedy', need) / need);
  for (const person of people) person.health = clamp(person.health + economy.medicineCoverage * 0.008);
  if (city) city.health = clamp(city.health + economy.medicineCoverage * 0.008);
  const atWar = state.wars.some(w => w.active && (w.attacker === s.id || w.defender === s.id));
  economy.tools *= 0.993; economy.arms *= atWar ? 0.94 : 0.995; economy.timberArms *= atWar ? 0.92 : 0.99;
  for (const id of ['iron-tools', 'bronze']) {
    const capacity = Math.min(1, (budget.artisan ?? 0) * 2, Math.max(0, population * 0.3 - economy.tools - economy.arms));
    const used = takeMaterial(s, id, capacity);
    if (!used) continue;
    const quality = economy.quality[id] ?? 0.5;
    const armShare = atWar ? 0.7 : 0.25;
    economy.arms += used * armShare * (0.6 + quality * 0.4);
    economy.tools += used * (1 - armShare) * (0.6 + quality * 0.4);
    economy.labourUsed += useLabour(budget, ['artisan'], used * 0.5);
  }
  if (mastery(s, 'stone-composites').practice >= 0.18 && economy.timberArms < population * 0.1) {
    const timber = takeMaterial(s, 'timber', Math.min(0.2, (budget.artisan ?? 0) * 0.3));
    economy.timberArms += timber * (economy.quality.timber ?? 0.5);
    economy.labourUsed += useLabour(budget, ['artisan'], timber / 0.3);
  }
  for (const m of MATERIAL_CATALOG) if (m.spoilage) takeMaterial(s, m.id, (s.materials[m.id] ?? 0) * m.spoilage);
  const short = (s.materials.timber ?? 0) < Math.max(2, s.buildings * 0.3) || economy.energySupplied < economy.energyDemand * 0.5;
  economy.shortageMonths = short ? economy.shortageMonths + 1 : Math.max(0, economy.shortageMonths - 2);
  if (short) s.prosperity = clamp(s.prosperity - 0.005);
  if (economy.shortageMonths >= 12 && state.month - (economy.lastEventMonth.shortage ?? -120) >= 120) {
    economy.lastEventMonth.shortage = state.month;
    events.push({ type: 'resource-crisis', location: s.position, locationId: s.id, actors: [s.id], causes: ['material-shortage'],
      context: { timber: s.materials.timber ?? 0, energyDemand: economy.energyDemand, energySupplied: economy.energySupplied },
      outcome: 'Material and fuel shortages constrain work and reduce prosperity.', affectedPopulation: population,
      significance: 0.5, tags: ['resource', 'shortage'], summary: `${s.name} struggles to supply its material economy.` });
  }
}
