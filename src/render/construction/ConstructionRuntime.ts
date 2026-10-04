import type { Person, Settlement, SimulationState } from '../../sim/types';
import type { DevelopmentProject } from '../../sim/development/types';
import { workAvailability } from '../../sim/people/HumanCapital';

/** Presentation of paid simulation work, independent of the monthly household activity sample. */
export class ConstructionRuntime {
  private observed = '';
  private initialMonth = -1;
  private readonly receipts = new Set<string>();
  private readonly pending = new Map<string, Map<string, DevelopmentProject>>();
  private readonly views = new Map<string, Settlement>();
  revision = 0;

  private key(project: DevelopmentProject): string { return `${project.plotId}:${project.startedMonth}:${project.action}:${project.response.facilityTier ?? project.response.level}`; }

  sync(state: Pick<SimulationState, 'month' | 'settlements'>): void {
    const stamp = `${state.month}|${state.settlements.map(s => {
      const p = s.development?.project;
      return `${s.id}:${s.alive}:${s.buildings}:${s.development?.revision}:${p?.plotId}:${p?.startedMonth}:${p?.progress}:${p?.blockedReasons?.join(',')}`;
    }).join('|')}`;
    if (this.observed === stamp) return;
    this.observed = stamp;
    if (this.initialMonth < 0) this.initialMonth = state.month;
    const known = new Set<string>();
    for (const settlement of state.settlements) {
      const queue = this.pending.get(settlement.id) ?? new Map<string, DevelopmentProject>();
      this.pending.set(settlement.id, queue);
      const active = settlement.development?.project;
      const facilities = (settlement.processing?.facilities ?? []).flatMap(f => f.constructionWork && (f.progress < 1 || f.upgrade) ? [f.constructionWork] : []);
      const completed = (settlement.structurePlots ?? []).flatMap(plot => plot.development?.constructionWork ? [plot.development.constructionWork] : []);
      const sources = [...completed, ...(active ? [active] : []), ...facilities];
      const live = new Set(sources.map(p => this.key(p)));
      for (const key of live) known.add(key);
      for (const [key, project] of queue) if (!settlement.alive || !live.has(key)
        || !settlement.structurePlots?.some(p => p.id === project.plotId)) queue.delete(key);
      for (const source of sources) {
        if (!settlement.alive || !settlement.structurePlots?.some(p => p.id === source.plotId)) continue;
        const key = this.key(source);
        // Opening an archive shows its established structures. Only observed/new work is replayed.
        if (!queue.has(key) && (this.receipts.has(key) || source !== active && !facilities.includes(source) && (source.lastWorkMonth ?? -1) <= this.initialMonth)) {
          this.receipts.add(key); continue;
        }
        if (!queue.has(key)) { queue.set(key, { ...source, presentationPending: true }); this.revision++; }
        Object.assign(queue.get(key)!, source, { presentationPending: true });
        this.receipts.add(key);
      }
      this.setView(settlement);
    }
    // Keep receipts bounded to the current/most recent project on each plot, including released work.
    for (const key of this.receipts) if (!known.has(key)) this.receipts.delete(key);
  }

  private setView(settlement: Settlement): void {
    const projects = [...(this.pending.get(settlement.id)?.values() ?? [])];
    // An unpaid reservation cannot keep an independently paid facility's crew off screen.
    const project = projects.find(p => p.progress > 0) ?? projects[0];
    this.views.set(settlement.id, project && settlement.development
      ? { ...settlement, development: { ...settlement.development, project }, constructionProgress: project.progress }
      : settlement);
  }

  settlement(settlement: Settlement): Settlement { return this.views.get(settlement.id) ?? settlement; }
  signature(settlementId: string): string { return [...(this.pending.get(settlementId)?.keys() ?? [])].join(','); }
  settlements(settlements: readonly Settlement[]): Settlement[] { return settlements.map(s => this.settlement(s)); }
  holds(plotId: string): boolean {
    for (const queue of this.pending.values()) for (const project of queue.values()) if (project.plotId === plotId) return true;
    return false;
  }

  /** Release only when the canonical visual target has actually been seated, never on sim completion. */
  finish(settlement: Settlement, project: DevelopmentProject): void {
    if (project.progress < 1) return;
    const queue = this.pending.get(settlement.id);
    if (queue?.get(this.key(project)) !== project) return;
    queue.delete(this.key(project)); this.revision++;
    this.setView(settlement);
  }

  person(person: Person): Person {
    const project = this.views.get(person.homeId)?.development?.project;
    if (!project?.presentationPending || !project.workerIds?.includes(person.id) || workAvailability(person) <= 0.25
      || ['flee', 'shelter', 'migrate'].includes(person.activity) || person.navigation?.schedulePhase === 'emergency') return person;
    return { ...person, activity: 'construct', navigation: {
      ...person.navigation, destinationKind: 'construction-site', destinationId: project.plotId,
      waypoints: [], waypointIndex: 0, traveling: false, schedulePhase: 'work',
      reason: 'presenting recorded paid construction labour at its exact project workface',
    } };
  }
}
