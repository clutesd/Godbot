import { auditProgressionReachability } from '../src/sim/knowledge/ReachabilityAudit';
import type { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';
import { materialAccess } from '../src/sim/resources/Inventory';
import { representedPopulation, settlementRepresentedPopulation } from '../src/sim/Population';
import { settlementLabour } from '../src/sim/people/HumanCapital';
import { settlementPresentationEra } from '../src/render/assets/SettlementEra';
import type { Settlement, SimulationState } from '../src/sim/types';

export class ProgressionMetrics {
  readonly frames: unknown[] = [];
  readonly milestones: Record<string, Record<string, number>> = {};
  readonly blockers: Record<string, Record<string, number>> = {};
  readonly graph = auditProgressionReachability();
  private readonly populations = new Map<string, number>();
  readonly declines: Array<{ month: number; settlement: string; before: number; after: number; food: number; disease: number; conflict: number; deprivation: number }> = [];

  observe(state: SimulationState): void {
    for (const s of state.settlements) {
      const first = this.milestones[s.id] ??= {};
      const mark = (key: string, month = state.month) => { first[key] ??= month; };
      for (const r of Object.values(s.knowledge.records)) {
        mark(`discovered:${r.id}`, r.discoveredMonth);
        if (r.adoptedMonth !== undefined) mark(`adopted:${r.id}`, r.adoptedMonth);
        if (r.transformedMonth !== undefined) mark(`transformed:${r.id}`, r.transformedMonth);
      }
      for (const p of s.energy?.plants ?? []) if (p.progress >= 1 && p.output > 0) mark(`operating:${p.kind}`);
      for (const f of s.processing?.facilities ?? []) if (f.throughput > 0) mark(`operating:${f.family}:${f.tier}`);
      if ((s.energy?.ledgers.electric.supplied ?? 0) > 0) mark('electric-service');
      if ((s.energy?.service.supplied.productive ?? 0) > 0) mark('electric-productive-service');
      if (s.energy?.lit) mark('electric-lighting');
      if ((s.fields ?? []).some(f => f.irrigationReceived > 0)) mark('operating:irrigation');
      if (s.industry.active) mark('industrial-transformation');
      if (state.tradeRoutes.some(r => r.transport?.trip?.origin === s.id && r.transport.trip.status === 'arrived' && r.transport.trip.mode === 'water')) mark('operating:port-freight');
    }
  }

  year(state: SimulationState, knowledge: Pick<KnowledgeSystem, 'discoveryDiagnostics' | 'infrastructureDiagnostics'>): void {
    const living = state.settlements.filter(s => s.alive);
    const settlements = living.map(s => this.settlementFrame(state, s, knowledge));
    const deathCauses: Record<string, number> = {};
    for (let i = state.history.length - 1; i >= 0; i--) {
      const event = state.history[i]!;
      if (event.month <= state.month - 12) break;
      if (event.type === 'death') for (const cause of event.causes) deathCauses[cause] = (deathCauses[cause] ?? 0) + 1;
    }
    this.frames.push({ month: state.month, population: representedPopulation(state), populationMode: state.advanced.scale,
      populationInLivingSettlements: living.reduce((n, s) => n + settlementRepresentedPopulation(state, s.id), 0), deathCauses,
      stats: { ...state.stats }, settlements, activeRoutes: state.tradeRoutes.filter(r => r.active).length,
      activeGridLines: state.energy?.lines.filter(l => !l.retired && l.progress >= 1 && l.condition > 0.25).length ?? 0,
      gridFlow: state.energy?.lines.reduce((n, l) => n + l.flow, 0) ?? 0,
      roads: Object.values(state.transportation?.segments ?? {}).filter(s => s.mode === 'road' && s.status === 'complete').length,
      bridges: Object.values(state.transportation?.segments ?? {}).filter(s => s.kind === 'bridge' && s.status === 'complete').length,
      docks: Object.values(state.transportation?.stops ?? {}).filter(s => s.kind === 'port' && s.status === 'complete').length,
    });
  }

  private settlementFrame(state: SimulationState, s: Settlement, knowledge: Pick<KnowledgeSystem, 'discoveryDiagnostics' | 'infrastructureDiagnostics'>) {
    const population = settlementRepresentedPopulation(state, s.id);
    const before = this.populations.get(s.id);
    if (before && population < before * 0.8) this.declines.push({ month: state.month, settlement: s.id, before, after: population,
      food: s.resources.food, disease: s.survival?.disease?.prevalence ?? 0, conflict: s.conflictPressure,
      deprivation: s.survival?.deprivation ?? 0 });
    this.populations.set(s.id, population);
    const block = knowledge.discoveryDiagnostics(state, s);
    for (const [id, reasons] of Object.entries(block)) for (const reason of reasons) {
      const frequencies = this.blockers[id] ??= {}; const key = reason.split(' ')[0]!;
      frequencies[key] = (frequencies[key] ?? 0) + 1;
    }
    return { id: s.id, name: s.name, population, specialization: s.specialization,
      occupations: settlementLabour(state, s).occupations, resources: { ...s.resources },
      physicalMaterials: { ...s.localMaterials }, access: Object.fromEntries(Object.keys(s.localMaterials).map(id => [id, materialAccess(s, id)])),
      // Store withdrawals include dispatch to works; facility consumption separately records conversion.
      storeFlows: s.materialEconomy?.flows ? structuredClone(s.materialEconomy.flows) : null,
      foodLedger: s.survival?.food ? { ...s.survival.food } : null, shortages: s.materialEconomy?.shortageMonths ?? 0,
      imports: { ...s.materialEconomy?.imports }, tools: s.materialEconomy?.tools ?? 0,
      infrastructure: { ...s.infrastructure }, infrastructureBlockers: knowledge.infrastructureDiagnostics(state, s),
      project: s.development?.project ? structuredClone(s.development.project) : null,
      knowledge: Object.fromEntries(Object.entries(s.knowledge.records).map(([id, r]) => [id, { ...r }])),
      experimentation: { ...s.knowledge.experimentation }, blockedKnowledge: block,
      facilities: structuredClone(s.processing?.facilities ?? []), energy: s.energy ? structuredClone(s.energy) : null,
      irrigation: (s.fields ?? []).map(f => ({ id: f.id, delivered: f.irrigationReceived, works: f.irrigationWorks ? { ...f.irrigationWorks } : null })),
      visualEra: settlementPresentationEra(s), buildingLevels: (s.structurePlots ?? []).filter(p => p.development?.status === 'active').map(p => p.development!.level),
      industry: { ...s.industry }, mortalityRisk: { deprivation: s.survival?.deprivation, exposure: s.survival?.cold.exposure,
        disease: s.survival?.disease?.prevalence, conflict: s.conflictPressure, health: s.development?.water?.quality },
    };
  }
}
