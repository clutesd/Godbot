import { mastery } from '../knowledge/KnowledgeSystem';
import type { Settlement, SimulationState } from '../types';
import { MATERIAL_CATALOG } from './catalog';
import { materialEconomy, takeMaterial } from './Inventory';
import { useLabour, type LabourBudget } from './Processing';
import type { ResourceEventDraft } from './ResourceSystem';
import { armsDemand, recordArmsDemand } from './ArmsDemand';

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
  const armsBefore = economy.timberArms;

  let armsLabour = 0;
  let armsTimber = 0;
  let attempted = 0;
  economy.tools *= 0.993; economy.arms *= atWar ? 0.94 : 0.995; 
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
  const demand = armsDemand(state, s, people, population);
  const service = economy.woodenArmsService ??= { active: demand.active, desired: demand.desired, replenishing: false, combatLoss: 0 };
  const combatLoss = service.combatLoss;
  service.combatLoss = 0;
  service.active = demand.active; service.desired = demand.desired;
  // Keep the old 1% ordinary wear rate, but apply it only to equipment actually issued.
  // Quality already measures usable output per timber; applying it again to wear would double count it.
  const issued = Math.min(economy.timberArms, Math.max(0, demand.active - economy.arms));
  const wear = issued * 0.01;
  economy.timberArms -= wear;
  const deficit = Math.max(0, demand.woodenDesired - economy.timberArms);
  const replacementDemand = Math.min(deficit, (service.replacementBacklog ?? 0) + wear + combatLoss);
  const expansionDemand = Math.max(0, deficit - replacementDemand);
  service.replacementBacklog = replacementDemand;
  // Reorder when the ready force loses coverage, then finish a reserve batch. No idle stock drain.
  if (economy.arms + economy.timberArms < demand.active) service.replenishing = true;
  if (deficit <= 1e-9) service.replenishing = false;
  const quality = Math.max(0, Math.min(1, economy.quality.timber ?? 0.5));
  const critical = Math.max(2, s.buildings * 0.3, s.survival?.establishment?.materialDemand.timber ?? 0);
  const timberBefore = s.localMaterials.timber ?? 0;
  if (service.replenishing && deficit > 1e-9 && quality > 0 && mastery(s, 'stone-composites').practice >= 0.18) {
    attempted = Math.min(deficit, Math.min(0.2, (budget.artisan ?? 0) * 0.3) * quality);
    // Routine reserves defer to existing critical needs; war may consume scarce timber for active defence.
    const available = Math.max(0, timberBefore - (atWar ? 0 : critical));
    armsTimber = takeMaterial(s, 'timber', Math.min(attempted / quality, available));
    economy.timberArms += armsTimber * quality;
    service.replacementBacklog = Math.max(0, replacementDemand - armsTimber * quality);
    armsLabour = useLabour(budget, ['artisan'], armsTimber / 0.3);
    economy.labourUsed += armsLabour;
    if (economy.timberArms >= demand.woodenDesired - 1e-9) service.replenishing = false;
  }
  recordArmsDemand({ settlementId: s.id, month: state.month, population, desired: demand.desired, policyDesired: demand.woodenDesired,
    stockBefore: armsBefore, stockAfter: economy.timberArms, metal: economy.arms,
    wear, combatLoss, arbitraryLoss: 0, replacementDemand, expansionDemand, attempted, achieved: armsTimber * quality,
    labour: armsLabour, timber: armsTimber, adequateBefore: armsBefore + economy.arms >= demand.desired,
    criticalTimber: timberBefore < critical, atWar });
  for (const m of MATERIAL_CATALOG) if (m.spoilage) takeMaterial(s, m.id, (s.localMaterials[m.id] ?? 0) * m.spoilage);
  const short = (s.localMaterials.timber ?? 0) < Math.max(2, s.buildings * 0.3) || economy.energySupplied < economy.energyDemand * 0.5;
  economy.shortageMonths = short ? economy.shortageMonths + 1 : Math.max(0, economy.shortageMonths - 2);
  if (short) s.prosperity = clamp(s.prosperity - 0.005);
  if (economy.shortageMonths >= 12 && state.month - (economy.lastEventMonth.shortage ?? -120) >= 120) {
    economy.lastEventMonth.shortage = state.month;
    events.push({ type: 'resource-crisis', location: s.position, locationId: s.id, actors: [s.id], causes: ['material-shortage'],
      context: { timber: s.localMaterials.timber ?? 0, energyDemand: economy.energyDemand, energySupplied: economy.energySupplied },
      outcome: 'Material and fuel shortages constrain work and reduce prosperity.', affectedPopulation: population,
      significance: 0.5, tags: ['resource', 'shortage'], summary: `${s.name} struggles to supply its material economy.` });
  }
}
