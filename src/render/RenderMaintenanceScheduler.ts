export type RenderMaintenanceTask =
  | 'hydrology'
  | 'settlements'
  | 'routes'
  | 'timeline'
  | 'vegetation'
  | 'seasonal';

/**
 * Expensive presentation maintenance is frequency-bound but not frame-bound. This scheduler keeps
 * each requested cadence while ensuring only one heavy maintenance task is released per rendered
 * frame. Simulation authority is untouched; only renderer reconciliation is de-phased.
 */
export class RenderMaintenanceScheduler {
  private structuralAccumulator = 0;
  private vegetationAccumulator = 0;
  private readonly pending: RenderMaintenanceTask[] = [];
  private readonly queued = new Set<RenderMaintenanceTask>();

  advance(deltaSeconds: number, structuralUpdatesPerSecond: number, vegetationIntervalSeconds: number): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    const structuralInterval = 1 / Math.max(1, structuralUpdatesPerSecond);
    this.structuralAccumulator += delta;
    this.vegetationAccumulator += delta;

    if (this.structuralAccumulator >= structuralInterval) {
      this.structuralAccumulator %= structuralInterval;
      this.enqueue('hydrology');
      this.enqueue('settlements');
      this.enqueue('routes');
      this.enqueue('timeline');
    }
    if (this.vegetationAccumulator >= vegetationIntervalSeconds) {
      this.vegetationAccumulator %= vegetationIntervalSeconds;
      this.enqueue('vegetation');
    }
  }

  next(): RenderMaintenanceTask | undefined {
    const task = this.pending.shift();
    if (task) this.queued.delete(task);
    return task;
  }

  /**
   * Force one catch-up cycle after a deliberately frozen presentation phase (such as Arrival).
   * Tasks are still released one per frame, so resuming never creates a single catch-up hitch.
   */
  requestCatchUp(): void {
    this.enqueue('hydrology');
    this.enqueue('settlements');
    this.enqueue('routes');
    this.enqueue('timeline');
    this.enqueue('vegetation');
  }

  get pendingCount(): number { return this.pending.length; }

  request(task: RenderMaintenanceTask, priority = false): void {
    if (this.queued.has(task)) return;
    this.queued.add(task);
    if (priority) this.pending.unshift(task);
    else this.pending.push(task);
  }

  private enqueue(task: RenderMaintenanceTask): void {
    this.request(task);
  }
}
